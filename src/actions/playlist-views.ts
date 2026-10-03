import { classifyLibraryItem } from "../library/state";
import type { PlaybackSnapshot } from "../playback/state";
import type { PlaylistLookup, PlaylistSnapshot } from "../playlists/service";
import type { PlaylistSelection } from "../playlists/selection";
import type { KeyView } from "./playback-views";

const IMG = "imgs/actions/playlist";

/** Everything a playlist key's view depends on. */
export type PlaylistKeyContext = {
	readonly playback: PlaybackSnapshot;
	readonly playlists: PlaylistSnapshot;
	readonly selection: PlaylistSelection | undefined;
	readonly lookup: PlaylistLookup | undefined;
	/** Short-lived feedback after a press (e.g. "Added"), shown instead of the normal title. */
	readonly feedback: string | undefined;
};

/**
 * Deckify's own titles for the playlist keys. A key never shows the playlist's name or any other Spotify metadata: the chosen playlist is
 * shown, with Spotify's attribution and a link back to Spotify, only in the Property Inspector.
 */
export const PLAYLIST_KEY_TITLES = {
	add: "Add to\nPlaylist",
	play: "Play\nPlaylist",
} as const;

/**
 * The status shared by both playlist keys before anything playlist-specific: account, Premium, selection and availability.
 * @param ctx Context.
 * @param mode Which key.
 * @returns A title for an unavailable key; otherwise `undefined`.
 */
function commonStatus(ctx: PlaylistKeyContext, mode: "add" | "play"): string | undefined {
	if (ctx.playback.availability === "signed-out") {
		return ctx.playback.notice?.code === "reauthorization-required" || ctx.playlists.status === "reauthorization-required" ? "Reconnect" : "Connect";
	}
	if (ctx.playback.premiumRequired) {
		return "Premium";
	}
	if (ctx.selection === undefined) {
		return "Choose\nPlaylist";
	}
	if (ctx.lookup?.status === "missing" || (mode === "add" && ctx.lookup?.status === "found" && !ctx.lookup.playlist.writable)) {
		return "Unavailable";
	}
	return undefined;
}

/**
 * View of the Add Current Track to Playlist key.
 * @param ctx Context.
 * @returns The view.
 */
export function addToPlaylistView(ctx: PlaylistKeyContext): KeyView {
	const status = commonStatus(ctx, "add");
	if (status !== undefined) {
		return { image: `${IMG}/add-disabled.svg`, title: status };
	}
	if (ctx.feedback !== undefined) {
		return { image: `${IMG}/add-done.svg`, title: ctx.feedback };
	}
	if (ctx.selection !== undefined && ctx.playlists.adding.has(ctx.selection.playlistId)) {
		return { image: `${IMG}/add.svg`, title: "Adding…" };
	}
	if (ctx.playlists.status === "limited") {
		return { image: `${IMG}/add-disabled.svg`, title: "Limited" };
	}
	const { kind } = classifyLibraryItem(ctx.playback);
	if (kind === "unsupported") {
		return { image: `${IMG}/add-disabled.svg`, title: "Track Only" };
	}
	if (kind === "none") {
		return { image: `${IMG}/add-disabled.svg`, title: ctx.playback.availability === "inactive" ? "No Track" : PLAYLIST_KEY_TITLES.add };
	}
	return { image: `${IMG}/add.svg`, title: PLAYLIST_KEY_TITLES.add };
}

/**
 * View of the Play Playlist key.
 * @param ctx Context.
 * @returns The view.
 */
export function playPlaylistView(ctx: PlaylistKeyContext): KeyView {
	const status = commonStatus(ctx, "play");
	if (status !== undefined) {
		return { image: `${IMG}/play-disabled.svg`, title: status };
	}
	if (ctx.feedback !== undefined) {
		return { image: `${IMG}/play.svg`, title: ctx.feedback };
	}
	switch (ctx.playback.notice?.code) {
		case "rate-limited":
		case "quota-exceeded":
			return { image: `${IMG}/play-disabled.svg`, title: "Limited" };
		case "device-restricted":
			return { image: `${IMG}/play-disabled.svg`, title: "Restricted" };
		default:
			break;
	}
	if (ctx.playback.availability === "inactive") {
		return { image: `${IMG}/play-disabled.svg`, title: "No Device" };
	}
	return { image: `${IMG}/play.svg`, title: PLAYLIST_KEY_TITLES.play };
}
