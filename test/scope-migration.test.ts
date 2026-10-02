import { describe, expect, it, vi } from "vitest";

import { SCOPE_UPGRADE_MESSAGE, SpotifyAuthService } from "../src/spotify/auth/auth-service";
import type { AuthorizationCallback, CallbackListener, CallbackListenerOptions } from "../src/spotify/auth/callback-server";
import { createCodeChallenge } from "../src/spotify/auth/pkce";
import { getMissingScopes, SPOTIFY_SCOPES } from "../src/spotify/auth/scopes";
import { AuthorizationDeniedError } from "../src/spotify/errors";
import { SpotifyAuthState, type SpotifyAuthSnapshot } from "../src/spotify/state/auth-state";
import { MemoryTokenStore, type StoredSpotifySession } from "../src/spotify/storage/token-store";
import { FAKE, fakeClock, fakeFetch, json, PHASE2_SCOPES, profileResponse, storedSession, type RecordedRequest } from "./helpers";

const NEW_ACCESS = "fake-access-token-reauthorized";
const NEW_REFRESH = "fake-refresh-token-reauthorized";

/**
 * Auth service whose browser "approves" with the given outcome and whose token endpoint grants `grantedScopes`.
 */
function setup(options: { stored?: StoredSpotifySession; grantedScopes?: readonly string[]; outcome?: AuthorizationCallback | Error } = {}) {
	const store = new MemoryTokenStore(options.stored);
	const state = new SpotifyAuthState();
	const history: SpotifyAuthSnapshot[] = [];
	state.subscribe((s) => history.push(s));
	const granted = options.grantedScopes ?? SPOTIFY_SCOPES;
	const { fetch, requests } = fakeFetch((req: RecordedRequest) => {
		if (req.url.pathname === "/api/token") {
			return req.form.get("grant_type") === "authorization_code"
				? json(200, { access_token: NEW_ACCESS, token_type: "Bearer", expires_in: 3600, refresh_token: NEW_REFRESH, scope: granted.join(" ") })
				: json(200, { access_token: FAKE.accessToken2, token_type: "Bearer", expires_in: 3600, scope: PHASE2_SCOPES.join(" ") });
		}
		return profileResponse();
	});

	let settle: ((value: AuthorizationCallback | Error) => void) | undefined;
	const startCallbackListener = vi.fn((_o: CallbackListenerOptions): Promise<CallbackListener> => {
		const result = new Promise<AuthorizationCallback>((resolve, reject) => {
			settle = (v) => (v instanceof Error ? reject(v) : resolve(v));
		});
		result.catch(() => undefined);
		return Promise.resolve({ result, close: () => settle?.(new Error("closed")) });
	});
	const openUrl = vi.fn((url: string) => {
		opened.push(new URL(url));
		settle?.(options.outcome ?? { code: FAKE.code });
		return Promise.resolve();
	});
	const opened: URL[] = [];

	const auth = new SpotifyAuthService({
		state,
		tokenStore: store,
		openUrl,
		http: { fetch },
		clock: fakeClock().now,
		startCallbackListener,
		createPkceAttempt: () => ({ codeVerifier: "v", codeChallenge: createCodeChallenge("v"), state: "s" }),
	});
	return { auth, state, history, store, requests, opened, openUrl };
}

describe("getMissingScopes", () => {
	it("reports the playback scopes missing from a Phase 2 session", () => {
		expect(getMissingScopes(PHASE2_SCOPES)).toEqual(["user-read-playback-state", "user-modify-playback-state"]);
	});

	it("reports nothing for a current session, regardless of order or extra scopes", () => {
		expect(getMissingScopes([...SPOTIFY_SCOPES].reverse())).toEqual([]);
		expect(getMissingScopes([...SPOTIFY_SCOPES, "some-other-scope"])).toEqual([]);
	});
});

describe("scope migration from Phase 2", () => {
	it("marks a stored Phase 2 session as needing reauthorization without using it or deleting anything", async () => {
		const stored = storedSession({ scopes: [...PHASE2_SCOPES] });
		const ctx = setup({ stored });
		await ctx.auth.initialize(FAKE.clientId);

		expect(ctx.state.snapshot).toMatchObject({ status: "reauthorization-required", clientId: FAKE.clientId, message: SCOPE_UPGRADE_MESSAGE });
		expect(ctx.history.map((s) => s.status)).toEqual(["reauthorization-required"]);
		// No API calls with the old session, no browser, and nothing deleted.
		expect(ctx.requests).toHaveLength(0);
		expect(ctx.openUrl).not.toHaveBeenCalled();
		await expect(ctx.store.load()).resolves.toEqual(stored);
	});

	it("stays in reauthorization-required when verified again (no endless calls)", async () => {
		const ctx = setup({ stored: storedSession({ scopes: [...PHASE2_SCOPES] }) });
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.verify();
		await ctx.auth.verify();

		expect(ctx.state.snapshot.status).toBe("reauthorization-required");
		expect(ctx.requests).toHaveLength(0);
	});

	it("replaces the old session with the newly authorized one after Reconnect", async () => {
		const ctx = setup({ stored: storedSession({ scopes: [...PHASE2_SCOPES] }) });
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.connect();

		expect(ctx.opened[0]?.searchParams.get("scope")).toBe("user-read-private user-read-playback-state user-modify-playback-state");
		expect(ctx.state.snapshot.status).toBe("connected");
		await expect(ctx.store.load()).resolves.toMatchObject({ accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH, scopes: [...SPOTIFY_SCOPES] });
	});

	it("keeps the old session and the reauthorization prompt when Reconnect is denied", async () => {
		const stored = storedSession({ scopes: [...PHASE2_SCOPES] });
		const ctx = setup({ stored, outcome: new AuthorizationDeniedError() });
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.connect();

		expect(ctx.state.snapshot.status).toBe("reauthorization-required");
		expect(ctx.state.snapshot.message).toContain("Reconnect Spotify");
		await expect(ctx.store.load()).resolves.toEqual(stored);
	});

	it("refuses a new authorization that lacks required scopes", async () => {
		const ctx = setup({ grantedScopes: PHASE2_SCOPES });
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.connect();

		expect(ctx.state.snapshot.status).toBe("error");
		expect(ctx.state.snapshot.message).toMatch(/missing: user-read-playback-state, user-modify-playback-state/);
		await expect(ctx.store.load()).resolves.toBeUndefined();
	});

	it("never tries to obtain new scopes through a refresh-token exchange", async () => {
		const ctx = setup({ stored: storedSession({ scopes: [...PHASE2_SCOPES], accessTokenExpiresAt: 0 }) });
		await ctx.auth.initialize(FAKE.clientId);

		expect(ctx.requests.filter((r) => r.url.pathname === "/api/token")).toHaveLength(0);
		for (const request of ctx.requests) {
			expect(request.form.has("scope")).toBe(false);
		}
	});

	it("connects normally when the stored session already has the Phase 3 scopes", async () => {
		const ctx = setup({ stored: storedSession({ scopes: [...SPOTIFY_SCOPES] }) });
		await ctx.auth.initialize(FAKE.clientId);

		expect(ctx.state.snapshot.status).toBe("connected");
		expect(ctx.openUrl).not.toHaveBeenCalled();
	});

	it("requires reauthorization when a refresh reports fewer scopes than required", async () => {
		const ctx = setup({ stored: storedSession({ scopes: [...SPOTIFY_SCOPES] }) });
		await ctx.auth.initialize(FAKE.clientId);
		expect(ctx.state.snapshot.status).toBe("connected");

		// The fake refresh answers with only the Phase 2 scope.
		await ctx.auth.refreshAccessToken();
		expect(ctx.state.snapshot.status).toBe("reauthorization-required");
	});

	it("Disconnect clears a session that needed reauthorization and keeps the Client ID", async () => {
		const ctx = setup({ stored: storedSession({ scopes: [...PHASE2_SCOPES] }) });
		await ctx.auth.initialize(FAKE.clientId);
		await ctx.auth.disconnect();

		expect(ctx.state.snapshot).toMatchObject({ status: "disconnected", clientId: FAKE.clientId });
		await expect(ctx.store.load()).resolves.toBeUndefined();
	});
});
