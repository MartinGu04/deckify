import { SpotifyError } from "../spotify/errors";

/** The key has no (valid) playlist selected. */
export class PlaylistNotSelectedError extends SpotifyError {
	constructor() {
		super("playlist-not-selected", "Choose a playlist for this key in its Property Inspector.");
	}
}

/** The selected playlist no longer exists or is no longer in the user's library. */
export class PlaylistUnavailableError extends SpotifyError {
	constructor() {
		super("playlist-unavailable", "The selected playlist is no longer available. Choose another playlist for this key.");
	}
}

/** The selected playlist can no longer be changed by this user (not owned, not collaborative). */
export class PlaylistNotWritableError extends SpotifyError {
	constructor() {
		super("playlist-not-writable", "Deckify can no longer add to the selected playlist. Choose one of your own or a collaborative playlist.");
	}
}
