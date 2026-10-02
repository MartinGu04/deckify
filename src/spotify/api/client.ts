import { SPOTIFY_API_BASE_URL } from "../config";
import { sendRequest, toApiError, type HttpOptions } from "../http";

/**
 * Supplies access tokens to the API client.
 */
export interface AccessTokenProvider {
	/** Gets a valid access token, refreshing it first when it is about to expire. */
	getAccessToken(): Promise<string>;

	/** Forces a refresh, e.g. after Spotify rejected the current token with HTTP 401. */
	refreshAccessToken(): Promise<string>;
}

/**
 * Minimal authenticated Spotify Web API client.
 *
 * On HTTP 401 the access token is refreshed once and the request retried once; it never loops. HTTP 403 and 429 are surfaced as typed errors
 * without retrying.
 */
export class SpotifyApiClient {
	/**
	 * Initializes a new instance of the {@link SpotifyApiClient} class.
	 * @param tokens Access token provider.
	 * @param http HTTP options.
	 */
	constructor(
		private readonly tokens: AccessTokenProvider,
		private readonly http: HttpOptions = {},
	) {}

	/**
	 * Sends an authenticated GET request.
	 * @param path Path relative to the Web API base URL, e.g. `/me`.
	 * @returns The parsed JSON body.
	 */
	async get(path: string): Promise<unknown> {
		const url = `${SPOTIFY_API_BASE_URL}${path}`;
		const send = (accessToken: string): ReturnType<typeof sendRequest> =>
			sendRequest(url, { method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }, this.http);

		let result = await send(await this.tokens.getAccessToken());
		if (result.status === 401) {
			result = await send(await this.tokens.refreshAccessToken());
		}
		if (!result.ok) {
			throw toApiError(result);
		}
		return result.body;
	}
}
