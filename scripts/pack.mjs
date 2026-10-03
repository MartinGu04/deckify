/**
 * Builds the distributable dist/com.marting.deckify.streamDeckPlugin.
 *
 * On Windows the Windows media bridge helper is built (Rust) and bundled into bin/native/, and the package is verified to contain it.
 * Elsewhere the package is built without it (Deckify then uses the Spotify Web API for commands).
 *
 * Deckify's bundled Stream Deck profiles (the experiences) are checked before packing (they must be real exports matching their layouts,
 * with no personal data; see scripts/profiles.mjs), and the package must contain exactly the profiles the manifest declares.
 *
 * The package is a release build: it is packed from a staged copy of the plugin whose manifest has no `Nodejs.Debug` option, so Stream Deck
 * never starts the released plugin with a Node.js inspector. The committed manifest keeps `"enabled"` for local development, and is never
 * modified. The manifest inside the finished package is read back and checked.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

import { keyIconFiles } from "./export-key-icons.mjs";
import { buildNative } from "./native.mjs";
import { checkBundledProfiles, PROFILE_EXTENSION } from "./profiles.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PLUGIN_FOLDER = "com.marting.deckify.sdPlugin";
const PACKAGE_NAME = "com.marting.deckify.streamDeckPlugin";
const HELPER_ENTRY = `${PLUGIN_FOLDER}/bin/native/deckify-media-bridge.exe`;
/** Where the manifest sits inside the package. */
export const MANIFEST_ENTRY = `${PLUGIN_FOLDER}/manifest.json`;

/** Spotify's official full logo, shown next to the Spotify playlist information in the playlist picker (Spotify's attribution rules). */
export const SPOTIFY_LOGO = "ui/playlist/Spotify_Full_Logo_RGB_White.png";

/** Spotify's official icon, which the Now Playing key draws next to Spotify metadata (read at runtime, not referenced by the manifest). */
export const SPOTIFY_ICON = "imgs/attribution/Spotify_Primary_Logo_RGB_Green.png";

/** Files the manifest does not reference but the Property Inspectors and the Deckify Setup App load. */
const INSPECTOR_FILES = [
	"ui/shared/inspector.css",
	"ui/shared/onboarding.js",
	"ui/setup/experiences.js",
	"ui/spotify-account/inspector.js",
	"ui/spotify-account/account.css",
	"ui/setup/index.html",
	"ui/setup/setup.css",
	"ui/setup/setup.js",
	"ui/setup/icon.svg",
	"ui/volume/inspector.js",
	"ui/playlist/paging.js",
	"ui/playlist/inspector.js",
	"ui/playlist/playlist.css",
	SPOTIFY_LOGO,
];
const MANIFEST = path.join(ROOT, PLUGIN_FOLDER, "manifest.json");

/**
 * Runs an npm script / CLI from node_modules/.bin without a shell.
 * @param {string} command Command.
 * @param {string[]} args Arguments.
 * @param {"inherit" | "ignore"} [stdio] Output handling.
 */
function run(command, args, stdio = "inherit") {
	const result = spawnSync(process.execPath, [command, ...args], { cwd: ROOT, stdio, shell: false });
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
	const profileProblems = checkBundledProfiles(JSON.parse(readFileSync(MANIFEST, "utf8")));
	if (profileProblems.length > 0) {
		for (const problem of profileProblems) {
			console.error(problem);
		}
		process.exit(1);
	}
	const withNative = buildNative();
	run(path.join(ROOT, "node_modules", "rollup", "dist", "bin", "rollup"), ["-c"]);
	const packageFile = packRelease();

	const zip = readFileSync(packageFile);
	const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
	const problems = [
		...verifyPackageEntries(listZipEntries(zip), manifest, withNative),
		...verifyPackagedManifest(JSON.parse(readZipEntry(zip, MANIFEST_ENTRY).toString("utf8")), manifest),
	];
	if (problems.length > 0) {
		for (const problem of problems) {
			console.error(problem);
		}
		process.exit(1);
	}
	console.log("Verified: the packaged manifest does not enable Node.js debugging.");
	console.log(withNative ? `Verified: package includes ${HELPER_ENTRY}` : "Note: package built without the Windows media bridge (not built on Windows).");
}

/**
 * Packs a plugin folder as a release: from a temporary copy (without logs) whose manifest is {@link releaseManifest}. The plugin folder
 * itself is never modified.
 * @param {object} [options] Options.
 * @param {string} [options.pluginDir] The plugin folder to pack (its code must already be built).
 * @param {string} [options.outputDir] Where the package is written.
 * @param {boolean} [options.quiet] Hide the Stream Deck CLI's output.
 * @returns {string} Path of the package.
 */
export function packRelease({ pluginDir = path.join(ROOT, PLUGIN_FOLDER), outputDir = path.join(ROOT, "dist"), quiet = false } = {}) {
	const stage = mkdtempSync(path.join(tmpdir(), "deckify-pack-"));
	try {
		const staged = path.join(stage, PLUGIN_FOLDER);
		cpSync(pluginDir, staged, { recursive: true, filter: (source) => path.relative(pluginDir, source).split(path.sep)[0] !== "logs" });
		const manifest = JSON.parse(readFileSync(path.join(pluginDir, "manifest.json"), "utf8"));
		writeFileSync(path.join(staged, "manifest.json"), `${JSON.stringify(releaseManifest(manifest), null, "\t")}\n`);
		run(path.join(ROOT, "node_modules", "@elgato", "cli", "bin", "streamdeck.mjs"), ["pack", staged, "--output", outputDir, "--force", "--no-update-check"], quiet ? "ignore" : "inherit");
	} finally {
		rmSync(stage, { recursive: true, force: true });
	}
	return path.join(outputDir, PACKAGE_NAME);
}

/**
 * The manifest a release package ships: the committed manifest without `Nodejs.Debug`, so Stream Deck runs the plugin without a Node.js
 * inspector. Everything else (version, author, UUIDs, actions, profiles) is unchanged.
 * @param {Record<string, unknown>} manifest The committed manifest.
 * @returns {Record<string, unknown>} The release manifest.
 */
export function releaseManifest(manifest) {
	const nodejs = /** @type {Record<string, unknown>} */ ({ ...(/** @type {object} */ (manifest.Nodejs) ?? {}) });
	delete nodejs.Debug;
	return { ...manifest, Nodejs: nodejs };
}

/**
 * Checks the manifest inside a package: no Node.js debugging, and otherwise the committed manifest.
 * @param {Record<string, unknown>} packaged The manifest read from the package.
 * @param {Record<string, unknown>} committed The committed manifest.
 * @returns {string[]} What is wrong.
 */
export function verifyPackagedManifest(packaged, committed) {
	const problems = [];
	const debug = /** @type {Record<string, unknown> | undefined} */ (packaged.Nodejs)?.Debug;
	if (debug !== undefined && debug !== "disabled") {
		problems.push(`The packaged manifest enables Node.js debugging (Nodejs.Debug: ${JSON.stringify(debug)}).`);
	}
	if (JSON.stringify(releaseManifest(packaged)) !== JSON.stringify(releaseManifest(committed))) {
		problems.push("The packaged manifest differs from the committed manifest (other than Nodejs.Debug).");
	}
	return problems;
}

/**
 * Checks a package's file list.
 * @param {string[]} entries ZIP entry names.
 * @param {Record<string, unknown>} manifest Parsed manifest.
 * @param {boolean} withNative Whether the Windows media bridge must be included.
 * @returns {string[]} What is wrong (empty when the package is complete).
 */
export function verifyPackageEntries(entries, manifest, withNative) {
	if (!entries.includes(`${PLUGIN_FOLDER}/bin/plugin.js`) || !entries.includes(MANIFEST_ENTRY)) {
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
	problems.push(...verifyProfileEntries(entries, manifest));
	if (withNative && !entries.includes(HELPER_ENTRY)) {
		problems.push(`The package does not contain ${HELPER_ENTRY}.`);
	}
	return problems;
}

/**
 * Checks that a package contains exactly the Stream Deck profiles the manifest declares (no development or test profiles).
 * @param {string[]} entries ZIP entry names.
 * @param {Record<string, unknown>} manifest Parsed manifest.
 * @returns {string[]} What is wrong.
 */
export function verifyProfileEntries(entries, manifest) {
	const declared = (Array.isArray(manifest.Profiles) ? manifest.Profiles : []).map((profile) => `com.marting.deckify.sdPlugin/${String(profile.Name)}${PROFILE_EXTENSION}`);
	const problems = [];
	const missing = declared.filter((entry) => !entries.includes(entry));
	if (missing.length > 0) {
		problems.push(`The package is missing bundled profiles the manifest declares: ${missing.join(", ")}`);
	}
	const extra = entries.filter((entry) => entry.endsWith(PROFILE_EXTENSION) && !declared.includes(entry));
	if (extra.length > 0) {
		problems.push(`The package contains profiles the manifest does not declare: ${extra.join(", ")}`);
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
	return zipDirectory(zip).map((entry) => entry.name);
}

/**
 * Reads one file from a ZIP archive (stored or deflated).
 * @param {Buffer} zip Archive bytes.
 * @param {string} name Entry name.
 * @returns {Buffer} The file's bytes.
 */
export function readZipEntry(zip, name) {
	const entry = zipDirectory(zip).find((candidate) => candidate.name === name);
	if (entry === undefined) {
		throw new Error(`The archive has no ${name}.`);
	}
	const { localOffset, method, compressedSize } = entry;
	if (zip.readUInt32LE(localOffset) !== 0x04034b50) {
		throw new Error("Corrupt ZIP local header.");
	}
	const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
	const data = zip.subarray(start, start + compressedSize);
	switch (method) {
		case 0:
			return Buffer.from(data);
		case 8:
			return inflateRawSync(data);
		default:
			throw new Error(`Unsupported ZIP compression method ${String(method)}.`);
	}
}

/**
 * Reads a ZIP archive's central directory.
 * @param {Buffer} zip Archive bytes.
 * @returns {{ name: string, method: number, compressedSize: number, localOffset: number }[]} Entries.
 */
function zipDirectory(zip) {
	const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (eocd < 0) {
		throw new Error("Not a ZIP archive.");
	}
	const count = zip.readUInt16LE(eocd + 10);
	let offset = zip.readUInt32LE(eocd + 16);
	const entries = [];
	for (let i = 0; i < count; i++) {
		if (zip.readUInt32LE(offset) !== 0x02014b50) {
			throw new Error("Corrupt ZIP central directory.");
		}
		const nameLength = zip.readUInt16LE(offset + 28);
		const extraLength = zip.readUInt16LE(offset + 30);
		const commentLength = zip.readUInt16LE(offset + 32);
		entries.push({
			name: zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replaceAll("\\", "/"),
			method: zip.readUInt16LE(offset + 10),
			compressedSize: zip.readUInt32LE(offset + 20),
			localOffset: zip.readUInt32LE(offset + 42),
		});
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
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
