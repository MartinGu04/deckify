import type { SpotifyAuthStatus } from "../spotify/state/auth-state";

/**
 * How a Spotify Account key looks for a given status.
 */
export type SpotifyAccountKeyView = {
	/** Image path relative to the plugin folder. */
	readonly image: string;
	readonly title: string;
};

const VIEWS: Record<SpotifyAuthStatus, SpotifyAccountKeyView> = {
	"not-configured": { image: "imgs/actions/spotify-account/not-configured.svg", title: "Set Up" },
	disconnected: { image: "imgs/actions/spotify-account/disconnected.svg", title: "Connect" },
	connecting: { image: "imgs/actions/spotify-account/connecting.svg", title: "Connecting" },
	connected: { image: "imgs/actions/spotify-account/connected.svg", title: "Connected" },
	"reauthorization-required": { image: "imgs/actions/spotify-account/reauthorize.svg", title: "Reconnect" },
	error: { image: "imgs/actions/spotify-account/error.svg", title: "Error" },
};

/**
 * Gets the key image and title for a status.
 * @param status Status.
 * @returns The view.
 */
export function getSpotifyAccountKeyView(status: SpotifyAuthStatus): SpotifyAccountKeyView {
	return VIEWS[status];
}
