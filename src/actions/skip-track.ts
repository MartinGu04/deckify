import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { ActionUUID } from "../identifiers";
import type { PlaybackSnapshot } from "../playback/state";
import { PlaybackKeyAction, type RenderedKey } from "./playback-key-action";
import { skipView } from "./playback-views";

/**
 * "Next Track": skips to the next item; Now Playing updates after Spotify reports the new item.
 */
@action({ UUID: ActionUUID.Next })
export class NextTrackAction extends PlaybackKeyAction {
	/** @inheritdoc */
	protected override view(snapshot: PlaybackSnapshot): RenderedKey {
		return skipView("next", snapshot);
	}

	/**
	 * Skips forward.
	 * @param ev The event.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		await this.runCommand(ev, () => this.playback.command("next"));
	}
}

/**
 * "Previous Track": skips to the previous item (Spotify may restart the current track instead, depending on progress).
 */
@action({ UUID: ActionUUID.Previous })
export class PreviousTrackAction extends PlaybackKeyAction {
	/** @inheritdoc */
	protected override view(snapshot: PlaybackSnapshot): RenderedKey {
		return skipView("previous", snapshot);
	}

	/**
	 * Skips back.
	 * @param ev The event.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		await this.runCommand(ev, () => this.playback.command("previous"));
	}
}
