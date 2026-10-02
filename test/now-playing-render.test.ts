import { describe, expect, it } from "vitest";

import { renderNowPlayingSvg, toSvgDataUri, wrap } from "../src/actions/now-playing-render";
import { playPauseView, shortPlaybackStatus, skipView } from "../src/actions/playback-views";
import { SIGNED_OUT_SNAPSHOT, type PlaybackSnapshot } from "../src/playback/state";

const active = (overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
	...SIGNED_OUT_SNAPSHOT,
	availability: "active",
	isPlaying: true,
	device: { id: "d", name: "Desktop", type: "Computer", isRestricted: false },
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
		const svg = renderNowPlayingSvg(active());
		expect(svg).toContain(">Test Song<");
		expect(svg).toContain(">Test Artist<");
		expect(svg).toContain('width="31"'); // 25% of the 124 px progress bar
		expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 144 144"/);
	});

	it("shrinks long titles instead of splitting words", () => {
		const svg = renderNowPlayingSvg(active({ item: { type: "track", id: "x", uri: undefined, title: "Remarkable Unforgettable", subtitle: "", durationMs: undefined } }));
		expect(svg).toContain('font-size="17"');
		expect(svg).toContain(">Remarkable<");
		expect(svg).toContain(">Unforgettable<");
	});

	it("escapes markup in metadata", () => {
		const svg = renderNowPlayingSvg(active({ item: { type: "track", id: "x", uri: undefined, title: "<b>&\"'", subtitle: "A & B", durationMs: undefined } }));
		expect(svg).toContain("&lt;b&gt;&amp;&quot;&apos;");
		expect(svg).toContain("A &amp; B");
		expect(svg).not.toContain("<b>");
	});

	it("shows a tasteful idle state when nothing is playing", () => {
		const svg = renderNowPlayingSvg({ ...active(), availability: "inactive", item: undefined, isPlaying: false });
		expect(svg).toContain(">Nothing<");
		expect(svg).toContain(">Playing<");
		expect(svg).toContain(">Open Spotify<");
	});

	it("asks to connect or reconnect when signed out", () => {
		expect(renderNowPlayingSvg(SIGNED_OUT_SNAPSHOT)).toContain(">Connect Spotify<");
		expect(renderNowPlayingSvg({ ...SIGNED_OUT_SNAPSHOT, notice: { code: "reauthorization-required", message: "x" } })).toContain(">Reconnect Spotify<");
	});

	it("renders podcast episodes and ads", () => {
		expect(renderNowPlayingSvg(active({ item: { type: "episode", id: "e", uri: undefined, title: "Episode 1", subtitle: "Test Show", durationMs: undefined } }))).toContain(
			">Test Show<",
		);
		expect(renderNowPlayingSvg(active({ item: { type: "ad", id: undefined, uri: undefined, title: "", subtitle: "", durationMs: undefined } }))).toContain(
			">Advertisement<",
		);
	});

	it("produces a base64 SVG data URI", () => {
		expect(toSvgDataUri("<svg/>")).toBe(`data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`);
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
		expect(playPauseView(active({ device: { id: "d", name: "S", type: "Speaker", isRestricted: true }, notice: { code: "device-restricted", message: "x" } })).title).toBe(
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
