import type { SpotifyAuthSnapshot, SpotifyAuthStatus } from "../spotify/state/auth-state";

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

/**
 * State sent to the Spotify Account Property Inspector. Never contains tokens.
 */
export type SpotifyAccountInspectorState = {
	readonly status: SpotifyAuthStatus;
	readonly clientId: string;
	readonly redirectUri: string;
	readonly displayName: string | undefined;
	readonly product: string | undefined;
	readonly authorizedAt: number | undefined;
	readonly message: string | undefined;
};

/**
 * Projects the shared snapshot onto the Property Inspector payload.
 * @param snapshot Shared state.
 * @param redirectUri Redirect URI to display for setup.
 * @returns The payload.
 */
export function toInspectorState(snapshot: SpotifyAuthSnapshot, redirectUri: string): SpotifyAccountInspectorState {
	return {
		status: snapshot.status,
		clientId: snapshot.clientId ?? "",
		redirectUri,
		displayName: snapshot.profile?.displayName,
		product: snapshot.profile?.product,
		authorizedAt: snapshot.authorizedAt,
		message: snapshot.message,
	};
}
