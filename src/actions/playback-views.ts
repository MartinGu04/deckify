import { canControlPlayback, canControlVolume, displayedVolume, type PlaybackSnapshot } from "../playback/state";

/**
 * Image (plugin-relative path) and title for a key.
 */
export type KeyView = {
	readonly image: string;
	readonly title: string;
};

const IMG = "imgs/actions/playback";

/**
 * A short status label that fits under a key icon, or `undefined` when playback is normal.
 * @param snapshot Playback state.
 * @returns The label.
 */
export function shortPlaybackStatus(snapshot: PlaybackSnapshot): string | undefined {
	if (snapshot.availability === "signed-out") {
		return snapshot.notice?.code === "reauthorization-required" ? "Reconnect" : "Connect";
	}
	switch (snapshot.notice?.code) {
		case "premium-required":
			return "Premium";
		case "quota-exceeded":
		case "rate-limited":
			return "Limited";
		case "device-restricted":
			return "Restricted";
		default:
			break;
	}
	if (snapshot.availability === "inactive") {
		return "No Device";
	}
	if (snapshot.notice?.code === "error") {
		return "Error";
	}
	return undefined;
}

/**
 * View of the Play / Pause key: the icon shows the action a press performs (play when paused, pause when playing).
 * @param snapshot Playback state.
 * @returns The view.
 */
export function playPauseView(snapshot: PlaybackSnapshot): KeyView {
	if (!canControlPlayback(snapshot) || (snapshot.availability === "unknown" && !snapshot.localControl)) {
		return { image: `${IMG}/play-disabled.svg`, title: shortPlaybackStatus(snapshot) ?? "" };
	}
	return snapshot.isPlaying ? { image: `${IMG}/pause.svg`, title: "" } : { image: `${IMG}/play.svg`, title: "" };
}

/**
 * View of the Next Track / Previous Track keys.
 * @param direction Which key.
 * @param snapshot Playback state.
 * @returns The view.
 */
export function skipView(direction: "next" | "previous", snapshot: PlaybackSnapshot): KeyView {
	const enabled = canControlPlayback(snapshot) && (snapshot.availability === "active" || snapshot.localControl);
	return { image: `${IMG}/${direction}${enabled ? "" : "-disabled"}.svg`, title: "" };
}

const VOLUME_IMG = "imgs/actions/volume";

/**
 * A short status label for the volume keys, or `undefined` when volume can be changed.
 * @param snapshot Playback state.
 * @returns The label.
 */
export function shortVolumeStatus(snapshot: PlaybackSnapshot): string | undefined {
	const status = shortPlaybackStatus(snapshot);
	if (status !== undefined) {
		return status;
	}
	if (snapshot.availability === "active" && snapshot.device !== undefined && !snapshot.device.supportsVolume) {
		return "Unsupported";
	}
	return undefined;
}

/**
 * View of the Volume Up / Volume Down keys: the icon, with the active device's Spotify volume (or the volume being set) as the title.
 * @param direction Which key.
 * @param snapshot Playback state.
 * @returns The view.
 */
export function volumeView(direction: "up" | "down", snapshot: PlaybackSnapshot): KeyView {
	if (!canControlVolume(snapshot)) {
		return { image: `${VOLUME_IMG}/volume-${direction}-disabled.svg`, title: shortVolumeStatus(snapshot) ?? "" };
	}
	const volume = displayedVolume(snapshot);
	return { image: `${VOLUME_IMG}/volume-${direction}.svg`, title: volume === undefined ? "" : `${String(volume)}%` };
}

/**
 * View of the Mute / Unmute key. Muted means the device's real Spotify volume is 0, whoever set it.
 * @param snapshot Playback state.
 * @returns The view.
 */
export function muteView(snapshot: PlaybackSnapshot): KeyView {
	if (!canControlVolume(snapshot)) {
		return { image: `${VOLUME_IMG}/speaker-disabled.svg`, title: shortVolumeStatus(snapshot) ?? "" };
	}
	return displayedVolume(snapshot) === 0 ? { image: `${VOLUME_IMG}/speaker-muted.svg`, title: "" } : { image: `${VOLUME_IMG}/speaker.svg`, title: "" };
}
