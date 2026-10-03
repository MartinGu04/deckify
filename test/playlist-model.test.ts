import { describe, expect, it } from "vitest";

import { isPlaylistId, isWritablePlaylist, playlistIdFromUri, toPlaylistUri, toSpotifyPlaylistUrl, type PlaylistMetadata } from "../src/playlists/model";
import { normalizePlaylistSelection, playlistSettings } from "../src/playlists/selection";
import { parsePlaylist, parsePlaylistItemsPage, parsePlaylistListPage, parseSnapshotResponse } from "../src/spotify/playlists/parse";
import { SpotifyInvalidResponseError } from "../src/spotify/errors";
import { pid } from "./playlist-fixtures";

const ID = pid("Model");

describe("playlist IDs, URIs and links", () => {
	it("accepts only 22-character base-62 IDs and exact playlist URIs", () => {
		expect(isPlaylistId(ID)).toBe(true);
		for (const bad of ["", "short", `${ID}x`, `${ID.slice(0, 21)}!`, "../../me/player/play00", 42, null, undefined]) {
			expect(isPlaylistId(bad)).toBe(false);
		}
		expect(toPlaylistUri(ID)).toBe(`spotify:playlist:${ID}`);
		expect(() => toPlaylistUri("bad")).toThrow(RangeError);
		expect(playlistIdFromUri(`spotify:playlist:${ID}`)).toBe(ID);
		for (const bad of [`spotify:album:${ID}`, `spotify:playlist:${ID}:x`, `https://open.spotify.com/playlist/${ID}`, ID, 7]) {
			expect(playlistIdFromUri(bad)).toBeUndefined();
		}
	});

	it("accepts only Spotify's own https link to the same playlist", () => {
		expect(toSpotifyPlaylistUrl(`https://open.spotify.com/playlist/${ID}`, ID)).toBe(`https://open.spotify.com/playlist/${ID}`);
		expect(toSpotifyPlaylistUrl(`https://open.spotify.com/playlist/${ID}?si=abc`, ID)).toBe(`https://open.spotify.com/playlist/${ID}`);
		for (const bad of [
			`http://open.spotify.com/playlist/${ID}`,
			`https://open.spotify.com.evil.example/playlist/${ID}`,
			`https://evil.example/playlist/${ID}`,
			`https://user:pw@open.spotify.com/playlist/${ID}`,
			`https://open.spotify.com:8443/playlist/${ID}`,
			`https://open.spotify.com/playlist/${pid("Other")}`,
			`https://open.spotify.com/album/${ID}`,
			"javascript:alert(1)",
			"not a url",
			undefined,
		]) {
			expect(toSpotifyPlaylistUrl(bad, ID)).toBeUndefined();
		}
	});

	it("decides writability from ownership or collaboration only", () => {
		const meta = (overrides: Partial<PlaylistMetadata>): PlaylistMetadata => ({
			id: ID,
			uri: toPlaylistUri(ID),
			name: "x",
			ownerId: "owner",
			ownerDisplayName: undefined,
			public: true,
			collaborative: false,
			snapshotId: undefined,
			itemCount: undefined,
			spotifyUrl: undefined,
			...overrides,
		});
		expect(isWritablePlaylist(meta({ ownerId: "me" }), "me")).toBe(true);
		expect(isWritablePlaylist(meta({ collaborative: true }), "me")).toBe(true);
		expect(isWritablePlaylist(meta({ public: true }), "me")).toBe(false);
		expect(isWritablePlaylist(meta({ ownerId: undefined }), "me")).toBe(false);
	});
});

describe("playlist settings", () => {
	it("needs a valid ID and the matching URI", () => {
		expect(normalizePlaylistSelection({ playlistId: ID, playlistUri: `spotify:playlist:${ID}`, playlistName: "Gym" })).toEqual({
			playlistId: ID,
			playlistUri: `spotify:playlist:${ID}`,
			playlistName: "Gym",
		});
		for (const bad of [
			undefined,
			null,
			"x",
			{},
			{ playlistId: ID },
			{ playlistUri: `spotify:playlist:${ID}` },
			{ playlistId: ID, playlistUri: `spotify:playlist:${pid("Other")}` },
			{ playlistId: "bad", playlistUri: "spotify:playlist:bad" },
			{ playlistId: ID, playlistUri: `https://open.spotify.com/playlist/${ID}` },
		]) {
			expect(normalizePlaylistSelection(bad)).toBeUndefined();
		}
	});

	it("treats the name as a display cache only, sanitized", () => {
		expect(normalizePlaylistSelection({ playlistId: ID, playlistUri: `spotify:playlist:${ID}`, playlistName: 42 })?.playlistName).toBeUndefined();
		expect(normalizePlaylistSelection({ playlistId: ID, playlistUri: `spotify:playlist:${ID}`, playlistName: "a\u0000b\nc" })?.playlistName).toBe("abc");
		expect(playlistSettings(ID, "Gym")).toEqual({ playlistId: ID, playlistUri: `spotify:playlist:${ID}`, playlistName: "Gym" });
	});
});

describe("playlist response parsing", () => {
	it("keeps names exactly as Spotify returns them and reads the February 2026 items field", () => {
		expect(parsePlaylist({ id: ID, name: "  Gym  🏋️ ", owner: { id: "me", display_name: "Me" }, items: { total: 12 }, snapshot_id: "s1", collaborative: false, public: false })).toMatchObject({
			name: "  Gym  🏋️ ",
			itemCount: 12,
			snapshotId: "s1",
			public: false,
		});
		// Older payloads with `tracks` still give a count.
		expect(parsePlaylist({ id: ID, name: "x", tracks: { total: 3 } })?.itemCount).toBe(3);
	});

	it("rejects a list page without items and parses snapshot responses defensively", () => {
		expect(() => parsePlaylistListPage({ total: 1 })).toThrow(SpotifyInvalidResponseError);
		expect(parsePlaylistListPage({ items: [] })).toEqual({ playlists: [], entryCount: 0, total: undefined });
		expect(parseSnapshotResponse({ snapshot_id: "s2" })).toBe("s2");
		expect(parseSnapshotResponse({})).toBeUndefined();
		expect(parseSnapshotResponse(undefined)).toBeUndefined();
	});

	it("reads item URIs from `item` (and `track` for older payloads)", () => {
		expect(parsePlaylistItemsPage({ items: [{ item: { uri: "spotify:track:a" } }, { track: { uri: "spotify:track:b" } }, null, { item: null }], total: 4 })).toEqual({
			uris: ["spotify:track:a", "spotify:track:b"],
			entryCount: 4,
			total: 4,
		});
	});
});
