import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaybackItem, PlaybackObservation } from "../src/playback/model";
import { PlaybackService } from "../src/playback/service";
import type { PlaybackTransport } from "../src/playback/transport";
import { SpotifyAuthState } from "../src/spotify/state/auth-state";

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

const { PlayPauseAction } = await import("../src/actions/play-pause");
const { NextTrackAction, PreviousTrackAction } = await import("../src/actions/skip-track");
const { NowPlayingAction } = await import("../src/actions/now-playing");

const SONG: PlaybackItem = { type: "track", id: "a", uri: "spotify:track:a", title: "Test Song", subtitle: "Test Artist", durationMs: 200_000 };

function fakeKey(id: string) {
	return {
		id,
		isKey: () => true,
		setImage: vi.fn((_image: string) => Promise.resolve()),
		setTitle: vi.fn((_title: string) => Promise.resolve()),
		showAlert: vi.fn(() => Promise.resolve()),
		showOk: vi.fn(() => Promise.resolve()),
	};
}
type FakeKey = ReturnType<typeof fakeKey>;

function setup(options: { connected?: boolean } = {}) {
	let player: PlaybackObservation = {
		active: true,
		isPlaying: true,
		device: { id: "d", name: "Desktop", type: "Computer", isRestricted: false },
		item: SONG,
		progressMs: 100_000,
	};
	const transport: PlaybackTransport = {
		id: "fake",
		getState: vi.fn(() => Promise.resolve(player)),
		play: vi.fn(() => {
			player = { ...player, isPlaying: true };
			return Promise.resolve();
		}),
		pause: vi.fn(() => {
			player = { ...player, isPlaying: false };
			return Promise.resolve();
		}),
		next: vi.fn(() => Promise.resolve()),
		previous: vi.fn(() => Promise.resolve()),
	};
	const auth = new SpotifyAuthState();
	if (options.connected !== false) {
		auth.update({ status: "connected", profile: { id: "u", displayName: "Tester", product: "premium" }, authorizedAt: 1 });
	}
	const playback = new PlaybackService({ transport, auth, clock: () => Date.now() });
	const actions = {
		playPause: new PlayPauseAction({ playback }),
		next: new NextTrackAction({ playback }),
		previous: new PreviousTrackAction({ playback }),
		nowPlaying: new NowPlayingAction({ playback }),
	};
	return { transport, auth, playback, actions };
}

/** Places keys on the (fake) device for an action and fires willAppear for each. */
async function place(actionInstance: object & { onWillAppear(ev: never): Promise<void> }, ...keys: FakeKey[]): Promise<void> {
	sdk.keysByAction.set(actionInstance, [...(sdk.keysByAction.get(actionInstance) ?? []), ...keys]);
	for (const key of keys) {
		await actionInstance.onWillAppear({ action: key } as never);
	}
}

const tick = async (ms: number): Promise<void> => {
	await vi.advanceTimersByTimeAsync(ms);
};
const decodeSvg = (dataUri: string | undefined): string => Buffer.from((dataUri ?? "").split(",")[1] ?? "", "base64").toString("utf8");

beforeEach(() => {
	vi.useFakeTimers({ now: Date.UTC(2026, 9, 2, 12) });
	sdk.keysByAction.clear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("playback actions", () => {
	it("propagate one shared state to every instance of every playback action", async () => {
		const ctx = setup();
		const playPauseKeys = [fakeKey("pp1"), fakeKey("pp2")];
		const nowPlayingKeys = [fakeKey("np1"), fakeKey("np2")];
		await place(ctx.actions.playPause, ...playPauseKeys);
		await place(ctx.actions.nowPlaying, ...nowPlayingKeys);
		await tick(0);

		// One state read for all four keys.
		expect(ctx.transport.getState).toHaveBeenCalledTimes(1);
		expect(ctx.playback.viewerCount).toBe(4);

		for (const key of playPauseKeys) {
			expect(key.setImage).toHaveBeenLastCalledWith("imgs/actions/playback/pause.svg");
		}
		for (const key of nowPlayingKeys) {
			const svg = decodeSvg(key.setImage.mock.calls.at(-1)?.[0]);
			expect(svg).toContain("Test Song");
			expect(svg).toContain("Test Artist");
		}
	});

	it("Play / Pause toggles and every Play / Pause key flips immediately", async () => {
		const ctx = setup();
		const keys = [fakeKey("pp1"), fakeKey("pp2")];
		await place(ctx.actions.playPause, ...keys);
		await tick(0);

		await ctx.actions.playPause.onKeyDown({ action: keys[0] } as never);
		expect(ctx.transport.pause).toHaveBeenCalledTimes(1);
		for (const key of keys) {
			expect(key.setImage).toHaveBeenLastCalledWith("imgs/actions/playback/play.svg");
		}
		expect(keys[0]?.showAlert).not.toHaveBeenCalled();
	});

	it("Next and Previous send their commands", async () => {
		const ctx = setup();
		const next = fakeKey("n");
		const previous = fakeKey("p");
		await place(ctx.actions.next, next);
		await place(ctx.actions.previous, previous);
		await tick(0);

		await ctx.actions.next.onKeyDown({ action: next } as never);
		await tick(700);
		await ctx.actions.previous.onKeyDown({ action: previous } as never);
		expect(ctx.transport.next).toHaveBeenCalledTimes(1);
		expect(ctx.transport.previous).toHaveBeenCalledTimes(1);
		expect(next.setImage).toHaveBeenLastCalledWith("imgs/actions/playback/next.svg");
	});

	it("alert when pressed while disconnected and never contact Spotify or start OAuth", async () => {
		const ctx = setup({ connected: false });
		const keys = { pp: fakeKey("pp"), n: fakeKey("n"), p: fakeKey("p"), np: fakeKey("np") };
		await place(ctx.actions.playPause, keys.pp);
		await place(ctx.actions.next, keys.n);
		await place(ctx.actions.previous, keys.p);
		await place(ctx.actions.nowPlaying, keys.np);

		await ctx.actions.playPause.onKeyDown({ action: keys.pp } as never);
		await ctx.actions.next.onKeyDown({ action: keys.n } as never);
		await ctx.actions.previous.onKeyDown({ action: keys.p } as never);
		await ctx.actions.nowPlaying.onKeyDown({ action: keys.np } as never);

		for (const key of Object.values(keys)) {
			expect(key.showAlert).toHaveBeenCalledTimes(1);
		}
		expect(ctx.transport.getState).not.toHaveBeenCalled();
		expect(ctx.transport.play).not.toHaveBeenCalled();
		expect(keys.pp.setImage).toHaveBeenLastCalledWith("imgs/actions/playback/play-disabled.svg");
		expect(keys.pp.setTitle).toHaveBeenLastCalledWith("Connect");
		expect(decodeSvg(keys.np.setImage.mock.calls.at(-1)?.[0])).toContain("Connect Spotify");
	});

	it("show Reconnect when Spotify needs reauthorization for playback scopes", async () => {
		const ctx = setup();
		const key = fakeKey("pp");
		await place(ctx.actions.playPause, key);
		ctx.auth.update({ status: "reauthorization-required", message: "new scopes" });
		await tick(0);
		expect(key.setTitle).toHaveBeenLastCalledWith("Reconnect");
	});

	it("stop polling when their keys disappear", async () => {
		const ctx = setup();
		const key = fakeKey("np");
		await place(ctx.actions.nowPlaying, key);
		await tick(0);
		ctx.actions.nowPlaying.onWillDisappear({ action: key } as never);
		await tick(60_000);
		expect(ctx.transport.getState).toHaveBeenCalledTimes(1);
		expect(ctx.playback.viewerCount).toBe(0);
	});

	it("do not re-send unchanged images to Stream Deck", async () => {
		const ctx = setup();
		ctx.transport.getState = vi.fn(() =>
			Promise.resolve({ active: true, isPlaying: true, device: { id: "d", name: "D", type: "Computer", isRestricted: false }, item: SONG, progressMs: 0 }),
		);
		const key = fakeKey("pp");
		await place(ctx.actions.playPause, key);
		await tick(0);
		const rendersAfterFirstState = key.setImage.mock.calls.length;
		expect(key.setImage).toHaveBeenLastCalledWith("imgs/actions/playback/pause.svg");

		await tick(9_000);
		expect(ctx.transport.getState).toHaveBeenCalledTimes(4);
		expect(key.setImage).toHaveBeenCalledTimes(rendersAfterFirstState);
	});

	it("Now Playing press refreshes the shared state instead of controlling playback", async () => {
		const ctx = setup();
		const key = fakeKey("np");
		await place(ctx.actions.nowPlaying, key);
		await tick(0);
		await ctx.actions.nowPlaying.onKeyDown({ action: key } as never);
		expect(ctx.transport.getState).toHaveBeenCalledTimes(2);
		expect(ctx.transport.pause).not.toHaveBeenCalled();
	});
});
