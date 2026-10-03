/**
 * Renders the film frame by frame in headless Chromium and encodes it with ffmpeg.
 *
 *   node scripts/render.mjs --format desktop                 → out/deckify-film-16x9-3840x2160.mp4 (2× device scale)
 *   node scripts/render.mjs --format mobile                  → out/deckify-film-9x16-1080x1920.mp4
 *   node scripts/render.mjs --format desktop --scale 0.5     → a fast 960×540 draft
 *   node scripts/render.mjs --stills 0.5,3.6,14.8            → PNG stills for review (out/stills/)
 *
 * Options: --fps (default 30), --scale (device scale factor; default 2 for desktop, 1 for mobile), --from / --to (seconds),
 * --crf (default 14), --no-audio.
 */
/* global window, document, dispatchEvent -- page.evaluate() callbacks run in the browser. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";

const FILM = path.resolve(import.meta.dirname, "..");
const OUT = path.join(FILM, "out");

const { values: args } = parseArgs({
	options: {
		format: { type: "string", default: "desktop" },
		fps: { type: "string", default: "30" },
		scale: { type: "string" },
		from: { type: "string", default: "0" },
		to: { type: "string" },
		crf: { type: "string", default: "14" },
		stills: { type: "string" },
		out: { type: "string" },
		"no-audio": { type: "boolean", default: false },
	},
});

const format = args.format === "mobile" ? "mobile" : "desktop";
const fps = Number(args.fps);
const scale = Number(args.scale ?? (format === "desktop" ? 2 : 1));

/** The pre-installed Chromium (see the environment notes); override with CHROMIUM_PATH. */
function chromiumPath() {
	if (process.env.CHROMIUM_PATH) {
		return process.env.CHROMIUM_PATH;
	}
	const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
	const dir = fs.existsSync(root) ? fs.readdirSync(root).find((d) => /^chromium-\d+$/.test(d)) : undefined;
	return dir ? path.join(root, dir, "chrome-linux", "chrome") : undefined;
}

const server = await startServer(0);
const browser = await chromium.launch({
	executablePath: chromiumPath(),
	args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text", "--hide-scrollbars"],
});
const W = format === "desktop" ? 1920 : 1080;
const H = format === "desktop" ? 1080 : 1920;
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
page.on("pageerror", (err) => console.error("page error:", err.message));
page.on("response", (res) => res.status() >= 400 && console.error(`HTTP ${res.status()}: ${res.url()}`));
await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => document.body.classList.add("rendering")));
await page.goto(`${server.url}/?format=${format}`);
await page.evaluate(async (value) => {
	document.body.classList.add("rendering");
	dispatchEvent(new Event("resize"));
	await window.__film.ready;
	window.__film.setFps(value);
}, fps);

const capture = async (t) => {
	await page.evaluate((time) => window.__film.seek(time), t);
	return page.screenshot({ type: "png", animations: "allow", caret: "initial" });
};

fs.mkdirSync(OUT, { recursive: true });

if (args.stills) {
	const dir = path.join(OUT, "stills");
	fs.mkdirSync(dir, { recursive: true });
	const times = args.stills.split(",").map(Number).sort((a, b) => a - b);
	for (const t of times) {
		const file = path.join(dir, `${format}-${t.toFixed(2).padStart(5, "0")}.png`);
		fs.writeFileSync(file, await capture(t));
		console.log(file);
	}
} else {
	const duration = await page.evaluate(() => window.__film.duration);
	const from = Number(args.from);
	const to = Number(args.to ?? duration);
	const frames = Math.round((to - from) * fps);
	const size = `${W * scale}x${H * scale}`;
	const file =
		args.out ?? path.join(OUT, `deckify-film-${format === "desktop" ? "16x9" : "9x16"}-${size}${from > 0 || to < duration ? `-${from}-${to}` : ""}.mp4`);
	const audio = path.join(OUT, "soundtrack.wav");
	const withAudio = !args["no-audio"] && fs.existsSync(audio);
	const ffmpeg = spawn(
		"ffmpeg",
		[
			"-y",
			"-loglevel", "error",
			"-f", "image2pipe",
			"-framerate", String(fps),
			"-c:v", "png",
			"-i", "-",
			...(withAudio ? ["-ss", String(from), "-t", String(to - from), "-i", audio] : []),
			"-c:v", "libx264",
			"-preset", "slow",
			"-crf", args.crf,
			"-pix_fmt", "yuv420p",
			"-profile:v", "high",
			"-tune", "film",
			"-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
			...(withAudio ? ["-c:a", "aac", "-b:a", "320k", "-shortest"] : []),
			"-movflags", "+faststart",
			file,
		],
		{ stdio: ["pipe", "inherit", "inherit"] },
	);
	const started = Date.now();
	for (let i = 0; i < frames; i++) {
		const png = await capture(from + i / fps);
		if (!ffmpeg.stdin.write(png)) {
			await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
		}
		if (i % fps === 0 || i === frames - 1) {
			const rate = (i + 1) / ((Date.now() - started) / 1000);
			process.stdout.write(`\r${format} ${size}: frame ${i + 1}/${frames} (${rate.toFixed(1)} fps)   `);
		}
	}
	ffmpeg.stdin.end();
	await new Promise((resolve, reject) => ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))));
	console.log(`\n${file}${withAudio ? "" : " (no soundtrack: run npm run soundtrack first)"}`);
}

await browser.close();
await server.close();
