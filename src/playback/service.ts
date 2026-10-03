import { Observable } from "../shared/observable";
import { silentLogger, type Logger } from "../shared/logger";
import {
	describeError,
	SpotifyApiError,
	SpotifyDeviceRestrictedError,
	SpotifyNoActiveDeviceError,
	SpotifyNotConnectedError,
	SpotifyPlayerCommandError,
	SpotifyPremiumRequiredError,
	SpotifyQuotaExceededError,
	SpotifyRateLimitError,
	SpotifyReauthorizationRequiredError,
	SpotifyUnauthorizedError,
	SpotifyVolumeUnsupportedError,
} from "../spotify/errors";
import type { SpotifyAuthSnapshot, SpotifyAuthState } from "../spotify/state/auth-state";
import { PlaybackTiming, type PlaybackTimingOptions } from "./config";
import { PlaybackUnavailableError } from "./errors";
import type { LocalCommandResult, LocalPlaybackCommand, LocalPlaybackCommandTransport } from "./local-commands";
import type { PlaybackCommand, PlaybackItem, PlaybackObservation } from "./model";
import { SIGNED_OUT_SNAPSHOT, type PlaybackNotice, type PlaybackSnapshot } from "./state";
import { playlistIdFromUri } from "../playlists/model";
import type { PlaybackTransport } from "./transport";

/**
 * Dependencies of {@link PlaybackService}.
 */
export type PlaybackServiceOptions = {
	/** State source and fallback command path (the Spotify Web API). */
	readonly transport: PlaybackTransport;

	/**
	 * Optional low-latency local command path (e.g. the Windows media session of the Spotify app). Tried first for every command; the
	 * transport is only used when it reports `unavailable`.
	 */
	readonly localCommands?: LocalPlaybackCommandTransport;

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
 * - Sends commands through the local command path first (no state read before it), then falls back to the transport only when the local
 *   path reports that it did not perform the command.
 * - Reconciles every successful command against a fresh state read; optimistic Play/Pause state never outlives that read.
 * - Backs off on rate limits and stops polling on quota exhaustion until the window has passed.
 */
export class PlaybackService {
	/** Shared playback state observed by every playback action. */
	readonly state: Observable<PlaybackSnapshot>;

	readonly #transport: PlaybackTransport;
	readonly #local: LocalPlaybackCommandTransport | undefined;
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
	#lastFetchError: unknown;

	/** The volume the user wants while a volume change is in progress; every press moves it immediately. */
	#volumeTarget: number | undefined;
	/** The last volume Spotify accepted in the current volume change. */
	#volumeSent: number | undefined;
	/** Whether set-volume requests are being sent (strictly one at a time). */
	#volumeDraining = false;
	#volumeDrain: Promise<void> | undefined;
	/** The last non-zero device volume Deckify saw or set; Unmute restores it. In memory only (see the README). */
	#lastNonZeroVolume: number | undefined;

	/**
	 * Initializes a new instance of the {@link PlaybackService} class.
	 * @param options Dependencies.
	 */
	constructor(options: PlaybackServiceOptions) {
		this.#transport = options.transport;
		this.#local = options.localCommands;
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
	 * Starts a playlist on the active device through the Spotify Web API (never the local media session: it cannot start a specific
	 * playlist). Like the other commands it requires a connected Premium account and an active, controllable device, is refused while
	 * rate limited, and is ignored (`"busy"`) while another playback command is in flight.
	 * @param contextUri `spotify:playlist:<id>`.
	 * @returns `"done"` on success; `"busy"` when ignored.
	 * @throws {SpotifyError} When playback is not possible or Spotify refuses it.
	 */
	async playContext(contextUri: string): Promise<CommandOutcome> {
		if (playlistIdFromUri(contextUri) === undefined) {
			throw new RangeError("Only Spotify playlist URIs can be played.");
		}
		if (this.#commandInFlight !== undefined) {
			this.#logger.debug("Ignoring a playlist start: another playback command is in flight.");
			return "busy";
		}
		const run = this.#runContextCommand(contextUri);
		this.#commandInFlight = run;
		try {
			await run;
			return "done";
		} finally {
			this.#commandInFlight = undefined;
		}
	}

	/**
	 * The volume Unmute restores, when known.
	 * @returns Whole percent above zero; otherwise `undefined`.
	 */
	get lastNonZeroVolume(): number | undefined {
		return this.#lastNonZeroVolume;
	}

	/**
	 * Changes the active device's Spotify volume by a number of percentage points (clamped to 0–100).
	 *
	 * Presses are never dropped: each one moves the desired volume immediately (based on the volume still being set, if any), and set-volume
	 * requests are sent strictly one at a time, each carrying the newest desired volume. Intermediate values may be skipped, but the final
	 * volume always reflects every press. The state is reconciled with Spotify afterwards.
	 * @param deltaPercent Whole percentage points; positive raises the volume.
	 * @returns `"done"` once Spotify accepted the newest volume.
	 * @throws {SpotifyError} When volume control is not possible (signed out, not Premium, no device, restricted, unsupported, limited) or
	 * Spotify rejected the change.
	 */
	async adjustVolume(deltaPercent: number): Promise<CommandOutcome> {
		if (!Number.isInteger(deltaPercent)) {
			throw new RangeError("Volume steps must be whole percentage points.");
		}
		await this.#changeVolume((base) => base + deltaPercent);
		return "done";
	}

	/**
	 * Mutes by setting the device volume to 0 (remembering the current volume), or unmutes by restoring the remembered volume (50% when none
	 * is known). Spotify's real device volume decides which: a volume of 0 counts as muted, whoever set it.
	 * @returns `"done"` once Spotify accepted the change.
	 * @throws {SpotifyError} As {@link adjustVolume}.
	 */
	async toggleMute(): Promise<CommandOutcome> {
		await this.#changeVolume((base) => {
			if (base > 0) {
				this.#lastNonZeroVolume = base;
				return 0;
			}
			return this.#lastNonZeroVolume ?? this.#timing.defaultUnmuteVolumePercent;
		});
		return "done";
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
		this.#assertAccountAllowsCommands();

		// Fast path: the local Spotify app, without any Web API request first (not even while the Web API is rate limited).
		if (this.#local !== undefined && (await this.#tryLocalCommand(this.#local, requested))) {
			return;
		}

		await this.#runWebApiCommand(requested);
	}

	/**
	 * Tries a command on the local command path.
	 * @param local Local transport.
	 * @param requested Command.
	 * @returns `true` when the command is finished (performed, or possibly performed); `false` when it was definitely not performed and the
	 * Web API should be used.
	 */
	async #tryLocalCommand(local: LocalPlaybackCommandTransport, requested: LocalPlaybackCommand): Promise<boolean> {
		const before = this.state.value;
		// For the optimistic key update only; the local player itself decides what "toggle" does.
		const expected: PlaybackCommand = requested === "toggle" ? (before.isPlaying ? "pause" : "play") : requested;
		this.state.update({ pendingCommand: expected });

		const started = this.#clock();
		let result: LocalCommandResult;
		try {
			result = await local.execute(requested);
		} catch {
			// By contract a thrown error means nothing was sent.
			result = { status: "unavailable", reason: "local-error" };
		}

		switch (result.status) {
			case "handled":
				this.#logger.info(`Playback ${requested} sent via ${local.id} in ${String(this.#clock() - started)} ms.`);
				this.#setLocalControl(true);
				this.#completeCommand(expected, before);
				return true;
			case "uncertain":
				// It may have been performed: never repeat it through the Web API (that could skip twice). Reconcile instead.
				this.#logger.warn(`Playback ${requested} via ${local.id} has an unknown outcome (${result.reason}); not retrying it.`);
				this.#commandEpoch++;
				this.state.update({ pendingCommand: undefined, optimistic: false });
				this.#schedule(this.#timing.reconcileDelayMs, { replace: true });
				return true;
			case "unavailable":
				this.#logger.info(`Playback ${requested} not available via ${local.id} (${result.reason}); using the Spotify Web API.`);
				if (result.reason !== "command-rejected") {
					this.#setLocalControl(false);
				}
				this.state.update({ pendingCommand: undefined });
				return false;
		}
	}

	/**
	 * Runs a command through the transport (the Phase 3 Spotify Web API path).
	 * @param requested Command.
	 */
	async #runWebApiCommand(requested: PlaybackCommand | "toggle"): Promise<void> {
		await this.#assertWebApiCommandAllowed();
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

		this.#completeCommand(command, before);
	}

	/**
	 * Starts a playlist (see {@link playContext}).
	 * @param contextUri Playlist URI.
	 */
	async #runContextCommand(contextUri: string): Promise<void> {
		this.#assertAccountAllowsCommands();
		await this.#assertWebApiCommandAllowed();
		const before = this.state.value;
		this.state.update({ pendingCommand: "play" });

		try {
			await this.#transport.playContext(contextUri);
		} catch (err) {
			this.#commandEpoch++;
			this.state.update({ pendingCommand: undefined });
			// A playlist Spotify cannot find (HTTP 404 without a player reason) says nothing about the player itself.
			if (!(err instanceof SpotifyApiError && err.constructor === SpotifyApiError && err.status === 404)) {
				this.#handleError(err);
			}
			this.#logger.warn(`Starting a playlist failed: ${describeError(err)}`);
			this.#schedule(this.#nextInterval());
			throw err;
		}

		this.#commandEpoch++;
		// The new item is not known yet: keep the old metadata until Spotify reports the playlist's first item.
		this.#awaitingItemChange = itemKey(before.item);
		const notice = this.#isBlocked() ? this.state.value.notice : undefined;
		this.state.update({ pendingCommand: undefined, isPlaying: true, optimistic: true, notice });
		this.#schedule(this.#timing.reconcileDelayMs, { replace: true });
	}

	/**
	 * Applies a performed command to the shared state and schedules reconciliation.
	 * @param command The performed command.
	 * @param before State when the key was pressed.
	 */
	#completeCommand(command: PlaybackCommand, before: PlaybackSnapshot): void {
		this.#commandEpoch++;
		// While the Web API is backing off, keep its notice: commands may succeed locally, but state updates are still limited.
		const notice = this.#isBlocked() ? this.state.value.notice : undefined;
		if (command === "play" || command === "pause") {
			// Safe optimistic update: the command was accepted. The reconciliation read below confirms or corrects it.
			this.state.update({ pendingCommand: undefined, isPlaying: command === "play", optimistic: true, notice });
		} else {
			// Never invent metadata for Next/Previous: keep the old item until Spotify reports the new one.
			this.#awaitingItemChange = itemKey(before.item);
			this.state.update({ pendingCommand: undefined, notice });
		}
		// Reconciliation honors any rate-limit/quota back-off (the timer is never due before it ends).
		this.#schedule(this.#timing.reconcileDelayMs, { replace: true });
	}

	/**
	 * Moves the desired volume and makes sure it is sent (see {@link adjustVolume}).
	 * @param compute Computes the new volume from the current one (the volume still being set, if any).
	 */
	async #changeVolume(compute: (base: number) => number): Promise<void> {
		this.#assertAccountAllowsCommands();
		this.#assertNotBlocked();
		if (this.#volumeTarget === undefined) {
			await this.#ensureVolumeControllable();
		}

		// Read the base only now: another press may have moved the target (or finished a change) while this one waited for fresh state.
		const base = this.#volumeTarget ?? this.state.value.device?.volumePercent;
		if (base === undefined) {
			throw new SpotifyVolumeUnsupportedError("The active Spotify device did not report its volume.");
		}
		const target = clampVolume(compute(base));
		if (this.#volumeTarget === undefined && target === base) {
			// Already there (e.g. Volume Up at 100%): nothing to send.
			return;
		}
		this.#volumeTarget = target;
		if (this.state.value.pendingVolume !== target) {
			this.state.update({ pendingVolume: target });
		}
		await this.#drainVolume();
	}

	/**
	 * Makes sure the active device's volume is known and can be changed, reading the state first when it is stale or has no volume.
	 * Never assumes a volume.
	 */
	async #ensureVolumeControllable(): Promise<void> {
		const needsFreshState = (): boolean => this.#isObservationStale() || this.state.value.device?.volumePercent === undefined;
		if (needsFreshState() && this.#fetchInFlight !== undefined) {
			// A read is already on its way; use it rather than sending a second one.
			await this.#fetchInFlight;
		}
		if (needsFreshState()) {
			await this.#fetch({ forCommand: true });
			if (this.#lastFetchFailed) {
				throw this.#lastFetchError;
			}
			this.#assertNotBlocked();
		}

		const snapshot = this.state.value;
		const device = snapshot.device;
		if (snapshot.availability === "inactive" || device === undefined) {
			this.state.update({ notice: { code: "no-active-device", message: new SpotifyNoActiveDeviceError().message } });
			throw new SpotifyNoActiveDeviceError();
		}
		if (device.isRestricted) {
			this.state.update({ notice: { code: "device-restricted", message: new SpotifyDeviceRestrictedError().message } });
			throw new SpotifyDeviceRestrictedError();
		}
		if (!device.supportsVolume) {
			throw new SpotifyVolumeUnsupportedError();
		}
		if (device.volumePercent === undefined) {
			throw new SpotifyVolumeUnsupportedError("The active Spotify device did not report its volume.");
		}
	}

	/**
	 * Sends the desired volume until Spotify has accepted the newest one. Only one sequence runs at a time; presses during it just move the
	 * target, which the running sequence picks up.
	 * @returns Promise resolved when the newest volume was accepted (rejected when a request failed).
	 */
	#drainVolume(): Promise<void> {
		if (this.#volumeDraining && this.#volumeDrain !== undefined) {
			return this.#volumeDrain;
		}
		this.#volumeDraining = true;
		this.#volumeDrain = this.#runVolumeDrain();
		return this.#volumeDrain;
	}

	/**
	 * The set-volume loop (see {@link drainVolume}).
	 */
	async #runVolumeDrain(): Promise<void> {
		try {
			while (this.#volumeTarget !== undefined && this.#volumeTarget !== this.#volumeSent) {
				const target = this.#volumeTarget;
				await this.#transport.setVolume(target);
				this.#volumeSent = target;
				// State reads that started before Spotify applied this volume are stale.
				this.#commandEpoch++;
				this.#rememberVolume(target);
				const device = this.state.value.device;
				if (device !== undefined && device.volumePercent !== target) {
					this.state.update({ device: { ...device, volumePercent: target } });
				}
			}
		} catch (err) {
			this.#handleError(err);
			this.#logger.warn(`Volume change failed: ${describeError(err)}`);
			throw err;
		} finally {
			// Runs in the same turn as the loop's last check, so a press can never join a sequence that has already ended.
			this.#volumeDraining = false;
			this.#volumeTarget = undefined;
			this.#volumeSent = undefined;
			this.#commandEpoch++;
			// On failure the keys fall back to the last volume Spotify accepted; the reconciliation read below shows the real one.
			this.state.update({ pendingVolume: undefined });
			this.#schedule(this.#timing.reconcileDelayMs, { replace: true });
		}
	}

	/**
	 * Remembers a non-zero volume for Unmute.
	 * @param volumePercent Volume.
	 */
	#rememberVolume(volumePercent: number | undefined): void {
		if (volumePercent !== undefined && volumePercent > 0) {
			this.#lastNonZeroVolume = volumePercent;
		}
	}

	/**
	 * Throws when the account cannot control playback at all (checked before any local or Web API attempt).
	 */
	#assertAccountAllowsCommands(): void {
		if (!this.#connected) {
			throw new PlaybackUnavailableError(signedOutNotice(this.#auth.snapshot).message);
		}
		if (this.state.value.premiumRequired) {
			throw new SpotifyPremiumRequiredError();
		}
	}

	/**
	 * Throws when a Web API command cannot succeed, without sending it.
	 */
	async #assertWebApiCommandAllowed(): Promise<void> {
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
		if (this.#blockedBy !== undefined && this.#isBlocked()) {
			throw this.#blockedBy;
		}
	}

	/**
	 * Whether Web API requests are paused by a rate limit or quota.
	 * @returns `true` while backing off.
	 */
	#isBlocked(): boolean {
		return this.#clock() < this.#blockedUntil;
	}

	/**
	 * Publishes whether a local Spotify session can take commands.
	 * @param available Availability.
	 */
	#setLocalControl(available: boolean): void {
		if (this.state.value.localControl !== available) {
			this.state.update({ localControl: available });
		}
	}

	/**
	 * Refreshes local availability (local IPC only; no Spotify request).
	 */
	#probeLocal(): void {
		const local = this.#local;
		if (local === undefined) {
			return;
		}
		local
			.isAvailable()
			.then((available) => {
				if (this.#connected) {
					this.#setLocalControl(available);
				}
			})
			.catch(() => undefined);
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
		this.#probeLocal();

		const run = (async (): Promise<void> => {
			try {
				const observation = await this.#transport.getState();
				this.#lastFetchFailed = false;
				if (!this.#connected) {
					return;
				}
				if (epoch !== this.#commandEpoch || ((this.#commandInFlight !== undefined || this.#volumeDraining) && options.forCommand !== true)) {
					// Started before a command changed the player; its result may be stale. The command schedules its own reconciliation.
					return;
				}
				this.#applyObservation(observation);
			} catch (err) {
				this.#lastFetchFailed = true;
				this.#lastFetchError = err;
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

		this.#rememberVolume(observation.device?.volumePercent);
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
			if (err.reason === "VOLUME_CONTROL_DISALLOW") {
				// The device refused a volume change: show it as not supporting volume until Spotify reports otherwise.
				const device = this.state.value.device;
				this.state.update({ device: device === undefined ? undefined : { ...device, supportsVolume: false } });
			}
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
 * Clamps a volume to Spotify's range.
 * @param value Volume.
 * @returns A whole percent from 0 to 100.
 */
function clampVolume(value: number): number {
	return Math.min(100, Math.max(0, Math.round(value)));
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
			return { code: "reauthorization-required", message: "Reconnect Spotify in the Spotify Account key to enable Deckify's Spotify controls." };
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
