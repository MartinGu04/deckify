import { SpotifyError } from "../spotify/errors";

/**
 * Playback is unavailable because Spotify is not connected (or needs reauthorization). Raised before any request is sent; OAuth is never
 * started from a playback key.
 */
export class PlaybackUnavailableError extends SpotifyError {
	constructor(message: string) {
		super("playback-unavailable", message);
	}
}
