/**
 * Deckify's bundled Stream Deck profiles (the two experiences): checks real `.streamDeckProfile` exports and installs them into the plugin.
 *
 * Profiles are made in the Stream Deck app and exported from there (Elgato's documented workflow); this script never writes a profile. It
 * only reads an export to check that it is safe and that it matches the layout Deckify Setup previews. An export is a ZIP archive with the
 * structure the Stream Deck app (7.x, profile version 3.0) writes:
 *
 *   package.json                                      app version, device model, RequiredPlugins
 *   Profiles/<PROFILE>.sdProfile/manifest.json        the profile: Name, Device, Pages { Default, Pages[] }
 *   Profiles/<PROFILE>.sdProfile/Profiles/<PAGE>/manifest.json
 *                                                     a page: Controllers[{ Type: "Keypad", Actions: { "column,row": action } | null }]
 *   …/Images/                                         (empty folders; any file in them is rejected)
 *
 * The checks: Deckify is the only required plugin; one profile, named as the manifest names it; exactly one page with keys, whose keys
 * are exactly the experience's layout (ui/setup/experiences.js) with Deckify actions only; no settings except a volume step, no custom
 * titles or images; and no personal data anywhere (playlists, Spotify links or IDs, Client ID- or token-shaped values, emails, user paths).
 *
 *   npm run profiles:check                         check every profile the manifest declares
 *   npm run profiles:import -- <experience> <file> check an export, then copy it to the path the manifest declares
 *   npm run profiles:layouts                       print the layouts to build in the Stream Deck app
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import vm from "node:vm";
import { inflateRawSync } from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "..");
export const PLUGIN_DIR = path.join(ROOT, "com.marting.deckify.sdPlugin");
export const PROFILE_EXTENSION = ".streamDeckProfile";
const PLUGIN_UUID = "com.marting.deckify";

/**
 * Experience → manifest profile name; must equal `EXPERIENCE_PROFILES` in src/experiences/experiences.ts (a test compares them). The file
 * name is the name of the real export, which is also the profile's name inside it.
 */
export const EXPERIENCE_PROFILES = Object.freeze({
	deckify: "profiles/DECKIFY ⭐ Recommended",
	simple: "profiles/SIMPLE",
});

/** Settings a bundled key may carry. Every other key must start with no settings at all. */
const ALLOWED_SETTINGS = Object.freeze({
	"com.marting.deckify.spotify.volume-up": (settings) => isVolumeStep(settings),
	"com.marting.deckify.spotify.volume-down": (settings) => isVolumeStep(settings),
});

/** Text that must never appear anywhere in a bundled profile. */
const PERSONAL_DATA = Object.freeze([
	[/spotify:(playlist|track|album|artist|user|episode|show):/i, "a Spotify URI"],
	[/open\.spotify\.com/i, "a Spotify link"],
	[/"playlist(Id|Uri|Name)"/i, "a playlist selection"],
	[/(?<![0-9a-f-])[0-9a-f]{32}(?![0-9a-f-])/i, "a 32-character hex value (Client ID-shaped)"],
	[/\b(BQ|AQ)[\w-]{40,}/, "a token-shaped value"],
	[/[A-Za-z]:\\{1,2}Users\\{1,2}|\/Users\/|\/home\//, "a user folder path"],
	[/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, "an email address"],
]);

const PACKAGE = "package.json";
const PROFILE_MANIFEST = /^Profiles\/([^/]+)\.sdProfile\/manifest\.json$/;
const PAGE_MANIFEST = /^Profiles\/([^/]+)\.sdProfile\/Profiles\/([^/]+)\/manifest\.json$/;

/**
 * Loads the experience layouts the Setup App previews (ui/setup/experiences.js), without a browser.
 * @returns {{ACTIONS: Record<string, {name: string, uuid: string}>, EXPERIENCES: {id: string, label: string, layout: (string | null)[][]}[], COLUMNS: number, ROWS: number}} The catalog.
 */
export function loadCatalog() {
	const sandbox = {};
	sandbox.globalThis = sandbox;
	vm.runInNewContext(readFileSync(path.join(PLUGIN_DIR, "ui", "setup", "experiences.js"), "utf8"), sandbox);
	return sandbox.DeckifyExperiences;
}

/**
 * The keys an experience's profile must have.
 * @param {ReturnType<typeof loadCatalog>} catalog Catalog.
 * @param {string} id Experience ID.
 * @returns {Map<string, string>} "column,row" → action UUID.
 */
export function expectedKeys(catalog, id) {
	const experience = catalog.EXPERIENCES.find((candidate) => candidate.id === id);
	if (!experience) {
		throw new Error(`Unknown experience "${id}".`);
	}
	const keys = new Map();
	experience.layout.forEach((row, rowIndex) =>
		row.forEach((key, column) => {
			if (key !== null) {
				keys.set(`${column},${rowIndex}`, catalog.ACTIONS[key].uuid);
			}
		}),
	);
	return keys;
}

/**
 * The profile name an experience's export must carry (shown in the Stream Deck app): the file name of its manifest entry.
 * @param {string} id Experience ID.
 * @returns {string} The name.
 */
export function profileName(id) {
	return path.posix.basename(EXPERIENCE_PROFILES[id]);
}

/**
 * Reads the files of a ZIP archive (stored or deflated entries; what Stream Deck exports).
 * @param {Buffer} zip Archive bytes.
 * @returns {{name: string, data: Buffer}[]} The files (directories omitted).
 */
export function readZip(zip) {
	const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (eocd < 0 || eocd + 22 > zip.length) {
		throw new Error("not a ZIP archive");
	}
	const count = zip.readUInt16LE(eocd + 10);
	let offset = zip.readUInt32LE(eocd + 16);
	const files = [];
	for (let i = 0; i < count; i++) {
		if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== 0x02014b50) {
			throw new Error("corrupt ZIP central directory");
		}
		const flags = zip.readUInt16LE(offset + 8);
		const method = zip.readUInt16LE(offset + 10);
		const compressedSize = zip.readUInt32LE(offset + 20);
		const nameLength = zip.readUInt16LE(offset + 28);
		const extraLength = zip.readUInt16LE(offset + 30);
		const commentLength = zip.readUInt16LE(offset + 32);
		const localOffset = zip.readUInt32LE(offset + 42);
		const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString("utf8").replaceAll("\\", "/");
		offset += 46 + nameLength + extraLength + commentLength;
		if (name.endsWith("/")) {
			continue;
		}
		if ((flags & 1) !== 0) {
			throw new Error(`${name} is encrypted`);
		}
		if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) {
			throw new Error(`corrupt ZIP entry ${name}`);
		}
		const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
		const raw = zip.subarray(start, start + compressedSize);
		if (method === 0) {
			files.push({ name, data: Buffer.from(raw) });
		} else if (method === 8) {
			files.push({ name, data: inflateRawSync(raw) });
		} else {
			throw new Error(`${name} uses unsupported ZIP compression ${String(method)}`);
		}
	}
	return files;
}

/**
 * Reads a Stream Deck profile export into its parts, noting anything that does not fit the export structure.
 * @param {Buffer} archive The `.streamDeckProfile` bytes.
 * @returns {{files: {name: string, data: Buffer}[], requiredPlugins: unknown, name: string | undefined, pages: {id: string, keys: Map<string, Record<string, unknown>>}[], problems: string[]}} The contents.
 */
export function inspectProfile(archive) {
	const files = readZip(archive);
	const problems = [];
	const json = (file) => {
		try {
			return JSON.parse(file.data.toString("utf8").replace(/^\uFEFF/, ""));
		} catch {
			problems.push(`${file.name} is not valid JSON.`);
			return undefined;
		}
	};

	const packageFile = files.find((file) => file.name === PACKAGE);
	const packageInfo = packageFile ? json(packageFile) : undefined;
	if (!packageFile) {
		problems.push("It has no package.json, so it is not a Stream Deck profile export.");
	}

	const profiles = files.filter((file) => PROFILE_MANIFEST.test(file.name));
	if (profiles.length !== 1) {
		problems.push(`Expected exactly one profile, found ${String(profiles.length)}.`);
	}
	const profileId = profiles.length === 1 ? PROFILE_MANIFEST.exec(profiles[0].name)?.[1] : undefined;
	const profile = profiles.length === 1 ? json(profiles[0]) : undefined;
	if (profiles.length === 1 && !(isObject(profile) && typeof profile.Name === "string" && isObject(profile.Pages))) {
		problems.push(`${profiles[0].name} is not a Stream Deck profile manifest (Name, Pages).`);
	}
	const declaredPages = isObject(profile) && isObject(profile.Pages)
		? new Set([profile.Pages.Default, ...(Array.isArray(profile.Pages.Pages) ? profile.Pages.Pages : [])].filter((id) => typeof id === "string").map((id) => id.toLowerCase()))
		: new Set();

	const pages = [];
	for (const file of files) {
		if (file.name === PACKAGE || PROFILE_MANIFEST.test(file.name)) {
			continue;
		}
		const match = PAGE_MANIFEST.exec(file.name);
		if (!match) {
			problems.push(`It contains an unexpected file (${file.name}). Deckify profiles hold only manifests: no images or other files.`);
			continue;
		}
		if (match[1] !== profileId) {
			problems.push(`${file.name} belongs to another profile.`);
			continue;
		}
		if (!declaredPages.has(match[2].toLowerCase())) {
			problems.push(`${file.name} is a page the profile does not list.`);
		}
		const page = json(file);
		if (!isObject(page) || !Array.isArray(page.Controllers)) {
			problems.push(`${file.name} is not a Stream Deck page manifest (Controllers).`);
			continue;
		}
		const keys = new Map();
		for (const controller of page.Controllers) {
			if (!isObject(controller) || controller.Type !== "Keypad") {
				problems.push(`${file.name} has a controller other than the keypad.`);
				continue;
			}
			if (controller.Actions === null || controller.Actions === undefined) {
				continue;
			}
			if (!isObject(controller.Actions)) {
				problems.push(`${file.name} has malformed actions.`);
				continue;
			}
			for (const [position, action] of Object.entries(controller.Actions)) {
				if (!/^\d+,\d+$/.test(position) || !isObject(action)) {
					problems.push(`${file.name} has a malformed key "${position}".`);
					continue;
				}
				keys.set(position, action);
			}
		}
		if (keys.size > 0) {
			pages.push({ id: match[2], keys });
		}
	}
	return { files, requiredPlugins: isObject(packageInfo) ? packageInfo.RequiredPlugins : undefined, name: isObject(profile) ? profile.Name : undefined, pages, problems };
}

/**
 * Checks a profile export against an experience.
 * @param {Buffer} archive The `.streamDeckProfile` bytes.
 * @param {string} id Experience ID.
 * @param {ReturnType<typeof loadCatalog>} [catalog] Catalog.
 * @returns {string[]} What is wrong (empty when the export can be bundled).
 */
export function checkProfileExport(archive, id, catalog = loadCatalog()) {
	let contents;
	try {
		contents = inspectProfile(archive);
	} catch (err) {
		return [`It is not a Stream Deck profile export (${err instanceof Error ? err.message : String(err)}).`];
	}
	const problems = [...contents.problems];
	const expected = expectedKeys(catalog, id);
	const deckifyUuids = new Map(Object.values(catalog.ACTIONS).map((action) => [action.uuid, action.name]));
	const label = (uuid) => deckifyUuids.get(uuid) ?? uuid;

	if (contents.requiredPlugins !== undefined && !isDeepStrictEqual(contents.requiredPlugins, [PLUGIN_UUID])) {
		problems.push(`It requires plugins other than Deckify (${JSON.stringify(contents.requiredPlugins)}).`);
	}
	if (contents.name !== undefined && contents.name !== profileName(id)) {
		problems.push(`The profile is named "${contents.name}", but the ${id} experience is "${profileName(id)}".`);
	}
	if (contents.pages.length !== 1) {
		problems.push(`Expected exactly one page with keys, found ${String(contents.pages.length)}. Deckify's experiences are single-page profiles.`);
	}
	for (const page of contents.pages) {
		for (const [position, action] of page.keys) {
			const uuid = typeof action.UUID === "string" ? action.UUID : String(action.UUID);
			const [column, row] = position.split(",").map(Number);
			if (column >= catalog.COLUMNS || row >= catalog.ROWS) {
				problems.push(`Key ${position} is outside the 5 × 3 Stream Deck / MK.2 layout.`);
			}
			if (!deckifyUuids.has(uuid) || (isObject(action.Plugin) && action.Plugin.UUID !== PLUGIN_UUID)) {
				problems.push(`Key ${position} holds "${uuid}", which is not a Deckify action. Bundled profiles may contain Deckify actions only.`);
			} else if (expected.get(position) !== uuid) {
				problems.push(`Key ${position} holds ${label(uuid)} but the ${id} layout has ${expected.has(position) ? label(expected.get(position)) : "no key"} there.`);
			}
			if (!settingsAllowed(uuid, action.Settings)) {
				problems.push(
					/playlist/.test(uuid)
						? `${label(uuid)} at ${position} carries a playlist selection. Bundled playlist keys must start unconfigured: add a fresh key from the actions list without choosing a playlist.`
						: `${label(uuid)} at ${position} carries settings (${Object.keys(isObject(action.Settings) ? action.Settings : {}).join(", ")}). Bundled keys must start with their defaults.`,
				);
			}
			const states = Array.isArray(action.States) ? action.States : [];
			if (states.some((state) => isObject(state) && ((typeof state.Image === "string" && state.Image !== "") || (typeof state.Title === "string" && state.Title !== "")))) {
				problems.push(`${label(uuid)} at ${position} has a custom title or image. Bundled keys use Deckify's own.`);
			}
			if (action.Resources !== null && action.Resources !== undefined) {
				problems.push(`${label(uuid)} at ${position} carries resources. Bundled keys must not.`);
			}
		}
		for (const [position, uuid] of expected) {
			if (!page.keys.has(position)) {
				problems.push(`Key ${position} should hold ${label(uuid)} but is empty.`);
			}
		}
	}
	for (const file of contents.files) {
		const text = file.data.toString("utf8");
		for (const [pattern, what] of PERSONAL_DATA) {
			if (pattern.test(text)) {
				problems.push(`${file.name} contains ${what}. Bundled profiles must not contain personal data.`);
			}
		}
	}
	return problems;
}

/**
 * Checks every profile the manifest declares, and that no other profile is in the plugin folder.
 * @param {Record<string, unknown>} manifest Parsed manifest.
 * @param {string} [pluginDir] Plugin folder.
 * @returns {string[]} What is wrong.
 */
export function checkBundledProfiles(manifest, pluginDir = PLUGIN_DIR) {
	const problems = [];
	const catalog = loadCatalog();
	const declared = Array.isArray(manifest.Profiles) ? manifest.Profiles : [];
	const byProfile = new Map(Object.entries(EXPERIENCE_PROFILES).map(([id, name]) => [name, id]));
	for (const profile of declared) {
		const id = byProfile.get(profile.Name);
		const file = path.join(pluginDir, `${String(profile.Name)}${PROFILE_EXTENSION}`);
		if (id === undefined) {
			problems.push(`The manifest declares "${String(profile.Name)}", which is not one of Deckify's experiences.`);
		} else if (!existsSync(file)) {
			problems.push(`Missing ${String(profile.Name)}${PROFILE_EXTENSION}: export the ${id} experience from Stream Deck and run "npm run profiles:import -- ${id} <file>" (docs/profiles.md).`);
		} else {
			problems.push(...checkProfileExport(readFileSync(file), id, catalog).map((problem) => `${String(profile.Name)}${PROFILE_EXTENSION}: ${problem}`));
		}
	}
	const names = new Set(declared.map((profile) => `${String(profile.Name)}${PROFILE_EXTENSION}`));
	for (const file of listProfiles(pluginDir)) {
		if (!names.has(file)) {
			problems.push(`${file} is not declared in the manifest; only Deckify's experiences may be bundled.`);
		}
	}
	return problems;
}

/**
 * Lists every `.streamDeckProfile` in the plugin folder.
 * @param {string} pluginDir Plugin folder.
 * @returns {string[]} Plugin-relative paths ("/" separators).
 */
export function listProfiles(pluginDir = PLUGIN_DIR) {
	return readdirSync(pluginDir, { recursive: true })
		.map((file) => String(file).replaceAll("\\", "/"))
		.filter((file) => file.endsWith(PROFILE_EXTENSION) && !file.startsWith("logs/"));
}

/**
 * Prints an experience's layout as a grid.
 * @param {ReturnType<typeof loadCatalog>} catalog Catalog.
 * @param {{id: string, label: string, layout: (string | null)[][]}} experience Experience.
 * @returns {string} The grid.
 */
export function layoutTable(catalog, experience) {
	const cells = experience.layout.map((row) => row.map((key) => (key === null ? "(empty)" : catalog.ACTIONS[key].name)));
	const width = Math.max(...cells.flat().map((cell) => cell.length));
	return cells.map((row) => `| ${row.map((cell) => cell.padEnd(width)).join(" | ")} |`).join("\n");
}

function settingsAllowed(uuid, settings) {
	if (!isObject(settings)) {
		return settings === undefined || settings === null;
	}
	if (Object.keys(settings).length === 0) {
		return true;
	}
	const allowed = ALLOWED_SETTINGS[uuid];
	return allowed !== undefined && allowed(settings);
}

function isVolumeStep(settings) {
	const keys = Object.keys(settings);
	return keys.length === 1 && keys[0] === "volumeStep" && Number.isInteger(settings.volumeStep) && settings.volumeStep >= 1 && settings.volumeStep <= 50;
}

function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function main(args) {
	const manifest = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "manifest.json"), "utf8"));
	const catalog = loadCatalog();
	const [command, id, file] = args;
	if (command === "layouts") {
		for (const experience of catalog.EXPERIENCES) {
			console.log(`${experience.label} → profile "${profileName(experience.id)}" (${EXPERIENCE_PROFILES[experience.id]}${PROFILE_EXTENSION})\n${layoutTable(catalog, experience)}\n`);
		}
		return 0;
	}
	if (command === "import") {
		if (!Object.hasOwn(EXPERIENCE_PROFILES, id ?? "") || !file) {
			console.error(`Usage: npm run profiles:import -- <${Object.keys(EXPERIENCE_PROFILES).join(" | ")}> <exported .streamDeckProfile>`);
			return 1;
		}
		const problems = checkProfileExport(readFileSync(file), id, catalog);
		if (problems.length > 0) {
			console.error(`Not imported: ${file}`);
			problems.forEach((problem) => console.error(`  - ${problem}`));
			return 1;
		}
		const target = path.join(PLUGIN_DIR, `${EXPERIENCE_PROFILES[id]}${PROFILE_EXTENSION}`);
		mkdirSync(path.dirname(target), { recursive: true });
		copyFileSync(file, target);
		console.log(`Imported the ${id} experience to ${path.relative(ROOT, target)}.`);
		return 0;
	}
	if (command === "check") {
		const problems = checkBundledProfiles(manifest);
		if (problems.length > 0) {
			problems.forEach((problem) => console.error(problem));
			return 1;
		}
		console.log(`Verified ${String(manifest.Profiles.length)} bundled profiles: ${manifest.Profiles.map((profile) => profile.Name).join(", ")}.`);
		return 0;
	}
	console.error("Usage: node scripts/profiles.mjs check | layouts | import <experience> <file>");
	return 1;
}

if (import.meta.main) {
	process.exitCode = main(process.argv.slice(2));
}
