import {
	AuthorizationCallbackError,
	AuthorizationCancelledError,
	AuthorizationDeniedError,
	AuthorizationStateMismatchError,
	AuthorizationTimeoutError,
	CallbackPortInUseError,
	SpotifyApiError,
	SpotifyClientIdError,
	SpotifyForbiddenError,
	SpotifyInsufficientScopeError,
	SpotifyNetworkError,
	SpotifyOAuthError,
	SpotifyPremiumRequiredError,
	SpotifyRateLimitError,
	SpotifyReauthorizationRequiredError,
	SpotifyTimeoutError,
	SpotifyUnauthorizedError,
	TokenStoreError,
} from "./errors";

/**
 * Machine-readable reason behind the current Spotify account state, published next to the user-facing message so the Spotify Account
 * Property Inspector can show the right guidance without parsing English. Contains nothing sensitive.
 */
export type SpotifyAccountIssue =
	/** The Client ID is malformed. */
	| "invalid-client-id"
	/** Connect was requested before a Client ID was saved. */
	| "client-id-missing"
	/** The user declined Deckify's request on Spotify's authorization page. */
	| "authorization-denied"
	/** The sign-in was cancelled in Deckify before it finished. */
	| "authorization-cancelled"
	/** Spotify never redirected back to Deckify within the sign-in window. */
	| "authorization-timeout"
	/** Spotify redirected back with an error, a mismatched `state`, or rejected the token exchange. */
	| "authorization-failed"
	/** Deckify could not listen for Spotify's redirect because the port is taken. */
	| "callback-port-in-use"
	/** Spotify answered 403 for this account (e.g. a Development Mode allowlist). Not a confirmed diagnosis. */
	| "spotify-access-refused"
	/** Spotify reported that the request requires Premium. */
	| "premium-required"
	/** Spotify granted fewer permissions than Deckify asked for. */
	| "insufficient-scope"
	/** The stored session lacks permissions Deckify now needs; only a new authorization can add them. */
	| "reauthorization-required"
	/** The session expired or was revoked. */
	| "session-expired"
	/** The stored session could not be read and was removed. */
	| "session-unreadable"
	/** The stored session belonged to another Client ID and was removed. */
	| "client-id-changed"
	/** Connected, but the session could not be saved securely. */
	| "session-not-saved"
	/** Disconnected, but the stored session could not be deleted. */
	| "session-not-deleted"
	/** Spotify could not be reached, or did not answer in time. */
	| "network"
	/** Spotify is rate limiting Deckify. */
	| "rate-limited"
	/** Spotify answered with a server error. */
	| "spotify-unavailable"
	/** Anything else. */
	| "unknown";

/**
 * Classifies an error by its type (never by its message).
 * @param err The error.
 * @returns The issue code.
 */
export function issueForError(err: unknown): SpotifyAccountIssue {
	if (err instanceof AuthorizationDeniedError) {
		return "authorization-denied";
	}
	if (err instanceof AuthorizationCancelledError) {
		return "authorization-cancelled";
	}
	if (err instanceof AuthorizationTimeoutError) {
		return "authorization-timeout";
	}
	if (err instanceof AuthorizationCallbackError || err instanceof AuthorizationStateMismatchError || err instanceof SpotifyOAuthError) {
		return "authorization-failed";
	}
	if (err instanceof CallbackPortInUseError) {
		return "callback-port-in-use";
	}
	if (err instanceof SpotifyClientIdError) {
		return "invalid-client-id";
	}
	if (err instanceof SpotifyInsufficientScopeError) {
		return "insufficient-scope";
	}
	if (err instanceof SpotifyReauthorizationRequiredError || err instanceof SpotifyUnauthorizedError) {
		return "session-expired";
	}
	if (err instanceof SpotifyPremiumRequiredError) {
		return "premium-required";
	}
	if (err instanceof SpotifyForbiddenError) {
		return "spotify-access-refused";
	}
	if (err instanceof SpotifyRateLimitError) {
		return "rate-limited";
	}
	if (err instanceof SpotifyNetworkError || err instanceof SpotifyTimeoutError) {
		return "network";
	}
	if (err instanceof SpotifyApiError && err.status >= 500) {
		return "spotify-unavailable";
	}
	if (err instanceof TokenStoreError) {
		return "session-not-saved";
	}
	return "unknown";
}
