import { randomBytes, timingSafeEqual } from "node:crypto";

/** How long the one-time launch code in the browser URL can be exchanged. */
export const LAUNCH_CODE_LIFETIME_MS = 2 * 60 * 1000;

/** A session ends when the Setup App has made no request for this long (an open page asks for updates at least every 25 seconds). */
export const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** No session lasts longer than this, however active. */
export const SESSION_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

/** Shape of a launch code or session token: 32 random bytes, base64url. */
export const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Creates a random secret (256 bits).
 * @returns The secret, base64url.
 */
export function createSecret(): string {
	return randomBytes(32).toString("base64url");
}

/**
 * Compares a candidate with a secret in constant time.
 * @param secret Expected value.
 * @param candidate Received value.
 * @returns `true` when they match.
 */
export function secretMatches(secret: string | undefined, candidate: unknown): boolean {
	if (secret === undefined || typeof candidate !== "string" || !SECRET_PATTERN.test(candidate)) {
		return false;
	}
	const a = Buffer.from(secret);
	const b = Buffer.from(candidate);
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * One Setup App session, kept in memory only and never logged.
 *
 * The browser is opened with a one-time **launch code** in the URL fragment (`#launch=…`). A fragment is never sent in an HTTP request, so the
 * code never reaches a request line or a log. The page exchanges it once for a **session token**, which it keeps in memory and sends in a
 * custom header with every API request. The launch code then stops working, so a copy left in the browser history is useless.
 */
export class SetupSession {
	readonly #createdAt: number;
	readonly #pendingToken: string;
	#launchCode: string | undefined;
	#token: string | undefined;
	#lastSeen: number;
	#ended = false;

	/**
	 * Initializes a new instance of the {@link SetupSession} class.
	 * @param entry Where the Setup App starts.
	 * @param now Current time (Unix epoch, milliseconds).
	 * @param secret Creates secrets; replaced in tests.
	 * @param originDeviceId The Stream Deck whose Spotify Account key opened setup. Kept plugin-side only: it is never sent to the page, and the
	 * page cannot choose another device.
	 */
	constructor(
		readonly entry: "start" | "account",
		now: number,
		secret: () => string = createSecret,
		readonly originDeviceId?: string,
	) {
		this.#createdAt = now;
		this.#lastSeen = now;
		this.#launchCode = secret();
		this.#pendingToken = secret();
	}

	/**
	 * The launch code to put in the browser URL; `undefined` once exchanged.
	 * @returns The code.
	 */
	get launchCode(): string | undefined {
		return this.#launchCode;
	}

	/**
	 * Whether the session has ended (finished, replaced, idle or too old).
	 * @param now Current time.
	 * @returns `true` when it can no longer be used.
	 */
	isExpired(now: number): boolean {
		if (this.#ended) {
			return true;
		}
		if (now - this.#createdAt > SESSION_MAX_LIFETIME_MS) {
			return true;
		}
		if (this.#token === undefined) {
			return now - this.#createdAt > LAUNCH_CODE_LIFETIME_MS;
		}
		return now - this.#lastSeen > SESSION_IDLE_TIMEOUT_MS;
	}

	/**
	 * Exchanges the launch code for the session token. Works once.
	 * @param candidate Launch code from the page.
	 * @param now Current time.
	 * @returns The session token; otherwise `undefined`.
	 */
	exchange(candidate: unknown, now: number): string | undefined {
		if (this.isExpired(now) || !secretMatches(this.#launchCode, candidate)) {
			return undefined;
		}
		this.#launchCode = undefined;
		this.#token = this.#pendingToken;
		this.#lastSeen = now;
		return this.#token;
	}

	/**
	 * Checks a session token and records the activity.
	 * @param candidate Token from the request header.
	 * @param now Current time.
	 * @returns `true` when the request belongs to this live session.
	 */
	authorize(candidate: unknown, now: number): boolean {
		if (this.isExpired(now) || !secretMatches(this.#token, candidate)) {
			return false;
		}
		this.#lastSeen = now;
		return true;
	}

	/** Ends the session; its launch code and token stop working. */
	end(): void {
		this.#ended = true;
		this.#launchCode = undefined;
		this.#token = undefined;
	}
}
