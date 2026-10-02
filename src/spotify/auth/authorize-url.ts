import { SPOTIFY_AUTHORIZE_URL, SPOTIFY_REDIRECT_URI } from "../config";
import { SPOTIFY_SCOPES } from "./scopes";

/**
 * Builds the Spotify authorization URL for the Authorization Code flow with PKCE.
 * @param options Request options.
 * @param options.clientId Spotify Client ID.
 * @param options.codeChallenge S256 code challenge.
 * @param options.state OAuth state value.
 * @returns The URL to open in the user's browser.
 */
export function buildAuthorizationUrl(options: { clientId: string; codeChallenge: string; state: string }): string {
	const url = new URL(SPOTIFY_AUTHORIZE_URL);
	url.search = new URLSearchParams({
		client_id: options.clientId,
		response_type: "code",
		redirect_uri: SPOTIFY_REDIRECT_URI,
		code_challenge_method: "S256",
		code_challenge: options.codeChallenge,
		state: options.state,
		scope: SPOTIFY_SCOPES.join(" "),
	}).toString();
	return url.toString();
}
