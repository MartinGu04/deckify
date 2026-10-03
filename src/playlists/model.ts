/**
 * Deckify's normalized, transport-independent playlist model. Actions and the Property Inspector never see raw Spotify responses.
 */

/** Spotify playlist IDs: 22 base-62 characters. */
const PLAYLIST_ID = /^[A-Za-z0-9]{22}$/;
const PLAYLIST_URI_PREFIX = "spotify:playlist:";

/**
 * Playlist metadata as reported by Spotify, before Deckify decides whether the user can modify it.
 */
export type PlaylistMetadata = {
	readonly id: string;

	/** Always `spotify:playlist:<id>`. */
	readonly uri: string;

	/** Exactly as Spotify returns it (never trimmed or altered); may be empty. */
	readonly name: string;

	readonly ownerId: string | undefined;
	readonly ownerDisplayName: string | undefined;

	/** `undefined` when Spotify does not say (it may report `null`). */
	readonly public: boolean | undefined;

	readonly collaborative: boolean;

	/** Version of the playlist's contents; changes whenever its items change. */
	readonly snapshotId: string | undefined;

	readonly itemCount: number | undefined;

	/** Validated `https://open.spotify.com/playlist/<id>` link from Spotify, when present. */
	readonly spotifyUrl: string | undefined;
};

/**
 * A playlist of the authenticated user's library.
 */
export type Playlist = PlaylistMetadata & {
	/** The authenticated user owns it, or it is collaborative (and in their library). Never derived from `public` or the name. */
	readonly writable: boolean;
};

/**
 * Whether a value is a valid Spotify playlist ID.
 * @param value Value.
 * @returns `true` for 22 base-62 characters.
 */
export function isPlaylistId(value: unknown): value is string {
	return typeof value === "string" && PLAYLIST_ID.test(value);
}

/**
 * Builds a playlist URI.
 * @param id Valid playlist ID.
 * @returns `spotify:playlist:<id>`.
 */
export function toPlaylistUri(id: string): string {
	if (!isPlaylistId(id)) {
		throw new RangeError("Invalid Spotify playlist ID.");
	}
	return `${PLAYLIST_URI_PREFIX}${id}`;
}

/**
 * Extracts the ID from a playlist URI.
 * @param value Value.
 * @returns The ID; otherwise `undefined` unless the value is exactly `spotify:playlist:<valid id>`.
 */
export function playlistIdFromUri(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.startsWith(PLAYLIST_URI_PREFIX)) {
		return undefined;
	}
	const id = value.slice(PLAYLIST_URI_PREFIX.length);
	return isPlaylistId(id) ? id : undefined;
}

/**
 * Validates a Spotify-provided web link to a playlist. Only `https://open.spotify.com/playlist/<id>` for the same playlist is accepted, so
 * an unexpected response can never make Deckify open another site.
 * @param value Link from Spotify (`external_urls.spotify`).
 * @param id The playlist's ID.
 * @returns The canonical link; otherwise `undefined`.
 */
export function toSpotifyPlaylistUrl(value: unknown, id: string): string | undefined {
	if (typeof value !== "string" || !isPlaylistId(id) || value.length > 300) {
		return undefined;
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}
	if (url.protocol !== "https:" || url.hostname !== "open.spotify.com" || url.port !== "" || url.username !== "" || url.password !== "") {
		return undefined;
	}
	return url.pathname === `/playlist/${id}` ? `https://open.spotify.com/playlist/${id}` : undefined;
}

/**
 * Decides whether the user can add items to a playlist.
 * @param playlist Metadata.
 * @param userId Authenticated Spotify user ID.
 * @returns `true` when the user owns it or it is collaborative.
 */
export function isWritablePlaylist(playlist: PlaylistMetadata, userId: string): boolean {
	return (playlist.ownerId !== undefined && playlist.ownerId === userId) || playlist.collaborative;
}
