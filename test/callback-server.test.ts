import { request } from "node:http";
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { startCallbackListener, type CallbackListener } from "../src/spotify/auth/callback-server";
import {
	AuthorizationCallbackError,
	AuthorizationCancelledError,
	AuthorizationDeniedError,
	AuthorizationStateMismatchError,
	AuthorizationTimeoutError,
	CallbackPortInUseError,
} from "../src/spotify/errors";
import { FAKE, recordingLogger } from "./helpers";

// These tests bind the real fixed port (127.0.0.1:43821); they run sequentially within this file.
const STATE = "expected-state-value";
const BASE = "http://127.0.0.1:43821";

type HttpResponse = { status: number; body: string; headers: Record<string, string | string[] | undefined> };

/**
 * Sends a raw HTTP request to the callback listener.
 * @param path Request path.
 * @param options Options.
 * @param options.method Method.
 * @param options.host Host header.
 * @returns The response.
 */
function get(path: string, options: { method?: string; host?: string } = {}): Promise<HttpResponse> {
	return new Promise((resolve, reject) => {
		const req = request(
			{ host: "127.0.0.1", port: 43821, path, method: options.method ?? "GET", headers: { Host: options.host ?? "127.0.0.1:43821" } },
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => (body += chunk));
				res.on("end", () => {
					resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
				});
			},
		);
		req.on("error", reject);
		req.end();
	});
}

let listener: CallbackListener | undefined;
let blocker: Server | undefined;

afterEach(async () => {
	listener?.close();
	listener = undefined;
	await new Promise<void>((resolve) => (blocker ? blocker.close(() => resolve()) : resolve()));
	blocker = undefined;
	// Give the OS a moment to release the port between tests.
	await new Promise((resolve) => setTimeout(resolve, 20));
});

describe("callback listener", () => {
	it("resolves with the authorization code on a valid callback and serves the success page", async () => {
		const logger = recordingLogger();
		listener = await startCallbackListener({ expectedState: STATE, logger });

		const response = await get(`/callback?code=${FAKE.code}&state=${STATE}`);
		await expect(listener.result).resolves.toEqual({ code: FAKE.code });

		expect(response.status).toBe(200);
		expect(response.body).toContain("Deckify is connected to Spotify. You can close this window.");
		expect(response.body).not.toContain(FAKE.code);
		expect(response.headers["cache-control"]).toBe("no-store");
		expect(response.headers["referrer-policy"]).toBe("no-referrer");
		expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
		expect(logger.lines.join("\n")).not.toContain(FAKE.code);
	});

	it("closes immediately after success so a second callback cannot complete the attempt", async () => {
		listener = await startCallbackListener({ expectedState: STATE });
		await get(`/callback?code=${FAKE.code}&state=${STATE}`);
		await listener.result;

		await expect(get(`/callback?code=another-code&state=${STATE}`)).rejects.toMatchObject({ code: "ECONNREFUSED" });
	});

	it("rejects with AuthorizationDeniedError when the user denies access", async () => {
		listener = await startCallbackListener({ expectedState: STATE });
		const response = await get(`/callback?error=access_denied&state=${STATE}`);

		await expect(listener.result).rejects.toBeInstanceOf(AuthorizationDeniedError);
		expect(response.status).toBe(200);
		expect(response.body).toContain("not granted");
	});

	it("rejects other Spotify errors", async () => {
		listener = await startCallbackListener({ expectedState: STATE });
		await get(`/callback?error=server_error&state=${STATE}`);
		await expect(listener.result).rejects.toBeInstanceOf(AuthorizationCallbackError);
	});

	it("rejects a callback with the wrong state and does not accept its code", async () => {
		listener = await startCallbackListener({ expectedState: STATE });
		const response = await get(`/callback?code=${FAKE.code}&state=attacker-state`);

		await expect(listener.result).rejects.toBeInstanceOf(AuthorizationStateMismatchError);
		expect(response.status).toBe(400);
		await expect(get(`/callback?code=${FAKE.code}&state=${STATE}`)).rejects.toMatchObject({ code: "ECONNREFUSED" });
	});

	it("rejects a callback without state", async () => {
		listener = await startCallbackListener({ expectedState: STATE });
		await get(`/callback?code=${FAKE.code}`);
		await expect(listener.result).rejects.toBeInstanceOf(AuthorizationStateMismatchError);
	});

	it("rejects a callback without a code", async () => {
		listener = await startCallbackListener({ expectedState: STATE });
		await get(`/callback?state=${STATE}`);
		await expect(listener.result).rejects.toBeInstanceOf(AuthorizationCallbackError);
	});

	it("answers 404 for unexpected paths without ending the attempt", async () => {
		listener = await startCallbackListener({ expectedState: STATE });

		for (const path of ["/", "/favicon.ico", "/callback/", "/Callback", "/callbackx", `/other?code=${FAKE.code}&state=${STATE}`]) {
			expect((await get(path)).status).toBe(404);
		}

		await get(`/callback?code=${FAKE.code}&state=${STATE}`);
		await expect(listener.result).resolves.toEqual({ code: FAKE.code });
	});

	it("rejects unexpected Host headers and methods without ending the attempt", async () => {
		listener = await startCallbackListener({ expectedState: STATE });

		expect((await get(`/callback?code=${FAKE.code}&state=${STATE}`, { host: "localhost:43821" })).status).toBe(400);
		expect((await get(`/callback?code=${FAKE.code}&state=${STATE}`, { host: "evil.example:43821" })).status).toBe(400);
		expect((await get(`/callback?code=${FAKE.code}&state=${STATE}`, { method: "POST" })).status).toBe(405);

		await get(`/callback?code=${FAKE.code}&state=${STATE}`);
		await expect(listener.result).resolves.toEqual({ code: FAKE.code });
	});

	it("times out and closes the listener", async () => {
		listener = await startCallbackListener({ expectedState: STATE, timeoutMs: 50 });
		await expect(listener.result).rejects.toBeInstanceOf(AuthorizationTimeoutError);
		await expect(fetch(`${BASE}/callback?code=${FAKE.code}&state=${STATE}`)).rejects.toThrow();
	});

	it("defaults to a two-minute timeout", async () => {
		const { AUTHORIZATION_TIMEOUT_MS } = await import("../src/spotify/config");
		expect(AUTHORIZATION_TIMEOUT_MS).toBe(120_000);
	});

	it("can be cancelled", async () => {
		listener = await startCallbackListener({ expectedState: STATE });
		listener.close();
		await expect(listener.result).rejects.toBeInstanceOf(AuthorizationCancelledError);
		await expect(fetch(`${BASE}/callback`)).rejects.toThrow();
	});

	it("fails cleanly with a useful message when port 43821 is already in use, without falling back", async () => {
		blocker = createServer();
		await new Promise<void>((resolve) => blocker?.listen(43821, "127.0.0.1", resolve));

		const attempt = startCallbackListener({ expectedState: STATE });
		await expect(attempt).rejects.toBeInstanceOf(CallbackPortInUseError);
		await expect(attempt).rejects.toThrow(
			"Deckify could not start its local Spotify callback listener because port 43821 on 127.0.0.1 is already in use.",
		);
	});
});

describe("end-to-end connect through the real callback listener (Spotify HTTP mocked)", () => {
	it("completes the PKCE flow when the browser follows the authorization URL's redirect", async () => {
		const { SpotifyAuthService } = await import("../src/spotify/auth/auth-service");
		const { SpotifyAuthState } = await import("../src/spotify/state/auth-state");
		const { MemoryTokenStore } = await import("../src/spotify/storage/token-store");
		const { createCodeChallenge } = await import("../src/spotify/auth/pkce");
		const { fakeFetch, profileResponse, tokenResponse } = await import("./helpers");

		const { fetch, requests } = fakeFetch((req) => (req.url.pathname === "/api/token" ? tokenResponse(FAKE.accessToken, FAKE.refreshToken) : profileResponse()));
		const state = new SpotifyAuthState();
		const store = new MemoryTokenStore();
		const pages: string[] = [];
		let authorizeUrl: URL | undefined;

		const auth = new SpotifyAuthService({
			state,
			tokenStore: store,
			http: { fetch },
			// Simulated browser + Spotify consent: redirect to the URI and state from the authorization request.
			openUrl: async (url) => {
				const authorize = new URL(url);
				authorizeUrl = authorize;
				const redirect = new URL(authorize.searchParams.get("redirect_uri") ?? "");
				redirect.searchParams.set("code", FAKE.code);
				redirect.searchParams.set("state", authorize.searchParams.get("state") ?? "");
				pages.push((await get(`${redirect.pathname}${redirect.search}`)).body);
			},
		});

		await auth.initialize(FAKE.clientId);
		await auth.connect();

		expect(state.snapshot.status).toBe("connected");
		expect(pages[0]).toContain("Deckify is connected to Spotify. You can close this window.");
		const exchange = requests.find((r) => r.url.pathname === "/api/token");
		expect(exchange?.form.get("redirect_uri")).toBe("http://127.0.0.1:43821/callback");
		// The verifier sent to the token endpoint is the one whose S256 challenge was sent to /authorize.
		expect(createCodeChallenge(exchange?.form.get("code_verifier") ?? "")).toBe(authorizeUrl?.searchParams.get("code_challenge"));
		await expect(store.load()).resolves.toMatchObject({ refreshToken: FAKE.refreshToken });

		// The listener is closed after success.
		await expect(get(`/callback?code=${FAKE.code}&state=x`)).rejects.toMatchObject({ code: "ECONNREFUSED" });
	});
});
