/**
 * Key states for the Marketplace media, produced by Deckify's own view code (the functions the plugin calls before `setImage` /
 * `setTitle`). Nothing here decides what a key looks like: each key's image and title come from the plugin for a playback, library and
 * playlist state. Bundled by scripts/render.mjs with esbuild; the result is plain data.
 *
 * Demo data is fictional (track, artist, playlist, IDs), as in the promo film. No Spotify account, Client ID or token is involved.
 */
import { likeView } from "../../src/actions/like-view";
import { renderNowPlayingSvg } from "../../src/actions/now-playing-render";
import { muteView, playPauseView, skipView, volumeView, type KeyView } from "../../src/actions/playback-views";
import { addToPlaylistView, playPlaylistView, type PlaylistKeyContext } from "../../src/actions/playlist-views";
import { getSpotifyAccountKeyView } from "../../src/actions/spotify-account-view";
import type { LibrarySnapshot } from "../../src/library/state";
import type { PlaybackSnapshot } from "../../src/playback/state";
import type { PlaylistSnapshot } from "../../src/playlists/service";

/** A key as Stream Deck shows it: a plugin image (file or rendered SVG) and the plugin's title. */
export type MediaKey = {
	readonly action: string;
	/** Plugin-relative image path, for keys that use a bundled image. */
	readonly image?: string;
	/** Rendered SVG document, for Now Playing (drawn by the plugin at runtime). */
	readonly svg?: string;
	readonly title: string;
};

const TRACK = {
	type: "track",
	id: "4DemoLowOrbit000000000",
	uri: "spotify:track:4DemoLowOrbit000000000",
	title: "Low Orbit",
	subtitle: "Halcyon Rooms",
	durationMs: 214_000,
} as const;

/** Playing on the desktop app, volume 70 %, about 40 % into the track. */
export const PLAYING: PlaybackSnapshot = {
	availability: "active",
	isPlaying: true,
	item: TRACK,
	device: { id: "demo-device", name: "Desktop", type: "Computer", isRestricted: false, volumePercent: 70, supportsVolume: true },
	progressMs: 86_000,
	observedAt: 0,
	optimistic: false,
	pendingCommand: undefined,
	pendingVolume: undefined,
	premiumRequired: false,
	localControl: true,
	notice: undefined,
};

/** The current song is in Liked Songs. */
const LIKED: LibrarySnapshot = { kind: "track", uri: TRACK.uri, saved: true, checking: false, pending: false, notice: undefined };

const PLAYLIST = {
	id: "4DemoNightDrive0000000",
	uri: "spotify:playlist:4DemoNightDrive0000000",
	name: "Night Drive",
	owner: "You",
	mine: true,
	public: false,
	collaborative: false,
	itemCount: 42,
	canOpen: true,
	writable: true,
};

const PLAYLISTS: PlaylistSnapshot = {
	status: "ready",
	playlists: [PLAYLIST] as unknown as PlaylistSnapshot["playlists"],
	unavailable: new Set(),
	adding: new Set(),
	retryAfterSeconds: undefined,
};

function playlistContext(feedback: string | undefined): PlaylistKeyContext {
	return {
		playback: PLAYING,
		playlists: PLAYLISTS,
		selection: { playlistId: PLAYLIST.id, playlistUri: PLAYLIST.uri, playlistName: PLAYLIST.name },
		lookup: { status: "found", playlist: PLAYLIST } as unknown as PlaylistKeyContext["lookup"],
		feedback,
	};
}

const key = (action: string, view: KeyView): MediaKey => ({ action, image: view.image, title: view.title });

/**
 * Every key in a working, connected state (song playing, liked, a playlist chosen on both playlist keys), plus the brief feedback the
 * plugin shows right after a press.
 * @param spotifyIcon Spotify's official icon as a data URI, which Now Playing draws next to Spotify metadata.
 * @returns Keys by action ID (the IDs of ui/setup/experiences.js).
 */
export function keyStates(spotifyIcon: string): Record<string, MediaKey> {
	return {
		account: key("account", getSpotifyAccountKeyView("connected")),
		previous: key("previous", skipView("previous", PLAYING)),
		"play-pause": key("play-pause", playPauseView(PLAYING)),
		next: key("next", skipView("next", PLAYING)),
		"now-playing": { action: "now-playing", svg: renderNowPlayingSvg(PLAYING, spotifyIcon), title: "" },
		like: key("like", likeView(PLAYING, LIKED)),
		"like-pressed": key("like", likeView(PLAYING, LIKED, "added")),
		"volume-down": key("volume-down", volumeView("down", PLAYING)),
		mute: key("mute", muteView(PLAYING)),
		"volume-up": key("volume-up", volumeView("up", PLAYING)),
		"add-to-playlist": key("add-to-playlist", addToPlaylistView(playlistContext(undefined))),
		"add-to-playlist-pressed": key("add-to-playlist", addToPlaylistView(playlistContext("Added"))),
		"play-playlist": key("play-playlist", playPlaylistView(playlistContext(undefined))),
		"play-playlist-pressed": key("play-playlist", playPlaylistView(playlistContext("Started"))),
	};
}
