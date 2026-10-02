import type { PlaybackCommand, PlaybackDevice, PlaybackItem } from "./model";

/**
 * - `signed-out`: Spotify is not connected (or needs reauthorization); playback is unavailable.
 * - `unknown`: connected, but no playback state has been observed yet.
 * - `inactive`: connected, but nothing is playing on any device.
 * - `active`: there is a player state (playing or paused).
 */
export type PlaybackAvailability = "signed-out" | "unknown" | "inactive" | "active";

/** Machine-readable reason for {@link PlaybackSnapshot.notice}. */
export type PlaybackNoticeCode =
	| "not-connected"
	| "reauthorization-required"
	| "premium-required"
	| "no-active-device"
	| "device-restricted"
	| "rate-limited"
	| "quota-exceeded"
	| "error";

/**
 * A user-facing explanation of why playback is limited.
 */
export type PlaybackNotice = {
	readonly code: PlaybackNoticeCode;
	readonly message: string;
};

/**
 * The shared, normalized playback state observed by every playback action. Contains no tokens and no raw Spotify payloads.
 */
export type PlaybackSnapshot = {
	readonly availability: PlaybackAvailability;
	readonly isPlaying: boolean;
	readonly item: PlaybackItem | undefined;
	readonly device: PlaybackDevice | undefined;
	readonly progressMs: number | undefined;

	/** When the last successful state observation was made (Unix epoch, milliseconds). */
	readonly observedAt: number | undefined;

	/** `isPlaying` was set optimistically after a successful command and has not been confirmed by Spotify yet. */
	readonly optimistic: boolean;

	/** A command currently being sent. */
	readonly pendingCommand: PlaybackCommand | undefined;

	/** The connected account is not Premium, so playback commands are unavailable. */
	readonly premiumRequired: boolean;

	/**
	 * A local Spotify app session (e.g. the Windows media session of the Spotify desktop app) can take commands directly, independent of the
	 * Web API's device state and rate limits.
	 */
	readonly localControl: boolean;

	readonly notice: PlaybackNotice | undefined;
};

export const SIGNED_OUT_SNAPSHOT: PlaybackSnapshot = {
	availability: "signed-out",
	isPlaying: false,
	item: undefined,
	device: undefined,
	progressMs: undefined,
	observedAt: undefined,
	optimistic: false,
	pendingCommand: undefined,
	premiumRequired: false,
	localControl: false,
	notice: undefined,
};

/**
 * Determines whether playback commands can currently be sent, based on the shared state alone.
 * @param snapshot Playback state.
 * @returns `true` when connected, Premium, and either a local Spotify session or a controllable Web API device is available.
 */
export function canControlPlayback(snapshot: PlaybackSnapshot): boolean {
	if (snapshot.availability === "signed-out" || snapshot.premiumRequired) {
		return false;
	}
	if (snapshot.localControl) {
		// Commands go to the local Spotify app; Web API device state and rate limits do not apply to them.
		return true;
	}
	return (
		snapshot.availability !== "inactive" &&
		snapshot.device?.isRestricted !== true &&
		snapshot.notice?.code !== "quota-exceeded" &&
		snapshot.notice?.code !== "rate-limited"
	);
}
