import { SPOTIFY_API_BASE_URL } from "../config";
import { sendRequest, toApiError, type HttpOptions, type HttpResult } from "../http";

/**
 * Supplies access tokens to the API client.
 */
export interface AccessTokenProvider {
	/** Gets a valid access token, refreshing it first when it is about to expire. */
	getAccessToken(): Promise<string>;

	/** Forces a refresh, e.g. after Spotify rejected the current token with HTTP 401. */
	refreshAccessToken(): Promise<string>;
}

/** HTTP methods used with the Web API. */
export type ApiMethod = "GET" | "PUT" | "POST" | "DELETE";

/**
 * A successful Web API response.
 */
export type ApiResponse = {
	/** 2xx status, e.g. 200, or 204 when there is no content. */
	readonly status: number;

	/** Parsed JSON body; `undefined` for empty bodies (e.g. 204). */
	readonly body: unknown;
};

/**
 * Minimal authenticated Spotify Web API client.
 *
 * On HTTP 401 the access token is refreshed once and the request retried once; it never loops. Other failures (including 403 and 429) are
 * surfaced as typed errors without retrying.
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
		return (await this.request("GET", path)).body;
	}

	/**
	 * Sends an authenticated request.
	 * @param method HTTP method.
	 * @param path Path (and query) relative to the Web API base URL, e.g. `/me/player/pause`.
	 * @param body Optional JSON body.
	 * @returns The successful response.
	 */
	async request(method: ApiMethod, path: string, body?: unknown): Promise<ApiResponse> {
		const url = `${SPOTIFY_API_BASE_URL}${path}`;
		const send = (accessToken: string): Promise<HttpResult> =>
			sendRequest(
				url,
				{
					method,
					headers: {
						Authorization: `Bearer ${accessToken}`,
						Accept: "application/json",
						...(body === undefined ? {} : { "Content-Type": "application/json" }),
					},
					body: body === undefined ? undefined : JSON.stringify(body),
				},
				this.http,
			);

		let result = await send(await this.tokens.getAccessToken());
		if (result.status === 401) {
			result = await send(await this.tokens.refreshAccessToken());
		}
		if (!result.ok) {
			throw toApiError(result);
		}
		return { status: result.status, body: result.body };
	}
}
