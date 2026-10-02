import type { FetchFn } from "../src/spotify/http";
import type { Logger } from "../src/shared/logger";
import { SPOTIFY_SCOPES } from "../src/spotify/auth/scopes";
import type { StoredSpotifySession } from "../src/spotify/storage/token-store";

/** The scope set Phase 2 sessions were authorized with (before playback scopes were added). */
export const PHASE2_SCOPES = ["user-read-private"] as const;

/** The scope set Deckify currently requires. */
export const CURRENT_SCOPES: readonly string[] = SPOTIFY_SCOPES;

/**
 * Obviously fake credentials. Nothing in the test suite is a real Spotify credential, and no test ever contacts Spotify.
 */
export const FAKE = {
	clientId: "0123456789abcdef0123456789abcdef",
	otherClientId: "fedcba9876543210fedcba9876543210",
	code: "fake-authorization-code",
	accessToken: "fake-access-token-1",
	accessToken2: "fake-access-token-2",
	refreshToken: "fake-refresh-token-1",
	refreshToken2: "fake-refresh-token-2",
} as const;

/** All fake secret values, for asserting they never appear in logs or state. */
export const FAKE_SECRETS = [FAKE.code, FAKE.accessToken, FAKE.accessToken2, FAKE.refreshToken, FAKE.refreshToken2];

/**
 * A recorded HTTP request.
 */
export type RecordedRequest = {
	readonly url: URL;
	readonly method: string;
	readonly headers: Headers;
	readonly body: string;
	readonly form: URLSearchParams;
};

/**
 * Creates a fake `fetch` that dispatches to `handler` and records every request. Any request the handler does not answer fails the test.
 * @param handler Request handler.
 * @returns The fake fetch and recorded requests.
 */
export function fakeFetch(handler: (req: RecordedRequest) => Response | Promise<Response>): { fetch: FetchFn; requests: RecordedRequest[] } {
	const requests: RecordedRequest[] = [];
	const fetch: FetchFn = async (input, init) => {
		const body = typeof init.body === "string" ? init.body : "";
		const req: RecordedRequest = {
			url: new URL(input),
			method: init.method ?? "GET",
			headers: new Headers(init.headers),
			body,
			form: new URLSearchParams(body),
		};
		requests.push(req);
		return handler(req);
	};
	return { fetch, requests };
}

/**
 * Creates a JSON response.
 * @param status HTTP status.
 * @param body Body.
 * @param headers Extra headers.
 * @returns The response.
 */
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** A successful token response. */
export function tokenResponse(accessToken: string, refreshToken?: string, expiresIn = 3600): Response {
	return json(200, {
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: expiresIn,
		scope: SPOTIFY_SCOPES.join(" "),
		...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
	});
}

/** A `GET /v1/me` response. */
export function profileResponse(displayName: string | null = "Test Listener"): Response {
	return json(200, { id: "test-user", display_name: displayName, product: "premium", type: "user", uri: "spotify:user:test-user" });
}

/**
 * Logger that records every line so tests can assert secrets are never logged.
 * @returns The logger and its recorded lines.
 */
export function recordingLogger(): Logger & { lines: string[] } {
	const lines: string[] = [];
	const record =
		(level: string) =>
		(...data: unknown[]): void => {
			lines.push(`${level} ${data.map((d) => (d instanceof Error ? `${d.name}: ${d.message} ${String(d.cause)}` : String(d))).join(" ")}`);
		};
	return { lines, debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error") };
}

/**
 * A controllable clock.
 * @param start Initial time.
 * @returns The clock.
 */
export function fakeClock(start = Date.UTC(2026, 0, 1)): { now: () => number; advance: (ms: number) => void } {
	let current = start;
	return {
		now: () => current,
		advance: (ms) => {
			current += ms;
		},
	};
}

/**
 * Creates a stored session.
 * @param overrides Overrides.
 * @returns The session.
 */
export function storedSession(overrides: Partial<StoredSpotifySession> = {}): StoredSpotifySession {
	return {
		clientId: FAKE.clientId,
		accessToken: FAKE.accessToken,
		refreshToken: FAKE.refreshToken,
		accessTokenExpiresAt: Date.UTC(2026, 0, 1) + 60 * 60 * 1000,
		authorizedAt: Date.UTC(2025, 11, 1),
		scopes: [...SPOTIFY_SCOPES],
		...overrides,
	};
}

/**
 * Asserts none of the fake secrets occur in the text.
 * @param text Text to check.
 * @returns Secrets that were found.
 */
export function findSecrets(text: string): string[] {
	return FAKE_SECRETS.filter((secret) => text.includes(secret));
}
