import { isLibraryTrackUri } from "../../library/state";
import type { LibraryTransport } from "../../library/transport";
import type { SpotifyApiClient } from "../api/client";
import { SpotifyInvalidResponseError } from "../errors";

/**
 * Spotify's generic library endpoints (introduced in February 2026; they replace the deprecated `/me/tracks` endpoints, which Deckify never
 * uses). Items are identified by Spotify URI, sent only as an encoded query parameter:
 *
 * - `GET /v1/me/library/contains?uris=<uri>` — whether it is saved (scope `user-library-read`)
 * - `PUT /v1/me/library?uris=<uri>` — save / like (scope `user-library-modify`)
 * - `DELETE /v1/me/library?uris=<uri>` — remove / unlike (scope `user-library-modify`)
 *
 * Only `spotify:track:` URIs are accepted. Authentication (token refresh, one retry on 401) is handled by the shared {@link SpotifyApiClient}.
 */
export class SpotifyWebApiLibrary implements LibraryTransport {
	readonly id = "spotify-web-api-library";

	/**
	 * Initializes a new instance of the {@link SpotifyWebApiLibrary} class.
	 * @param api Authenticated Web API client.
	 */
	constructor(private readonly api: SpotifyApiClient) {}

	/** @inheritdoc */
	async contains(trackUri: string): Promise<boolean> {
		const response = await this.api.request("GET", `/me/library/contains?uris=${encodeTrackUri(trackUri)}`);
		return parseLibraryContains(response.body);
	}

	/** @inheritdoc */
	async save(trackUri: string): Promise<void> {
		await this.api.request("PUT", `/me/library?uris=${encodeTrackUri(trackUri)}`);
	}

	/** @inheritdoc */
	async remove(trackUri: string): Promise<void> {
		await this.api.request("DELETE", `/me/library?uris=${encodeTrackUri(trackUri)}`);
	}
}

/**
 * Validates and encodes a track URI for a query parameter.
 * @param trackUri Spotify track URI.
 * @returns The URL-encoded URI.
 */
function encodeTrackUri(trackUri: string): string {
	if (!isLibraryTrackUri(trackUri)) {
		throw new RangeError("Only Spotify track URIs can be sent to the library endpoints.");
	}
	return encodeURIComponent(trackUri);
}

/**
 * Parses a `GET /v1/me/library/contains` response for one URI: a JSON array with one boolean.
 * @param body Parsed body.
 * @returns Whether the item is saved.
 */
export function parseLibraryContains(body: unknown): boolean {
	if (Array.isArray(body) && body.length === 1 && typeof body[0] === "boolean") {
		return body[0];
	}
	throw new SpotifyInvalidResponseError("library check was not a single true/false value");
}
