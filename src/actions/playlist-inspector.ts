import { isPlaylistId, playlistIdFromUri, type Playlist } from "../playlists/model";
import type { PlaylistLookup, PlaylistSnapshot } from "../playlists/service";
import type { PlaylistSelection } from "../playlists/selection";

/**
 * Plugin ↔ Property Inspector protocol of the playlist picker (shared by Add to Playlist and Play Playlist).
 *
 * The Property Inspector never talks to Spotify and never receives tokens, the Client ID, API URLs or links: it asks the plugin for a
 * sanitized playlist list, and the plugin validates every request (type, request ID, playlist ID and URI) before acting on it.
 */

/** Which playlists a picker offers: only writable ones (Add to Playlist) or all of the user's playlists (Play Playlist). */
export type PlaylistPickerMode = "add" | "play";

/** Requests from the Property Inspector. */
export type PlaylistInspectorRequest =
	| { readonly type: "deckify:playlist:list"; readonly requestId: string }
	| { readonly type: "deckify:playlist:refresh"; readonly requestId: string }
	| { readonly type: "deckify:playlist:select"; readonly requestId: string; readonly playlistId: string; readonly playlistUri: string }
	| { readonly type: "deckify:playlist:open"; readonly requestId: string };

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Allowed keys per request type; anything else is rejected. */
const ALLOWED_KEYS: Record<PlaylistInspectorRequest["type"], readonly string[]> = {
	"deckify:playlist:list": ["type", "requestId"],
	"deckify:playlist:refresh": ["type", "requestId"],
	"deckify:playlist:select": ["type", "requestId", "playlistId", "playlistUri"],
	"deckify:playlist:open": ["type", "requestId"],
};

/**
 * Validates a Property Inspector message.
 * @param payload Raw payload.
 * @returns The request; otherwise `undefined` for unknown types, unknown keys, bad request IDs or an invalid / mismatched playlist.
 */
export function parsePlaylistInspectorRequest(payload: unknown): PlaylistInspectorRequest | undefined {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
		return undefined;
	}
	const message = payload as Record<string, unknown>;
	const type = message.type;
	if (typeof type !== "string" || !Object.hasOwn(ALLOWED_KEYS, type)) {
		return undefined;
	}
	const allowed = ALLOWED_KEYS[type as PlaylistInspectorRequest["type"]];
	if (Object.keys(message).some((key) => !allowed.includes(key))) {
		return undefined;
	}
	const requestId = message.requestId;
	if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) {
		return undefined;
	}
	switch (type) {
		case "deckify:playlist:list":
		case "deckify:playlist:refresh":
		case "deckify:playlist:open":
			return { type, requestId };
		case "deckify:playlist:select": {
			const { playlistId, playlistUri } = message;
			if (!isPlaylistId(playlistId) || playlistIdFromUri(playlistUri) !== playlistId) {
				return undefined;
			}
			return { type, requestId, playlistId, playlistUri: playlistUri as string };
		}
		default:
			return undefined;
	}
}

/** A playlist as the Property Inspector sees it: display data only (no links, no snapshot, no raw Spotify data). */
export type InspectorPlaylist = {
	readonly id: string;
	readonly uri: string;
	readonly name: string;
	readonly owner: string;
	readonly mine: boolean;
	readonly collaborative: boolean;
	readonly public: boolean | null;
	readonly itemCount: number | null;
};

/** State of the selected playlist shown in the picker. */
export type InspectorSelectionState = "ok" | "unknown" | "unavailable" | "not-writable";

/** The message the plugin sends to the Property Inspector. */
export type PlaylistInspectorState = {
	readonly type: "deckify:playlist:state";
	/** The request this answers; `null` for updates the plugin pushes by itself. */
	readonly requestId: string | null;
	readonly mode: PlaylistPickerMode;
	readonly status: PlaylistSnapshot["status"];
	readonly retryAfterSeconds: number | null;
	readonly message: string | null;
	readonly playlists: readonly InspectorPlaylist[];
	readonly selected: {
		readonly id: string;
		readonly name: string;
		readonly owner: string | null;
		readonly state: InspectorSelectionState;
		readonly canOpen: boolean;
	} | null;
};

/**
 * Builds the sanitized state for the Property Inspector.
 * @param options Inputs.
 * @param options.requestId The request this answers, if any.
 * @param options.mode Picker mode.
 * @param options.snapshot Playlist state.
 * @param options.userId Authenticated user ID.
 * @param options.selection The key's selection.
 * @param options.lookup The selection's lookup.
 * @param options.message Optional message (e.g. why a request failed).
 * @returns The state message.
 */
export function buildInspectorState(options: {
	requestId: string | null;
	mode: PlaylistPickerMode;
	snapshot: PlaylistSnapshot;
	userId: string | undefined;
	selection: PlaylistSelection | undefined;
	lookup: PlaylistLookup | undefined;
	message?: string;
}): PlaylistInspectorState {
	const { snapshot, mode, userId, selection, lookup } = options;
	const offered = (snapshot.playlists ?? []).filter((p) => mode === "play" || p.writable);
	let selected: PlaylistInspectorState["selected"] = null;
	if (selection !== undefined) {
		const playlist = lookup?.status === "found" ? lookup.playlist : undefined;
		let state: InspectorSelectionState = "unknown";
		if (lookup?.status === "missing") {
			state = "unavailable";
		} else if (playlist !== undefined) {
			state = mode === "add" && !playlist.writable ? "not-writable" : "ok";
		}
		selected = {
			id: selection.playlistId,
			name: playlist?.name ?? selection.playlistName ?? "",
			owner: playlist === undefined ? null : ownerLabel(playlist, userId),
			state,
			canOpen: playlist?.spotifyUrl !== undefined && state !== "unavailable",
		};
	}
	return {
		type: "deckify:playlist:state",
		requestId: options.requestId,
		mode,
		status: snapshot.status,
		retryAfterSeconds: snapshot.retryAfterSeconds ?? null,
		message: options.message ?? null,
		playlists: offered.map((p) => toInspectorPlaylist(p, userId)),
		selected,
	};
}

/**
 * Converts a playlist for the Property Inspector.
 * @param playlist Playlist.
 * @param userId Authenticated user ID.
 * @returns Display data.
 */
function toInspectorPlaylist(playlist: Playlist, userId: string | undefined): InspectorPlaylist {
	return {
		id: playlist.id,
		uri: playlist.uri,
		name: playlist.name,
		owner: ownerLabel(playlist, userId),
		mine: playlist.ownerId !== undefined && playlist.ownerId === userId,
		collaborative: playlist.collaborative,
		public: playlist.public ?? null,
		itemCount: playlist.itemCount ?? null,
	};
}

function ownerLabel(playlist: Playlist, userId: string | undefined): string {
	if (playlist.ownerId !== undefined && playlist.ownerId === userId) {
		return "You";
	}
	return playlist.ownerDisplayName ?? playlist.ownerId ?? "";
}
