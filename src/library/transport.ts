/**
 * A library backend: whether a track is in the user's library (Liked Songs), and adding / removing it. Implementations take Spotify track
 * URIs (`spotify:track:...`), throw Deckify's typed Spotify errors, and never retry on their own.
 */
export interface LibraryTransport {
	/** Short identifier for logs. */
	readonly id: string;

	/**
	 * Whether the track is in the user's library.
	 * @param trackUri Spotify track URI.
	 */
	contains(trackUri: string): Promise<boolean>;

	/**
	 * Adds the track to the user's library (Liked Songs).
	 * @param trackUri Spotify track URI.
	 */
	save(trackUri: string): Promise<void>;

	/**
	 * Removes the track from the user's library.
	 * @param trackUri Spotify track URI.
	 */
	remove(trackUri: string): Promise<void>;
}
