import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ActionUUID, PLUGIN_UUID } from "../src/identifiers";

const ROOT = path.resolve(import.meta.dirname, "..");

type ManifestAction = { Name: string; UUID: string; VisibleInActionsList?: boolean };
type Manifest = { UUID: string; Actions: ManifestAction[] };

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
});
