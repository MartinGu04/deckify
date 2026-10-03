import { silentLogger, type Logger } from "../../shared/logger";
import { SpotifyApiClient, type AccessTokenProvider } from "../api/client";
import { fetchCurrentUserProfile, type SpotifyProfile } from "../api/profile";
import { ACCESS_TOKEN_REFRESH_MARGIN_MS, AUTHORIZATION_TIMEOUT_MS, REFRESH_TOKEN_LIFETIME_MS } from "../config";
import {
	AuthorizationCancelledError,
	AuthorizationDeniedError,
	describeError,
	SpotifyClientIdError,
	SpotifyForbiddenError,
	SpotifyInsufficientScopeError,
	SpotifyNotConnectedError,
	SpotifyOAuthError,
	SpotifyReauthorizationRequiredError,
	SpotifyUnauthorizedError,
} from "../errors";
import type { HttpOptions } from "../http";
import type { SpotifyAuthState, SpotifyAuthStatus } from "../state/auth-state";
import type { StoredSpotifySession, TokenStore } from "../storage/token-store";
import { buildAuthorizationUrl } from "./authorize-url";
import { startCallbackListener, type CallbackListener, type CallbackListenerOptions } from "./callback-server";
import { createPkceAttempt, type PkceAttempt } from "./pkce";
import { getMissingScopes, SPOTIFY_SCOPES } from "./scopes";
import { exchangeAuthorizationCode, refreshAccessToken } from "./token-client";

/** Shown when a stored session lacks scopes Deckify now requires (e.g. a session from before playback or library scopes were added). */
export const SCOPE_UPGRADE_MESSAGE =
	"Deckify needs additional Spotify permissions for new features (playback, volume, Liked Songs and playlists). Press Reconnect Spotify to authorize Deckify again.";

/**
 * Dependencies of {@link SpotifyAuthService}; everything with side effects is injectable for tests.
 */
export type SpotifyAuthServiceOptions = {
	/** Shared state published to every Spotify action. */
	readonly state: SpotifyAuthState;

	/** Secure session storage. */
	readonly tokenStore: TokenStore;

	/** Opens a URL in the user's default browser. */
	readonly openUrl: (url: string) => Promise<void>;

	readonly http?: HttpOptions;

	/** Current time (Unix epoch, milliseconds). */
	readonly clock?: () => number;

	readonly logger?: Logger;

	/** Starts the local callback listener; replaced in tests. */
	readonly startCallbackListener?: (options: CallbackListenerOptions) => Promise<CallbackListener>;

	/** Creates PKCE values; replaced in tests. */
	readonly createPkceAttempt?: () => PkceAttempt;

	/** How long to wait for the user to finish signing in. */
	readonly authorizationTimeoutMs?: number;
};

/**
 * Owns the Spotify session: connecting (Authorization Code with PKCE), restoring on startup, refreshing, verifying and disconnecting.
 *
 * Tokens only ever live in this service's memory and in the {@link TokenStore}; they are never published to the shared state, settings or
 * the Property Inspector, and never logged. Operations do not throw: failures are published to {@link SpotifyAuthState} with a user-facing
 * message.
 */
export class SpotifyAuthService implements AccessTokenProvider {
	/** Authenticated Web API client backed by this service's tokens. */
	readonly api: SpotifyApiClient;

	readonly #state: SpotifyAuthState;
	readonly #store: TokenStore;
	readonly #openUrl: (url: string) => Promise<void>;
	readonly #http: HttpOptions;
	readonly #clock: () => number;
	readonly #logger: Logger;
	readonly #startListener: (options: CallbackListenerOptions) => Promise<CallbackListener>;
	readonly #createPkce: () => PkceAttempt;
	readonly #authorizationTimeoutMs: number;

	#clientId: string | undefined;
	#session: StoredSpotifySession | undefined;

	/** Incremented whenever the session is replaced or cleared, so in-flight work for an older session is discarded. */
	#generation = 0;

	#refreshInFlight: Promise<string> | undefined;
	#connectInFlight: Promise<void> | undefined;
	#listener: CallbackListener | undefined;

	/**
	 * Initializes a new instance of the {@link SpotifyAuthService} class.
	 * @param options Dependencies.
	 */
	constructor(options: SpotifyAuthServiceOptions) {
		this.#state = options.state;
		this.#store = options.tokenStore;
		this.#openUrl = options.openUrl;
		this.#http = options.http ?? {};
		this.#clock = options.clock ?? Date.now;
		this.#logger = options.logger ?? silentLogger;
		this.#startListener = options.startCallbackListener ?? startCallbackListener;
		this.#createPkce = options.createPkceAttempt ?? createPkceAttempt;
		this.#authorizationTimeoutMs = options.authorizationTimeoutMs ?? AUTHORIZATION_TIMEOUT_MS;
		this.api = new SpotifyApiClient(this, this.#http);
	}

	/**
	 * Whether a session (tokens) is currently held.
	 * @returns `true` when a session exists.
	 */
	get hasSession(): boolean {
		return this.#session !== undefined;
	}

	/**
	 * Startup: applies the configured Client ID and restores a stored session without opening a browser.
	 * @param clientId Configured Client ID.
	 */
	async initialize(clientId: string | undefined): Promise<void> {
		this.#clientId = clientId;
		if (clientId === undefined) {
			this.#publish("not-configured");
			return;
		}

		let stored: StoredSpotifySession | undefined;
		try {
			stored = await this.#store.load();
		} catch (err) {
			this.#logger.warn(`Stored Spotify session is unusable and will be removed: ${describeError(err)}`);
			await this.#clearStorage();
			this.#publish("disconnected", { message: "The saved Spotify session could not be read. Press Connect Spotify to sign in again." });
			return;
		}

		if (stored === undefined) {
			this.#publish("disconnected");
			return;
		}
		if (stored.clientId !== clientId) {
			this.#logger.info("Stored Spotify session belongs to a different Client ID; removing it.");
			await this.#clearStorage();
			this.#publish("disconnected", { message: "The Spotify Client ID changed. Press Connect Spotify to sign in again." });
			return;
		}

		this.#replaceSession(stored);
		if (this.#requiresReauthorization(stored)) {
			// Keep the stored session (and Client ID) until a new authorization replaces it, but never use it.
			return;
		}
		if (this.#clock() > stored.authorizedAt + REFRESH_TOKEN_LIFETIME_MS) {
			this.#logger.info("Spotify session is about six months old; Spotify may require signing in again.");
		}
		this.#publish("connecting", { message: "Restoring Spotify session..." });
		await this.verify();
	}

	/**
	 * Applies a new Client ID (from the Property Inspector). A session issued to another Client ID is discarded.
	 * @param clientId New Client ID; `undefined` when the user removed it.
	 */
	async setClientId(clientId: string | undefined): Promise<void> {
		if (clientId === this.#clientId) {
			return;
		}
		this.#clientId = clientId;
		this.#logger.info(clientId === undefined ? "Spotify Client ID removed." : "Spotify Client ID updated.");
		await this.#endSession();
		this.#publish(clientId === undefined ? "not-configured" : "disconnected");
	}

	/**
	 * Connects a Spotify account using the Authorization Code flow with PKCE. Concurrent calls share one attempt. Does nothing when connected.
	 * @returns Promise resolved when the attempt has finished (successfully or not; see the published state).
	 */
	connect(): Promise<void> {
		if (this.#connectInFlight !== undefined) {
			return this.#connectInFlight;
		}
		if (this.#state.snapshot.status === "connected") {
			return Promise.resolve();
		}
		const clientId = this.#clientId;
		if (clientId === undefined) {
			this.#publish("not-configured", { message: new SpotifyClientIdError("Enter your Spotify Client ID first.").message });
			return Promise.resolve();
		}

		this.#connectInFlight = this.#runConnect(clientId).finally(() => {
			this.#connectInFlight = undefined;
		});
		return this.#connectInFlight;
	}

	/**
	 * Disconnects: cancels any sign-in, forgets tokens in memory and in storage, and publishes Disconnected. The Client ID is kept.
	 * Spotify offers no token revocation endpoint; users can remove Deckify's access at https://www.spotify.com/account/apps/.
	 */
	async disconnect(): Promise<void> {
		this.#logger.info("Disconnecting Spotify.");
		const cleared = await this.#endSession();
		this.#publish(this.#clientId === undefined ? "not-configured" : cleared ? "disconnected" : "error", {
			message: cleared ? undefined : "Disconnected, but the saved Spotify session could not be deleted. See the Deckify log.",
		});
	}

	/**
	 * Verifies the session by fetching the current user's profile (refreshing the access token first when needed), then publishes the result.
	 */
	async verify(): Promise<void> {
		const generation = this.#generation;
		const session = this.#session;
		if (session === undefined) {
			this.#publish(this.#clientId === undefined ? "not-configured" : "disconnected");
			return;
		}
		if (this.#requiresReauthorization(session)) {
			// Never use a session that lacks required scopes, and never try to obtain them through a refresh: only a new authorization can add scopes.
			return;
		}

		try {
			const profile = await fetchCurrentUserProfile(this.api);
			if (generation === this.#generation && this.#session !== undefined && !this.#requiresReauthorization(this.#session)) {
				this.#publishConnected(profile, session.authorizedAt);
			}
		} catch (err) {
			if (generation === this.#generation) {
				await this.#handleSessionFailure(err);
			}
		}
	}

	/** @inheritdoc */
	getAccessToken(): Promise<string> {
		const session = this.#session;
		if (session === undefined) {
			return Promise.reject(new SpotifyNotConnectedError());
		}
		if (session.accessTokenExpiresAt - ACCESS_TOKEN_REFRESH_MARGIN_MS > this.#clock()) {
			return Promise.resolve(session.accessToken);
		}
		return this.refreshAccessToken();
	}

	/**
	 * Refreshes the access token. Concurrent callers share a single in-flight request. A rotated refresh token replaces the stored one; when
	 * Spotify omits it, the existing refresh token is kept. `invalid_grant` clears the session (re-authorization required) and is never retried.
	 * @returns The new access token.
	 */
	refreshAccessToken(): Promise<string> {
		if (this.#refreshInFlight !== undefined) {
			return this.#refreshInFlight;
		}
		const session = this.#session;
		if (session === undefined) {
			return Promise.reject(new SpotifyNotConnectedError());
		}

		const generation = this.#generation;
		const refresh = (async (): Promise<string> => {
			try {
				const tokens = await refreshAccessToken({ clientId: session.clientId, refreshToken: session.refreshToken }, this.#http);
				if (generation !== this.#generation) {
					throw new SpotifyNotConnectedError();
				}

				const next: StoredSpotifySession = {
					...session,
					accessToken: tokens.accessToken,
					accessTokenExpiresAt: this.#clock() + tokens.expiresInSeconds * 1000,
					refreshToken: tokens.refreshToken ?? session.refreshToken,
					scopes: tokens.scopes ?? session.scopes,
				};
				this.#session = next;
				const rotated = tokens.refreshToken !== undefined;
				this.#logger.info(`Spotify access token refreshed (refresh token rotated: ${rotated ? "yes" : "no"}).`);

				try {
					await this.#store.save(next);
				} catch (err) {
					this.#logger.error(`Refreshed Spotify session could not be saved: ${describeError(err)}`);
				}
				if (this.#state.snapshot.status === "connected") {
					this.#requiresReauthorization(next);
				}
				return next.accessToken;
			} catch (err) {
				if (err instanceof SpotifyOAuthError && (err.isInvalidGrant || err.oauthError === "invalid_client")) {
					this.#logger.warn(`Spotify refused the refresh token (${err.oauthError}); the session has been cleared.`);
					if (generation === this.#generation) {
						await this.#endSession();
						this.#publish("disconnected", { message: new SpotifyReauthorizationRequiredError().message });
					}
					throw new SpotifyReauthorizationRequiredError({ cause: err });
				}
				throw err;
			}
		})();

		this.#refreshInFlight = refresh;
		const clear = (): void => {
			if (this.#refreshInFlight === refresh) {
				this.#refreshInFlight = undefined;
			}
		};
		refresh.then(clear, clear);
		return refresh;
	}

	/**
	 * Runs one authorization attempt.
	 * @param clientId Client ID.
	 */
	async #runConnect(clientId: string): Promise<void> {
		const generation = this.#generation;
		const pkce = this.#createPkce();
		this.#publish("connecting", { message: "Waiting for you to sign in to Spotify in your browser..." });

		try {
			this.#listener = await this.#startListener({
				expectedState: pkce.state,
				timeoutMs: this.#authorizationTimeoutMs,
				logger: this.#logger,
			});
			this.#logger.info("Opening the Spotify authorization page in the default browser.");
			await this.#openUrl(buildAuthorizationUrl({ clientId, codeChallenge: pkce.codeChallenge, state: pkce.state }));

			const { code } = await this.#listener.result;
			const tokens = await exchangeAuthorizationCode({ clientId, code, codeVerifier: pkce.codeVerifier }, this.#http);
			this.#assertCurrent(generation);

			const missing = tokens.scopes === undefined ? [] : getMissingScopes(tokens.scopes);
			if (missing.length > 0) {
				throw new SpotifyInsufficientScopeError(missing);
			}

			const now = this.#clock();
			const session: StoredSpotifySession = {
				clientId,
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken,
				accessTokenExpiresAt: now + tokens.expiresInSeconds * 1000,
				authorizedAt: now,
				scopes: tokens.scopes ?? SPOTIFY_SCOPES,
			};

			// Verify the new tokens before they replace any existing session.
			const profile = await fetchCurrentUserProfile(new SpotifyApiClient(staticTokenProvider(session.accessToken), this.#http));
			this.#assertCurrent(generation);
			this.#replaceSession(session);

			let message: string | undefined;
			try {
				await this.#store.save(session);
			} catch (err) {
				this.#logger.error(`Spotify session could not be saved securely: ${describeError(err)}`);
				message = "Connected, but the session could not be saved securely; you will need to connect again after restarting.";
			}

			this.#logger.info("Spotify account connected.");
			this.#publishConnected(profile, now, message);
		} catch (err) {
			if (generation !== this.#generation) {
				// Superseded by Disconnect or a Client ID change, which already published the resulting state.
				return;
			}
			this.#logger.warn(`Spotify connection failed: ${describeError(err)}`);
			if (this.#session !== undefined && getMissingScopes(this.#session.scopes).length > 0) {
				// A failed reconnect keeps the previous session, which still needs reauthorization.
				this.#publish("reauthorization-required", { message: `${describeError(err)} ${SCOPE_UPGRADE_MESSAGE}` });
			} else if (err instanceof AuthorizationDeniedError || err instanceof AuthorizationCancelledError) {
				this.#publish("disconnected", { message: err.message });
			} else {
				this.#publish("error", { message: describeError(err) });
			}
		} finally {
			this.#listener?.close();
			this.#listener = undefined;
		}
	}

	/**
	 * Handles a failed verification of an existing session.
	 * @param err The failure.
	 */
	async #handleSessionFailure(err: unknown): Promise<void> {
		if (err instanceof SpotifyReauthorizationRequiredError) {
			// The refresh already cleared the session and published Disconnected.
			return;
		}
		this.#logger.warn(`Spotify session check failed: ${describeError(err)}`);

		if (err instanceof SpotifyUnauthorizedError) {
			// Rejected even after a refresh: the session cannot be used.
			await this.#endSession();
			this.#publish("disconnected", { message: new SpotifyReauthorizationRequiredError().message });
			return;
		}

		// Network problems, rate limits, 403 (e.g. Development Mode allowlist) and server errors keep the session so the user can retry.
		this.#publish("error", { message: describeError(err) });
		if (err instanceof SpotifyForbiddenError) {
			this.#logger.info("Spotify returned 403; check the app's User Management list in the Spotify Developer Dashboard.");
		}
	}

	/**
	 * Publishes Reauthorization Required when the session lacks required scopes.
	 * @param session Session to check.
	 * @returns `true` when reauthorization is required.
	 */
	#requiresReauthorization(session: StoredSpotifySession): boolean {
		const missing = getMissingScopes(session.scopes);
		if (missing.length === 0) {
			return false;
		}
		this.#logger.info(`Spotify session is missing required scopes (${missing.join(", ")}); reauthorization required.`);
		this.#publish("reauthorization-required", { message: SCOPE_UPGRADE_MESSAGE });
		return true;
	}

	/**
	 * Throws when the attempt was superseded.
	 * @param generation Generation captured at the start of the attempt.
	 */
	#assertCurrent(generation: number): void {
		if (generation !== this.#generation) {
			throw new AuthorizationCancelledError();
		}
	}

	/**
	 * Sets a new session (e.g. restored from storage).
	 * @param session Session.
	 */
	#replaceSession(session: StoredSpotifySession): void {
		this.#generation++;
		this.#session = session;
	}

	/**
	 * Cancels any sign-in and forgets the session in memory and storage.
	 * @returns `true` when storage was cleared.
	 */
	async #endSession(): Promise<boolean> {
		this.#generation++;
		this.#session = undefined;
		this.#refreshInFlight = undefined;
		this.#listener?.close();
		this.#listener = undefined;
		return this.#clearStorage();
	}

	/**
	 * Deletes the stored session.
	 * @returns `true` on success.
	 */
	async #clearStorage(): Promise<boolean> {
		try {
			await this.#store.clear();
			return true;
		} catch (err) {
			this.#logger.error(`Stored Spotify session could not be deleted: ${describeError(err)}`);
			return false;
		}
	}

	/**
	 * Publishes Connected.
	 * @param profile Profile.
	 * @param authorizedAt Original authorization time.
	 * @param message Optional message.
	 */
	#publishConnected(profile: SpotifyProfile, authorizedAt: number, message?: string): void {
		this.#publish("connected", { profile, authorizedAt, message });
	}

	/**
	 * Publishes a state.
	 * @param status Status.
	 * @param extra Additional fields.
	 * @param extra.profile Profile (connected only).
	 * @param extra.authorizedAt Authorization time (connected only).
	 * @param extra.message Message.
	 */
	#publish(status: SpotifyAuthStatus, extra: { profile?: SpotifyProfile; authorizedAt?: number; message?: string } = {}): void {
		this.#state.update({ ...extra, status, clientId: this.#clientId });
	}
}

/**
 * Token provider for verifying freshly issued tokens before they become the session; it cannot refresh.
 * @param accessToken The new access token.
 * @returns The provider.
 */
function staticTokenProvider(accessToken: string): AccessTokenProvider {
	return {
		getAccessToken: () => Promise.resolve(accessToken),
		refreshAccessToken: () => Promise.reject(new SpotifyUnauthorizedError(undefined)),
	};
}
