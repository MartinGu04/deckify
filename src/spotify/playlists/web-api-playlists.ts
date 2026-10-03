import { isPlaylistId } from "../../playlists/model";
import type { PlaylistItemsPage, PlaylistListPage, PlaylistTransport } from "../../playlists/transport";
import { isLibraryTrackUri } from "../../library/state";
import type { SpotifyApiClient } from "../api/client";
import { parsePlaylistItemsPage, parsePlaylistListPage, parsePlaylistMetadata, parseSnapshotResponse } from "./parse";
import type { PlaylistMetadata } from "../../playlists/model";

/** Spotify's maximum page size for these endpoints. */
const MAX_PAGE = 50;

/** Fields Deckify needs from a single playlist (no items, so no track metadata is downloaded). */
const PLAYLIST_FIELDS = "id,uri,name,public,collaborative,snapshot_id,owner(id,display_name),external_urls";

/** Only the item URIs and the total (no album / artist metadata). February 2026 naming: `items[].item`. */
const ITEM_FIELDS = "total,items(item(uri))";

/**
 * Spotify's playlist endpoints (February 2026 API). The deprecated `/playlists/{id}/tracks` endpoints are never used.
 *
 * - `GET /v1/me/playlists?limit=50&offset=N` — the current user's playlists (`playlist-read-private`, `playlist-read-collaborative`)
 * - `GET /v1/playlists/{id}?fields=…` — one playlist's current snapshot ID and ownership, before adding
 * - `GET /v1/playlists/{id}/items?limit=50&offset=N&fields=…` — item URIs for duplicate detection
 * - `POST /v1/playlists/{id}/items` with `{ "uris": ["spotify:track:…"] }` — append the current track (`playlist-modify-public` / `-private`)
 *
 * Playlist IDs and track URIs are validated before every request. Authentication is handled by the shared {@link SpotifyApiClient}.
 */
export class SpotifyWebApiPlaylists implements PlaylistTransport {
	readonly id = "spotify-web-api-playlists";

	/**
	 * Initializes a new instance of the {@link SpotifyWebApiPlaylists} class.
	 * @param api Authenticated Web API client.
	 */
	constructor(private readonly api: SpotifyApiClient) {}

	/** @inheritdoc */
	async listPlaylists(offset: number, limit: number): Promise<PlaylistListPage> {
		const query = new URLSearchParams({ limit: String(pageSize(limit)), offset: String(pageOffset(offset)) });
		const response = await this.api.request("GET", `/me/playlists?${query.toString()}`);
		return parsePlaylistListPage(response.body);
	}

	/** @inheritdoc */
	async getPlaylist(playlistId: string): Promise<PlaylistMetadata> {
		const query = new URLSearchParams({ fields: PLAYLIST_FIELDS });
		const response = await this.api.request("GET", `/playlists/${checkedId(playlistId)}?${query.toString()}`);
		return parsePlaylistMetadata(response.body, playlistId);
	}

	/** @inheritdoc */
	async listItems(playlistId: string, offset: number, limit: number): Promise<PlaylistItemsPage> {
		const query = new URLSearchParams({ limit: String(pageSize(limit)), offset: String(pageOffset(offset)), fields: ITEM_FIELDS });
		const response = await this.api.request("GET", `/playlists/${checkedId(playlistId)}/items?${query.toString()}`);
		return parsePlaylistItemsPage(response.body);
	}

	/** @inheritdoc */
	async addItem(playlistId: string, trackUri: string): Promise<{ snapshotId: string | undefined }> {
		if (!isLibraryTrackUri(trackUri)) {
			throw new RangeError("Only Spotify track URIs can be added to a playlist.");
		}
		const response = await this.api.request("POST", `/playlists/${checkedId(playlistId)}/items`, { uris: [trackUri] });
		return { snapshotId: parseSnapshotResponse(response.body) };
	}
}

function checkedId(playlistId: string): string {
	if (!isPlaylistId(playlistId)) {
		throw new RangeError("Invalid Spotify playlist ID.");
	}
	return playlistId;
}

function pageSize(limit: number): number {
	if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
		throw new RangeError("Page size must be 1 to 50.");
	}
	return limit;
}

function pageOffset(offset: number): number {
	if (!Number.isInteger(offset) || offset < 0) {
		throw new RangeError("Offset must be a non-negative integer.");
	}
	return offset;
}
