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
import { parseSpotifyAccountCommand, SpotifyAccountCommands, type ClientIdProblem } from "../spotify/account-commands";
import type { SpotifyAuthService } from "../spotify/auth/auth-service";
import type { SpotifyAuthSnapshot, SpotifyAuthState } from "../spotify/state/auth-state";
import { getSpotifyAccountKeyView } from "./spotify-account-view";

/** Prefix of every message the Spotify Account Property Inspector exchanges with the plugin. */
const MESSAGE_PREFIX = "deckify:spotify:";

/** Where the Setup App starts: the welcome screen, or the account (Client ID / connection) part for people who already set up. */
export type SetupEntry = "start" | "account";

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

	/** Opens a URL in the default browser; only ever called with the Spotify Developer Dashboard address. */
	readonly openUrl: (url: string) => Promise<void>;

	/** Opens the Deckify Setup App in the default browser. */
	readonly openSetup: (entry: SetupEntry) => Promise<void>;
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
	readonly #commands: SpotifyAccountCommands;
	readonly #openSetup: (entry: SetupEntry) => Promise<void>;
	readonly #logger: Logger;

	/**
	 * Initializes a new instance of the {@link SpotifyAccountAction} class.
	 * @param options Dependencies.
	 */
	constructor(options: SpotifyAccountActionOptions) {
		super();
		this.#auth = options.auth;
		this.#state = options.state;
		this.#openSetup = options.openSetup;
		this.#logger = options.logger ?? silentLogger;
		this.#commands = new SpotifyAccountCommands({
			auth: options.auth,
			state: options.state,
			saveClientId: options.saveClientId,
			openUrl: options.openUrl,
			logger: this.#logger,
		});
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
				this.#logger.info("Spotify Client ID missing; set up Deckify from the Spotify Account Property Inspector.");
				await ev.action.showAlert();
				return;
			}

			if (status === "reauthorization-required") {
				// New permissions can only be granted by authorizing again; the user explicitly pressed the Spotify Account key.
				await this.#auth.connect();
			} else if (this.#auth.hasSession) {
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
		const { payload } = ev;
		const type = typeof payload === "object" && payload !== null && "type" in payload ? payload.type : undefined;
		if (type === `${MESSAGE_PREFIX}hello`) {
			await this.#sendInspectorState(this.#state.snapshot);
			return;
		}
		if (type === `${MESSAGE_PREFIX}open-setup`) {
			const entry: SetupEntry = typeof payload === "object" && payload !== null && "entry" in payload && payload.entry === "account" ? "account" : "start";
			try {
				await this.#openSetup(entry);
			} catch (err) {
				this.#logger.error("Could not open Deckify Setup.", err);
				await this.#sendInspectorState(this.#state.snapshot, { message: "Deckify Setup could not be opened. Check the Deckify log.", issue: "unknown" });
			}
			return;
		}

		const command = parseSpotifyAccountCommand(payload, MESSAGE_PREFIX);
		if (command === undefined) {
			this.#logger.warn("Ignored an unrecognized Property Inspector message.");
			return;
		}
		const problem = await this.#commands.run(command);
		if (problem !== undefined || command.type === "save-client-id") {
			await this.#sendInspectorState(this.#state.snapshot, problem);
		}
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
	 * @param _snapshot Shared state (the payload is built from the current state).
	 * @param clientIdProblem Problem to show next to the Client ID field.
	 */
	async #sendInspectorState(_snapshot: SpotifyAuthSnapshot, clientIdProblem?: ClientIdProblem): Promise<void> {
		if (streamDeck.ui.action?.manifestId !== ActionUUID.SpotifyAccount) {
			return;
		}
		try {
			await streamDeck.ui.sendToPropertyInspector({ type: `${MESSAGE_PREFIX}state`, ...this.#commands.payload(clientIdProblem) });
		} catch (err) {
			this.#logger.error("Failed to update the Property Inspector.", err);
		}
	}
}
