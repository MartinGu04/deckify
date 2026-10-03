import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildInspectorState, parsePlaylistInspectorRequest, type PlaylistInspectorState } from "../src/actions/playlist-inspector";
import { playlistKeyTitle } from "../src/actions/playlist-views";
import { FAKE, json } from "./helpers";
import { episodeItem, playerState, trackItem } from "./playback-fixtures";
import { ME, pid, playlist, playlistSetup, tid } from "./playlist-fixtures";

// Minimal Stream Deck SDK stand-in: no-op decorator; `actions` lists the fake keys registered per action instance.
const sdk = vi.hoisted(() => ({ keysByAction: new Map<unknown, unknown[]>() }));
vi.mock("@elgato/streamdeck", () => ({
	default: {},
	action: () => (target: unknown) => target,
	SingletonAction: class {
		get actions(): unknown[] {
			return sdk.keysByAction.get(this) ?? [];
		}
	},
}));

const { AddToPlaylistAction, PlayPlaylistAction } = await import("../src/actions/playlist-actions");

const GYM = pid("Gym1");
const GYM_TWO = pid("Gym2");
const FOLLOWED = pid("Followed");
const settingsFor = (id: string, name = "Gym"): Record<string, unknown> => ({ playlistId: id, playlistUri: `spotify:playlist:${id}`, playlistName: name });

function fakeKey(id: string, settings: Record<string, unknown> = {}) {
	const key = {
		id,
		settings,
		isKey: () => true,
		setImage: vi.fn((_image: string) => Promise.resolve()),
		setTitle: vi.fn((_title: string) => Promise.resolve()),
		setSettings: vi.fn((next: Record<string, unknown>) => {
			key.settings = next;
			return Promise.resolve();
		}),
		showAlert: vi.fn(() => Promise.resolve()),
		showOk: vi.fn(() => Promise.resolve()),
	};
	return key;
}
type FakeKey = ReturnType<typeof fakeKey>;

function setup(options: Parameters<typeof playlistSetup>[0] = {}) {
	const ctx = playlistSetup({
		playlists: [
			playlist("Gym1", { name: "Gym", public: true, items: [] }),
			playlist("Gym2", { name: "Gym", public: false }),
			playlist("Collab", { name: "Road Trip", ownerId: "friend", ownerName: "Friend", collaborative: true }),
			playlist("Followed", { name: "Top Hits", ownerId: "spotify", ownerName: "Spotify", public: true }),
		],
		...options,
	});
	const sent: PlaylistInspectorState[] = [];
	const inspector = {
		openKey: undefined as string | undefined,
		current: vi.fn(() => (inspector.openKey === undefined ? undefined : { id: inspector.openKey })),
		send: vi.fn((payload: unknown) => {
			sent.push(payload as PlaylistInspectorState);
			return Promise.resolve();
		}),
		openUrl: vi.fn(() => Promise.resolve()),
	};
	const add = new AddToPlaylistAction({ playback: ctx.playback, playlists: ctx.playlists, inspector, logger: ctx.logger });
	const play = new PlayPlaylistAction({ playback: ctx.playback, playlists: ctx.playlists, inspector, logger: ctx.logger });
	return { ...ctx, inspector, sent, add, play, last: () => sent.at(-1) };
}

type Action = { onWillAppear(ev: never): Promise<void>; onKeyDown(ev: never): Promise<void>; onSendToPlugin(ev: never): Promise<void>; onPropertyInspectorDidAppear(ev: never): Promise<void> };

async function place(action: Action, ...keys: FakeKey[]): Promise<void> {
	sdk.keysByAction.set(action, [...(sdk.keysByAction.get(action) ?? []), ...keys]);
	for (const key of keys) {
		await action.onWillAppear({ action: key, payload: { settings: key.settings } } as never);
	}
}
const press = (action: Action, key: FakeKey): Promise<void> => action.onKeyDown({ action: key, payload: { settings: key.settings } } as never);
const message = (action: Action, key: FakeKey, payload: unknown): Promise<void> => action.onSendToPlugin({ action: key, payload } as never);
const tick = async (ms = 0): Promise<void> => {
	await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
	vi.useFakeTimers({ now: Date.UTC(2026, 9, 3, 12) });
	sdk.keysByAction.clear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("playlist picker protocol", () => {
	it("accepts the four known requests", () => {
		expect(parsePlaylistInspectorRequest({ type: "deckify:playlist:list", requestId: "pi-1" })).toEqual({ type: "deckify:playlist:list", requestId: "pi-1" });
		expect(parsePlaylistInspectorRequest({ type: "deckify:playlist:refresh", requestId: "pi-2" })).toBeDefined();
		expect(parsePlaylistInspectorRequest({ type: "deckify:playlist:open", requestId: "pi-3" })).toBeDefined();
		expect(parsePlaylistInspectorRequest({ type: "deckify:playlist:select", requestId: "pi-4", playlistId: GYM, playlistUri: `spotify:playlist:${GYM}` })).toEqual({
			type: "deckify:playlist:select",
			requestId: "pi-4",
			playlistId: GYM,
			playlistUri: `spotify:playlist:${GYM}`,
		});
	});

	it.each([
		["an unknown type", { type: "deckify:playlist:delete", requestId: "x" }],
		["the account Property Inspector's type", { type: "deckify:spotify:connect", requestId: "x" }],
		["unknown keys", { type: "deckify:playlist:list", requestId: "x", url: "https://evil.example" }],
		["a bad request ID", { type: "deckify:playlist:list", requestId: "<script>" }],
		["a missing request ID", { type: "deckify:playlist:list" }],
		["a malicious playlist ID", { type: "deckify:playlist:select", requestId: "x", playlistId: "../../me/player", playlistUri: "spotify:playlist:../../me/player" }],
		["a URL instead of a URI", { type: "deckify:playlist:select", requestId: "x", playlistId: GYM, playlistUri: `https://open.spotify.com/playlist/${GYM}` }],
		["an ID and URI that do not match", { type: "deckify:playlist:select", requestId: "x", playlistId: GYM, playlistUri: `spotify:playlist:${GYM_TWO}` }],
		["a name instead of an ID", { type: "deckify:playlist:select", requestId: "x", playlistId: "Gym", playlistUri: "spotify:playlist:Gym" }],
		["not an object", "deckify:playlist:list"],
		["an array", [{ type: "deckify:playlist:list", requestId: "x" }]],
	])("rejects %s", (_name, payload) => {
		expect(parsePlaylistInspectorRequest(payload)).toBeUndefined();
	});

	it("sends the picker only sanitized display data (no tokens, Client ID, links or snapshots)", async () => {
		const ctx = setup();
		await ctx.playlists.getPlaylists();
		const state = buildInspectorState({ requestId: null, mode: "play", snapshot: ctx.playlists.state.value, userId: ME, selection: undefined, lookup: undefined });
		const text = JSON.stringify(state);
		for (const secret of [FAKE.accessToken, FAKE.refreshToken, FAKE.clientId, "snap-", "https://", "Authorization"]) {
			expect(text).not.toContain(secret);
		}
		expect(Object.keys(state.playlists[0] ?? {}).sort()).toEqual(["collaborative", "id", "itemCount", "mine", "name", "owner", "public", "uri"]);
	});

	it("offers only writable playlists for Add and all playlists for Play", async () => {
		const ctx = setup();
		await ctx.playlists.getPlaylists();
		const build = (mode: "add" | "play") =>
			buildInspectorState({ requestId: null, mode, snapshot: ctx.playlists.state.value, userId: ME, selection: undefined, lookup: undefined }).playlists.map((p) => p.name);
		expect(build("add")).toEqual(["Gym", "Gym", "Road Trip"]);
		expect(build("play")).toEqual(["Gym", "Gym", "Road Trip", "Top Hits"]);
	});
});

describe("playlist picker", () => {
	it("shows loading, then the playlists, when it opens", async () => {
		const ctx = setup();
		const key = fakeKey("k");
		await place(ctx.add, key);
		ctx.inspector.openKey = "k";
		const gate = ctx.server.gate((r) => r.url.pathname === "/v1/me/playlists");
		const opening = ctx.add.onPropertyInspectorDidAppear({ action: key } as never);
		await tick();
		expect(ctx.sent.some((s) => s.status === "loading")).toBe(true);
		gate.release();
		await opening;
		expect(ctx.last()).toMatchObject({ status: "ready", mode: "add", requestId: null });
		expect(ctx.last()?.playlists.map((p) => p.name)).toEqual(["Gym", "Gym", "Road Trip"]);
	});

	it("answers list and refresh requests with their request IDs; refresh reads Spotify again", async () => {
		const ctx = setup();
		const key = fakeKey("k");
		await place(ctx.play, key);
		ctx.inspector.openKey = "k";
		await message(ctx.play, key, { type: "deckify:playlist:list", requestId: "pi-1" });
		expect(ctx.last()).toMatchObject({ requestId: "pi-1", status: "ready" });
		const before = ctx.calls("GET", /^\/v1\/me\/playlists$/).length;
		await message(ctx.play, key, { type: "deckify:playlist:refresh", requestId: "pi-2" });
		expect(ctx.last()).toMatchObject({ requestId: "pi-2", status: "ready" });
		expect(ctx.calls("GET", /^\/v1\/me\/playlists$/).length).toBe(before + 1);
	});

	it("persists the chosen playlist by ID and URI, and keeps two playlists named Gym apart", async () => {
		const ctx = setup();
		const key = fakeKey("k");
		await place(ctx.add, key);
		ctx.inspector.openKey = "k";
		await message(ctx.add, key, { type: "deckify:playlist:list", requestId: "pi-1" });
		await message(ctx.add, key, { type: "deckify:playlist:select", requestId: "pi-2", playlistId: GYM_TWO, playlistUri: `spotify:playlist:${GYM_TWO}` });

		expect(key.setSettings).toHaveBeenLastCalledWith({ playlistId: GYM_TWO, playlistUri: `spotify:playlist:${GYM_TWO}`, playlistName: "Gym" });
		expect(ctx.last()).toMatchObject({ requestId: "pi-2", selected: { id: GYM_TWO, name: "Gym", state: "ok" } });

		ctx.server.player = playerState({ item: trackItem({ uri: tid("A") }) });
		await ctx.playback.refresh();
		await press(ctx.add, key);
		expect(ctx.server.find(GYM_TWO)?.items).toEqual([tid("A")]);
		expect(ctx.server.find(GYM)?.items).toEqual([]);
	});

	it("refuses a non-writable playlist for Add and a playlist that is not in the list", async () => {
		const ctx = setup();
		const key = fakeKey("k");
		await place(ctx.add, key);
		ctx.inspector.openKey = "k";
		await message(ctx.add, key, { type: "deckify:playlist:list", requestId: "pi-1" });
		await message(ctx.add, key, { type: "deckify:playlist:select", requestId: "pi-2", playlistId: FOLLOWED, playlistUri: `spotify:playlist:${FOLLOWED}` });
		await message(ctx.add, key, { type: "deckify:playlist:select", requestId: "pi-3", playlistId: pid("Nope"), playlistUri: `spotify:playlist:${pid("Nope")}` });
		expect(key.setSettings).not.toHaveBeenCalled();
		expect(ctx.last()).toMatchObject({ requestId: "pi-3", message: expect.stringMatching(/not available/) as unknown });
	});

	it("lets Play Playlist choose a followed playlist", async () => {
		const ctx = setup();
		const key = fakeKey("k");
		await place(ctx.play, key);
		ctx.inspector.openKey = "k";
		await message(ctx.play, key, { type: "deckify:playlist:list", requestId: "pi-1" });
		await message(ctx.play, key, { type: "deckify:playlist:select", requestId: "pi-2", playlistId: FOLLOWED, playlistUri: `spotify:playlist:${FOLLOWED}` });
		expect(key.setSettings).toHaveBeenCalledWith(expect.objectContaining({ playlistId: FOLLOWED }));
	});

	it("ignores unknown or malicious messages", async () => {
		const ctx = setup();
		const key = fakeKey("k");
		await place(ctx.add, key);
		ctx.inspector.openKey = "k";
		await message(ctx.add, key, { type: "deckify:playlist:select", requestId: "x", playlistId: "../x", playlistUri: "javascript:alert(1)" });
		await message(ctx.add, key, { type: "deckify:playlist:open", requestId: "x", url: "https://evil.example" });
		expect(key.setSettings).not.toHaveBeenCalled();
		expect(ctx.inspector.openUrl).not.toHaveBeenCalled();
		expect(ctx.sent).toHaveLength(0);
		expect(ctx.logger.lines.filter((l) => l.includes("Ignored an invalid playlist picker message"))).toHaveLength(2);
	});

	it("opens only the selected playlist's validated Spotify link", async () => {
		const ctx = setup();
		const key = fakeKey("k", settingsFor(GYM));
		await place(ctx.play, key);
		ctx.inspector.openKey = "k";
		await message(ctx.play, key, { type: "deckify:playlist:list", requestId: "pi-1" });
		await message(ctx.play, key, { type: "deckify:playlist:open", requestId: "pi-2" });
		expect(ctx.inspector.openUrl).toHaveBeenCalledWith(`https://open.spotify.com/playlist/${GYM}`);
	});

	it("never opens a link Spotify sent for another site", async () => {
		const ctx = setup();
		ctx.server.respondOnce(
			(r) => r.url.pathname === "/v1/me/playlists",
			() =>
				json(200, {
					items: [{ id: GYM, name: "Gym", owner: { id: ME }, collaborative: false, external_urls: { spotify: "https://evil.example/playlist/x" } }],
					total: 1,
				}),
		);
		const key = fakeKey("k", settingsFor(GYM));
		await place(ctx.play, key);
		ctx.inspector.openKey = "k";
		await message(ctx.play, key, { type: "deckify:playlist:list", requestId: "pi-1" });
		expect(ctx.last()?.selected?.canOpen).toBe(false);
		await message(ctx.play, key, { type: "deckify:playlist:open", requestId: "pi-2" });
		expect(ctx.inspector.openUrl).not.toHaveBeenCalled();
	});

	it("answers only the Property Inspector of the key that asked", async () => {
		const ctx = setup();
		const key = fakeKey("k");
		await place(ctx.add, key);
		ctx.inspector.openKey = "another-key";
		await message(ctx.add, key, { type: "deckify:playlist:list", requestId: "pi-1" });
		expect(ctx.sent).toHaveLength(0);
	});

	it.each([
		["signed out", { connected: false }, "signed-out"],
	] as const)("reports %s", async (_name, options, status) => {
		const ctx = setup(options);
		const key = fakeKey("k");
		await place(ctx.add, key);
		ctx.inspector.openKey = "k";
		await message(ctx.add, key, { type: "deckify:playlist:list", requestId: "pi-1" });
		expect(ctx.last()).toMatchObject({ status, playlists: [] });
	});

	it("reports Reconnect, rate limits and errors cleanly", async () => {
		const ctx = setup();
		const key = fakeKey("k");
		await place(ctx.add, key);
		ctx.inspector.openKey = "k";

		ctx.server.respondOnce(
			(r) => r.url.pathname === "/v1/me/playlists",
			() => json(500, { error: { status: 500, message: "down" } }),
		);
		await message(ctx.add, key, { type: "deckify:playlist:refresh", requestId: "pi-1" });
		expect(ctx.last()).toMatchObject({ requestId: "pi-1", status: "error" });
		// The list loaded earlier stays available while Spotify is down.
		expect(ctx.last()?.playlists.length).toBeGreaterThan(0);

		ctx.server.respondOnce(
			(r) => r.url.pathname === "/v1/me/playlists",
			() => json(429, { error: { status: 429, message: "slow" } }, { "Retry-After": "30" }),
		);
		await message(ctx.add, key, { type: "deckify:playlist:refresh", requestId: "pi-2" });
		expect(ctx.last()).toMatchObject({ requestId: "pi-2", status: "limited", retryAfterSeconds: 30 });

		ctx.auth.update({ status: "reauthorization-required", profile: undefined });
		await message(ctx.add, key, { type: "deckify:playlist:list", requestId: "pi-3" });
		expect(ctx.last()).toMatchObject({ requestId: "pi-3", status: "reauthorization-required" });
	});
});

describe("Add to Playlist key", () => {
	it("asks to choose a playlist when none (or an invalid one) is set, and sends nothing on press", async () => {
		const ctx = setup();
		const none = fakeKey("a");
		const invalid = fakeKey("b", { playlistId: "Gym", playlistUri: "https://evil.example" });
		await place(ctx.add, none, invalid);
		await tick();
		for (const key of [none, invalid]) {
			expect(key.setTitle).toHaveBeenLastCalledWith("Choose\nPlaylist");
			expect(key.setImage).toHaveBeenLastCalledWith("imgs/actions/playlist/add-disabled.svg");
			await press(ctx.add, key);
			expect(key.showAlert).toHaveBeenCalledTimes(1);
		}
		expect(ctx.calls("POST", /items$/)).toHaveLength(0);
	});

	it("shows the playlist name, adds the song with brief Added feedback, then Already Added", async () => {
		const ctx = setup();
		const key = fakeKey("k", settingsFor(GYM));
		await place(ctx.add, key);
		await tick();
		expect(key.setTitle).toHaveBeenLastCalledWith("Gym");
		expect(key.setImage).toHaveBeenLastCalledWith("imgs/actions/playlist/add.svg");

		await press(ctx.add, key);
		expect(key.setTitle).toHaveBeenLastCalledWith("Added");
		expect(key.showOk).toHaveBeenCalledTimes(1);
		await tick(1_600);
		expect(key.setTitle).toHaveBeenLastCalledWith("Gym");

		await press(ctx.add, key);
		expect(key.setTitle).toHaveBeenLastCalledWith("Already\nAdded");
		expect(key.showAlert).not.toHaveBeenCalled();
		expect(ctx.server.find(GYM)?.items).toEqual([tid("A")]);
	});

	it("adds the song that was playing at the press, even when Next lands before Spotify answers", async () => {
		const ctx = setup();
		const key = fakeKey("k", settingsFor(GYM));
		await place(ctx.add, key);
		await tick();
		const gate = ctx.server.gate((r) => r.method === "POST");
		const pressing = press(ctx.add, key);
		await tick();
		ctx.server.player = playerState({ item: trackItem({ uri: tid("B"), id: "trB" }) });
		await ctx.playback.refresh();
		gate.release();
		await pressing;
		expect(ctx.server.find(GYM)?.items).toEqual([tid("A")]);
	});

	it("shows Track Only for an episode and never changes the playlist", async () => {
		const ctx = setup();
		ctx.server.player = playerState({ item: episodeItem(), currently_playing_type: "episode" });
		const key = fakeKey("k", settingsFor(GYM));
		await place(ctx.add, key);
		await tick();
		expect(key.setTitle).toHaveBeenLastCalledWith("Track Only");
		await press(ctx.add, key);
		expect(key.showAlert).toHaveBeenCalledTimes(1);
		expect(ctx.requests.filter((r) => r.url.pathname.startsWith("/v1/playlists/"))).toHaveLength(0);
	});

	it("shows Unavailable for a deleted or no longer writable playlist and never switches to another one", async () => {
		const ctx = setup();
		const deleted = fakeKey("a", settingsFor(pid("Deleted")));
		const followed = fakeKey("b", settingsFor(FOLLOWED, "Top Hits"));
		await place(ctx.add, deleted, followed);
		await tick();
		expect(deleted.setTitle).toHaveBeenLastCalledWith("Unavailable");
		expect(followed.setTitle).toHaveBeenLastCalledWith("Unavailable");
		await press(ctx.add, deleted);
		expect(deleted.showAlert).toHaveBeenCalledTimes(1);
		expect(deleted.setSettings).not.toHaveBeenCalled();
		expect(ctx.calls("POST", /items$/)).toHaveLength(0);
	});

	it("updates the cached name when the playlist is renamed, keeping the same ID", async () => {
		const ctx = setup();
		const key = fakeKey("k", settingsFor(GYM));
		await place(ctx.add, key);
		await tick();
		const gym = ctx.server.find(GYM);
		if (gym) {
			gym.name = "Gym 2026";
		}
		await ctx.playlists.getPlaylists({ force: true });
		await tick();
		expect(key.setSettings).toHaveBeenLastCalledWith({ playlistId: GYM, playlistUri: `spotify:playlist:${GYM}`, playlistName: "Gym 2026" });
		expect(key.setTitle).toHaveBeenLastCalledWith("Gym 2026");
	});

	it("shows Connect, Reconnect and Premium like the other keys", async () => {
		const signedOut = setup({ connected: false });
		const key = fakeKey("k", settingsFor(GYM));
		await place(signedOut.add, key);
		expect(key.setTitle).toHaveBeenLastCalledWith("Connect");
		signedOut.auth.update({ status: "reauthorization-required" });
		await tick();
		expect(key.setTitle).toHaveBeenLastCalledWith("Reconnect");

		const free = setup({ product: "free" });
		const other = fakeKey("k2", settingsFor(GYM));
		await place(free.add, other);
		await tick();
		expect(other.setTitle).toHaveBeenLastCalledWith("Premium");
	});
});

describe("Play Playlist key", () => {
	it("starts its own playlist with brief Started feedback; another key starts its own", async () => {
		const ctx = setup();
		const first = fakeKey("a", settingsFor(GYM));
		const second = fakeKey("b", settingsFor(FOLLOWED, "Top Hits"));
		await place(ctx.play, first, second);
		await tick();
		expect(first.setTitle).toHaveBeenLastCalledWith("Gym");
		expect(second.setTitle).toHaveBeenLastCalledWith("Top Hits");

		await press(ctx.play, first);
		expect(first.setTitle).toHaveBeenLastCalledWith("Started");
		await tick(1_600);
		await press(ctx.play, second);
		expect(ctx.server.played).toEqual([{ context_uri: `spotify:playlist:${GYM}` }, { context_uri: `spotify:playlist:${FOLLOWED}` }]);
	});

	it("shows No Device and alerts when nothing is active", async () => {
		const ctx = setup();
		ctx.server.player = undefined;
		const key = fakeKey("k", settingsFor(GYM));
		await place(ctx.play, key);
		await tick();
		expect(key.setTitle).toHaveBeenLastCalledWith("No Device");
		await press(ctx.play, key);
		expect(key.showAlert).toHaveBeenCalledTimes(1);
		expect(ctx.server.played).toEqual([]);
	});

	it("asks to choose a playlist without a selection", async () => {
		const ctx = setup();
		const key = fakeKey("k");
		await place(ctx.play, key);
		expect(key.setTitle).toHaveBeenLastCalledWith("Choose\nPlaylist");
		expect(key.setImage).toHaveBeenLastCalledWith("imgs/actions/playlist/play-disabled.svg");
	});
});

describe("key titles", () => {
	it("keeps short names, wraps longer ones to two lines and never alters the stored name", () => {
		expect(playlistKeyTitle("Gym")).toBe("Gym");
		expect(playlistKeyTitle("Road Trip Mix")).toBe("Road Trip\nMix");
		expect(playlistKeyTitle("A very long playlist name indeed")).toBe("A very\nlong play…");
		expect(playlistKeyTitle("   ")).toBe("Playlist");
	});
});
