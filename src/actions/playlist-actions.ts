import { action } from "@elgato/streamdeck";

import { ActionUUID } from "../identifiers";
import { LibraryItemUnsupportedError } from "../library/errors";
import { classifyLibraryItem } from "../library/state";
import type { PlaylistSelection } from "../playlists/selection";
import { PlaylistKeyAction } from "./playlist-key-action";
import type { PlaylistPickerMode } from "./playlist-inspector";
import { addToPlaylistView, playPlaylistView, type PlaylistKeyContext } from "./playlist-views";
import type { KeyView } from "./playback-views";

/**
 * "Add to Playlist": adds the current Spotify song to this key's playlist (one of the user's own or collaborative playlists), unless it is
 * already there. The song is captured at the moment of the press.
 */
@action({ UUID: ActionUUID.AddToPlaylist })
export class AddToPlaylistAction extends PlaylistKeyAction {
	protected override readonly mode: PlaylistPickerMode = "add";

	/** @inheritdoc */
	protected override view(ctx: PlaylistKeyContext): KeyView {
		return addToPlaylistView(ctx);
	}

	/** @inheritdoc */
	protected override async press(selection: PlaylistSelection | undefined): Promise<string | undefined> {
		// Capture the song now: if the next one starts before Spotify answers, this one is still the one added.
		const { kind, uri } = classifyLibraryItem(this.playback.state.value);
		if (kind !== "track") {
			throw new LibraryItemUnsupportedError("Only Spotify songs can be added to a playlist.");
		}
		const outcome = await this.playlists.addTrack(selection, uri);
		switch (outcome) {
			case "added":
				return "Added";
			case "already-present":
				return "Already\nAdded";
			case "busy":
				return undefined;
		}
	}
}

/**
 * "Play Playlist": starts this key's playlist on the active Spotify device.
 */
@action({ UUID: ActionUUID.PlayPlaylist })
export class PlayPlaylistAction extends PlaylistKeyAction {
	protected override readonly mode: PlaylistPickerMode = "play";

	/** @inheritdoc */
	protected override view(ctx: PlaylistKeyContext): KeyView {
		return playPlaylistView(ctx);
	}

	/** @inheritdoc */
	protected override async press(selection: PlaylistSelection | undefined): Promise<string | undefined> {
		const outcome = await this.playlists.play(selection);
		return outcome === "done" ? "Started" : undefined;
	}
}
