import type streamDeck from "@elgato/streamdeck";

/**
 * JSON object type used by the Stream Deck SDK for settings, derived from the SDK itself rather than importing its transitive dependency.
 */
export type JsonObject = Awaited<ReturnType<typeof streamDeck.settings.getGlobalSettings>>;
