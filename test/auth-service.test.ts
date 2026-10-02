import { describe, expect, it, vi } from "vitest";

import { SpotifyAuthService } from "../src/spotify/auth/auth-service";
import type { AuthorizationCallback, CallbackListener, CallbackListenerOptions } from "../src/spotify/auth/callback-server";
import { createCodeChallenge, type PkceAttempt } from "../src/spotify/auth/pkce";
import {
	AuthorizationCancelledError,
	AuthorizationDeniedError,
	AuthorizationStateMismatchError,
	AuthorizationTimeoutError,
	CallbackPortInUseError,
	SpotifyNotConnectedError,
	SpotifyReauthorizationRequiredError,
	TokenStoreError,
} from "../src/spotify/errors";
import { SpotifyAuthState, type SpotifyAuthSnapshot } from "../src/spotify/state/auth-state";
import { MemoryTokenStore, type StoredSpotifySession } from "../src/spotify/storage/token-store";
import { FAKE, fakeClock, fakeFetch, findSecrets, json, profileResponse, recordingLogger, storedSession, tokenResponse, type RecordedRequest } from "./helpers";

const PKCE: PkceAttempt = { codeVerifier: "test-code-verifier", codeChallenge: createCodeChallenge("test-code-verifier"), state: "test-oauth-state" };
const HOUR = 60 * 60 * 1000;

/**
 * Default fake Spotify: code exchange issues token 1, refresh issues token 2 (without rotation), /me returns a profile.
 * @param req Request.
 * @returns Response.
 */
function defaultSpotify(req: RecordedRequest): Response {
	if (req.url.pathname === "/api/token") {
		return req.form.get("grant_type") === "authorization_code" ? tokenResponse(FAKE.accessToken, FAKE.refreshToken) : tokenResponse(FAKE.accessToken2);
	}
	if (req.url.pathname === "/v1/me") {
		return profileResponse();
	}
	return new Response("not found", { status: 404 });
}

/**
 * Fake callback listener controlled by the test, standing in for the browser redirect.
 * @returns Controls.
 */
function fakeListener() {
	const starts: CallbackListenerOptions[] = [];
	let settle: ((outcome: AuthorizationCallback | Error) => void) | undefined;
	const close = vi.fn(() => settle?.(new AuthorizationCancelledError()));
	let startError: Error | undefined;

	const start = vi.fn((options: CallbackListenerOptions): Promise<CallbackListener> => {
		starts.push(options);
		if (startError) {
			return Promise.reject(startError);
		}
		const result = new Promise<AuthorizationCallback>((resolve, reject) => {
			let done = false;
			settle = (outcome) => {
				if (!done) {
					done = true;
					if (outcome instanceof Error) {
						reject(outcome);
					} else {
						resolve(outcome);
					}
				}
			};
		});
		result.catch(() => undefined);
		return Promise.resolve({ result, close });
	});

	return {
		start,
		starts,
		close,
		failToStart: (err: Error) => (startError = err),
		respond: (outcome: AuthorizationCallback | Error) => settle?.(outcome),
	};
}

type Options = {
	store?: MemoryTokenStore;
	spotify?: (req: RecordedRequest) => Response | Promise<Response>;
	onBrowserOpen?: (url: URL, listener: ReturnType<typeof fakeListener>) => void;
};

/**
 * Creates the service with fakes for every side effect.
 * @param options Options.
 * @returns The service and its fakes.
 */
function setup(options: Options = {}) {
	const store = options.store ?? new MemoryTokenStore();
	const state = new SpotifyAuthState();
	const history: SpotifyAuthSnapshot[] = [];
	state.subscribe((s) => history.push(s));
	const logger = recordingLogger();
	const clock = fakeClock();
	const { fetch, requests } = fakeFetch(options.spotify ?? defaultSpotify);
	const listener = fakeListener();
	const opened: URL[] = [];
	const onBrowserOpen = options.onBrowserOpen ?? ((_url, l) => l.respond({ code: FAKE.code }));
	const openUrl = vi.fn((url: string) => {
		opened.push(new URL(url));
		onBrowserOpen(new URL(url), listener);
		return Promise.resolve();
	});

	const auth = new SpotifyAuthService({
		state,
		tokenStore: store,
		openUrl,
		http: { fetch },
		clock: clock.now,
		logger,
		startCallbackListener: listener.start,
		createPkceAttempt: () => PKCE,
	});

	const tokenRequests = (): RecordedRequest[] => requests.filter((r) => r.url.pathname === "/api/token");
	return { auth, state, history, store, logger, clock, requests, tokenRequests, listener, opened, openUrl };
}

/**
 * Asserts no fake secret leaked into logs or published state.
 * @param ctx Test context.
 */
function expectNoLeaks(ctx: ReturnType<typeof setup>): void {
	expect(findSecrets(ctx.logger.lines.join("\n"))).toEqual([]);
	expect(findSecrets(JSON.stringify(ctx.history))).toEqual([]);
}

describe("connect", () => {
	it("runs the Authorization Code flow with PKCE and publishes Connected", async () => {
		const ctx = setup();
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.connect();

		// Browser opened once with the PKCE authorization request.
		expect(ctx.opened).toHaveLength(1);
		const params = ctx.opened[0]?.searchParams;
		expect(params?.get("client_id")).toBe(FAKE.clientId);
		expect(params?.get("response_type")).toBe("code");
		expect(params?.get("redirect_uri")).toBe("http://127.0.0.1:43821/callback");
		expect(params?.get("code_challenge_method")).toBe("S256");
		expect(params?.get("code_challenge")).toBe(PKCE.codeChallenge);
		expect(params?.get("state")).toBe(PKCE.state);
		expect(params?.get("scope")).toBe("user-read-private");

		// The listener validates the same state; the code is exchanged with the verifier and the same redirect URI.
		expect(ctx.listener.starts[0]?.expectedState).toBe(PKCE.state);
		const exchange = ctx.tokenRequests()[0];
		expect(exchange?.form.get("code")).toBe(FAKE.code);
		expect(exchange?.form.get("code_verifier")).toBe(PKCE.codeVerifier);
		expect(exchange?.form.get("redirect_uri")).toBe("http://127.0.0.1:43821/callback");
		expect(exchange?.form.has("client_secret")).toBe(false);

		expect(ctx.history.map((s) => s.status)).toEqual(["disconnected", "connecting", "connected"]);
		expect(ctx.state.snapshot.profile?.displayName).toBe("Test Listener");
		expect(ctx.state.snapshot.authorizedAt).toBe(ctx.clock.now());

		await expect(ctx.store.load()).resolves.toEqual({
			clientId: FAKE.clientId,
			accessToken: FAKE.accessToken,
			refreshToken: FAKE.refreshToken,
			accessTokenExpiresAt: ctx.clock.now() + HOUR,
			authorizedAt: ctx.clock.now(),
			scopes: ["user-read-private"],
		});
		expect(ctx.listener.close).toHaveBeenCalled();
		expectNoLeaks(ctx);
	});

	it("shares one attempt between concurrent connect calls", async () => {
		const ctx = setup();
		await ctx.auth.initialize(FAKE.clientId);
		await Promise.all([ctx.auth.connect(), ctx.auth.connect()]);
		expect(ctx.listener.start).toHaveBeenCalledTimes(1);
		expect(ctx.opened).toHaveLength(1);
	});

	it("publishes Disconnected when the user denies access, storing nothing", async () => {
		const ctx = setup({ onBrowserOpen: (_url, l) => l.respond(new AuthorizationDeniedError()) });
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.connect();

		expect(ctx.state.snapshot.status).toBe("disconnected");
		expect(ctx.state.snapshot.message).toMatch(/not granted/);
		expect(ctx.tokenRequests()).toHaveLength(0);
		await expect(ctx.store.load()).resolves.toBeUndefined();
	});

	it.each([
		["state mismatch", new AuthorizationStateMismatchError(), /state mismatch/],
		["timeout", new AuthorizationTimeoutError(), /timed out/],
	])("publishes Error on %s without exchanging a code", async (_name, error, message) => {
		const ctx = setup({ onBrowserOpen: (_url, l) => l.respond(error) });
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.connect();

		expect(ctx.state.snapshot.status).toBe("error");
		expect(ctx.state.snapshot.message).toMatch(message);
		expect(ctx.tokenRequests()).toHaveLength(0);
		await expect(ctx.store.load()).resolves.toBeUndefined();
	});

	it("reports an occupied port 43821 and never opens the browser", async () => {
		const ctx = setup();
		ctx.listener.failToStart(new CallbackPortInUseError());
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.connect();

		expect(ctx.openUrl).not.toHaveBeenCalled();
		expect(ctx.state.snapshot.status).toBe("error");
		expect(ctx.state.snapshot.message).toContain(
			"Deckify could not start its local Spotify callback listener because port 43821 on 127.0.0.1 is already in use.",
		);
	});

	it("does not store tokens when the profile check fails (e.g. Development Mode 403)", async () => {
		const ctx = setup({
			spotify: (req) =>
				req.url.pathname === "/v1/me" ? json(403, { error: { status: 403, message: "User not registered in the Developer Dashboard" } }) : defaultSpotify(req),
		});
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.connect();

		expect(ctx.state.snapshot.status).toBe("error");
		expect(ctx.state.snapshot.message).toMatch(/User Management/);
		expect(ctx.auth.hasSession).toBe(false);
		await expect(ctx.store.load()).resolves.toBeUndefined();
		expectNoLeaks(ctx);
	});

	it("stays connected in memory but warns when the session cannot be saved", async () => {
		const store = new MemoryTokenStore();
		vi.spyOn(store, "save").mockRejectedValue(new TokenStoreError("DPAPI unavailable"));
		const ctx = setup({ store });
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.connect();

		expect(ctx.state.snapshot.status).toBe("connected");
		expect(ctx.state.snapshot.message).toMatch(/could not be saved securely/);
	});

	it("asks for a Client ID instead of opening the browser when none is configured", async () => {
		const ctx = setup();
		await ctx.auth.initialize(undefined);
		await ctx.auth.connect();

		expect(ctx.openUrl).not.toHaveBeenCalled();
		expect(ctx.state.snapshot.status).toBe("not-configured");
		expect(ctx.state.snapshot.message).toMatch(/Client ID/);
	});
});

describe("startup restoration", () => {
	it("restores a valid session without opening the browser or refreshing", async () => {
		const ctx = setup({ store: new MemoryTokenStore(storedSession({ accessTokenExpiresAt: Date.UTC(2026, 0, 1) + HOUR })) });
		await ctx.auth.initialize(FAKE.clientId);

		expect(ctx.openUrl).not.toHaveBeenCalled();
		expect(ctx.listener.start).not.toHaveBeenCalled();
		expect(ctx.tokenRequests()).toHaveLength(0);
		expect(ctx.requests[0]?.headers.get("authorization")).toBe(`Bearer ${FAKE.accessToken}`);
		expect(ctx.history.map((s) => s.status)).toEqual(["connecting", "connected"]);
		expect(ctx.state.snapshot.authorizedAt).toBe(Date.UTC(2025, 11, 1));
	});

	it("refreshes an expired access token, keeps the refresh token and authorization time, and persists the result", async () => {
		const original = storedSession({ accessTokenExpiresAt: Date.UTC(2026, 0, 1) - 1 });
		const ctx = setup({ store: new MemoryTokenStore(original) });
		await ctx.auth.initialize(FAKE.clientId);

		expect(ctx.tokenRequests()).toHaveLength(1);
		expect(ctx.state.snapshot.status).toBe("connected");
		await expect(ctx.store.load()).resolves.toEqual({
			...original,
			accessToken: FAKE.accessToken2,
			accessTokenExpiresAt: ctx.clock.now() + HOUR,
			refreshToken: FAKE.refreshToken,
			authorizedAt: original.authorizedAt,
		});
		expect(ctx.logger.lines.join("\n")).toContain("refresh token rotated: no");
		expectNoLeaks(ctx);
	});

	it("refreshes an access token that expires within the safety margin", async () => {
		const ctx = setup({ store: new MemoryTokenStore(storedSession({ accessTokenExpiresAt: Date.UTC(2026, 0, 1) + 30_000 })) });
		await ctx.auth.initialize(FAKE.clientId);
		expect(ctx.tokenRequests()).toHaveLength(1);
	});

	it("clears storage and publishes Disconnected when Spotify answers invalid_grant, without retrying", async () => {
		const ctx = setup({
			store: new MemoryTokenStore(storedSession({ accessTokenExpiresAt: 0 })),
			spotify: (req) => (req.url.pathname === "/api/token" ? json(400, { error: "invalid_grant", error_description: "Refresh token revoked" }) : defaultSpotify(req)),
		});
		await ctx.auth.initialize(FAKE.clientId);

		expect(ctx.tokenRequests()).toHaveLength(1);
		expect(ctx.state.snapshot.status).toBe("disconnected");
		expect(ctx.state.snapshot.message).toBe(new SpotifyReauthorizationRequiredError().message);
		expect(ctx.state.snapshot.clientId).toBe(FAKE.clientId);
		expect(ctx.auth.hasSession).toBe(false);
		await expect(ctx.store.load()).resolves.toBeUndefined();
		await expect(ctx.auth.getAccessToken()).rejects.toBeInstanceOf(SpotifyNotConnectedError);
		expect(ctx.tokenRequests()).toHaveLength(1);
		expect(ctx.openUrl).not.toHaveBeenCalled();
		expectNoLeaks(ctx);
	});

	it("handles a six-month-old session whose refresh token Spotify no longer accepts", async () => {
		const ctx = setup({
			store: new MemoryTokenStore(storedSession({ authorizedAt: Date.UTC(2025, 5, 1), accessTokenExpiresAt: 0 })),
			spotify: (req) => (req.url.pathname === "/api/token" ? json(400, { error: "invalid_grant", error_description: "Refresh token expired" }) : defaultSpotify(req)),
		});
		await ctx.auth.initialize(FAKE.clientId);

		expect(ctx.logger.lines.join("\n")).toMatch(/about six months old/);
		expect(ctx.state.snapshot.status).toBe("disconnected");
		await expect(ctx.store.load()).resolves.toBeUndefined();
	});

	it("keeps the session and publishes Error when Spotify cannot be reached", async () => {
		const session = storedSession();
		let online = false;
		const ctx = setup({
			store: new MemoryTokenStore(session),
			spotify: (req) => (online ? defaultSpotify(req) : Promise.reject(new TypeError("fetch failed"))),
		});
		await ctx.auth.initialize(FAKE.clientId);

		expect(ctx.state.snapshot.status).toBe("error");
		expect(ctx.state.snapshot.message).toMatch(/Could not reach Spotify/);
		await expect(ctx.store.load()).resolves.toEqual(session);

		online = true;
		await ctx.auth.verify();
		expect(ctx.state.snapshot.status).toBe("connected");
	});

	it("keeps the session and reports rate limiting (429)", async () => {
		const ctx = setup({
			store: new MemoryTokenStore(storedSession()),
			spotify: (req) => (req.url.pathname === "/v1/me" ? json(429, { error: { status: 429, message: "rate limited" } }, { "Retry-After": "30" }) : defaultSpotify(req)),
		});
		await ctx.auth.initialize(FAKE.clientId);

		expect(ctx.state.snapshot.status).toBe("error");
		expect(ctx.state.snapshot.message).toMatch(/30 seconds/);
		expect(ctx.auth.hasSession).toBe(true);
	});

	it("refreshes once on HTTP 401 and recovers", async () => {
		const ctx = setup({
			store: new MemoryTokenStore(storedSession()),
			spotify: (req) =>
				req.url.pathname === "/v1/me" && req.headers.get("authorization") === `Bearer ${FAKE.accessToken}`
					? json(401, { error: { status: 401, message: "The access token expired" } })
					: defaultSpotify(req),
		});
		await ctx.auth.initialize(FAKE.clientId);

		expect(ctx.tokenRequests()).toHaveLength(1);
		expect(ctx.state.snapshot.status).toBe("connected");
	});

	it("clears the session when Spotify keeps answering 401 after a refresh", async () => {
		const ctx = setup({
			store: new MemoryTokenStore(storedSession()),
			spotify: (req) => (req.url.pathname === "/v1/me" ? json(401, { error: { status: 401, message: "Invalid access token" } }) : defaultSpotify(req)),
		});
		await ctx.auth.initialize(FAKE.clientId);

		expect(ctx.tokenRequests()).toHaveLength(1);
		expect(ctx.state.snapshot.status).toBe("disconnected");
		await expect(ctx.store.load()).resolves.toBeUndefined();
	});

	it("discards a stored session issued to another Client ID", async () => {
		const ctx = setup({ store: new MemoryTokenStore(storedSession({ clientId: FAKE.otherClientId })) });
		await ctx.auth.initialize(FAKE.clientId);

		expect(ctx.requests).toHaveLength(0);
		expect(ctx.state.snapshot.status).toBe("disconnected");
		await expect(ctx.store.load()).resolves.toBeUndefined();
	});

	it("removes an unreadable stored session", async () => {
		const store = new MemoryTokenStore(storedSession());
		vi.spyOn(store, "load").mockRejectedValue(new TokenStoreError("The stored Spotify session could not be decrypted."));
		const ctx = setup({ store });
		await ctx.auth.initialize(FAKE.clientId);

		expect(ctx.state.snapshot.status).toBe("disconnected");
		expect(ctx.state.snapshot.message).toMatch(/could not be read/);
		await expect(store.load.bind(store)).rejects.toThrow();
		vi.mocked(store.load).mockRestore();
		await expect(store.load()).resolves.toBeUndefined();
	});

	it("publishes Not Configured without touching storage when no Client ID is set", async () => {
		const store = new MemoryTokenStore(storedSession());
		const load = vi.spyOn(store, "load");
		const ctx = setup({ store });
		await ctx.auth.initialize(undefined);

		expect(ctx.state.snapshot.status).toBe("not-configured");
		expect(load).not.toHaveBeenCalled();
		expect(ctx.requests).toHaveLength(0);
	});
});

describe("token refresh", () => {
	it("stores a replacement refresh token when Spotify rotates it", async () => {
		const ctx = setup({
			store: new MemoryTokenStore(storedSession({ accessTokenExpiresAt: 0 })),
			spotify: (req) => (req.url.pathname === "/api/token" ? tokenResponse(FAKE.accessToken2, FAKE.refreshToken2) : defaultSpotify(req)),
		});
		await ctx.auth.initialize(FAKE.clientId);

		const stored = (await ctx.store.load()) as StoredSpotifySession;
		expect(stored.refreshToken).toBe(FAKE.refreshToken2);
		expect(stored.accessToken).toBe(FAKE.accessToken2);
		expect(ctx.logger.lines.join("\n")).toContain("refresh token rotated: yes");

		// The next refresh uses the replacement.
		ctx.clock.advance(2 * HOUR);
		await ctx.auth.getAccessToken();
		expect(ctx.tokenRequests()[1]?.form.get("refresh_token")).toBe(FAKE.refreshToken2);
		expectNoLeaks(ctx);
	});

	it("retains the existing refresh token when Spotify omits a replacement", async () => {
		const ctx = setup({ store: new MemoryTokenStore(storedSession({ accessTokenExpiresAt: 0 })) });
		await ctx.auth.initialize(FAKE.clientId);

		ctx.clock.advance(2 * HOUR);
		await ctx.auth.getAccessToken();
		expect(ctx.tokenRequests().map((r) => r.form.get("refresh_token"))).toEqual([FAKE.refreshToken, FAKE.refreshToken]);
		expect(((await ctx.store.load()) as StoredSpotifySession).refreshToken).toBe(FAKE.refreshToken);
	});

	it("deduplicates concurrent refreshes into a single request", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const ctx = setup({
			store: new MemoryTokenStore(storedSession()),
			spotify: async (req) => {
				if (req.url.pathname === "/api/token") {
					await gate;
				}
				return defaultSpotify(req);
			},
		});
		await ctx.auth.initialize(FAKE.clientId);
		ctx.clock.advance(2 * HOUR);

		const results = Promise.all([ctx.auth.getAccessToken(), ctx.auth.getAccessToken(), ctx.auth.refreshAccessToken(), ctx.auth.getAccessToken()]);
		release();

		await expect(results).resolves.toEqual([FAKE.accessToken2, FAKE.accessToken2, FAKE.accessToken2, FAKE.accessToken2]);
		expect(ctx.tokenRequests()).toHaveLength(1);

		// After completion, a later refresh starts a new request.
		await ctx.auth.refreshAccessToken();
		expect(ctx.tokenRequests()).toHaveLength(2);
	});

	it("clears the session on invalid_grant during a later refresh and never retries", async () => {
		let revoked = false;
		const ctx = setup({
			store: new MemoryTokenStore(storedSession()),
			spotify: (req) => (req.url.pathname === "/api/token" && revoked ? json(400, { error: "invalid_grant" }) : defaultSpotify(req)),
		});
		await ctx.auth.initialize(FAKE.clientId);
		expect(ctx.state.snapshot.status).toBe("connected");

		revoked = true;
		ctx.clock.advance(2 * HOUR);
		await Promise.all([
			expect(ctx.auth.getAccessToken()).rejects.toBeInstanceOf(SpotifyReauthorizationRequiredError),
			expect(ctx.auth.getAccessToken()).rejects.toBeInstanceOf(SpotifyReauthorizationRequiredError),
		]);

		expect(ctx.tokenRequests()).toHaveLength(1);
		expect(ctx.state.snapshot.status).toBe("disconnected");
		await expect(ctx.store.load()).resolves.toBeUndefined();
		await expect(ctx.auth.getAccessToken()).rejects.toBeInstanceOf(SpotifyNotConnectedError);
		expect(ctx.tokenRequests()).toHaveLength(1);
	});

	it("keeps the session when a refresh fails for a transient reason", async () => {
		let down = false;
		const ctx = setup({
			store: new MemoryTokenStore(storedSession()),
			spotify: (req) => (req.url.pathname === "/api/token" && down ? new Response("unavailable", { status: 503 }) : defaultSpotify(req)),
		});
		await ctx.auth.initialize(FAKE.clientId);
		down = true;
		ctx.clock.advance(2 * HOUR);

		await expect(ctx.auth.getAccessToken()).rejects.toMatchObject({ status: 503 });
		expect(ctx.auth.hasSession).toBe(true);
		await expect(ctx.store.load()).resolves.toBeDefined();
	});
});

describe("disconnect", () => {
	it("clears storage, memory and profile, keeps the Client ID and notifies subscribers", async () => {
		const ctx = setup({ store: new MemoryTokenStore(storedSession()) });
		await ctx.auth.initialize(FAKE.clientId);
		const listener = vi.fn();
		ctx.state.subscribe(listener);

		await ctx.auth.disconnect();

		expect(listener).toHaveBeenCalledTimes(1);
		expect(ctx.state.snapshot).toEqual({ status: "disconnected", clientId: FAKE.clientId, profile: undefined, authorizedAt: undefined, message: undefined });
		expect(ctx.auth.hasSession).toBe(false);
		await expect(ctx.store.load()).resolves.toBeUndefined();
		await expect(ctx.auth.getAccessToken()).rejects.toBeInstanceOf(SpotifyNotConnectedError);
	});

	it("cancels a sign-in in progress; a late callback cannot complete it", async () => {
		let browser!: ReturnType<typeof fakeListener>;
		const ctx = setup({ onBrowserOpen: (_url, l) => (browser = l) });
		await ctx.auth.initialize(FAKE.clientId);

		const connecting = ctx.auth.connect();
		await vi.waitFor(() => expect(ctx.openUrl).toHaveBeenCalled());
		expect(ctx.state.snapshot.status).toBe("connecting");

		await ctx.auth.disconnect();
		browser.respond({ code: FAKE.code });
		await connecting;

		expect(ctx.listener.close).toHaveBeenCalled();
		expect(ctx.state.snapshot.status).toBe("disconnected");
		expect(ctx.tokenRequests()).toHaveLength(0);
		await expect(ctx.store.load()).resolves.toBeUndefined();
	});

	it("does not resurrect the session when a refresh completes after disconnect", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const ctx = setup({
			store: new MemoryTokenStore(storedSession()),
			spotify: async (req) => {
				if (req.url.pathname === "/api/token") {
					await gate;
				}
				return defaultSpotify(req);
			},
		});
		await ctx.auth.initialize(FAKE.clientId);
		ctx.clock.advance(2 * HOUR);

		const refresh = ctx.auth.getAccessToken();
		await ctx.auth.disconnect();
		release();

		await expect(refresh).rejects.toBeInstanceOf(SpotifyNotConnectedError);
		expect(ctx.auth.hasSession).toBe(false);
		await expect(ctx.store.load()).resolves.toBeUndefined();
	});
});

describe("Client ID changes", () => {
	it("discards the session when the Client ID changes", async () => {
		const ctx = setup({ store: new MemoryTokenStore(storedSession()) });
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.setClientId(FAKE.otherClientId);

		expect(ctx.state.snapshot).toMatchObject({ status: "disconnected", clientId: FAKE.otherClientId });
		await expect(ctx.store.load()).resolves.toBeUndefined();
	});

	it("publishes Not Configured when the Client ID is removed", async () => {
		const ctx = setup({ store: new MemoryTokenStore(storedSession()) });
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.setClientId(undefined);

		expect(ctx.state.snapshot).toMatchObject({ status: "not-configured", clientId: undefined });
		expect(ctx.auth.hasSession).toBe(false);
	});

	it("ignores setting the same Client ID", async () => {
		const ctx = setup({ store: new MemoryTokenStore(storedSession()) });
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.setClientId(FAKE.clientId);
		expect(ctx.state.snapshot.status).toBe("connected");
	});
});
