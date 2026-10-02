import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlaybackUnavailableError } from "../src/playback/errors";
import type { PlaybackDevice, PlaybackItem, PlaybackObservation } from "../src/playback/model";
import { PlaybackService } from "../src/playback/service";
import { displayedVolume } from "../src/playback/state";
import type { PlaybackTransport } from "../src/playback/transport";
import { SpotifyApiClient } from "../src/spotify/api/client";
import {
	SpotifyDeviceRestrictedError,
	SpotifyNetworkError,
	SpotifyNoActiveDeviceError,
	SpotifyPlayerCommandError,
	SpotifyPremiumRequiredError,
	SpotifyQuotaExceededError,
	SpotifyRateLimitError,
	SpotifyVolumeUnsupportedError,
} from "../src/spotify/errors";
import { SpotifyWebApiTransport } from "../src/spotify/playback/web-api-transport";
import { SpotifyAuthState } from "../src/spotify/state/auth-state";
import { FAKE, fakeFetch, json } from "./helpers";
import { DEVICE, playerState } from "./playback-fixtures";

const SONG: PlaybackItem = { type: "track", id: "a", uri: "spotify:track:a", title: "Song A", subtitle: "Artist A", durationMs: 200_000 };

function device(overrides: Partial<PlaybackDevice> = {}): PlaybackDevice {
	return { id: "d1", name: "Desktop", type: "Computer", isRestricted: false, volumePercent: 40, supportsVolume: true, ...overrides };
}

function observation(deviceOverrides: Partial<PlaybackDevice> = {}): PlaybackObservation {
	return { active: true, isPlaying: true, device: device(deviceOverrides), item: SONG, progressMs: 1_000 };
}

/**
 * Fake Spotify: `player` is what Spotify reports; `setVolume` applies the volume unless it fails. With `hold`, every set-volume request
 * waits until `release()` is called, so tests can press keys while a request is in flight.
 */
function fakeSpotify(initial: PlaybackObservation = observation()) {
	const control = {
		player: initial,
		calls: [] as string[],
		volumeError: undefined as Error | undefined,
		stateError: undefined as Error | undefined,
		/** When set, state reads wait for this promise. */
		stateGate: undefined as Promise<void> | undefined,
		/** What Spotify applies for a requested volume (e.g. a device that rounds). */
		applied: (requested: number): number => requested,
		hold: false,
		inFlight: 0,
		maxInFlight: 0,
		waiting: [] as (() => void)[],
		release(): void {
			this.waiting.shift()?.();
		},
	};
	const transport: PlaybackTransport = {
		id: "fake",
		getState: vi.fn(async () => {
			control.calls.push("get");
			const reported = control.player;
			if (control.stateGate) {
				await control.stateGate;
			}
			if (control.stateError) {
				throw control.stateError;
			}
			return reported;
		}),
		play: vi.fn(() => (control.calls.push("play"), Promise.resolve())),
		pause: vi.fn(() => (control.calls.push("pause"), Promise.resolve())),
		next: vi.fn(() => (control.calls.push("next"), Promise.resolve())),
		previous: vi.fn(() => (control.calls.push("previous"), Promise.resolve())),
		setVolume: vi.fn(async (volume: number) => {
			control.calls.push(`set:${String(volume)}`);
			control.inFlight++;
			control.maxInFlight = Math.max(control.maxInFlight, control.inFlight);
			try {
				if (control.hold) {
					await new Promise<void>((resolve) => control.waiting.push(resolve));
				}
				if (control.volumeError) {
					throw control.volumeError;
				}
				const current = control.player.device;
				if (current) {
					control.player = { ...control.player, device: { ...current, volumePercent: control.applied(volume) } };
				}
			} finally {
				control.inFlight--;
			}
		}),
	};
	return { transport, control, sets: () => control.calls.filter((c) => c.startsWith("set:")) };
}

function setup(options: { player?: PlaybackObservation; product?: string; connected?: boolean } = {}) {
	const spotify = fakeSpotify(options.player);
	const auth = new SpotifyAuthState();
	if (options.connected !== false) {
		auth.update({ status: "connected", profile: { id: "u", displayName: "Tester", product: options.product ?? "premium" }, authorizedAt: 1 });
	}
	const onAuthRejected = vi.fn();
	const playback = new PlaybackService({ transport: spotify.transport, auth, clock: () => Date.now(), onAuthRejected });
	return { ...spotify, auth, playback, onAuthRejected };
}

/** Sets up with a visible key and the first state read done. */
async function ready(options: Parameters<typeof setup>[0] = {}) {
	const ctx = setup(options);
	ctx.playback.addViewer("k");
	await tick(0);
	ctx.control.calls.length = 0;
	return ctx;
}

const tick = async (ms: number): Promise<void> => {
	await vi.advanceTimersByTimeAsync(ms);
};
const volumeOf = (ctx: { playback: PlaybackService }): number | undefined => ctx.playback.state.value.device?.volumePercent;

beforeEach(() => {
	vi.useFakeTimers({ now: Date.UTC(2026, 9, 3, 12) });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("volume up / down", () => {
	it("raises the volume by the step on the active device", async () => {
		const ctx = await ready();
		await ctx.playback.adjustVolume(10);
		expect(ctx.sets()).toEqual(["set:50"]);
		expect(volumeOf(ctx)).toBe(50);
	});

	it("lowers the volume by the step", async () => {
		const ctx = await ready();
		await ctx.playback.adjustVolume(-10);
		expect(ctx.sets()).toEqual(["set:30"]);
		expect(volumeOf(ctx)).toBe(30);
	});

	it("uses any custom step", async () => {
		const ctx = await ready({ player: observation({ volumePercent: 63 }) });
		await ctx.playback.adjustVolume(7);
		await ctx.playback.adjustVolume(-25);
		expect(ctx.sets()).toEqual(["set:70", "set:45"]);
	});

	it("never goes above 100", async () => {
		const ctx = await ready({ player: observation({ volumePercent: 95 }) });
		await ctx.playback.adjustVolume(10);
		expect(ctx.sets()).toEqual(["set:100"]);
	});

	it("never goes below 0", async () => {
		const ctx = await ready({ player: observation({ volumePercent: 5 }) });
		await ctx.playback.adjustVolume(-10);
		expect(ctx.sets()).toEqual(["set:0"]);
	});

	it("sends nothing when already at the limit", async () => {
		const ctx = await ready({ player: observation({ volumePercent: 100 }) });
		await ctx.playback.adjustVolume(10);
		expect(ctx.sets()).toEqual([]);
		expect(volumeOf(ctx)).toBe(100);
	});

	it("rejects non-integer steps", async () => {
		const ctx = await ready();
		await expect(ctx.playback.adjustVolume(2.5)).rejects.toBeInstanceOf(RangeError);
		expect(ctx.sets()).toEqual([]);
	});

	it("updates the shared state as soon as Spotify accepts, then reconciles with Spotify", async () => {
		const ctx = await ready();
		// The device applies a slightly different volume than requested.
		ctx.control.applied = (v) => v - 2;
		await ctx.playback.adjustVolume(10);
		expect(volumeOf(ctx)).toBe(50);
		expect(ctx.playback.state.value.pendingVolume).toBeUndefined();

		await tick(700);
		expect(ctx.control.calls).toEqual(["set:50", "get"]);
		expect(volumeOf(ctx)).toBe(48);
	});

	it("shows the target immediately while the request is in flight", async () => {
		const ctx = await ready();
		ctx.control.hold = true;
		const press = ctx.playback.adjustVolume(10);
		await tick(0);
		expect(ctx.playback.state.value.pendingVolume).toBe(50);
		expect(displayedVolume(ctx.playback.state.value)).toBe(50);
		expect(volumeOf(ctx)).toBe(40);

		ctx.control.release();
		await press;
		expect(ctx.playback.state.value.pendingVolume).toBeUndefined();
		expect(displayedVolume(ctx.playback.state.value)).toBe(50);
	});

	it("works the same for a remote Spotify Connect device", async () => {
		const ctx = await ready({ player: observation({ id: "phone", name: "Phone", type: "Smartphone", volumePercent: 70 }) });
		await ctx.playback.adjustVolume(-10);
		expect(ctx.sets()).toEqual(["set:60"]);
		expect(ctx.playback.state.value.device).toMatchObject({ type: "Smartphone", volumePercent: 60 });
	});
});

describe("rapid volume presses", () => {
	it("count every press: four quick presses from 40 end at 80", async () => {
		const ctx = await ready();
		ctx.control.hold = true;
		const presses = [1, 2, 3, 4].map(() => ctx.playback.adjustVolume(10));
		await tick(0);
		expect(ctx.playback.state.value.pendingVolume).toBe(80);

		ctx.control.release();
		await tick(0);
		ctx.control.release();
		await Promise.all(presses);

		// Intermediate values are coalesced; the final volume reflects all four presses.
		expect(ctx.sets()).toEqual(["set:50", "set:80"]);
		expect(volumeOf(ctx)).toBe(80);
		expect(ctx.control.player.device?.volumePercent).toBe(80);
	});

	it("never sends overlapping set-volume requests", async () => {
		const ctx = await ready();
		ctx.control.hold = true;
		const presses: Promise<unknown>[] = [];
		for (let i = 0; i < 6; i++) {
			presses.push(ctx.playback.adjustVolume(i % 3 === 2 ? -5 : 10));
			await tick(0);
			ctx.control.release();
		}
		while (ctx.control.waiting.length > 0) {
			ctx.control.release();
			await tick(0);
		}
		await Promise.all(presses);

		expect(ctx.control.maxInFlight).toBe(1);
		// 40 +10 +10 -5 +10 +10 -5 = 70
		expect(volumeOf(ctx)).toBe(70);
		expect(ctx.sets().at(-1)).toBe("set:70");
	});

	it("reach the right target when presses arrive while the volume is still unknown", async () => {
		const ctx = await ready({ player: observation({ volumePercent: undefined }) });
		ctx.control.player = observation({ volumePercent: 40 });
		const presses = [ctx.playback.adjustVolume(10), ctx.playback.adjustVolume(10), ctx.playback.adjustVolume(10)];
		await Promise.all(presses);

		// One fresh read for all three presses, then 70.
		expect(ctx.control.calls.filter((c) => c === "get")).toHaveLength(1);
		expect(volumeOf(ctx)).toBe(70);
		expect(ctx.control.maxInFlight).toBe(1);
	});

	it("do not block Phase 4 playback commands", async () => {
		const ctx = await ready();
		ctx.control.hold = true;
		const volume = ctx.playback.adjustVolume(10);
		await tick(0);
		await expect(ctx.playback.command("next")).resolves.toBe("done");
		ctx.control.release();
		await volume;
		expect(ctx.control.calls).toContain("next");
	});
});

describe("volume preconditions", () => {
	it.each([
		["the device does not support volume", observation({ supportsVolume: false }), SpotifyVolumeUnsupportedError],
		["the device is restricted", observation({ isRestricted: true }), SpotifyDeviceRestrictedError],
		["there is no active device", { active: false, isPlaying: false, device: undefined, item: undefined, progressMs: undefined }, SpotifyNoActiveDeviceError],
	] as const)("sends no request when %s", async (_name, player, error) => {
		const ctx = await ready({ player });
		await expect(ctx.playback.adjustVolume(10)).rejects.toBeInstanceOf(error);
		await expect(ctx.playback.toggleMute()).rejects.toBeInstanceOf(error);
		expect(ctx.sets()).toEqual([]);
	});

	it("reads fresh state before changing a volume it does not know, and never assumes one", async () => {
		const ctx = await ready({ player: observation({ volumePercent: undefined }) });
		ctx.control.player = observation({ volumePercent: 33 });
		await ctx.playback.adjustVolume(10);
		expect(ctx.control.calls).toEqual(["get", "set:43"]);
	});

	it("refuses when Spotify still reports no volume after a fresh read", async () => {
		const ctx = await ready({ player: observation({ volumePercent: undefined }) });
		await expect(ctx.playback.adjustVolume(10)).rejects.toBeInstanceOf(SpotifyVolumeUnsupportedError);
		expect(ctx.control.calls).toEqual(["get"]);
	});

	it("reads fresh state when the last observation is stale", async () => {
		const ctx = await ready();
		ctx.playback.removeViewer("k");
		await tick(10_000);
		ctx.control.player = observation({ volumePercent: 20 });
		await ctx.playback.adjustVolume(10);
		expect(ctx.control.calls).toEqual(["get", "set:30"]);
	});

	it("reports a failed fresh read instead of guessing", async () => {
		const ctx = await ready({ player: observation({ volumePercent: undefined }) });
		ctx.control.stateError = new SpotifyNetworkError();
		await expect(ctx.playback.adjustVolume(10)).rejects.toBeInstanceOf(SpotifyNetworkError);
		expect(ctx.sets()).toEqual([]);
	});

	it("requires a connected Premium account", async () => {
		const signedOut = setup({ connected: false });
		await expect(signedOut.playback.adjustVolume(10)).rejects.toBeInstanceOf(PlaybackUnavailableError);
		const free = await ready({ product: "free" });
		await expect(free.playback.toggleMute()).rejects.toBeInstanceOf(SpotifyPremiumRequiredError);
		expect(signedOut.control.calls).toEqual([]);
		expect(free.sets()).toEqual([]);
	});
});

describe("volume failures and rate limits", () => {
	it("respects Retry-After: no requests until it has passed, then reconciles and works again", async () => {
		const ctx = await ready();
		ctx.control.volumeError = new SpotifyRateLimitError("slow down", 5);
		await expect(ctx.playback.adjustVolume(10)).rejects.toBeInstanceOf(SpotifyRateLimitError);
		expect(ctx.playback.state.value.notice?.code).toBe("rate-limited");

		ctx.control.volumeError = undefined;
		await expect(ctx.playback.adjustVolume(10)).rejects.toBeInstanceOf(SpotifyRateLimitError);
		expect(ctx.sets()).toEqual(["set:50"]);

		await tick(4_000);
		expect(ctx.control.calls.filter((c) => c === "get")).toHaveLength(0);
		await tick(1_100);
		expect(ctx.control.calls.filter((c) => c === "get")).toHaveLength(1);
		expect(volumeOf(ctx)).toBe(40);

		await ctx.playback.adjustVolume(10);
		expect(ctx.sets()).toEqual(["set:50", "set:50"]);
		expect(volumeOf(ctx)).toBe(50);
	});

	it("does not retry on a quota error", async () => {
		const ctx = await ready();
		ctx.control.volumeError = new SpotifyQuotaExceededError("quota", undefined);
		await expect(ctx.playback.adjustVolume(10)).rejects.toBeInstanceOf(SpotifyQuotaExceededError);
		await tick(60_000);
		expect(ctx.sets()).toEqual(["set:50"]);
		expect(ctx.playback.state.value.notice?.code).toBe("quota-exceeded");
	});

	it("falls back to the last accepted volume when a later request in a sequence fails", async () => {
		const ctx = await ready();
		ctx.control.hold = true;
		const first = ctx.playback.adjustVolume(10);
		const second = ctx.playback.adjustVolume(10);
		await tick(0);
		ctx.control.release();
		await tick(0);
		ctx.control.volumeError = new SpotifyNetworkError();
		ctx.control.release();

		await expect(Promise.all([first, second])).rejects.toBeInstanceOf(SpotifyNetworkError);
		expect(ctx.playback.state.value.pendingVolume).toBeUndefined();
		expect(volumeOf(ctx)).toBe(50);

		// The next press starts from the real volume again.
		ctx.control.hold = false;
		ctx.control.volumeError = undefined;
		await tick(700);
		await ctx.playback.adjustVolume(-10);
		expect(volumeOf(ctx)).toBe(40);
	});

	it("marks the device as not supporting volume when Spotify refuses with VOLUME_CONTROL_DISALLOW", async () => {
		const ctx = await ready();
		ctx.control.volumeError = new SpotifyPlayerCommandError(403, "no", "VOLUME_CONTROL_DISALLOW");
		await expect(ctx.playback.adjustVolume(10)).rejects.toBeInstanceOf(SpotifyPlayerCommandError);
		expect(ctx.playback.state.value.device?.supportsVolume).toBe(false);
	});

	it("does not let a state read that started before the change overwrite the new volume", async () => {
		const ctx = await ready();
		let open!: () => void;
		ctx.control.stateGate = new Promise((resolve) => (open = resolve));
		const staleRead = ctx.playback.refresh();
		await tick(0);

		ctx.control.stateGate = undefined;
		await ctx.playback.adjustVolume(10);
		open();
		await staleRead;
		expect(volumeOf(ctx)).toBe(50);
	});
});

describe("stale reads during a volume sequence", () => {
	it("ignores a read that lands between two set-volume requests, even if the sequence then fails", async () => {
		const ctx = await ready();
		let open!: () => void;
		ctx.control.stateGate = new Promise((resolve) => (open = resolve));
		const staleRead = ctx.playback.refresh();
		await tick(0);
		ctx.control.stateGate = undefined;

		ctx.control.hold = true;
		const first = ctx.playback.adjustVolume(10);
		const second = ctx.playback.adjustVolume(10);
		await tick(0);
		// 50 is accepted; the same sequence continues with 60.
		ctx.control.release();
		await tick(0);
		expect(volumeOf(ctx)).toBe(50);
		expect(ctx.sets()).toEqual(["set:50", "set:60"]);

		// The read that started at 40 completes while 60 is being sent.
		open();
		await staleRead;
		expect(volumeOf(ctx)).toBe(50);

		ctx.control.volumeError = new SpotifyNetworkError();
		ctx.control.release();
		await expect(Promise.all([first, second])).rejects.toBeInstanceOf(SpotifyNetworkError);
		// The last volume Spotify accepted, never the stale 40.
		expect(volumeOf(ctx)).toBe(50);
		expect(ctx.playback.lastNonZeroVolume).toBe(50);
	});
});

describe("mute / unmute", () => {
	it("mutes 63 to 0 and remembers 63", async () => {
		const ctx = await ready({ player: observation({ volumePercent: 63 }) });
		await ctx.playback.toggleMute();
		expect(ctx.sets()).toEqual(["set:0"]);
		expect(volumeOf(ctx)).toBe(0);
		expect(ctx.playback.lastNonZeroVolume).toBe(63);
	});

	it("unmutes 0 back to the remembered 63", async () => {
		const ctx = await ready({ player: observation({ volumePercent: 63 }) });
		await ctx.playback.toggleMute();
		await ctx.playback.toggleMute();
		expect(ctx.sets()).toEqual(["set:0", "set:63"]);
		expect(volumeOf(ctx)).toBe(63);
	});

	it("unmutes to 50% when no non-zero volume is known, never to 0", async () => {
		const ctx = await ready({ player: observation({ volumePercent: 0 }) });
		expect(ctx.playback.lastNonZeroVolume).toBeUndefined();
		await ctx.playback.toggleMute();
		expect(ctx.sets()).toEqual(["set:50"]);
	});

	it("remembers volumes changed outside Deckify", async () => {
		const ctx = await ready({ player: observation({ volumePercent: 0 }) });
		ctx.control.player = observation({ volumePercent: 45 });
		await tick(3_000);
		expect(ctx.playback.lastNonZeroVolume).toBe(45);
		ctx.control.player = observation({ volumePercent: 0 });
		await tick(3_000);

		await ctx.playback.toggleMute();
		expect(ctx.sets()).toEqual(["set:45"]);
	});

	it("treats a volume of 0 reached with Volume Down as muted", async () => {
		const ctx = await ready({ player: observation({ volumePercent: 10 }) });
		await ctx.playback.adjustVolume(-10);
		expect(volumeOf(ctx)).toBe(0);
		await ctx.playback.toggleMute();
		expect(ctx.sets()).toEqual(["set:0", "set:10"]);
	});

	it("makes Volume Up from 0 audible and remembers the new volume", async () => {
		const ctx = await ready({ player: observation({ volumePercent: 60 }) });
		await ctx.playback.toggleMute();
		await ctx.playback.adjustVolume(10);
		expect(volumeOf(ctx)).toBe(10);
		expect(ctx.playback.lastNonZeroVolume).toBe(10);
	});

	it("follows the real device volume: an external change from 0 to 45 counts as unmuted", async () => {
		const ctx = await ready({ player: observation({ volumePercent: 63 }) });
		await ctx.playback.toggleMute();
		ctx.control.player = observation({ volumePercent: 45 });
		await tick(3_000);
		expect(volumeOf(ctx)).toBe(45);

		await ctx.playback.toggleMute();
		expect(ctx.sets()).toEqual(["set:0", "set:0"]);
		expect(ctx.playback.lastNonZeroVolume).toBe(45);
	});

	it("a quick double press mutes and restores", async () => {
		const ctx = await ready({ player: observation({ volumePercent: 63 }) });
		ctx.control.hold = true;
		const presses = [ctx.playback.toggleMute(), ctx.playback.toggleMute()];
		await tick(0);
		ctx.control.release();
		await tick(0);
		ctx.control.release();
		await Promise.all(presses);
		expect(volumeOf(ctx)).toBe(63);
		expect(ctx.control.maxInFlight).toBe(1);
	});

	it("a failed mute leaves the real volume shown, not a muted state", async () => {
		const ctx = await ready({ player: observation({ volumePercent: 63 }) });
		ctx.control.volumeError = new SpotifyNetworkError();
		await expect(ctx.playback.toggleMute()).rejects.toBeInstanceOf(SpotifyNetworkError);
		expect(volumeOf(ctx)).toBe(63);
		expect(displayedVolume(ctx.playback.state.value)).toBe(63);
		expect(ctx.playback.state.value.pendingVolume).toBeUndefined();
	});
});

describe("volume through the real Web API client", () => {
	function realSetup(handler: Parameters<typeof fakeFetch>[0]) {
		const tokens = { getAccessToken: vi.fn(() => Promise.resolve(FAKE.accessToken)), refreshAccessToken: vi.fn(() => Promise.resolve(FAKE.accessToken2)) };
		const { fetch, requests } = fakeFetch(handler);
		const auth = new SpotifyAuthState();
		auth.update({ status: "connected", profile: { id: "u", displayName: "Tester", product: "premium" }, authorizedAt: 1 });
		const onAuthRejected = vi.fn();
		const playback = new PlaybackService({
			transport: new SpotifyWebApiTransport(new SpotifyApiClient(tokens, { fetch })),
			auth,
			clock: () => Date.now(),
			onAuthRejected,
		});
		return { playback, requests, tokens, onAuthRejected };
	}
	const smartphone = { ...DEVICE, id: "fake-phone", name: "Test Phone", type: "Smartphone", volume_percent: 30 };

	it("refreshes the token once on 401 and retries the volume request once", async () => {
		const ctx = realSetup((req) => {
			if (req.url.pathname === "/v1/me/player") {
				return json(200, playerState({ device: smartphone }));
			}
			return req.headers.get("authorization") === `Bearer ${FAKE.accessToken}`
				? json(401, { error: { status: 401, message: "expired" } })
				: new Response(null, { status: 204 });
		});
		ctx.playback.addViewer("k");
		await tick(0);

		await ctx.playback.adjustVolume(10);
		expect(ctx.tokens.refreshAccessToken).toHaveBeenCalledTimes(1);
		const volumeRequests = ctx.requests.filter((r) => r.url.pathname === "/v1/me/player/volume");
		expect(volumeRequests.map((r) => `${r.method} ${r.url.search}`)).toEqual(["PUT ?volume_percent=40", "PUT ?volume_percent=40"]);
		// Remote device: same endpoint, no device_id.
		expect(volumeRequests.every((r) => !r.url.searchParams.has("device_id"))).toBe(true);
	});

	it("starts the existing session recovery when the retried request is rejected again", async () => {
		const ctx = realSetup((req) =>
			req.url.pathname === "/v1/me/player" ? json(200, playerState({ device: smartphone })) : json(401, { error: { status: 401, message: "revoked" } }),
		);
		ctx.playback.addViewer("k");
		await tick(0);

		await expect(ctx.playback.adjustVolume(10)).rejects.toMatchObject({ code: "unauthorized" });
		expect(ctx.onAuthRejected).toHaveBeenCalledTimes(1);
		expect(ctx.requests.filter((r) => r.url.pathname === "/v1/me/player/volume")).toHaveLength(2);
	});
});
