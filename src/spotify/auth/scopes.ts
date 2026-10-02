/**
 * The Spotify scopes Deckify requests. This is the single source of truth: add scopes here only when a feature needs them.
 *
 * Phase 2 (account connection) only needs to read the user's profile.
 */
export const SPOTIFY_SCOPES: readonly string[] = ["user-read-private"];
