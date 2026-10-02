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
	notice: undefined,
};

/**
 * Determines whether playback commands can currently be sent, based on the shared state alone.
 * @param snapshot Playback state.
 * @returns `true` when connected, Premium, and the active device (if known) is controllable.
 */
export function canControlPlayback(snapshot: PlaybackSnapshot): boolean {
	return (
		snapshot.availability !== "signed-out" &&
		snapshot.availability !== "inactive" &&
		!snapshot.premiumRequired &&
		snapshot.device?.isRestricted !== true &&
		snapshot.notice?.code !== "quota-exceeded" &&
		snapshot.notice?.code !== "rate-limited"
	);
}
