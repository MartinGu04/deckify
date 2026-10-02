import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { ActionUUID } from "../identifiers";
import type { PlaybackSnapshot } from "../playback/state";
import { renderNowPlayingSvg, toSvgDataUri } from "./now-playing-render";
import { PlaybackKeyAction, type RenderedKey } from "./playback-key-action";

/**
 * "Now Playing": shows the current title and artist (or show), a play/pause indicator and progress. Display-focused: a press only requests a
 * fresh state read.
 */
@action({ UUID: ActionUUID.NowPlaying })
export class NowPlayingAction extends PlaybackKeyAction {
	/** @inheritdoc */
	protected override view(snapshot: PlaybackSnapshot): RenderedKey {
		return { image: toSvgDataUri(renderNowPlayingSvg(snapshot)), title: "" };
	}

	/**
	 * Refreshes the playback state; alerts when Spotify is not connected.
	 * @param ev The event.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		if (this.playback.state.value.availability === "signed-out") {
			await ev.action.showAlert();
			return;
		}
		await this.playback.refresh();
	}
}
