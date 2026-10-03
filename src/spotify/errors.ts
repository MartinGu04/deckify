import { SPOTIFY_REDIRECT_HOST, SPOTIFY_REDIRECT_PORT } from "./config";

/**
 * Base class for Deckify's Spotify errors.
 *
 * Messages are written to be shown to the user (key alert, Property Inspector) and logged. They never contain tokens, authorization codes or
 * PKCE verifiers.
 */
export class SpotifyError extends Error {
	/**
	 * Initializes a new instance of the {@link SpotifyError} class.
	 * @param code Stable machine-readable code.
	 * @param message User-facing message.
	 * @param options Error options, e.g. the underlying cause.
	 */
	constructor(
		readonly code: string,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = new.target.name;
	}
}

/** The local callback listener could not bind because port 43821 is already in use. */
export class CallbackPortInUseError extends SpotifyError {
	constructor(options?: ErrorOptions) {
		super(
			"callback-port-in-use",
			`Deckify could not start its local Spotify callback listener because port ${SPOTIFY_REDIRECT_PORT} on ${SPOTIFY_REDIRECT_HOST} is already in use. ` +
				`Close the application using port ${SPOTIFY_REDIRECT_PORT} (or finish a previous Deckify sign-in), then try again.`,
			options,
		);
	}
}

/** The local callback listener could not start for a reason other than the port being in use. */
export class CallbackListenerError extends SpotifyError {
	constructor(reason: string, options?: ErrorOptions) {
		super(
			"callback-listener-failed",
			`Deckify could not start its local Spotify callback listener on ${SPOTIFY_REDIRECT_HOST}:${SPOTIFY_REDIRECT_PORT} (${reason}).`,
			options,
		);
	}
}

/** The user declined the authorization request in Spotify. */
export class AuthorizationDeniedError extends SpotifyError {
	constructor() {
		super("authorization-denied", "Spotify access was not granted. Press Connect Spotify to try again.");
	}
}

/** Spotify redirected back with an error other than a denial. */
export class AuthorizationCallbackError extends SpotifyError {
	constructor(
		readonly oauthError: string,
		message?: string,
	) {
		super("authorization-failed", message ?? `Spotify authorization failed (${oauthError}).`);
	}
}

/** The callback's `state` did not match the authorization request; the response is not trusted. */
export class AuthorizationStateMismatchError extends SpotifyError {
	constructor() {
		super("state-mismatch", "Spotify sign-in was rejected because the response did not match the request (state mismatch). Please try again.");
	}
}

/** The user did not complete the Spotify sign-in in time. */
export class AuthorizationTimeoutError extends SpotifyError {
	constructor() {
		super("authorization-timeout", "Spotify sign-in timed out. Press Connect Spotify to try again.");
	}
}

/** The sign-in attempt was cancelled, e.g. by Disconnect or by a newer attempt. */
export class AuthorizationCancelledError extends SpotifyError {
	constructor() {
		super("authorization-cancelled", "Spotify sign-in was cancelled.");
	}
}

/** Spotify's accounts service rejected a token request (RFC 6749 error response). */
export class SpotifyOAuthError extends SpotifyError {
	constructor(
		readonly status: number,
		readonly oauthError: string,
		readonly description: string | undefined,
	) {
		super("oauth-error", `Spotify rejected the token request (${oauthError}${description ? `: ${description}` : ""}).`);
	}

	/**
	 * Whether the grant (authorization code or refresh token) is invalid, expired or revoked.
	 * @returns `true` when re-authorization is required.
	 */
	get isInvalidGrant(): boolean {
		return this.oauthError === "invalid_grant";
	}
}

/** The stored Spotify session can no longer be used; the user must connect again. */
export class SpotifyReauthorizationRequiredError extends SpotifyError {
	constructor(options?: ErrorOptions) {
		super("reauthorization-required", "Your Spotify session has expired or was revoked. Press Connect Spotify to sign in again.", options);
	}
}

/** Spotify granted fewer scopes than Deckify requested. */
export class SpotifyInsufficientScopeError extends SpotifyError {
	constructor(readonly missingScopes: readonly string[]) {
		super("insufficient-scope", `Spotify did not grant all permissions Deckify needs (missing: ${missingScopes.join(", ")}).`);
	}
}

/** There is no Spotify session. */
export class SpotifyNotConnectedError extends SpotifyError {
	constructor() {
		super("not-connected", "Deckify is not connected to Spotify.");
	}
}

/** The Spotify Client ID is missing or malformed. */
export class SpotifyClientIdError extends SpotifyError {
	constructor(message: string) {
		super("client-id", message);
	}
}

/** Spotify could not be reached. */
export class SpotifyNetworkError extends SpotifyError {
	constructor(options?: ErrorOptions) {
		super("network", "Could not reach Spotify. Check your internet connection and try again.", options);
	}
}

/** A request to Spotify did not complete in time. */
export class SpotifyTimeoutError extends SpotifyError {
	constructor() {
		super("timeout", "Spotify did not respond in time. Try again.");
	}
}

/** Spotify answered with a payload Deckify does not understand. */
export class SpotifyInvalidResponseError extends SpotifyError {
	constructor(detail: string) {
		super("invalid-response", `Spotify returned an unexpected response (${detail}).`);
	}
}

/** A Spotify Web API request failed. */
export class SpotifyApiError extends SpotifyError {
	constructor(
		readonly status: number,
		readonly apiMessage: string | undefined,
		message?: string,
		code = "api-error",
		/** Spotify's machine-readable `reason` (e.g. player error reasons such as `NO_ACTIVE_DEVICE`), when present. */
		readonly reason?: string,
	) {
		super(code, message ?? `Spotify request failed with HTTP ${status}${apiMessage ? `: ${apiMessage}` : ""}.`);
	}
}

/** HTTP 401: the access token was rejected. */
export class SpotifyUnauthorizedError extends SpotifyApiError {
	constructor(apiMessage: string | undefined) {
		super(401, apiMessage, "Spotify rejected Deckify's access token. Press Connect Spotify to sign in again.", "unauthorized");
	}
}

/** HTTP 403: the account or app is not allowed to perform the request. */
export class SpotifyForbiddenError extends SpotifyApiError {
	constructor(apiMessage: string | undefined) {
		super(
			403,
			apiMessage,
			"Spotify refused access (HTTP 403). While the Spotify app is in Development Mode, the Spotify account must be added under " +
				"User Management in the Spotify Developer Dashboard.",
			"forbidden",
		);
	}
}

/** HTTP 429: Spotify's rate limit was exceeded. */
export class SpotifyRateLimitError extends SpotifyApiError {
	constructor(
		apiMessage: string | undefined,
		readonly retryAfterSeconds: number | undefined,
	) {
		super(
			429,
			apiMessage,
			`Spotify is rate limiting requests. Try again${retryAfterSeconds === undefined ? " shortly" : ` in ${retryAfterSeconds} seconds`}.`,
			"rate-limited",
		);
	}
}

/**
 * HTTP 429 with `reason: "QUOTA_EXCEEDED"`: the app's Development Mode request quota is used up. Unlike a short rate limit, retrying soon
 * does not help, so Deckify stops polling until the quota window has passed.
 */
export class SpotifyQuotaExceededError extends SpotifyRateLimitError {
	override readonly code = "quota-exceeded";
	override readonly message: string =
		"Spotify's request quota for this app is used up, so Deckify has paused live playback updates. They resume automatically later.";
}

/** No Spotify device is currently active (player reason `NO_ACTIVE_DEVICE`). */
export class SpotifyNoActiveDeviceError extends SpotifyApiError {
	constructor(status = 404, apiMessage?: string) {
		super(
			status,
			apiMessage,
			"No active Spotify device. Open Spotify and start playing on a device, then try again.",
			"no-active-device",
			"NO_ACTIVE_DEVICE",
		);
	}
}

/** Playback control requires Spotify Premium (player reason `PREMIUM_REQUIRED`). */
export class SpotifyPremiumRequiredError extends SpotifyApiError {
	constructor(status = 403, apiMessage?: string) {
		super(status, apiMessage, "Playback control requires Spotify Premium.", "premium-required", "PREMIUM_REQUIRED");
	}
}

/** The active device cannot be controlled through the Web API (`is_restricted`, or reasons such as `DEVICE_NOT_CONTROLLABLE`). */
export class SpotifyDeviceRestrictedError extends SpotifyApiError {
	constructor(status = 403, apiMessage?: string, reason?: string) {
		super(
			status,
			apiMessage,
			"The active Spotify device does not allow remote control. Use another device or control playback in Spotify.",
			"device-restricted",
			reason,
		);
	}
}

/** The active device's Spotify volume cannot be changed through the Web API (`supports_volume: false`, or no volume reported). */
export class SpotifyVolumeUnsupportedError extends SpotifyError {
	constructor(message = "The active Spotify device does not allow volume control from Deckify.") {
		super("volume-unsupported", message);
	}
}

/** Spotify refused a player command for another documented reason (e.g. `NO_NEXT_TRACK`, `ALREADY_PAUSED`). */
export class SpotifyPlayerCommandError extends SpotifyApiError {
	constructor(status: number, apiMessage: string | undefined, reason: string) {
		super(status, apiMessage, `Spotify could not perform that playback command (${reason}).`, "player-command-failed", reason);
	}
}

/** Token storage failed (e.g. DPAPI or file system errors). */
export class TokenStoreError extends SpotifyError {
	constructor(message: string, options?: ErrorOptions) {
		super("token-store", message, options);
	}
}

/**
 * Gets a user-facing message for any thrown value.
 * @param err The error.
 * @returns Message safe to show and log.
 */
export function describeError(err: unknown): string {
	if (err instanceof SpotifyError) {
		return err.message;
	}
	return "An unexpected error occurred. Check the Deckify log for details.";
}
