import { SPOTIFY_REDIRECT_URI, SPOTIFY_TOKEN_URL } from "../config";
import { SpotifyApiError, SpotifyInvalidResponseError, SpotifyOAuthError, SpotifyRateLimitError } from "../errors";
import { isRecord, readApiErrorMessage, readRetryAfterSeconds, sendRequest, type HttpOptions, type HttpResult } from "../http";

/**
 * Tokens returned by Spotify's token endpoint.
 */
export type TokenResponse = {
	readonly accessToken: string;
	readonly expiresInSeconds: number;

	/** Present on code exchange; on refresh, only present when Spotify rotates the refresh token. */
	readonly refreshToken: string | undefined;

	/** Granted scopes, when reported. */
	readonly scopes: readonly string[] | undefined;
};

/**
 * Exchanges an authorization code for tokens (Authorization Code with PKCE). No client secret is sent.
 * @param params Exchange parameters.
 * @param params.clientId Spotify Client ID.
 * @param params.code Authorization code from the callback.
 * @param params.codeVerifier PKCE code verifier of the same attempt.
 * @param http HTTP options.
 * @returns The tokens, including a refresh token.
 */
export async function exchangeAuthorizationCode(
	params: { clientId: string; code: string; codeVerifier: string },
	http?: HttpOptions,
): Promise<TokenResponse & { refreshToken: string }> {
	const tokens = await requestTokens(
		new URLSearchParams({
			grant_type: "authorization_code",
			code: params.code,
			redirect_uri: SPOTIFY_REDIRECT_URI,
			client_id: params.clientId,
			code_verifier: params.codeVerifier,
		}),
		http,
	);
	if (tokens.refreshToken === undefined) {
		throw new SpotifyInvalidResponseError("token response did not include a refresh token");
	}
	return { ...tokens, refreshToken: tokens.refreshToken };
}

/**
 * Obtains a new access token from a refresh token (PKCE refresh: Client ID + refresh token, no client secret).
 * @param params Refresh parameters.
 * @param params.clientId Spotify Client ID.
 * @param params.refreshToken Current refresh token.
 * @param http HTTP options.
 * @returns The tokens; `refreshToken` is only set when Spotify issued a replacement.
 */
export async function refreshAccessToken(params: { clientId: string; refreshToken: string }, http?: HttpOptions): Promise<TokenResponse> {
	return requestTokens(
		new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: params.refreshToken,
			client_id: params.clientId,
		}),
		http,
	);
}

/**
 * Posts a form to the token endpoint and validates the response.
 * @param form Form parameters.
 * @param http HTTP options.
 * @returns The parsed tokens.
 */
async function requestTokens(form: URLSearchParams, http?: HttpOptions): Promise<TokenResponse> {
	const result = await sendRequest(
		SPOTIFY_TOKEN_URL,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
			body: form.toString(),
		},
		http,
	);

	if (!result.ok) {
		throw toTokenError(result);
	}
	return parseTokenResponse(result.body);
}

/**
 * Maps a failed token response to an error. OAuth errors (`{ error, error_description }`) become {@link SpotifyOAuthError}.
 * @param result The response.
 * @returns The error.
 */
function toTokenError(result: HttpResult): Error {
	if (result.status === 429) {
		return new SpotifyRateLimitError(readApiErrorMessage(result.body), readRetryAfterSeconds(result.headers));
	}
	if (isRecord(result.body) && typeof result.body.error === "string") {
		const description = typeof result.body.error_description === "string" ? result.body.error_description.slice(0, 200) : undefined;
		return new SpotifyOAuthError(result.status, result.body.error, description);
	}
	return new SpotifyApiError(result.status, readApiErrorMessage(result.body));
}

/**
 * Validates a successful token response.
 * @param body Response body.
 * @returns The tokens.
 */
export function parseTokenResponse(body: unknown): TokenResponse {
	if (!isRecord(body)) {
		throw new SpotifyInvalidResponseError("token response was not a JSON object");
	}
	const { access_token: accessToken, token_type: tokenType, expires_in: expiresIn, refresh_token: refreshToken, scope } = body;

	if (typeof accessToken !== "string" || accessToken.length === 0) {
		throw new SpotifyInvalidResponseError("token response did not include an access token");
	}
	if (typeof tokenType !== "string" || tokenType.toLowerCase() !== "bearer") {
		throw new SpotifyInvalidResponseError("token type was not Bearer");
	}
	if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
		throw new SpotifyInvalidResponseError("token response had an invalid expires_in");
	}
	if (refreshToken !== undefined && (typeof refreshToken !== "string" || refreshToken.length === 0)) {
		throw new SpotifyInvalidResponseError("token response had an invalid refresh token");
	}
	if (scope !== undefined && typeof scope !== "string") {
		throw new SpotifyInvalidResponseError("token response had an invalid scope");
	}

	return {
		accessToken,
		expiresInSeconds: expiresIn,
		refreshToken,
		scopes: scope === undefined ? undefined : scope.split(" ").filter((s) => s.length > 0),
	};
}
