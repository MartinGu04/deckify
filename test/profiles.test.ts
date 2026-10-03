import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as packScript from "../scripts/pack.mjs";
// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as profilesScript from "../scripts/profiles.mjs";
import { EXPERIENCE_IDS, EXPERIENCE_PROFILES } from "../src/experiences/experiences";
import { ActionUUID } from "../src/identifiers";
import { SETUP_ASSETS } from "../src/setup/setup-server";

// Deckify's bundled experience profiles: the manifest registration, the layouts the Setup App previews, the export checker, packaging, and
// finally the real bundled exports themselves.
const ROOT = path.resolve(import.meta.dirname, "..");
const PLUGIN = path.join(ROOT, "com.marting.deckify.sdPlugin");

type Catalog = {
	ACTIONS: Record<string, { name: string; uuid: string; icon: string }>;
	EXPERIENCES: { id: string; label: string; description: string; recommended: boolean; layout: (string | null)[][] }[];
	DEFAULT_EXPERIENCE: string;
	COLUMNS: number;
	ROWS: number;
};
type ManifestProfile = { Name: string; DeviceType: number; Readonly?: boolean; AutoInstall?: boolean; DontAutoSwitchWhenInstalled?: boolean };
type Manifest = { Software: { MinimumVersion: string }; Profiles?: ManifestProfile[]; Actions: { Name: string; UUID: string; Icon: string; VisibleInActionsList?: boolean }[] };

const profiles = profilesScript as {
	EXPERIENCE_PROFILES: Record<string, string>;
	PROFILE_EXTENSION: string;
	loadCatalog: () => Catalog;
	checkProfileExport: (archive: Buffer, id: string) => string[];
	checkBundledProfiles: (manifest: Manifest, pluginDir?: string) => string[];
	listProfiles: (pluginDir?: string) => string[];
};
const pack = packScript as { verifyProfileEntries: (entries: string[], manifest: Manifest) => string[] };

async function manifest(): Promise<Manifest> {
	return JSON.parse(await readFile(path.join(PLUGIN, "manifest.json"), "utf8")) as Manifest;
}

const catalog = profiles.loadCatalog();

/**
 * Builds a ZIP archive (test helper).
 * @param files Name → contents.
 * @returns The archive.
 */
function zip(files: Record<string, string | Buffer>): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, contents] of Object.entries(files)) {
		const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
		const packed = deflateRawSync(data);
		const nameBytes = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(crc32(data), 14);
		local.writeUInt32LE(packed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(8, 10);
		central.writeUInt32LE(crc32(data), 16);
		central.writeUInt32LE(packed.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(nameBytes.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, nameBytes, packed);
		centrals.push(central, nameBytes);
		offset += 30 + nameBytes.length + packed.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 8);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}

/**
 * A minimal, synthetic archive with only the structure the checker reads (a profile manifest with a name, and a page whose `Actions` map is
 * keyed "column,row"). It exercises the checker; it is not a Stream Deck export and is never bundled.
 * @param id Experience whose layout to lay out.
 * @param change Edits to the page's actions, the profile name, or extra files.
 * @param change.actions Edits the actions before they are written.
 * @param change.name Profile name.
 * @param change.files Extra files.
 * @returns The archive.
 */
function fixture(id: string, change: { actions?: (actions: Record<string, unknown>) => void; name?: string; files?: Record<string, string | Buffer> } = {}): Buffer {
	const experience = catalog.EXPERIENCES.find((candidate) => candidate.id === id);
	const actions: Record<string, unknown> = {};
	experience?.layout.forEach((row, rowIndex) =>
		row.forEach((key, column) => {
			if (key !== null) {
				actions[`${String(column)},${String(rowIndex)}`] = { UUID: catalog.ACTIONS[key]?.uuid, Name: catalog.ACTIONS[key]?.name, Settings: {}, State: 0 };
			}
		}),
	);
	change.actions?.(actions);
	return zip({
		"Fixture.sdProfile/manifest.json": JSON.stringify({ Name: change.name ?? path.posix.basename(EXPERIENCE_PROFILES[id as keyof typeof EXPERIENCE_PROFILES]), Device: {}, Pages: {} }),
		"Fixture.sdProfile/Profiles/PAGE1/manifest.json": JSON.stringify({ Controllers: [{ Type: "Keypad", Actions: actions }] }),
		...change.files,
	});
}

/** The public Deckify actions (every action except the hidden legacy Deckify Status). */
const PUBLIC_UUIDS = Object.values(ActionUUID).filter((uuid) => uuid !== ActionUUID.Status);

describe("manifest profiles", () => {
	it("registers exactly the three experiences for Stream Deck / MK.2: editable, offered on request, shown once installed", async () => {
		expect((await manifest()).Profiles).toEqual([
			{ Name: "profiles/Deckify Simple", DeviceType: 0, Readonly: false, AutoInstall: false, DontAutoSwitchWhenInstalled: false },
			{ Name: "profiles/Deckify", DeviceType: 0, Readonly: false, AutoInstall: false, DontAutoSwitchWhenInstalled: false },
			{ Name: "profiles/Deckify Power", DeviceType: 0, Readonly: false, AutoInstall: false, DontAutoSwitchWhenInstalled: false },
		]);
	});

	it("keeps the plugin, the checker and the manifest on the same profile names", async () => {
		expect(profiles.EXPERIENCE_PROFILES).toEqual(EXPERIENCE_PROFILES);
		expect((await manifest()).Profiles?.map((profile) => profile.Name)).toEqual(EXPERIENCE_IDS.map((id) => EXPERIENCE_PROFILES[id]));
		expect(catalog.EXPERIENCES.map((experience) => experience.id)).toEqual([...EXPERIENCE_IDS]);
		for (const name of Object.values(EXPERIENCE_PROFILES)) {
			expect(name).not.toMatch(/\.streamDeckProfile$/i);
			expect(name.startsWith("profiles/")).toBe(true);
		}
	});

	it("needs no newer Stream Deck: AutoInstall exists since Stream Deck 6.6 and Deckify already requires 7.1", async () => {
		const minimum = (await manifest()).Software.MinimumVersion;
		expect(minimum).toBe("7.1");
		const [major = 0, minor = 0] = minimum.split(".").map(Number);
		expect(major > 6 || (major === 6 && minor >= 6)).toBe(true);
	});
});

describe("experience layouts", () => {
	const keys = (id: string) => catalog.EXPERIENCES.find((experience) => experience.id === id)?.layout.flat().filter((key): key is string => key !== null) ?? [];
	const uuids = (id: string) => keys(id).map((key) => catalog.ACTIONS[key]?.uuid);

	it("are 5 × 3 grids of existing Deckify actions, named and drawn as in the Stream Deck app", async () => {
		const { Actions } = await manifest();
		expect([catalog.COLUMNS, catalog.ROWS]).toEqual([5, 3]);
		for (const [key, action] of Object.entries(catalog.ACTIONS)) {
			const declared = Actions.find((candidate) => candidate.UUID === action.uuid);
			expect(declared, key).toBeDefined();
			expect(declared?.VisibleInActionsList, key).not.toBe(false);
			expect(action.name, key).toBe(declared?.Name);
			expect(SETUP_ASSETS[action.icon]?.file, key).toBe(`${declared?.Icon ?? ""}.svg`);
		}
		for (const experience of catalog.EXPERIENCES) {
			expect(experience.layout, experience.id).toHaveLength(3);
			for (const row of experience.layout) {
				expect(row, experience.id).toHaveLength(5);
				for (const key of row) {
					expect(key === null || Object.hasOwn(catalog.ACTIONS, key), `${experience.id}: ${String(key)}`).toBe(true);
				}
			}
		}
	});

	it("SIMPLE has the essentials once each, centred, leaving the outer columns empty", () => {
		expect(uuids("simple").sort()).toEqual(
			[ActionUUID.Previous, ActionUUID.PlayPause, ActionUUID.Next, ActionUUID.NowPlaying, ActionUUID.VolumeDown, ActionUUID.Mute, ActionUUID.VolumeUp, ActionUUID.Like, ActionUUID.SpotifyAccount].sort(),
		);
		const layout = catalog.EXPERIENCES[0]?.layout ?? [];
		expect(layout.map((row) => [row[0], row[4]])).toEqual([
			[null, null],
			[null, null],
			[null, null],
		]);
		expect(layout[1]?.[2]).toBe("now-playing");
	});

	it("DECKIFY is the recommended default: every public action once, Now Playing in the centre, playback and volume grouped", () => {
		const deckify = catalog.EXPERIENCES.find((experience) => experience.id === "deckify");
		expect(catalog.DEFAULT_EXPERIENCE).toBe("deckify");
		expect(catalog.EXPERIENCES.filter((experience) => experience.recommended).map((experience) => experience.id)).toEqual(["deckify"]);
		expect(uuids("deckify").sort()).toEqual([...PUBLIC_UUIDS].sort());
		expect(deckify?.layout[1]?.[2]).toBe("now-playing");
		expect(deckify?.layout[0]?.slice(1, 4)).toEqual(["previous", "play-pause", "next"]);
		expect(deckify?.layout[2]?.slice(1, 4)).toEqual(["volume-down", "mute", "volume-up"]);
		// Empty corners are deliberate; no filler keys.
		expect(new Set(keys("deckify")).size).toBe(keys("deckify").length);
	});

	it("POWER puts every public action on one page and repeats only playlist keys, each of which holds its own playlist", () => {
		expect(new Set(uuids("power"))).toEqual(new Set(PUBLIC_UUIDS));
		expect(keys("power")).toHaveLength(15);
		const repeated = keys("power").filter((key, index, all) => all.indexOf(key) !== index);
		expect(new Set(repeated)).toEqual(new Set(["play-playlist", "add-to-playlist"]));
	});

	it("never uses the hidden legacy Deckify Status action", () => {
		expect(Object.values(catalog.ACTIONS).map((action) => action.uuid)).not.toContain(ActionUUID.Status);
	});
});

describe("profile export checker", () => {
	it("accepts an archive with exactly the experience's keys and no settings", () => {
		for (const id of EXPERIENCE_IDS) {
			expect(profiles.checkProfileExport(fixture(id), id), id).toEqual([]);
		}
	});

	it("accepts a volume step, the only setting a bundled key may carry", () => {
		const archive = fixture("simple", { actions: (actions) => Object.assign(actions["1,2"] as object, { Settings: { volumeStep: 5 } }) });
		expect(profiles.checkProfileExport(archive, "simple")).toEqual([]);
	});

	it("rejects a playlist key that carries someone's playlist", () => {
		const archive = fixture("deckify", {
			actions: (actions) => Object.assign(actions["4,1"] as object, { Settings: { playlistId: "37i9dQZF1DXcBWIGoYBM5M", playlistUri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", playlistName: "Mine" } }),
		});
		const problems = profiles.checkProfileExport(archive, "deckify").join("\n");
		expect(problems).toContain("Play Playlist at 4,1 carries a playlist selection");
		expect(problems).toContain("a Spotify URI");
		expect(problems).toContain("a playlist selection");
	});

	it("rejects other settings, foreign actions, moved keys, missing keys and extra pages", () => {
		const settings = fixture("simple", { actions: (actions) => Object.assign(actions["1,0"] as object, { Settings: { anything: true } }) });
		expect(profiles.checkProfileExport(settings, "simple").join("\n")).toContain("Previous Track at 1,0 carries settings (anything)");

		const foreign = fixture("simple", { actions: (actions) => (actions["0,0"] = { UUID: "com.elgato.streamdeck.system.website", Settings: { path: "https://example.com" } }) });
		expect(profiles.checkProfileExport(foreign, "simple").join("\n")).toContain('Key 0,0 holds "com.elgato.streamdeck.system.website", which is not a Deckify action');

		const moved = fixture("deckify", {
			actions: (actions) => {
				actions["0,0"] = actions["0,1"];
				delete actions["0,1"];
			},
		});
		const movedProblems = profiles.checkProfileExport(moved, "deckify").join("\n");
		expect(movedProblems).toContain("Key 0,0 holds Spotify Account but the deckify layout has no key there.");
		expect(movedProblems).toContain("Key 0,1 should hold Spotify Account but is empty.");

		const outside = fixture("simple", { actions: (actions) => (actions["5,0"] = { UUID: ActionUUID.Like, Settings: {} }) });
		expect(profiles.checkProfileExport(outside, "simple").join("\n")).toContain("Key 5,0 is outside the 5 × 3");

		const twoPages = fixture("power", { files: { "Fixture.sdProfile/Profiles/PAGE2/manifest.json": JSON.stringify({ Controllers: [{ Actions: { "0,0": { UUID: ActionUUID.Like } } }] }) } });
		expect(profiles.checkProfileExport(twoPages, "power").join("\n")).toContain("Expected exactly one page with keys, found 2");
	});

	it("rejects embedded images and anything personal", () => {
		const image = fixture("simple", { files: { "Fixture.sdProfile/Images/cover.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]) } });
		expect(profiles.checkProfileExport(image, "simple").join("\n")).toContain("It contains images (Fixture.sdProfile/Images/cover.png)");
		for (const [text, what] of [
			["https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "a Spotify link"],
			["spotify:track:4uLU6hMCjMI75M1A2tKUQC", "a Spotify URI"],
			["0123456789abcdef0123456789abcdef", "Client ID-shaped"],
			["C:\\Users\\martin\\Music", "a user folder path"],
			["someone@example.com", "an email address"],
		]) {
			const archive = fixture("simple", { actions: (actions) => Object.assign(actions["2,1"] as object, { States: [{ Title: text }] }) });
			expect(profiles.checkProfileExport(archive, "simple").join("\n"), text).toContain(what);
		}
	});

	it("asks for the profile to carry the name Deckify presents", () => {
		expect(profiles.checkProfileExport(fixture("power", { name: "My layout" }), "power")).toEqual([
			'The profile is named "My layout"; rename it to "Deckify Power" in Stream Deck before exporting.',
		]);
	});

	it("rejects files that aren't profile exports", () => {
		expect(profiles.checkProfileExport(Buffer.from("not a zip"), "simple")[0]).toMatch(/^It is not a Stream Deck profile export/);
		expect(profiles.checkProfileExport(zip({ "readme.txt": "hello" }), "simple").join("\n")).toContain("No key layout was found");
	});
});

describe("bundled profile packaging", () => {
	it("requires exactly the declared profiles in the package", async () => {
		const m = await manifest();
		const declared = (m.Profiles ?? []).map((profile) => `com.marting.deckify.sdPlugin/${profile.Name}.streamDeckProfile`);
		expect(pack.verifyProfileEntries(declared, m)).toEqual([]);
		expect(pack.verifyProfileEntries(declared.slice(1), m).join("\n")).toContain("missing bundled profiles the manifest declares: com.marting.deckify.sdPlugin/profiles/Deckify Simple.streamDeckProfile");
		expect(pack.verifyProfileEntries([...declared, "com.marting.deckify.sdPlugin/profiles/Test.streamDeckProfile"], m).join("\n")).toContain(
			"contains profiles the manifest does not declare: com.marting.deckify.sdPlugin/profiles/Test.streamDeckProfile",
		);
	});

	it("flags missing, undeclared and unsafe profiles in a plugin folder", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "deckify-profiles-"));
		try {
			await mkdir(path.join(dir, "profiles"));
			await writeFile(path.join(dir, "profiles", "Deckify.streamDeckProfile"), fixture("deckify"));
			await writeFile(path.join(dir, "profiles", "Deckify Power.streamDeckProfile"), fixture("power", { name: "Martin's deck" }));
			await writeFile(path.join(dir, "profiles", "Dev Test.streamDeckProfile"), fixture("simple"));
			const problems = profiles.checkBundledProfiles(await manifest(), dir);
			expect(problems).toEqual([
				expect.stringMatching(/^Missing profiles\/Deckify Simple\.streamDeckProfile: export the simple experience/) as unknown,
				'profiles/Deckify Power.streamDeckProfile: The profile is named "Martin\'s deck"; rename it to "Deckify Power" in Stream Deck before exporting.',
				"profiles/Dev Test.streamDeckProfile is not declared in the manifest; only Deckify's experiences may be bundled.",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("keeps no profiles in the plugin folder other than the declared ones", async () => {
		const declared = ((await manifest()).Profiles ?? []).map((profile) => `${profile.Name}.streamDeckProfile`);
		expect(profiles.listProfiles().filter((file) => !declared.includes(file))).toEqual([]);
	});
});

describe("bundled profiles", () => {
	// The release gate for Phase 9: every declared profile must be a real Stream Deck export (made and exported in the Stream Deck app, see
	// docs/profiles.md) that matches its layout and carries no personal data. This fails until the exports are added; it must not be skipped.
	it("bundles a real, checked export for every declared profile", async () => {
		expect(profiles.checkBundledProfiles(await manifest())).toEqual([]);
	});
});
