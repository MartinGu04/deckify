import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { TokenStoreError } from "../errors";
import { isRecord } from "../http";
import type { StoredSpotifySession, TokenStore } from "./token-store";

/**
 * Protects small secrets (here: the data key) so only the current OS user can recover them, e.g. Windows DPAPI.
 */
export interface KeyProtector {
	protect(secret: Buffer): Promise<Buffer>;
	unprotect(blob: Buffer): Promise<Buffer>;
}

const FORMAT = "deckify.spotify-session";
const VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;

/**
 * On-disk representation. Tokens are only present inside `ciphertext` (AES-256-GCM). The data key is stored only as `protectedKey`, which the
 * {@link KeyProtector} (DPAPI, CurrentUser scope) can unwrap for the same OS user. The remaining fields are non-sensitive metadata.
 */
type SessionFile = {
	format: typeof FORMAT;
	version: typeof VERSION;
	clientId: string;
	accessTokenExpiresAt: number;
	authorizedAt: number;
	scopes: string[];
	protectedKey: string;
	iv: string;
	authTag: string;
	ciphertext: string;
};

/**
 * Token store that writes an envelope-encrypted session file.
 *
 * Tokens are encrypted in-process with a random 256-bit data key (AES-256-GCM); only the data key is passed to the {@link KeyProtector}. Token
 * plaintext therefore never leaves the plugin process, is never written to disk, and never crosses a process boundary.
 */
export class EncryptedFileTokenStore implements TokenStore {
	/** Data key and its protected form, cached after the first load/save to avoid re-invoking the protector on every refresh. */
	#dataKey: { key: Buffer; protectedKey: string } | undefined;

	/**
	 * Initializes a new instance of the {@link EncryptedFileTokenStore} class.
	 * @param filePath Session file path.
	 * @param protector Key protector.
	 */
	constructor(
		private readonly filePath: string,
		private readonly protector: KeyProtector,
	) {}

	/** @inheritdoc */
	async load(): Promise<StoredSpotifySession | undefined> {
		let text: string;
		try {
			text = await readFile(this.filePath, "utf8");
		} catch (err) {
			if (isNotFound(err)) {
				return undefined;
			}
			throw new TokenStoreError("The stored Spotify session could not be read.", { cause: err });
		}

		const file = parseSessionFile(text);
		const key = await this.#unwrapKey(file.protectedKey);

		let secrets: unknown;
		try {
			const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(file.iv, "base64"));
			decipher.setAAD(additionalData(file));
			decipher.setAuthTag(Buffer.from(file.authTag, "base64"));
			const plaintext = Buffer.concat([decipher.update(Buffer.from(file.ciphertext, "base64")), decipher.final()]);
			secrets = JSON.parse(plaintext.toString("utf8"));
			plaintext.fill(0);
		} catch {
			throw new TokenStoreError("The stored Spotify session could not be decrypted.");
		}

		if (!isRecord(secrets) || !isNonEmptyString(secrets.accessToken) || !isNonEmptyString(secrets.refreshToken)) {
			throw new TokenStoreError("The stored Spotify session is incomplete.");
		}

		return {
			clientId: file.clientId,
			accessToken: secrets.accessToken,
			refreshToken: secrets.refreshToken,
			accessTokenExpiresAt: file.accessTokenExpiresAt,
			authorizedAt: file.authorizedAt,
			scopes: file.scopes,
		};
	}

	/** @inheritdoc */
	async save(session: StoredSpotifySession): Promise<void> {
		const { key, protectedKey } = await this.#getOrCreateDataKey();
		const metadata = {
			format: FORMAT,
			version: VERSION,
			clientId: session.clientId,
			accessTokenExpiresAt: session.accessTokenExpiresAt,
			authorizedAt: session.authorizedAt,
			scopes: [...session.scopes],
		} satisfies Partial<SessionFile>;

		const iv = randomBytes(IV_BYTES);
		const cipher = createCipheriv("aes-256-gcm", key, iv);
		cipher.setAAD(additionalData(metadata));
		const plaintext = Buffer.from(JSON.stringify({ accessToken: session.accessToken, refreshToken: session.refreshToken }), "utf8");
		const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
		plaintext.fill(0);

		const file: SessionFile = {
			...metadata,
			protectedKey,
			iv: iv.toString("base64"),
			authTag: cipher.getAuthTag().toString("base64"),
			ciphertext: ciphertext.toString("base64"),
		};

		// Write to a temporary file first so a crash never leaves a half-written session behind.
		const temp = `${this.filePath}.${randomBytes(6).toString("hex")}.tmp`;
		try {
			await mkdir(path.dirname(this.filePath), { recursive: true });
			await writeFile(temp, `${JSON.stringify(file, null, "\t")}\n`, { encoding: "utf8", mode: 0o600 });
			await rename(temp, this.filePath);
		} catch (err) {
			await rm(temp, { force: true }).catch(() => undefined);
			throw new TokenStoreError("The Spotify session could not be saved.", { cause: err });
		}
	}

	/** @inheritdoc */
	async clear(): Promise<void> {
		this.#dataKey?.key.fill(0);
		this.#dataKey = undefined;
		try {
			await rm(this.filePath, { force: true });
		} catch (err) {
			throw new TokenStoreError("The stored Spotify session could not be deleted.", { cause: err });
		}
	}

	/**
	 * Unwraps (and caches) the data key.
	 * @param protectedKey Protected key from the file.
	 * @returns The data key.
	 */
	async #unwrapKey(protectedKey: string): Promise<Buffer> {
		if (this.#dataKey?.protectedKey === protectedKey) {
			return this.#dataKey.key;
		}
		const key = await this.protector.unprotect(Buffer.from(protectedKey, "base64"));
		if (key.length !== KEY_BYTES) {
			throw new TokenStoreError("The stored Spotify session key is invalid.");
		}
		this.#dataKey = { key, protectedKey };
		return key;
	}

	/**
	 * Gets the cached data key, or creates and protects a new one.
	 * @returns The data key and its protected form.
	 */
	async #getOrCreateDataKey(): Promise<{ key: Buffer; protectedKey: string }> {
		if (this.#dataKey === undefined) {
			const key = randomBytes(KEY_BYTES);
			const protectedKey = (await this.protector.protect(key)).toString("base64");
			this.#dataKey = { key, protectedKey };
		}
		return this.#dataKey;
	}
}

/**
 * Authenticated (but unencrypted) data binding the ciphertext to its file format and account. `accessTokenExpiresAt` is deliberately not
 * included: it is non-sensitive and the development refresh test (`npm run dev:expire-spotify-token`) rewrites it.
 * @param metadata File metadata.
 * @returns The additional authenticated data.
 */
function additionalData(metadata: Pick<SessionFile, "format" | "version" | "clientId" | "authorizedAt">): Buffer {
	return Buffer.from(`${metadata.format}|${metadata.version}|${metadata.clientId}|${metadata.authorizedAt}`, "utf8");
}

/**
 * Parses and validates the session file.
 * @param text File contents.
 * @returns The session file.
 */
function parseSessionFile(text: string): SessionFile {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new TokenStoreError("The stored Spotify session is corrupt.");
	}
	if (
		!isRecord(value) ||
		value.format !== FORMAT ||
		value.version !== VERSION ||
		!isNonEmptyString(value.clientId) ||
		!isFiniteNumber(value.accessTokenExpiresAt) ||
		!isFiniteNumber(value.authorizedAt) ||
		!Array.isArray(value.scopes) ||
		!value.scopes.every((s) => typeof s === "string") ||
		!isNonEmptyString(value.protectedKey) ||
		!isNonEmptyString(value.iv) ||
		!isNonEmptyString(value.authTag) ||
		!isNonEmptyString(value.ciphertext)
	) {
		throw new TokenStoreError("The stored Spotify session is corrupt or from an unsupported version.");
	}
	return value as SessionFile;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isNotFound(err: unknown): boolean {
	return isRecord(err) && err.code === "ENOENT";
}
