import type { PlaybackItem } from "../playback/model";
import type { PlaybackSnapshot } from "../playback/state";

/**
 * What is playing, from the Like key's point of view:
 * - `none`: nothing is loaded (or the playback state is not known yet);
 * - `track`: a Spotify track with a valid track URI, which can be liked;
 * - `unsupported`: an episode, ad, local file or unknown item, which Deckify never adds to Liked Songs.
 */
export type LibraryItemKind = "none" | "track" | "unsupported";

/** Why library requests are currently limited. */
export type LibraryNoticeCode = "rate-limited" | "quota-exceeded" | "error";

/**
 * The shared saved state of the current track, observed by every Like key. The saved state always belongs to `uri`, the track playing now.
 */
export type LibrarySnapshot = {
	readonly kind: LibraryItemKind;

	/** The current track's URI when `kind` is `track`. */
	readonly uri: string | undefined;

	/** Whether the current track is in Liked Songs; `undefined` while not known. */
	readonly saved: boolean | undefined;

	/** The current track's saved state is being checked. */
	readonly checking: boolean;

	/** A like / unlike of the current track is being sent. */
	readonly pending: boolean;

	readonly notice: LibraryNoticeCode | undefined;
};

export const EMPTY_LIBRARY_SNAPSHOT: LibrarySnapshot = {
	kind: "none",
	uri: undefined,
	saved: undefined,
	checking: false,
	pending: false,
	notice: undefined,
};

/** Spotify track URIs: `spotify:track:` followed by a base-62 ID. Local files (`spotify:local:...`) and other URIs never match. */
const TRACK_URI = /^spotify:track:[A-Za-z0-9]{1,64}$/;

/**
 * Whether a URI is a Spotify track URI that may be sent to the library endpoints.
 * @param uri URI.
 * @returns `true` for `spotify:track:<id>`.
 */
export function isLibraryTrackUri(uri: string | undefined): uri is string {
	return uri !== undefined && TRACK_URI.test(uri);
}

/**
 * Classifies the current playback item for the Like key.
 * @param snapshot Playback state.
 * @returns The kind and, for tracks, the URI.
 */
export function classifyLibraryItem(snapshot: PlaybackSnapshot): { kind: LibraryItemKind; uri: string | undefined } {
	const item: PlaybackItem | undefined = snapshot.availability === "active" ? snapshot.item : undefined;
	if (item === undefined) {
		return { kind: "none", uri: undefined };
	}
	return item.type === "track" && isLibraryTrackUri(item.uri) ? { kind: "track", uri: item.uri } : { kind: "unsupported", uri: undefined };
}
