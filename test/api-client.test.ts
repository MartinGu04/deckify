import { describe, expect, it, vi } from "vitest";

import { SpotifyApiClient, type AccessTokenProvider } from "../src/spotify/api/client";
import { fetchCurrentUserProfile, parseProfile } from "../src/spotify/api/profile";
import {
	SpotifyApiError,
	SpotifyForbiddenError,
	SpotifyInvalidResponseError,
	SpotifyNetworkError,
	SpotifyRateLimitError,
	SpotifyTimeoutError,
	SpotifyUnauthorizedError,
} from "../src/spotify/errors";
import { sendRequest } from "../src/spotify/http";
import { FAKE, fakeFetch, json, profileResponse } from "./helpers";

function tokens(): AccessTokenProvider & { getAccessToken: ReturnType<typeof vi.fn>; refreshAccessToken: ReturnType<typeof vi.fn> } {
	return {
		getAccessToken: vi.fn(() => Promise.resolve(FAKE.accessToken)),
		refreshAccessToken: vi.fn(() => Promise.resolve(FAKE.accessToken2)),
	};
}

describe("sendRequest", () => {
	it("times out with AbortController", async () => {
		const fetch = vi.fn(
			(_input: string, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener("abort", () => {
						reject(new DOMException("aborted", "AbortError"));
					});
				}),
		);
		await expect(sendRequest("https://api.spotify.com/v1/me", { method: "GET" }, { fetch, timeoutMs: 20 })).rejects.toBeInstanceOf(
			SpotifyTimeoutError,
		);
	});

	it("maps network failures", async () => {
		const fetch = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
		await expect(sendRequest("https://api.spotify.com/v1/me", { method: "GET" }, { fetch })).rejects.toBeInstanceOf(SpotifyNetworkError);
	});

	it("refuses redirects so credentials are never forwarded", async () => {
		const fetch = vi.fn((_input: string, _init: RequestInit) => Promise.resolve(json(200, {})));
		await sendRequest("https://api.spotify.com/v1/me", { method: "GET" }, { fetch });
		expect(fetch.mock.calls[0]?.[1].redirect).toBe("error");
	});
});

describe("SpotifyApiClient", () => {
	it("sends the bearer token to the Web API", async () => {
		const { fetch, requests } = fakeFetch(() => profileResponse());
		const client = new SpotifyApiClient(tokens(), { fetch });

		await client.get("/me");

		expect(requests[0]?.url.toString()).toBe("https://api.spotify.com/v1/me");
		expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${FAKE.accessToken}`);
	});

	it("refreshes once and retries once on HTTP 401", async () => {
		const provider = tokens();
		const { fetch, requests } = fakeFetch((req) =>
			req.headers.get("authorization") === `Bearer ${FAKE.accessToken}` ? json(401, { error: { status: 401, message: "The access token expired" } }) : profileResponse(),
		);

		await expect(new SpotifyApiClient(provider, { fetch }).get("/me")).resolves.toMatchObject({ id: "test-user" });
		expect(provider.refreshAccessToken).toHaveBeenCalledTimes(1);
		expect(requests.map((r) => r.headers.get("authorization"))).toEqual([`Bearer ${FAKE.accessToken}`, `Bearer ${FAKE.accessToken2}`]);
	});

	it("does not loop when the refreshed token is also rejected", async () => {
		const provider = tokens();
		const { fetch, requests } = fakeFetch(() => json(401, { error: { status: 401, message: "Invalid access token" } }));

		await expect(new SpotifyApiClient(provider, { fetch }).get("/me")).rejects.toBeInstanceOf(SpotifyUnauthorizedError);
		expect(requests).toHaveLength(2);
		expect(provider.refreshAccessToken).toHaveBeenCalledTimes(1);
	});

	it("maps HTTP 403 without retrying", async () => {
		const provider = tokens();
		const { fetch, requests } = fakeFetch(() => json(403, { error: { status: 403, message: "User not registered in the Developer Dashboard" } }));

		const promise = new SpotifyApiClient(provider, { fetch }).get("/me");
		await expect(promise).rejects.toBeInstanceOf(SpotifyForbiddenError);
		await expect(promise).rejects.toMatchObject({ apiMessage: "User not registered in the Developer Dashboard" });
		await expect(promise).rejects.toThrow(/User Management/);
		expect(requests).toHaveLength(1);
		expect(provider.refreshAccessToken).not.toHaveBeenCalled();
	});

	it("maps HTTP 429 with Retry-After without retrying", async () => {
		const { fetch, requests } = fakeFetch(() => json(429, { error: { status: 429, message: "API rate limit exceeded" } }, { "Retry-After": "12" }));

		const promise = new SpotifyApiClient(tokens(), { fetch }).get("/me");
		await expect(promise).rejects.toBeInstanceOf(SpotifyRateLimitError);
		await expect(promise).rejects.toMatchObject({ retryAfterSeconds: 12 });
		expect(requests).toHaveLength(1);
	});

	it("maps other errors and tolerates non-JSON error bodies", async () => {
		const { fetch } = fakeFetch(() => new Response("<html>oops</html>", { status: 500 }));
		await expect(new SpotifyApiClient(tokens(), { fetch }).get("/me")).rejects.toMatchObject({ constructor: SpotifyApiError, status: 500 });
	});
});

describe("SpotifyApiClient DELETE", () => {
	const PATH = "/me/library?uris=spotify%3Atrack%3AfakeTrack1";

	it("sends an authenticated DELETE and accepts an empty successful response", async () => {
		const { fetch, requests } = fakeFetch(() => new Response(null, { status: 200 }));

		await expect(new SpotifyApiClient(tokens(), { fetch }).request("DELETE", PATH)).resolves.toEqual({ status: 200, body: undefined });
		expect(requests).toHaveLength(1);
		expect(requests[0]?.method).toBe("DELETE");
		expect(requests[0]?.url.toString()).toBe(`https://api.spotify.com/v1${PATH}`);
		expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${FAKE.accessToken}`);
		expect(requests[0]?.headers.has("content-type")).toBe(false);
		expect(requests[0]?.body).toBe("");
	});

	it("accepts 204 No Content", async () => {
		const { fetch } = fakeFetch(() => new Response(null, { status: 204 }));
		await expect(new SpotifyApiClient(tokens(), { fetch }).request("DELETE", PATH)).resolves.toEqual({ status: 204, body: undefined });
	});

	it("refreshes once and retries the DELETE once on HTTP 401", async () => {
		const provider = tokens();
		const { fetch, requests } = fakeFetch((req) =>
			req.headers.get("authorization") === `Bearer ${FAKE.accessToken}` ? json(401, { error: { status: 401, message: "The access token expired" } }) : new Response(null, { status: 200 }),
		);

		await expect(new SpotifyApiClient(provider, { fetch }).request("DELETE", PATH)).resolves.toMatchObject({ status: 200 });
		expect(provider.refreshAccessToken).toHaveBeenCalledTimes(1);
		expect(requests.map((r) => [r.method, r.headers.get("authorization")])).toEqual([
			["DELETE", `Bearer ${FAKE.accessToken}`],
			["DELETE", `Bearer ${FAKE.accessToken2}`],
		]);
	});

	it("does not loop when the retried DELETE is rejected again", async () => {
		const provider = tokens();
		const { fetch, requests } = fakeFetch(() => json(401, { error: { status: 401, message: "Invalid access token" } }));

		await expect(new SpotifyApiClient(provider, { fetch }).request("DELETE", PATH)).rejects.toBeInstanceOf(SpotifyUnauthorizedError);
		expect(requests).toHaveLength(2);
		expect(provider.refreshAccessToken).toHaveBeenCalledTimes(1);
	});

	it("maps HTTP 403 to a typed error without retrying", async () => {
		const provider = tokens();
		const { fetch, requests } = fakeFetch(() => json(403, { error: { status: 403, message: "Insufficient client scope" } }));

		await expect(new SpotifyApiClient(provider, { fetch }).request("DELETE", PATH)).rejects.toBeInstanceOf(SpotifyForbiddenError);
		expect(requests).toHaveLength(1);
		expect(provider.refreshAccessToken).not.toHaveBeenCalled();
	});

	it("maps HTTP 429 to a typed error with Retry-After, without retrying", async () => {
		const { fetch, requests } = fakeFetch(() => json(429, { error: { status: 429, message: "API rate limit exceeded" } }, { "Retry-After": "7" }));

		const promise = new SpotifyApiClient(tokens(), { fetch }).request("DELETE", PATH);
		await expect(promise).rejects.toBeInstanceOf(SpotifyRateLimitError);
		await expect(promise).rejects.toMatchObject({ retryAfterSeconds: 7 });
		expect(requests).toHaveLength(1);
	});

	it("still sends GET, PUT and POST unchanged", async () => {
		const { fetch, requests } = fakeFetch(() => new Response(null, { status: 204 }));
		const client = new SpotifyApiClient(tokens(), { fetch });
		await client.request("GET", "/me/player");
		await client.request("PUT", "/me/player/pause");
		await client.request("POST", "/me/player/next");
		expect(requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual(["GET /v1/me/player", "PUT /v1/me/player/pause", "POST /v1/me/player/next"]);
	});
});

describe("current-user profile", () => {
	it("fetches GET /v1/me and validates it", async () => {
		const { fetch } = fakeFetch(() => profileResponse("Test Listener"));
		await expect(fetchCurrentUserProfile(new SpotifyApiClient(tokens(), { fetch }))).resolves.toEqual({
			id: "test-user",
			displayName: "Test Listener",
			product: "premium",
		});
	});

	it("falls back to the user ID when there is no display name", () => {
		expect(parseProfile({ id: "test-user", display_name: null }).displayName).toBe("test-user");
		expect(parseProfile({ id: "test-user", display_name: "   " }).displayName).toBe("test-user");
		expect(parseProfile({ id: "test-user" }).displayName).toBe("test-user");
	});

	it("rejects invalid profiles", () => {
		for (const body of [undefined, null, [], {}, { id: "" }, { id: 42 }, { id: "u", display_name: 42 }]) {
			expect(() => parseProfile(body)).toThrow(SpotifyInvalidResponseError);
		}
	});
});
