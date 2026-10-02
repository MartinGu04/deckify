/**
 * Exports the Stream Deck-specific image sizes from the original Deckify brand files.
 *
 * The originals in `assets/brand/` are only ever read, never modified. Run with `npm run assets` after adding or updating them.
 *
 *   assets/brand/deckify-icon.png  ->  imgs/plugin/marketplace.png (256x256) + marketplace@2x.png (512x512)
 *                                      imgs/actions/status/deckify.png (72x72) + deckify@2x.png (144x144)
 *
 * The brand artwork itself is not recoloured or redrawn: it is only resized, and for the key image placed on the dark key background.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";

const { values: args } = parseArgs({
	options: {
		"brand-dir": { type: "string", default: "assets/brand" },
		"plugin-dir": { type: "string", default: "com.marting.deckify.sdPlugin" },
	},
});

const brandDir = path.resolve(args["brand-dir"]);
const imgsDir = path.resolve(args["plugin-dir"], "imgs");

/** Background of the Deckify key, matching the dark Deckify interface. */
const KEY_BACKGROUND = "#121212";

/** Portion of the key the icon may occupy; the bottom of the key is left free for the state title. */
const KEY_ICON_SCALE = 0.62;
const KEY_ICON_TOP = 0.1;

const icon = findSource("deckify-icon");
if (icon === undefined) {
	console.error(`No icon found. Add the original Deckify app/plugin icon as ${path.join(brandDir, "deckify-icon.png")} (or .svg / .webp).`);
	process.exit(1);
}

const metadata = await sharp(icon).metadata();
console.log(`Source: ${path.relative(process.cwd(), icon)} (${metadata.width}x${metadata.height}, ${metadata.format}, alpha: ${metadata.hasAlpha})`);
if (!metadata.hasAlpha) {
	console.warn("Warning: the icon has no transparency; its background will be visible on the dark key image.");
}

// Plugin (marketplace) icon: the icon as-is, resized. Stream Deck requires PNG at 256x256, plus @2x.
for (const [size, suffix] of [[256, ""], [512, "@2x"]]) {
	await write(
		sharp(icon).resize(size, size, { fit: "contain", background: transparent() }).png(),
		path.join(imgsDir, "plugin", `marketplace${suffix}.png`),
	);
}

// "Deckify" key state: the icon (trimmed of transparent padding) centred near the top of a dark 72x72 key, plus @2x.
for (const [size, suffix] of [[72, ""], [144, "@2x"]]) {
	const box = Math.round(size * KEY_ICON_SCALE);
	const mark = await sharp(icon).trim().resize(box, box, { fit: "contain", background: transparent() }).png().toBuffer();
	await write(
		sharp({ create: { width: size, height: size, channels: 4, background: KEY_BACKGROUND } })
			.composite([{ input: mark, left: Math.round((size - box) / 2), top: Math.round(size * KEY_ICON_TOP) }])
			.png(),
		path.join(imgsDir, "actions", "status", `deckify${suffix}.png`),
	);
}

// The PNG export supersedes the SVG placeholder; both existing would make the manifest's extension-less image path ambiguous.
removeIfExists(path.join(imgsDir, "actions", "status", "deckify.svg"));

/**
 * Finds a brand source file by base name.
 * @param {string} name Base name of the file.
 * @returns {string | undefined} Path of the file, when found.
 */
function findSource(name) {
	return [".png", ".svg", ".webp"].map((ext) => path.join(brandDir, name + ext)).find((file) => fs.existsSync(file));
}

/**
 * Writes the image to the destination, creating directories as needed.
 * @param {sharp.Sharp} image Image pipeline.
 * @param {string} dest Destination path.
 */
async function write(image, dest) {
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	const info = await image.toFile(dest);
	console.log(`  wrote ${path.relative(process.cwd(), dest)} (${info.width}x${info.height})`);
}

/**
 * Removes the file when it exists.
 * @param {string} file Path of the file.
 */
function removeIfExists(file) {
	if (fs.existsSync(file)) {
		fs.rmSync(file);
		console.log(`  removed placeholder ${path.relative(process.cwd(), file)}`);
	}
}

/**
 * @returns {sharp.RGBA} Fully transparent colour.
 */
function transparent() {
	return { r: 0, g: 0, b: 0, alpha: 0 };
}
