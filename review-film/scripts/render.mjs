/**
 * Renders the review film: draws every frame of src/film.js in headless Chromium, checks it (film.check(): text over footage, clipping,
 * zones), and encodes 1920×1080, 30 fps, H.264 (High, yuv420p, +faststart) with out/soundtrack.wav (scripts/soundtrack.mjs).
 *
 *   node scripts/render.mjs                         → out/deckify-review-film-1920x1080.mp4
 *   node scripts/render.mjs --stills 3.2,18,45      → out/stills/*.png only
 *
 * Needs out/clips (scripts/prepare.mjs). Fails without writing the film if any frame fails its check.
 */
/* global window -- used inside page.evaluate() callbacks, which run in the page */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";

const HERE = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(HERE, "out");
const FILM = path.join(OUT, "deckify-review-film-1920x1080.mp4");
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []));
const CHROMIUM = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find((p) => p && fs.existsSync(p));

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
const MOUNTS = [
	["/src/", path.join(HERE, "src")],
	["/clips/", path.join(OUT, "clips")],
	["/brand/", path.join(ROOT, "assets", "brand")],
	["/fonts/", path.join(HERE, "node_modules", "@fontsource", "inter", "files")],
];

function serve() {
	const server = http.createServer((req, res) => {
		const url = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
		const file = url === "/" ? path.join(HERE, "src", "index.html") : (() => {
			const m = MOUNTS.find(([p]) => url.startsWith(p));
			const f = m && path.resolve(m[1], url.slice(m[0].length));
			return f && f.startsWith(m[1]) ? f : undefined;
		})();
		if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404).end();
			return;
		}
		res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "max-age=3600" });
		fs.createReadStream(file).pipe(res);
	});
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

async function main() {
	if (!fs.existsSync(path.join(OUT, "clips", "manifest.json"))) {
		throw new Error("Run scripts/prepare.mjs first.");
	}
	const server = await serve();
	const browser = await chromium.launch({ executablePath: CHROMIUM });
	const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(`${server.origin}/`);
	await page.evaluate(() => window.filmReady);
	if (errors.length) throw new Error(errors.join("\n"));
	const { frames, fps } = await page.evaluate(() => ({ frames: window.film.frames, fps: window.film.fps }));

	const draw = async (f) => {
		const issues = await page.evaluate(async (n) => {
			await window.film.seek(n);
			return window.film.check();
		}, f);
		if (errors.length) throw new Error(errors.join("\n"));
		return issues;
	};

	try {
		if ("check" in args || process.argv.includes("--check")) {
			const problems = [];
			for (let f = 0; f < frames; f++) {
				(await draw(f)).forEach((i) => problems.push(`${(f / fps).toFixed(2)}s ${i}`));
			}
			console.log(problems.length ? problems.join("\n") : `All ${frames} frames pass.`);
			process.exitCode = problems.length ? 1 : 0;
			return;
		}
		if (args.stills) {
			const dir = path.join(OUT, "stills");
			fs.mkdirSync(dir, { recursive: true });
			for (const t of args.stills.split(",").map(Number)) {
				const issues = await draw(Math.round(t * fps));
				await page.screenshot({ path: path.join(dir, `still-${t.toFixed(2).padStart(6, "0")}.png`) });
				console.log(`  ${t}s ${issues.length ? issues.join("; ") : "ok"}`);
			}
			return;
		}

		const audio = path.join(OUT, "soundtrack.wav");
		const partial = `${FILM}.partial.mp4`;
		const ffmpeg = spawn(
			"ffmpeg",
			[
				"-v", "error", "-y",
				"-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-",
				...(fs.existsSync(audio) ? ["-i", audio, "-c:a", "aac", "-b:a", "192k", "-shortest"] : []),
				"-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-pix_fmt", "yuv420p",
				"-r", String(fps), "-movflags", "+faststart", "-f", "mp4", partial,
			],
			{ stdio: ["pipe", "inherit", "inherit"] },
		);
		const done = new Promise((resolve, reject) => ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
		const problems = [];
		const started = Date.now();
		for (let f = 0; f < frames; f++) {
			const issues = await draw(f);
			issues.forEach((i) => problems.push(`${(f / fps).toFixed(2)}s ${i}`));
			const png = await page.screenshot({ type: "png" });
			if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
			if (f % 150 === 0) console.log(`  ${(f / fps).toFixed(0)}s / ${(frames / fps).toFixed(0)}s (${((Date.now() - started) / 1000).toFixed(0)}s elapsed)`);
		}
		ffmpeg.stdin.end();
		await done;
		if (problems.length) {
			fs.rmSync(partial, { force: true });
			console.error([...new Set(problems.map((p) => p.replace(/^[\d.]+s /, "")))].map((p) => `  ✗ ${p}`).join("\n"));
			console.error(`\n${problems.length} frame problems (first at ${problems[0].split(" ")[0]}); the film was not written.`);
			process.exitCode = 1;
			return;
		}
		fs.renameSync(partial, FILM);
		console.log(`Wrote ${path.relative(ROOT, FILM)} (${frames} frames, ${(frames / fps).toFixed(2)} s). Every frame passed its check.`);
	} finally {
		await browser.close();
		server.close();
	}
}

await main();
