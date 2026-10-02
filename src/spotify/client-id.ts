import { SPOTIFY_CLIENT_ID_PATTERN } from "./config";
import { SpotifyClientIdError } from "./errors";

/**
 * Normalizes a Spotify Client ID entered by the user.
 *
 * The Client ID is public (it appears in every authorization URL). Deckify never asks for, accepts or stores a Client Secret.
 * @param input Raw input.
 * @returns The trimmed Client ID; otherwise `undefined` when the input is empty (i.e. the user removed the Client ID).
 * @throws {SpotifyClientIdError} When the input is not a valid Client ID.
 */
export function normalizeClientId(input: unknown): string | undefined {
	if (input === undefined || input === null) {
		return undefined;
	}
	if (typeof input !== "string") {
		throw new SpotifyClientIdError("The Spotify Client ID must be text.");
	}
	const value = input.trim();
	if (value.length === 0) {
		return undefined;
	}
	if (!SPOTIFY_CLIENT_ID_PATTERN.test(value)) {
		throw new SpotifyClientIdError(
			"That does not look like a Spotify Client ID (32 letters and digits). Copy the Client ID from your app in the Spotify Developer Dashboard.",
		);
	}
	return value;
}
