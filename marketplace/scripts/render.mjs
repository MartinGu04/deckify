/**
 * Renders Deckify's Elgato Marketplace thumbnail and gallery (1920×960 PNG) from real Deckify UI, checks them, and writes:
 *
 *   upload-ready/   the five images to upload, and nothing else
 *   review/         internal only: contact sheet (full and reduced sizes) and the QA report
 *   out/            intermediate files (git-ignored): bundles, captures, data, reduced-size previews
 *
 *   node scripts/render.mjs            render, check, write (fails without writing upload-ready/ if any check fails)
 *
 * Sources: the key images and titles come from the plugin's own view code (src/key-states.ts); the Setup screens are captured from the
 * real Deckify Setup page served by the plugin's real setup server (src/setup-stage.ts). See README.md.
 */
/* global document, window, NodeFilter, getComputedStyle -- used inside page.evaluate() callbacks, which run in the page */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";

import { loadCatalog } from "../../scripts/profiles.mjs";

const HERE = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(HERE, "..");
const PLUGIN = path.join(ROOT, "com.marting.deckify.sdPlugin");
const OUT = path.join(HERE, "out");
const UPLOAD = path.join(HERE, "upload-ready");
const REVIEW = path.join(HERE, "review");
const WIDTH = 1920;
const HEIGHT = 960;
/** Captures are taken at twice the page's CSS pixels so they stay sharp when scaled onto the canvas. */
const CAPTURE_DSF = 2;

const CHROMIUM = [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find(
	(p) => p && fs.existsSync(p),
);

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. Bundle the plugin code the media is drawn from
// ---------------------------------------------------------------------------------------------------------------------------------

async function bundle(entry) {
	const outfile = path.join(OUT, "build", `${path.basename(entry, ".ts")}.mjs`);
	await esbuild.build({ entryPoints: [path.join(HERE, "src", entry)], bundle: true, format: "esm", platform: "node", outfile, logLevel: "warning" });
	return import(`${outfile}?v=${Date.now()}`);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. Capture the real Deckify Setup
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Captures the union of some elements (plus padding: x, top, bottom) at CAPTURE_DSF, and records the smallest visible text inside it.
 * @returns {Promise<{file: string, width: number, height: number, minTextPx: number, text: string}>}
 */
async function capture(page, id, selectors, pad) {
	await page.mouse.move(1, 1);
	await page.evaluate(() => document.activeElement?.blur());
	await page.waitForTimeout(700);
	const info = await page.evaluate(
		({ selectors, pad }) => {
			const rects = selectors.map((s) => {
				const el = document.querySelector(s);
				if (!el) {
					throw new Error(`Missing element: ${s}`);
				}
				return el.getBoundingClientRect();
			});
			const clip = {
				x: Math.floor(Math.min(...rects.map((r) => r.left)) - pad.x),
				y: Math.floor(Math.min(...rects.map((r) => r.top)) - pad.top),
			};
			clip.width = Math.ceil(Math.max(...rects.map((r) => r.right)) + pad.x - clip.x);
			clip.height = Math.ceil(Math.max(...rects.map((r) => r.bottom)) + pad.bottom - clip.y);
			// Smallest font size of any visible text that falls inside the clip.
			let minTextPx = Infinity;
			const characters = new Map();
			const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
			const visible = [];
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				if (!node.textContent.trim() || !node.parentElement || node.parentElement.closest("[hidden], .sr-only, details:not([open]) > :not(summary)")) {
					continue;
				}
				const range = document.createRange();
				range.selectNodeContents(node);
				const r = range.getBoundingClientRect();
				if (r.width === 0 || r.bottom < clip.y || r.top > clip.y + clip.height || r.right < clip.x || r.left > clip.x + clip.width) {
					continue;
				}
				if (r.left < clip.x || r.right > clip.x + clip.width || r.top < clip.y || r.bottom > clip.y + clip.height) {
					throw new Error(`Text cut by the capture edge: "${node.textContent.trim()}"`);
				}
				visible.push(node.textContent.trim());
				const size = parseFloat(getComputedStyle(node.parentElement).fontSize);
				minTextPx = Math.min(minTextPx, size);
				characters.set(size, (characters.get(size) ?? 0) + node.textContent.trim().length);
			}
			// Body text: the size most of the visible characters use.
			const bodyTextPx = [...characters].sort((a, b) => b[1] - a[1])[0][0];
			return { clip, minTextPx, bodyTextPx, text: visible.join(" ") };
		},
		{ selectors, pad },
	);
	const file = path.join(OUT, "captures", `${id}.png`);
	await page.screenshot({ path: file, clip: info.clip });
	return { file, src: `/out/captures/${id}.png`, width: info.clip.width * CAPTURE_DSF, height: info.clip.height * CAPTURE_DSF, dsf: CAPTURE_DSF, minTextPx: info.minTextPx, bodyTextPx: info.bodyTextPx, text: info.text };
}

async function captureSetup(browser) {
	const { startSetupStage, PLACEHOLDER_CLIENT_ID } = await bundle("setup-stage.ts");
	const stage = await startSetupStage(PLUGIN);
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: CAPTURE_DSF, colorScheme: "dark" });
	const visible = (view) => page.waitForSelector(`[data-view="${view}"]:not([hidden])`);
	const captures = {};
	try {
		await page.goto(stage.url);
		await visible("setup");
		await page.click('[data-view="setup"] [data-action="connect"]');
		await visible("waiting");
		stage.finishSignIn();
		await visible("connected");
		await page.waitForSelector("#success-badge:not([hidden])");
		captures["setup-connected"] = await capture(page, "setup-connected", [".app-bar", "#app"], { x: 32, top: 28, bottom: 16 });

		await page.click("#experience-start");
		await visible("experiences");
		captures["setup-experiences"] = await capture(page, "setup-experiences", ["#app"], { x: 32, top: 14, bottom: 16 });
	} finally {
		await page.close();
		await stage.close();
	}
	for (const [id, c] of Object.entries(captures)) {
		if (c.text.includes(PLACEHOLDER_CLIENT_ID)) {
			throw new Error(`The Client ID is visible in the ${id} capture.`);
		}
	}
	return captures;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. Compose and check
// ---------------------------------------------------------------------------------------------------------------------------------

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };
const MOUNTS = [
	["/compose/", path.join(HERE, "src", "compose")],
	["/out/", OUT],
	["/review/", REVIEW],
	["/upload-ready/", UPLOAD],
	["/plugin/", PLUGIN],
	["/brand/", path.join(ROOT, "assets", "brand")],
	["/fonts/", path.join(HERE, "node_modules", "@fontsource", "inter", "files")],
];

function serve() {
	const server = http.createServer((req, res) => {
		const url = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
		const mount = MOUNTS.find(([prefix]) => url.startsWith(prefix));
		const file = mount && path.resolve(mount[1], url.slice(mount[0].length));
		if (!file || !file.startsWith(mount[1]) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
			res.writeHead(404).end();
			return;
		}
		res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
		fs.createReadStream(file).pipe(res);
	});
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

/** Width and height from a PNG header. */
function pngSize(file) {
	const head = fs.readFileSync(file).subarray(0, 24);
	if (head.toString("latin1", 1, 4) !== "PNG") {
		throw new Error(`${file} is not a PNG.`);
	}
	return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

async function main() {
	if (!CHROMIUM) {
		throw new Error("Chromium not found: set CHROMIUM_PATH.");
	}
	fs.rmSync(OUT, { recursive: true, force: true });
	for (const dir of ["build", "captures", "staging", "previews"]) {
		fs.mkdirSync(path.join(OUT, dir), { recursive: true });
	}

	const { keyStates } = await bundle("key-states.ts");
	const spotifyIcon = `data:image/png;base64,${fs.readFileSync(path.join(PLUGIN, "imgs", "attribution", "Spotify_Primary_Logo_RGB_Green.png")).toString("base64")}`;
	const catalog = loadCatalog();
	const browser = await chromium.launch({ executablePath: CHROMIUM });
	const server = await serve();
	try {
		const captures = await captureSetup(browser);
		const data = {
			keys: keyStates(spotifyIcon),
			actions: Object.fromEntries(Object.entries(catalog.ACTIONS).map(([id, a]) => [id, a.name])),
			layouts: Object.fromEntries(catalog.EXPERIENCES.map((e) => [e.id, e.layout])),
			captures,
		};
		fs.writeFileSync(path.join(OUT, "data.json"), JSON.stringify(data, null, "\t"));

		const { SLIDES } = await import(`${path.join(HERE, "src", "compose", "content.js")}?v=${Date.now()}`);
		const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
		const errors = [];
		page.on("pageerror", (e) => errors.push(e.message));
		const reports = [];
		for (const slide of SLIDES) {
			await page.goto(`${server.origin}/compose/index.html?slide=${slide.id}`);
			const report = await page.evaluate(() => window.__compose);
			if (errors.length > 0) {
				throw new Error(`Page error on ${slide.id}: ${errors.join("; ")}`);
			}
			const file = path.join(OUT, "staging", slide.file);
			await page.screenshot({ path: file, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
			const size = pngSize(file);
			if (size.width !== WIDTH || size.height !== HEIGHT) {
				report.issues.push(`Image is ${size.width}×${size.height}, not ${WIDTH}×${HEIGHT}.`);
			}
			reports.push({ ...report, file: slide.file, kind: slide.kind });
			console.log(`${report.issues.length === 0 ? "✓" : "✗"} ${slide.file}  min text ${report.metrics.minTextPx}px · text↔media gap ${report.metrics.minGapTextToMediaPx}px`);
			report.issues.forEach((issue) => console.log(`    ${issue}`));
		}

		// Reduced-size previews, scaled by the browser the way the Marketplace page scales them.
		const sheet = await browser.newPage({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 });
		for (const r of reports) {
			for (const width of [960, 640, 480]) {
				await sheet.setViewportSize({ width, height: width / 2 });
				await sheet.setContent(`<body style="margin:0;background:#000"><img src="${server.origin}/out/staging/${r.file}" style="display:block;width:${width}px;height:${width / 2}px"></body>`);
				await sheet.waitForFunction(() => document.images[0].complete);
				await sheet.screenshot({ path: path.join(OUT, "previews", r.file.replace(".png", `-${width}.png`)) });
			}
		}

		const failed = reports.filter((r) => r.issues.length > 0);
		writeReport(reports);
		if (failed.length > 0) {
			process.exitCode = 1;
			console.error(`\n${failed.length} image(s) failed QA; upload-ready/ was not updated. See review/qa-report.md.`);
			return;
		}

		fs.rmSync(UPLOAD, { recursive: true, force: true });
		fs.mkdirSync(UPLOAD, { recursive: true });
		for (const r of reports) {
			fs.copyFileSync(path.join(OUT, "staging", r.file), path.join(UPLOAD, r.file));
		}
		await contactSheet(sheet, server.origin, reports);
		console.log(`\nWrote ${reports.length} images to ${path.relative(ROOT, UPLOAD)}/ and the contact sheet to ${path.relative(ROOT, REVIEW)}/.`);
	} finally {
		server.close();
		await browser.close();
	}
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. Internal review material
// ---------------------------------------------------------------------------------------------------------------------------------

function writeReport(reports) {
	fs.mkdirSync(REVIEW, { recursive: true });
	const lines = [
		"# Marketplace media QA report",
		"",
		"Internal review material, generated by `marketplace/scripts/render.mjs`. Not for upload.",
		"",
		"| Image | Result | Smallest copy | Text ↔ media gap | Key size | Capture scale | Capture body text | Smallest capture text |",
		"| --- | --- | --- | --- | --- | --- | --- | --- |",
		...reports.map((r) => {
			const m = r.metrics;
			return `| ${r.file} | ${r.issues.length === 0 ? "pass" : `**fail** (${r.issues.length})`} | ${m.minTextPx}px | ${m.minGapTextToMediaPx}px | ${m.keyPx ? `${m.keyPx}px` : "–"} | ${m.captureScale ?? "–"} | ${m.captureBodyTextPx ? `${m.captureBodyTextPx}px` : "–"} | ${m.captureMinTextPx ? `${m.captureMinTextPx}px` : "–"} |`;
		}),
		"",
		"Sizes are canvas pixels at 1920×960; at the half-size preview (960×480) every number halves.",
		"",
		...reports.flatMap((r) => (r.issues.length === 0 ? [] : [`## ${r.file}`, "", ...r.issues.map((i) => `- ${i}`), ""])),
	];
	fs.writeFileSync(path.join(REVIEW, "qa-report.md"), `${lines.join("\n")}\n`);
}

async function contactSheet(page, origin, reports) {
	const tile = (r, width) =>
		`<figure style="margin:0"><img src="${origin}/upload-ready/${r.file}" style="display:block;width:${width}px;height:${width / 2}px;border-radius:6px;box-shadow:0 0 0 1px #333"><figcaption>${r.file} · ${width}×${width / 2}</figcaption></figure>`;
	const html = `<!DOCTYPE html><html><head><style>
		body{margin:0;padding:40px;background:#e9e9ee;font:500 18px Inter,sans-serif;color:#222;width:2040px}
		h1{font-size:30px;margin:0 0 6px}p{margin:0 0 28px;color:#555}
		h2{font-size:22px;margin:36px 0 16px}
		.row{display:flex;gap:40px;flex-wrap:wrap}
		figcaption{margin-top:8px;font-size:15px;color:#444}
	</style></head><body>
		<h1>Deckify Marketplace media v2: contact sheet</h1>
		<p>Internal review only. Upload the files in marketplace/upload-ready/.</p>
		<h2>Half size (960×480)</h2><div class="row">${reports.map((r) => tile(r, 960)).join("")}</div>
		<h2>Third size (640×320)</h2><div class="row">${reports.map((r) => tile(r, 640)).join("")}</div>
		<h2>Quarter size (480×240): thumbnail grid size</h2><div class="row">${reports.map((r) => tile(r, 480)).join("")}</div>
	</body></html>`;
	await page.setViewportSize({ width: 2120, height: 1000 });
	await page.setContent(html);
	await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({ path: path.join(REVIEW, "contact-sheet.png"), fullPage: true });
}

await main();
