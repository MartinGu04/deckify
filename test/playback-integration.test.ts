import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlaybackService } from "../src/playback/service";
import { SpotifyAuthService } from "../src/spotify/auth/auth-service";
import { SpotifyWebApiTransport } from "../src/spotify/playback/web-api-transport";
import { SpotifyAuthState } from "../src/spotify/state/auth-state";
import { MemoryTokenStore } from "../src/spotify/storage/token-store";
import { FAKE, fakeFetch, findSecrets, json, PHASE2_SCOPES, profileResponse, recordingLogger, storedSession, tokenResponse, type RecordedRequest } from "./helpers";
import { playerState } from "./playback-fixtures";

// Real auth service, API client, Web API transport and playback service; only fetch is mocked.
function setup(options: { scopes?: readonly string[]; handler?: (req: RecordedRequest) => Response | undefined } = {}) {
	const state = new SpotifyAuthState();
	const logger = recordingLogger();
	const store = new MemoryTokenStore(storedSession({ scopes: [...(options.scopes ?? storedSession().scopes)], accessTokenExpiresAt: Date.now() + 3_600_000 }));
	const { fetch, requests } = fakeFetch((req) => {
		const custom = options.handler?.(req);
		if (custom) {
			return custom;
		}
		if (req.url.pathname === "/api/token") {
			return tokenResponse(FAKE.accessToken2);
		}
		if (req.url.pathname === "/v1/me") {
			return profileResponse();
		}
		if (req.url.pathname === "/v1/me/player") {
			return json(200, playerState());
		}
		return new Response(null, { status: 204 });
	});
	const auth = new SpotifyAuthService({ state, tokenStore: store, openUrl: () => Promise.reject(new Error("no browser")), http: { fetch }, logger });
	const playback = new PlaybackService({ transport: new SpotifyWebApiTransport(auth.api), auth: state, onAuthRejected: () => auth.verify(), logger });
	return { auth, state, playback, requests, logger, store };
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

describe("playback with the real Spotify auth stack", () => {
	it("restores the session and publishes playback state for a visible key", async () => {
		const ctx = setup();
		await ctx.auth.initialize(FAKE.clientId);
		ctx.playback.addViewer("k1");
		await tick(0);

		expect(ctx.playback.state.value).toMatchObject({ availability: "active", isPlaying: true, item: { title: "Test Song", subtitle: "First Artist, Second Artist" } });
		expect(findSecrets(ctx.logger.lines.join("\n"))).toEqual([]);
	});

	it("refreshes the token once and retries once when a playback request gets 401", async () => {
		let rejected = false;
		const ctx = setup({
			handler: (req) => {
				if (req.url.pathname === "/v1/me/player" && req.headers.get("authorization") === `Bearer ${FAKE.accessToken}` && !rejected) {
					rejected = true;
					return json(401, { error: { status: 401, message: "The access token expired" } });
				}
				return undefined;
			},
		});
		await ctx.auth.initialize(FAKE.clientId);
		ctx.playback.addViewer("k1");
		await tick(0);

		const player = ctx.requests.filter((r) => r.url.pathname === "/v1/me/player");
		expect(player.map((r) => r.headers.get("authorization"))).toEqual([`Bearer ${FAKE.accessToken}`, `Bearer ${FAKE.accessToken2}`]);
		expect(ctx.requests.filter((r) => r.url.pathname === "/api/token")).toHaveLength(1);
		expect(ctx.playback.state.value.availability).toBe("active");
		await expect(ctx.store.load()).resolves.toMatchObject({ accessToken: FAKE.accessToken2 });
	});

	it("propagates a Phase 2 session's reauthorization requirement to playback, without any playback request", async () => {
		const ctx = setup({ scopes: PHASE2_SCOPES });
		await ctx.auth.initialize(FAKE.clientId);
		ctx.playback.addViewer("k1");
		await tick(60_000);

		expect(ctx.state.snapshot.status).toBe("reauthorization-required");
		expect(ctx.playback.state.value).toMatchObject({ availability: "signed-out", notice: { code: "reauthorization-required" } });
		expect(ctx.requests).toHaveLength(0);
		await expect(ctx.playback.togglePlayPause()).rejects.toThrow(/Reconnect Spotify/);
	});

	it("toggles playback with the documented requests and reconciles", async () => {
		let playing = true;
		const ctx = setup({
			handler: (req) => {
				if (req.url.pathname === "/v1/me/player/pause") {
					playing = false;
					return new Response(null, { status: 204 });
				}
				if (req.url.pathname === "/v1/me/player") {
					return json(200, playerState({ is_playing: playing }));
				}
				return undefined;
			},
		});
		await ctx.auth.initialize(FAKE.clientId);
		ctx.playback.addViewer("k1");
		await tick(0);
		await ctx.playback.togglePlayPause();
		await tick(700);

		expect(ctx.requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
			"GET /v1/me",
			"GET /v1/me/player",
			"PUT /v1/me/player/pause",
			"GET /v1/me/player",
		]);
		expect(ctx.playback.state.value).toMatchObject({ isPlaying: false, optimistic: false });
	});

	it("signs playback out when the refresh token is revoked (invalid_grant) during polling", async () => {
		const ctx = setup({
			handler: (req) => {
				if (req.url.pathname === "/v1/me/player") {
					return json(401, { error: { status: 401, message: "The access token expired" } });
				}
				if (req.url.pathname === "/api/token") {
					return json(400, { error: "invalid_grant", error_description: "Refresh token revoked" });
				}
				return undefined;
			},
		});
		await ctx.auth.initialize(FAKE.clientId);
		ctx.playback.addViewer("k1");
		await tick(0);

		expect(ctx.state.snapshot.status).toBe("disconnected");
		expect(ctx.playback.state.value.availability).toBe("signed-out");
		const before = ctx.requests.length;
		await tick(120_000);
		expect(ctx.requests).toHaveLength(before);
	});
});
