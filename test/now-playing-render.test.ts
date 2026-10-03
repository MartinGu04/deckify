import { describe, expect, it } from "vitest";

import { NOW_PLAYING_TEXT_TOP, renderNowPlayingSvg, SPOTIFY_ICON_BOX, SPOTIFY_ICON_CLEAR_SPACE, toSvgDataUri, wrap } from "../src/actions/now-playing-render";
import { playPauseView, shortPlaybackStatus, skipView } from "../src/actions/playback-views";
import { SIGNED_OUT_SNAPSHOT, type PlaybackSnapshot } from "../src/playback/state";

const ICON = "data:image/png;base64,c3BvdGlmeS1pY29u";

const active = (overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
	...SIGNED_OUT_SNAPSHOT,
	availability: "active",
	isPlaying: true,
	device: { id: "d", name: "Desktop", type: "Computer", isRestricted: false, volumePercent: 60, supportsVolume: true },
	item: { type: "track", id: "a", uri: "spotify:track:a", title: "Test Song", subtitle: "Test Artist", durationMs: 200_000 },
	progressMs: 50_000,
	observedAt: 1,
	...overrides,
});

describe("wrap", () => {
	it("wraps on word boundaries", () => {
		expect(wrap("Bohemian Rhapsody Live", 11, 2)).toEqual(["Bohemian", "Rhapsody…"]);
		expect(wrap("Blinding Lights", 8, 2)).toEqual(["Blinding", "Lights"]);
		expect(wrap("Short", 11, 2)).toEqual(["Short"]);
		expect(wrap("Two Words", 11, 2)).toEqual(["Two Words"]);
	});

	it("splits very long words and ends truncated text with an ellipsis", () => {
		expect(wrap("Supercalifragilisticexpialidocious", 11, 2)).toEqual(["Supercalifr", "agilistice…"]);
	});

	it("never splits emoji or combined characters", () => {
		const lines = wrap("👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦 Ünïcödé", 3, 2);
		expect(lines[0]).toBe("👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦");
	});

	it("handles empty text", () => {
		expect(wrap("   ", 11, 2)).toEqual([]);
	});
});

describe("Now Playing rendering", () => {
	it("shows title, artist, a playing indicator and progress", () => {
		const svg = renderNowPlayingSvg(active(), ICON);
		expect(svg).toContain(">Test Song<");
		expect(svg).toContain(">Test Artist<");
		expect(svg).toContain('width="31"'); // 25% of the 124 px progress bar
		expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 144 144"/);
	});

	it("shrinks long titles instead of splitting words", () => {
		const svg = renderNowPlayingSvg(active({ item: { type: "track", id: "x", uri: undefined, title: "Remarkable Unforgettable", subtitle: "", durationMs: undefined } }), ICON);
		expect(svg).toContain('font-size="17"');
		expect(svg).toContain(">Remarkable<");
		expect(svg).toContain(">Unforgettable<");
	});

	it("escapes markup in metadata", () => {
		const svg = renderNowPlayingSvg(active({ item: { type: "track", id: "x", uri: undefined, title: "<b>&\"'", subtitle: "A & B", durationMs: undefined } }), ICON);
		expect(svg).toContain("&lt;b&gt;&amp;&quot;&apos;");
		expect(svg).toContain("A &amp; B");
		expect(svg).not.toContain("<b>");
	});

	it("shows a tasteful idle state when nothing is playing", () => {
		const svg = renderNowPlayingSvg({ ...active(), availability: "inactive", item: undefined, isPlaying: false }, ICON);
		expect(svg).toContain(">Nothing<");
		expect(svg).toContain(">Playing<");
		expect(svg).toContain(">Open Spotify<");
	});

	it("asks to connect or reconnect when signed out", () => {
		expect(renderNowPlayingSvg(SIGNED_OUT_SNAPSHOT, ICON)).toContain(">Connect Spotify<");
		expect(renderNowPlayingSvg({ ...SIGNED_OUT_SNAPSHOT, notice: { code: "reauthorization-required", message: "x" } }, ICON)).toContain(">Reconnect Spotify<");
	});

	it("renders podcast episodes and ads", () => {
		expect(renderNowPlayingSvg(active({ item: { type: "episode", id: "e", uri: undefined, title: "Episode 1", subtitle: "Test Show", durationMs: undefined } }), ICON)).toContain(
			">Test Show<",
		);
		expect(renderNowPlayingSvg(active({ item: { type: "ad", id: undefined, uri: undefined, title: "", subtitle: "", durationMs: undefined } }), ICON)).toContain(
			">Advertisement<",
		);
	});

	it("produces a base64 SVG data URI", () => {
		expect(toSvgDataUri("<svg/>")).toBe(`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`);
	});
});

describe("Spotify attribution on the Now Playing key", () => {
	const shown = (svg: string) => [...svg.matchAll(/<image [^>]*>/g)].map((m) => m[0]);
	const texts = (svg: string) =>
		[...svg.matchAll(/<text x="(\d+)" y="(\d+)" [^>]*font-size="(\d+)"[^>]*>([^<]*)</g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), size: Number(m[3]), text: m[4] }));
	const metadata = [
		active(),
		active({ isPlaying: false }),
		active({ item: { type: "track", id: "x", uri: undefined, title: "A Much Longer Song Title Than Fits", subtitle: "Someone With A Long Name", durationMs: 1 } }),
		active({ item: { type: "track", id: "x", uri: undefined, title: "Remarkable Unforgettable", subtitle: "", durationMs: undefined } }),
		active({ item: { type: "episode", id: "e", uri: undefined, title: "Episode 1", subtitle: "Test Show", durationMs: undefined } }),
		active({ notice: { code: "rate-limited", message: "x" } }),
	];

	it("shows Spotify's icon whenever Spotify metadata is shown", () => {
		for (const snapshot of metadata) {
			expect(shown(renderNowPlayingSvg(snapshot, ICON))).toEqual([
				`<image x="${String(SPOTIFY_ICON_BOX.x)}" y="${String(SPOTIFY_ICON_BOX.y)}" width="42" height="42" xlink:href="${ICON}"/>`,
			]);
		}
	});

	it("draws the icon at Spotify's 21 px minimum on a 72-pixel key, on the plain dark key background (never over artwork)", () => {
		expect(SPOTIFY_ICON_BOX.size / 2).toBeGreaterThanOrEqual(21);
		const svg = renderNowPlayingSvg(active(), ICON);
		expect(svg).toContain('<rect width="144" height="144" fill="#121212"/>');
		expect(shown(svg)).toHaveLength(1);
	});

	it("keeps the icon's clear space (half its height) free of text and indicators", () => {
		const clearRight = SPOTIFY_ICON_BOX.x + SPOTIFY_ICON_BOX.size + SPOTIFY_ICON_CLEAR_SPACE;
		expect(NOW_PLAYING_TEXT_TOP).toBe(SPOTIFY_ICON_BOX.y + SPOTIFY_ICON_BOX.size + SPOTIFY_ICON_CLEAR_SPACE);
		for (const snapshot of metadata) {
			const svg = renderNowPlayingSvg(snapshot, ICON);
			for (const text of texts(svg)) {
				// Cap height is about 0.72 of the font size; the text's top must be below the clear space.
				expect(text.y - 0.72 * text.size, text.text).toBeGreaterThanOrEqual(NOW_PLAYING_TEXT_TOP);
			}
			// The play / pause indicator sits to the right of the clear space.
			const glyph = /<(?:path d="M(\d+)|rect x="(\d+)" y="14")/.exec(svg);
			expect(Number(glyph?.[1] ?? glyph?.[2])).toBeGreaterThanOrEqual(clearRight);
		}
	});

	it("keeps title and artist legible below the icon", () => {
		const svg = renderNowPlayingSvg(active(), ICON);
		expect(texts(svg).map((t) => [t.text, t.size])).toEqual([
			["Test Song", 24],
			["Test Artist", 16],
		]);
		const twoLines = renderNowPlayingSvg(active({ item: { type: "track", id: "x", uri: undefined, title: "Blinding Lights", subtitle: "The Weeknd", durationMs: 1 } }), ICON);
		expect(texts(twoLines).map((t) => [t.text, t.size])).toEqual([
			["Blinding", 20],
			["Lights", 20],
			["The Weeknd", 16],
		]);
	});

	it("shows a status instead of the artist while it applies", () => {
		const svg = renderNowPlayingSvg(active({ notice: { code: "rate-limited", message: "x" } }), ICON);
		expect(svg).toContain(">Limited<");
		expect(svg).not.toContain(">Test Artist<");
	});

	it("shows no Spotify icon when no Spotify metadata is shown", () => {
		expect(shown(renderNowPlayingSvg({ ...active(), availability: "inactive", item: undefined, isPlaying: false }, ICON))).toEqual([]);
		expect(shown(renderNowPlayingSvg(SIGNED_OUT_SNAPSHOT, ICON))).toEqual([]);
		expect(shown(renderNowPlayingSvg({ ...SIGNED_OUT_SNAPSHOT, availability: "unknown" }, ICON))).toEqual([]);
	});
});

describe("key views", () => {
	it("Play / Pause shows the action a press performs", () => {
		expect(playPauseView(active({ isPlaying: true })).image).toMatch(/pause\.svg$/);
		expect(playPauseView(active({ isPlaying: false })).image).toMatch(/play\.svg$/);
	});

	it("Play / Pause shows a disabled icon and a short reason when control is impossible", () => {
		expect(playPauseView({ ...active(), availability: "inactive" })).toEqual({ image: "imgs/actions/playback/play-disabled.svg", title: "No Device" });
		expect(playPauseView(active({ premiumRequired: true, notice: { code: "premium-required", message: "x" } })).title).toBe("Premium");
		expect(playPauseView(active({ notice: { code: "quota-exceeded", message: "x" } })).title).toBe("Limited");
		expect(playPauseView(active({ device: { id: "d", name: "S", type: "Speaker", isRestricted: true, volumePercent: 60, supportsVolume: true }, notice: { code: "device-restricted", message: "x" } })).title).toBe(
			"Restricted",
		);
		expect(playPauseView(SIGNED_OUT_SNAPSHOT).title).toBe("Connect");
	});

	it("Next / Previous are dimmed unless playback is controllable", () => {
		expect(skipView("next", active()).image).toBe("imgs/actions/playback/next.svg");
		expect(skipView("previous", { ...active(), availability: "inactive" }).image).toBe("imgs/actions/playback/previous-disabled.svg");
	});

	it("has no status label during normal playback", () => {
		expect(shortPlaybackStatus(active())).toBeUndefined();
	});
});
