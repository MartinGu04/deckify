import { describe, expect, it, vi } from "vitest";

import { SpotifyApiClient, type AccessTokenProvider } from "../src/spotify/api/client";
import {
	SpotifyDeviceRestrictedError,
	SpotifyForbiddenError,
	SpotifyNoActiveDeviceError,
	SpotifyPlayerCommandError,
	SpotifyPremiumRequiredError,
	SpotifyQuotaExceededError,
	SpotifyRateLimitError,
	SpotifyUnauthorizedError,
} from "../src/spotify/errors";
import { SpotifyWebApiTransport } from "../src/spotify/playback/web-api-transport";
import { FAKE, fakeFetch, json, type RecordedRequest } from "./helpers";
import { playerState } from "./playback-fixtures";

function setup(handler: (req: RecordedRequest) => Response) {
	const tokens: AccessTokenProvider & { refreshAccessToken: ReturnType<typeof vi.fn> } = {
		getAccessToken: vi.fn(() => Promise.resolve(FAKE.accessToken)),
		refreshAccessToken: vi.fn(() => Promise.resolve(FAKE.accessToken2)),
	};
	const { fetch, requests } = fakeFetch(handler);
	return { transport: new SpotifyWebApiTransport(new SpotifyApiClient(tokens, { fetch })), requests, tokens };
}

const noContent = (): Response => new Response(null, { status: 204 });
const playerError = (status: number, reason: string, message = "Player command failed"): Response => json(status, { error: { status, message, reason } });

describe("SpotifyWebApiTransport endpoints", () => {
	it("sets the volume with PUT /v1/me/player/volume?volume_percent=N on the active device", async () => {
		const { transport, requests } = setup(noContent);
		await transport.setVolume(73);

		expect(requests).toHaveLength(1);
		expect(requests[0]?.method).toBe("PUT");
		expect(requests[0]?.url.toString()).toBe("https://api.spotify.com/v1/me/player/volume?volume_percent=73");
		expect(requests[0]?.url.searchParams.has("device_id")).toBe(false);
		expect(requests[0]?.body).toBe("");
	});

	it("refuses volumes outside 0-100 without sending anything", async () => {
		const { transport, requests } = setup(noContent);
		for (const value of [-1, 101, 50.5, Number.NaN]) {
			await expect(transport.setVolume(value)).rejects.toBeInstanceOf(RangeError);
		}
		expect(requests).toHaveLength(0);
	});

	it("refreshes once and retries the volume request once on HTTP 401", async () => {
		const { transport, requests, tokens } = setup((req) =>
			req.headers.get("authorization") === `Bearer ${FAKE.accessToken}` ? json(401, { error: { status: 401, message: "expired" } }) : noContent(),
		);
		await transport.setVolume(40);
		expect(tokens.refreshAccessToken).toHaveBeenCalledTimes(1);
		expect(requests.map((r) => r.url.search)).toEqual(["?volume_percent=40", "?volume_percent=40"]);
	});

	it("maps VOLUME_CONTROL_DISALLOW to a typed player error", async () => {
		const { transport } = setup(() => playerError(403, "VOLUME_CONTROL_DISALLOW"));
		await expect(transport.setVolume(40)).rejects.toMatchObject({ constructor: SpotifyPlayerCommandError, reason: "VOLUME_CONTROL_DISALLOW" });
	});

	it("reads playback state with GET /v1/me/player including episodes", async () => {
		const { transport, requests } = setup(() => json(200, playerState()));
		const state = await transport.getState();

		expect(requests[0]?.method).toBe("GET");
		expect(requests[0]?.url.toString()).toBe("https://api.spotify.com/v1/me/player?additional_types=track,episode");
		expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${FAKE.accessToken}`);
		expect(state.isPlaying).toBe(true);
	});

	it("maps 204 No Content to inactive playback", async () => {
		const { transport } = setup(noContent);
		await expect(transport.getState()).resolves.toMatchObject({ active: false });
	});

	it.each([
		["play", "PUT", "https://api.spotify.com/v1/me/player/play"],
		["pause", "PUT", "https://api.spotify.com/v1/me/player/pause"],
		["next", "POST", "https://api.spotify.com/v1/me/player/next"],
		["previous", "POST", "https://api.spotify.com/v1/me/player/previous"],
	] as const)("%s sends %s %s to the active device (no device_id, no body)", async (command, method, url) => {
		const { transport, requests } = setup(noContent);
		await transport[command]();

		expect(requests).toHaveLength(1);
		expect(requests[0]?.method).toBe(method);
		expect(requests[0]?.url.toString()).toBe(url);
		expect(requests[0]?.url.searchParams.has("device_id")).toBe(false);
		expect(requests[0]?.body).toBe("");
	});

	it("accepts 200 and 202 as success for commands", async () => {
		for (const status of [200, 202]) {
			const { transport } = setup(() => new Response(null, { status }));
			await expect(transport.next()).resolves.toBeUndefined();
		}
	});
});

describe("SpotifyWebApiTransport errors", () => {
	it("refreshes once and retries once on 401", async () => {
		const { transport, requests, tokens } = setup((req) =>
			req.headers.get("authorization") === `Bearer ${FAKE.accessToken}` ? json(401, { error: { status: 401, message: "The access token expired" } }) : noContent(),
		);
		await transport.pause();

		expect(tokens.refreshAccessToken).toHaveBeenCalledTimes(1);
		expect(requests.map((r) => r.headers.get("authorization"))).toEqual([`Bearer ${FAKE.accessToken}`, `Bearer ${FAKE.accessToken2}`]);
	});

	it("does not loop when 401 persists", async () => {
		const { transport, requests } = setup(() => json(401, { error: { status: 401, message: "Invalid access token" } }));
		await expect(transport.getState()).rejects.toBeInstanceOf(SpotifyUnauthorizedError);
		expect(requests).toHaveLength(2);
	});

	it("maps NO_ACTIVE_DEVICE", async () => {
		const { transport } = setup(() => playerError(404, "NO_ACTIVE_DEVICE", "Player command failed: No active device found"));
		await expect(transport.play()).rejects.toBeInstanceOf(SpotifyNoActiveDeviceError);
	});

	it("maps PREMIUM_REQUIRED", async () => {
		const { transport } = setup(() => playerError(403, "PREMIUM_REQUIRED", "Player command failed: Premium required"));
		await expect(transport.play()).rejects.toBeInstanceOf(SpotifyPremiumRequiredError);
	});

	it.each(["DEVICE_NOT_CONTROLLABLE", "REMOTE_CONTROL_DISALLOW"])("maps %s to a restricted device", async (reason) => {
		const { transport } = setup(() => playerError(403, reason));
		await expect(transport.next()).rejects.toBeInstanceOf(SpotifyDeviceRestrictedError);
	});

	it("maps other player reasons (e.g. NO_NEXT_TRACK) without treating them as account problems", async () => {
		const { transport } = setup(() => playerError(403, "NO_NEXT_TRACK", "Player command failed: Restriction violated"));
		const error = await transport.next().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SpotifyPlayerCommandError);
		expect(error).toMatchObject({ status: 403, reason: "NO_NEXT_TRACK" });
	});

	it("maps a plain 403 (no reason) to the Development Mode access error", async () => {
		const { transport } = setup(() => json(403, { error: { status: 403, message: "Forbidden" } }));
		await expect(transport.getState()).rejects.toBeInstanceOf(SpotifyForbiddenError);
	});

	it("maps a short-term 429 to a rate limit with Retry-After", async () => {
		const { transport } = setup(() => json(429, { error: { status: 429, message: "API rate limit exceeded" } }, { "Retry-After": "4" }));
		const error = await transport.getState().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SpotifyRateLimitError);
		expect(error).not.toBeInstanceOf(SpotifyQuotaExceededError);
		expect(error).toMatchObject({ retryAfterSeconds: 4, code: "rate-limited" });
	});

	it("distinguishes a Development Mode quota 429 (reason QUOTA_EXCEEDED)", async () => {
		const { transport } = setup(() => json(429, { error: { status: 429, message: "Quota exceeded", reason: "QUOTA_EXCEEDED" } }, { "Retry-After": "3600" }));
		const error = await transport.getState().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SpotifyQuotaExceededError);
		expect(error).toMatchObject({ retryAfterSeconds: 3600, code: "quota-exceeded" });
		expect((error as Error).message).toMatch(/quota/);
	});

	it("also recognizes a top-level quota reason", async () => {
		const { transport } = setup(() => json(429, { reason: "QUOTA_EXCEEDED" }));
		await expect(transport.getState()).rejects.toBeInstanceOf(SpotifyQuotaExceededError);
	});
});
