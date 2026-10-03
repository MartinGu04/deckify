import { action, type KeyDownEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import { ActionUUID } from "../identifiers";
import type { LibraryService } from "../library/service";
import type { PlaybackSnapshot } from "../playback/state";
import { SpotifyError } from "../spotify/errors";
import { likeView, type LikeFeedback } from "./like-view";
import { PlaybackKeyAction, type PlaybackActionOptions, type RenderedKey } from "./playback-key-action";

/**
 * Dependencies of {@link LikeAction}.
 */
export type LikeActionOptions = PlaybackActionOptions & {
	readonly library: LibraryService;
	/** How long press feedback ("Added", "Removed") stays on the key. */
	readonly feedbackMs?: number;
};

/**
 * "Like / Unlike": shows whether the current Spotify track is in Liked Songs and toggles it. Songs only: episodes, ads and local files are
 * never added.
 */
@action({ UUID: ActionUUID.Like })
export class LikeAction extends PlaybackKeyAction {
	readonly #library: LibraryService;
	readonly #feedbackMs: number;
	readonly #feedback = new Map<string, { readonly text: LikeFeedback; readonly timer: NodeJS.Timeout }>();

	/**
	 * Initializes a new instance of the {@link LikeAction} class.
	 * @param options Dependencies.
	 */
	constructor(options: LikeActionOptions) {
		super(options);
		this.#library = options.library;
		this.#feedbackMs = options.feedbackMs ?? 1_500;
		this.#library.state.subscribe(() => {
			void this.rerender();
		});
	}

	/** @inheritdoc */
	protected override view(snapshot: PlaybackSnapshot, keyId: string): RenderedKey {
		return likeView(snapshot, this.#library.state.value, this.#feedback.get(keyId)?.text);
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
		this.#clearFeedback(ev.action.id);
		super.onWillDisappear(ev);
	}

	/**
	 * Likes or unlikes the current track, briefly showing Added / Removed; alerts when that is not possible. Never starts OAuth.
	 * @param ev The event.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		try {
			const outcome = await this.#library.toggle();
			if (outcome !== "busy") {
				await this.#showFeedback(ev.action.id, outcome);
			}
		} catch (err) {
			// Only the error type: Spotify's error text could echo request details such as the track URI.
			const reason = err instanceof SpotifyError ? err.code : "unexpected error";
			this.logger.info(`Like / Unlike not performed (${reason}).`);
			await ev.action.showAlert().catch(() => undefined);
		}
	}

	/**
	 * Shows Added / Removed on the pressed key for a moment, then the normal title again. Only a timer: nothing is requested from Spotify.
	 * @param keyId Key.
	 * @param text Feedback.
	 */
	async #showFeedback(keyId: string, text: LikeFeedback): Promise<void> {
		this.#clearFeedback(keyId);
		const timer = setTimeout(() => {
			this.#feedback.delete(keyId);
			void this.rerender();
		}, this.#feedbackMs);
		this.#feedback.set(keyId, { text, timer });
		await this.rerender();
	}

	/**
	 * Drops a key's pending feedback.
	 * @param keyId Key.
	 */
	#clearFeedback(keyId: string): void {
		const previous = this.#feedback.get(keyId);
		if (previous !== undefined) {
			clearTimeout(previous.timer);
			this.#feedback.delete(keyId);
		}
	}
}
