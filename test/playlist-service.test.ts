import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryItemUnsupportedError } from "../src/library/errors";
import { PlaybackUnavailableError } from "../src/playback/errors";
import { PlaybackService } from "../src/playback/service";
import type { PlaybackTransport } from "../src/playback/transport";
import type { LocalPlaybackCommandTransport } from "../src/playback/local-commands";
import { PlaylistNotSelectedError, PlaylistNotWritableError, PlaylistUnavailableError } from "../src/playlists/errors";
import type { PlaylistMetadata } from "../src/playlists/model";
import { normalizePlaylistSelection, type PlaylistSelection } from "../src/playlists/selection";
import { PlaylistService } from "../src/playlists/service";
import type { PlaylistListPage, PlaylistTransport } from "../src/playlists/transport";
import { SPOTIFY_SCOPES } from "../src/spotify/auth/scopes";
import {
	SpotifyDeviceRestrictedError,
	SpotifyForbiddenError,
	SpotifyInvalidResponseError,
	SpotifyNoActiveDeviceError,
	SpotifyPremiumRequiredError,
	SpotifyRateLimitError,
	SpotifyUnauthorizedError,
} from "../src/spotify/errors";
import { SpotifyAuthState } from "../src/spotify/state/auth-state";
import { json } from "./helpers";
import { DEVICE, playerState, trackItem } from "./playback-fixtures";
import { ME, pid, playlist, playlistSetup, tid, type FakePlaylist } from "./playlist-fixtures";

const sel = (id: string): PlaylistSelection => {
	const selection = normalizePlaylistSelection({ playlistId: id, playlistUri: `spotify:playlist:${id}` });
	if (selection === undefined) {
		throw new Error("invalid test selection");
	}
	return selection;
};
const tick = async (ms = 0): Promise<void> => {
	await vi.advanceTimersByTimeAsync(ms);
};
const ITEMS = /^\/v1\/playlists\/[A-Za-z0-9]{22}\/items$/;
const SINGLE = /^\/v1\/playlists\/[A-Za-z0-9]{22}$/;
const LIST = /^\/v1\/me\/playlists$/;

/** A library: owned public + owned private + collaborative (other owner) + followed public (other owner). */
function library(): FakePlaylist[] {
	return [
		playlist("OwnPub", { name: "Gym", public: true }),
		playlist("OwnPriv", { name: "Driving", public: false }),
		playlist("Collab", { name: "Road Trip", ownerId: "friend", ownerName: "Friend", public: false, collaborative: true }),
		playlist("Followed", { name: "Top Hits", ownerId: "spotify", ownerName: "Spotify", public: true }),
	];
}

beforeEach(() => {
	vi.useFakeTimers({ now: Date.UTC(2026, 9, 3, 12) });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("playlist listing", () => {
	it("reads GET /v1/me/playlists with limit=50", async () => {
		const ctx = playlistSetup({ playlists: library() });
		const playlists = await ctx.playlists.getPlaylists();
		expect(ctx.calls("GET", LIST).map((r) => r.url.search)).toEqual(["?limit=50&offset=0"]);
		expect(playlists.map((p) => p.name)).toEqual(["Gym", "Driving", "Road Trip", "Top Hits"]);
		expect(ctx.playlists.state.value.status).toBe("ready");
	});

	it("reads every page beyond 50 playlists and keeps Spotify's order", async () => {
		const many = Array.from({ length: 120 }, (_, i) => playlist(`P${String(i)}`, { name: `List ${String(i)}` }));
		const ctx = playlistSetup({ playlists: many });
		const playlists = await ctx.playlists.getPlaylists();
		expect(ctx.calls("GET", LIST).map((r) => r.url.searchParams.get("offset"))).toEqual(["0", "50", "100"]);
		expect(playlists).toHaveLength(120);
		expect(playlists.map((p) => p.name)).toEqual(many.map((p) => p.name));
	});

	it("skips malformed entries and keeps the valid ones", async () => {
		const ctx = playlistSetup();
		const good = { id: pid("Good"), name: "Good", owner: { id: ME }, collaborative: false, public: true, snapshot_id: "s" };
		ctx.server.respondOnce(
			(r) => LIST.test(r.url.pathname),
			() =>
				json(200, {
					items: [
						null,
						"junk",
						{ name: "no id" },
						{ id: "short", name: "bad id" },
						{ id: pid("BadUri"), uri: "spotify:playlist:somethingElse0000000000", name: "wrong uri" },
						{ id: pid("NoName"), name: 42 },
						good,
						{ ...good, name: "duplicate id" },
						{ id: pid("Odd"), name: "odd fields", owner: null, public: "yes", collaborative: "true", items: null, external_urls: { spotify: "https://evil.example/x" } },
					],
					total: 9,
				}),
		);
		const playlists = await ctx.playlists.getPlaylists();
		expect(playlists.map((p) => p.id)).toEqual([pid("Good"), pid("Odd")]);
		expect(playlists[1]).toMatchObject({ ownerId: undefined, public: undefined, collaborative: false, itemCount: undefined, spotifyUrl: undefined, writable: false });
	});

	it("reuses the list for five minutes, then reads it again", async () => {
		const ctx = playlistSetup({ playlists: library() });
		await ctx.playlists.getPlaylists();
		await ctx.playlists.getPlaylists();
		expect(ctx.calls("GET", LIST)).toHaveLength(1);
		await tick(5 * 60_000 + 1);
		await ctx.playlists.getPlaylists();
		expect(ctx.calls("GET", LIST)).toHaveLength(2);
	});

	it("Refresh bypasses the cache", async () => {
		const ctx = playlistSetup({ playlists: library() });
		await ctx.playlists.getPlaylists();
		ctx.server.playlists.push(playlist("New", { name: "New One" }));
		const refreshed = await ctx.playlists.getPlaylists({ force: true });
		expect(ctx.calls("GET", LIST)).toHaveLength(2);
		expect(refreshed.map((p) => p.name)).toContain("New One");
	});

	it("shares one fetch between simultaneous requests", async () => {
		const ctx = playlistSetup({ playlists: library() });
		const gate = ctx.server.gate((r) => LIST.test(r.url.pathname));
		const first = ctx.playlists.getPlaylists();
		const second = ctx.playlists.getPlaylists();
		await tick();
		expect(ctx.playlists.state.value.status).toBe("loading");
		gate.release();
		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
		expect(ctx.calls("GET", LIST)).toHaveLength(1);
	});

	it.each([
		["a reconnect", (ctx: ReturnType<typeof playlistSetup>) => (ctx.auth.update({ status: "reauthorization-required" }), ctx.connect())],
		["a disconnect and connect", (ctx: ReturnType<typeof playlistSetup>) => (ctx.auth.update({ status: "disconnected", profile: undefined }), ctx.connect())],
		["a session reset after 401", (ctx: ReturnType<typeof playlistSetup>) => (ctx.auth.update({ status: "error", profile: undefined }), ctx.connect())],
	])("clears the cache on %s", async (_name, change) => {
		const ctx = playlistSetup({ playlists: library() });
		await ctx.playlists.getPlaylists();
		change(ctx);
		expect(ctx.playlists.state.value.playlists).toBeUndefined();
		await ctx.playlists.getPlaylists();
		expect(ctx.calls("GET", LIST)).toHaveLength(2);
	});

	it("clears the list on disconnect and refuses while signed out", async () => {
		const ctx = playlistSetup({ playlists: library() });
		await ctx.playlists.getPlaylists();
		ctx.auth.update({ status: "disconnected", profile: undefined });
		expect(ctx.playlists.state.value).toMatchObject({ status: "signed-out", playlists: undefined });
		await expect(ctx.playlists.getPlaylists()).rejects.toBeInstanceOf(PlaybackUnavailableError);
	});

	it("never keeps user A's playlists after user B connects", async () => {
		const ctx = playlistSetup({ playlists: library() });
		const forA = await ctx.playlists.getPlaylists();
		expect(forA.find((p) => p.name === "Gym")?.writable).toBe(true);

		ctx.connect("user-b");
		expect(ctx.playlists.state.value.playlists).toBeUndefined();
		const forB = await ctx.playlists.getPlaylists();
		expect(ctx.calls("GET", LIST)).toHaveLength(2);
		// The same playlists are now judged for user B: only the collaborative one is writable.
		expect(forB.filter((p) => p.writable).map((p) => p.name)).toEqual(["Road Trip"]);
	});

	it("discards a fetch that was still running when the account changed", async () => {
		const ctx = playlistSetup({ playlists: library() });
		const gate = ctx.server.gate((r) => LIST.test(r.url.pathname));
		const stale = ctx.playlists.getPlaylists();
		await tick();
		ctx.connect("user-b");
		gate.release();
		await expect(stale).rejects.toThrow();
		expect(ctx.playlists.state.value.playlists).toBeUndefined();
	});

	it("never lets an older, slower refresh replace a newer one", async () => {
		const deferred: { resolve: (page: PlaylistListPage) => void }[] = [];
		const transport: PlaylistTransport = {
			id: "fake",
			listPlaylists: () => new Promise((resolve) => deferred.push({ resolve })),
			getPlaylist: () => Promise.reject(new Error("unused")),
			listItems: () => Promise.reject(new Error("unused")),
			addItem: () => Promise.reject(new Error("unused")),
		};
		const auth = new SpotifyAuthState();
		auth.update({ status: "connected", profile: { id: ME, displayName: ME, product: "premium" }, authorizedAt: 1 });
		const playbackStub = { state: new PlaybackService({ transport: {} as PlaybackTransport, auth }).state, playContext: vi.fn() };
		const service = new PlaylistService({ transport, auth, playback: playbackStub, clock: () => Date.now() });
		const meta = (name: string): PlaylistMetadata => ({
			id: pid(name),
			uri: `spotify:playlist:${pid(name)}`,
			name,
			ownerId: ME,
			ownerDisplayName: "Me",
			public: true,
			collaborative: false,
			snapshotId: "s",
			itemCount: 0,
			spotifyUrl: undefined,
		});

		const refreshA = service.getPlaylists({ force: true });
		const refreshB = service.getPlaylists({ force: true });
		deferred[1]?.resolve({ playlists: [meta("Newer")], entryCount: 1, total: 1 });
		await refreshB;
		deferred[0]?.resolve({ playlists: [meta("Older")], entryCount: 1, total: 1 });
		await expect(refreshA).resolves.toEqual([expect.objectContaining({ name: "Newer" })]);
		expect(service.state.value.playlists?.map((p) => p.name)).toEqual(["Newer"]);
	});

	it("requests all four playlist scopes", () => {
		expect(SPOTIFY_SCOPES).toEqual(expect.arrayContaining(["playlist-read-private", "playlist-read-collaborative", "playlist-modify-public", "playlist-modify-private"]));
	});
});

describe("writable playlists", () => {
	it("owned public, owned private and collaborative playlists are writable; a followed public playlist is not", async () => {
		const ctx = playlistSetup({ playlists: library() });
		const playlists = await ctx.playlists.getPlaylists();
		const writable = Object.fromEntries(playlists.map((p) => [p.name, p.writable]));
		expect(writable).toEqual({ Gym: true, Driving: true, "Road Trip": true, "Top Hits": false });
	});

	it("never decides by the name: two playlists named Gym stay distinct by ID", async () => {
		const ctx = playlistSetup({
			playlists: [playlist("Gym1", { name: "Gym" }), playlist("Gym2", { name: "Gym", ownerId: "friend", ownerName: "Friend", public: true })],
		});
		const playlists = await ctx.playlists.getPlaylists();
		expect(playlists.map((p) => [p.id, p.name, p.writable, p.ownerDisplayName])).toEqual([
			[pid("Gym1"), "Gym", true, "Me"],
			[pid("Gym2"), "Gym", false, "Friend"],
		]);
	});
});

describe("Add Current Track to Playlist", () => {
	const A = tid("A");
	const B = tid("B");

	it("appends the captured track with POST /v1/playlists/{id}/items and exactly that URI (never /tracks)", async () => {
		const ctx = playlistSetup({ playlists: library() });
		await expect(ctx.playlists.addTrack(sel(pid("OwnPub")), A)).resolves.toBe("added");

		const posts = ctx.calls("POST", ITEMS);
		expect(posts).toHaveLength(1);
		expect(posts[0]?.url.pathname).toBe(`/v1/playlists/${pid("OwnPub")}/items`);
		expect(JSON.parse(posts[0]?.body ?? "")).toEqual({ uris: [A] });
		expect(ctx.server.find(pid("OwnPub"))?.items).toEqual([A]);
		expect(ctx.requests.every((r) => !r.url.pathname.includes("/tracks"))).toBe(true);
		expect(ctx.logger.lines).toContain("info Playlist item added.");
	});

	it("reads items with limit=50 and only the item URIs", async () => {
		const ctx = playlistSetup({ playlists: library() });
		await ctx.playlists.addTrack(sel(pid("OwnPub")), A);
		const scan = ctx.calls("GET", ITEMS)[0];
		expect(scan?.url.searchParams.get("limit")).toBe("50");
		expect(scan?.url.searchParams.get("fields")).toBe("total,items(item(uri))");
		expect(ctx.calls("GET", SINGLE)[0]?.url.searchParams.get("fields")).not.toMatch(/items|tracks/);
	});

	it.each([
		["owned private", "OwnPriv"],
		["collaborative", "Collab"],
	])("adds to an %s playlist", async (_name, label) => {
		const ctx = playlistSetup({ playlists: library() });
		await expect(ctx.playlists.addTrack(sel(pid(label)), A)).resolves.toBe("added");
	});

	it.each([
		["an episode", "spotify:episode:ep00000000000000000000"],
		["an ad (no URI)", undefined],
		["a local file", "spotify:local:Artist:Album:Song:180"],
		["a missing URI", ""],
		["something that is not a track", "spotify:playlist:" + pid("X")],
	])("refuses %s without any request", async (_name, uri) => {
		const ctx = playlistSetup({ playlists: library() });
		await expect(ctx.playlists.addTrack(sel(pid("OwnPub")), uri)).rejects.toBeInstanceOf(LibraryItemUnsupportedError);
		expect(ctx.requests).toHaveLength(0);
	});

	it("refuses without a selected playlist", async () => {
		const ctx = playlistSetup({ playlists: library() });
		await expect(ctx.playlists.addTrack(undefined, A)).rejects.toBeInstanceOf(PlaylistNotSelectedError);
		expect(ctx.requests).toHaveLength(0);
	});

	it("reports a deleted playlist as unavailable and never picks another one", async () => {
		const ctx = playlistSetup({ playlists: library() });
		await ctx.playlists.getPlaylists();
		ctx.server.playlists = ctx.server.playlists.filter((p) => p.name !== "Gym");
		await expect(ctx.playlists.addTrack(sel(pid("OwnPub")), A)).rejects.toBeInstanceOf(PlaylistUnavailableError);
		expect(ctx.calls("POST", ITEMS)).toHaveLength(0);
		expect(ctx.playlists.lookup(pid("OwnPub")).status).toBe("missing");
	});

	it("refuses a playlist that is no longer writable", async () => {
		const ctx = playlistSetup({ playlists: library() });
		const gym = ctx.server.find(pid("OwnPub"));
		if (gym) {
			gym.ownerId = "someone-else";
		}
		await expect(ctx.playlists.addTrack(sel(pid("OwnPub")), A)).rejects.toBeInstanceOf(PlaylistNotWritableError);
		expect(ctx.calls("POST", ITEMS)).toHaveLength(0);
		await expect(ctx.playlists.addTrack(sel(pid("Followed")), A)).rejects.toBeInstanceOf(PlaylistNotWritableError);
	});

	it("does not add a track that is already in the playlist", async () => {
		const ctx = playlistSetup({ playlists: [playlist("Gym", { items: [B, A] })] });
		await expect(ctx.playlists.addTrack(sel(pid("Gym")), A)).resolves.toBe("already-present");
		expect(ctx.calls("POST", ITEMS)).toHaveLength(0);
		expect(ctx.logger.lines).toContain("info Playlist item already present.");
	});

	it("finds a duplicate beyond the first 50 items", async () => {
		const items = Array.from({ length: 120 }, (_, i) => tid(`x${String(i)}`));
		items[110] = A;
		const ctx = playlistSetup({ playlists: [playlist("Big", { items })] });
		await expect(ctx.playlists.addTrack(sel(pid("Big")), A)).resolves.toBe("already-present");
		expect(ctx.calls("GET", ITEMS).map((r) => r.url.searchParams.get("offset"))).toEqual(["0", "50", "100"]);
		expect(ctx.calls("POST", ITEMS)).toHaveLength(0);
	});

	it("reuses the cached items while the snapshot is unchanged and updates the cache after its own add", async () => {
		const ctx = playlistSetup({ playlists: [playlist("Gym", { items: [B] })] });
		await ctx.playlists.addTrack(sel(pid("Gym")), A);
		expect(ctx.calls("GET", ITEMS)).toHaveLength(1);

		// The new snapshot from the POST matches the playlist's: no rescan, and A is known to be there now.
		await expect(ctx.playlists.addTrack(sel(pid("Gym")), A)).resolves.toBe("already-present");
		await expect(ctx.playlists.addTrack(sel(pid("Gym")), tid("C"))).resolves.toBe("added");
		expect(ctx.calls("GET", ITEMS)).toHaveLength(1);
		expect(ctx.server.find(pid("Gym"))?.items).toEqual([B, A, tid("C")]);
	});

	it("rescans when the snapshot changed outside Deckify", async () => {
		const ctx = playlistSetup({ playlists: [playlist("Gym")] });
		await ctx.playlists.addTrack(sel(pid("Gym")), A);
		const gym = ctx.server.find(pid("Gym"));
		if (gym) {
			// Added in the Spotify app: new snapshot.
			gym.items.push(B);
			gym.snapshot++;
		}
		await expect(ctx.playlists.addTrack(sel(pid("Gym")), B)).resolves.toBe("already-present");
		expect(ctx.calls("GET", ITEMS)).toHaveLength(2);
		expect(gym?.items).toEqual([A, B]);
	});

	it("ignores a second press for the same playlist while the first is running (never two copies)", async () => {
		const ctx = playlistSetup({ playlists: [playlist("Gym")] });
		const gate = ctx.server.gate((r) => r.method === "POST");
		const first = ctx.playlists.addTrack(sel(pid("Gym")), A);
		await tick();
		expect(ctx.playlists.state.value.adding.has(pid("Gym"))).toBe(true);
		await expect(ctx.playlists.addTrack(sel(pid("Gym")), A)).resolves.toBe("busy");
		gate.release();
		await expect(first).resolves.toBe("added");
		expect(ctx.calls("POST", ITEMS)).toHaveLength(1);
		expect(ctx.server.find(pid("Gym"))?.items).toEqual([A]);
	});

	it("adds the captured track even if another track starts while the request runs", async () => {
		const ctx = playlistSetup({ playlists: [playlist("Gym")] });
		const gate = ctx.server.gate((r) => r.method === "POST");
		const add = ctx.playlists.addTrack(sel(pid("Gym")), A);
		await tick();
		ctx.server.player = playerState({ item: trackItem({ uri: B, id: "trB" }) });
		await ctx.playback.refresh();
		gate.release();
		await add;
		expect(ctx.server.find(pid("Gym"))?.items).toEqual([A]);
	});

	it("refreshes the token once and retries once on 401", async () => {
		const ctx = playlistSetup({ playlists: [playlist("Gym")] });
		ctx.server.respondOnce(
			(r) => SINGLE.test(r.url.pathname),
			() => json(401, { error: { status: 401, message: "expired" } }),
		);
		await expect(ctx.playlists.addTrack(sel(pid("Gym")), A)).resolves.toBe("added");
		expect(ctx.tokens.refreshAccessToken).toHaveBeenCalledTimes(1);
		expect(ctx.calls("GET", SINGLE)).toHaveLength(2);
	});

	it("starts the existing session recovery on a persistent 401 and adds nothing", async () => {
		const ctx = playlistSetup({ playlists: [playlist("Gym")] });
		ctx.server.respondAlways(
			() => true,
			() => json(401, { error: { status: 401, message: "revoked" } }),
		);
		await expect(ctx.playlists.addTrack(sel(pid("Gym")), A)).rejects.toBeInstanceOf(SpotifyUnauthorizedError);
		expect(ctx.onAuthRejected).toHaveBeenCalledTimes(1);
		expect(ctx.requests).toHaveLength(2);
		expect(ctx.server.find(pid("Gym"))?.items).toEqual([]);
	});

	it("surfaces 403 without retrying", async () => {
		const ctx = playlistSetup({ playlists: [playlist("Gym")] });
		ctx.server.respondOnce(
			(r) => r.method === "POST",
			() => json(403, { error: { status: 403, message: "Forbidden" } }),
		);
		await expect(ctx.playlists.addTrack(sel(pid("Gym")), A)).rejects.toBeInstanceOf(SpotifyForbiddenError);
		expect(ctx.calls("POST", ITEMS)).toHaveLength(1);
	});

	it("backs off after 429 (Retry-After), shows Limited, and works again afterwards", async () => {
		const ctx = playlistSetup({ playlists: [playlist("Gym")] });
		ctx.server.respondOnce(
			(r) => SINGLE.test(r.url.pathname),
			() => json(429, { error: { status: 429, message: "slow down" } }, { "Retry-After": "20" }),
		);
		await expect(ctx.playlists.addTrack(sel(pid("Gym")), A)).rejects.toBeInstanceOf(SpotifyRateLimitError);
		expect(ctx.playlists.state.value).toMatchObject({ status: "limited", retryAfterSeconds: 20 });

		await expect(ctx.playlists.addTrack(sel(pid("Gym")), A)).rejects.toBeInstanceOf(SpotifyRateLimitError);
		expect(ctx.requests).toHaveLength(1);
		// Playback is not limited by the playlist back-off.
		expect(ctx.playback.state.value.notice?.code).not.toBe("rate-limited");

		await tick(20_000);
		expect(ctx.playlists.state.value.status).not.toBe("limited");
		await expect(ctx.playlists.addTrack(sel(pid("Gym")), A)).resolves.toBe("added");
	});

	it("refuses a malformed playlist response without adding", async () => {
		const ctx = playlistSetup({ playlists: [playlist("Gym")] });
		ctx.server.respondOnce(
			(r) => SINGLE.test(r.url.pathname),
			() => json(200, { id: pid("Other"), name: "x" }),
		);
		await expect(ctx.playlists.addTrack(sel(pid("Gym")), A)).rejects.toBeInstanceOf(SpotifyInvalidResponseError);
		expect(ctx.calls("POST", ITEMS)).toHaveLength(0);
	});

	it.each([
		["an item without a URI", { items: [{ item: { name: "no uri" } }], total: 1 }],
		["entries it cannot read at all", { items: [{}, {}], total: 2 }],
		["a missing items array", { total: 3 }],
	])("fails closed on %s instead of risking a duplicate", async (_name, body) => {
		const ctx = playlistSetup({ playlists: [playlist("Gym", { items: [A] })] });
		ctx.server.respondOnce(
			(r) => r.method === "GET" && ITEMS.test(r.url.pathname),
			() => json(200, body),
		);
		await expect(ctx.playlists.addTrack(sel(pid("Gym")), B)).rejects.toBeInstanceOf(SpotifyInvalidResponseError);
		expect(ctx.calls("POST", ITEMS)).toHaveLength(0);
	});

	it("skips unavailable (null) items and still detects duplicates among the rest", async () => {
		const ctx = playlistSetup({ playlists: [playlist("Gym")] });
		ctx.server.respondOnce(
			(r) => r.method === "GET" && ITEMS.test(r.url.pathname),
			() => json(200, { items: [{ item: null }, {}, { item: { uri: A } }], total: 3 }),
		);
		await expect(ctx.playlists.addTrack(sel(pid("Gym")), A)).resolves.toBe("already-present");
	});

	it("forgets cached items when Spotify reconnects", async () => {
		const ctx = playlistSetup({ playlists: [playlist("Gym")] });
		await ctx.playlists.addTrack(sel(pid("Gym")), A);
		ctx.auth.update({ status: "reauthorization-required", profile: undefined });
		ctx.connect();
		await ctx.playlists.addTrack(sel(pid("Gym")), A);
		expect(ctx.calls("GET", ITEMS)).toHaveLength(2);
		expect(ctx.server.find(pid("Gym"))?.items).toEqual([A]);
	});

	it("requires a connected Premium account", async () => {
		const free = playlistSetup({ playlists: [playlist("Gym")], product: "free" });
		await expect(free.playlists.addTrack(sel(pid("Gym")), A)).rejects.toBeInstanceOf(SpotifyPremiumRequiredError);
		const signedOut = playlistSetup({ playlists: [playlist("Gym")], connected: false });
		await expect(signedOut.playlists.addTrack(sel(pid("Gym")), A)).rejects.toBeInstanceOf(PlaybackUnavailableError);
		expect([...free.requests, ...signedOut.requests]).toHaveLength(0);
	});

	it("logs no playlist or track details", async () => {
		const ctx = playlistSetup({ playlists: library() });
		await ctx.playlists.getPlaylists();
		await ctx.playlists.addTrack(sel(pid("OwnPub")), A);
		await ctx.playlists.addTrack(sel(pid("OwnPub")), A);
		ctx.server.respondOnce(
			() => true,
			() => json(500, { error: { status: 500, message: `boom ${pid("OwnPub")}` } }),
		);
		await expect(ctx.playlists.addTrack(sel(pid("OwnPriv")), A)).rejects.toThrow();
		const log = ctx.logger.lines.join("\n");
		expect(log).not.toMatch(/spotify:|Gym|Driving|plOwn|trA|Me\b/);
		expect(log).toContain("Playlist list refreshed.");
	});
});

describe("Play Selected Playlist", () => {
	const PLAY = /^\/v1\/me\/player\/play$/;

	it("starts the playlist with PUT /v1/me/player/play and exactly its context_uri, on the active device", async () => {
		const ctx = playlistSetup({ playlists: library() });
		await expect(ctx.playlists.play(sel(pid("OwnPriv")))).resolves.toBe("done");
		const put = ctx.calls("PUT", PLAY);
		expect(put).toHaveLength(1);
		expect(put[0]?.url.search).toBe("");
		expect(JSON.parse(put[0]?.body ?? "")).toEqual({ context_uri: `spotify:playlist:${pid("OwnPriv")}` });
		expect(ctx.playback.state.value.isPlaying).toBe(true);
		expect(ctx.logger.lines).toContain("info Playlist playback started.");
	});

	it.each([
		["a followed playlist", "Followed"],
		["a private playlist", "OwnPriv"],
		["a collaborative playlist", "Collab"],
	])("plays %s", async (_name, label) => {
		const ctx = playlistSetup({ playlists: library() });
		await ctx.playlists.getPlaylists();
		await ctx.playlists.play(sel(pid(label)));
		expect(ctx.server.played).toEqual([{ context_uri: `spotify:playlist:${pid(label)}` }]);
	});

	it("plays the chosen one of two playlists with the same name", async () => {
		const ctx = playlistSetup({ playlists: [playlist("Gym1", { name: "Gym" }), playlist("Gym2", { name: "Gym" })] });
		await ctx.playlists.getPlaylists();
		await ctx.playlists.play(sel(pid("Gym2")));
		expect(ctx.server.played).toEqual([{ context_uri: `spotify:playlist:${pid("Gym2")}` }]);
	});

	it("keeps a renamed playlist selected and shows its new name after a refresh", async () => {
		const ctx = playlistSetup({ playlists: library() });
		await ctx.playlists.getPlaylists();
		const gym = ctx.server.find(pid("OwnPub"));
		if (gym) {
			gym.name = "Gym 2026";
		}
		await ctx.playlists.getPlaylists({ force: true });
		const lookup = ctx.playlists.lookup(pid("OwnPub"));
		expect(lookup).toMatchObject({ status: "found", playlist: { name: "Gym 2026" } });
		await ctx.playlists.play(sel(pid("OwnPub")));
		expect(ctx.server.played).toEqual([{ context_uri: `spotify:playlist:${pid("OwnPub")}` }]);
	});

	it("refuses without a selection", async () => {
		const ctx = playlistSetup({ playlists: library() });
		await expect(ctx.playlists.play(undefined)).rejects.toBeInstanceOf(PlaylistNotSelectedError);
		expect(ctx.requests).toHaveLength(0);
	});

	it("reports a deleted playlist as unavailable without a request when the list knows, and after a 404 otherwise", async () => {
		const ctx = playlistSetup({ playlists: library() });
		ctx.server.playlists = ctx.server.playlists.filter((p) => p.name !== "Gym");
		await ctx.playlists.getPlaylists();
		await expect(ctx.playlists.play(sel(pid("OwnPub")))).rejects.toBeInstanceOf(PlaylistUnavailableError);
		expect(ctx.calls("PUT", PLAY)).toHaveLength(0);

		const unknown = playlistSetup({ playlists: library() });
		unknown.server.respondOnce(
			(r) => PLAY.test(r.url.pathname),
			() => json(404, { error: { status: 404, message: "Not found." } }),
		);
		await expect(unknown.playlists.play(sel(pid("Gone")))).rejects.toBeInstanceOf(PlaylistUnavailableError);
		expect(unknown.playlists.lookup(pid("Gone")).status).toBe("missing");
		// A missing playlist says nothing about the player.
		expect(unknown.playback.state.value.notice).toBeUndefined();
	});

	it("shows No Device without a request when nothing is active", async () => {
		const ctx = playlistSetup({ playlists: library() });
		ctx.server.player = undefined;
		await expect(ctx.playlists.play(sel(pid("OwnPub")))).rejects.toBeInstanceOf(SpotifyNoActiveDeviceError);
		expect(ctx.calls("PUT", PLAY)).toHaveLength(0);
	});

	it("keeps the restricted-device behavior", async () => {
		const ctx = playlistSetup({ playlists: library() });
		ctx.server.player = playerState({ device: { ...DEVICE, is_restricted: true } });
		await expect(ctx.playlists.play(sel(pid("OwnPub")))).rejects.toBeInstanceOf(SpotifyDeviceRestrictedError);
		expect(ctx.calls("PUT", PLAY)).toHaveLength(0);
	});

	it("keeps the Premium gate", async () => {
		const ctx = playlistSetup({ playlists: library(), product: "free" });
		await expect(ctx.playlists.play(sel(pid("OwnPub")))).rejects.toBeInstanceOf(SpotifyPremiumRequiredError);
		expect(ctx.calls("PUT", PLAY)).toHaveLength(0);
	});

	it("asks to Connect or Reconnect when signed out", async () => {
		const signedOut = playlistSetup({ playlists: library(), connected: false });
		await expect(signedOut.playlists.play(sel(pid("OwnPub")))).rejects.toThrow(/Connect Spotify/);
		signedOut.auth.update({ status: "reauthorization-required" });
		await expect(signedOut.playlists.play(sel(pid("OwnPub")))).rejects.toThrow(/Reconnect Spotify/);
		expect(signedOut.requests).toHaveLength(0);
	});

	it("refreshes once and retries once on 401", async () => {
		const ctx = playlistSetup({ playlists: library() });
		ctx.server.respondOnce(
			(r) => PLAY.test(r.url.pathname),
			() => json(401, { error: { status: 401, message: "expired" } }),
		);
		await ctx.playlists.play(sel(pid("OwnPub")));
		expect(ctx.tokens.refreshAccessToken).toHaveBeenCalledTimes(1);
		expect(ctx.calls("PUT", PLAY)).toHaveLength(2);
	});

	it("surfaces 403 and 429 without retrying", async () => {
		const ctx = playlistSetup({ playlists: library() });
		ctx.server.respondOnce(
			(r) => PLAY.test(r.url.pathname),
			() => json(403, { error: { status: 403, message: "Forbidden" } }),
		);
		await expect(ctx.playlists.play(sel(pid("OwnPub")))).rejects.toBeInstanceOf(SpotifyForbiddenError);
		ctx.server.respondOnce(
			(r) => PLAY.test(r.url.pathname),
			() => json(429, { error: { status: 429, message: "slow" } }, { "Retry-After": "9" }),
		);
		await expect(ctx.playlists.play(sel(pid("OwnPub")))).rejects.toBeInstanceOf(SpotifyRateLimitError);
		await expect(ctx.playlists.play(sel(pid("OwnPub")))).rejects.toBeInstanceOf(SpotifyRateLimitError);
		expect(ctx.calls("PUT", PLAY)).toHaveLength(2);
		expect(ctx.playback.state.value.notice?.code).toBe("rate-limited");
	});

	it("never overlaps playback mutations: a second press while one is running is ignored", async () => {
		const ctx = playlistSetup({ playlists: library() });
		const gate = ctx.server.gate((r) => PLAY.test(r.url.pathname));
		const first = ctx.playlists.play(sel(pid("OwnPub")));
		await tick();
		await expect(ctx.playlists.play(sel(pid("OwnPriv")))).resolves.toBe("busy");
		await expect(ctx.playback.togglePlayPause()).resolves.toBe("busy");
		gate.release();
		await expect(first).resolves.toBe("done");
		expect(ctx.server.played).toEqual([{ context_uri: `spotify:playlist:${pid("OwnPub")}` }]);
	});

	it("always uses the Web API (never the local media session), while Play / Pause / Next / Previous still go local first", async () => {
		const ctx = playlistSetup({ playlists: library() });
		const local: LocalPlaybackCommandTransport & { execute: ReturnType<typeof vi.fn> } = {
			id: "fake-local",
			execute: vi.fn(() => Promise.resolve({ status: "handled" as const })),
			isAvailable: () => Promise.resolve(true),
			dispose: () => undefined,
		};
		const transport: PlaybackTransport = {
			id: "fake",
			getState: () => Promise.resolve({ active: true, isPlaying: false, device: { id: "d", name: "D", type: "Computer", isRestricted: false, volumePercent: 50, supportsVolume: true }, item: undefined, progressMs: 0 }),
			play: vi.fn(() => Promise.resolve()),
			pause: vi.fn(() => Promise.resolve()),
			next: vi.fn(() => Promise.resolve()),
			previous: vi.fn(() => Promise.resolve()),
			setVolume: vi.fn(() => Promise.resolve()),
			playContext: vi.fn(() => Promise.resolve()),
		};
		const playback = new PlaybackService({ transport, localCommands: local, auth: ctx.auth, clock: () => Date.now() });
		await playback.command("next");
		await tick(1_000);
		await playback.togglePlayPause();
		await tick(1_000);
		await playback.playContext(`spotify:playlist:${pid("OwnPub")}`);
		expect(local.execute.mock.calls.map((c) => c[0] as string)).toEqual(["next", "toggle"]);
		expect(transport.playContext).toHaveBeenCalledWith(`spotify:playlist:${pid("OwnPub")}`);
		expect(transport.next).not.toHaveBeenCalled();
		expect(transport.play).not.toHaveBeenCalled();
	});
});
