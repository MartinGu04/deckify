import { isLibraryTrackUri } from "../library/state";
import { LibraryItemUnsupportedError } from "../library/errors";
import { PlaybackUnavailableError } from "../playback/errors";
import type { CommandOutcome } from "../playback/service";
import type { PlaybackSnapshot } from "../playback/state";
import { Observable } from "../shared/observable";
import { silentLogger, type Logger } from "../shared/logger";
import {
	SpotifyApiError,
	SpotifyError,
	SpotifyNotConnectedError,
	SpotifyPremiumRequiredError,
	SpotifyQuotaExceededError,
	SpotifyRateLimitError,
	SpotifyReauthorizationRequiredError,
	SpotifyUnauthorizedError,
} from "../spotify/errors";
import type { SpotifyAuthSnapshot, SpotifyAuthState } from "../spotify/state/auth-state";
import { PlaylistNotSelectedError, PlaylistNotWritableError, PlaylistUnavailableError } from "./errors";
import { isWritablePlaylist, type Playlist, type PlaylistMetadata } from "./model";
import type { PlaylistSelection } from "./selection";
import type { PlaylistTransport } from "./transport";

/**
 * Playlist timings and limits.
 */
export const PlaylistTiming = {
	/** A loaded playlist list is reused this long before the next Property Inspector or press loads it again. */
	listTtlMs: 5 * 60_000,

	/** Back-off when Spotify rate limits without a Retry-After header. */
	defaultRateLimitBackoffMs: 10_000,

	/** Back-off when the Development Mode quota is exhausted without a Retry-After header. */
	defaultQuotaBackoffMs: 30 * 60_000,

	/** At most this many pages of playlists (50 each) are read. */
	maxListPages: 40,

	/** At most this many pages of items (50 each) are scanned for duplicates; Spotify playlists hold at most 10,000 items. */
	maxItemPages: 200,
} as const;

export type PlaylistTimingOptions = { readonly [K in keyof typeof PlaylistTiming]: number };

const PAGE_SIZE = 50;

/** Where the playlist list stands for the current account. */
export type PlaylistListStatus = "signed-out" | "reauthorization-required" | "idle" | "loading" | "ready" | "limited" | "error";

/**
 * The shared playlist state observed by the playlist keys and Property Inspectors. Contains no tokens.
 */
export type PlaylistSnapshot = {
	readonly status: PlaylistListStatus;

	/** The account's playlists in Spotify's order, once loaded (they stay available while refreshing or limited). */
	readonly playlists: readonly Playlist[] | undefined;

	/** Playlists Spotify reported as gone (or no longer writable) since the list was loaded. */
	readonly unavailable: ReadonlySet<string>;

	/** IDs of playlists an Add is currently running for. */
	readonly adding: ReadonlySet<string>;

	/** Seconds until requests are allowed again, while limited. */
	readonly retryAfterSeconds: number | undefined;
};

/** Where a selected playlist stands. */
export type PlaylistLookup =
	| { readonly status: "unknown" }
	| { readonly status: "missing" }
	| { readonly status: "found"; readonly playlist: Playlist };

/** Result of Add Current Track. */
export type AddOutcome = "added" | "already-present" | "busy";

/**
 * Dependencies of {@link PlaylistService}.
 */
export type PlaylistServiceOptions = {
	readonly transport: PlaylistTransport;

	/** Account state: the authenticated user decides which playlists are writable; any account change clears all cached data. */
	readonly auth: SpotifyAuthState;

	/** Starts a playlist on the active device (the shared playback service: device checks, Premium, rate limits, serialization). */
	readonly playback: { readonly state: Observable<PlaybackSnapshot>; playContext(contextUri: string): Promise<CommandOutcome> };

	/** Called when Spotify still rejects the access token after the API client's refresh-and-retry. */
	readonly onAuthRejected?: () => Promise<void> | void;

	readonly clock?: () => number;
	readonly logger?: Logger;
	readonly timing?: Partial<PlaylistTimingOptions>;
};

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * The single owner of playlist data, shared by every playlist key and Property Inspector.
 *
 * - Loads all of the user's playlists (paginated) only when needed: when a playlist Property Inspector opens, on Refresh, or when a key
 *   needs it; reuses the list for a few minutes; never polls. Concurrent requests share one fetch, and a late answer from an older fetch
 *   (or from a previous account) never replaces newer data.
 * - Writable = owned by the authenticated user, or collaborative. Never derived from `public` or the name.
 * - Add Current Track: checks the playlist's current snapshot, scans its items only when the snapshot changed (cached URI set per
 *   snapshot), never posts a track that is already there, serializes adds per playlist, and always adds the URI captured at the press.
 * - Backs off on its own rate limits without affecting playback, and forgets everything when the account changes.
 */
export class PlaylistService {
	/** Shared playlist state. */
	readonly state: Observable<PlaylistSnapshot>;

	readonly #transport: PlaylistTransport;
	readonly #playback: PlaylistServiceOptions["playback"];
	readonly #onAuthRejected: (() => Promise<void> | void) | undefined;
	readonly #clock: () => number;
	readonly #logger: Logger;
	readonly #timing: PlaylistTimingOptions;
	readonly #unsubscribeAuth: () => void;

	#authStatus: SpotifyAuthSnapshot["status"] = "not-configured";
	#userId: string | undefined;
	/** Incremented on every account change; answers that started under an older account are discarded. */
	#generation = 0;

	#list: { readonly playlists: readonly Playlist[]; readonly fetchedAt: number } | undefined;
	#listInFlight: { readonly promise: Promise<readonly Playlist[]>; readonly seq: number } | undefined;
	/** Incremented for every list fetch. */
	#listSeq = 0;
	/** The fetch whose result is currently published; an older fetch never replaces it. */
	#appliedSeq = 0;
	#listError = false;

	/** Duplicate detection: the item URIs of a playlist at a snapshot. */
	readonly #itemCache = new Map<string, { readonly snapshotId: string; readonly uris: ReadonlySet<string> }>();
	readonly #adding = new Set<string>();
	readonly #unavailable = new Set<string>();

	#blockedUntil = 0;
	#blockedBy: SpotifyRateLimitError | undefined;
	#timer: NodeJS.Timeout | undefined;

	/**
	 * Initializes a new instance of the {@link PlaylistService} class.
	 * @param options Dependencies.
	 */
	constructor(options: PlaylistServiceOptions) {
		this.#transport = options.transport;
		this.#playback = options.playback;
		this.#onAuthRejected = options.onAuthRejected;
		this.#clock = options.clock ?? Date.now;
		this.#logger = options.logger ?? silentLogger;
		this.#timing = { ...PlaylistTiming, ...options.timing };
		this.state = new Observable<PlaylistSnapshot>(
			{ status: "signed-out", playlists: undefined, unavailable: EMPTY_SET, adding: EMPTY_SET, retryAfterSeconds: undefined },
			this.#logger,
		);

		this.#onAuthChanged(options.auth.snapshot);
		this.#unsubscribeAuth = options.auth.subscribe((snapshot) => {
			this.#onAuthChanged(snapshot);
		});
	}

	/**
	 * The authenticated user's Spotify ID, while connected.
	 * @returns The ID.
	 */
	get userId(): string | undefined {
		return this.#userId;
	}

	/**
	 * Gets the user's playlists: the cached list while it is fresh, otherwise a new (shared) fetch of every page.
	 * @param options Options.
	 * @param options.force Bypass the cache (Refresh).
	 * @returns The playlists, in Spotify's order.
	 * @throws {SpotifyError} When not connected, rate limited without a cached list, or the request fails.
	 */
	async getPlaylists(options: { force?: boolean } = {}): Promise<readonly Playlist[]> {
		this.#assertConnected();
		const cached = this.#list;
		if (this.#isBlocked()) {
			if (cached !== undefined) {
				return cached.playlists;
			}
			throw this.#blockedBy ?? new SpotifyRateLimitError(undefined, undefined);
		}
		if (options.force !== true && cached !== undefined && this.#clock() - cached.fetchedAt < this.#timing.listTtlMs) {
			return cached.playlists;
		}
		if (options.force !== true && this.#listInFlight !== undefined) {
			return this.#listInFlight.promise;
		}
		return this.#startListFetch();
	}

	/**
	 * Looks up a playlist in the loaded list.
	 * @param playlistId Playlist ID.
	 * @returns `unknown` until the list is loaded for this account; `missing` when it is not (or no longer) available.
	 */
	lookup(playlistId: string): PlaylistLookup {
		if (this.#unavailable.has(playlistId)) {
			return { status: "missing" };
		}
		const list = this.#list;
		if (list === undefined) {
			return { status: "unknown" };
		}
		const playlist = list.playlists.find((p) => p.id === playlistId);
		return playlist === undefined ? { status: "missing" } : { status: "found", playlist };
	}

	/**
	 * Adds a track to a playlist unless it is already there.
	 *
	 * The track URI must be the one captured when the key was pressed, so a track change during the request can never add another track.
	 * While an add to the same playlist is running, further presses are ignored (`"busy"`), so a double press never adds two copies.
	 * @param selection The key's playlist.
	 * @param trackUri The current Spotify track's URI at the press.
	 * @returns `added`, `already-present` or `busy`.
	 * @throws {SpotifyError} When adding is not possible (not connected, Premium, unavailable or non-writable playlist, rate limited, ...).
	 */
	async addTrack(selection: PlaylistSelection | undefined, trackUri: string | undefined): Promise<AddOutcome> {
		this.#assertCanControl();
		if (selection === undefined) {
			throw new PlaylistNotSelectedError();
		}
		if (!isLibraryTrackUri(trackUri)) {
			throw new LibraryItemUnsupportedError("Only Spotify songs can be added to a playlist.");
		}
		const id = selection.playlistId;
		if (this.#adding.has(id)) {
			return "busy";
		}
		this.#assertNotBlocked();

		this.#adding.add(id);
		this.#publish();
		const generation = this.#generation;
		try {
			const outcome = await this.#add(id, trackUri, generation);
			this.#logger.info(outcome === "added" ? "Playlist item added." : "Playlist item already present.");
			return outcome;
		} catch (err) {
			this.#handleError(err, "Adding to a playlist failed", generation, id);
			throw toPlaylistError(err);
		} finally {
			this.#adding.delete(id);
			this.#publish();
		}
	}

	/**
	 * Starts a playlist on the active device (Spotify Web API `PUT /me/player/play` with its context URI).
	 * @param selection The key's playlist.
	 * @returns `"done"` on success; `"busy"` when another playback command was in flight.
	 * @throws {SpotifyError} When playback is not possible (no device, restricted, Premium, limited, unavailable playlist, ...).
	 */
	async play(selection: PlaylistSelection | undefined): Promise<CommandOutcome> {
		this.#assertConnected();
		if (selection === undefined) {
			throw new PlaylistNotSelectedError();
		}
		if (this.lookup(selection.playlistId).status === "missing") {
			throw new PlaylistUnavailableError();
		}
		const generation = this.#generation;
		try {
			const outcome = await this.#playback.playContext(selection.playlistUri);
			if (outcome === "done") {
				this.#logger.info("Playlist playback started.");
			}
			return outcome;
		} catch (err) {
			if (isNotFound(err) && generation === this.#generation) {
				this.#unavailable.add(selection.playlistId);
				this.#publish();
				throw new PlaylistUnavailableError();
			}
			throw err;
		}
	}

	/**
	 * Stops timers and subscriptions.
	 */
	dispose(): void {
		this.#clearTimer();
		this.#unsubscribeAuth();
	}

	/**
	 * Runs one add (see {@link addTrack}).
	 * @param id Playlist ID.
	 * @param trackUri Track URI captured at the press.
	 * @param generation Account generation at the press.
	 * @returns The outcome.
	 */
	async #add(id: string, trackUri: string, generation: number): Promise<AddOutcome> {
		// The playlist's current metadata: it must still exist, still be writable, and its snapshot says whether cached items are current.
		const metadata = await this.#transport.getPlaylist(id);
		this.#assertSameAccount(generation);
		const userId = this.#userId;
		if (userId === undefined || !isWritablePlaylist(metadata, userId)) {
			this.#unavailable.add(id);
			throw new PlaylistNotWritableError();
		}
		this.#updateCachedPlaylist(metadata, userId);

		const uris = await this.#itemUris(id, metadata.snapshotId, generation);
		if (uris.has(trackUri)) {
			return "already-present";
		}

		const { snapshotId } = await this.#transport.addItem(id, trackUri);
		if (generation === this.#generation) {
			if (snapshotId === undefined) {
				// Without the new snapshot the cache cannot be trusted; the next add scans again.
				this.#itemCache.delete(id);
			} else {
				this.#itemCache.set(id, { snapshotId, uris: new Set([...uris, trackUri]) });
				this.#updateCachedPlaylist({ ...metadata, snapshotId, itemCount: metadata.itemCount === undefined ? undefined : metadata.itemCount + 1 }, userId);
			}
		}
		return "added";
	}

	/**
	 * The URIs in a playlist at a snapshot: cached when the snapshot is unchanged, otherwise read page by page.
	 * @param id Playlist ID.
	 * @param snapshotId Current snapshot ID (when Spotify reports one).
	 * @param generation Account generation.
	 * @returns The URIs.
	 */
	async #itemUris(id: string, snapshotId: string | undefined, generation: number): Promise<ReadonlySet<string>> {
		const cached = this.#itemCache.get(id);
		if (snapshotId !== undefined && cached?.snapshotId === snapshotId) {
			return cached.uris;
		}
		const uris = new Set<string>();
		let offset = 0;
		for (let page = 0; ; page++) {
			if (page >= this.#timing.maxItemPages) {
				// Fail closed: without the whole playlist, a duplicate could go unnoticed.
				throw new SpotifyError("playlist-too-large", "This playlist is too large to check for duplicates.");
			}
			const result = await this.#transport.listItems(id, offset, PAGE_SIZE);
			this.#assertSameAccount(generation);
			for (const uri of result.uris) {
				uris.add(uri);
			}
			offset += result.entryCount;
			if (result.entryCount < PAGE_SIZE || (result.total !== undefined && offset >= result.total)) {
				break;
			}
		}
		if (snapshotId === undefined) {
			this.#itemCache.delete(id);
		} else {
			this.#itemCache.set(id, { snapshotId, uris });
		}
		return uris;
	}

	/**
	 * Starts a list fetch. A result is published only for the current account and only if no newer fetch has published already.
	 * @returns The playlists.
	 */
	#startListFetch(): Promise<readonly Playlist[]> {
		const seq = ++this.#listSeq;
		const generation = this.#generation;
		const promise = (async (): Promise<readonly Playlist[]> => {
			try {
				const playlists = await this.#fetchAllPlaylists(generation);
				if (generation === this.#generation && seq > this.#appliedSeq) {
					this.#appliedSeq = seq;
					this.#list = { playlists, fetchedAt: this.#clock() };
					this.#listError = false;
					// Freshly listed playlists are available again.
					for (const playlist of playlists) {
						this.#unavailable.delete(playlist.id);
					}
					this.#logger.info("Playlist list refreshed.");
				}
				// An older fetch never replaces newer data; its caller gets the newest list available.
				return seq >= this.#appliedSeq || this.#list === undefined ? playlists : this.#list.playlists;
			} catch (err) {
				if (generation === this.#generation && seq === this.#listSeq) {
					this.#listError = !(err instanceof SpotifyRateLimitError);
				}
				this.#handleError(err, "Loading playlists failed", generation);
				throw err;
			} finally {
				if (this.#listInFlight?.seq === seq) {
					this.#listInFlight = undefined;
				}
				this.#publish();
			}
		})();
		this.#listInFlight = { promise, seq };
		this.#publish();
		return promise;
	}

	/**
	 * Reads every page of the user's playlists.
	 * @param generation Account generation.
	 * @returns The playlists (duplicates across pages removed), with writability for the current user.
	 */
	async #fetchAllPlaylists(generation: number): Promise<Playlist[]> {
		const byId = new Map<string, Playlist>();
		let offset = 0;
		for (let page = 0; page < this.#timing.maxListPages; page++) {
			const result = await this.#transport.listPlaylists(offset, PAGE_SIZE);
			this.#assertSameAccount(generation);
			const userId = this.#userId ?? "";
			for (const metadata of result.playlists) {
				if (!byId.has(metadata.id)) {
					byId.set(metadata.id, { ...metadata, writable: isWritablePlaylist(metadata, userId) });
				}
			}
			offset += result.entryCount;
			if (result.entryCount < PAGE_SIZE || (result.total !== undefined && offset >= result.total)) {
				break;
			}
		}
		return [...byId.values()];
	}

	/**
	 * Updates one playlist in the cached list (e.g. after it was renamed or changed), keeping its position.
	 * @param metadata Current metadata.
	 * @param userId Authenticated user.
	 */
	#updateCachedPlaylist(metadata: PlaylistMetadata, userId: string): void {
		const list = this.#list;
		if (list === undefined) {
			return;
		}
		const index = list.playlists.findIndex((p) => p.id === metadata.id);
		if (index < 0) {
			return;
		}
		const previous = list.playlists[index];
		const next: Playlist = {
			...metadata,
			itemCount: metadata.itemCount ?? previous?.itemCount,
			spotifyUrl: metadata.spotifyUrl ?? previous?.spotifyUrl,
			writable: isWritablePlaylist(metadata, userId),
		};
		const playlists = [...list.playlists];
		playlists[index] = next;
		this.#list = { ...list, playlists };
	}

	/**
	 * Reacts to account changes: a different user, a reconnect, a disconnect or a session reset clears every cached playlist and item.
	 * @param snapshot Account state.
	 */
	#onAuthChanged(snapshot: SpotifyAuthSnapshot): void {
		const userId = snapshot.status === "connected" ? snapshot.profile?.id : undefined;
		const reconnected = snapshot.status === "connected" && this.#authStatus !== "connected";
		const statusChanged = snapshot.status !== this.#authStatus;
		this.#authStatus = snapshot.status;
		if (userId !== this.#userId || reconnected || (statusChanged && snapshot.status !== "connected")) {
			this.#userId = userId;
			this.#generation++;
			this.#list = undefined;
			this.#listInFlight = undefined;
			this.#listError = false;
			this.#itemCache.clear();
			this.#unavailable.clear();
			this.#blockedUntil = 0;
			this.#blockedBy = undefined;
			this.#clearTimer();
		}
		this.#publish();
	}

	/**
	 * Updates state for a failed request. Errors from a previous account are ignored.
	 * @param err The failure.
	 * @param what What failed, for the log (never contains playlist or track details).
	 * @param generation Account generation of the request.
	 * @param playlistId The playlist concerned, if any.
	 */
	#handleError(err: unknown, what: string, generation: number, playlistId?: string): void {
		this.#logger.warn(`${what} (${errorCode(err)}).`);
		if (generation !== this.#generation) {
			return;
		}
		if (err instanceof SpotifyRateLimitError) {
			const quota = err instanceof SpotifyQuotaExceededError;
			const fallback = quota ? this.#timing.defaultQuotaBackoffMs : this.#timing.defaultRateLimitBackoffMs;
			const backoff = err.retryAfterSeconds === undefined ? fallback : Math.max(err.retryAfterSeconds * 1000, 1000);
			this.#blockedUntil = this.#clock() + backoff;
			this.#blockedBy = err;
			this.#clearTimer();
			// Publish again when the back-off ends, so keys and Property Inspectors stop showing Limited.
			this.#timer = setTimeout(() => {
				this.#timer = undefined;
				this.#publish();
			}, backoff);
			return;
		}
		if (err instanceof SpotifyUnauthorizedError) {
			void Promise.resolve(this.#onAuthRejected?.()).catch((authErr: unknown) => {
				this.#logger.error("Re-verifying the Spotify session failed.", authErr);
			});
			return;
		}
		if (playlistId !== undefined && isNotFound(err)) {
			this.#unavailable.add(playlistId);
		}
	}

	#assertConnected(): void {
		if (this.#authStatus === "reauthorization-required") {
			throw new PlaybackUnavailableError("Reconnect Spotify in the Spotify Account key to use playlists.");
		}
		if (this.#authStatus !== "connected" || this.#userId === undefined) {
			throw new PlaybackUnavailableError("Connect Spotify in the Spotify Account key first.");
		}
	}

	/**
	 * Throws unless the account may change playlists (connected and Premium, like every Deckify control).
	 */
	#assertCanControl(): void {
		this.#assertConnected();
		if (this.#playback.state.value.premiumRequired) {
			throw new SpotifyPremiumRequiredError();
		}
	}

	#assertNotBlocked(): void {
		if (this.#isBlocked()) {
			throw this.#blockedBy ?? new SpotifyRateLimitError(undefined, undefined);
		}
	}

	/**
	 * Throws when the account changed while a request was running.
	 * @param generation Generation at the start.
	 */
	#assertSameAccount(generation: number): void {
		if (generation !== this.#generation) {
			throw new SpotifyNotConnectedError();
		}
	}

	#isBlocked(): boolean {
		return this.#clock() < this.#blockedUntil;
	}

	/**
	 * Publishes the current state.
	 */
	#publish(): void {
		let status: PlaylistListStatus;
		if (this.#authStatus === "reauthorization-required") {
			status = "reauthorization-required";
		} else if (this.#authStatus !== "connected") {
			status = "signed-out";
		} else if (this.#isBlocked()) {
			status = "limited";
		} else if (this.#listInFlight !== undefined) {
			status = "loading";
		} else if (this.#listError) {
			status = "error";
		} else {
			status = this.#list === undefined ? "idle" : "ready";
		}
		this.state.set({
			status,
			playlists: this.#list?.playlists,
			unavailable: new Set(this.#unavailable),
			adding: new Set(this.#adding),
			retryAfterSeconds: this.#isBlocked() ? Math.ceil((this.#blockedUntil - this.#clock()) / 1000) : undefined,
		});
	}

	#clearTimer(): void {
		if (this.#timer !== undefined) {
			clearTimeout(this.#timer);
			this.#timer = undefined;
		}
	}
}

/**
 * Whether Spotify said the playlist does not exist (HTTP 404 without a player reason).
 * @param err The failure.
 * @returns `true` for a plain 404.
 */
function isNotFound(err: unknown): boolean {
	return err instanceof SpotifyApiError && err.status === 404 && err.reason === undefined;
}

/**
 * Maps a failure to the error shown for a playlist key.
 * @param err The failure.
 * @returns A playlist-specific error where one applies.
 */
function toPlaylistError(err: unknown): unknown {
	return isNotFound(err) ? new PlaylistUnavailableError() : err;
}

/**
 * A short, metadata-free description of a failure for logs.
 * @param err The failure.
 * @returns E.g. `rate-limited 429`.
 */
function errorCode(err: unknown): string {
	if (err instanceof SpotifyApiError) {
		return `${err.code} ${String(err.status)}`;
	}
	if (err instanceof SpotifyReauthorizationRequiredError || err instanceof SpotifyError) {
		return err.code;
	}
	return "unexpected error";
}
