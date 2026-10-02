import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlaybackUnavailableError } from "../src/playback/errors";
import { INACTIVE_OBSERVATION, type PlaybackItem, type PlaybackObservation } from "../src/playback/model";
import { PlaybackService } from "../src/playback/service";
import type { PlaybackTransport } from "../src/playback/transport";
import {
	SpotifyDeviceRestrictedError,
	SpotifyForbiddenError,
	SpotifyNoActiveDeviceError,
	SpotifyPremiumRequiredError,
	SpotifyQuotaExceededError,
	SpotifyRateLimitError,
	SpotifyUnauthorizedError,
} from "../src/spotify/errors";
import { SpotifyAuthState } from "../src/spotify/state/auth-state";
import { recordingLogger } from "./helpers";

const SONG_A: PlaybackItem = { type: "track", id: "a", uri: "spotify:track:a", title: "Song A", subtitle: "Artist A", durationMs: 200_000 };
const SONG_B: PlaybackItem = { type: "track", id: "b", uri: "spotify:track:b", title: "Song B", subtitle: "Artist B", durationMs: 180_000 };

function observation(overrides: Partial<PlaybackObservation> = {}): PlaybackObservation {
	return {
		active: true,
		isPlaying: true,
		device: { id: "d1", name: "Desktop", type: "Computer", isRestricted: false, volumePercent: 60, supportsVolume: true },
		item: SONG_A,
		progressMs: 1_000,
		...overrides,
	};
}

/**
 * Controllable fake transport: `player` is what Spotify reports; commands mutate it unless configured to fail.
 */
function fakeTransport() {
	const control = {
		player: observation(),
		stateError: undefined as Error | undefined,
		commandError: undefined as Error | undefined,
		/** When set, state reads wait for this promise. */
		gate: undefined as Promise<void> | undefined,
		/** Whether commands change `player` (simulating Spotify applying them). */
		applyCommands: true,
		calls: [] as string[],
	};
	const command = (name: "play" | "pause" | "next" | "previous", apply: () => void) =>
		vi.fn(() => {
			control.calls.push(name);
			if (control.commandError) {
				return Promise.reject(control.commandError);
			}
			if (control.applyCommands) {
				apply();
			}
			return Promise.resolve();
		});
	const transport: PlaybackTransport = {
		id: "fake",
		getState: vi.fn(async () => {
			control.calls.push("getState");
			if (control.gate) {
				await control.gate;
			}
			if (control.stateError) {
				throw control.stateError;
			}
			return control.player;
		}),
		play: command("play", () => (control.player = { ...control.player, isPlaying: true })),
		pause: command("pause", () => (control.player = { ...control.player, isPlaying: false })),
		next: command("next", () => (control.player = { ...control.player, item: SONG_B })),
		previous: command("previous", () => (control.player = { ...control.player, item: SONG_A })),
		setVolume: vi.fn(() => {
			control.calls.push("setVolume");
			return control.commandError ? Promise.reject(control.commandError) : Promise.resolve();
		}),
	};
	return { transport, control, stateCalls: () => control.calls.filter((c) => c === "getState").length };
}

function setup(options: { product?: string; connected?: boolean } = {}) {
	const auth = new SpotifyAuthState();
	if (options.connected !== false) {
		auth.update({ status: "connected", profile: { id: "u", displayName: "Tester", product: options.product ?? "premium" }, authorizedAt: 1 });
	}
	const fake = fakeTransport();
	const onAuthRejected = vi.fn();
	const logger = recordingLogger();
	const service = new PlaybackService({ transport: fake.transport, auth, clock: () => Date.now(), logger, onAuthRejected });
	return { ...fake, auth, service, onAuthRejected, logger };
}

const tick = async (ms: number): Promise<void> => {
	await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
	vi.useFakeTimers({ now: Date.UTC(2026, 9, 2, 12) });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("polling", () => {
	it("does not poll without a visible playback key", async () => {
		const ctx = setup();
		await tick(60_000);
		expect(ctx.stateCalls()).toBe(0);
	});

	it("does not poll while Spotify is not connected", async () => {
		const ctx = setup({ connected: false });
		ctx.service.addViewer("k1");
		await tick(60_000);
		expect(ctx.stateCalls()).toBe(0);
		expect(ctx.service.state.value.availability).toBe("signed-out");
	});

	it("fetches immediately when the first key appears and publishes the state", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);

		expect(ctx.stateCalls()).toBe(1);
		expect(ctx.service.state.value).toMatchObject({ availability: "active", isPlaying: true, item: SONG_A, observedAt: Date.now() });
	});

	it("polls about every 3 s while playing", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);
		await tick(2_999);
		expect(ctx.stateCalls()).toBe(1);
		await tick(1);
		expect(ctx.stateCalls()).toBe(2);
		await tick(30_000);
		expect(ctx.stateCalls()).toBe(12);
	});

	it("polls about every 8 s while paused", async () => {
		const ctx = setup();
		ctx.control.player = observation({ isPlaying: false });
		ctx.service.addViewer("k1");
		await tick(0);
		await tick(7_999);
		expect(ctx.stateCalls()).toBe(1);
		await tick(1);
		expect(ctx.stateCalls()).toBe(2);
	});

	it("polls about every 15 s when nothing is playing (204)", async () => {
		const ctx = setup();
		ctx.control.player = INACTIVE_OBSERVATION;
		ctx.service.addViewer("k1");
		await tick(0);
		expect(ctx.service.state.value.availability).toBe("inactive");
		await tick(14_999);
		expect(ctx.stateCalls()).toBe(1);
		await tick(1);
		expect(ctx.stateCalls()).toBe(2);
	});

	it("adapts when playback changes from playing to paused", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);
		ctx.control.player = observation({ isPlaying: false });
		await tick(3_000);
		expect(ctx.stateCalls()).toBe(2);
		await tick(7_999);
		expect(ctx.stateCalls()).toBe(2);
		await tick(1);
		expect(ctx.stateCalls()).toBe(3);
	});

	it("uses one shared poller for any number of keys", async () => {
		const ctx = setup();
		for (const id of ["play-pause", "next", "previous", "now-playing-1", "now-playing-2"]) {
			ctx.service.addViewer(id);
		}
		await tick(0);
		await tick(9_000);
		expect(ctx.stateCalls()).toBe(4);
	});

	it("stops polling when no playback key is visible and resumes when one appears", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		ctx.service.addViewer("k2");
		await tick(0);
		ctx.service.removeViewer("k1");
		await tick(3_000);
		expect(ctx.stateCalls()).toBe(2);

		ctx.service.removeViewer("k2");
		await tick(120_000);
		expect(ctx.stateCalls()).toBe(2);

		ctx.service.addViewer("k3");
		await tick(0);
		expect(ctx.stateCalls()).toBe(3);
	});

	it("never overlaps state requests", async () => {
		const ctx = setup();
		let release!: () => void;
		ctx.control.gate = new Promise((resolve) => (release = resolve));
		ctx.service.addViewer("k1");
		await tick(0);

		void ctx.service.refresh();
		void ctx.service.refresh();
		await tick(60_000);
		expect(ctx.stateCalls()).toBe(1);

		ctx.control.gate = undefined;
		release();
		await tick(0);
		// Exactly one queued follow-up read, not one per refresh() call.
		expect(ctx.stateCalls()).toBe(2);
		await tick(2_999);
		expect(ctx.stateCalls()).toBe(2);
	});

	it("stops polling when Spotify disconnects and publishes signed-out", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);
		ctx.auth.update({ status: "disconnected" });
		await tick(60_000);

		expect(ctx.stateCalls()).toBe(1);
		expect(ctx.service.state.value).toMatchObject({ availability: "signed-out", item: undefined, notice: { code: "not-connected" } });
	});

	it("explains reauthorization in the shared state", () => {
		const ctx = setup();
		ctx.auth.update({ status: "reauthorization-required", message: "needs scopes" });
		expect(ctx.service.state.value.notice).toMatchObject({ code: "reauthorization-required", message: expect.stringContaining("Reconnect Spotify") as unknown });
	});
});

describe("commands", () => {
	it("pauses when playing (toggle), optimistically, then reconciles with Spotify", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);

		await expect(ctx.service.togglePlayPause()).resolves.toBe("done");
		expect(ctx.control.calls).toContain("pause");
		expect(ctx.service.state.value).toMatchObject({ isPlaying: false, optimistic: true, pendingCommand: undefined });

		await tick(700);
		expect(ctx.stateCalls()).toBe(2);
		expect(ctx.service.state.value).toMatchObject({ isPlaying: false, optimistic: false });
	});

	it("plays when paused (toggle)", async () => {
		const ctx = setup();
		ctx.control.player = observation({ isPlaying: false });
		ctx.service.addViewer("k1");
		await tick(0);

		await ctx.service.togglePlayPause();
		expect(ctx.control.calls).toContain("play");
		expect(ctx.service.state.value.isPlaying).toBe(true);
	});

	it("never lets an optimistic state diverge from Spotify", async () => {
		const ctx = setup();
		ctx.control.player = observation({ isPlaying: false });
		ctx.control.applyCommands = false;
		ctx.service.addViewer("k1");
		await tick(0);

		await ctx.service.command("play");
		expect(ctx.service.state.value.isPlaying).toBe(true);
		await tick(700);
		expect(ctx.service.state.value).toMatchObject({ isPlaying: false, optimistic: false });
	});

	it("sends play and pause explicitly", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);
		await ctx.service.command("pause");
		await tick(700);
		await ctx.service.command("play");
		expect(ctx.control.calls.filter((c) => c !== "getState")).toEqual(["pause", "play"]);
	});

	it("Next keeps the old metadata until Spotify reports the new item", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);

		await ctx.service.command("next");
		expect(ctx.control.calls).toContain("next");
		expect(ctx.service.state.value.item).toEqual(SONG_A);

		await tick(700);
		expect(ctx.service.state.value.item).toEqual(SONG_B);
	});

	it("Previous rechecks once if Spotify has not switched yet, without aggressive polling", async () => {
		const ctx = setup();
		ctx.control.player = observation({ item: SONG_B });
		ctx.control.applyCommands = false;
		ctx.service.addViewer("k1");
		await tick(0);

		await ctx.service.command("previous");
		await tick(700);
		expect(ctx.stateCalls()).toBe(2);
		expect(ctx.service.state.value.item).toEqual(SONG_B);

		// Spotify switches shortly after; one recheck picks it up.
		ctx.control.player = observation({ item: SONG_A });
		await tick(2_000);
		expect(ctx.stateCalls()).toBe(3);
		expect(ctx.service.state.value.item).toEqual(SONG_A);

		// Back to the normal 3 s cadence.
		await tick(2_999);
		expect(ctx.stateCalls()).toBe(3);
		await tick(1);
		expect(ctx.stateCalls()).toBe(4);
	});

	it("ignores presses while a command is in flight (no conflicting requests)", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);
		let release!: () => void;
		vi.mocked(ctx.transport.pause).mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));

		const first = ctx.service.togglePlayPause();
		await tick(0);
		expect(ctx.service.state.value.pendingCommand).toBe("pause");
		await expect(ctx.service.togglePlayPause()).resolves.toBe("busy");
		await expect(ctx.service.command("next")).resolves.toBe("busy");

		release();
		await expect(first).resolves.toBe("done");
		expect(ctx.control.calls.filter((c) => c !== "getState")).toEqual([]);
		expect(ctx.transport.pause).toHaveBeenCalledTimes(1);
		expect(ctx.transport.next).not.toHaveBeenCalled();
	});

	it("discards a state read that started before a command finished", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);

		// A poll starts while Spotify still reports "playing"...
		let release!: () => void;
		ctx.control.gate = new Promise((resolve) => (release = resolve));
		await tick(3_000);
		expect(ctx.stateCalls()).toBe(2);

		// ...then the user pauses. The stale poll result must not flip the key back to "playing".
		ctx.control.gate = undefined;
		const stalePlayer = ctx.control.player;
		await ctx.service.command("pause");
		ctx.control.player = { ...stalePlayer, isPlaying: false };
		release();
		await tick(0);
		expect(ctx.service.state.value).toMatchObject({ isPlaying: false, optimistic: true });

		await tick(700);
		expect(ctx.service.state.value).toMatchObject({ isPlaying: false, optimistic: false });
	});

	it("refuses commands without a request when there is no active device", async () => {
		const ctx = setup();
		ctx.control.player = INACTIVE_OBSERVATION;
		ctx.service.addViewer("k1");
		await tick(0);

		await expect(ctx.service.command("play")).rejects.toBeInstanceOf(SpotifyNoActiveDeviceError);
		expect(ctx.transport.play).not.toHaveBeenCalled();
		expect(ctx.service.state.value.notice?.message).toMatch(/Open Spotify/);
	});

	it("refreshes a stale observation before refusing (Spotify may have been started meanwhile)", async () => {
		const ctx = setup();
		ctx.control.player = INACTIVE_OBSERVATION;
		ctx.service.addViewer("k1");
		await tick(0);
		ctx.service.removeViewer("k1");

		await tick(10_000);
		ctx.control.player = observation({ isPlaying: false });
		await expect(ctx.service.command("play")).resolves.toBe("done");
		expect(ctx.transport.play).toHaveBeenCalledTimes(1);
	});

	it("maps NO_ACTIVE_DEVICE from Spotify to the inactive state", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);
		ctx.control.commandError = new SpotifyNoActiveDeviceError();

		await expect(ctx.service.command("next")).rejects.toBeInstanceOf(SpotifyNoActiveDeviceError);
		expect(ctx.service.state.value).toMatchObject({ availability: "inactive", notice: { code: "no-active-device" } });
	});

	it("does not send commands to a restricted device", async () => {
		const ctx = setup();
		ctx.control.player = observation({ device: { id: "d2", name: "Speaker", type: "Speaker", isRestricted: true, volumePercent: 60, supportsVolume: true } });
		ctx.service.addViewer("k1");
		await tick(0);
		expect(ctx.service.state.value.notice?.code).toBe("device-restricted");

		for (const command of ["play", "pause", "next", "previous"] as const) {
			await expect(ctx.service.command(command)).rejects.toBeInstanceOf(SpotifyDeviceRestrictedError);
		}
		expect(ctx.control.calls.filter((c) => c !== "getState")).toEqual([]);
	});

	it("marks the device restricted when Spotify refuses control", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);
		ctx.control.commandError = new SpotifyDeviceRestrictedError(403, undefined, "DEVICE_NOT_CONTROLLABLE");

		await expect(ctx.service.command("pause")).rejects.toBeInstanceOf(SpotifyDeviceRestrictedError);
		ctx.control.commandError = undefined;
		await expect(ctx.service.command("pause")).rejects.toBeInstanceOf(SpotifyDeviceRestrictedError);
		expect(ctx.transport.pause).toHaveBeenCalledTimes(1);
	});

	it("refuses commands while signed out, without contacting Spotify or starting OAuth", async () => {
		const ctx = setup({ connected: false });
		ctx.service.addViewer("k1");

		await expect(ctx.service.togglePlayPause()).rejects.toBeInstanceOf(PlaybackUnavailableError);
		await expect(ctx.service.command("next")).rejects.toThrow(/Spotify Account key/);
		expect(ctx.control.calls).toEqual([]);
	});
});

describe("Premium", () => {
	it("keeps showing playback state but refuses commands for non-Premium accounts", async () => {
		const ctx = setup({ product: "free" });
		ctx.service.addViewer("k1");
		await tick(0);

		expect(ctx.service.state.value).toMatchObject({ availability: "active", item: SONG_A, premiumRequired: true, notice: { code: "premium-required" } });
		await expect(ctx.service.togglePlayPause()).rejects.toBeInstanceOf(SpotifyPremiumRequiredError);
		expect(ctx.control.calls.filter((c) => c !== "getState")).toEqual([]);
		expect(ctx.auth.snapshot.status).toBe("connected");
	});

	it("does not assume non-Premium when the product is unknown", async () => {
		const ctx = setup({ product: undefined });
		ctx.auth.update({ status: "connected", profile: { id: "u", displayName: "Tester", product: undefined }, authorizedAt: 1 });
		ctx.service.addViewer("k1");
		await tick(0);
		await expect(ctx.service.command("pause")).resolves.toBe("done");
	});

	it("learns from a PREMIUM_REQUIRED response", async () => {
		const ctx = setup({ product: undefined });
		ctx.auth.update({ status: "connected", profile: { id: "u", displayName: "Tester", product: undefined }, authorizedAt: 1 });
		ctx.service.addViewer("k1");
		await tick(0);
		ctx.control.commandError = new SpotifyPremiumRequiredError();

		await expect(ctx.service.command("pause")).rejects.toBeInstanceOf(SpotifyPremiumRequiredError);
		expect(ctx.service.state.value.premiumRequired).toBe(true);
		await expect(ctx.service.command("pause")).rejects.toBeInstanceOf(SpotifyPremiumRequiredError);
		expect(ctx.transport.pause).toHaveBeenCalledTimes(1);
	});
});

describe("rate limits and quota", () => {
	it("backs off for Retry-After on a 429, keeps the last state, then resumes", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);

		ctx.control.stateError = new SpotifyRateLimitError("rate limited", 20);
		await tick(3_000);
		expect(ctx.stateCalls()).toBe(2);
		expect(ctx.service.state.value).toMatchObject({ availability: "active", item: SONG_A, notice: { code: "rate-limited" } });

		ctx.control.stateError = undefined;
		await tick(19_999);
		expect(ctx.stateCalls()).toBe(2);
		await tick(1);
		expect(ctx.stateCalls()).toBe(3);
		expect(ctx.service.state.value.notice).toBeUndefined();
	});

	it("refuses commands without a request while rate limited", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);
		ctx.control.commandError = new SpotifyRateLimitError(undefined, 30);
		await expect(ctx.service.command("next")).rejects.toBeInstanceOf(SpotifyRateLimitError);

		ctx.control.commandError = undefined;
		await expect(ctx.service.command("next")).rejects.toBeInstanceOf(SpotifyRateLimitError);
		expect(ctx.transport.next).toHaveBeenCalledTimes(1);
	});

	it("uses a default back-off when Retry-After is missing", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);
		ctx.control.stateError = new SpotifyRateLimitError(undefined, undefined);
		await tick(3_000);
		ctx.control.stateError = undefined;
		await tick(9_999);
		expect(ctx.stateCalls()).toBe(2);
		await tick(1);
		expect(ctx.stateCalls()).toBe(3);
	});

	it("stops polling on quota exhaustion, shows a non-destructive notice and does not spin", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		ctx.service.addViewer("k2");
		await tick(0);

		ctx.control.stateError = new SpotifyQuotaExceededError("Quota exceeded", undefined);
		await tick(3_000);
		expect(ctx.stateCalls()).toBe(2);
		expect(ctx.service.state.value).toMatchObject({ availability: "active", item: SONG_A, notice: { code: "quota-exceeded" } });
		expect(ctx.auth.snapshot.status).toBe("connected");

		// Presses and refreshes do not hit Spotify during the quota window.
		await expect(ctx.service.togglePlayPause()).rejects.toBeInstanceOf(SpotifyQuotaExceededError);
		await ctx.service.refresh();
		await tick(29 * 60_000);
		expect(ctx.stateCalls()).toBe(2);
		expect(ctx.control.calls.filter((c) => c !== "getState")).toEqual([]);

		// One request after the window.
		ctx.control.stateError = undefined;
		await tick(60_000);
		expect(ctx.stateCalls()).toBe(3);
		expect(ctx.service.state.value.notice).toBeUndefined();
	});

	it("honors Retry-After for quota exhaustion", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);
		ctx.control.stateError = new SpotifyQuotaExceededError(undefined, 120);
		await tick(3_000);
		ctx.control.stateError = undefined;
		await tick(119_999);
		expect(ctx.stateCalls()).toBe(2);
		await tick(1);
		expect(ctx.stateCalls()).toBe(3);
	});
});

describe("authentication and other failures", () => {
	it("asks the auth layer to re-verify when Spotify still answers 401 after the client's refresh-and-retry", async () => {
		const ctx = setup();
		ctx.control.stateError = new SpotifyUnauthorizedError(undefined);
		ctx.service.addViewer("k1");
		await tick(0);

		expect(ctx.onAuthRejected).toHaveBeenCalledTimes(1);
		expect(ctx.service.state.value.notice?.code).toBe("error");
	});

	it("slows down after a 403 and keeps the last state", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);
		ctx.control.stateError = new SpotifyForbiddenError("Forbidden");
		await tick(3_000);
		expect(ctx.service.state.value).toMatchObject({ item: SONG_A, notice: { code: "error", message: expect.stringMatching(/User Management/) as unknown } });

		await tick(29_999);
		expect(ctx.stateCalls()).toBe(2);
		await tick(1);
		expect(ctx.stateCalls()).toBe(3);
	});

	it("never logs tokens and keeps logging quiet during normal polling", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(30_000);
		expect(ctx.logger.lines.filter((l) => !l.startsWith("debug"))).toEqual([]);
	});
});

describe("command checks during a regular read", () => {
	it("re-reads for the command when a regular poll was already in flight", async () => {
		const ctx = setup();
		ctx.control.player = INACTIVE_OBSERVATION;
		ctx.service.addViewer("k1");
		await tick(0);
		expect(ctx.service.state.value.availability).toBe("inactive");

		// A regular poll is in flight when the user presses Play (Spotify was started on a device meanwhile).
		await tick(10_000);
		let release!: () => void;
		ctx.control.gate = new Promise((resolve) => (release = resolve));
		await tick(5_000);
		ctx.control.player = observation({ isPlaying: false });
		const pressed = ctx.service.command("play");
		ctx.control.gate = undefined;
		release();

		await expect(pressed).resolves.toBe("done");
		expect(ctx.transport.play).toHaveBeenCalledTimes(1);
	});
});

describe("toggle decisions", () => {
	it("decides Play/Pause on fresh state when the shared state is stale", async () => {
		const ctx = setup();
		ctx.service.addViewer("k1");
		await tick(0);
		expect(ctx.service.state.value.isPlaying).toBe(true);
		ctx.service.removeViewer("k1");

		// Paused from the Spotify desktop app while Deckify was not polling.
		ctx.control.player = observation({ isPlaying: false });
		await tick(10_000);

		await ctx.service.togglePlayPause();
		expect(ctx.transport.play).toHaveBeenCalledTimes(1);
		expect(ctx.transport.pause).not.toHaveBeenCalled();
	});
});
