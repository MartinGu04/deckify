/**
 * Stable identifiers for Deckify.
 *
 * These values are published in `manifest.json` and stored in users' Stream Deck profiles. They must never change once released, otherwise existing keys
 * stop resolving to their actions.
 */
export const PLUGIN_UUID = "com.marting.deckify";

/**
 * Action UUIDs; each must match the corresponding `Actions[].UUID` entry in `manifest.json`.
 */
export const ActionUUID = {
	Status: `${PLUGIN_UUID}.status`,
} as const;
