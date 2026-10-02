import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { ActionUUID } from "../identifiers";
import type { PlaybackSnapshot } from "../playback/state";
import { PlaybackKeyAction, type RenderedKey } from "./playback-key-action";
import { muteView, volumeView } from "./playback-views";
import { normalizeVolumeStep } from "./volume-settings";

/**
 * "Volume Up": raises the active Spotify device's volume by the key's step (default 10%). Shows the device volume. Rapid presses all count.
 */
@action({ UUID: ActionUUID.VolumeUp })
export class VolumeUpAction extends PlaybackKeyAction {
	/** @inheritdoc */
	protected override view(snapshot: PlaybackSnapshot): RenderedKey {
		return volumeView("up", snapshot);
	}

	/**
	 * Raises the volume.
	 * @param ev The event.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const step = normalizeVolumeStep(ev.payload.settings.volumeStep);
		await this.runCommand(ev, () => this.playback.adjustVolume(step));
	}
}

/**
 * "Volume Down": lowers the active Spotify device's volume by the key's step (default 10%). Shows the device volume.
 */
@action({ UUID: ActionUUID.VolumeDown })
export class VolumeDownAction extends PlaybackKeyAction {
	/** @inheritdoc */
	protected override view(snapshot: PlaybackSnapshot): RenderedKey {
		return volumeView("down", snapshot);
	}

	/**
	 * Lowers the volume.
	 * @param ev The event.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const step = normalizeVolumeStep(ev.payload.settings.volumeStep);
		await this.runCommand(ev, () => this.playback.adjustVolume(-step));
	}
}

/**
 * "Mute / Unmute": sets the active Spotify device's volume to 0, or back to the last non-zero volume (50% when none is known). The icon follows
 * the real device volume.
 */
@action({ UUID: ActionUUID.Mute })
export class MuteAction extends PlaybackKeyAction {
	/** @inheritdoc */
	protected override view(snapshot: PlaybackSnapshot): RenderedKey {
		return muteView(snapshot);
	}

	/**
	 * Mutes or unmutes.
	 * @param ev The event.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		await this.runCommand(ev, () => this.playback.toggleMute());
	}
}
