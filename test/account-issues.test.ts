import { describe, expect, it } from "vitest";

import { issueForError } from "../src/spotify/account-issues";
import {
	AuthorizationCallbackError,
	AuthorizationCancelledError,
	AuthorizationDeniedError,
	AuthorizationStateMismatchError,
	AuthorizationTimeoutError,
	CallbackListenerError,
	CallbackPortInUseError,
	SpotifyApiError,
	SpotifyClientIdError,
	SpotifyForbiddenError,
	SpotifyInsufficientScopeError,
	SpotifyInvalidResponseError,
	SpotifyNetworkError,
	SpotifyOAuthError,
	SpotifyPremiumRequiredError,
	SpotifyQuotaExceededError,
	SpotifyRateLimitError,
	SpotifyReauthorizationRequiredError,
	SpotifyTimeoutError,
	SpotifyUnauthorizedError,
	TokenStoreError,
} from "../src/spotify/errors";

describe("issueForError", () => {
	it.each([
		[new AuthorizationDeniedError(), "authorization-denied"],
		[new AuthorizationCancelledError(), "authorization-cancelled"],
		[new AuthorizationTimeoutError(), "authorization-timeout"],
		[new AuthorizationCallbackError("server_error"), "authorization-failed"],
		[new AuthorizationStateMismatchError(), "authorization-failed"],
		[new SpotifyOAuthError(400, "invalid_grant", "Invalid authorization code"), "authorization-failed"],
		[new CallbackPortInUseError(), "callback-port-in-use"],
		[new SpotifyClientIdError("bad"), "invalid-client-id"],
		[new SpotifyInsufficientScopeError(["user-read-private"]), "insufficient-scope"],
		[new SpotifyReauthorizationRequiredError(), "session-expired"],
		[new SpotifyUnauthorizedError(undefined), "session-expired"],
		[new SpotifyPremiumRequiredError(), "premium-required"],
		[new SpotifyForbiddenError("User not registered in the Developer Dashboard"), "spotify-access-refused"],
		[new SpotifyRateLimitError(undefined, 5), "rate-limited"],
		[new SpotifyQuotaExceededError(undefined, undefined), "rate-limited"],
		[new SpotifyNetworkError(), "network"],
		[new SpotifyTimeoutError(), "network"],
		[new SpotifyApiError(503, "Service unavailable"), "spotify-unavailable"],
		[new TokenStoreError("DPAPI unavailable"), "session-not-saved"],
	])("classifies %s", (error, issue) => {
		expect(issueForError(error)).toBe(issue);
	});

	it("only calls a 403 refused access, and never guesses from other errors or from messages", () => {
		expect(issueForError(new SpotifyApiError(400, "User not registered in the Developer Dashboard"))).toBe("unknown");
		expect(issueForError(new SpotifyApiError(404, undefined))).toBe("unknown");
		expect(issueForError(new SpotifyInvalidResponseError("Users Management"))).toBe("unknown");
		expect(issueForError(new CallbackListenerError("EACCES"))).toBe("unknown");
		expect(issueForError(new Error("access_denied"))).toBe("unknown");
		expect(issueForError("authorization-denied")).toBe("unknown");
		expect(issueForError(undefined)).toBe("unknown");
	});
});
