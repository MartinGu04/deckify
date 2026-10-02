/**
 * Fake `GET /v1/me/player` payloads shaped like Spotify's documented response (no real user data).
 */
export const DEVICE = { id: "fake-device-1", is_active: true, is_private_session: false, is_restricted: false, name: "Test Desktop", type: "Computer", volume_percent: 60, supports_volume: true };

export function trackItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		type: "track",
		id: "fakeTrack1",
		uri: "spotify:track:fakeTrack1",
		name: "Test Song",
		duration_ms: 200_000,
		artists: [{ name: "First Artist" }, { name: "Second Artist" }],
		album: { name: "Test Album", images: [] },
		...overrides,
	};
}

export function episodeItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		type: "episode",
		id: "fakeEpisode1",
		uri: "spotify:episode:fakeEpisode1",
		name: "Test Episode",
		duration_ms: 1_800_000,
		show: { name: "Test Show", publisher: "Test Publisher" },
		...overrides,
	};
}

export function playerState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		device: DEVICE,
		repeat_state: "off",
		shuffle_state: false,
		context: null,
		timestamp: 1_767_225_600_000,
		progress_ms: 50_000,
		is_playing: true,
		item: trackItem(),
		currently_playing_type: "track",
		actions: { disallows: { resuming: true } },
		...overrides,
	};
}
