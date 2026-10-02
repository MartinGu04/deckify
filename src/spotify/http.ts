import { HTTP_TIMEOUT_MS } from "./config";
import { SpotifyApiError, SpotifyForbiddenError, SpotifyNetworkError, SpotifyRateLimitError, SpotifyTimeoutError, SpotifyUnauthorizedError } from "./errors";

/**
 * The `fetch` signature Deckify depends on; injectable so tests never reach Spotify.
 */
export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/**
 * HTTP options shared by the Spotify clients.
 */
export type HttpOptions = {
	/** Defaults to the global (Node.js built-in) `fetch`. */
	readonly fetch?: FetchFn;

	/** Per-request timeout, including reading the body. */
	readonly timeoutMs?: number;
};

/**
 * A fully-read HTTP response.
 */
export type HttpResult = {
	readonly status: number;
	readonly ok: boolean;
	readonly headers: Headers;

	/** Parsed JSON body; `undefined` when empty or not JSON. */
	readonly body: unknown;
};

/**
 * Sends a request and reads the whole body within the timeout.
 *
 * Redirects are refused so credentials are never forwarded to another origin.
 * @param url Request URL.
 * @param init Request options.
 * @param options HTTP options.
 * @returns The response.
 */
export async function sendRequest(url: string, init: RequestInit, options: HttpOptions = {}): Promise<HttpResult> {
	const fetchFn = options.fetch ?? ((input: string, requestInit: RequestInit) => fetch(input, requestInit));
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, options.timeoutMs ?? HTTP_TIMEOUT_MS);

	try {
		const response = await fetchFn(url, { ...init, redirect: "error", signal: controller.signal });
		const text = await response.text();
		return { status: response.status, ok: response.ok, headers: response.headers, body: parseJson(text) };
	} catch (err) {
		if (controller.signal.aborted) {
			throw new SpotifyTimeoutError();
		}
		throw new SpotifyNetworkError({ cause: err });
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Parses JSON without throwing.
 * @param text Body text.
 * @returns The parsed value; otherwise `undefined`.
 */
function parseJson(text: string): unknown {
	if (text.length === 0) {
		return undefined;
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

/**
 * Determines whether a value is a plain object.
 * @param value Value to check.
 * @returns `true` for non-null, non-array objects.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the message from a Spotify Web API error payload: `{ "error": { "status": 401, "message": "..." } }`.
 * @param body Response body.
 * @returns The message, when present.
 */
export function readApiErrorMessage(body: unknown): string | undefined {
	if (!isRecord(body)) {
		return undefined;
	}
	const { error } = body;
	if (isRecord(error) && typeof error.message === "string") {
		return truncate(error.message);
	}
	if (typeof error === "string") {
		return truncate(typeof body.error_description === "string" ? `${error}: ${body.error_description}` : error);
	}
	return undefined;
}

/**
 * Parses the `Retry-After` header (seconds).
 * @param headers Response headers.
 * @returns Seconds to wait, when present and valid.
 */
export function readRetryAfterSeconds(headers: Headers): number | undefined {
	const value = headers.get("retry-after");
	if (value === null || !/^\d+$/.test(value.trim())) {
		return undefined;
	}
	return Number.parseInt(value.trim(), 10);
}

/**
 * Maps a failed Web API response to a typed error.
 * @param result The response.
 * @returns The error to throw.
 */
export function toApiError(result: HttpResult): SpotifyApiError {
	const message = readApiErrorMessage(result.body);
	switch (result.status) {
		case 401:
			return new SpotifyUnauthorizedError(message);
		case 403:
			return new SpotifyForbiddenError(message);
		case 429:
			return new SpotifyRateLimitError(message, readRetryAfterSeconds(result.headers));
		default:
			return new SpotifyApiError(result.status, message);
	}
}

/**
 * Keeps remote error text short in logs and UI.
 * @param value Text.
 * @returns Text of at most 200 characters.
 */
function truncate(value: string): string {
	return value.length > 200 ? `${value.slice(0, 197)}...` : value;
}
