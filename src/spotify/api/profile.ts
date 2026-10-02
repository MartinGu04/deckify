import { SpotifyInvalidResponseError } from "../errors";
import { isRecord } from "../http";
import type { SpotifyApiClient } from "./client";

/**
 * The parts of the Spotify user profile Deckify uses.
 */
export type SpotifyProfile = {
	readonly id: string;

	/** Display name; falls back to the user ID when the account has none. */
	readonly displayName: string;

	/** Subscription level (e.g. "premium"), when Spotify reports it. */
	readonly product: string | undefined;
};

/**
 * Fetches the current user's profile (`GET /v1/me`).
 * @param client Authenticated API client.
 * @returns The validated profile.
 */
export async function fetchCurrentUserProfile(client: SpotifyApiClient): Promise<SpotifyProfile> {
	return parseProfile(await client.get("/me"));
}

/**
 * Validates a `GET /v1/me` response.
 * @param body Response body.
 * @returns The profile.
 */
export function parseProfile(body: unknown): SpotifyProfile {
	if (!isRecord(body)) {
		throw new SpotifyInvalidResponseError("profile was not a JSON object");
	}
	const { id, display_name: displayName, product } = body;
	if (typeof id !== "string" || id.trim().length === 0) {
		throw new SpotifyInvalidResponseError("profile did not include a user ID");
	}
	if (displayName !== undefined && displayName !== null && typeof displayName !== "string") {
		throw new SpotifyInvalidResponseError("profile display name was invalid");
	}

	const name = typeof displayName === "string" ? displayName.trim() : "";
	return {
		id,
		displayName: (name.length > 0 ? name : id).slice(0, 100),
		product: typeof product === "string" ? product : undefined,
	};
}
