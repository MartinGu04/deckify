import type { PlaybackObservation } from "./model";

/**
 * A playback backend. Phase 3 implements it with the Spotify Web API; Phase 4 can add a local Windows media transport (or a composite that
 * sends basic commands locally and reads Spotify-specific state from the Web API) without changing the playback service or the actions.
 *
 * Implementations throw Deckify's typed Spotify errors (e.g. no active device, rate limited) and never retry on their own.
 */
export interface PlaybackTransport {
	/** Short identifier for logs, e.g. `"spotify-web-api"`. */
	readonly id: string;

	/** Reads the current player state; resolves with an inactive observation when nothing is playing. */
	getState(): Promise<PlaybackObservation>;

	/** Resumes playback on the active device. */
	play(): Promise<void>;

	/** Pauses playback on the active device. */
	pause(): Promise<void>;

	/** Skips to the next item. */
	next(): Promise<void>;

	/** Skips to the previous item. */
	previous(): Promise<void>;

	/**
	 * Sets the active device's Spotify volume.
	 * @param volumePercent Whole percent, 0–100.
	 */
	setVolume(volumePercent: number): Promise<void>;

	/**
	 * Starts playing a context (a playlist) from its beginning on the active device.
	 * @param contextUri `spotify:playlist:<id>`.
	 */
	playContext(contextUri: string): Promise<void>;
}
