import type { PlaylistMetadata } from "./model";

/** One page of the user's playlists. */
export type PlaylistListPage = {
	/** Valid playlists of this page; malformed entries are already skipped. */
	readonly playlists: readonly PlaylistMetadata[];

	/** Number of entries Spotify returned on this page, including skipped ones (for pagination). */
	readonly entryCount: number;

	/** Total number of playlists, when Spotify reports it. */
	readonly total: number | undefined;
};

/** One page of a playlist's items, reduced to what duplicate detection needs. */
export type PlaylistItemsPage = {
	/** Spotify URIs of the items on this page (unavailable items are omitted). */
	readonly uris: readonly string[];

	readonly entryCount: number;
	readonly total: number | undefined;
};

/**
 * A playlist backend. Implementations take validated playlist IDs and Spotify track URIs, throw Deckify's typed Spotify errors, and never
 * retry on their own.
 */
export interface PlaylistTransport {
	readonly id: string;

	/**
	 * Reads one page of the current user's playlists.
	 * @param offset Index of the first playlist.
	 * @param limit Page size (at most 50).
	 */
	listPlaylists(offset: number, limit: number): Promise<PlaylistListPage>;

	/**
	 * Reads one playlist's current metadata (including its snapshot ID).
	 * @param playlistId Playlist ID.
	 */
	getPlaylist(playlistId: string): Promise<PlaylistMetadata>;

	/**
	 * Reads one page of a playlist's items (URIs only).
	 * @param playlistId Playlist ID.
	 * @param offset Index of the first item.
	 * @param limit Page size (at most 50).
	 */
	listItems(playlistId: string, offset: number, limit: number): Promise<PlaylistItemsPage>;

	/**
	 * Appends one track to a playlist.
	 * @param playlistId Playlist ID.
	 * @param trackUri Spotify track URI.
	 * @returns The playlist's new snapshot ID, when Spotify reports it.
	 */
	addItem(playlistId: string, trackUri: string): Promise<{ snapshotId: string | undefined }>;
}
