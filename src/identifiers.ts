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
	SpotifyAccount: `${PLUGIN_UUID}.spotify.account`,
	PlayPause: `${PLUGIN_UUID}.spotify.play-pause`,
	Next: `${PLUGIN_UUID}.spotify.next`,
	Previous: `${PLUGIN_UUID}.spotify.previous`,
	NowPlaying: `${PLUGIN_UUID}.spotify.now-playing`,
	VolumeUp: `${PLUGIN_UUID}.spotify.volume-up`,
	VolumeDown: `${PLUGIN_UUID}.spotify.volume-down`,
	Mute: `${PLUGIN_UUID}.spotify.mute`,
	Like: `${PLUGIN_UUID}.spotify.like`,
	AddToPlaylist: `${PLUGIN_UUID}.spotify.add-to-playlist`,
	PlayPlaylist: `${PLUGIN_UUID}.spotify.play-playlist`,
} as const;
