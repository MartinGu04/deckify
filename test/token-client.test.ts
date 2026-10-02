import { describe, expect, it } from "vitest";

import { exchangeAuthorizationCode, refreshAccessToken } from "../src/spotify/auth/token-client";
import { SpotifyApiError, SpotifyInvalidResponseError, SpotifyOAuthError, SpotifyRateLimitError } from "../src/spotify/errors";
import { FAKE, fakeFetch, json, tokenResponse } from "./helpers";

describe("exchangeAuthorizationCode", () => {
	it("posts the PKCE code exchange with the exact redirect URI and no client secret", async () => {
		const { fetch, requests } = fakeFetch(() => tokenResponse(FAKE.accessToken, FAKE.refreshToken));

		const tokens = await exchangeAuthorizationCode({ clientId: FAKE.clientId, code: FAKE.code, codeVerifier: "test-verifier" }, { fetch });

		expect(tokens).toEqual({ accessToken: FAKE.accessToken, refreshToken: FAKE.refreshToken, expiresInSeconds: 3600, scopes: ["user-read-private"] });
		expect(requests).toHaveLength(1);
		const [req] = requests;
		expect(req?.url.toString()).toBe("https://accounts.spotify.com/api/token");
		expect(req?.method).toBe("POST");
		expect(req?.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
		expect(req?.headers.has("authorization")).toBe(false);
		expect(Object.fromEntries(req?.form ?? [])).toEqual({
			grant_type: "authorization_code",
			code: FAKE.code,
			redirect_uri: "http://127.0.0.1:43821/callback",
			client_id: FAKE.clientId,
			code_verifier: "test-verifier",
		});
		expect(req?.body).not.toMatch(/secret/i);
	});

	it("requires a refresh token in the exchange response", async () => {
		const { fetch } = fakeFetch(() => tokenResponse(FAKE.accessToken));
		await expect(exchangeAuthorizationCode({ clientId: FAKE.clientId, code: FAKE.code, codeVerifier: "v" }, { fetch })).rejects.toBeInstanceOf(
			SpotifyInvalidResponseError,
		);
	});

	it("maps OAuth error payloads", async () => {
		const { fetch } = fakeFetch(() => json(400, { error: "invalid_grant", error_description: "Invalid authorization code" }));
		const promise = exchangeAuthorizationCode({ clientId: FAKE.clientId, code: FAKE.code, codeVerifier: "v" }, { fetch });

		await expect(promise).rejects.toBeInstanceOf(SpotifyOAuthError);
		await expect(promise).rejects.toMatchObject({ status: 400, oauthError: "invalid_grant", isInvalidGrant: true });
	});

	it("rejects malformed token responses", async () => {
		for (const body of [
			{},
			{ access_token: "", token_type: "Bearer", expires_in: 3600, refresh_token: "r" },
			{ access_token: "a", token_type: "mac", expires_in: 3600, refresh_token: "r" },
			{ access_token: "a", token_type: "Bearer", expires_in: -1, refresh_token: "r" },
			{ access_token: "a", token_type: "Bearer", expires_in: "3600", refresh_token: "r" },
			[],
		]) {
			const { fetch } = fakeFetch(() => json(200, body));
			await expect(
				exchangeAuthorizationCode({ clientId: FAKE.clientId, code: FAKE.code, codeVerifier: "v" }, { fetch }),
			).rejects.toBeInstanceOf(SpotifyInvalidResponseError);
		}
	});
});

describe("refreshAccessToken", () => {
	it("posts a PKCE refresh with only the Client ID and refresh token", async () => {
		const { fetch, requests } = fakeFetch(() => tokenResponse(FAKE.accessToken2, FAKE.refreshToken2));

		const tokens = await refreshAccessToken({ clientId: FAKE.clientId, refreshToken: FAKE.refreshToken }, { fetch });

		expect(tokens.accessToken).toBe(FAKE.accessToken2);
		expect(tokens.refreshToken).toBe(FAKE.refreshToken2);
		expect(Object.fromEntries(requests[0]?.form ?? [])).toEqual({
			grant_type: "refresh_token",
			refresh_token: FAKE.refreshToken,
			client_id: FAKE.clientId,
		});
		expect(requests[0]?.headers.has("authorization")).toBe(false);
	});

	it("reports no refresh token when Spotify does not rotate it", async () => {
		const { fetch } = fakeFetch(() => tokenResponse(FAKE.accessToken2));
		const tokens = await refreshAccessToken({ clientId: FAKE.clientId, refreshToken: FAKE.refreshToken }, { fetch });
		expect(tokens.refreshToken).toBeUndefined();
	});

	it("maps 429 to a rate limit error with Retry-After", async () => {
		const { fetch } = fakeFetch(() => json(429, { error: "rate_limited" }, { "Retry-After": "7" }));
		const promise = refreshAccessToken({ clientId: FAKE.clientId, refreshToken: FAKE.refreshToken }, { fetch });
		await expect(promise).rejects.toBeInstanceOf(SpotifyRateLimitError);
		await expect(promise).rejects.toMatchObject({ retryAfterSeconds: 7 });
	});

	it("maps non-OAuth server errors", async () => {
		const { fetch } = fakeFetch(() => new Response("Bad gateway", { status: 502 }));
		await expect(refreshAccessToken({ clientId: FAKE.clientId, refreshToken: FAKE.refreshToken }, { fetch })).rejects.toMatchObject({
			constructor: SpotifyApiError,
			status: 502,
		});
	});

	it("never puts tokens into error messages", async () => {
		const { fetch } = fakeFetch(() => json(400, { error: "invalid_grant", error_description: "Refresh token revoked" }));
		const error = (await refreshAccessToken({ clientId: FAKE.clientId, refreshToken: FAKE.refreshToken }, { fetch }).catch((e: unknown) => e)) as Error;
		expect(error.message).not.toContain(FAKE.refreshToken);
	});
});
