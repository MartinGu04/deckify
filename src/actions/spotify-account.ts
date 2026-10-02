import streamDeck, {
	action,
	type KeyAction,
	type KeyDownEvent,
	type PropertyInspectorDidAppearEvent,
	SingletonAction,
	type WillAppearEvent,
} from "@elgato/streamdeck";

import { ActionUUID } from "../identifiers";
import type { JsonObject } from "../shared/sdk-types";
import { silentLogger, type Logger } from "../shared/logger";
import type { SpotifyAuthService } from "../spotify/auth/auth-service";
import { normalizeClientId } from "../spotify/client-id";
import { SPOTIFY_REDIRECT_URI } from "../spotify/config";
import { describeError } from "../spotify/errors";
import type { SpotifyAuthSnapshot, SpotifyAuthState } from "../spotify/state/auth-state";
import { getSpotifyAccountKeyView, toInspectorState } from "./spotify-account-view";

/**
 * Messages the Spotify Account Property Inspector sends to the plugin.
 */
type InspectorRequest =
	| { type: "deckify:spotify:hello" }
	| { type: "deckify:spotify:save-client-id"; clientId: string }
	| { type: "deckify:spotify:connect" }
	| { type: "deckify:spotify:disconnect" };

/** Event received from the Property Inspector (payload typed by the SDK as JSON). */
type InspectorMessageEvent = Parameters<NonNullable<SingletonAction["onSendToPlugin"]>>[0];

/**
 * Dependencies of {@link SpotifyAccountAction}.
 */
export type SpotifyAccountActionOptions = {
	readonly auth: SpotifyAuthService;
	readonly state: SpotifyAuthState;

	/** Persists the Client ID in Deckify's global settings. */
	readonly saveClientId: (clientId: string | undefined) => Promise<void>;
	readonly logger?: Logger;
};

/**
 * "Spotify Account" key: shows the shared Spotify connection state on every instance and connects/verifies on press.
 *
 * The state belongs to {@link SpotifyAuthState}, not to a key: every visible instance is re-rendered whenever it changes.
 */
@action({ UUID: ActionUUID.SpotifyAccount })
export class SpotifyAccountAction extends SingletonAction {
	readonly #auth: SpotifyAuthService;
	readonly #state: SpotifyAuthState;
	readonly #saveClientId: (clientId: string | undefined) => Promise<void>;
	readonly #logger: Logger;

	/**
	 * Initializes a new instance of the {@link SpotifyAccountAction} class.
	 * @param options Dependencies.
	 */
	constructor(options: SpotifyAccountActionOptions) {
		super();
		this.#auth = options.auth;
		this.#state = options.state;
		this.#saveClientId = options.saveClientId;
		this.#logger = options.logger ?? silentLogger;
		this.#state.subscribe((snapshot) => {
			void this.#renderAll(snapshot);
		});
	}

	/**
	 * Renders the current shared state when a key becomes visible.
	 * @param ev The event.
	 */
	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (ev.action.isKey()) {
			await this.#render(ev.action, this.#state.snapshot);
		}
	}

	/**
	 * Key press: connect when disconnected, re-verify when a session exists.
	 * @param ev The event.
	 */
	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const { status } = this.#state.snapshot;
		this.#logger.info(`Spotify Account key pressed (status: ${status}).`);

		try {
			if (status === "connecting") {
				return;
			}
			if (status === "not-configured") {
				this.#logger.info("Spotify Client ID missing; enter it in the Spotify Account Property Inspector.");
				await ev.action.showAlert();
				return;
			}

			if (this.#auth.hasSession) {
				await this.#auth.verify();
			} else {
				await this.#auth.connect();
			}
			await (this.#state.snapshot.status === "connected" ? ev.action.showOk() : ev.action.showAlert());
		} catch (err) {
			this.#logger.error("Spotify Account key action failed.", err);
			await ev.action.showAlert().catch(() => undefined);
		}
	}

	/**
	 * Sends the current state when the Property Inspector opens.
	 * @param _ev The event.
	 */
	override async onPropertyInspectorDidAppear(_ev: PropertyInspectorDidAppearEvent): Promise<void> {
		await this.#sendInspectorState(this.#state.snapshot);
	}

	/**
	 * Handles requests from the Property Inspector.
	 * @param ev The event.
	 */
	override async onSendToPlugin(ev: InspectorMessageEvent): Promise<void> {
		const request = parseInspectorRequest(ev.payload);
		if (request === undefined) {
			this.#logger.warn("Ignored an unrecognized Property Inspector message.");
			return;
		}

		try {
			switch (request.type) {
				case "deckify:spotify:hello":
					await this.#sendInspectorState(this.#state.snapshot);
					break;
				case "deckify:spotify:save-client-id":
					await this.#handleSaveClientId(request.clientId);
					break;
				case "deckify:spotify:connect":
					await this.#auth.connect();
					break;
				case "deckify:spotify:disconnect":
					await this.#auth.disconnect();
					break;
			}
		} catch (err) {
			this.#logger.error("Property Inspector request failed.", err);
			await this.#sendInspectorState(this.#state.snapshot, describeError(err));
		}
	}

	/**
	 * Validates, stores and applies a Client ID from the Property Inspector.
	 * @param input Raw Client ID.
	 */
	async #handleSaveClientId(input: string): Promise<void> {
		let clientId: string | undefined;
		try {
			clientId = normalizeClientId(input);
		} catch (err) {
			await this.#sendInspectorState(this.#state.snapshot, describeError(err));
			return;
		}
		await this.#saveClientId(clientId);
		await this.#auth.setClientId(clientId);
		await this.#sendInspectorState(this.#state.snapshot);
	}

	/**
	 * Re-renders every visible instance and the Property Inspector.
	 * @param snapshot Shared state.
	 */
	async #renderAll(snapshot: SpotifyAuthSnapshot): Promise<void> {
		const renders: Promise<void>[] = [];
		for (const instance of this.actions) {
			if (instance.isKey()) {
				renders.push(this.#render(instance, snapshot));
			}
		}
		renders.push(this.#sendInspectorState(snapshot));
		await Promise.all(renders);
	}

	/**
	 * Renders one key.
	 * @param key Key.
	 * @param snapshot Shared state.
	 */
	async #render(key: KeyAction<JsonObject>, snapshot: SpotifyAuthSnapshot): Promise<void> {
		const view = getSpotifyAccountKeyView(snapshot.status);
		try {
			await Promise.all([key.setImage(view.image), key.setTitle(view.title)]);
		} catch (err) {
			this.#logger.error("Failed to render Spotify Account key.", err);
		}
	}

	/**
	 * Sends the state to the Property Inspector when one of this action's inspectors is open.
	 * @param snapshot Shared state.
	 * @param clientIdError Error to show next to the Client ID field.
	 */
	async #sendInspectorState(snapshot: SpotifyAuthSnapshot, clientIdError?: string): Promise<void> {
		if (streamDeck.ui.action?.manifestId !== ActionUUID.SpotifyAccount) {
			return;
		}
		const state = toInspectorState(snapshot, SPOTIFY_REDIRECT_URI);
		try {
			await streamDeck.ui.sendToPropertyInspector({
				type: "deckify:spotify:state",
				state: {
					status: state.status,
					clientId: state.clientId,
					redirectUri: state.redirectUri,
					displayName: state.displayName ?? null,
					product: state.product ?? null,
					authorizedAt: state.authorizedAt ?? null,
					message: state.message ?? null,
				},
				clientIdError: clientIdError ?? null,
			});
		} catch (err) {
			this.#logger.error("Failed to update the Property Inspector.", err);
		}
	}
}

/**
 * Validates a Property Inspector message.
 * @param payload Raw payload.
 * @returns The request; otherwise `undefined`.
 */
function parseInspectorRequest(payload: unknown): InspectorRequest | undefined {
	if (typeof payload !== "object" || payload === null || !("type" in payload)) {
		return undefined;
	}
	const { type } = payload;
	switch (type) {
		case "deckify:spotify:hello":
		case "deckify:spotify:connect":
		case "deckify:spotify:disconnect":
			return { type };
		case "deckify:spotify:save-client-id":
			return "clientId" in payload && typeof payload.clientId === "string" ? { type, clientId: payload.clientId } : undefined;
		default:
			return undefined;
	}
}
