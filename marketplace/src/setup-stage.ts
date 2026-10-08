/**
 * Runs Deckify Setup for capture: the plugin's real `DeckifySetupServer` (routes, session token, Content Security Policy, the page and its
 * assets served from the plugin folder unchanged), the real account commands and account state, and the real `ExperienceSwitcher`. Only
 * the edges are stand-ins: Spotify sign-in (a scripted auth service) and Stream Deck (a connected MK.2 that accepts the profile switch).
 * Bundled by scripts/render.mjs with esbuild.
 *
 * Demo data is fictional: the account name "Deckify Demo". The Client ID is a placeholder that is never shown on the captured screens
 * (scripts/render.mjs fails if it appears in any capture's text).
 */
import { ExperienceSwitcher } from "../../src/experiences/experiences";
import { DeckifySetupServer } from "../../src/setup/setup-server";
import { SpotifyAccountCommands } from "../../src/spotify/account-commands";
import type { SpotifyAuthService } from "../../src/spotify/auth/auth-service";
import { SpotifyAuthState } from "../../src/spotify/state/auth-state";

/** Never displayed; any value marks the Client ID as saved. */
export const PLACEHOLDER_CLIENT_ID = "placeholder-client-id";

export type SetupStage = {
	/** The address Deckify would open in the browser (with its one-time launch code). */
	readonly url: string;
	/** Spotify accepts the sign-in: the account becomes connected. */
	finishSignIn(): void;
	close(): Promise<void>;
};

/**
 * Starts Deckify Setup with a saved Client ID, not yet connected.
 * @param pluginDir The plugin folder.
 * @returns The stage.
 */
export async function startSetupStage(pluginDir: string): Promise<SetupStage> {
	const state = new SpotifyAuthState();
	state.update({ status: "disconnected", clientId: PLACEHOLDER_CLIENT_ID });

	const auth = {
		connect: () => {
			state.update({ status: "connecting", clientId: PLACEHOLDER_CLIENT_ID, activity: "authorizing" });
			return Promise.resolve();
		},
		retryConnect: () => Promise.resolve(),
		cancelConnect: () => undefined,
		disconnect: () => Promise.resolve(),
		setClientId: () => Promise.resolve(),
	};

	let opened = "";
	const server = new DeckifySetupServer({
		commands: new SpotifyAccountCommands({
			auth: auth as unknown as SpotifyAuthService,
			state,
			saveClientId: () => Promise.resolve(),
			openUrl: () => Promise.resolve(),
		}),
		experiences: new ExperienceSwitcher({
			getDevice: () => ({ type: 0, isConnected: true }),
			switchToProfile: () => Promise.resolve(),
		}),
		state,
		openUrl: (url) => {
			opened = url;
			return Promise.resolve();
		},
		pluginDir,
	});
	await server.open("start", "demo-mk2");

	return {
		url: opened,
		finishSignIn() {
			state.update({
				status: "connected",
				clientId: PLACEHOLDER_CLIENT_ID,
				profile: { id: "deckify-demo", displayName: "Deckify Demo", product: "premium" },
				authorizedAt: Date.now(),
			});
		},
		close: () => server.close(),
	};
}
