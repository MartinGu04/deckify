import { silentLogger, type Logger } from "../../shared/logger";
import type { SpotifyProfile } from "../api/profile";

/**
 * Spotify connection status shared by every Deckify action.
 */
export type SpotifyAuthStatus = "not-configured" | "disconnected" | "connecting" | "connected" | "error";

/**
 * Immutable snapshot of the Spotify account state. Contains no tokens.
 */
export type SpotifyAuthSnapshot = {
	readonly status: SpotifyAuthStatus;

	/** Whether a Client ID is configured. */
	readonly clientId: string | undefined;

	/** Authenticated profile; only present when connected. */
	readonly profile: SpotifyProfile | undefined;

	/** When the current session was originally authorized (Unix epoch, milliseconds); only present when connected. */
	readonly authorizedAt: number | undefined;

	/** User-facing explanation of the current state, e.g. the last error. */
	readonly message: string | undefined;
};

/**
 * Listener notified with every new snapshot.
 */
export type SpotifyAuthListener = (snapshot: SpotifyAuthSnapshot) => void;

const INITIAL: SpotifyAuthSnapshot = {
	status: "not-configured",
	clientId: undefined,
	profile: undefined,
	authorizedAt: undefined,
	message: undefined,
};

/**
 * Holds the single, plugin-wide Spotify account state and notifies subscribers synchronously on every change.
 */
export class SpotifyAuthState {
	#snapshot: SpotifyAuthSnapshot = INITIAL;
	readonly #listeners = new Set<SpotifyAuthListener>();

	/**
	 * Initializes a new instance of the {@link SpotifyAuthState} class.
	 * @param logger Logger for listener failures.
	 */
	constructor(private readonly logger: Logger = silentLogger) {}

	/**
	 * Gets the current snapshot.
	 * @returns The snapshot.
	 */
	get snapshot(): SpotifyAuthSnapshot {
		return this.#snapshot;
	}

	/**
	 * Replaces the snapshot and notifies subscribers. Fields not provided are reset (profile/message) or kept (clientId).
	 * @param next The new state.
	 */
	update(next: Pick<SpotifyAuthSnapshot, "status"> & Partial<SpotifyAuthSnapshot>): void {
		const snapshot: SpotifyAuthSnapshot = Object.freeze({
			status: next.status,
			clientId: "clientId" in next ? next.clientId : this.#snapshot.clientId,
			profile: next.status === "connected" ? next.profile : undefined,
			authorizedAt: next.status === "connected" ? next.authorizedAt : undefined,
			message: next.message,
		});
		this.#snapshot = snapshot;

		for (const listener of [...this.#listeners]) {
			try {
				listener(snapshot);
			} catch (err) {
				this.logger.error("Spotify account state listener failed.", err);
			}
		}
	}

	/**
	 * Subscribes to state changes.
	 * @param listener Listener.
	 * @param options Options.
	 * @param options.emitCurrent When `true`, the listener is immediately called with the current snapshot.
	 * @returns Function that unsubscribes the listener.
	 */
	subscribe(listener: SpotifyAuthListener, options: { emitCurrent?: boolean } = {}): () => void {
		this.#listeners.add(listener);
		if (options.emitCurrent) {
			listener(this.#snapshot);
		}
		return () => {
			this.#listeners.delete(listener);
		};
	}
}
