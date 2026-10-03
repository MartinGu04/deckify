import type { PlaybackSnapshot } from "../playback/state";
import { shortPlaybackStatus } from "./playback-views";

/**
 * Renders the Now Playing key as a self-contained 144×144 SVG (shown at 72×72 on the MK.2, 144×144 on high-DPI devices).
 *
 * Text is wrapped by an approximate character budget (Stream Deck's SVG renderer has no text layout), escaped, and truncated with an
 * ellipsis. No artwork is fetched or cached.
 *
 * Whenever Spotify metadata (title, artist or show) is shown, Spotify's official icon is shown with it (Spotify's attribution rules): in
 * the top-left corner at 42 px of this drawing, i.e. 21 px on the MK.2's 72-pixel key, Spotify's minimum for its icon, with clear space of
 * half its height (21 px here) kept free of everything else.
 */

const GREEN = "#22D46E";
const FONT = "Segoe UI, Arial, sans-serif";

/** Spotify icon: position and size in this drawing, and its clear space (half the icon's height). */
export const SPOTIFY_ICON_BOX = { x: 10, y: 10, size: 42 } as const;
export const SPOTIFY_ICON_CLEAR_SPACE = SPOTIFY_ICON_BOX.size / 2;
/** Top of the text area: everything below this line is outside the icon's clear space. */
export const NOW_PLAYING_TEXT_TOP = SPOTIFY_ICON_BOX.y + SPOTIFY_ICON_BOX.size + SPOTIFY_ICON_CLEAR_SPACE;

/**
 * Title sizes from largest to smallest, with the approximate characters per line that fit 124 px and the lines allowed at that size (the
 * largest only fits one line below the icon's clear space). Sizes are chosen for legibility on the MK.2, which shows keys at 72×72 pixels
 * (half of this 144 px drawing).
 */
const TITLE_SIZES = [
	{ size: 24, chars: 9, lines: 1, lineHeight: 26 },
	{ size: 20, chars: 11, lines: 2, lineHeight: 21 },
	{ size: 17, chars: 13, lines: 2, lineHeight: 19 },
] as const;
/** Baseline of the title's last line, and of a one-line title. */
const TITLE_LAST_BASELINE = 109;
const TITLE_SINGLE_BASELINE = 103;
const SUBTITLE_SIZE = 16;
const SUBTITLE_CHARS = 15;
const SUBTITLE_BASELINE = 129;

/**
 * Renders the key for a playback state.
 * @param snapshot Playback state.
 * @param spotifyIcon Spotify's official icon as a data URI, shown whenever Spotify metadata is shown; `undefined` only when it could not be
 * loaded.
 * @returns The SVG document.
 */
export function renderNowPlayingSvg(snapshot: PlaybackSnapshot, spotifyIcon: string | undefined): string {
	const item = snapshot.availability === "active" ? snapshot.item : undefined;
	if (item === undefined) {
		const subtitle =
			snapshot.availability === "signed-out"
				? (shortPlaybackStatus(snapshot) ?? "Connect") + " Spotify"
				: snapshot.availability === "inactive"
					? "Open Spotify"
					: snapshot.availability === "unknown"
						? "Loading..."
						: "";
		return frame(
			[
				noteGlyph(),
				...textLines(["Nothing", "Playing"], { x: 72, y: 80, size: 22, weight: 700, fill: "#D9D9D9", anchor: "middle", lineHeight: 25 }),
				...textLines(subtitle ? [subtitle] : [], { x: 72, y: 130, size: 16, weight: 400, fill: "#9A9A9A", anchor: "middle", lineHeight: 18 }),
			].join(""),
		);
	}

	const titleText = item.title || (item.type === "ad" ? "Advertisement" : "Unknown");
	// Use the largest size at which the title fits without splitting words or truncating.
	const titleSize = TITLE_SIZES.find((t) => fits(titleText, t.chars, t.lines)) ?? TITLE_SIZES[2];
	const title = wrap(titleText, titleSize.chars, titleSize.lines);
	// A status (e.g. "Limited") is more useful than the artist while it applies, and it can't sit in the icon's clear space.
	const status = shortPlaybackStatus(snapshot);
	const subtitle = status === undefined ? wrap(item.subtitle, SUBTITLE_CHARS, 1) : [status];

	return frame(
		[
			spotifyIcon === undefined
				? ""
				: `<image x="${SPOTIFY_ICON_BOX.x}" y="${SPOTIFY_ICON_BOX.y}" width="${SPOTIFY_ICON_BOX.size}" height="${SPOTIFY_ICON_BOX.size}" xlink:href="${spotifyIcon}"/>`,
			stateGlyph(snapshot.isPlaying),
			...textLines(title, {
				x: 10,
				y: title.length > 1 ? TITLE_LAST_BASELINE - titleSize.lineHeight : TITLE_SINGLE_BASELINE,
				size: titleSize.size,
				weight: 700,
				fill: "#FFFFFF",
				anchor: "start",
				lineHeight: titleSize.lineHeight,
			}),
			...textLines(subtitle, {
				x: 10,
				y: SUBTITLE_BASELINE,
				size: SUBTITLE_SIZE,
				weight: status === undefined ? 400 : 700,
				fill: status === undefined ? "#B3B3B3" : "#F5B83D",
				anchor: "start",
				lineHeight: 19,
			}),
			progressBar(snapshot.progressMs, item.durationMs),
		].join(""),
	);
}

/**
 * Encodes an SVG document as a data URI accepted by `setImage`.
 * @param svg SVG document.
 * @returns The data URI.
 */
export function toSvgDataUri(svg: string): string {
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

/**
 * Greedy word wrap into at most `maxLines` lines of about `maxChars` characters; overflow ends with an ellipsis.
 * @param text Text.
 * @param maxChars Characters per line.
 * @param maxLines Maximum lines.
 * @returns The lines.
 */
export function wrap(text: string, maxChars: number, maxLines: number): string[] {
	const words = text.replace(/\s+/g, " ").trim().split(" ").filter((w) => w.length > 0);
	const lines: string[] = [];
	let current = "";

	for (const original of words) {
		let word = graphemes(original);
		// A single word longer than a line is split across lines.
		while (word.length > maxChars) {
			if (current.length > 0) {
				lines.push(current);
				current = "";
			}
			lines.push(word.slice(0, maxChars).join(""));
			word = word.slice(maxChars);
		}
		if (word.length === 0) {
			continue;
		}
		const candidate = current.length === 0 ? word.join("") : `${current} ${word.join("")}`;
		if (graphemes(candidate).length <= maxChars) {
			current = candidate;
		} else {
			lines.push(current);
			current = word.join("");
		}
	}
	if (current.length > 0) {
		lines.push(current);
	}

	if (lines.length <= maxLines) {
		return lines;
	}
	const kept = lines.slice(0, maxLines);
	const last = graphemes(kept[maxLines - 1] ?? "");
	kept[maxLines - 1] = `${last.slice(0, Math.max(maxChars - 1, 1)).join("").trimEnd()}…`;
	return kept;
}

/**
 * Whether text fits in the given lines without splitting a word or truncating.
 * @param text Text.
 * @param maxChars Characters per line.
 * @param maxLines Lines available.
 * @returns `true` when it fits.
 */
function fits(text: string, maxChars: number, maxLines: number): boolean {
	const words = text.trim().split(/\s+/);
	return words.every((word) => graphemes(word).length <= maxChars) && wrap(text, maxChars, Number.MAX_SAFE_INTEGER).length <= maxLines;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Splits text into user-perceived characters, so emoji and combined characters are never cut apart.
 * @param text Text.
 * @returns The graphemes.
 */
function graphemes(text: string): string[] {
	return Array.from(segmenter.segment(text), (segment) => segment.segment);
}

function frame(content: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="#121212"/>${content}</svg>`;
}

function textLines(
	lines: string[],
	style: { x: number; y: number; size: number; weight: number; fill: string; anchor: "start" | "middle" | "end"; lineHeight: number },
): string[] {
	return lines.map(
		(line, i) =>
			`<text x="${style.x}" y="${style.y + i * style.lineHeight}" font-family="${FONT}" font-size="${style.size}" font-weight="${style.weight}" fill="${style.fill}" text-anchor="${style.anchor}">${escapeXml(line)}</text>`,
	);
}

/** Play / pause indicator in the top-right corner, outside the Spotify icon's clear space. */
function stateGlyph(isPlaying: boolean): string {
	return isPlaying
		? `<path d="M118 14l15 9-15 9z" fill="${GREEN}"/>`
		: `<rect x="116" y="14" width="6" height="18" rx="1.5" fill="#8A8A8A"/><rect x="127" y="14" width="6" height="18" rx="1.5" fill="#8A8A8A"/>`;
}

function noteGlyph(): string {
	return `<path d="M78 22v26.5a8 8 0 1 1-4-6.9V28l-14 3v21.5a8 8 0 1 1-4-6.9V26z" fill="${GREEN}"/>`;
}

function progressBar(progressMs: number | undefined, durationMs: number | undefined): string {
	if (progressMs === undefined || durationMs === undefined || durationMs <= 0) {
		return "";
	}
	const width = Math.round(Math.min(Math.max(progressMs / durationMs, 0), 1) * 124);
	return `<rect x="10" y="135" width="124" height="5" rx="2.5" fill="#2E2E2E"/><rect x="10" y="135" width="${width}" height="5" rx="2.5" fill="${GREEN}"/>`;
}

function escapeXml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
}
