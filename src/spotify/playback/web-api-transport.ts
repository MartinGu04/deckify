import type { PlaybackObservation } from "../../playback/model";
import type { PlaybackTransport } from "../../playback/transport";
import { playlistIdFromUri } from "../../playlists/model";
import type { SpotifyApiClient } from "../api/client";
import { parsePlaybackState } from "./parse";

/**
 * Playback state request. `additional_types=episode` is required for Spotify to include podcast episodes as the current item.
 */
const PLAYER_STATE_PATH = "/me/player?additional_types=track,episode";

/**
 * Phase 3 playback backend: the Spotify Web API, targeting the user's currently active device (no `device_id`).
 *
 * - `GET /v1/me/player` — playback state
 * - `PUT /v1/me/player/play` — start/resume
 * - `PUT /v1/me/player/pause` — pause
 * - `POST /v1/me/player/next` — next item
 * - `POST /v1/me/player/previous` — previous item
 * - `PUT /v1/me/player/volume?volume_percent=N` — device volume (Spotify's own volume, for local and remote devices alike)
 * - `PUT /v1/me/player/play` with `{ "context_uri": "spotify:playlist:…" }` — start a playlist on the active device
 *
 * Authentication (token refresh, one retry on 401) is handled by the shared {@link SpotifyApiClient}.
 */
export class SpotifyWebApiTransport implements PlaybackTransport {
	readonly id = "spotify-web-api";

	/**
	 * Initializes a new instance of the {@link SpotifyWebApiTransport} class.
	 * @param api Authenticated Web API client.
	 */
	constructor(private readonly api: SpotifyApiClient) {}

	/** @inheritdoc */
	async getState(): Promise<PlaybackObservation> {
		const response = await this.api.request("GET", PLAYER_STATE_PATH);
		return parsePlaybackState(response.status, response.body);
	}

	/** @inheritdoc */
	async play(): Promise<void> {
		await this.api.request("PUT", "/me/player/play");
	}

	/** @inheritdoc */
	async pause(): Promise<void> {
		await this.api.request("PUT", "/me/player/pause");
	}

	/** @inheritdoc */
	async next(): Promise<void> {
		await this.api.request("POST", "/me/player/next");
	}

	/** @inheritdoc */
	async previous(): Promise<void> {
		await this.api.request("POST", "/me/player/previous");
	}

	/** @inheritdoc */
	async setVolume(volumePercent: number): Promise<void> {
		if (!Number.isInteger(volumePercent) || volumePercent < 0 || volumePercent > 100) {
			throw new RangeError("Volume must be a whole percent from 0 to 100.");
		}
		await this.api.request("PUT", `/me/player/volume?volume_percent=${String(volumePercent)}`);
	}

	/** @inheritdoc */
	async playContext(contextUri: string): Promise<void> {
		if (playlistIdFromUri(contextUri) === undefined) {
			throw new RangeError("Only Spotify playlist URIs can be played as a context.");
		}
		await this.api.request("PUT", "/me/player/play", { context_uri: contextUri });
	}
}
