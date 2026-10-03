import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Logger } from "../shared/logger";

/**
 * Spotify's official icon (green, as published in Spotify's brand assets and never modified), shown on the Now Playing key next to Spotify
 * metadata. Plugin-relative path.
 */
export const SPOTIFY_ICON = "imgs/attribution/Spotify_Primary_Logo_RGB_Green.png";

/**
 * Absolute path of the icon, resolved from the bundled `bin/plugin.js`.
 * @returns The path.
 */
export function bundledSpotifyIconPath(): string {
	return fileURLToPath(new URL(`../${SPOTIFY_ICON}`, import.meta.url));
}

/**
 * Reads the icon once as a data URI that Now Playing embeds in its key image (Stream Deck shows one image per key, so the icon is drawn
 * into it, at its original proportions).
 * @param logger Logger.
 * @param file Path of the icon.
 * @returns The data URI; otherwise `undefined` when it cannot be read.
 */
export function loadSpotifyIcon(logger: Logger, file = bundledSpotifyIconPath()): string | undefined {
	try {
		return `data:image/png;base64,${readFileSync(file).toString("base64")}`;
	} catch {
		logger.error("The Spotify icon for Now Playing is missing from the plugin; reinstall Deckify.");
		return undefined;
	}
}
