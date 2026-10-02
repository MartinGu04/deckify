import { Observable } from "../shared/observable";
import { silentLogger, type Logger } from "../shared/logger";
import {
	describeError,
	SpotifyDeviceRestrictedError,
	SpotifyNoActiveDeviceError,
	SpotifyNotConnectedError,
	SpotifyPlayerCommandError,
	SpotifyPremiumRequiredError,
	SpotifyQuotaExceededError,
	SpotifyRateLimitError,
	SpotifyReauthorizationRequiredError,
	SpotifyUnauthorizedError,
} from "../spotify/errors";
import type { SpotifyAuthSnapshot, SpotifyAuthState } from "../spotify/state/auth-state";
import { PlaybackTiming, type PlaybackTimingOptions } from "./config";
import { PlaybackUnavailableError } from "./errors";
import type { PlaybackCommand, PlaybackItem, PlaybackObservation } from "./model";
import { SIGNED_OUT_SNAPSHOT, type PlaybackNotice, type PlaybackSnapshot } from "./state";
import type { PlaybackTransport } from "./transport";

/**
 * Dependencies of {@link PlaybackService}.
 */
export type PlaybackServiceOptions = {
	readonly transport: PlaybackTransport;

	/** Shared Spotify account state; playback only runs while it is `connected`. */
	readonly auth: SpotifyAuthState;

	/** Called when Spotify still rejects the access token after the API client's refresh-and-retry (e.g. to re-verify the session). */
	readonly onAuthRejected?: () => Promise<void> | void;

	readonly clock?: () => number;
	readonly logger?: Logger;
	readonly timing?: Partial<PlaybackTimingOptions>;
};

/** Result of a command request. `"busy"` means another command was still in flight, so this one was ignored. */
export type CommandOutcome = "done" | "busy";

/** Observations older than this are refreshed before a command is refused because of them. */
const STALE_OBSERVATION_MS = 5_000;

/**
 * The single owner of playback state for the whole plugin.
 *
 * - Polls the transport with one shared, adaptive timer, only while Spotify is connected and at least one playback key is visible.
 * - Never overlaps state requests and never runs two commands at once.
 * - Reconciles every successful command against a fresh state read; optimistic Play/Pause state never outlives that read.
 * - Backs off on rate limits and stops polling on quota exhaustion until the window has passed.
 */
export class PlaybackService {
	/** Shared playback state observed by every playback action. */
	readonly state: Observable<PlaybackSnapshot>;

	readonly #transport: PlaybackTransport;
	readonly #auth: SpotifyAuthState;
	readonly #onAuthRejected: (() => Promise<void> | void) | undefined;
	readonly #clock: () => number;
	readonly #logger: Logger;
	readonly #timing: PlaybackTimingOptions;
	readonly #unsubscribeAuth: () => void;

	readonly #viewers = new Set<string>();
	#connected = false;
	#disposed = false;

	#timer: NodeJS.Timeout | undefined;
	#timerDue = 0;

	#fetchInFlight: Promise<void> | undefined;
	#refreshQueued = false;
	#lastFetchFailed = false;

	#commandInFlight: Promise<void> | undefined;
	/** Incremented when a command finishes, so state reads that started before it are discarded as stale. */
	#commandEpoch = 0;
	/** After Next/Previous: the item that was playing, to detect when Spotify has not switched yet. */
	#awaitingItemChange: string | undefined;

	/** Rate-limit or quota back-off: no requests before this time. */
	#blockedUntil = 0;
	#blockedBy: SpotifyRateLimitError | undefined;

	/**
	 * Initializes a new instance of the {@link PlaybackService} class.
	 * @param options Dependencies.
	 */
	constructor(options: PlaybackServiceOptions) {
		this.#transport = options.transport;
		this.#auth = options.auth;
		this.#onAuthRejected = options.onAuthRejected;
		this.#clock = options.clock ?? Date.now;
		this.#logger = options.logger ?? silentLogger;
		this.#timing = { ...PlaybackTiming, ...options.timing };
		this.state = new Observable<PlaybackSnapshot>(SIGNED_OUT_SNAPSHOT, this.#logger);

		this.#onAuthChanged(this.#auth.snapshot);
		this.#unsubscribeAuth = this.#auth.subscribe((snapshot) => {
			this.#onAuthChanged(snapshot);
		});
	}

	/**
	 * Number of visible playback keys.
	 * @returns The count.
	 */
	get viewerCount(): number {
		return this.#viewers.size;
	}

	/**
	 * Registers a visible playback key. Polling starts with the first visible key.
	 * @param id Unique key instance ID.
	 */
	addViewer(id: string): void {
		const wasIdle = this.#viewers.size === 0;
		this.#viewers.add(id);
		if (wasIdle) {
			void this.refresh();
		}
	}

	/**
	 * Unregisters a key that is no longer visible. Polling stops when no playback key is visible.
	 * @param id Unique key instance ID.
	 */
	removeViewer(id: string): void {
		this.#viewers.delete(id);
		if (this.#viewers.size === 0) {
			this.#clearTimer();
		}
	}

	/**
	 * Reads the playback state now, unless polling is not allowed (signed out, no visible keys, backing off). When a read is already in flight,
	 * one more read is queued after it instead of starting a parallel request.
	 * @returns Promise resolved when the (current) read has finished.
	 */
	refresh(): Promise<void> {
		if (!this.#canRequest()) {
			return Promise.resolve();
		}
		if (this.#fetchInFlight !== undefined) {
			this.#refreshQueued = true;
			return this.#fetchInFlight;
		}
		return this.#fetch();
	}

	/**
	 * Pauses when playing, otherwise plays.
	 * @returns The outcome.
	 */
	togglePlayPause(): Promise<CommandOutcome> {
		return this.command("toggle");
	}

	/**
	 * Sends a playback command to the active device, then reconciles the shared state with Spotify.
	 *
	 * Commands that Spotify would certainly reject (signed out, not Premium, no active device, restricted device, rate limited) fail without a
	 * request. While a command is in flight, further commands are ignored (`"busy"`), so rapid presses never produce conflicting requests.
	 * @param command Command; `"toggle"` pauses when playing and plays otherwise, decided on fresh state.
	 * @returns `"done"` on success; `"busy"` when ignored.
	 * @throws {SpotifyError} When the command is not possible or fails.
	 */
	async command(command: PlaybackCommand | "toggle"): Promise<CommandOutcome> {
		if (this.#commandInFlight !== undefined) {
			this.#logger.debug(`Ignoring ${command}: another playback command is in flight.`);
			return "busy";
		}

		const run = this.#runCommand(command);
		this.#commandInFlight = run;
		try {
			await run;
			return "done";
		} finally {
			this.#commandInFlight = undefined;
		}
	}

	/**
	 * Stops polling and releases subscriptions.
	 */
	dispose(): void {
		this.#disposed = true;
		this.#clearTimer();
		this.#unsubscribeAuth();
	}

	/**
	 * Runs one command (see {@link command}).
	 * @param requested Command.
	 */
	async #runCommand(requested: PlaybackCommand | "toggle"): Promise<void> {
		await this.#assertCommandAllowed();
		const before = this.state.value;
		// Decide the toggle direction only after the freshness check, so a stale "playing" never sends a conflicting Pause.
		const command: PlaybackCommand = requested === "toggle" ? (before.isPlaying ? "pause" : "play") : requested;
		this.state.update({ pendingCommand: command });

		try {
			await this.#transport[command]();
		} catch (err) {
			this.#commandEpoch++;
			this.state.update({ pendingCommand: undefined });
			this.#handleError(err);
			this.#logger.warn(`Playback command ${command} failed: ${describeError(err)}`);
			this.#schedule(this.#nextInterval());
			throw err;
		}

		this.#commandEpoch++;
		if (command === "play" || command === "pause") {
			// Safe optimistic update: Spotify accepted the command. The reconciliation read below confirms or corrects it.
			this.state.update({ pendingCommand: undefined, isPlaying: command === "play", optimistic: true, notice: undefined });
		} else {
			// Never invent metadata for Next/Previous: keep the old item until Spotify reports the new one.
			this.#awaitingItemChange = itemKey(before.item);
			this.state.update({ pendingCommand: undefined, notice: undefined });
		}
		this.#schedule(this.#timing.reconcileDelayMs, { replace: true });
	}

	/**
	 * Throws when a command cannot succeed, without sending it.
	 */
	async #assertCommandAllowed(): Promise<void> {
		if (!this.#connected) {
			throw new PlaybackUnavailableError(signedOutNotice(this.#auth.snapshot).message);
		}
		if (this.state.value.premiumRequired) {
			throw new SpotifyPremiumRequiredError();
		}
		this.#assertNotBlocked();

		// Decisions based on device state need a reasonably fresh observation (e.g. the user may have just started Spotify).
		if (this.#isObservationStale()) {
			await this.#fetchNow();
			this.#assertNotBlocked();
		}

		const snapshot = this.state.value;
		if (snapshot.availability === "inactive") {
			this.state.update({ notice: { code: "no-active-device", message: new SpotifyNoActiveDeviceError().message } });
			throw new SpotifyNoActiveDeviceError();
		}
		if (snapshot.device?.isRestricted === true) {
			this.state.update({ notice: { code: "device-restricted", message: new SpotifyDeviceRestrictedError().message } });
			throw new SpotifyDeviceRestrictedError();
		}
	}

	/**
	 * Throws the active rate-limit/quota error while backing off.
	 */
	#assertNotBlocked(): void {
		if (this.#blockedBy !== undefined && this.#clock() < this.#blockedUntil) {
			throw this.#blockedBy;
		}
	}

	/**
	 * Reads the state now (sharing an in-flight read) even when no key is visible; used before commands.
	 */
	async #fetchNow(): Promise<void> {
		if (this.#fetchInFlight !== undefined) {
			// A regular read started before this command; its result is discarded as stale, so read again if needed.
			await this.#fetchInFlight;
		}
		if (this.#isObservationStale() && this.#connected && this.#clock() >= this.#blockedUntil) {
			await this.#fetch({ forCommand: true });
		}
	}

	/**
	 * Whether the shared state is too old to base a command decision on.
	 * @returns `true` when never observed or older than a few seconds.
	 */
	#isObservationStale(): boolean {
		const observedAt = this.state.value.observedAt;
		return observedAt === undefined || this.#clock() - observedAt > STALE_OBSERVATION_MS;
	}

	/**
	 * Reads the state once and schedules the next read.
	 * @param options Options.
	 * @param options.forCommand The read is part of a command's checks (made while that command is in flight), so it is not stale.
	 */
	#fetch(options: { forCommand?: boolean } = {}): Promise<void> {
		this.#clearTimer();
		const epoch = this.#commandEpoch;

		const run = (async (): Promise<void> => {
			try {
				const observation = await this.#transport.getState();
				this.#lastFetchFailed = false;
				if (!this.#connected) {
					return;
				}
				if (epoch !== this.#commandEpoch || (this.#commandInFlight !== undefined && options.forCommand !== true)) {
					// Started before a command changed the player; its result may be stale. The command schedules its own reconciliation.
					return;
				}
				this.#applyObservation(observation);
			} catch (err) {
				this.#lastFetchFailed = true;
				this.#handleError(err);
				this.#logger.warn(`Playback state request failed: ${describeError(err)}`);
			}
		})();

		this.#fetchInFlight = run;
		return run.finally(() => {
			this.#fetchInFlight = undefined;
			if (this.#refreshQueued) {
				this.#refreshQueued = false;
				this.#schedule(0, { replace: true });
			} else {
				this.#schedule(this.#nextInterval());
			}
		});
	}

	/**
	 * Publishes an observation.
	 * @param observation Observation.
	 */
	#applyObservation(observation: PlaybackObservation): void {
		const previous = this.state.value;
		const premiumNotice = previous.premiumRequired ? premiumNoticeFor() : undefined;

		if (!observation.active) {
			this.#awaitingItemChange = undefined;
			this.state.set({
				...previous,
				availability: "inactive",
				isPlaying: false,
				item: undefined,
				device: undefined,
				progressMs: undefined,
				observedAt: this.#clock(),
				optimistic: false,
				notice: premiumNotice,
			});
			return;
		}

		if (this.#awaitingItemChange !== undefined) {
			const unchanged = itemKey(observation.item) === this.#awaitingItemChange;
			this.#awaitingItemChange = undefined;
			if (unchanged) {
				// Spotify may not have switched items yet; check once more shortly instead of polling aggressively.
				this.#refreshQueued = false;
				this.#schedule(this.#timing.trackChangeRecheckMs, { replace: true });
			}
		}

		this.state.set({
			...previous,
			availability: "active",
			isPlaying: observation.isPlaying,
			item: observation.item,
			device: observation.device,
			progressMs: observation.progressMs,
			observedAt: this.#clock(),
			optimistic: false,
			notice: observation.device?.isRestricted === true ? { code: "device-restricted", message: new SpotifyDeviceRestrictedError().message } : premiumNotice,
		});
	}

	/**
	 * Updates state for a failed request. The last valid playback state is kept wherever possible.
	 * @param err The failure.
	 */
	#handleError(err: unknown): void {
		if (err instanceof SpotifyRateLimitError) {
			const quota = err instanceof SpotifyQuotaExceededError;
			const fallback = quota ? this.#timing.defaultQuotaBackoffMs : this.#timing.defaultRateLimitBackoffMs;
			const backoff = err.retryAfterSeconds === undefined ? fallback : Math.max(err.retryAfterSeconds * 1000, 1000);
			this.#blockedUntil = this.#clock() + backoff;
			this.#blockedBy = err;
			this.#clearTimer();
			this.state.update({ notice: { code: quota ? "quota-exceeded" : "rate-limited", message: err.message } });
			this.#logger.warn(`Spotify ${quota ? "quota exhausted" : "rate limit"}: pausing playback requests for ${Math.round(backoff / 1000)} s.`);
			return;
		}
		if (err instanceof SpotifyReauthorizationRequiredError || err instanceof SpotifyNotConnectedError) {
			// The auth service has already published the account state; the auth listener updates playback.
			return;
		}
		if (err instanceof SpotifyUnauthorizedError) {
			this.state.update({ notice: { code: "error", message: err.message } });
			void Promise.resolve(this.#onAuthRejected?.()).catch((authErr: unknown) => {
				this.#logger.error("Re-verifying the Spotify session failed.", authErr);
			});
			return;
		}
		if (err instanceof SpotifyNoActiveDeviceError) {
			this.state.update({
				availability: "inactive",
				isPlaying: false,
				optimistic: false,
				notice: { code: "no-active-device", message: err.message },
			});
			return;
		}
		if (err instanceof SpotifyDeviceRestrictedError) {
			const device = this.state.value.device;
			this.state.update({
				device: device === undefined ? undefined : { ...device, isRestricted: true },
				notice: { code: "device-restricted", message: err.message },
			});
			return;
		}
		if (err instanceof SpotifyPremiumRequiredError) {
			this.state.update({ premiumRequired: true, notice: premiumNoticeFor() });
			return;
		}
		if (err instanceof SpotifyPlayerCommandError) {
			// E.g. NO_NEXT_TRACK: a one-off refusal; the key shows an alert, the shared state is unaffected.
			return;
		}
		this.state.update({ notice: { code: "error", message: describeError(err) } });
	}

	/**
	 * Reacts to Spotify account changes.
	 * @param snapshot Account state.
	 */
	#onAuthChanged(snapshot: SpotifyAuthSnapshot): void {
		const connected = snapshot.status === "connected";
		const premiumRequired = connected && snapshot.profile?.product !== undefined && snapshot.profile.product !== "premium";

		if (!connected) {
			this.#connected = false;
			this.#clearTimer();
			this.#blockedUntil = 0;
			this.#blockedBy = undefined;
			this.#awaitingItemChange = undefined;
			this.state.set({ ...SIGNED_OUT_SNAPSHOT, notice: signedOutNotice(snapshot) });
			return;
		}

		if (!this.#connected) {
			this.#connected = true;
			this.#lastFetchFailed = false;
			this.state.set({ ...SIGNED_OUT_SNAPSHOT, availability: "unknown", premiumRequired, notice: premiumRequired ? premiumNoticeFor() : undefined });
			if (premiumRequired) {
				this.#logger.info("Spotify account is not Premium; playback control is unavailable (playback state is still shown).");
			}
			void this.refresh();
			return;
		}

		if (premiumRequired !== this.state.value.premiumRequired) {
			this.state.update({ premiumRequired, notice: premiumRequired ? premiumNoticeFor() : undefined });
		}
	}

	/**
	 * Interval until the next regular read, based on what is happening.
	 * @returns Delay in milliseconds.
	 */
	#nextInterval(): number {
		const now = this.#clock();
		if (this.#blockedUntil > now) {
			return this.#blockedUntil - now;
		}
		if (this.#lastFetchFailed) {
			return this.#timing.errorIntervalMs;
		}
		const snapshot = this.state.value;
		switch (snapshot.availability) {
			case "active":
				return snapshot.isPlaying ? this.#timing.playingIntervalMs : this.#timing.pausedIntervalMs;
			case "inactive":
				return this.#timing.inactiveIntervalMs;
			default:
				return this.#timing.errorIntervalMs;
		}
	}

	/**
	 * Whether a state read may be sent now.
	 * @returns `true` when connected, a playback key is visible and no back-off is active.
	 */
	#canRequest(): boolean {
		return !this.#disposed && this.#connected && this.#viewers.size > 0 && this.#clock() >= this.#blockedUntil;
	}

	/**
	 * Schedules the next read. Only one timer exists; an earlier pending read is kept unless `replace` is set.
	 * @param delayMs Delay.
	 * @param options Options.
	 * @param options.replace Replace an existing timer even if it is due earlier.
	 */
	#schedule(delayMs: number, options: { replace?: boolean } = {}): void {
		if (this.#disposed || !this.#connected || this.#viewers.size === 0) {
			return;
		}
		const now = this.#clock();
		const due = Math.max(now + delayMs, this.#blockedUntil);
		if (this.#timer !== undefined && !options.replace && this.#timerDue <= due) {
			return;
		}
		this.#clearTimer();
		this.#timerDue = due;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			void this.refresh();
		}, due - now);
	}

	#clearTimer(): void {
		if (this.#timer !== undefined) {
			clearTimeout(this.#timer);
			this.#timer = undefined;
		}
	}
}

/**
 * Identity of an item for change detection.
 * @param item Item.
 * @returns A key; empty when there is no item.
 */
function itemKey(item: PlaybackItem | undefined): string {
	return item === undefined ? "" : (item.uri ?? item.id ?? `${item.type}:${item.title}:${item.subtitle}`);
}

/**
 * Notice for a non-Premium account.
 * @returns The notice.
 */
function premiumNoticeFor(): PlaybackNotice {
	return { code: "premium-required", message: new SpotifyPremiumRequiredError().message };
}

/**
 * Explains why playback is unavailable for an account state.
 * @param snapshot Account state.
 * @returns The notice.
 */
function signedOutNotice(snapshot: SpotifyAuthSnapshot): PlaybackNotice {
	switch (snapshot.status) {
		case "reauthorization-required":
			return { code: "reauthorization-required", message: "Reconnect Spotify in the Spotify Account key to enable playback control." };
		case "connecting":
			return { code: "not-connected", message: "Connecting to Spotify..." };
		case "not-configured":
			return { code: "not-connected", message: "Set up Spotify in the Spotify Account key first." };
		case "error":
			return { code: "not-connected", message: snapshot.message ?? "The Spotify account has a problem. Check the Spotify Account key." };
		default:
			return { code: "not-connected", message: "Connect Spotify in the Spotify Account key first." };
	}
}
