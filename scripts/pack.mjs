/**
 * Builds the distributable dist/com.marting.deckify.streamDeckPlugin.
 *
 * On Windows the Windows media bridge helper is built (Rust) and bundled into bin/native/, and the package is verified to contain it.
 * Elsewhere the package is built without it (Deckify then uses the Spotify Web API for commands).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { keyIconFiles } from "./export-key-icons.mjs";
import { buildNative } from "./native.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE = path.join(ROOT, "dist", "com.marting.deckify.streamDeckPlugin");
const HELPER_ENTRY = "com.marting.deckify.sdPlugin/bin/native/deckify-media-bridge.exe";

/** Spotify's official full logo, shown next to the Spotify playlist information in the playlist picker (Spotify's attribution rules). */
export const SPOTIFY_LOGO = "ui/playlist/Spotify_Full_Logo_RGB_White.png";

/** Spotify's official icon, which the Now Playing key draws next to Spotify metadata (read at runtime, not referenced by the manifest). */
export const SPOTIFY_ICON = "imgs/attribution/Spotify_Primary_Logo_RGB_Green.png";

/** Files the manifest does not reference but the Property Inspectors load. */
const INSPECTOR_FILES = [
	"ui/shared/inspector.css",
	"ui/spotify-account/inspector.js",
	"ui/volume/inspector.js",
	"ui/playlist/paging.js",
	"ui/playlist/inspector.js",
	"ui/playlist/playlist.css",
	SPOTIFY_LOGO,
];
const MANIFEST = path.join(ROOT, "com.marting.deckify.sdPlugin", "manifest.json");

/**
 * Runs an npm script / CLI from node_modules/.bin without a shell.
 * @param {string} command Command.
 * @param {string[]} args Arguments.
 */
function run(command, args) {
	const result = spawnSync(process.execPath, [command, ...args], { cwd: ROOT, stdio: "inherit", shell: false });
	if (result.status !== 0) {
		throw new CommandFailedError(result.status ?? 1);
	}
}

class CommandFailedError extends Error {
	/** @param {number} status Exit status. */
	constructor(status) {
		super(`Command failed with exit status ${String(status)}.`);
		this.status = status;
	}
}

/**
 * Builds, packs and verifies the package.
 */
function pack() {
	const withNative = buildNative();
	run(path.join(ROOT, "node_modules", "rollup", "dist", "bin", "rollup"), ["-c"]);
	// `streamdeck pack` rewrites manifest.json (dropping its final newline); put the committed bytes back afterwards.
	const manifest = readFileSync(MANIFEST);
	try {
		run(path.join(ROOT, "node_modules", "@elgato", "cli", "bin", "streamdeck.mjs"), ["pack", "com.marting.deckify.sdPlugin", "--output", "dist", "--force"]);
	} finally {
		writeFileSync(MANIFEST, manifest);
	}

	const problems = verifyPackageEntries(listZipEntries(readFileSync(PACKAGE)), JSON.parse(readFileSync(MANIFEST, "utf8")), withNative);
	if (problems.length > 0) {
		for (const problem of problems) {
			console.error(problem);
		}
		process.exit(1);
	}
	console.log(withNative ? `Verified: package includes ${HELPER_ENTRY}` : "Note: package built without the Windows media bridge (not built on Windows).");
}

/**
 * Checks a package's file list.
 * @param {string[]} entries ZIP entry names.
 * @param {Record<string, unknown>} manifest Parsed manifest.
 * @param {boolean} withNative Whether the Windows media bridge must be included.
 * @returns {string[]} What is wrong (empty when the package is complete).
 */
export function verifyPackageEntries(entries, manifest, withNative) {
	if (!entries.includes("com.marting.deckify.sdPlugin/bin/plugin.js") || !entries.includes("com.marting.deckify.sdPlugin/manifest.json")) {
		return ["The package is missing the plugin code or manifest."];
	}
	const problems = [];
	const missing = manifestFiles(manifest).filter(
		(file) => !(file.endsWith(".html") ? [file] : [`${file}.svg`, `${file}.png`]).some((candidate) => entries.includes(`com.marting.deckify.sdPlugin/${candidate}`)),
	);
	// Key images set at runtime (e.g. "Added") and the Property Inspectors' scripts, styles and images are not in the manifest.
	missing.push(...requiredFiles().filter((file) => !entries.includes(`com.marting.deckify.sdPlugin/${file}`)));
	if (missing.length > 0) {
		problems.push(`The package is missing files the plugin uses: ${missing.join(", ")}`);
	}
	if (withNative && !entries.includes(HELPER_ENTRY)) {
		problems.push(`The package does not contain ${HELPER_ENTRY}.`);
	}
	return problems;
}

/**
 * Lists plugin-relative files the plugin needs that the manifest does not reference: every generated key image, the Spotify icon
 * Now Playing draws, and the Property Inspectors' scripts, styles and images.
 * @returns {string[]} Plugin-relative paths.
 */
export function requiredFiles() {
	return [...Object.keys(keyIconFiles()).map((file) => `imgs/actions/${file}`), SPOTIFY_ICON, ...INSPECTOR_FILES];
}

/**
 * Lists the images (without extension) and Property Inspector pages the manifest references.
 * @param {Record<string, unknown>} manifest Parsed manifest.
 * @returns {string[]} Plugin-relative paths.
 */
export function manifestFiles(manifest) {
	const files = [manifest.Icon, manifest.CategoryIcon];
	for (const action of Array.isArray(manifest.Actions) ? manifest.Actions : []) {
		files.push(action.Icon, action.PropertyInspectorPath, ...(Array.isArray(action.States) ? action.States.map((state) => state.Image) : []));
	}
	return [...new Set(files.filter((file) => typeof file === "string"))];
}

/**
 * Lists the file names in a ZIP archive (central directory).
 * @param {Buffer} zip Archive bytes.
 * @returns {string[]} Entry names.
 */
export function listZipEntries(zip) {
	const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (eocd < 0) {
		throw new Error("Not a ZIP archive.");
	}
	const count = zip.readUInt16LE(eocd + 10);
	let offset = zip.readUInt32LE(eocd + 16);
	const names = [];
	for (let i = 0; i < count; i++) {
		if (zip.readUInt32LE(offset) !== 0x02014b50) {
			throw new Error("Corrupt ZIP central directory.");
		}
		const nameLength = zip.readUInt16LE(offset + 28);
		const extraLength = zip.readUInt16LE(offset + 30);
		const commentLength = zip.readUInt16LE(offset + 32);
		names.push(zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replaceAll("\\", "/"));
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return names;
}

if (import.meta.main) {
	try {
		pack();
	} catch (err) {
		if (!(err instanceof CommandFailedError)) {
			throw err;
		}
		process.exitCode = err.status;
	}
}
