// The Now Playing key, drawn exactly as the plugin draws it: a port of src/actions/now-playing-render.ts (layout, sizes, colours, text
// budget and the Spotify attribution icon with its clear space). Two presentation-only differences, both noted where they happen:
// the font falls back to Inter (Segoe UI is not available on the render machine) and the progress bar is not rounded to whole pixels,
// so it glides at 60 fps instead of stepping.

const ACCENT = "#7C5CFF";
const FONT = "Segoe UI, Inter, Arial, sans-serif";
const SPOTIFY_ICON_BOX = { x: 10, y: 10, size: 42 };

const TITLE_SIZES = [
	{ size: 24, chars: 9, lines: 1, lineHeight: 26 },
	{ size: 20, chars: 11, lines: 2, lineHeight: 21 },
	{ size: 17, chars: 13, lines: 2, lineHeight: 19 },
];
const TITLE_LAST_BASELINE = 109;
const TITLE_SINGLE_BASELINE = 103;
const SUBTITLE_SIZE = 16;
const SUBTITLE_CHARS = 15;
const SUBTITLE_BASELINE = 129;

/**
 * @param {{title: string, artist: string, isPlaying: boolean, progress: number} | null} item Track and progress (0–1); `null` for nothing playing.
 * @param {string | null} spotifyIcon URL of Spotify's official icon (shown whenever Spotify metadata is shown); `null` when the caller
 * draws it itself.
 * @param {string} [emptySubtitle] Subtitle under "Nothing Playing" ("Connect Spotify" when signed out, as the plugin shows).
 * @returns {string} SVG markup (144×144 drawing).
 */
export function nowPlayingSvg(item, spotifyIcon, emptySubtitle = "Open Spotify") {
	if (!item) {
		return frame(
			[
				`<path d="M78 22v26.5a8 8 0 1 1-4-6.9V28l-14 3v21.5a8 8 0 1 1-4-6.9V26z" fill="${ACCENT}"/>`,
				...textLines(["Nothing", "Playing"], { x: 72, y: 80, size: 22, weight: 700, fill: "#D9D9D9", anchor: "middle", lineHeight: 25 }),
				...textLines([emptySubtitle], { x: 72, y: 130, size: 16, weight: 400, fill: "#9A9A9A", anchor: "middle", lineHeight: 18 }),
			].join(""),
		);
	}
	const titleSize = TITLE_SIZES.find((t) => fits(item.title, t.chars, t.lines)) ?? TITLE_SIZES[2];
	const title = wrap(item.title, titleSize.chars, titleSize.lines);
	const subtitle = wrap(item.artist, SUBTITLE_CHARS, 1);
	return frame(
		[
			// The film overlays the icon as a preloaded <img> at this same box instead (an <image> inside inline SVG may load a frame late).
			spotifyIcon
				? `<image x="${SPOTIFY_ICON_BOX.x}" y="${SPOTIFY_ICON_BOX.y}" width="${SPOTIFY_ICON_BOX.size}" height="${SPOTIFY_ICON_BOX.size}" href="${spotifyIcon}"/>`
				: "",
			item.isPlaying
				? `<path d="M118 14l15 9-15 9z" fill="${ACCENT}"/>`
				: `<rect x="116" y="14" width="6" height="18" rx="1.5" fill="#8A8A8A"/><rect x="127" y="14" width="6" height="18" rx="1.5" fill="#8A8A8A"/>`,
			...textLines(title, {
				x: 10,
				y: title.length > 1 ? TITLE_LAST_BASELINE - titleSize.lineHeight : TITLE_SINGLE_BASELINE,
				size: titleSize.size,
				weight: 700,
				fill: "#FFFFFF",
				anchor: "start",
				lineHeight: titleSize.lineHeight,
			}),
			...textLines(subtitle, { x: 10, y: SUBTITLE_BASELINE, size: SUBTITLE_SIZE, weight: 400, fill: "#B3B3B3", anchor: "start", lineHeight: 19 }),
			// Not rounded to whole pixels (the plugin rounds): a smooth bar reads better in motion.
			`<rect x="10" y="135" width="124" height="5" rx="2.5" fill="#2E2E2E"/><rect x="10" y="135" width="${(Math.min(Math.max(item.progress, 0), 1) * 124).toFixed(2)}" height="5" rx="2.5" fill="${ACCENT}"/>`,
		].join(""),
	);
}

function frame(content) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="#121212"/>${content}</svg>`;
}

function textLines(lines, s) {
	return lines.map(
		(line, i) =>
			`<text x="${s.x}" y="${s.y + i * s.lineHeight}" font-family="${FONT}" font-size="${s.size}" font-weight="${s.weight}" fill="${s.fill}" text-anchor="${s.anchor}">${escapeXml(line)}</text>`,
	);
}

function wrap(text, maxChars, maxLines) {
	const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
	const lines = [];
	let current = "";
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (candidate.length <= maxChars) {
			current = candidate;
		} else {
			if (current) {
				lines.push(current);
			}
			current = word;
		}
	}
	if (current) {
		lines.push(current);
	}
	if (lines.length <= maxLines) {
		return lines;
	}
	const kept = lines.slice(0, maxLines);
	kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(maxChars - 1, 1)).trimEnd()}…`;
	return kept;
}

function fits(text, maxChars, maxLines) {
	const words = text.trim().split(/\s+/);
	return words.every((word) => word.length <= maxChars) && wrap(text, maxChars, Number.MAX_SAFE_INTEGER).length <= maxLines;
}

function escapeXml(value) {
	return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
}
