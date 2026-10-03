import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { DECKIFY_VIOLET } from "../src/shared/brand";
// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as brandScript from "../scripts/brand.mjs";
// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as exportScript from "../scripts/export-brand-assets.mjs";
// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as packScript from "../scripts/pack.mjs";

const brand = brandScript as {
	VIOLET: string;
	CHARCOAL: string;
	KEY_BACKGROUND: string;
	D_OUTER: string;
	D_COUNTER: string;
	brandMasters: () => Record<string, string>;
};
const exports = exportScript as { brandSvgFiles: () => Record<string, string>; brandPngFiles: () => Record<string, [number, string]> };
const pack = packScript as { requiredFiles: () => string[] };

const ROOT = path.resolve(import.meta.dirname, "..");
const ARCHIVE = path.join(ROOT, "assets", "brand", "archive", "development-era");
const read = (file: string) => readFile(path.join(ROOT, file), "utf8").then((text) => text.replaceAll("\r\n", "\n"));
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** Every file under a directory, relative to the repository. */
async function files(dir: string): Promise<string[]> {
	const entries = await readdir(path.join(ROOT, dir), { recursive: true, withFileTypes: true });
	return entries.filter((entry) => entry.isFile()).map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
}

/** The RGBA pixel at a position of a PNG. */
async function pixel(file: string, x: number, y: number): Promise<number[]> {
	const { data, info } = await sharp(path.join(ROOT, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	const offset = (Math.round(y) * info.width + Math.round(x)) * 4;
	return [...data.subarray(offset, offset + 4)];
}

const hex = (colour: string) => [1, 3, 5].map((i) => Number.parseInt(colour.slice(i, i + 2), 16));
const close = (rgba: number[], colour: string) => hex(colour).every((value, i) => Math.abs(value - (rgba[i] ?? -999)) <= 6) && rgba[3] === 255;

describe("Deckify brand (B1 · Frame D)", () => {
	it("keeps every committed brand SVG in sync with scripts/brand.mjs", async () => {
		for (const [file, svg] of Object.entries(exports.brandSvgFiles())) {
			expect(await read(file), file).toBe(svg);
		}
		expect(Object.keys(brand.brandMasters()).sort()).toEqual(
			["deckify-glyph-20.svg", "deckify-glyph-28.svg", "deckify-logo-on-dark.svg", "deckify-logo.svg", "deckify-symbol-mono.svg", "deckify-symbol.svg"].sort(),
		);
	});

	it("uses the approved B1 geometry and Deckify violet", async () => {
		expect(brand.VIOLET).toBe("#7C5CFF");
		expect(DECKIFY_VIOLET).toBe(brand.VIOLET);
		const symbol = await read("assets/brand/deckify-symbol.svg");
		expect(symbol).toContain(`d="${brand.D_OUTER} ${brand.D_COUNTER}"`);
		expect(symbol.match(/<rect [^>]*width="15.75" height="15.75" rx="3.4"/g)).toHaveLength(4);
		expect(new Set(symbol.match(/#[0-9A-F]{6}/gi))).toEqual(new Set(["#7C5CFF"]));
		for (const logo of ["assets/brand/deckify-logo.svg", "assets/brand/deckify-logo-on-dark.svg"]) {
			expect(await read(logo)).toContain(`d="${brand.D_OUTER} ${brand.D_COUNTER}"`);
		}
		// The mono mark is one colour, with no background.
		expect(new Set((await read("assets/brand/deckify-symbol-mono.svg")).match(/#[0-9A-F]{6}/gi))).toEqual(new Set([brand.CHARCOAL]));
	});

	it("exports the plugin icon, Marketplace app icon and Status key from the B1 symbol at the required sizes", async () => {
		const pngs = exports.brandPngFiles();
		expect(Object.keys(pngs).sort()).toEqual(
			[
				"assets/brand/marketplace/deckify-app-icon-288.png",
				"com.marting.deckify.sdPlugin/imgs/actions/status/deckify.png",
				"com.marting.deckify.sdPlugin/imgs/actions/status/deckify@2x.png",
				"com.marting.deckify.sdPlugin/imgs/plugin/marketplace.png",
				"com.marting.deckify.sdPlugin/imgs/plugin/marketplace@2x.png",
			].sort(),
		);
		for (const [file, [size]] of Object.entries(pngs)) {
			const meta = await sharp(path.join(ROOT, file)).metadata();
			expect([meta.format, meta.width, meta.height], file).toEqual(["png", size, size]);
			if (file.includes("status/deckify")) {
				// Dark key with the violet D stem.
				expect(close(await pixel(file, size * 0.04, size * 0.96), brand.KEY_BACKGROUND), file).toBe(true);
				expect(close(await pixel(file, size * 0.24, size * 0.41), brand.VIOLET), file).toBe(true);
			} else {
				// Charcoal tile with rounded (transparent) corners and the violet D stem.
				expect((await pixel(file, 1, 1))[3], file).toBe(0);
				expect(close(await pixel(file, size * 0.12, size * 0.5), brand.CHARCOAL), file).toBe(true);
				expect(close(await pixel(file, size * 0.24, size * 0.5), brand.VIOLET), file).toBe(true);
			}
		}
	});

	it("uses the pixel-grid glyphs, monochrome white on transparent, for the category and Status action icons", async () => {
		expect(await read("com.marting.deckify.sdPlugin/imgs/plugin/category-icon.svg")).toBe(await read("assets/brand/deckify-glyph-28.svg"));
		expect(await read("com.marting.deckify.sdPlugin/imgs/actions/status/icon.svg")).toBe(await read("assets/brand/deckify-glyph-20.svg"));
		for (const [file, size] of [
			["assets/brand/deckify-glyph-20.svg", 20],
			["assets/brand/deckify-glyph-28.svg", 28],
		] as const) {
			const svg = await read(file);
			expect(svg).toContain(`width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}"`);
			expect(new Set(svg.match(/#[0-9A-F]{6}/gi))).toEqual(new Set(["#FFFFFF"]));
			// No background shape: nothing covers the whole canvas.
			expect(svg).not.toMatch(new RegExp(`<rect [^>]*width="${String(size)}"`));
			// Every key edge on a whole pixel.
			for (const match of svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
				expect(match.slice(1, 5).every((value) => Number.isInteger(Number(value))), match[0]).toBe(true);
			}
		}
	});

	it("keeps Deckify violet in the runtime artwork and Property Inspectors", async () => {
		expect(await read("com.marting.deckify.sdPlugin/ui/shared/inspector.css")).toContain("--accent: #7c5cff;");
		expect(await read("src/actions/now-playing-render.ts")).toContain("const ACCENT = DECKIFY_VIOLET;");
		expect(await read("src/spotify/auth/callback-page.ts")).toContain("success: DECKIFY_VIOLET,");
	});
});

describe("retired development-era artwork", () => {
	it("is archived, documented and unchanged in content", async () => {
		expect((await files("assets/brand/archive/development-era")).sort()).toEqual(
			[
				"assets/brand/archive/development-era/README.md",
				"assets/brand/archive/development-era/deckify-icon.png",
				"assets/brand/archive/development-era/deckify-logo.png",
			].sort(),
		);
		expect((await files("assets/brand")).filter((f) => /deckify-(icon|logo)\.png$/.test(f) && !f.includes("/archive/"))).toEqual([]);
	});

	it("is not referenced by the plugin, its scripts, the README or the docs media", async () => {
		const scanned = [
			...(await files("com.marting.deckify.sdPlugin")).filter((f) => /\.(json|svg|html|css|js)$/.test(f) && !f.includes("/bin/")),
			...(await files("src")),
			...(await files("scripts")),
			...(await files("docs/media")).filter((f) => !f.endsWith(".png")),
			"README.md",
		];
		for (const file of scanned) {
			expect(await read(file), file).not.toMatch(/deckify-(icon|logo)\.png|archive\/development-era/);
		}
	});

	it("is never copied into the plugin (so it can't be packaged)", async () => {
		const archived = new Set(await Promise.all(["deckify-icon.png", "deckify-logo.png"].map(async (f) => sha256(await readFile(path.join(ARCHIVE, f))))));
		for (const file of await files("com.marting.deckify.sdPlugin")) {
			expect(archived.has(sha256(await readFile(path.join(ROOT, file)))), file).toBe(false);
			expect(file).not.toMatch(/archive|deckify-(icon|logo|symbol|glyph)/);
		}
	});
});

describe("old green accent", () => {
	it("is gone from Deckify-owned production files", async () => {
		const scanned = [
			...(await files("com.marting.deckify.sdPlugin")).filter((f) => /\.(json|svg|html|css|js)$/.test(f) && !f.includes("/bin/")),
			...(await files("src")),
			...(await files("scripts")),
			...(await files("assets/brand")).filter((f) => f.endsWith(".svg") || f.endsWith(".md")),
			...(await files("docs/media")).filter((f) => f.endsWith(".svg")),
			"README.md",
		].filter((f) => !f.includes("/archive/"));
		for (const file of scanned) {
			expect(await read(file), file).not.toMatch(/22D46E|0D2A19/i);
		}
	});

	it("exempts Spotify's own attribution files, which stay byte-for-byte unchanged", async () => {
		const official = {
			"com.marting.deckify.sdPlugin/imgs/attribution/Spotify_Primary_Logo_RGB_Green.png": "193ef6f3d236da9a1e1e2991bf44a75a082fb3c99255c9eec9b47ea5f66413f1",
			"com.marting.deckify.sdPlugin/ui/playlist/Spotify_Full_Logo_RGB_White.png": "14a6a4faf018cf8b2f46a35a272db84b3d6b61a094707f225eb0106ea90ef979",
		};
		for (const [file, hash] of Object.entries(official)) {
			expect(sha256(await readFile(path.join(ROOT, file))), file).toBe(hash);
		}
	});
});

describe("brand files in the package", () => {
	it("ships only the brand exports the plugin uses", async () => {
		expect((await files("com.marting.deckify.sdPlugin/imgs/plugin")).sort()).toEqual(
			[
				"com.marting.deckify.sdPlugin/imgs/plugin/category-icon.svg",
				"com.marting.deckify.sdPlugin/imgs/plugin/marketplace.png",
				"com.marting.deckify.sdPlugin/imgs/plugin/marketplace@2x.png",
			].sort(),
		);
		expect((await files("com.marting.deckify.sdPlugin/imgs/actions/status")).sort()).toEqual(
			[
				"com.marting.deckify.sdPlugin/imgs/actions/status/deckify.png",
				"com.marting.deckify.sdPlugin/imgs/actions/status/deckify@2x.png",
				"com.marting.deckify.sdPlugin/imgs/actions/status/icon.svg",
				"com.marting.deckify.sdPlugin/imgs/actions/status/ready.svg",
			].sort(),
		);
		// Masters and Marketplace artwork stay outside the plugin folder, so `npm run pack` never includes them.
		expect(pack.requiredFiles().filter((f) => /assets\/|marketplace\/|deckify-(symbol|logo|glyph)/.test(f))).toEqual([]);
	});
});
