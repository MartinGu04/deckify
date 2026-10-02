import { describe, expect, it } from "vitest";

import { buildAuthorizationUrl } from "../src/spotify/auth/authorize-url";
import { SPOTIFY_SCOPES } from "../src/spotify/auth/scopes";
import { SPOTIFY_AUTHORIZE_URL, SPOTIFY_REDIRECT_URI, SPOTIFY_TOKEN_URL } from "../src/spotify/config";
import { FAKE } from "./helpers";

describe("redirect URI", () => {
	it("is exactly the fixed Deckify loopback URI", () => {
		expect(SPOTIFY_REDIRECT_URI).toBe("http://127.0.0.1:43821/callback");
	});

	it("uses the official Spotify endpoints", () => {
		expect(SPOTIFY_AUTHORIZE_URL).toBe("https://accounts.spotify.com/authorize");
		expect(SPOTIFY_TOKEN_URL).toBe("https://accounts.spotify.com/api/token");
	});
});

describe("scopes", () => {
	it("requests exactly the profile, playback and library scopes", () => {
		expect(SPOTIFY_SCOPES).toEqual(["user-read-private", "user-read-playback-state", "user-modify-playback-state", "user-library-read", "user-library-modify"]);
	});
});

describe("buildAuthorizationUrl", () => {
	const url = new URL(buildAuthorizationUrl({ clientId: FAKE.clientId, codeChallenge: "test-challenge", state: "test-state" }));

	it("targets the Spotify authorize endpoint", () => {
		expect(`${url.origin}${url.pathname}`).toBe("https://accounts.spotify.com/authorize");
	});

	it("includes every Authorization Code with PKCE parameter", () => {
		expect(Object.fromEntries(url.searchParams)).toEqual({
			client_id: FAKE.clientId,
			response_type: "code",
			redirect_uri: "http://127.0.0.1:43821/callback",
			code_challenge_method: "S256",
			code_challenge: "test-challenge",
			state: "test-state",
			scope: "user-read-private user-read-playback-state user-modify-playback-state user-library-read user-library-modify",
		});
	});

	it("never asks for an implicit grant or sends a secret", () => {
		expect(url.searchParams.get("response_type")).not.toBe("token");
		expect(url.toString()).not.toMatch(/secret|localhost/i);
	});
});
