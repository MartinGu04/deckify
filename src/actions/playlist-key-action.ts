import {
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type PropertyInspectorDidAppearEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";

import { toSpotifyPlaylistUrl } from "../playlists/model";
import type { PlaylistService } from "../playlists/service";
import { normalizePlaylistSelection, playlistSettings, type PlaylistSelection } from "../playlists/selection";
import type { PlaybackService } from "../playback/service";
import { silentLogger, type Logger } from "../shared/logger";
import type { JsonObject } from "../shared/sdk-types";
import { describeError, SpotifyError } from "../spotify/errors";
import { buildInspectorState, parsePlaylistInspectorRequest, type PlaylistPickerMode } from "./playlist-inspector";
import type { PlaylistKeyContext } from "./playlist-views";
import type { KeyView } from "./playback-views";

/** Event received from the Property Inspector (payload typed by the SDK as JSON). */
type InspectorMessageEvent = Parameters<NonNullable<SingletonAction["onSendToPlugin"]>>[0];

/**
 * How the plugin reaches the Property Inspector and the browser (injected so tests need no Stream Deck).
 */
export type PlaylistInspectorBridge = {
	/** The action instance whose Property Inspector is open, if any. */
	current(): { readonly id: string } | undefined;
	/** Sends a message to the open Property Inspector. */
	send(payload: JsonObject): Promise<void>;
	/** Opens a (validated) link in the default browser. */
	openUrl(url: string): Promise<void>;
};

/**
 * Dependencies of playlist keys.
 */
export type PlaylistActionOptions = {
	readonly playback: PlaybackService;
	readonly playlists: PlaylistService;
	readonly inspector: PlaylistInspectorBridge;
	readonly logger?: Logger;
	/** How long press feedback ("Added", "Started") stays on the key. */
	readonly feedbackMs?: number;
};

/**
 * Base class of the playlist keys. Each key keeps its own playlist selection (its Stream Deck settings: playlist ID and URI, plus a
 * display-only name cache), renders from the shared playback and playlist state, and serves the shared playlist picker.
 */
export abstract class PlaylistKeyAction extends SingletonAction {
	protected readonly playback: PlaybackService;
	protected readonly playlists: PlaylistService;
	protected readonly logger: Logger;
	readonly #inspector: PlaylistInspectorBridge;
	readonly #feedbackMs: number;

	readonly #selections = new Map<string, PlaylistSelection | undefined>();
	readonly #feedback = new Map<string, { readonly text: string; readonly timer: NodeJS.Timeout }>();
	readonly #lastRender = new Map<string, string>();

	/** Which playlists the picker offers. */
	protected abstract readonly mode: PlaylistPickerMode;

	/**
	 * Initializes a new instance of the {@link PlaylistKeyAction} class.
	 * @param options Dependencies.
	 */
	constructor(options: PlaylistActionOptions) {
		super();
		this.playback = options.playback;
		this.playlists = options.playlists;
		this.logger = options.logger ?? silentLogger;
		this.#inspector = options.inspector;
		this.#feedbackMs = options.feedbackMs ?? 1_500;
		this.playback.state.subscribe(() => {
			void this.#renderAll();
		});
		this.playlists.state.subscribe(() => {
			void this.#renderAll();
			void this.#syncNames();
			void this.#pushInspectorState();
		});
	}

	/**
	 * Builds the key content.
	 * @param ctx Context.
	 * @returns The view.
	 */
	protected abstract view(ctx: PlaylistKeyContext): KeyView;

	/**
	 * Runs the key's action.
	 * @param selection The key's playlist.
	 * @returns Feedback to show briefly; otherwise `undefined` (e.g. ignored while busy).
	 */
	protected abstract press(selection: PlaylistSelection | undefined): Promise<string | undefined>;

	/**
	 * Registers the key and renders it; loads the playlist list once if it was never loaded (no polling).
	 * @param ev The event.
	 */
	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		this.#selections.set(ev.action.id, normalizePlaylistSelection(ev.payload.settings));
		this.playback.addViewer(ev.action.id);
		this.#loadListOnce();
		if (ev.action.isKey()) {
			await this.#render(ev.action);
		}
	}

	/**
	 * Unregisters the key.
	 * @param ev The event.
	 */
	override onWillDisappear(ev: WillDisappearEvent): void {
		this.playback.removeViewer(ev.action.id);
		this.#selections.delete(ev.action.id);
		this.#lastRender.delete(ev.action.id);
		const feedback = this.#feedback.get(ev.action.id);
		if (feedback !== undefined) {
			clearTimeout(feedback.timer);
			this.#feedback.delete(ev.action.id);
		}
	}

	/**
	 * Picks up settings changed elsewhere (never trusted: validated again).
	 * @param ev The event.
	 */
	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent): Promise<void> {
		this.#selections.set(ev.action.id, normalizePlaylistSelection(ev.payload.settings));
		if (ev.action.isKey()) {
			await this.#render(ev.action);
		}
	}

	/**
	 * Sends the picker its state when the Property Inspector opens, then loads the playlists (cached for a few minutes).
	 * @param ev The event.
	 */
	override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent): Promise<void> {
		await this.#sendState(ev.action.id, null);
		await this.#loadAndSend(ev.action.id, null, false);
	}

	/**
	 * Handles picker requests.
	 * @param ev The event.
	 */
	override async onSendToPlugin(ev: InspectorMessageEvent): Promise<void> {
		const request = parsePlaylistInspectorRequest(ev.payload);
		if (request === undefined) {
			this.logger.warn("Ignored an invalid playlist picker message.");
			return;
		}
		const keyId = ev.action.id;
		switch (request.type) {
			case "deckify:playlist:list":
				await this.#loadAndSend(keyId, request.requestId, false);
				break;
			case "deckify:playlist:refresh":
				await this.#loadAndSend(keyId, request.requestId, true);
				break;
			case "deckify:playlist:select": {
				const lookup = this.playlists.lookup(request.playlistId);
				// Only a playlist from the current list, and (for Add) only a writable one; never matched by name.
				if (lookup.status !== "found" || (this.mode === "add" && !lookup.playlist.writable)) {
					await this.#sendState(keyId, request.requestId, "That playlist is not available. Refresh the list and choose again.");
					return;
				}
				const settings = playlistSettings(lookup.playlist.id, lookup.playlist.name);
				await ev.action.setSettings(settings);
				this.#selections.set(keyId, normalizePlaylistSelection(settings));
				await this.#renderAll();
				await this.#sendState(keyId, request.requestId);
				break;
			}
			case "deckify:playlist:open": {
				const selection = this.#selections.get(keyId);
				const lookup = selection === undefined ? undefined : this.playlists.lookup(selection.playlistId);
				const url = lookup?.status === "found" ? toSpotifyPlaylistUrl(lookup.playlist.spotifyUrl, lookup.playlist.id) : undefined;
				if (url === undefined) {
					await this.#sendState(keyId, request.requestId, "This playlist has no Spotify link.");
					return;
				}
				await this.#inspector.openUrl(url).catch((err: unknown) => this.logger.warn(`Opening Spotify failed: ${describeError(err)}`));
				break;
			}
		}
	}

	/**
	 * Runs the key's action with native feedback: brief title feedback and the check mark on success, an alert otherwise. Never starts OAuth.
	 * @param ev Key event.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const keyId = ev.action.id;
		// Validated again: the settings in the event are the source of truth for this press.
		const selection = normalizePlaylistSelection(ev.payload.settings) ?? this.#selections.get(keyId);
		try {
			const feedback = await this.press(selection);
			if (feedback !== undefined) {
				this.#showFeedback(keyId, feedback);
				await ev.action.showOk();
			}
		} catch (err) {
			const reason = err instanceof SpotifyError ? err.code : "unexpected error";
			this.logger.info(`Playlist key action not performed (${reason}).`);
			await ev.action.showAlert().catch(() => undefined);
		}
	}

	/**
	 * Loads the list once for keys (best effort, cached), so they can show renamed or deleted playlists.
	 */
	#loadListOnce(): void {
		if (this.playlists.state.value.status === "idle") {
			this.playlists.getPlaylists().catch(() => undefined);
		}
	}

	/**
	 * Loads the playlists (or refreshes them) and answers the picker.
	 * @param keyId Key whose Property Inspector asked.
	 * @param requestId Request being answered.
	 * @param force Refresh.
	 */
	async #loadAndSend(keyId: string, requestId: string | null, force: boolean): Promise<void> {
		let message: string | undefined;
		try {
			await this.playlists.getPlaylists({ force });
		} catch (err) {
			message = describeError(err);
		}
		await this.#sendState(keyId, requestId, message);
	}

	/**
	 * Sends the picker state, only to the Property Inspector of the key it belongs to.
	 * @param keyId Key.
	 * @param requestId Request being answered, if any.
	 * @param message Optional message.
	 */
	async #sendState(keyId: string, requestId: string | null, message?: string): Promise<void> {
		if (this.#inspector.current()?.id !== keyId) {
			return;
		}
		const selection = this.#selections.get(keyId);
		const state = buildInspectorState({
			requestId,
			mode: this.mode,
			snapshot: this.playlists.state.value,
			userId: this.playlists.userId,
			selection,
			lookup: selection === undefined ? undefined : this.playlists.lookup(selection.playlistId),
			message,
		});
		try {
			await this.#inspector.send(state as unknown as JsonObject);
		} catch (err) {
			this.logger.error("Failed to update the playlist picker.", err);
		}
	}

	/**
	 * Pushes playlist state changes (loading, limited, refreshed) to an open picker of this action.
	 */
	async #pushInspectorState(): Promise<void> {
		const current = this.#inspector.current();
		if (current !== undefined && this.#selections.has(current.id)) {
			await this.#sendState(current.id, null);
		}
	}

	/**
	 * Keeps each key's cached display name in step with Spotify (a renamed playlist stays selected by ID; only its name changes).
	 */
	async #syncNames(): Promise<void> {
		for (const key of this.actions) {
			const selection = this.#selections.get(key.id);
			if (selection === undefined) {
				continue;
			}
			const lookup = this.playlists.lookup(selection.playlistId);
			if (lookup.status === "found" && lookup.playlist.name !== selection.playlistName) {
				const settings = playlistSettings(selection.playlistId, lookup.playlist.name);
				this.#selections.set(key.id, normalizePlaylistSelection(settings));
				await key.setSettings(settings).catch((err: unknown) => this.logger.warn(`Updating a playlist name failed: ${describeError(err)}`));
			}
		}
	}

	/**
	 * Shows short feedback on a key, then returns to the normal title.
	 * @param keyId Key.
	 * @param text Feedback.
	 */
	#showFeedback(keyId: string, text: string): void {
		const previous = this.#feedback.get(keyId);
		if (previous !== undefined) {
			clearTimeout(previous.timer);
		}
		const timer = setTimeout(() => {
			this.#feedback.delete(keyId);
			void this.#renderAll();
		}, this.#feedbackMs);
		this.#feedback.set(keyId, { text, timer });
		void this.#renderAll();
	}

	/**
	 * Re-renders every visible key of this action.
	 */
	async #renderAll(): Promise<void> {
		const renders: Promise<void>[] = [];
		for (const key of this.actions) {
			if (key.isKey()) {
				renders.push(this.#render(key));
			}
		}
		await Promise.all(renders);
	}

	/**
	 * Renders one key, skipping unchanged renders.
	 * @param key Key.
	 */
	async #render(key: KeyAction<JsonObject>): Promise<void> {
		const selection = this.#selections.get(key.id);
		const { image, title } = this.view({
			playback: this.playback.state.value,
			playlists: this.playlists.state.value,
			selection,
			lookup: selection === undefined ? undefined : this.playlists.lookup(selection.playlistId),
			feedback: this.#feedback.get(key.id)?.text,
		});
		const signature = `${image}\u0000${title}`;
		if (this.#lastRender.get(key.id) === signature) {
			return;
		}
		this.#lastRender.set(key.id, signature);
		try {
			await Promise.all([key.setImage(image), key.setTitle(title)]);
		} catch (err) {
			this.#lastRender.delete(key.id);
			this.logger.error("Failed to render a playlist key.", err);
		}
	}
}
