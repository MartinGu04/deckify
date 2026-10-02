import { describe, expect, it, vi } from "vitest";

import { SpotifyAuthState } from "../src/spotify/state/auth-state";
import { recordingLogger } from "./helpers";

const profile = { id: "test-user", displayName: "Test Listener", product: "premium" };

describe("SpotifyAuthState", () => {
	it("starts as Not Configured", () => {
		expect(new SpotifyAuthState().snapshot.status).toBe("not-configured");
	});

	it("notifies every subscriber synchronously and supports unsubscribing", () => {
		const state = new SpotifyAuthState();
		const a = vi.fn();
		const b = vi.fn();
		state.subscribe(a);
		const unsubscribeB = state.subscribe(b);

		state.update({ status: "connecting" });
		unsubscribeB();
		state.update({ status: "connected", profile, authorizedAt: 1 });

		expect(a.mock.calls.map(([s]) => (s as { status: string }).status)).toEqual(["connecting", "connected"]);
		expect(b).toHaveBeenCalledTimes(1);
	});

	it("can emit the current snapshot on subscribe", () => {
		const state = new SpotifyAuthState();
		const listener = vi.fn();
		state.subscribe(listener, { emitCurrent: true });
		expect(listener).toHaveBeenCalledWith(state.snapshot);
	});

	it("only exposes the profile while connected", () => {
		const state = new SpotifyAuthState();
		state.update({ status: "connected", profile, authorizedAt: 1 });
		expect(state.snapshot.profile).toEqual(profile);

		state.update({ status: "error", profile, message: "boom" });
		expect(state.snapshot.profile).toBeUndefined();
		expect(state.snapshot.authorizedAt).toBeUndefined();
	});

	it("keeps the Client ID unless explicitly changed", () => {
		const state = new SpotifyAuthState();
		state.update({ status: "disconnected", clientId: "abc" });
		state.update({ status: "connecting" });
		expect(state.snapshot.clientId).toBe("abc");
		state.update({ status: "not-configured", clientId: undefined });
		expect(state.snapshot.clientId).toBeUndefined();
	});

	it("isolates failing listeners", () => {
		const logger = recordingLogger();
		const state = new SpotifyAuthState(logger);
		const healthy = vi.fn();
		state.subscribe(() => {
			throw new Error("listener failed");
		});
		state.subscribe(healthy);

		state.update({ status: "disconnected" });
		expect(healthy).toHaveBeenCalled();
		expect(logger.lines.some((l) => l.includes("listener failed"))).toBe(true);
	});

	it("publishes frozen snapshots", () => {
		const state = new SpotifyAuthState();
		state.update({ status: "disconnected" });
		expect(Object.isFrozen(state.snapshot)).toBe(true);
	});
});
