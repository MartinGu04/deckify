/**
 * Writes Deckify's brand masters and every brand image the plugin and the Marketplace listing use, from the approved B1 geometry in
 * `scripts/brand.mjs`. Run with `npm run assets`; `test/brand.test.ts` fails when a committed file differs from this output.
 *
 *   assets/brand/deckify-symbol.svg, deckify-symbol-mono.svg     symbol (violet; one-colour charcoal), transparent
 *   assets/brand/deckify-logo.svg, deckify-logo-on-dark.svg      symbol + DECKIFY, for light / dark backgrounds, transparent
 *   assets/brand/deckify-glyph-20.svg, deckify-glyph-28.svg      pixel-grid glyphs, white on transparent
 *   assets/brand/marketplace/deckify-app-icon-288.png            Marketplace app icon (symbol on the charcoal tile, pixel-fitted)
 *   imgs/plugin/marketplace.png (256) + marketplace@2x.png (512) Stream Deck plugin icon (symbol on the charcoal tile)
 *   imgs/plugin/category-icon.svg                                category icon = deckify-glyph-28.svg
 *   imgs/actions/status/icon.svg                                 Deckify Status action icon = deckify-glyph-20.svg
 *   imgs/actions/status/deckify.png (72) + deckify@2x.png (144)  Deckify Status key image (symbol on the dark key)
 *
 * The development-era artwork in assets/brand/archive/ is never read.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { appIconSvg, brandMasters, glyph20Svg, glyph28Svg, statusKeySvg, tileSvg } from "./brand.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BRAND = path.join(ROOT, "assets", "brand");
const IMGS = path.join(ROOT, "com.marting.deckify.sdPlugin", "imgs");

/**
 * The SVG files written verbatim, by path relative to the repository.
 * @returns {Record<string, string>} File contents.
 */
export function brandSvgFiles() {
	const files = Object.fromEntries(Object.entries(brandMasters()).map(([name, svg]) => [`assets/brand/${name}`, svg]));
	files["com.marting.deckify.sdPlugin/imgs/plugin/category-icon.svg"] = glyph28Svg();
	files["com.marting.deckify.sdPlugin/imgs/actions/status/icon.svg"] = glyph20Svg();
	return files;
}

/**
 * The PNG exports: path relative to the repository → [size, SVG source].
 * @returns {Record<string, [number, string]>} Exports.
 */
export function brandPngFiles() {
	return {
		"assets/brand/marketplace/deckify-app-icon-288.png": [288, appIconSvg(288)],
		"com.marting.deckify.sdPlugin/imgs/plugin/marketplace.png": [256, tileSvg(256)],
		"com.marting.deckify.sdPlugin/imgs/plugin/marketplace@2x.png": [512, tileSvg(512)],
		"com.marting.deckify.sdPlugin/imgs/actions/status/deckify.png": [72, statusKeySvg(72)],
		"com.marting.deckify.sdPlugin/imgs/actions/status/deckify@2x.png": [144, statusKeySvg(144)],
	};
}

if (import.meta.main) {
	for (const [file, svg] of Object.entries(brandSvgFiles())) {
		const dest = path.join(ROOT, file);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, svg);
		console.log(`  wrote ${file}`);
	}
	for (const [file, [size, svg]] of Object.entries(brandPngFiles())) {
		const dest = path.join(ROOT, file);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		const info = await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(dest);
		console.log(`  wrote ${file} (${info.width}x${info.height})`);
	}
	if (!fs.existsSync(BRAND) || !fs.existsSync(IMGS)) {
		throw new Error("Unexpected repository layout.");
	}
}
