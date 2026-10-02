import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { ActionUUID } from "../identifiers";
import type { PlaybackSnapshot } from "../playback/state";
import { PlaybackKeyAction, type RenderedKey } from "./playback-key-action";
import { playPauseView } from "./playback-views";

/**
 * "Play / Pause": shows the shared playback state and toggles it. The icon flips as soon as Spotify accepts the command and is then
 * reconciled with a fresh state read.
 */
@action({ UUID: ActionUUID.PlayPause })
export class PlayPauseAction extends PlaybackKeyAction {
	/** @inheritdoc */
	protected override view(snapshot: PlaybackSnapshot): RenderedKey {
		return playPauseView(snapshot);
	}

	/**
	 * Toggles playback.
	 * @param ev The event.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		await this.runCommand(ev, () => this.playback.togglePlayPause());
	}
}
