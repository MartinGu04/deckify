import os from "node:os";
import path from "node:path";

import type { Logger } from "../../shared/logger";
import { DpapiKeyProtector } from "./dpapi-key-protector";
import { EncryptedFileTokenStore } from "./encrypted-file-token-store";
import { MemoryTokenStore, type TokenStore } from "./token-store";

export type { StoredSpotifySession, TokenStore } from "./token-store";

/**
 * Gets the path of the encrypted Spotify session file: `%LOCALAPPDATA%\Deckify\spotify-session.json`.
 *
 * It lives outside the plugin folder so it survives plugin updates and is never inside a linked development checkout.
 * @returns The file path.
 */
export function defaultSessionFilePath(): string {
	const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
	return path.join(localAppData, "Deckify", "spotify-session.json");
}

/**
 * Creates the token store for the current platform: DPAPI-protected file on Windows; otherwise an in-memory store (Deckify targets Windows;
 * other platforms are only used for development and CI).
 * @param logger Logger.
 * @returns The token store.
 */
export function createTokenStore(logger: Logger): TokenStore {
	if (process.platform === "win32") {
		return new EncryptedFileTokenStore(defaultSessionFilePath(), new DpapiKeyProtector());
	}
	logger.warn("Secure token storage is only available on Windows; the Spotify session will not persist across restarts.");
	return new MemoryTokenStore();
}
