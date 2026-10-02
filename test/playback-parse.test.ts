import { describe, expect, it } from "vitest";

import { INACTIVE_OBSERVATION } from "../src/playback/model";
import { SpotifyInvalidResponseError } from "../src/spotify/errors";
import { parsePlaybackState } from "../src/spotify/playback/parse";
import { DEVICE, episodeItem, playerState, trackItem } from "./playback-fixtures";

describe("parsePlaybackState", () => {
	it("treats 204 No Content as no active playback", () => {
		expect(parsePlaybackState(204, undefined)).toEqual(INACTIVE_OBSERVATION);
	});

	it("treats a response without a device as inactive", () => {
		expect(parsePlaybackState(200, playerState({ device: null }))).toEqual(INACTIVE_OBSERVATION);
	});

	it("normalizes a playing track", () => {
		expect(parsePlaybackState(200, playerState())).toEqual({
			active: true,
			isPlaying: true,
			device: { id: DEVICE.id, name: "Test Desktop", type: "Computer", isRestricted: false },
			item: {
				type: "track",
				id: "fakeTrack1",
				uri: "spotify:track:fakeTrack1",
				title: "Test Song",
				subtitle: "First Artist, Second Artist",
				durationMs: 200_000,
			},
			progressMs: 50_000,
		});
	});

	it("normalizes a paused state", () => {
		const observation = parsePlaybackState(200, playerState({ is_playing: false }));
		expect(observation.active).toBe(true);
		expect(observation.isPlaying).toBe(false);
	});

	it("reports restricted devices", () => {
		expect(parsePlaybackState(200, playerState({ device: { ...DEVICE, is_restricted: true } })).device?.isRestricted).toBe(true);
	});

	it("normalizes podcast episodes (show name as subtitle)", () => {
		expect(parsePlaybackState(200, playerState({ item: episodeItem(), currently_playing_type: "episode" })).item).toEqual({
			type: "episode",
			id: "fakeEpisode1",
			uri: "spotify:episode:fakeEpisode1",
			title: "Test Episode",
			subtitle: "Test Show",
			durationMs: 1_800_000,
		});
	});

	it("represents ads without an item", () => {
		expect(parsePlaybackState(200, playerState({ item: null, currently_playing_type: "ad" })).item).toMatchObject({ type: "ad", title: "Advertisement" });
	});

	it("handles unknown future item types without crashing", () => {
		const observation = parsePlaybackState(200, playerState({ item: { type: "audiobook_chapter", id: "x1", uri: "spotify:chapter:x1", name: "Chapter 1" }, currently_playing_type: "unknown" }));
		expect(observation.item).toEqual({ type: "unknown", id: "x1", uri: "spotify:chapter:x1", title: "Chapter 1", subtitle: "", durationMs: undefined });
	});

	it("keeps an active state when the item is missing (e.g. between tracks)", () => {
		const observation = parsePlaybackState(200, playerState({ item: null, currently_playing_type: "unknown" }));
		expect(observation).toMatchObject({ active: true, item: undefined });
	});

	it("handles local files (no ID) and odd artist data defensively", () => {
		const observation = parsePlaybackState(
			200,
			playerState({ item: trackItem({ id: null, uri: "spotify:local:Artist:Album:Song:200", artists: [{ name: "  Local Artist " }, { name: 7 }, null, "x"] }) }),
		);
		expect(observation.item).toMatchObject({ id: undefined, uri: "spotify:local:Artist:Album:Song:200", subtitle: "Local Artist" });
	});

	it("tolerates invalid optional fields", () => {
		const observation = parsePlaybackState(200, playerState({ is_playing: "yes", progress_ms: -5, item: trackItem({ duration_ms: "long", name: 5, artists: "x" }) }));
		expect(observation).toMatchObject({ isPlaying: false, progressMs: undefined, item: { title: "", subtitle: "", durationMs: undefined } });
	});

	it("rejects non-object bodies", () => {
		for (const body of ["text", 42, [], null]) {
			expect(() => parsePlaybackState(200, body)).toThrow(SpotifyInvalidResponseError);
		}
	});
});
