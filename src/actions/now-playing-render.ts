import type { PlaybackSnapshot } from "../playback/state";
import { shortPlaybackStatus } from "./playback-views";

/**
 * Renders the Now Playing key as a self-contained 144×144 SVG (shown at 72×72 on the MK.2, 144×144 on high-DPI devices).
 *
 * Text is wrapped by an approximate character budget (Stream Deck's SVG renderer has no text layout), escaped, and truncated with an
 * ellipsis. No artwork is fetched or cached.
 */

const GREEN = "#22D46E";
const FONT = "Segoe UI, Arial, sans-serif";

/**
 * Title sizes from largest to smallest, with the approximate characters per line that fit 124 px. Sizes are chosen for legibility on the
 * MK.2, which shows keys at 72×72 pixels (half of this 144 px drawing).
 */
const TITLE_SIZES = [
	{ size: 24, chars: 9, lineHeight: 27 },
	{ size: 20, chars: 11, lineHeight: 23 },
	{ size: 17, chars: 13, lineHeight: 20 },
] as const;
const TITLE_LINES = 2;
const SUBTITLE_SIZE = 17;
const SUBTITLE_CHARS = 14;

/**
 * Renders the key for a playback state.
 * @param snapshot Playback state.
 * @returns The SVG document.
 */
export function renderNowPlayingSvg(snapshot: PlaybackSnapshot): string {
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
	const titleSize = TITLE_SIZES.find((t) => fits(titleText, t.chars, TITLE_LINES)) ?? TITLE_SIZES[2];
	const title = wrap(titleText, titleSize.chars, TITLE_LINES);
	const subtitle = wrap(item.subtitle, SUBTITLE_CHARS, 1);
	const status = shortPlaybackStatus(snapshot);

	return frame(
		[
			stateGlyph(snapshot.isPlaying),
			status === undefined
				? ""
				: textLines([status], { x: 134, y: 26, size: 15, weight: 700, fill: "#F5B83D", anchor: "end", lineHeight: 16 }).join(""),
			...textLines(title, {
				x: 10,
				y: title.length > 1 ? 60 : 74,
				size: titleSize.size,
				weight: 700,
				fill: "#FFFFFF",
				anchor: "start",
				lineHeight: titleSize.lineHeight,
			}),
			...textLines(subtitle, { x: 10, y: 116, size: SUBTITLE_SIZE, weight: 400, fill: "#B3B3B3", anchor: "start", lineHeight: 19 }),
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
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="#121212"/>${content}</svg>`;
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

function stateGlyph(isPlaying: boolean): string {
	return isPlaying
		? `<path d="M10 10l13 8-13 8z" fill="${GREEN}"/>`
		: `<rect x="10" y="10" width="5" height="16" rx="1.5" fill="#8A8A8A"/><rect x="19" y="10" width="5" height="16" rx="1.5" fill="#8A8A8A"/>`;
}

function noteGlyph(): string {
	return `<path d="M78 22v26.5a8 8 0 1 1-4-6.9V28l-14 3v21.5a8 8 0 1 1-4-6.9V26z" fill="${GREEN}"/>`;
}

function progressBar(progressMs: number | undefined, durationMs: number | undefined): string {
	if (progressMs === undefined || durationMs === undefined || durationMs <= 0) {
		return "";
	}
	const width = Math.round(Math.min(Math.max(progressMs / durationMs, 0), 1) * 124);
	return `<rect x="10" y="130" width="124" height="5" rx="2.5" fill="#2E2E2E"/><rect x="10" y="130" width="${width}" height="5" rx="2.5" fill="${GREEN}"/>`;
}

function escapeXml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
}
