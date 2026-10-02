import streamDeck from "@elgato/streamdeck";

import type { JsonObject } from "../shared/sdk-types";

/**
 * Deckify's plugin-wide Stream Deck settings. Only non-sensitive values belong here: Stream Deck stores them unencrypted.
 * Tokens are never stored in settings (see `src/spotify/storage`).
 */
export type DeckifyGlobalSettings = {
	/** Spotify Client ID (public identifier). There is intentionally no Client Secret setting. */
	spotifyClientId?: string;
};

/**
 * Reads the global settings, ignoring unexpected values.
 * @returns The settings.
 */
export async function loadGlobalSettings(): Promise<DeckifyGlobalSettings> {
	const raw = await streamDeck.settings.getGlobalSettings();
	return typeof raw.spotifyClientId === "string" ? { spotifyClientId: raw.spotifyClientId } : {};
}

/**
 * Saves (or removes) the Spotify Client ID, keeping any other global settings.
 * @param clientId Client ID; `undefined` removes it.
 */
export async function saveSpotifyClientId(clientId: string | undefined): Promise<void> {
	const settings: JsonObject = { ...(await streamDeck.settings.getGlobalSettings()) };
	delete settings.spotifyClientId;
	if (clientId !== undefined) {
		settings.spotifyClientId = clientId;
	}
	await streamDeck.settings.setGlobalSettings(settings);
}
