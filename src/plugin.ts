import streamDeck from "@elgato/streamdeck";

import { NowPlayingAction } from "./actions/now-playing";
import { PlayPauseAction } from "./actions/play-pause";
import { NextTrackAction, PreviousTrackAction } from "./actions/skip-track";
import { SpotifyAccountAction } from "./actions/spotify-account";
import { StatusAction } from "./actions/status";
import { PlaybackService } from "./playback/service";
import { loadGlobalSettings, saveSpotifyClientId } from "./settings/global-settings";
import { SpotifyAuthService } from "./spotify/auth/auth-service";
import { normalizeClientId } from "./spotify/client-id";
import { describeError } from "./spotify/errors";
import { SpotifyWebApiTransport } from "./spotify/playback/web-api-transport";
import { SpotifyAuthState } from "./spotify/state/auth-state";
import { createTokenStore } from "./spotify/storage";
import { createLocalCommandTransport } from "./windows";

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

// One shared playback service (and poller) for every playback key. The Spotify Web API is the state transport and command fallback.
const playbackLogger = logger.createScope("Playback");
// Windows only: the bundled media-session helper sends commands straight to the local Spotify app; the Web API stays the state source and
// the fallback. If the helper is missing or fails, Deckify behaves exactly as with the Web API alone.
const localCommands = createLocalCommandTransport(logger.createScope("Media Bridge"));
process.once("exit", () => localCommands?.dispose());
const playback = new PlaybackService({
	transport: new SpotifyWebApiTransport(spotifyAuth.api),
	localCommands,
	auth: spotifyState,
	onAuthRejected: () => spotifyAuth.verify(),
	logger: playbackLogger,
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
streamDeck.actions.registerAction(new PlayPauseAction({ playback, logger: playbackLogger }));
streamDeck.actions.registerAction(new NextTrackAction({ playback, logger: playbackLogger }));
streamDeck.actions.registerAction(new PreviousTrackAction({ playback, logger: playbackLogger }));
streamDeck.actions.registerAction(new NowPlayingAction({ playback, logger: playbackLogger }));

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
