/**
 * Builds the distributable dist/com.marting.deckify.streamDeckPlugin.
 *
 * On Windows the Windows media bridge helper is built (Rust) and bundled into bin/native/, and the package is verified to contain it.
 * Elsewhere the package is built without it (Deckify then uses the Spotify Web API for commands).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildNative } from "./native.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE = path.join(ROOT, "dist", "com.marting.deckify.streamDeckPlugin");
const HELPER_ENTRY = "com.marting.deckify.sdPlugin/bin/native/deckify-media-bridge.exe";
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

	const entries = listZipEntries(readFileSync(PACKAGE));
	if (!entries.includes("com.marting.deckify.sdPlugin/bin/plugin.js") || !entries.includes("com.marting.deckify.sdPlugin/manifest.json")) {
		console.error("The package is missing the plugin code or manifest.");
		process.exit(1);
	}
	const missing = manifestFiles(JSON.parse(readFileSync(MANIFEST, "utf8"))).filter(
		(file) => !(file.endsWith(".html") ? [file] : [`${file}.svg`, `${file}.png`]).some((candidate) => entries.includes(`com.marting.deckify.sdPlugin/${candidate}`)),
	);
	if (missing.length > 0) {
		console.error(`The package is missing files the manifest references: ${missing.join(", ")}`);
		process.exit(1);
	}
	if (withNative && !entries.includes(HELPER_ENTRY)) {
		console.error(`The package does not contain ${HELPER_ENTRY}.`);
		process.exit(1);
	}
	console.log(withNative ? `Verified: package includes ${HELPER_ENTRY}` : "Note: package built without the Windows media bridge (not built on Windows).");
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
