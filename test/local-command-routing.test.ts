import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { playPauseView, skipView } from "../src/actions/playback-views";
import { PlaybackUnavailableError } from "../src/playback/errors";
import type { LocalCommandResult, LocalPlaybackCommand, LocalPlaybackCommandTransport } from "../src/playback/local-commands";
import { INACTIVE_OBSERVATION, type PlaybackItem, type PlaybackObservation } from "../src/playback/model";
import { PlaybackService } from "../src/playback/service";
import type { PlaybackTransport } from "../src/playback/transport";
import { SpotifyPremiumRequiredError, SpotifyQuotaExceededError, SpotifyRateLimitError } from "../src/spotify/errors";
import { SpotifyAuthState } from "../src/spotify/state/auth-state";
import { recordingLogger } from "./helpers";

const SONG_A: PlaybackItem = { type: "track", id: "a", uri: "spotify:track:a", title: "Song A", subtitle: "Artist A", durationMs: 200_000 };
const SONG_B: PlaybackItem = { type: "track", id: "b", uri: "spotify:track:b", title: "Song B", subtitle: "Artist B", durationMs: 180_000 };

const playing = (overrides: Partial<PlaybackObservation> = {}): PlaybackObservation => ({
	active: true,
	isPlaying: true,
	device: { id: "d1", name: "Desktop", type: "Computer", isRestricted: false },
	item: SONG_A,
	progressMs: 1_000,
	...overrides,
});

/**
 * Service with a fake Web API transport and a fake local command path. Every call is recorded in one ordered log, so tests can assert
 * exactly which path ran and in which order.
 */
function setup(options: { product?: string; connected?: boolean; local?: boolean } = {}) {
	const calls: string[] = [];
	const control = {
		player: playing(),
		stateError: undefined as Error | undefined,
		/** When set, Web API state reads wait for this promise. */
		stateGate: undefined as Promise<void> | undefined,
		localResult: { status: "handled" } as LocalCommandResult | Error,
		localAvailable: true,
		/** When set, local commands wait for this promise. */
		localGate: undefined as Promise<void> | undefined,
	};

	const transport: PlaybackTransport = {
		id: "web-api",
		getState: vi.fn(async () => {
			calls.push("api:getState");
			if (control.stateGate) {
				await control.stateGate;
			}
			if (control.stateError) {
				throw control.stateError;
			}
			return control.player;
		}),
		play: vi.fn(() => (calls.push("api:play"), Promise.resolve())),
		pause: vi.fn(() => (calls.push("api:pause"), Promise.resolve())),
		next: vi.fn(() => (calls.push("api:next"), Promise.resolve())),
		previous: vi.fn(() => (calls.push("api:previous"), Promise.resolve())),
	};

	const local: LocalPlaybackCommandTransport & { execute: ReturnType<typeof vi.fn> } = {
		id: "fake-local",
		execute: vi.fn(async (command: LocalPlaybackCommand) => {
			calls.push(`local:${command}`);
			if (control.localGate) {
				await control.localGate;
			}
			if (control.localResult instanceof Error) {
				throw control.localResult;
			}
			return control.localResult;
		}),
		isAvailable: vi.fn(() => Promise.resolve(control.localAvailable)),
		dispose: vi.fn(),
	};

	const auth = new SpotifyAuthState();
	if (options.connected !== false) {
		auth.update({ status: "connected", profile: { id: "u", displayName: "Tester", product: options.product ?? "premium" }, authorizedAt: 1 });
	}
	const logger = recordingLogger();
	const service = new PlaybackService({
		transport,
		localCommands: options.local === false ? undefined : local,
		auth,
		clock: () => Date.now(),
		logger,
	});
	const commandCalls = (): string[] => calls.filter((c) => !c.endsWith("getState"));
	return { service, transport, local, control, calls, commandCalls, auth, logger };
}

const tick = async (ms: number): Promise<void> => {
	await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
	vi.useFakeTimers({ now: Date.UTC(2026, 9, 3, 12) });
});
afterEach(() => {
	vi.useRealTimers();
});

describe("local fast path", () => {
	it.each([
		["next", "local:next"],
		["previous", "local:previous"],
		["play", "local:play"],
		["pause", "local:pause"],
	] as const)("sends %s locally and never through the Web API", async (command, expected) => {
		const ctx = setup();
		ctx.service.addViewer("k");
		await tick(0);

		await expect(ctx.service.command(command)).resolves.toBe("done");
		expect(ctx.commandCalls()).toEqual([expected]);
	});

	it("uses the native toggle for Play/Pause without reading Spotify state first, even when the state is stale", async () => {
		const ctx = setup();
		ctx.service.addViewer("k");
		await tick(0);
		ctx.service.removeViewer("k");
		await tick(60_000); // State is now a minute old.

		const before = ctx.calls.length;
		await ctx.service.togglePlayPause();
		expect(ctx.calls.slice(before)).toEqual(["local:toggle"]);
	});

	it("completes a local command even while a Web API read is stuck", async () => {
		const ctx = setup();
		ctx.service.addViewer("k");
		await tick(0);
		ctx.control.stateGate = new Promise(() => undefined);
		await tick(3_000); // A poll is now hanging.

		await expect(ctx.service.command("next")).resolves.toBe("done");
		expect(ctx.commandCalls()).toEqual(["local:next"]);
	});

	it("flips Play/Pause optimistically, then reconciles with Spotify", async () => {
		const ctx = setup();
		ctx.service.addViewer("k");
		await tick(0);

		await ctx.service.togglePlayPause();
		expect(ctx.service.state.value).toMatchObject({ isPlaying: false, optimistic: true, pendingCommand: undefined, localControl: true });

		ctx.control.player = playing({ isPlaying: false });
		await tick(700);
		expect(ctx.service.state.value).toMatchObject({ isPlaying: false, optimistic: false });
	});

	it("keeps Next metadata until Spotify reports the new item (no invented metadata)", async () => {
		const ctx = setup();
		ctx.service.addViewer("k");
		await tick(0);

		await ctx.service.command("next");
		expect(ctx.service.state.value.item).toEqual(SONG_A);
		ctx.control.player = playing({ item: SONG_B });
		await tick(700);
		expect(ctx.service.state.value.item).toEqual(SONG_B);
	});

	it("works locally when the Web API reports no active device", async () => {
		const ctx = setup();
		ctx.control.player = INACTIVE_OBSERVATION;
		ctx.service.addViewer("k");
		await tick(0);

		await expect(ctx.service.togglePlayPause()).resolves.toBe("done");
		expect(ctx.commandCalls()).toEqual(["local:toggle"]);
	});
});

describe("Web API fallback", () => {
	it.each(["spotify-session-unavailable", "media-manager-unavailable", "command-rejected", "not-running", "spawn-failed"])(
		"falls back exactly once when the local path reports unavailable (%s)",
		async (reason) => {
			const ctx = setup();
			ctx.control.localResult = { status: "unavailable", reason };
			ctx.service.addViewer("k");
			await tick(0);

			await expect(ctx.service.command("next")).resolves.toBe("done");
			expect(ctx.commandCalls()).toEqual(["local:next", "api:next"]);
		},
	);

	it("decides the Web API toggle direction from fresh state after a local miss", async () => {
		const ctx = setup();
		ctx.control.localResult = { status: "unavailable", reason: "spotify-session-unavailable" };
		ctx.service.addViewer("k");
		await tick(0);

		await ctx.service.togglePlayPause();
		expect(ctx.commandCalls()).toEqual(["local:toggle", "api:pause"]);
	});

	it("falls back once when the local path throws (nothing was sent)", async () => {
		const ctx = setup();
		ctx.control.localResult = new Error("bridge bug");
		ctx.service.addViewer("k");
		await tick(0);

		await ctx.service.command("previous");
		expect(ctx.commandCalls()).toEqual(["local:previous", "api:previous"]);
	});

	it("never falls back when the local outcome is uncertain (no double skip)", async () => {
		const ctx = setup();
		ctx.control.localResult = { status: "uncertain", reason: "timeout" };
		ctx.service.addViewer("k");
		await tick(0);

		await expect(ctx.service.command("next")).resolves.toBe("done");
		expect(ctx.commandCalls()).toEqual(["local:next"]);
		expect(ctx.service.state.value).toMatchObject({ item: SONG_A, optimistic: false, pendingCommand: undefined });

		// Reconciliation reveals what actually happened.
		ctx.control.player = playing({ item: SONG_B });
		await tick(700);
		expect(ctx.service.state.value.item).toEqual(SONG_B);
	});

	it("behaves exactly like Phase 3 without a local path", async () => {
		const ctx = setup({ local: false });
		ctx.service.addViewer("k");
		await tick(0);
		await ctx.service.togglePlayPause();
		expect(ctx.commandCalls()).toEqual(["api:pause"]);
		expect(ctx.service.state.value.localControl).toBe(false);
	});
});

describe("rate limits and quota", () => {
	it("keeps local commands working during a Web API quota block, without any Web API request", async () => {
		const ctx = setup();
		ctx.service.addViewer("k");
		await tick(0);
		ctx.control.stateError = new SpotifyQuotaExceededError(undefined, undefined);
		await tick(3_000);
		expect(ctx.service.state.value.notice?.code).toBe("quota-exceeded");
		const before = ctx.calls.length;

		await ctx.service.togglePlayPause();
		await ctx.service.command("next");
		await ctx.service.command("previous");
		await tick(10 * 60_000);

		expect(ctx.calls.slice(before)).toEqual(["local:toggle", "local:next", "local:previous"]);
		// Keys stay usable, and the quota notice is kept because state updates are still limited.
		expect(ctx.service.state.value.notice?.code).toBe("quota-exceeded");
		expect(playPauseView(ctx.service.state.value).image).not.toContain("disabled");
		expect(skipView("next", ctx.service.state.value).image).not.toContain("disabled");
	});

	it("reconciles after a short rate limit ends, never before", async () => {
		const ctx = setup();
		ctx.service.addViewer("k");
		await tick(0);
		ctx.control.stateError = new SpotifyRateLimitError(undefined, 20);
		await tick(3_000);
		ctx.control.stateError = undefined;
		const before = ctx.calls.length;

		await ctx.service.command("next");
		await tick(19_000);
		expect(ctx.calls.slice(before)).toEqual(["local:next"]);
		await tick(1_000);
		expect(ctx.calls.slice(before)).toEqual(["local:next", "api:getState"]);
	});

	it("keeps the Phase 3 back-off when there is no local session and the Web API is rate limited", async () => {
		const ctx = setup();
		ctx.control.localResult = { status: "unavailable", reason: "spotify-session-unavailable" };
		ctx.service.addViewer("k");
		await tick(0);
		ctx.control.stateError = new SpotifyRateLimitError(undefined, 30);
		await tick(3_000);
		const before = ctx.calls.length;

		await expect(ctx.service.command("next")).rejects.toBeInstanceOf(SpotifyRateLimitError);
		expect(ctx.calls.slice(before)).toEqual(["local:next"]);
	});
});

describe("guards", () => {
	it("ignores rapid repeated presses while a local command is in flight (no double skip)", async () => {
		const ctx = setup();
		ctx.service.addViewer("k");
		await tick(0);
		let release!: () => void;
		ctx.control.localGate = new Promise((resolve) => (release = resolve));

		const first = ctx.service.command("next");
		await tick(0);
		await expect(ctx.service.command("next")).resolves.toBe("busy");
		await expect(ctx.service.togglePlayPause()).resolves.toBe("busy");
		release();
		await expect(first).resolves.toBe("done");

		expect(ctx.commandCalls()).toEqual(["local:next"]);
	});

	it("keeps the account model: no local command while signed out", async () => {
		const ctx = setup({ connected: false });
		await expect(ctx.service.togglePlayPause()).rejects.toBeInstanceOf(PlaybackUnavailableError);
		expect(ctx.calls).toEqual([]);
	});

	it("keeps the Premium rule from Phase 3", async () => {
		const ctx = setup({ product: "free" });
		ctx.service.addViewer("k");
		await tick(0);
		await expect(ctx.service.command("next")).rejects.toBeInstanceOf(SpotifyPremiumRequiredError);
		expect(ctx.commandCalls()).toEqual([]);
	});
});

describe("local availability", () => {
	it("is probed with each state read and published for the keys", async () => {
		const ctx = setup();
		ctx.service.addViewer("k");
		await tick(0);
		expect(ctx.service.state.value.localControl).toBe(true);

		ctx.control.localAvailable = false;
		await tick(3_000);
		expect(ctx.service.state.value.localControl).toBe(false);
	});

	it("is cleared when a local command reports no Spotify session", async () => {
		const ctx = setup();
		ctx.service.addViewer("k");
		await tick(0);
		ctx.control.localResult = { status: "unavailable", reason: "spotify-session-unavailable" };
		await ctx.service.command("next");
		expect(ctx.service.state.value.localControl).toBe(false);
	});

	it("logs which path performed a command (debug only, no metadata)", async () => {
		const ctx = setup();
		ctx.service.addViewer("k");
		await tick(0);
		await ctx.service.command("next");
		const line = ctx.logger.lines.find((l) => l.includes("sent via fake-local"));
		expect(line).toMatch(/^debug Playback next sent via fake-local in \d+ ms\.$/);
		expect(ctx.logger.lines.join("\n")).not.toContain("Song A");
	});
});
