/**
 * A persisted Spotify session.
 */
export type StoredSpotifySession = {
	/** Client ID the tokens were issued to; tokens are unusable with any other Client ID. */
	readonly clientId: string;

	readonly accessToken: string;
	readonly refreshToken: string;

	/** When the access token expires (Unix epoch, milliseconds). */
	readonly accessTokenExpiresAt: number;

	/**
	 * When the user originally authorized Deckify (Unix epoch, milliseconds). Refreshing does not change this: Spotify user refresh tokens
	 * expire about six months after the original authorization.
	 */
	readonly authorizedAt: number;

	/** Scopes granted by the user. */
	readonly scopes: readonly string[];
};

/**
 * Persists the Spotify session. Implementations must never write tokens in plaintext and must never log them.
 */
export interface TokenStore {
	/**
	 * Loads the stored session.
	 * @returns The session; otherwise `undefined` when none is stored.
	 * @throws {TokenStoreError} When a stored session exists but cannot be read or decrypted.
	 */
	load(): Promise<StoredSpotifySession | undefined>;

	/** Replaces the stored session. */
	save(session: StoredSpotifySession): Promise<void>;

	/** Deletes the stored session; succeeds when nothing is stored. */
	clear(): Promise<void>;
}

/**
 * Non-persistent token store, used by tests and on platforms without a secure store.
 */
export class MemoryTokenStore implements TokenStore {
	#session: StoredSpotifySession | undefined;

	/**
	 * Initializes a new instance of the {@link MemoryTokenStore} class.
	 * @param session Optional initial session.
	 */
	constructor(session?: StoredSpotifySession) {
		this.#session = session;
	}

	/** @inheritdoc */
	load(): Promise<StoredSpotifySession | undefined> {
		return Promise.resolve(this.#session);
	}

	/** @inheritdoc */
	save(session: StoredSpotifySession): Promise<void> {
		this.#session = session;
		return Promise.resolve();
	}

	/** @inheritdoc */
	clear(): Promise<void> {
		this.#session = undefined;
		return Promise.resolve();
	}
}
