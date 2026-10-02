/**
 * Fixed Spotify endpoints and the Deckify OAuth redirect.
 *
 * The redirect URI must match, character for character, the Redirect URI registered in the Spotify Developer Dashboard. It is used for the
 * authorization request and for the token exchange, and the local callback listener binds to exactly this host and port. There is
 * deliberately no fallback host or port.
 */
export const SPOTIFY_REDIRECT_HOST = "127.0.0.1";
export const SPOTIFY_REDIRECT_PORT = 43821;
export const SPOTIFY_REDIRECT_PATH = "/callback";
export const SPOTIFY_REDIRECT_URI = `http://${SPOTIFY_REDIRECT_HOST}:${SPOTIFY_REDIRECT_PORT}${SPOTIFY_REDIRECT_PATH}`;

export const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_API_BASE_URL = "https://api.spotify.com/v1";

/** How long the user has to complete the Spotify sign-in before the attempt is abandoned. */
export const AUTHORIZATION_TIMEOUT_MS = 2 * 60 * 1000;

/** Timeout for individual HTTP requests to Spotify. */
export const HTTP_TIMEOUT_MS = 15 * 1000;

/** Access tokens are refreshed when they expire within this window, so requests never race the expiry. */
export const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

/**
 * Spotify user refresh tokens expire roughly six months after the original authorization; refreshing does not extend this. Used only for
 * informational purposes; expiry is detected authoritatively by Spotify answering `invalid_grant`.
 */
export const REFRESH_TOKEN_LIFETIME_MS = 182 * 24 * 60 * 60 * 1000;

/**
 * Spotify Client IDs are 32 hexadecimal characters.
 */
export const SPOTIFY_CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;
