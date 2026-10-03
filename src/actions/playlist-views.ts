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

/** Characters per title line that stay legible on a 72×72 MK.2 key. */
const TITLE_LINE = 10;

/**
 * Shortens a playlist name for a key title (display only; the stored name is never changed): up to two lines, wrapped at spaces, with an
 * ellipsis when it does not fit.
 * @param name Playlist name.
 * @returns The title.
 */
export function playlistKeyTitle(name: string): string {
	const text = name.replace(/\s+/g, " ").trim();
	if (text.length === 0) {
		return "Playlist";
	}
	if (text.length <= TITLE_LINE) {
		return text;
	}
	const lines: string[] = [];
	let rest = text;
	while (rest.length > 0 && lines.length < 2) {
		if (rest.length <= TITLE_LINE) {
			lines.push(rest);
			rest = "";
			break;
		}
		const space = rest.lastIndexOf(" ", TITLE_LINE);
		const cut = space > 0 ? space : TITLE_LINE;
		lines.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	if (rest.length > 0) {
		// Fill the last line with as much of the remaining text as fits, then the ellipsis.
		const last = `${lines.pop() ?? ""} ${rest}`;
		lines.push(`${last.slice(0, TITLE_LINE - 1).trimEnd()}…`);
	}
	return lines.join("\n");
}

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
 * The name shown on a key: the current name from Spotify when known, otherwise the cached one.
 * @param ctx Context.
 * @returns The title.
 */
function nameTitle(ctx: PlaylistKeyContext): string {
	const name = ctx.lookup?.status === "found" ? ctx.lookup.playlist.name : (ctx.selection?.playlistName ?? "");
	return playlistKeyTitle(name);
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
		return { image: `${IMG}/add-disabled.svg`, title: ctx.playback.availability === "inactive" ? "No Track" : nameTitle(ctx) };
	}
	return { image: `${IMG}/add.svg`, title: nameTitle(ctx) };
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
	return { image: `${IMG}/play.svg`, title: nameTitle(ctx) };
}
