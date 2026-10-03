/**
 * The Spotify scopes Deckify requests. This is the single source of truth: add scopes here only when a feature needs them.
 *
 * - `user-read-private`: account profile (display name, subscription level).
 * - `user-read-playback-state`: current playback state (`GET /v1/me/player`).
 * - `user-modify-playback-state`: play, pause, next, previous and volume.
 * - `user-library-read`: whether the current track is in the user's library (`GET /v1/me/library/contains`).
 * - `user-library-modify`: like / unlike the current track (`PUT` / `DELETE /v1/me/library`).
 * - `playlist-read-private`, `playlist-read-collaborative`: the user's private and collaborative playlists in the playlist pickers
 *   (`GET /v1/me/playlists`) and their items for duplicate checks (`GET /v1/playlists/{id}/items`).
 * - `playlist-modify-public`, `playlist-modify-private`: add the current track to the user's public or private / collaborative playlists
 *   (`POST /v1/playlists/{id}/items`).
 *
 * Sessions authorized before a scope was added do not have it. Scopes can only be added by authorizing again; a refresh-token exchange never
 * grants new scopes.
 */
export const SPOTIFY_SCOPES: readonly string[] = [
	"user-read-private",
	"user-read-playback-state",
	"user-modify-playback-state",
	"user-library-read",
	"user-library-modify",
	"playlist-read-private",
	"playlist-read-collaborative",
	"playlist-modify-public",
	"playlist-modify-private",
];

/**
 * Gets the required scopes that a session was not granted.
 * @param granted Scopes granted to the session.
 * @param required Scopes Deckify requires; defaults to {@link SPOTIFY_SCOPES}.
 * @returns The missing scopes, in the order they are required.
 */
export function getMissingScopes(granted: readonly string[], required: readonly string[] = SPOTIFY_SCOPES): string[] {
	const grantedSet = new Set(granted);
	return required.filter((scope) => !grantedSet.has(scope));
}
