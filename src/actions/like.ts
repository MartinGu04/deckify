import { action, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import { ActionUUID } from "../identifiers";
import type { LibraryService } from "../library/service";
import type { PlaybackSnapshot } from "../playback/state";
import { SpotifyError } from "../spotify/errors";
import { likeView } from "./like-view";
import { PlaybackKeyAction, type PlaybackActionOptions, type RenderedKey } from "./playback-key-action";

/**
 * Dependencies of {@link LikeAction}.
 */
export type LikeActionOptions = PlaybackActionOptions & {
	readonly library: LibraryService;
};

/**
 * "Like / Unlike": shows whether the current Spotify track is in Liked Songs and toggles it. Songs only: episodes, ads and local files are
 * never added.
 */
@action({ UUID: ActionUUID.Like })
export class LikeAction extends PlaybackKeyAction {
	readonly #library: LibraryService;

	/**
	 * Initializes a new instance of the {@link LikeAction} class.
	 * @param options Dependencies.
	 */
	constructor(options: LikeActionOptions) {
		super(options);
		this.#library = options.library;
		this.#library.state.subscribe(() => {
			void this.rerender();
		});
	}

	/** @inheritdoc */
	protected override view(snapshot: PlaybackSnapshot): RenderedKey {
		return likeView(snapshot, this.#library.state.value);
	}

	/**
	 * Registers the key with the playback and library services.
	 * @param ev The event.
	 */
	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		this.#library.addViewer(ev.action.id);
		await super.onWillAppear(ev);
	}

	/**
	 * Unregisters the key.
	 * @param ev The event.
	 */
	override onWillDisappear(ev: WillDisappearEvent): void {
		this.#library.removeViewer(ev.action.id);
		super.onWillDisappear(ev);
	}

	/**
	 * Likes or unlikes the current track; alerts when that is not possible. Never starts OAuth.
	 * @param ev The event.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		try {
			await this.#library.toggle();
		} catch (err) {
			// Only the error type: Spotify's error text could echo request details such as the track URI.
			const reason = err instanceof SpotifyError ? err.code : "unexpected error";
			this.logger.info(`Like / Unlike not performed (${reason}).`);
			await ev.action.showAlert().catch(() => undefined);
		}
	}
}
