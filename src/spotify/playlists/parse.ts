import { isPlaylistId, toPlaylistUri, toSpotifyPlaylistUrl, type PlaylistMetadata } from "../../playlists/model";
import type { PlaylistItemsPage, PlaylistListPage } from "../../playlists/transport";
import { SpotifyInvalidResponseError } from "../errors";
import { isRecord } from "../http";

/** Longest playlist name Deckify accepts (Spotify allows far fewer); longer entries are treated as malformed. */
const MAX_NAME_LENGTH = 1000;

/**
 * Normalizes one playlist object (simplified or full). The February 2026 Web API names the item collection `items` (formerly `tracks`).
 * @param value Raw playlist.
 * @returns The metadata; otherwise `undefined` when the entry is malformed (it is then skipped, never guessed).
 */
export function parsePlaylist(value: unknown): PlaylistMetadata | undefined {
	if (!isRecord(value) || !isPlaylistId(value.id)) {
		return undefined;
	}
	const id = value.id;
	// When Spotify sends a URI it must be this playlist's; Deckify always uses its own canonical URI.
	if (value.uri !== undefined && value.uri !== toPlaylistUri(id)) {
		return undefined;
	}
	if (typeof value.name !== "string" || value.name.length > MAX_NAME_LENGTH) {
		return undefined;
	}
	const owner = isRecord(value.owner) ? value.owner : undefined;
	const collection = isRecord(value.items) ? value.items : isRecord(value.tracks) ? value.tracks : undefined;
	const externalUrls = isRecord(value.external_urls) ? value.external_urls : undefined;
	return {
		id,
		uri: toPlaylistUri(id),
		name: value.name,
		ownerId: shortString(owner?.id, 200),
		ownerDisplayName: shortString(owner?.display_name, 200),
		public: typeof value.public === "boolean" ? value.public : undefined,
		collaborative: value.collaborative === true,
		snapshotId: shortString(value.snapshot_id, 500),
		itemCount: toCount(collection?.total),
		spotifyUrl: toSpotifyPlaylistUrl(externalUrls?.spotify, id),
	};
}

/**
 * Parses a `GET /v1/me/playlists` page. Malformed or duplicate entries are skipped.
 * @param body Parsed body.
 * @returns The page.
 */
export function parsePlaylistListPage(body: unknown): PlaylistListPage {
	if (!isRecord(body) || !Array.isArray(body.items)) {
		throw new SpotifyInvalidResponseError("playlist list had no items");
	}
	const seen = new Set<string>();
	const playlists: PlaylistMetadata[] = [];
	for (const entry of body.items) {
		const playlist = parsePlaylist(entry);
		if (playlist !== undefined && !seen.has(playlist.id)) {
			seen.add(playlist.id);
			playlists.push(playlist);
		}
	}
	return { playlists, entryCount: body.items.length, total: toCount(body.total) };
}

/**
 * Parses a `GET /v1/playlists/{id}` response.
 * @param body Parsed body.
 * @param expectedId The requested playlist's ID.
 * @returns The metadata.
 */
export function parsePlaylistMetadata(body: unknown, expectedId: string): PlaylistMetadata {
	const playlist = parsePlaylist(body);
	if (playlist?.id !== expectedId) {
		throw new SpotifyInvalidResponseError("playlist metadata was malformed");
	}
	return playlist;
}

/**
 * Parses a `GET /v1/playlists/{id}/items` page (February 2026 shape: `items[].item`, formerly `items[].track`).
 *
 * Fails closed: an entry whose item cannot be read makes the whole page invalid, because guessing could let Deckify add a duplicate.
 * Entries whose item is `null` (unavailable content) are skipped.
 * @param body Parsed body.
 * @returns The URIs on the page.
 */
export function parsePlaylistItemsPage(body: unknown): PlaylistItemsPage {
	if (!isRecord(body) || !Array.isArray(body.items)) {
		throw new SpotifyInvalidResponseError("playlist items page had no items");
	}
	const uris: string[] = [];
	let empty = 0;
	for (const entry of body.items) {
		if (entry === null) {
			continue;
		}
		if (!isRecord(entry)) {
			throw new SpotifyInvalidResponseError("playlist item was malformed");
		}
		if (Object.keys(entry).length === 0) {
			// Field filtering can drop a `null` item entirely; an empty entry is an unavailable item.
			empty++;
			continue;
		}
		const item = "item" in entry ? entry.item : entry.track;
		if (item === null) {
			continue;
		}
		if (!isRecord(item) || typeof item.uri !== "string" || item.uri.length === 0 || item.uri.length > 300) {
			throw new SpotifyInvalidResponseError("playlist item had no URI");
		}
		uris.push(item.uri);
	}
	if (empty > 0 && uris.length === 0 && empty === body.items.filter((entry) => entry !== null).length) {
		// Every entry empty: the response format is not understood, so duplicates could not be detected.
		throw new SpotifyInvalidResponseError("playlist items had no readable entries");
	}
	return { uris, entryCount: body.items.length, total: toCount(body.total) };
}

/**
 * Reads the new snapshot ID from a `POST /v1/playlists/{id}/items` response.
 * @param body Parsed body.
 * @returns The snapshot ID, when present.
 */
export function parseSnapshotResponse(body: unknown): string | undefined {
	return isRecord(body) ? shortString(body.snapshot_id, 500) : undefined;
}

function shortString(value: unknown, max: number): string | undefined {
	return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

function toCount(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
