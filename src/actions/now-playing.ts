import { action, type KeyDownEvent } from "@elgato/streamdeck";

import { ActionUUID } from "../identifiers";
import type { PlaybackSnapshot } from "../playback/state";
import { spotifyItemUrl } from "../spotify/links";
import { renderNowPlayingSvg, toSvgDataUri } from "./now-playing-render";
import { PlaybackKeyAction, type PlaybackActionOptions, type RenderedKey } from "./playback-key-action";

/**
 * Dependencies of {@link NowPlayingAction}.
 */
export type NowPlayingActionOptions = PlaybackActionOptions & {
	/** Opens a link in the user's browser (or the Spotify app, if it handles Spotify links). */
	readonly openUrl: (url: string) => Promise<void>;
	/** Spotify's official icon as a data URI, shown next to Spotify metadata; `undefined` only when it could not be loaded. */
	readonly spotifyIcon: string | undefined;
};

/**
 * "Now Playing": shows the current title and artist (or show) with Spotify's icon, a play/pause indicator and progress. A press opens the
 * current song or episode on Spotify (Spotify's metadata must link back to Spotify) and requests a fresh state read.
 */
@action({ UUID: ActionUUID.NowPlaying })
export class NowPlayingAction extends PlaybackKeyAction {
	readonly #openUrl: (url: string) => Promise<void>;
	readonly #spotifyIcon: string | undefined;

	/**
	 * Initializes a new instance of the {@link NowPlayingAction} class.
	 * @param options Dependencies.
	 */
	constructor(options: NowPlayingActionOptions) {
		super(options);
		this.#openUrl = options.openUrl;
		this.#spotifyIcon = options.spotifyIcon;
	}

	/** @inheritdoc */
	protected override view(snapshot: PlaybackSnapshot): RenderedKey {
		return { image: toSvgDataUri(renderNowPlayingSvg(snapshot, this.#spotifyIcon)), title: "" };
	}

	/**
	 * Opens the item shown on the key in Spotify, when it has a Spotify link (songs and episodes; not ads or local files), then refreshes the
	 * playback state. Alerts when Spotify is not connected.
	 * @param ev The event.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const snapshot = this.playback.state.value;
		if (snapshot.availability === "signed-out") {
			await ev.action.showAlert();
			return;
		}
		const url = snapshot.availability === "active" ? spotifyItemUrl(snapshot.item?.uri) : undefined;
		if (url !== undefined) {
			try {
				await this.#openUrl(url);
			} catch {
				this.logger.warn("Opening the current item in Spotify failed.");
				await ev.action.showAlert().catch(() => undefined);
			}
		}
		await this.playback.refresh();
	}
}
