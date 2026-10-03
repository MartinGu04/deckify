import { SpotifyError } from "../spotify/errors";

/** The current item cannot be liked: only Spotify tracks can (not episodes, ads, local files or unknown items), or nothing is playing. */
export class LibraryItemUnsupportedError extends SpotifyError {
	constructor(message = "Only Spotify songs can be added to Liked Songs.") {
		super("library-unsupported-item", message);
	}
}
