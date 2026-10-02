import { PlaybackUnavailableError } from "../playback/errors";
import type { CommandOutcome } from "../playback/service";
import type { PlaybackSnapshot } from "../playback/state";
import { Observable } from "../shared/observable";
import { silentLogger, type Logger } from "../shared/logger";
import {
	SpotifyApiError,
	SpotifyError,
	SpotifyNoActiveDeviceError,
	SpotifyNotConnectedError,
	SpotifyPremiumRequiredError,
	SpotifyQuotaExceededError,
	SpotifyRateLimitError,
	SpotifyReauthorizationRequiredError,
	SpotifyUnauthorizedError,
} from "../spotify/errors";
import { LibraryItemUnsupportedError } from "./errors";
import { classifyLibraryItem, EMPTY_LIBRARY_SNAPSHOT, type LibraryItemKind, type LibraryNoticeCode, type LibrarySnapshot } from "./state";
import type { LibraryTransport } from "./transport";

/**
 * Library request timings.
 */
export const LibraryTiming = {
	/** Retry delay after a failed saved-state check (network or server errors). */
	errorRetryMs: 30_000,

	/** Back-off when Spotify rate limits without a Retry-After header. */
	defaultRateLimitBackoffMs: 10_000,

	/** Back-off when the Development Mode quota is exhausted without a Retry-After header. */
	defaultQuotaBackoffMs: 30 * 60_000,
} as const;

export type LibraryTimingOptions = { readonly [K in keyof typeof LibraryTiming]: number };

/**
 * Dependencies of {@link LibraryService}.
 */
export type LibraryServiceOptions = {
	readonly transport: LibraryTransport;

	/** The shared playback state: the current item, the account state and Premium. */
	readonly playback: Observable<PlaybackSnapshot>;

	/** Called when Spotify still rejects the access token after the API client's refresh-and-retry. */
	readonly onAuthRejected?: () => Promise<void> | void;

	readonly clock?: () => number;
	readonly logger?: Logger;
	readonly timing?: Partial<LibraryTimingOptions>;
};

/**
 * The single owner of the current track's Liked Songs state, shared by every Like key.
 *
 * - Checks the saved state only when needed: while a Like key is visible, for a Spotify track, when the track changes, when Spotify
 *   reconnects, when a Like key first becomes visible, and after a failed like / unlike. Never for episodes, ads, local files or unknown
 *   items, and never by polling.
 * - The displayed state always belongs to the track playing now: late answers for an earlier track are ignored (URI and generation guards).
 * - Like / unlike targets the track that was playing when the key was pressed, even if another track starts before Spotify answers.
 * - Backs off on its own rate limits without affecting playback (local Phase 4 commands keep working).
 */
export class LibraryService {
	/** Shared saved state of the current track. */
	readonly state: Observable<LibrarySnapshot>;

	readonly #transport: LibraryTransport;
	readonly #onAuthRejected: (() => Promise<void> | void) | undefined;
	readonly #clock: () => number;
	readonly #logger: Logger;
	readonly #timing: LibraryTimingOptions;
	readonly #unsubscribePlayback: () => void;

	readonly #viewers = new Set<string>();
	#disposed = false;
	#signedIn = false;
	#premiumRequired = false;
	#playbackInactive = false;

	#kind: LibraryItemKind = "none";
	#currentUri: string | undefined;

	/** The last known saved state, for one track. Kept while nothing (or something else) plays, so returning to it needs no new check. */
	#known: { readonly uri: string; readonly saved: boolean } | undefined;
	/** The known state must be confirmed with Spotify (after reconnecting, a Like key appearing, or a failed like / unlike). */
	#needsCheck = true;

	/** Incremented for every check and every like / unlike; a check's answer is only used if nothing newer started since. */
	#generation = 0;
	#checking: { readonly uri: string; readonly generation: number } | undefined;

	#mutation: Promise<void> | undefined;
	#mutationUri: string | undefined;

	#blockedUntil = 0;
	#blockedBy: SpotifyRateLimitError | undefined;
	#notice: LibraryNoticeCode | undefined;
	#retryAt = 0;
	#timer: NodeJS.Timeout | undefined;

	/**
	 * Initializes a new instance of the {@link LibraryService} class.
	 * @param options Dependencies.
	 */
	constructor(options: LibraryServiceOptions) {
		this.#transport = options.transport;
		this.#onAuthRejected = options.onAuthRejected;
		this.#clock = options.clock ?? Date.now;
		this.#logger = options.logger ?? silentLogger;
		this.#timing = { ...LibraryTiming, ...options.timing };
		this.state = new Observable<LibrarySnapshot>(EMPTY_LIBRARY_SNAPSHOT, this.#logger);

		this.#onPlayback(options.playback.value);
		this.#unsubscribePlayback = options.playback.subscribe((snapshot) => {
			this.#onPlayback(snapshot);
		});
	}

	/**
	 * Number of visible Like keys.
	 * @returns The count.
	 */
	get viewerCount(): number {
		return this.#viewers.size;
	}

	/**
	 * Registers a visible Like key. The first visible key confirms the current track's saved state.
	 * @param id Unique key instance ID.
	 */
	addViewer(id: string): void {
		const wasIdle = this.#viewers.size === 0;
		this.#viewers.add(id);
		if (wasIdle) {
			this.#needsCheck = true;
			this.#maybeCheck();
		}
	}

	/**
	 * Unregisters a Like key; no library requests are made while none is visible.
	 * @param id Unique key instance ID.
	 */
	removeViewer(id: string): void {
		this.#viewers.delete(id);
		if (this.#viewers.size === 0) {
			this.#clearTimer();
		}
	}

	/**
	 * Likes the current track when it is not in Liked Songs, otherwise unlikes it. An unknown saved state is checked first; nothing is guessed.
	 *
	 * While a like / unlike is in flight, further presses are ignored (`"busy"`), so a quick double press never undoes itself.
	 * @returns `"done"` on success; `"busy"` when ignored.
	 * @throws {SpotifyError} When the current item cannot be liked or the request fails.
	 */
	async toggle(): Promise<CommandOutcome> {
		if (!this.#signedIn) {
			throw new PlaybackUnavailableError("Connect Spotify in the Spotify Account key first.");
		}
		if (this.#premiumRequired) {
			throw new SpotifyPremiumRequiredError();
		}
		if (this.#mutation !== undefined) {
			return "busy";
		}
		const uri = this.#currentUri;
		if (uri === undefined) {
			if (this.#kind === "unsupported") {
				throw new LibraryItemUnsupportedError();
			}
			throw this.#playbackInactive ? new SpotifyNoActiveDeviceError() : new LibraryItemUnsupportedError("Play a song in Spotify first.");
		}
		if (this.#blockedBy !== undefined && this.#isBlocked()) {
			throw this.#blockedBy;
		}

		const run = this.#runToggle(uri);
		this.#mutation = run;
		this.#mutationUri = uri;
		this.#publish();
		try {
			await run;
			return "done";
		} finally {
			this.#mutation = undefined;
			this.#mutationUri = undefined;
			this.#publish();
			this.#maybeCheck();
		}
	}

	/**
	 * Stops all timers and subscriptions.
	 */
	dispose(): void {
		this.#disposed = true;
		this.#clearTimer();
		this.#unsubscribePlayback();
	}

	/**
	 * Likes or unlikes one track (see {@link toggle}).
	 * @param uri The track playing when the key was pressed.
	 */
	async #runToggle(uri: string): Promise<void> {
		// Answers to checks that started before this request must not overwrite its result.
		this.#generation++;
		try {
			const saved = this.#known?.uri === uri ? this.#known.saved : await this.#transport.contains(uri);
			if (saved) {
				await this.#transport.remove(uri);
			} else {
				await this.#transport.save(uri);
			}
			this.#logger.info(saved ? "Library item removed." : "Library item saved.");
			this.#clearNotice();
			if (uri === this.#currentUri) {
				this.#generation++;
				this.#known = { uri, saved: !saved };
				this.#needsCheck = false;
			}
			// Otherwise another track started meanwhile: its own state is shown and checked separately.
		} catch (err) {
			this.#handleError(err, "Liking or unliking the current track failed");
			if (uri === this.#currentUri) {
				// The outcome is unknown: confirm the real state (after any back-off).
				this.#needsCheck = true;
			}
			throw err;
		}
	}

	/**
	 * Reacts to playback changes: the current track, the account and Premium.
	 * @param snapshot Playback state.
	 */
	#onPlayback(snapshot: PlaybackSnapshot): void {
		const signedIn = snapshot.availability !== "signed-out";
		if (!signedIn && this.#signedIn) {
			// Signed out: forget everything account-specific; a later sign-in checks again.
			this.#known = undefined;
			this.#generation++;
			this.#blockedUntil = 0;
			this.#blockedBy = undefined;
			this.#notice = undefined;
			this.#clearTimer();
		}
		if (signedIn && !this.#signedIn) {
			this.#needsCheck = true;
		}
		this.#signedIn = signedIn;
		this.#premiumRequired = snapshot.premiumRequired;
		this.#playbackInactive = snapshot.availability === "inactive";

		const { kind, uri } = classifyLibraryItem(snapshot);
		this.#kind = kind;
		this.#currentUri = uri;
		this.#publish();
		this.#maybeCheck();
	}

	/**
	 * Starts a saved-state check for the current track when one is needed and allowed.
	 */
	#maybeCheck(): void {
		const uri = this.#currentUri;
		if (this.#disposed || this.#viewers.size === 0 || !this.#signedIn || this.#premiumRequired || uri === undefined) {
			return;
		}
		if (this.#known?.uri === uri && !this.#needsCheck) {
			return;
		}
		if (this.#checking?.uri === uri || this.#mutationUri === uri) {
			// Already being checked, or a like / unlike for it will settle the state.
			return;
		}
		const now = this.#clock();
		const notBefore = Math.max(this.#blockedUntil, this.#retryAt);
		if (now < notBefore) {
			this.#scheduleCheck(notBefore - now);
			return;
		}
		void this.#check(uri);
	}

	/**
	 * Checks whether a track is saved.
	 * @param uri Track URI.
	 */
	async #check(uri: string): Promise<void> {
		const generation = ++this.#generation;
		this.#checking = { uri, generation };
		this.#needsCheck = false;
		this.#publish();
		try {
			const saved = await this.#transport.contains(uri);
			if (generation === this.#generation) {
				this.#known = { uri, saved };
				this.#retryAt = 0;
				this.#clearNotice();
			}
		} catch (err) {
			if (generation === this.#generation) {
				this.#needsCheck = true;
				this.#handleError(err, "Checking the current track's library state failed");
			}
		} finally {
			// Another check may have started meanwhile (the field changes across the await); only clear this one.
			this.#finishCheck(generation);
			this.#publish();
			this.#maybeCheck();
		}
	}

	/**
	 * Clears the in-flight check marker if it still belongs to the given check.
	 * @param generation The check's generation.
	 */
	#finishCheck(generation: number): void {
		if (this.#checking?.generation === generation) {
			this.#checking = undefined;
		}
	}

	/**
	 * Updates state for a failed library request.
	 * @param err The failure.
	 * @param what What failed, for the log (never contains track details).
	 */
	#handleError(err: unknown, what: string): void {
		this.#logger.warn(`${what} (${errorCode(err)}).`);
		if (err instanceof SpotifyRateLimitError) {
			const quota = err instanceof SpotifyQuotaExceededError;
			const fallback = quota ? this.#timing.defaultQuotaBackoffMs : this.#timing.defaultRateLimitBackoffMs;
			const backoff = err.retryAfterSeconds === undefined ? fallback : Math.max(err.retryAfterSeconds * 1000, 1000);
			this.#blockedUntil = this.#clock() + backoff;
			this.#blockedBy = err;
			this.#notice = quota ? "quota-exceeded" : "rate-limited";
			return;
		}
		// Never retry a failed check right away (that could loop): wait, whatever the failure.
		this.#retryAt = this.#clock() + this.#timing.errorRetryMs;
		if (err instanceof SpotifyReauthorizationRequiredError || err instanceof SpotifyNotConnectedError) {
			// The auth service has already published the account state.
			return;
		}
		if (err instanceof SpotifyUnauthorizedError) {
			void Promise.resolve(this.#onAuthRejected?.()).catch((authErr: unknown) => {
				this.#logger.error("Re-verifying the Spotify session failed.", authErr);
			});
			return;
		}
		this.#notice = "error";
	}

	/**
	 * Whether library requests are paused by a rate limit or quota.
	 * @returns `true` while backing off.
	 */
	#isBlocked(): boolean {
		return this.#clock() < this.#blockedUntil;
	}

	#clearNotice(): void {
		if (!this.#isBlocked()) {
			this.#blockedBy = undefined;
			this.#notice = undefined;
		}
	}

	/**
	 * Publishes the current state when it changed.
	 */
	#publish(): void {
		if (this.#notice !== undefined && this.#notice !== "error" && !this.#isBlocked()) {
			this.#notice = undefined;
			this.#blockedBy = undefined;
		}
		const uri = this.#currentUri;
		const next: LibrarySnapshot = {
			kind: this.#kind,
			uri,
			saved: uri !== undefined && this.#known?.uri === uri ? this.#known.saved : undefined,
			checking: uri !== undefined && this.#checking?.uri === uri,
			pending: uri !== undefined && this.#mutationUri === uri,
			notice: this.#notice,
		};
		const current = this.state.value;
		if (
			current.kind !== next.kind ||
			current.uri !== next.uri ||
			current.saved !== next.saved ||
			current.checking !== next.checking ||
			current.pending !== next.pending ||
			current.notice !== next.notice
		) {
			this.state.set(next);
		}
	}

	/**
	 * Schedules a check (one timer at most).
	 * @param delayMs Delay.
	 */
	#scheduleCheck(delayMs: number): void {
		if (this.#timer !== undefined) {
			return;
		}
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			this.#publish();
			this.#maybeCheck();
		}, delayMs);
	}

	#clearTimer(): void {
		if (this.#timer !== undefined) {
			clearTimeout(this.#timer);
			this.#timer = undefined;
		}
	}
}

/**
 * A short, metadata-free description of a failure for logs (no Spotify error text, which could echo request details).
 * @param err The failure.
 * @returns E.g. `rate-limited` or `api-error 500`.
 */
function errorCode(err: unknown): string {
	if (err instanceof SpotifyApiError) {
		return `${err.code} ${String(err.status)}`;
	}
	return err instanceof SpotifyError ? err.code : "unexpected error";
}
