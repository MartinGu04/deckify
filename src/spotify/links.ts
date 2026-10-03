/** A Spotify song or podcast episode URI, e.g. `spotify:track:<22-character ID>`. */
const ITEM_URI = /^spotify:(track|episode):([A-Za-z0-9]{22})$/;

/**
 * The Spotify web link for the item being played, built from its URI, so Deckify only ever opens `https://open.spotify.com/track/<id>` or
 * `https://open.spotify.com/episode/<id>`.
 * @param uri Item URI from Spotify.
 * @returns The link; otherwise `undefined` (ads, local files, unknown or malformed URIs).
 */
export function spotifyItemUrl(uri: string | undefined): string | undefined {
	const match = typeof uri === "string" ? ITEM_URI.exec(uri) : null;
	return match ? `https://open.spotify.com/${match[1] ?? ""}/${match[2] ?? ""}` : undefined;
}

/**
 * The Spotify Developer Dashboard, where users create the Spotify app whose Client ID Deckify uses. The Spotify Account Property Inspector
 * can ask the plugin to open this page, and only this page: the request carries no URL.
 */
export const SPOTIFY_DEVELOPER_DASHBOARD_URL = "https://developer.spotify.com/dashboard";

