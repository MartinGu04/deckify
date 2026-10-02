import { type KeyAction, type KeyDownEvent, SingletonAction, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import type { CommandOutcome, PlaybackService } from "../playback/service";
import type { PlaybackSnapshot } from "../playback/state";
import { silentLogger, type Logger } from "../shared/logger";
import type { JsonObject } from "../shared/sdk-types";
import { describeError } from "../spotify/errors";

/**
 * Dependencies shared by playback actions.
 */
export type PlaybackActionOptions = {
	readonly playback: PlaybackService;
	readonly logger?: Logger;
};

/**
 * Rendered content of a key: an image (plugin-relative path or data URI) and a title.
 */
export type RenderedKey = {
	readonly image: string;
	readonly title: string;
};

/**
 * Base class for keys that observe the shared playback state.
 *
 * Keys never poll Spotify themselves: they register as viewers of the single {@link PlaybackService} while visible, and re-render whenever
 * its state changes. Unchanged renders are not re-sent to Stream Deck.
 */
export abstract class PlaybackKeyAction extends SingletonAction {
	protected readonly playback: PlaybackService;
	protected readonly logger: Logger;
	readonly #lastRender = new Map<string, string>();

	/**
	 * Initializes a new instance of the {@link PlaybackKeyAction} class.
	 * @param options Dependencies.
	 */
	constructor(options: PlaybackActionOptions) {
		super();
		this.playback = options.playback;
		this.logger = options.logger ?? silentLogger;
		this.playback.state.subscribe((snapshot) => {
			void this.#renderAll(snapshot);
		});
	}

	/**
	 * Builds the key content for a state.
	 * @param snapshot Playback state.
	 * @returns The content.
	 */
	protected abstract view(snapshot: PlaybackSnapshot): RenderedKey;

	/**
	 * Registers the key as a viewer (starting shared polling if needed) and renders it.
	 * @param ev The event.
	 */
	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		this.playback.addViewer(ev.action.id);
		if (ev.action.isKey()) {
			await this.#render(ev.action, this.playback.state.value);
		}
	}

	/**
	 * Unregisters the key; polling stops when no playback key is visible.
	 * @param ev The event.
	 */
	override onWillDisappear(ev: WillDisappearEvent): void {
		this.playback.removeViewer(ev.action.id);
		this.#lastRender.delete(ev.action.id);
	}

	/**
	 * Runs a playback command for a key press, with native feedback: an alert when the command is not possible or fails. Never starts OAuth.
	 * @param ev Key event.
	 * @param run Command to run.
	 * @param options Options.
	 * @param options.showOk Show the success check mark.
	 */
	protected async runCommand(ev: KeyDownEvent, run: () => Promise<CommandOutcome>, options: { showOk?: boolean } = {}): Promise<void> {
		try {
			const outcome = await run();
			if (outcome === "done" && options.showOk) {
				await ev.action.showOk();
			}
		} catch (err) {
			this.logger.info(`Playback command not performed: ${describeError(err)}`);
			await ev.action.showAlert().catch(() => undefined);
		}
	}

	/**
	 * Re-renders every visible instance with the current playback state, e.g. when another state source the view depends on changed.
	 * @returns Promise resolved when rendered.
	 */
	protected rerender(): Promise<void> {
		return this.#renderAll(this.playback.state.value);
	}

	/**
	 * Re-renders every visible instance of this action.
	 * @param snapshot Playback state.
	 */
	async #renderAll(snapshot: PlaybackSnapshot): Promise<void> {
		const renders: Promise<void>[] = [];
		for (const instance of this.actions) {
			if (instance.isKey()) {
				renders.push(this.#render(instance, snapshot));
			}
		}
		await Promise.all(renders);
	}

	/**
	 * Renders one key, skipping the update when nothing changed.
	 * @param key Key.
	 * @param snapshot Playback state.
	 */
	async #render(key: KeyAction<JsonObject>, snapshot: PlaybackSnapshot): Promise<void> {
		const { image, title } = this.view(snapshot);
		const signature = `${image}\u0000${title}`;
		if (this.#lastRender.get(key.id) === signature) {
			return;
		}
		this.#lastRender.set(key.id, signature);
		try {
			await Promise.all([key.setImage(image), key.setTitle(title)]);
		} catch (err) {
			this.#lastRender.delete(key.id);
			this.logger.error("Failed to render playback key.", err);
		}
	}
}
