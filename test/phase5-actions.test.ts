import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LibraryService } from "../src/library/service";
import type { LibraryTransport } from "../src/library/transport";
import type { PlaybackDevice, PlaybackItem, PlaybackObservation } from "../src/playback/model";
import { PlaybackService } from "../src/playback/service";
import type { PlaybackTransport } from "../src/playback/transport";
import { SpotifyNetworkError } from "../src/spotify/errors";
import { SpotifyAuthState } from "../src/spotify/state/auth-state";
import { recordingLogger } from "./helpers";

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

const { VolumeUpAction, VolumeDownAction, MuteAction } = await import("../src/actions/volume");
const { LikeAction } = await import("../src/actions/like");
const { DEFAULT_VOLUME_STEP, normalizeVolumeStep } = await import("../src/actions/volume-settings");

const SONG: PlaybackItem = { type: "track", id: "songA", uri: "spotify:track:songA", title: "Secret Title", subtitle: "Secret Artist", durationMs: 1 };
const EPISODE: PlaybackItem = { type: "episode", id: "ep", uri: "spotify:episode:ep", title: "Episode", subtitle: "Show", durationMs: 1 };

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

function setup(options: { device?: Partial<PlaybackDevice>; item?: PlaybackItem; active?: boolean; connected?: boolean; saved?: boolean } = {}) {
	let player: PlaybackObservation =
		options.active === false
			? { active: false, isPlaying: false, device: undefined, item: undefined, progressMs: undefined }
			: {
					active: true,
					isPlaying: true,
					device: { id: "d", name: "Desktop", type: "Computer", isRestricted: false, volumePercent: 40, supportsVolume: true, ...options.device },
					item: options.item ?? SONG,
					progressMs: 0,
				};
	const transport: PlaybackTransport = {
		id: "fake",
		getState: vi.fn(() => Promise.resolve(player)),
		play: vi.fn(() => Promise.resolve()),
		pause: vi.fn(() => Promise.resolve()),
		next: vi.fn(() => Promise.resolve()),
		previous: vi.fn(() => Promise.resolve()),
		setVolume: vi.fn((volume: number) => {
			if (player.device) {
				player = { ...player, device: { ...player.device, volumePercent: volume } };
			}
			return Promise.resolve();
		}),
	};
	const libraryControl = { saved: options.saved ?? false, error: undefined as Error | undefined };
	const libraryTransport: LibraryTransport = {
		id: "fake-library",
		contains: vi.fn(() => (libraryControl.error ? Promise.reject(libraryControl.error) : Promise.resolve(libraryControl.saved))),
		save: vi.fn(() => (libraryControl.error ? Promise.reject(libraryControl.error) : ((libraryControl.saved = true), Promise.resolve()))),
		remove: vi.fn(() => (libraryControl.error ? Promise.reject(libraryControl.error) : ((libraryControl.saved = false), Promise.resolve()))),
	};
	const auth = new SpotifyAuthState();
	if (options.connected !== false) {
		auth.update({ status: "connected", profile: { id: "u", displayName: "Tester", product: "premium" }, authorizedAt: 1 });
	}
	const logger = recordingLogger();
	const playback = new PlaybackService({ transport, auth, clock: () => Date.now() });
	const library = new LibraryService({ transport: libraryTransport, playback: playback.state, clock: () => Date.now(), logger });
	const actions = {
		up: new VolumeUpAction({ playback }),
		down: new VolumeDownAction({ playback }),
		mute: new MuteAction({ playback }),
		like: new LikeAction({ playback, library, logger }),
	};
	return { transport, libraryTransport, libraryControl, auth, playback, library, actions, logger, setPlayer: (p: PlaybackObservation) => (player = p) };
}

async function place(actionInstance: object & { onWillAppear(ev: never): Promise<void> }, ...keys: FakeKey[]): Promise<void> {
	sdk.keysByAction.set(actionInstance, [...(sdk.keysByAction.get(actionInstance) ?? []), ...keys]);
	for (const key of keys) {
		await actionInstance.onWillAppear({ action: key } as never);
	}
}

const press = (actionInstance: { onKeyDown(ev: never): Promise<void> }, key: FakeKey, settings: Record<string, unknown> = {}): Promise<void> =>
	actionInstance.onKeyDown({ action: key, payload: { settings } } as never);

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

describe("volume step setting", () => {
	it("defaults to 10 and accepts whole numbers from 1 to 50", () => {
		expect(DEFAULT_VOLUME_STEP).toBe(10);
		expect(normalizeVolumeStep(undefined)).toBe(10);
		for (const value of [1, 5, 10, 25, 50]) {
			expect(normalizeVolumeStep(value)).toBe(value);
		}
		expect(normalizeVolumeStep("15")).toBe(15);
	});

	it("falls back to 10 for anything invalid", () => {
		for (const value of [0, 51, -5, 7.5, Number.NaN, Number.POSITIVE_INFINITY, "", "abc", "5%", "-3", "1e1", "100", null, true, {}, [5]]) {
			expect(normalizeVolumeStep(value)).toBe(10);
		}
	});
});

describe("Volume Up / Volume Down keys", () => {
	it("use the default step of 10 when the key has no setting", async () => {
		const ctx = setup();
		const up = fakeKey("up");
		const down = fakeKey("down");
		await place(ctx.actions.up, up);
		await place(ctx.actions.down, down);
		await tick();

		await press(ctx.actions.up, up);
		expect(ctx.transport.setVolume).toHaveBeenLastCalledWith(50);
		await press(ctx.actions.down, down);
		expect(ctx.transport.setVolume).toHaveBeenLastCalledWith(40);
	});

	it("use each key's own step, and 10 for an invalid one", async () => {
		const ctx = setup();
		const up = fakeKey("up");
		await place(ctx.actions.up, up);
		await tick();

		await press(ctx.actions.up, up, { volumeStep: 5 });
		expect(ctx.transport.setVolume).toHaveBeenLastCalledWith(45);
		await press(ctx.actions.up, up, { volumeStep: 500 });
		expect(ctx.transport.setVolume).toHaveBeenLastCalledWith(55);
	});

	it("show the device volume as the title and update every volume key at once", async () => {
		const ctx = setup({ device: { volumePercent: 63 } });
		const up = fakeKey("up");
		const down = fakeKey("down");
		await place(ctx.actions.up, up);
		await place(ctx.actions.down, down);
		await tick();
		expect(up.setTitle).toHaveBeenLastCalledWith("63%");
		expect(up.setImage).toHaveBeenLastCalledWith("imgs/actions/volume/volume-up.svg");

		await press(ctx.actions.up, up);
		expect(up.setTitle).toHaveBeenLastCalledWith("73%");
		expect(down.setTitle).toHaveBeenLastCalledWith("73%");
		expect(up.showAlert).not.toHaveBeenCalled();
	});

	it("show Unsupported and alert without a request when the device has no volume control", async () => {
		const ctx = setup({ device: { supportsVolume: false } });
		const up = fakeKey("up");
		await place(ctx.actions.up, up);
		await tick();
		expect(up.setImage).toHaveBeenLastCalledWith("imgs/actions/volume/volume-up-disabled.svg");
		expect(up.setTitle).toHaveBeenLastCalledWith("Unsupported");

		await press(ctx.actions.up, up);
		expect(up.showAlert).toHaveBeenCalledTimes(1);
		expect(ctx.transport.setVolume).not.toHaveBeenCalled();
	});

	it("show No Device and Connect like the playback keys", async () => {
		const noDevice = setup({ active: false });
		const key = fakeKey("up");
		await place(noDevice.actions.up, key);
		await tick();
		expect(key.setTitle).toHaveBeenLastCalledWith("No Device");
		await press(noDevice.actions.up, key);
		expect(key.showAlert).toHaveBeenCalledTimes(1);

		const signedOut = setup({ connected: false });
		const other = fakeKey("down");
		await place(signedOut.actions.down, other);
		expect(other.setTitle).toHaveBeenLastCalledWith("Connect");
		await press(signedOut.actions.down, other);
		expect(other.showAlert).toHaveBeenCalledTimes(1);
		expect(signedOut.transport.getState).not.toHaveBeenCalled();
	});
});

describe("Mute / Unmute key", () => {
	it("shows the speaker, mutes to 0 with the muted icon, and restores the volume", async () => {
		const ctx = setup({ device: { volumePercent: 63 } });
		const mute = fakeKey("mute");
		await place(ctx.actions.mute, mute);
		await tick();
		expect(mute.setImage).toHaveBeenLastCalledWith("imgs/actions/volume/speaker.svg");

		await press(ctx.actions.mute, mute);
		expect(ctx.transport.setVolume).toHaveBeenLastCalledWith(0);
		expect(mute.setImage).toHaveBeenLastCalledWith("imgs/actions/volume/speaker-muted.svg");

		await press(ctx.actions.mute, mute);
		expect(ctx.transport.setVolume).toHaveBeenLastCalledWith(63);
		expect(mute.setImage).toHaveBeenLastCalledWith("imgs/actions/volume/speaker.svg");
	});

	it("shows muted as soon as Volume Down reaches 0, and unmuted after Volume Up", async () => {
		const ctx = setup({ device: { volumePercent: 10 } });
		const mute = fakeKey("mute");
		const down = fakeKey("down");
		const up = fakeKey("up");
		await place(ctx.actions.mute, mute);
		await place(ctx.actions.down, down);
		await place(ctx.actions.up, up);
		await tick();

		await press(ctx.actions.down, down);
		expect(mute.setImage).toHaveBeenLastCalledWith("imgs/actions/volume/speaker-muted.svg");
		expect(down.setTitle).toHaveBeenLastCalledWith("0%");
		await press(ctx.actions.up, up);
		expect(mute.setImage).toHaveBeenLastCalledWith("imgs/actions/volume/speaker.svg");
	});

	it("follows a volume change made in another Spotify app", async () => {
		const ctx = setup({ device: { volumePercent: 0 } });
		const mute = fakeKey("mute");
		await place(ctx.actions.mute, mute);
		await tick();
		expect(mute.setImage).toHaveBeenLastCalledWith("imgs/actions/volume/speaker-muted.svg");

		ctx.setPlayer({
			active: true,
			isPlaying: true,
			device: { id: "d", name: "Desktop", type: "Computer", isRestricted: false, volumePercent: 45, supportsVolume: true },
			item: SONG,
			progressMs: 0,
		});
		await tick(3_000);
		expect(mute.setImage).toHaveBeenLastCalledWith("imgs/actions/volume/speaker.svg");
	});

	it("shows Unsupported when the device has no volume control", async () => {
		const ctx = setup({ device: { supportsVolume: false } });
		const mute = fakeKey("mute");
		await place(ctx.actions.mute, mute);
		await tick();
		expect(mute.setImage).toHaveBeenLastCalledWith("imgs/actions/volume/speaker-disabled.svg");
		expect(mute.setTitle).toHaveBeenLastCalledWith("Unsupported");
	});
});

describe("Like / Unlike key", () => {
	it("shows an outline heart for a track that is not liked and fills it after a press", async () => {
		const ctx = setup();
		const like = fakeKey("like");
		await place(ctx.actions.like, like);
		await tick();
		expect(like.setImage).toHaveBeenLastCalledWith("imgs/actions/library/heart-outline.svg");

		await press(ctx.actions.like, like);
		expect(ctx.libraryTransport.save).toHaveBeenCalledWith("spotify:track:songA");
		expect(like.setImage).toHaveBeenLastCalledWith("imgs/actions/library/heart-filled.svg");

		await press(ctx.actions.like, like);
		expect(ctx.libraryTransport.remove).toHaveBeenCalledWith("spotify:track:songA");
		expect(like.setImage).toHaveBeenLastCalledWith("imgs/actions/library/heart-outline.svg");
	});

	it("shows a filled heart for a liked track", async () => {
		const ctx = setup({ saved: true });
		const like = fakeKey("like");
		await place(ctx.actions.like, like);
		await tick();
		expect(like.setImage).toHaveBeenLastCalledWith("imgs/actions/library/heart-filled.svg");
	});

	it("shows Track Only for an episode and alerts without a library request", async () => {
		const ctx = setup({ item: EPISODE });
		const like = fakeKey("like");
		await place(ctx.actions.like, like);
		await tick();
		expect(like.setImage).toHaveBeenLastCalledWith("imgs/actions/library/heart-disabled.svg");
		expect(like.setTitle).toHaveBeenLastCalledWith("Track Only");

		await press(ctx.actions.like, like);
		expect(like.showAlert).toHaveBeenCalledTimes(1);
		expect(ctx.libraryTransport.contains).not.toHaveBeenCalled();
		expect(ctx.libraryTransport.save).not.toHaveBeenCalled();
	});

	it("alerts on a failed like and logs no track details", async () => {
		const ctx = setup();
		const like = fakeKey("like");
		await place(ctx.actions.like, like);
		await tick();
		ctx.libraryControl.error = new SpotifyNetworkError();
		await press(ctx.actions.like, like);
		expect(like.showAlert).toHaveBeenCalledTimes(1);
		expect(like.setImage).toHaveBeenLastCalledWith("imgs/actions/library/heart-outline.svg");
		expect(ctx.logger.lines.join("\n")).not.toMatch(/songA|Secret Title|Secret Artist/);
	});

	it("shows Connect when signed out and never contacts Spotify", async () => {
		const ctx = setup({ connected: false });
		const like = fakeKey("like");
		await place(ctx.actions.like, like);
		await press(ctx.actions.like, like);
		expect(like.setTitle).toHaveBeenLastCalledWith("Connect");
		expect(like.showAlert).toHaveBeenCalledTimes(1);
		expect(ctx.libraryTransport.contains).not.toHaveBeenCalled();
	});

	it("registers with the library only while visible", async () => {
		const ctx = setup();
		const like = fakeKey("like");
		await place(ctx.actions.like, like);
		expect(ctx.library.viewerCount).toBe(1);
		expect(ctx.playback.viewerCount).toBe(1);
		ctx.actions.like.onWillDisappear({ action: like } as never);
		expect(ctx.library.viewerCount).toBe(0);
		expect(ctx.playback.viewerCount).toBe(0);
	});
});
