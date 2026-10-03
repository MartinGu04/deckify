import { describe, expect, it } from "vitest";

import { LIKE_FEEDBACK, LIKE_KEY_IMAGES, likeKeyState, likeView } from "../src/actions/like-view";
import { ActionUUID } from "../src/identifiers";
import { EMPTY_LIBRARY_SNAPSHOT, type LibrarySnapshot } from "../src/library/state";
import { SIGNED_OUT_SNAPSHOT, type PlaybackSnapshot } from "../src/playback/state";

const playing: PlaybackSnapshot = {
	...SIGNED_OUT_SNAPSHOT,
	availability: "active",
	isPlaying: true,
	item: { type: "track", id: "a", uri: "spotify:track:a", title: "Song", subtitle: "Artist", durationMs: 1 },
	observedAt: 1,
};
const track = (overrides: Partial<LibrarySnapshot> = {}): LibrarySnapshot => ({ ...EMPTY_LIBRARY_SNAPSHOT, kind: "track", uri: "spotify:track:a", ...overrides });

// The Like / Unlike key's states, written out so any change to what the key shows is deliberate. The underlying behavior (LibraryService,
// endpoints, race handling, no polling) is covered by the library and Phase 5 action tests.
describe("Like / Unlike key states", () => {
	it.each<[string, PlaybackSnapshot, LibrarySnapshot, ReturnType<typeof likeKeyState>]>([
		["song not in Liked Songs: press adds it", playing, track({ saved: false }), { state: "add", title: "" }],
		["song in Liked Songs (active state): press removes it", playing, track({ saved: true }), { state: "added", title: "" }],
		["checking the song", playing, track({ checking: true }), { state: "checking", title: "" }],
		["check failed", playing, track({ notice: "error" }), { state: "checking", title: "Error" }],
		["rate-limited, known state kept", playing, track({ saved: true, notice: "rate-limited" }), { state: "added", title: "Limited" }],
		["quota exhausted, state unknown", playing, track({ notice: "quota-exceeded" }), { state: "unavailable", title: "Limited" }],
		["episode, ad or local file", playing, { ...EMPTY_LIBRARY_SNAPSHOT, kind: "unsupported" }, { state: "unavailable", title: "Track Only" }],
		["nothing loaded", playing, EMPTY_LIBRARY_SNAPSHOT, { state: "unavailable", title: "" }],
		["no active device", { ...playing, availability: "inactive", item: undefined }, EMPTY_LIBRARY_SNAPSHOT, { state: "unavailable", title: "No Device" }],
		["not Premium", { ...playing, premiumRequired: true }, track({ saved: true }), { state: "unavailable", title: "Premium" }],
		["not connected", SIGNED_OUT_SNAPSHOT, EMPTY_LIBRARY_SNAPSHOT, { state: "unavailable", title: "Connect" }],
		[
			"reconnect needed",
			{ ...SIGNED_OUT_SNAPSHOT, notice: { code: "reauthorization-required", message: "x" } },
			EMPTY_LIBRARY_SNAPSHOT,
			{ state: "unavailable", title: "Reconnect" },
		],
	])("%s", (_name, playback, library, expected) => {
		expect(likeKeyState(playback, library)).toEqual(expected);
		expect(likeView(playback, library)).toEqual({ image: LIKE_KEY_IMAGES[expected.state], title: expected.title });
	});

	it("uses one distinct image per state: Spotify's official Like icons for inactive and active, Deckify's own glyphs otherwise", () => {
		expect(LIKE_KEY_IMAGES).toEqual({
			add: "imgs/actions/library/like-add.svg",
			added: "imgs/actions/library/like-added.svg",
			checking: "imgs/actions/library/like-checking.svg",
			unavailable: "imgs/actions/library/like-unavailable.svg",
		});
		expect(Object.values(LIKE_KEY_IMAGES).join(" ")).not.toMatch(/heart/i);
	});

	it("keeps the image of the current state while Added / Removed is shown after a press", () => {
		expect(LIKE_FEEDBACK).toEqual({ added: "Added", removed: "Removed" });
		expect(likeView(playing, track({ saved: true }), "added")).toEqual({ image: LIKE_KEY_IMAGES.added, title: "Added" });
		expect(likeView(playing, track({ saved: false }), "removed")).toEqual({ image: LIKE_KEY_IMAGES.add, title: "Removed" });
	});

	it("keeps the permanent Like / Unlike action UUID", () => {
		expect(ActionUUID.Like).toBe("com.marting.deckify.spotify.like");
	});
});
