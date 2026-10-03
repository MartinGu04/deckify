import type { LibrarySnapshot } from "../library/state";
import type { PlaybackSnapshot } from "../playback/state";
import type { KeyView } from "./playback-views";

const IMG = "imgs/actions/library";

/**
 * What the Like / Unlike key shows, independent of its artwork:
 * - `add`: the current song is not in Liked Songs; a press adds it.
 * - `added`: the song is in Liked Songs (the active state); a press removes it.
 * - `checking`: Deckify is finding out whether the song is in Liked Songs.
 * - `unavailable`: nothing can be liked right now (not connected, no device, not a song, ...); the title says why.
 */
export type LikeKeyState = "add" | "added" | "checking" | "unavailable";

/**
 * The key image for each state. Changing the artwork (for example to official Spotify Like icons) only changes this table.
 */
export const LIKE_KEY_IMAGES: Readonly<Record<LikeKeyState, string>> = {
	add: `${IMG}/heart-outline.svg`,
	added: `${IMG}/heart-filled.svg`,
	checking: `${IMG}/heart-unknown.svg`,
	unavailable: `${IMG}/heart-disabled.svg`,
};

/**
 * The Like / Unlike key's state and title.
 * @param playback Playback state (account, device, current item).
 * @param library Saved state of the current track.
 * @returns The state and title.
 */
export function likeKeyState(playback: PlaybackSnapshot, library: LibrarySnapshot): { readonly state: LikeKeyState; readonly title: string } {
	if (playback.availability === "signed-out") {
		return { state: "unavailable", title: playback.notice?.code === "reauthorization-required" ? "Reconnect" : "Connect" };
	}
	if (playback.premiumRequired) {
		return { state: "unavailable", title: "Premium" };
	}
	if (library.notice === "rate-limited" || library.notice === "quota-exceeded") {
		// Keep showing a state that is already known; the title explains why it is not updating.
		return { state: savedState(library.saved) ?? "unavailable", title: "Limited" };
	}
	if (playback.availability === "inactive") {
		return { state: "unavailable", title: "No Device" };
	}
	switch (library.kind) {
		case "unsupported":
			return { state: "unavailable", title: "Track Only" };
		case "none":
			return { state: "unavailable", title: "" };
		case "track":
			return { state: savedState(library.saved) ?? "checking", title: library.saved === undefined && library.notice === "error" ? "Error" : "" };
	}
}

/**
 * View of the Like / Unlike key.
 * @param playback Playback state (account, device, current item).
 * @param library Saved state of the current track.
 * @returns The view.
 */
export function likeView(playback: PlaybackSnapshot, library: LibrarySnapshot): KeyView {
	const { state, title } = likeKeyState(playback, library);
	return { image: LIKE_KEY_IMAGES[state], title };
}

/**
 * The state for a known saved state.
 * @param saved Saved state.
 * @returns The state; otherwise `undefined` when unknown.
 */
function savedState(saved: boolean | undefined): LikeKeyState | undefined {
	if (saved === undefined) {
		return undefined;
	}
	return saved ? "added" : "add";
}
