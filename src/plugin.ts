import streamDeck from "@elgato/streamdeck";

import { SpotifyAccountAction } from "./actions/spotify-account";
import { StatusAction } from "./actions/status";
import { loadGlobalSettings, saveSpotifyClientId } from "./settings/global-settings";
import { SpotifyAuthService } from "./spotify/auth/auth-service";
import { normalizeClientId } from "./spotify/client-id";
import { describeError } from "./spotify/errors";
import { SpotifyAuthState } from "./spotify/state/auth-state";
import { createTokenStore } from "./spotify/storage";

// Log files are written to "<plugin>.sdPlugin/logs". The SDK defaults to "debug" when the manifest enables Node.js debugging and "info" otherwise;
// raise to "trace" locally to record every message exchanged with Stream Deck.
const logger = streamDeck.logger;

// Errors must never fail silently: a rejected promise that escapes an event handler would otherwise terminate the plugin process.
// (Uncaught exceptions are already logged by the SDK.)
process.on("unhandledRejection", (reason) => logger.error("Unhandled promise rejection.", reason));

// Shared Spotify account state and session; one instance for the whole plugin, shared by every Spotify action.
const spotifyLogger = logger.createScope("Spotify");
const spotifyState = new SpotifyAuthState(spotifyLogger);
const spotifyAuth = new SpotifyAuthService({
	state: spotifyState,
	tokenStore: createTokenStore(spotifyLogger),
	openUrl: (url) => streamDeck.system.openUrl(url),
	logger: spotifyLogger,
});

streamDeck.actions.registerAction(new StatusAction());
streamDeck.actions.registerAction(
	new SpotifyAccountAction({
		auth: spotifyAuth,
		state: spotifyState,
		saveClientId: saveSpotifyClientId,
		logger: logger.createScope("Spotify Account"),
	}),
);

streamDeck
	.connect()
	.then(async () => {
		logger.info(`Deckify ${streamDeck.info.plugin.version} connected to Stream Deck ${streamDeck.info.application.version}.`);
		await spotifyAuth.initialize(await loadSpotifyClientId());
	})
	.catch((err: unknown) => logger.error("Deckify failed to start.", err));

/**
 * Reads the configured Spotify Client ID from the global settings.
 * @returns The Client ID; otherwise `undefined` when missing or invalid.
 */
async function loadSpotifyClientId(): Promise<string | undefined> {
	const settings = await loadGlobalSettings();
	try {
		return normalizeClientId(settings.spotifyClientId);
	} catch (err) {
		spotifyLogger.warn(`Ignoring the stored Spotify Client ID: ${describeError(err)}`);
		return undefined;
	}
}
