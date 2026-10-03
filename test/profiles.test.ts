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

// Deckify's bundled experience profiles: the manifest registration, the layouts the Setup App previews, the real exports themselves, the
// export checker (exercised on edited copies of the real exports) and packaging.
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
type ZipFile = { name: string; data: Buffer };
type Json = Record<string, unknown>;

const profiles = profilesScript as {
	EXPERIENCE_PROFILES: Record<string, string>;
	loadCatalog: () => Catalog;
	readZip: (zip: Buffer) => ZipFile[];
	profileName: (id: string) => string;
	checkProfileExport: (archive: Buffer, id: string) => string[];
	checkBundledProfiles: (manifest: Manifest, pluginDir?: string) => string[];
	listProfiles: (pluginDir?: string) => string[];
};
const pack = packScript as { verifyProfileEntries: (entries: string[], manifest: Manifest) => string[] };

async function manifest(): Promise<Manifest> {
	return JSON.parse(await readFile(path.join(PLUGIN, "manifest.json"), "utf8")) as Manifest;
}

const catalog = profiles.loadCatalog();
const exportFile = (id: (typeof EXPERIENCE_IDS)[number]) => path.join(PLUGIN, `${EXPERIENCE_PROFILES[id]}.streamDeckProfile`);
const realExport = (id: (typeof EXPERIENCE_IDS)[number]) => readFile(exportFile(id));

/**
 * Builds a ZIP archive (test helper, to repack edited copies of the real exports).
 * @param files The files.
 * @returns The archive.
 */
function zip(files: ZipFile[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const { name, data } of files) {
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
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}

/** The page of an export that holds keys. */
const keyPage = (files: ZipFile[]) =>
	files.find((file) => /\/Profiles\/[^/]+\/manifest\.json$/.test(file.name) && file.data.toString("utf8").includes('"Actions":{'));

/**
 * An edited copy of a real export.
 * @param id Experience.
 * @param change Edits.
 * @param change.actions Edits the actions of the page with keys.
 * @param change.profile Edits the profile manifest.
 * @param change.package Edits package.json.
 * @param change.files Edits the file list.
 * @returns The archive.
 */
async function edited(
	id: (typeof EXPERIENCE_IDS)[number],
	change: { actions?: (actions: Record<string, Json>) => void; profile?: (profile: Json) => void; package?: (info: Json) => void; files?: (files: ZipFile[]) => void },
): Promise<Buffer> {
	const files = profiles.readZip(await realExport(id));
	const rewrite = (file: ZipFile | undefined, edit: ((json: Json) => void) | undefined) => {
		if (file && edit) {
			const json = JSON.parse(file.data.toString("utf8")) as Json;
			edit(json);
			file.data = Buffer.from(JSON.stringify(json));
		}
	};
	rewrite(keyPage(files), change.actions && ((page) => change.actions?.((page.Controllers as { Actions: Record<string, Json> }[])[0]?.Actions ?? {})));
	rewrite(
		files.find((file) => /^Profiles\/[^/]+\.sdProfile\/manifest\.json$/.test(file.name)),
		change.profile,
	);
	rewrite(
		files.find((file) => file.name === "package.json"),
		change.package,
	);
	change.files?.(files);
	return zip(files);
}

/** The public Deckify actions (every action except the hidden legacy Deckify Status). */
const PUBLIC_UUIDS = Object.values(ActionUUID).filter((uuid) => uuid !== ActionUUID.Status);

describe("manifest profiles", () => {
	it("registers exactly the two real exports for Stream Deck / MK.2: editable, offered on request, shown once installed", async () => {
		expect((await manifest()).Profiles).toEqual([
			{ Name: "profiles/DECKIFY ⭐ Recommended", DeviceType: 0, Readonly: false, AutoInstall: false, DontAutoSwitchWhenInstalled: false },
			{ Name: "profiles/SIMPLE", DeviceType: 0, Readonly: false, AutoInstall: false, DontAutoSwitchWhenInstalled: false },
		]);
	});

	it("keeps the plugin, the checker, the layouts and the manifest on the same two experiences and profile names", async () => {
		expect(EXPERIENCE_IDS).toEqual(["deckify", "simple"]);
		expect(profiles.EXPERIENCE_PROFILES).toEqual(EXPERIENCE_PROFILES);
		expect((await manifest()).Profiles?.map((profile) => profile.Name)).toEqual(EXPERIENCE_IDS.map((id) => EXPERIENCE_PROFILES[id]));
		expect(catalog.EXPERIENCES.map((experience) => experience.id)).toEqual([...EXPERIENCE_IDS]);
		expect(profiles.profileName("deckify")).toBe("DECKIFY ⭐ Recommended");
		expect(profiles.profileName("simple")).toBe("SIMPLE");
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
	const experience = (id: string) => catalog.EXPERIENCES.find((candidate) => candidate.id === id);
	const keys = (id: string) => experience(id)?.layout.flat().filter((key): key is string => key !== null) ?? [];
	const uuids = (id: string) => keys(id).map((key) => catalog.ACTIONS[key]?.uuid);

	it("are exactly DECKIFY and SIMPLE, as 5 × 3 grids of existing Deckify actions named and drawn as in the Stream Deck app", async () => {
		const { Actions } = await manifest();
		expect(catalog.EXPERIENCES.map((candidate) => candidate.label)).toEqual(["DECKIFY", "SIMPLE"]);
		expect([catalog.COLUMNS, catalog.ROWS]).toEqual([5, 3]);
		for (const [key, action] of Object.entries(catalog.ACTIONS)) {
			const declared = Actions.find((candidate) => candidate.UUID === action.uuid);
			expect(declared, key).toBeDefined();
			expect(declared?.VisibleInActionsList, key).not.toBe(false);
			expect(action.name, key).toBe(declared?.Name);
			expect(SETUP_ASSETS[action.icon]?.file, key).toBe(`${declared?.Icon ?? ""}.svg`);
		}
		for (const candidate of catalog.EXPERIENCES) {
			expect(candidate.layout, candidate.id).toHaveLength(3);
			for (const row of candidate.layout) {
				expect(row, candidate.id).toHaveLength(5);
				for (const key of row) {
					expect(key === null || Object.hasOwn(catalog.ACTIONS, key), `${candidate.id}: ${String(key)}`).toBe(true);
				}
			}
		}
	});

	it("DECKIFY is the recommended default: every public action once, Now Playing in the centre, the agreed layout", () => {
		expect(catalog.DEFAULT_EXPERIENCE).toBe("deckify");
		expect(catalog.EXPERIENCES.filter((candidate) => candidate.recommended).map((candidate) => candidate.id)).toEqual(["deckify"]);
		expect(uuids("deckify").sort()).toEqual([...PUBLIC_UUIDS].sort());
		expect(experience("deckify")?.layout).toEqual([
			[null, "previous", "play-pause", "next", null],
			["account", "like", "now-playing", "add-to-playlist", "play-playlist"],
			[null, "volume-down", "mute", "volume-up", null],
		]);
	});

	it("SIMPLE has the essentials once each, centred, leaving the outer columns empty", () => {
		expect(uuids("simple").sort()).toEqual(
			[ActionUUID.Previous, ActionUUID.PlayPause, ActionUUID.Next, ActionUUID.NowPlaying, ActionUUID.VolumeDown, ActionUUID.Mute, ActionUUID.VolumeUp, ActionUUID.Like, ActionUUID.SpotifyAccount].sort(),
		);
		expect(experience("simple")?.layout).toEqual([
			[null, "previous", "play-pause", "next", null],
			[null, "like", "now-playing", "account", null],
			[null, "volume-down", "mute", "volume-up", null],
		]);
	});

	it("never uses the hidden legacy Deckify Status action", () => {
		expect(Object.values(catalog.ACTIONS).map((action) => action.uuid)).not.toContain(ActionUUID.Status);
	});
});

describe("bundled profiles (the real Stream Deck exports)", () => {
	it("both pass the checker as exported, and every declared profile is present", async () => {
		for (const id of EXPERIENCE_IDS) {
			expect(profiles.checkProfileExport(await realExport(id), id), id).toEqual([]);
		}
		expect(profiles.checkBundledProfiles(await manifest())).toEqual([]);
	});

	it("are Deckify-only, single-page profiles carrying the names Stream Deck shows", async () => {
		for (const id of EXPERIENCE_IDS) {
			const files = profiles.readZip(await realExport(id));
			const info = JSON.parse(files.find((file) => file.name === "package.json")?.data.toString("utf8") ?? "{}") as Json;
			expect(info.RequiredPlugins, id).toEqual(["com.marting.deckify"]);
			const root = files.find((file) => /^Profiles\/[^/]+\.sdProfile\/manifest\.json$/.test(file.name));
			expect((JSON.parse(root?.data.toString("utf8") ?? "{}") as Json).Name, id).toBe(profiles.profileName(id));
			// Only the package and profile/page manifests: no images or other files.
			expect(files.every((file) => file.name === "package.json" || file.name.endsWith("/manifest.json")), id).toBe(true);
		}
	});

	it("match their previews key for key", async () => {
		for (const id of EXPERIENCE_IDS) {
			const page = JSON.parse(keyPage(profiles.readZip(await realExport(id)))?.data.toString("utf8") ?? "{}") as { Controllers: { Actions: Record<string, { UUID: string }> }[] };
			const drawn = Object.fromEntries(Object.entries(page.Controllers[0]?.Actions ?? {}).map(([position, action]) => [position, action.UUID]));
			const expected: Record<string, string> = {};
			catalog.EXPERIENCES.find((candidate) => candidate.id === id)?.layout.forEach((row, rowIndex) =>
				row.forEach((key, column) => {
					if (key !== null) {
						expected[`${String(column)},${String(rowIndex)}`] = catalog.ACTIONS[key]?.uuid ?? "";
					}
				}),
			);
			expect(drawn, id).toEqual(expected);
		}
	});

	it("start with unconfigured playlist keys and default settings everywhere", async () => {
		for (const id of EXPERIENCE_IDS) {
			const text = keyPage(profiles.readZip(await realExport(id)))?.data.toString("utf8") ?? "";
			const page = JSON.parse(text) as { Controllers: { Actions: Record<string, { UUID: string; Settings: unknown }> }[] };
			for (const action of Object.values(page.Controllers[0]?.Actions ?? {})) {
				expect(action.Settings, `${id}: ${action.UUID}`).toEqual({});
			}
			expect(text).not.toMatch(/playlist(Id|Uri|Name)|spotify:|open\.spotify\.com/i);
		}
		const deckify = keyPage(profiles.readZip(await realExport("deckify")))?.data.toString("utf8") ?? "";
		expect(deckify).toContain(ActionUUID.AddToPlaylist);
		expect(deckify).toContain(ActionUUID.PlayPlaylist);
	});
});

describe("profile export checker", () => {
	it("rejects a playlist key that carries someone's playlist", async () => {
		const archive = await edited("deckify", {
			actions: (actions) => Object.assign(actions["4,1"] as object, { Settings: { playlistId: "37i9dQZF1DXcBWIGoYBM5M", playlistUri: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", playlistName: "Mine" } }),
		});
		const problems = profiles.checkProfileExport(archive, "deckify").join("\n");
		expect(problems).toContain("Play Playlist at 4,1 carries a playlist selection");
		expect(problems).toContain("a Spotify URI");
		expect(problems).toContain("a playlist selection");
		const add = await edited("deckify", { actions: (actions) => Object.assign(actions["3,1"] as object, { Settings: { playlistId: "37i9dQZF1DXcBWIGoYBM5M" } }) });
		expect(profiles.checkProfileExport(add, "deckify").join("\n")).toContain("Add to Playlist at 3,1 carries a playlist selection");
	});

	it("allows only a volume step as a setting", async () => {
		const step = await edited("simple", { actions: (actions) => Object.assign(actions["1,2"] as object, { Settings: { volumeStep: 5 } }) });
		expect(profiles.checkProfileExport(step, "simple")).toEqual([]);
		const other = await edited("simple", { actions: (actions) => Object.assign(actions["1,0"] as object, { Settings: { anything: true } }) });
		expect(profiles.checkProfileExport(other, "simple").join("\n")).toContain("Previous Track at 1,0 carries settings (anything)");
	});

	it("rejects foreign actions, foreign plugins, moved, missing or extra keys, and custom titles or images", async () => {
		const foreign = await edited("simple", {
			actions: (actions) => (actions["0,0"] = { UUID: "com.elgato.streamdeck.system.website", Plugin: { UUID: "com.elgato.streamdeck.system.website" }, Settings: { path: "https://example.com" } }),
		});
		expect(profiles.checkProfileExport(foreign, "simple").join("\n")).toContain('Key 0,0 holds "com.elgato.streamdeck.system.website", which is not a Deckify action');

		const plugins = await edited("simple", { package: (info) => (info.RequiredPlugins = ["com.marting.deckify", "com.example.other"]) });
		expect(profiles.checkProfileExport(plugins, "simple").join("\n")).toContain("It requires plugins other than Deckify");

		const moved = await edited("deckify", {
			actions: (actions) => {
				actions["0,0"] = actions["0,1"] as Json;
				delete actions["0,1"];
			},
		});
		const movedProblems = profiles.checkProfileExport(moved, "deckify").join("\n");
		expect(movedProblems).toContain("Key 0,0 holds Spotify Account but the deckify layout has no key there.");
		expect(movedProblems).toContain("Key 0,1 should hold Spotify Account but is empty.");

		const swapped = await realExport("simple");
		expect(profiles.checkProfileExport(swapped, "deckify").join("\n")).toContain("Key 0,1 should hold Spotify Account but is empty.");

		const outside = await edited("simple", { actions: (actions) => (actions["5,0"] = { ...(actions["1,1"] as Json) }) });
		expect(profiles.checkProfileExport(outside, "simple").join("\n")).toContain("Key 5,0 is outside the 5 × 3");

		const title = await edited("simple", { actions: (actions) => ((actions["2,1"] as { States: Json[] }).States[0] = { Title: "Martin's mix" }) });
		expect(profiles.checkProfileExport(title, "simple").join("\n")).toContain("Now Playing at 2,1 has a custom title or image");
	});

	it("rejects extra pages, extra profiles, images and other files", async () => {
		const files = profiles.readZip(await realExport("simple"));
		const page = keyPage(files);
		const pagePath = page?.name.replace(/[^/]+\/manifest\.json$/, "") ?? "";
		const twoPages = await edited("simple", { files: (list) => list.push({ name: `${pagePath}AAAA/manifest.json`, data: page?.data ?? Buffer.alloc(0) }) });
		const twoPagesProblems = profiles.checkProfileExport(twoPages, "simple").join("\n");
		expect(twoPagesProblems).toContain("Expected exactly one page with keys, found 2");
		expect(twoPagesProblems).toContain("is a page the profile does not list");

		const image = await edited("simple", { files: (list) => list.push({ name: `${pagePath.replace(/Profiles\/$/, "")}Images/cover.png`, data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }) });
		expect(profiles.checkProfileExport(image, "simple").join("\n")).toContain("It contains an unexpected file");

		const second = await edited("simple", { files: (list) => list.push({ name: "Profiles/OTHER.sdProfile/manifest.json", data: Buffer.from('{"Name":"Other","Pages":{}}') }) });
		expect(profiles.checkProfileExport(second, "simple").join("\n")).toContain("Expected exactly one profile, found 2");
	});

	it("rejects anything personal anywhere in the export", async () => {
		for (const [text, what] of [
			["https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "a Spotify link"],
			["spotify:track:4uLU6hMCjMI75M1A2tKUQC", "a Spotify URI"],
			["spotify:user:someone", "a Spotify URI"],
			["0123456789abcdef0123456789abcdef", "Client ID-shaped"],
			["BQ" + "x".repeat(60), "a token-shaped value"],
			["C:\\Users\\martin\\Music", "a user folder path"],
			["someone@example.com", "an email address"],
		]) {
			const archive = await edited("simple", { profile: (profile) => (profile.Note = text) });
			expect(profiles.checkProfileExport(archive, "simple").join("\n"), text).toContain(what);
		}
	});

	it("asks for the profile name each experience is exported with", async () => {
		const renamed = await edited("deckify", { profile: (profile) => (profile.Name = "My layout") });
		expect(profiles.checkProfileExport(renamed, "deckify")).toEqual(['The profile is named "My layout", but the deckify experience is "DECKIFY ⭐ Recommended".']);
	});

	it("rejects files that aren't profile exports", () => {
		expect(profiles.checkProfileExport(Buffer.from("not a zip"), "simple")[0]).toMatch(/^It is not a Stream Deck profile export/);
		const problems = profiles.checkProfileExport(zip([{ name: "readme.txt", data: Buffer.from("hello") }]), "simple").join("\n");
		expect(problems).toContain("It has no package.json");
		expect(problems).toContain("Expected exactly one profile, found 0");
	});
});

describe("bundled profile packaging", () => {
	it("requires exactly the two declared profiles in the package", async () => {
		const m = await manifest();
		const declared = (m.Profiles ?? []).map((profile) => `com.marting.deckify.sdPlugin/${profile.Name}.streamDeckProfile`);
		expect(declared).toEqual(["com.marting.deckify.sdPlugin/profiles/DECKIFY ⭐ Recommended.streamDeckProfile", "com.marting.deckify.sdPlugin/profiles/SIMPLE.streamDeckProfile"]);
		expect(pack.verifyProfileEntries(declared, m)).toEqual([]);
		expect(pack.verifyProfileEntries(declared.slice(1), m).join("\n")).toContain(
			"missing bundled profiles the manifest declares: com.marting.deckify.sdPlugin/profiles/DECKIFY ⭐ Recommended.streamDeckProfile",
		);
		expect(pack.verifyProfileEntries([...declared, "com.marting.deckify.sdPlugin/profiles/Test.streamDeckProfile"], m).join("\n")).toContain(
			"contains profiles the manifest does not declare: com.marting.deckify.sdPlugin/profiles/Test.streamDeckProfile",
		);
	});

	it("flags missing, undeclared and unsafe profiles in a plugin folder", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "deckify-profiles-"));
		try {
			await mkdir(path.join(dir, "profiles"));
			await writeFile(path.join(dir, "profiles", "SIMPLE.streamDeckProfile"), await edited("simple", { profile: (profile) => (profile.Name = "Martin's deck") }));
			await writeFile(path.join(dir, "profiles", "Dev Test.streamDeckProfile"), await realExport("simple"));
			expect(profiles.checkBundledProfiles(await manifest(), dir)).toEqual([
				expect.stringMatching(/^Missing profiles\/DECKIFY ⭐ Recommended\.streamDeckProfile: export the deckify experience/) as unknown,
				'profiles/SIMPLE.streamDeckProfile: The profile is named "Martin\'s deck", but the simple experience is "SIMPLE".',
				"profiles/Dev Test.streamDeckProfile is not declared in the manifest; only Deckify's experiences may be bundled.",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("keeps exactly the declared profiles in the plugin folder", async () => {
		const declared = ((await manifest()).Profiles ?? []).map((profile) => `${profile.Name}.streamDeckProfile`);
		expect(profiles.listProfiles().sort()).toEqual([...declared].sort());
	});
});
