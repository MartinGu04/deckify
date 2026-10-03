import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { loadSpotifyIcon, SPOTIFY_ICON } from "../src/actions/spotify-attribution";
import { spotifyItemUrl } from "../src/spotify/links";
// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as packScript from "../scripts/pack.mjs";

const pack = packScript as { SPOTIFY_ICON: string; requiredFiles: () => string[] };
const PLUGIN = path.resolve(import.meta.dirname, "..", "com.marting.deckify.sdPlugin");

/**
 * SHA-256 of Spotify_Primary_Logo_RGB_Green.png exactly as Spotify publishes it (Spotify newsroom logo and brand assets,
 * https://storage.googleapis.com/pr-newsroom-wp/1/2023/05/Spotify_Primary_Logo_RGB_Green.png). The file must stay byte-for-byte unmodified.
 */
const OFFICIAL_ICON_SHA256 = "193ef6f3d236da9a1e1e2991bf44a75a082fb3c99255c9eec9b47ea5f66413f1";

describe("Spotify icon for Now Playing", () => {
	it("is Spotify's official icon, unmodified, and required in the package", async () => {
		const icon = await readFile(path.join(PLUGIN, SPOTIFY_ICON));
		expect(createHash("sha256").update(icon).digest("hex")).toBe(OFFICIAL_ICON_SHA256);
		expect([icon.readUInt32BE(16), icon.readUInt32BE(20)]).toEqual([939, 940]);
		expect(pack.SPOTIFY_ICON).toBe(SPOTIFY_ICON);
		expect(pack.requiredFiles()).toContain(SPOTIFY_ICON);
	});

	it("loads as a PNG data URI, or logs an error when missing", async () => {
		const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
		const icon = await readFile(path.join(PLUGIN, SPOTIFY_ICON));
		expect(loadSpotifyIcon(logger, path.join(PLUGIN, SPOTIFY_ICON))).toBe(`data:image/png;base64,${icon.toString("base64")}`);
		expect(loadSpotifyIcon(logger, path.join(PLUGIN, "missing.png"))).toBeUndefined();
		expect(logger.error).toHaveBeenCalledOnce();
	});
});

describe("Spotify links for the item playing", () => {
	it("links songs and episodes to open.spotify.com", () => {
		expect(spotifyItemUrl("spotify:track:4uLU6hMCjMI75M1A2tKUQC")).toBe("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");
		expect(spotifyItemUrl("spotify:episode:512ojhOuo1ktJprKbVcKyQ")).toBe("https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ");
	});

	it("never builds a link from anything else", () => {
		for (const uri of [
			undefined,
			"",
			"spotify:local:Artist:Album:Song:180",
			"spotify:ad:4uLU6hMCjMI75M1A2tKUQC",
			"spotify:playlist:4uLU6hMCjMI75M1A2tKUQC",
			"spotify:track:4uLU6hMCjMI75M1A2tKUQ",
			"spotify:track:4uLU6hMCjMI75M1A2tKUQC/../../x",
			"spotify:track:4uLU6hMCjMI75M1A2tKUQC?x=1",
			" spotify:track:4uLU6hMCjMI75M1A2tKUQC",
			"https://evil.example/track/4uLU6hMCjMI75M1A2tKUQC",
			"javascript:alert(1)",
		]) {
			expect(spotifyItemUrl(uri), String(uri)).toBeUndefined();
		}
	});
});
