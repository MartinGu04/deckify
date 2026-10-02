/**
 * Deckify's normalized, transport-independent playback model. Actions only ever see these types, never raw Spotify responses.
 */

/** Kind of the item being played. Unknown future Spotify item types map to `"unknown"` rather than failing. */
export type PlaybackItemType = "track" | "episode" | "ad" | "unknown";

/**
 * The item currently loaded in the player.
 */
export type PlaybackItem = {
	readonly type: PlaybackItemType;

	/** Stable ID, when the item has one (local files and ads do not). */
	readonly id: string | undefined;

	/** Spotify URI, e.g. `spotify:track:...`. */
	readonly uri: string | undefined;

	/** Track/episode name; may be empty for ads or unknown items. */
	readonly title: string;

	/** Artists (comma-separated) for tracks, show name for episodes. */
	readonly subtitle: string;

	readonly durationMs: number | undefined;
};

/**
 * The device playback is happening on.
 */
export type PlaybackDevice = {
	readonly id: string | undefined;
	readonly name: string;
	readonly type: string;

	/** Spotify reports that this device cannot be controlled through the Web API. */
	readonly isRestricted: boolean;

	/**
	 * The device's Spotify volume (0–100), as reported by Spotify. `undefined` when Spotify did not report a usable value. This is Spotify's
	 * own device volume (the one the Spotify apps show), never a Windows mixer level.
	 */
	readonly volumePercent: number | undefined;

	/** Spotify reports that the device's volume can be changed through the Web API. Never assumed: `false` unless Spotify says `true`. */
	readonly supportsVolume: boolean;
};

/**
 * One observation of the player, as reported by a transport.
 */
export type PlaybackObservation = {
	/** `false` when there is no active playback or device (Spotify answers 204). */
	readonly active: boolean;
	readonly isPlaying: boolean;
	readonly device: PlaybackDevice | undefined;
	readonly item: PlaybackItem | undefined;
	readonly progressMs: number | undefined;
};

/** Commands every transport supports. */
export type PlaybackCommand = "play" | "pause" | "next" | "previous";

/** An observation that represents "nothing is playing anywhere". */
export const INACTIVE_OBSERVATION: PlaybackObservation = Object.freeze({
	active: false,
	isPlaying: false,
	device: undefined,
	item: undefined,
	progressMs: undefined,
});
