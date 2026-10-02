import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryItemUnsupportedError } from "../src/library/errors";
import { LibraryService } from "../src/library/service";
import { classifyLibraryItem, isLibraryTrackUri } from "../src/library/state";
import type { LibraryTransport } from "../src/library/transport";
import { PlaybackUnavailableError } from "../src/playback/errors";
import type { PlaybackItem } from "../src/playback/model";
import { SIGNED_OUT_SNAPSHOT, type PlaybackSnapshot } from "../src/playback/state";
import { Observable } from "../src/shared/observable";
import { SpotifyApiClient } from "../src/spotify/api/client";
import { SPOTIFY_SCOPES } from "../src/spotify/auth/scopes";
import {
	SpotifyInvalidResponseError,
	SpotifyNetworkError,
	SpotifyNoActiveDeviceError,
	SpotifyPremiumRequiredError,
	SpotifyQuotaExceededError,
	SpotifyRateLimitError,
	SpotifyUnauthorizedError,
} from "../src/spotify/errors";
import { parseLibraryContains, SpotifyWebApiLibrary } from "../src/spotify/library/web-api-library";
import { FAKE, fakeFetch, json, recordingLogger, type RecordedRequest } from "./helpers";

const track = (id: string, title = `Song ${id}`): PlaybackItem => ({
	type: "track",
	id,
	uri: `spotify:track:${id}`,
	title,
	subtitle: `Artist ${id}`,
	durationMs: 200_000,
});
const SONG_A = track("songA");
const SONG_B = track("songB");
const URI_A = "spotify:track:songA";
const URI_B = "spotify:track:songB";
const EPISODE: PlaybackItem = { type: "episode", id: "ep1", uri: "spotify:episode:ep1", title: "Episode", subtitle: "Show", durationMs: 1 };
const AD: PlaybackItem = { type: "ad", id: undefined, uri: undefined, title: "Advertisement", subtitle: "", durationMs: undefined };
const LOCAL: PlaybackItem = { type: "track", id: undefined, uri: "spotify:local:Artist:Album:Local+Song:180", title: "Local", subtitle: "A", durationMs: 1 };
const NO_URI: PlaybackItem = { ...SONG_A, uri: undefined };
const UNKNOWN: PlaybackItem = { type: "unknown", id: "x", uri: "spotify:audiobook:x", title: "Book", subtitle: "", durationMs: 1 };

function playing(item: PlaybackItem | undefined, overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot {
	return {
		...SIGNED_OUT_SNAPSHOT,
		availability: "active",
		isPlaying: true,
		item,
		device: { id: "d", name: "Desktop", type: "Computer", isRestricted: false, volumePercent: 50, supportsVolume: true },
		observedAt: 1,
		...overrides,
	};
}

type Deferred = { name: string; uri: string; resolve: () => void; reject: (err: Error) => void };

/**
 * Fake library: `saved` holds the user's Liked Songs. With `hold`, requests wait until released (in order) so tests can interleave them.
 */
function fakeLibrary(saved: string[] = []) {
	const control = {
		saved: new Set(saved),
		calls: [] as string[],
		hold: false,
		waiting: [] as Deferred[],
		error: undefined as Error | undefined,
		/** Releases the newest held request of a kind. */
		releaseNewest(name: string): void {
			const index = this.waiting.findLastIndex((w) => w.name === name);
			this.waiting.splice(index, 1)[0]?.resolve();
		},
		/** Releases the oldest held request (optionally the oldest one of a kind, e.g. "save"). */
		release(err?: Error, name?: string): void {
			const index = name === undefined ? 0 : this.waiting.findIndex((w) => w.name === name);
			const [next] = index < 0 ? [] : this.waiting.splice(index, 1);
			if (err) {
				next?.reject(err);
			} else {
				next?.resolve();
			}
		},
	};
	const run = async <T>(name: string, uri: string, apply: () => T): Promise<T> => {
		control.calls.push(`${name}:${uri}`);
		// A check answers with the state when Spotify received it, even if its answer arrives late.
		const answeredEarly = name === "contains" ? { value: apply() } : undefined;
		if (control.hold) {
			await new Promise<void>((resolve, reject) => control.waiting.push({ name, uri, resolve, reject }));
		}
		if (control.error) {
			throw control.error;
		}
		return answeredEarly ? answeredEarly.value : apply();
	};
	const transport: LibraryTransport = {
		id: "fake-library",
		contains: vi.fn((uri: string) => run("contains", uri, () => control.saved.has(uri))),
		save: vi.fn((uri: string) => run("save", uri, () => void control.saved.add(uri))),
		remove: vi.fn((uri: string) => run("remove", uri, () => void control.saved.delete(uri))),
	};
	return { transport, control };
}

function setup(options: { saved?: string[]; initial?: PlaybackSnapshot; visible?: boolean } = {}) {
	const lib = fakeLibrary(options.saved);
	const playback = new Observable<PlaybackSnapshot>(options.initial ?? playing(SONG_A));
	const onAuthRejected = vi.fn();
	const logger = recordingLogger();
	const library = new LibraryService({ transport: lib.transport, playback, onAuthRejected, clock: () => Date.now(), logger });
	if (options.visible !== false) {
		library.addViewer("like");
	}
	return { ...lib, playback, library, onAuthRejected, logger };
}

const tick = async (ms = 0): Promise<void> => {
	await vi.advanceTimersByTimeAsync(ms);
};
const checks = (ctx: { control: { calls: string[] } }): string[] => ctx.control.calls.filter((c) => c.startsWith("contains:"));

beforeEach(() => {
	vi.useFakeTimers({ now: Date.UTC(2026, 9, 3, 12) });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("Spotify library endpoints", () => {
	function api(handler: (req: RecordedRequest) => Response) {
		const tokens = { getAccessToken: vi.fn(() => Promise.resolve(FAKE.accessToken)), refreshAccessToken: vi.fn(() => Promise.resolve(FAKE.accessToken2)) };
		const { fetch, requests } = fakeFetch(handler);
		return { library: new SpotifyWebApiLibrary(new SpotifyApiClient(tokens, { fetch })), requests, tokens };
	}

	it("requests the library scopes", () => {
		expect(SPOTIFY_SCOPES).toEqual(expect.arrayContaining(["user-library-read", "user-library-modify"]));
	});

	it("checks with GET /v1/me/library/contains (never the deprecated /me/tracks/contains)", async () => {
		const ctx = api(() => json(200, [true]));
		await expect(ctx.library.contains("spotify:track:fakeTrack1")).resolves.toBe(true);
		expect(ctx.requests[0]?.method).toBe("GET");
		expect(ctx.requests[0]?.url.pathname).toBe("/v1/me/library/contains");
		expect(ctx.requests[0]?.url.pathname).not.toContain("/me/tracks");
	});

	it("likes with PUT /v1/me/library and unlikes with DELETE /v1/me/library", async () => {
		const ctx = api(() => new Response(null, { status: 200 }));
		await ctx.library.save("spotify:track:fakeTrack1");
		await ctx.library.remove("spotify:track:fakeTrack1");
		expect(ctx.requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual(["PUT /v1/me/library", "DELETE /v1/me/library"]);
		expect(ctx.requests.every((r) => r.body === "")).toBe(true);
	});

	it("sends the URI (not the raw ID) URL-encoded in the uris query parameter", async () => {
		const ctx = api(() => json(200, [false]));
		await ctx.library.contains("spotify:track:4iV5W9uYEdYUVa79Axb7Rh");
		expect(ctx.requests[0]?.url.search).toBe("?uris=spotify%3Atrack%3A4iV5W9uYEdYUVa79Axb7Rh");
		expect(ctx.requests[0]?.url.searchParams.get("uris")).toBe("spotify:track:4iV5W9uYEdYUVa79Axb7Rh");
	});

	it("refuses anything but a Spotify track URI without sending a request", async () => {
		const ctx = api(() => json(200, [true]));
		for (const uri of ["spotify:episode:ep1", "spotify:local:a:b:c:1", "4iV5W9uYEdYUVa79Axb7Rh", "spotify:track:a&b=c", "spotify:track:", ""]) {
			await expect(ctx.library.contains(uri)).rejects.toBeInstanceOf(RangeError);
			await expect(ctx.library.save(uri)).rejects.toBeInstanceOf(RangeError);
			await expect(ctx.library.remove(uri)).rejects.toBeInstanceOf(RangeError);
		}
		expect(ctx.requests).toHaveLength(0);
	});

	it("parses the contains answer defensively", () => {
		expect(parseLibraryContains([true])).toBe(true);
		expect(parseLibraryContains([false])).toBe(false);
		for (const body of [undefined, null, {}, [], [true, false], ["true"], [1], { saved: true }]) {
			expect(() => parseLibraryContains(body)).toThrow(SpotifyInvalidResponseError);
		}
	});

	it("refreshes once and retries once on HTTP 401", async () => {
		const ctx = api((req) =>
			req.headers.get("authorization") === `Bearer ${FAKE.accessToken}` ? json(401, { error: { status: 401, message: "expired" } }) : json(200, [true]),
		);
		await expect(ctx.library.contains("spotify:track:fakeTrack1")).resolves.toBe(true);
		expect(ctx.tokens.refreshAccessToken).toHaveBeenCalledTimes(1);
		expect(ctx.requests).toHaveLength(2);
	});
});

describe("Like / Unlike eligibility", () => {
	it("only treats Spotify tracks with a track URI as likeable", () => {
		expect(classifyLibraryItem(playing(SONG_A))).toEqual({ kind: "track", uri: "spotify:track:songA" });
		for (const item of [EPISODE, AD, LOCAL, NO_URI, UNKNOWN]) {
			expect(classifyLibraryItem(playing(item))).toEqual({ kind: "unsupported", uri: undefined });
		}
		expect(classifyLibraryItem(playing(undefined))).toEqual({ kind: "none", uri: undefined });
		expect(classifyLibraryItem({ ...playing(SONG_A), availability: "inactive" })).toEqual({ kind: "none", uri: undefined });
		expect(isLibraryTrackUri("spotify:track:abc")).toBe(true);
		expect(isLibraryTrackUri("spotify:track:abc/../x")).toBe(false);
	});

	it.each([
		["an episode", EPISODE],
		["an ad", AD],
		["a local file", LOCAL],
		["a track without a URI", NO_URI],
		["an unknown item", UNKNOWN],
	])("never sends a library request for %s", async (_name, item) => {
		const ctx = setup({ initial: playing(item) });
		await tick();
		await expect(ctx.library.toggle()).rejects.toBeInstanceOf(LibraryItemUnsupportedError);
		expect(ctx.control.calls).toEqual([]);
		expect(ctx.library.state.value).toMatchObject({ kind: "unsupported", saved: undefined });
	});
});

describe("saved-state checks", () => {
	it("only check while a Like key is visible", async () => {
		const ctx = setup({ visible: false, saved: [URI_A] });
		await tick();
		ctx.playback.set(playing(SONG_B));
		await tick();
		expect(ctx.control.calls).toEqual([]);

		ctx.library.addViewer("like");
		await tick();
		expect(checks(ctx)).toEqual(["contains:spotify:track:songB"]);
	});

	it("check the current track once and not again for the same track", async () => {
		const ctx = setup({ saved: [URI_A] });
		await tick();
		expect(ctx.library.state.value).toMatchObject({ kind: "track", uri: SONG_A.uri, saved: true });

		for (let progress = 0; progress < 5; progress++) {
			ctx.playback.set(playing(SONG_A, { progressMs: progress * 1_000, isPlaying: progress % 2 === 0 }));
			await tick(3_000);
		}
		expect(checks(ctx)).toEqual(["contains:spotify:track:songA"]);
	});

	it("check once when the track changes", async () => {
		const ctx = setup();
		await tick();
		ctx.playback.set(playing(SONG_B));
		ctx.playback.set(playing(SONG_B, { progressMs: 5 }));
		await tick();
		expect(checks(ctx)).toEqual(["contains:spotify:track:songA", "contains:spotify:track:songB"]);
		expect(ctx.library.state.value).toMatchObject({ uri: SONG_B.uri, saved: false });
	});

	it("never let a late answer for Song A update the state of Song B", async () => {
		const ctx = setup({ saved: [URI_A], visible: false });
		ctx.control.hold = true;
		ctx.library.addViewer("like");
		await tick();
		expect(checks(ctx)).toEqual(["contains:spotify:track:songA"]);

		// Next: Song B starts while Song A's answer is still on its way.
		ctx.playback.set(playing(SONG_B));
		await tick();
		ctx.control.release(); // Song A: saved = true (late)
		await tick();
		expect(ctx.library.state.value).toMatchObject({ uri: SONG_B.uri, saved: undefined, checking: true });

		ctx.control.release(); // Song B: not saved
		await tick();
		expect(ctx.library.state.value).toMatchObject({ uri: SONG_B.uri, saved: false, checking: false });
	});

	it("check again when Spotify reconnects", async () => {
		const ctx = setup({ saved: [URI_A] });
		await tick();
		ctx.playback.set({ ...SIGNED_OUT_SNAPSHOT });
		await tick();
		expect(ctx.library.state.value.kind).toBe("none");
		ctx.playback.set({ ...SIGNED_OUT_SNAPSHOT, availability: "unknown" });
		ctx.playback.set(playing(SONG_A));
		await tick();
		expect(checks(ctx)).toEqual(["contains:spotify:track:songA", "contains:spotify:track:songA"]);
	});

	it("check again when a Like key appears after none was visible, keeping the last state meanwhile", async () => {
		const ctx = setup({ saved: [URI_A] });
		await tick();
		ctx.library.removeViewer("like");
		ctx.control.saved.clear(); // unliked in another Spotify app
		ctx.library.addViewer("like-on-another-page");
		expect(ctx.library.state.value.saved).toBe(true);
		await tick();
		expect(checks(ctx)).toHaveLength(2);
		expect(ctx.library.state.value.saved).toBe(false);
	});

	it("do not check for non-Premium accounts", async () => {
		const ctx = setup({ initial: playing(SONG_A, { premiumRequired: true }) });
		await tick();
		expect(ctx.control.calls).toEqual([]);
		await expect(ctx.library.toggle()).rejects.toBeInstanceOf(SpotifyPremiumRequiredError);
	});

	it("retry a failed check later instead of hammering Spotify", async () => {
		const ctx = setup({ visible: false });
		ctx.control.error = new SpotifyNetworkError();
		ctx.library.addViewer("like");
		await tick();
		expect(ctx.library.state.value.notice).toBe("error");
		await tick(20_000);
		expect(checks(ctx)).toHaveLength(1);
		ctx.control.error = undefined;
		await tick(10_000);
		expect(checks(ctx)).toHaveLength(2);
		expect(ctx.library.state.value).toMatchObject({ saved: false, notice: undefined });
	});
});

describe("Like / Unlike presses", () => {
	it("likes a track that is not saved (PUT) and fills the heart", async () => {
		const ctx = setup();
		await tick();
		await expect(ctx.library.toggle()).resolves.toBe("done");
		expect(ctx.control.calls).toEqual(["contains:spotify:track:songA", "save:spotify:track:songA"]);
		expect(ctx.control.saved.has(URI_A)).toBe(true);
		expect(ctx.library.state.value).toMatchObject({ saved: true, pending: false });
	});

	it("unlikes a saved track (DELETE) and empties the heart", async () => {
		const ctx = setup({ saved: [URI_A] });
		await tick();
		await ctx.library.toggle();
		expect(ctx.control.calls).toEqual(["contains:spotify:track:songA", "remove:spotify:track:songA"]);
		expect(ctx.library.state.value.saved).toBe(false);
	});

	it("checks first when the saved state is unknown, never guessing", async () => {
		const ctx = setup({ visible: false, saved: [URI_A] });
		await tick();
		expect(ctx.library.state.value.saved).toBeUndefined();
		await ctx.library.toggle();
		expect(ctx.control.calls).toEqual(["contains:spotify:track:songA", "remove:spotify:track:songA"]);
	});

	it("ignores a second press while the first like is in flight (no accidental unlike)", async () => {
		const ctx = setup();
		await tick();
		ctx.control.hold = true;
		const first = ctx.library.toggle();
		await tick();
		expect(ctx.library.state.value.pending).toBe(true);
		await expect(ctx.library.toggle()).resolves.toBe("busy");
		ctx.control.release();
		await expect(first).resolves.toBe("done");
		expect(ctx.control.calls.filter((c) => !c.startsWith("contains:"))).toEqual(["save:spotify:track:songA"]);
		expect(ctx.library.state.value.saved).toBe(true);

		// A later, separate press does unlike.
		ctx.control.hold = false;
		await ctx.library.toggle();
		expect(ctx.library.state.value.saved).toBe(false);
	});

	it("applies a like to Song A only, even when Song B starts before Spotify answers", async () => {
		const ctx = setup({ saved: [URI_B] });
		await tick();
		ctx.control.hold = true;
		const like = ctx.library.toggle(); // Song A
		await tick();
		ctx.playback.set(playing(SONG_B)); // Next
		await tick();
		expect(ctx.control.calls).toEqual(["contains:spotify:track:songA", "save:spotify:track:songA", "contains:spotify:track:songB"]);

		ctx.control.release(); // Song A saved
		await like;
		expect(ctx.control.saved.has(URI_A)).toBe(true);
		// Song B's state is not overwritten with Song A's result.
		expect(ctx.library.state.value).toMatchObject({ uri: SONG_B.uri, saved: undefined, pending: false });

		ctx.control.release(); // Song B: saved
		await tick();
		expect(ctx.library.state.value).toMatchObject({ uri: SONG_B.uri, saved: true });
	});

	it("never lets a check that started before a like overwrite the like's result", async () => {
		const ctx = setup({ visible: false });
		ctx.control.hold = true;
		ctx.library.addViewer("like"); // check #1 for Song A: not saved (answer delayed)
		await tick();
		const like = ctx.library.toggle(); // unknown state: its own check, then PUT
		await tick();
		// The first check is still on its way; the toggle's own check answers first.
		ctx.control.releaseNewest("contains");
		await tick();
		ctx.control.release(undefined, "save");
		await like;
		expect(ctx.library.state.value.saved).toBe(true);

		ctx.control.release(); // Now the stale "not saved" answer arrives.
		await tick();
		expect(ctx.library.state.value.saved).toBe(true);
		expect(ctx.control.saved.has(URI_A)).toBe(true);
	});

	it("restores and re-checks the state after a failed like", async () => {
		const ctx = setup();
		await tick();
		ctx.control.error = new SpotifyNetworkError();
		await expect(ctx.library.toggle()).rejects.toBeInstanceOf(SpotifyNetworkError);
		expect(ctx.library.state.value).toMatchObject({ saved: false, pending: false });

		ctx.control.error = undefined;
		ctx.control.saved.add(URI_A); // the like actually reached Spotify
		await tick(30_000);
		expect(ctx.library.state.value.saved).toBe(true);
	});

	it("refuses without a request when nothing is playing", async () => {
		const ctx = setup({ initial: { ...playing(undefined), availability: "inactive", device: undefined } });
		await expect(ctx.library.toggle()).rejects.toBeInstanceOf(SpotifyNoActiveDeviceError);
		const signedOut = setup({ initial: { ...SIGNED_OUT_SNAPSHOT } });
		await expect(signedOut.library.toggle()).rejects.toBeInstanceOf(PlaybackUnavailableError);
		expect([...ctx.control.calls, ...signedOut.control.calls]).toEqual([]);
	});

	it("logs without track URIs, titles or artists", async () => {
		const ctx = setup({ initial: playing(track("secretId", "Secret Title")) });
		await tick();
		await ctx.library.toggle();
		ctx.control.error = new SpotifyNetworkError();
		await expect(ctx.library.toggle()).rejects.toThrow();
		const log = ctx.logger.lines.join("\n");
		expect(log).toContain("Library item saved.");
		expect(log).not.toMatch(/secretId|Secret Title|Artist secretId|spotify:track/);
	});
});

describe("library rate limits and authentication", () => {
	it("back off after a 429 on a check: no repeated checks for the same track until Retry-After", async () => {
		const ctx = setup({ visible: false });
		ctx.control.error = new SpotifyRateLimitError("slow down", 20);
		ctx.library.addViewer("like");
		await tick();
		expect(ctx.library.state.value.notice).toBe("rate-limited");
		ctx.control.error = undefined;

		ctx.playback.set(playing(SONG_A, { progressMs: 9 }));
		await expect(ctx.library.toggle()).rejects.toBeInstanceOf(SpotifyRateLimitError);
		await tick(19_000);
		expect(ctx.control.calls).toEqual(["contains:spotify:track:songA"]);

		await tick(1_100);
		expect(checks(ctx)).toHaveLength(2);
		expect(ctx.library.state.value).toMatchObject({ saved: false, notice: undefined });
	});

	it("keep a known heart while limited and show the quota notice", async () => {
		const ctx = setup({ saved: [URI_A] });
		await tick();
		ctx.control.error = new SpotifyQuotaExceededError("quota", undefined);
		await expect(ctx.library.toggle()).rejects.toBeInstanceOf(SpotifyQuotaExceededError);
		expect(ctx.library.state.value).toMatchObject({ saved: true, notice: "quota-exceeded" });
	});

	it("never change the playback state", async () => {
		const ctx = setup({ visible: false });
		const before = ctx.playback.value;
		ctx.control.error = new SpotifyRateLimitError("slow down", 60);
		ctx.library.addViewer("like");
		await tick();
		await expect(ctx.library.toggle()).rejects.toThrow();
		expect(ctx.playback.value).toBe(before);
	});

	it("start the existing session recovery when the token is still rejected after the client's retry", async () => {
		const ctx = setup({ visible: false });
		ctx.control.error = new SpotifyUnauthorizedError("revoked");
		ctx.library.addViewer("like");
		await tick();
		expect(ctx.onAuthRejected).toHaveBeenCalledTimes(1);
		// A persistent 401 never turns into a request loop.
		await tick(29_000);
		expect(checks(ctx)).toHaveLength(1);
		await expect(ctx.library.toggle()).rejects.toBeInstanceOf(SpotifyUnauthorizedError);
		expect(ctx.onAuthRejected).toHaveBeenCalledTimes(2);
	});
});
