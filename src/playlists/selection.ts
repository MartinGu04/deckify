import { isPlaylistId, toPlaylistUri } from "./model";

/**
 * A key's selected playlist, validated. Identity is always the immutable playlist ID (and its URI), never the display name.
 */
export type PlaylistSelection = {
	readonly playlistId: string;
	readonly playlistUri: string;

	/** Display-only cache of the name, for the key title before playlists are loaded. */
	readonly playlistName: string | undefined;
};

/** Longest cached name kept in settings. */
const MAX_CACHED_NAME = 200;

/**
 * Validates a key's stored settings (they come from Stream Deck and the Property Inspector, so they are never trusted).
 * @param settings Raw per-key settings.
 * @returns The selection; otherwise `undefined` when nothing valid is selected (the ID and URI must both be present and match).
 */
export function normalizePlaylistSelection(settings: unknown): PlaylistSelection | undefined {
	if (typeof settings !== "object" || settings === null) {
		return undefined;
	}
	const { playlistId, playlistUri, playlistName } = settings as Record<string, unknown>;
	if (!isPlaylistId(playlistId) || playlistUri !== toPlaylistUri(playlistId)) {
		return undefined;
	}
	return {
		playlistId,
		playlistUri,
		playlistName: typeof playlistName === "string" && playlistName.length <= MAX_CACHED_NAME ? stripControlCharacters(playlistName) : undefined,
	};
}

/**
 * Builds the settings stored for a selection.
 * @param playlistId Valid playlist ID.
 * @param name Current name (display cache only).
 * @returns Settings object.
 */
export function playlistSettings(playlistId: string, name: string): { playlistId: string; playlistUri: string; playlistName: string } {
	return { playlistId, playlistUri: toPlaylistUri(playlistId), playlistName: stripControlCharacters(name).slice(0, MAX_CACHED_NAME) };
}

function stripControlCharacters(value: string): string {
	// eslint-disable-next-line no-control-regex -- removing control characters is the point.
	return value.replace(/[\u0000-\u001f\u007f]/g, "");
}
