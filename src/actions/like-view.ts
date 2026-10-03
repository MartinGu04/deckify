import type { LibrarySnapshot } from "../library/state";
import type { PlaybackSnapshot } from "../playback/state";
import type { KeyView } from "./playback-views";

const IMG = "imgs/actions/library";

/**
 * View of the Like / Unlike key: a filled heart when the current track is in Liked Songs, an outline heart when it is not.
 * @param playback Playback state (account, device, current item).
 * @param library Saved state of the current track.
 * @returns The view.
 */
export function likeView(playback: PlaybackSnapshot, library: LibrarySnapshot): KeyView {
	if (playback.availability === "signed-out") {
		return { image: `${IMG}/heart-disabled.svg`, title: playback.notice?.code === "reauthorization-required" ? "Reconnect" : "Connect" };
	}
	if (playback.premiumRequired) {
		return { image: `${IMG}/heart-disabled.svg`, title: "Premium" };
	}
	if (library.notice === "rate-limited" || library.notice === "quota-exceeded") {
		// Keep showing a state that is already known; the title explains why it is not updating.
		return { image: heartFor(library.saved) ?? `${IMG}/heart-disabled.svg`, title: "Limited" };
	}
	if (playback.availability === "inactive") {
		return { image: `${IMG}/heart-disabled.svg`, title: "No Device" };
	}
	switch (library.kind) {
		case "unsupported":
			return { image: `${IMG}/heart-disabled.svg`, title: "Track Only" };
		case "none":
			return { image: `${IMG}/heart-disabled.svg`, title: "" };
		case "track":
			return { image: heartFor(library.saved) ?? `${IMG}/heart-unknown.svg`, title: library.saved === undefined && library.notice === "error" ? "Error" : "" };
	}
}

/**
 * The heart for a known saved state.
 * @param saved Saved state.
 * @returns The image; otherwise `undefined` when unknown.
 */
function heartFor(saved: boolean | undefined): string | undefined {
	if (saved === undefined) {
		return undefined;
	}
	return saved ? `${IMG}/heart-filled.svg` : `${IMG}/heart-outline.svg`;
}
