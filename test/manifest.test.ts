import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ActionUUID, PLUGIN_UUID } from "../src/identifiers";

const ROOT = path.resolve(import.meta.dirname, "..");

type ManifestAction = { Name: string; UUID: string; VisibleInActionsList?: boolean };
type Manifest = {
	UUID: string;
	Name: string;
	Version: string;
	Author: string;
	Category: string;
	Software: { MinimumVersion: string };
	OS: { Platform: string; MinimumVersion: string }[];
	Nodejs: { Version: string; Debug?: string };
	Actions: ManifestAction[];
};

async function manifest(): Promise<Manifest> {
	return JSON.parse(await readFile(path.join(ROOT, "com.marting.deckify.sdPlugin", "manifest.json"), "utf8")) as Manifest;
}

/** The public actions, in the order users see them in the Stream Deck app. */
const PUBLIC_ACTIONS: readonly (readonly [name: string, uuid: string])[] = [
	["Spotify Account", ActionUUID.SpotifyAccount],
	["Previous Track", ActionUUID.Previous],
	["Play / Pause", ActionUUID.PlayPause],
	["Next Track", ActionUUID.Next],
	["Now Playing", ActionUUID.NowPlaying],
	["Volume Down", ActionUUID.VolumeDown],
	["Volume Up", ActionUUID.VolumeUp],
	["Mute / Unmute", ActionUUID.Mute],
	["Like / Unlike", ActionUUID.Like],
	["Add to Playlist", ActionUUID.AddToPlaylist],
	["Play Playlist", ActionUUID.PlayPlaylist],
];

/**
 * The action classes registered in `src/plugin.ts`, keyed by the UUID their `@action` decorator declares.
 * @returns Registered UUIDs.
 */
async function registeredUuids(): Promise<string[]> {
	const plugin = await readFile(path.join(ROOT, "src", "plugin.ts"), "utf8");
	const registered = new Set([...plugin.matchAll(/registerAction\(\s*new (\w+)\(/g)].map((match) => match[1]));
	const uuids: string[] = [];
	for (const file of await readdir(path.join(ROOT, "src", "actions"))) {
		const source = await readFile(path.join(ROOT, "src", "actions", file), "utf8");
		for (const match of source.matchAll(/@action\(\{ UUID: ActionUUID\.(\w+) \}\)\s*export class (\w+)/g)) {
			const [, key = "", className = ""] = match;
			if (registered.has(className)) {
				uuids.push(ActionUUID[key as keyof typeof ActionUUID]);
			}
		}
	}
	return uuids;
}

describe("manifest", () => {
	it("keeps the permanent plugin and action UUIDs", async () => {
		const { UUID, Actions } = await manifest();
		expect(UUID).toBe(PLUGIN_UUID);
		expect(Actions.map((a) => a.UUID).sort()).toEqual(Object.values(ActionUUID).sort());
		for (const action of Actions) {
			expect(action.UUID.startsWith(`${PLUGIN_UUID}.`), action.UUID).toBe(true);
		}
	});

	it("hides the legacy Deckify Status action from the actions list but keeps it working", async () => {
		const status = (await manifest()).Actions.find((a) => a.UUID === "com.marting.deckify.status");
		expect(status).toBeDefined();
		expect(status?.VisibleInActionsList).toBe(false);
		// Still registered, so keys already placed in users' profiles keep working (the smoke test also presses one).
		expect(await registeredUuids()).toContain("com.marting.deckify.status");
	});

	it("shows every Spotify action in the actions list, in product order", async () => {
		const visible = (await manifest()).Actions.filter((a) => a.VisibleInActionsList !== false);
		expect(visible.map((a) => [a.Name, a.UUID])).toEqual(PUBLIC_ACTIONS);
	});

	it("registers an implementation for every action in the manifest", async () => {
		const uuids = await registeredUuids();
		expect(uuids.sort()).toEqual((await manifest()).Actions.map((a) => a.UUID).sort());
	});

	it("keeps every permanent UUID, written out", async () => {
		const { UUID, Actions } = await manifest();
		expect(UUID).toBe("com.marting.deckify");
		expect(Actions.map((a) => a.UUID)).toEqual([
			"com.marting.deckify.status",
			"com.marting.deckify.spotify.account",
			"com.marting.deckify.spotify.previous",
			"com.marting.deckify.spotify.play-pause",
			"com.marting.deckify.spotify.next",
			"com.marting.deckify.spotify.now-playing",
			"com.marting.deckify.spotify.volume-down",
			"com.marting.deckify.spotify.volume-up",
			"com.marting.deckify.spotify.mute",
			"com.marting.deckify.spotify.like",
			"com.marting.deckify.spotify.add-to-playlist",
			"com.marting.deckify.spotify.play-playlist",
		]);
	});

	it("is the v1.0 public release: version 1.0.0.0 by MARTIN.G, Windows only", async () => {
		const m = await manifest();
		expect(m.Version).toBe("1.0.0.0");
		expect(m.Author).toBe("MARTIN.G");
		expect([m.Name, m.Category]).toEqual(["Deckify", "Deckify"]);
		expect(m.OS).toEqual([{ Platform: "windows", MinimumVersion: "10" }]);
		expect(m.Software.MinimumVersion).toBe("7.1");
		const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")) as { version: string; author: string };
		const lock = JSON.parse(await readFile(path.join(ROOT, "package-lock.json"), "utf8")) as { version: string; packages: Record<string, { version?: string }> };
		// npm needs a three-part version; it matches the manifest's first three parts.
		expect([pkg.version, lock.version, lock.packages[""]?.version]).toEqual(["1.0.0", "1.0.0", "1.0.0"]);
		expect(pkg.author).toBe("MARTIN.G");
	});

	it("keeps Node.js debugging for local development only (release packages drop it; see test/release-package.test.ts)", async () => {
		expect((await manifest()).Nodejs).toEqual({ Version: "24", Debug: "enabled" });
	});
});
