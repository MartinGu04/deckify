/**
 * The approved Deckify brand (B1 · Frame D): geometry, colours and the SVG masters built from them. Pure functions, no I/O, so tests can
 * check the committed files against this source. `scripts/export-brand-assets.mjs` writes the masters and PNG exports.
 *
 * The symbol is a violet D frame (round bowl) around a 2×2 grid of Stream Deck-style keys, drawn in a 100×100 grid. The 20 px and 28 px
 * glyphs are drawn on their own pixel grids so every edge lands on a whole pixel. See docs/brand-review/README.md#final-b1-geometry.
 */

/** Deckify violet: the brand accent and the accent of Deckify's key artwork. */
export const VIOLET = "#7C5CFF";
/** Charcoal brand base (tiles, dark backgrounds). */
export const CHARCOAL = "#15171C";
/** Background of Deckify's key images. */
export const KEY_BACKGROUND = "#121212";

/** Outer D: straight stem with softened corners, round bowl (78×80). */
export const D_OUTER = "M18 10H50C74 10 90 28 90 50C90 72 74 90 50 90H18A6 6 0 0 1 12 84V16A6 6 0 0 1 18 10Z";
/** The D's counter (the frame is 15 wide at the stem, top and bottom). */
export const D_COUNTER = "M27 25H50C65 25 75 36 75 50C75 64 65 75 50 75H27Z";
/** The 2×2 key grid: 15.75 keys, 3.4 gap, 3.4 corner radius, balanced 3.5 clearance to the stem and the bowl. */
export const KEY = { size: 15.75, gap: 3.4, radius: 3.4, x: 30.5, y: 32.55 };
/** The symbol's square view box: the D (x 12–90, y 10–90) centred with a 1-unit margin left and right. */
export const SYMBOL_VIEWBOX = "11 10 80 80";

/** Outlined "DECKIFY" wordmark (Inter ExtraBold, SIL Open Font License; tracking 6%), cap height 40, baseline at y = 0. */
const WORDMARK = "M17.83 0H3.11V-40H17.83Q23.92 -40 28.32 -37.6Q32.72 -35.19 35.11 -30.71Q37.5 -26.23 37.5 -20Q37.5 -13.77 35.13 -9.28Q32.75 -4.78 28.34 -2.39Q23.92 0 17.83 0ZM12.59 -8.11H17.42Q20.86 -8.11 23.23 -9.26Q25.61 -10.42 26.82 -13.05Q28.03 -15.68 28.03 -20Q28.03 -24.32 26.79 -26.94Q25.56 -29.56 23.18 -30.72Q20.81 -31.89 17.29 -31.89H12.59ZM46.14 0V-40H73.9V-32.27H55.62V-24H72.45V-16.43H55.62V-7.73H73.88V0ZM100.99 0.54Q95.59 0.54 91.31 -1.85Q87.03 -4.24 84.54 -8.83Q82.06 -13.42 82.06 -19.97Q82.06 -26.58 84.57 -31.17Q87.08 -35.76 91.38 -38.15Q95.67 -40.54 100.99 -40.54Q104.56 -40.54 107.59 -39.56Q110.62 -38.58 112.96 -36.7Q115.3 -34.82 116.76 -32.09Q118.22 -29.37 118.65 -25.88H109.07Q108.83 -27.36 108.18 -28.52Q107.54 -29.69 106.53 -30.52Q105.52 -31.36 104.18 -31.79Q102.84 -32.21 101.23 -32.21Q98.3 -32.21 96.17 -30.77Q94.03 -29.32 92.89 -26.59Q91.75 -23.87 91.75 -19.97Q91.75 -15.97 92.92 -13.25Q94.09 -10.52 96.19 -9.15Q98.3 -7.79 101.17 -7.79Q102.79 -7.79 104.13 -8.21Q105.47 -8.64 106.49 -9.48Q107.51 -10.31 108.18 -11.48Q108.85 -12.64 109.09 -14.12H118.68Q118.41 -11.44 117.15 -8.85Q115.89 -6.26 113.64 -4.12Q111.4 -1.99 108.24 -0.72Q105.07 0.54 100.99 0.54ZM127.16 0V-40H136.63V-30.17L136.47 -20.51Q136.5 -20.59 136.55 -20.67Q137.68 -22.63 139.09 -24.62Q140.5 -26.6 142.46 -29.07L151.37 -40H162.76L148.26 -22.71L163.32 0H152.18L141.74 -16.51L136.63 -10.74V0ZM180.52 -40V0H171.05V-40ZM190.05 0V-40H217.25V-32.27H199.53V-22.12H215.5V-14.55H199.53V0ZM238.56 0V-14.5L223.69 -40H234.8L241.08 -27.73Q241.99 -25.96 242.72 -24.16Q243.01 -23.44 243.31 -22.58Q243.6 -23.44 243.9 -24.19Q244.57 -25.99 245.46 -27.73L251.44 -40H262.5L247.98 -14.5V0Z";
const WORDMARK_WIDTH = 263.77;
/** Wordmark placement in the lockup: 22 units after the D, cap height centred on the D. */
const WORDMARK_X = 112;
const WORDMARK_BASELINE = 70;

/**
 * The symbol's shapes in the 100-unit grid.
 * @param {string} fill Fill colour.
 * @returns {string} SVG elements.
 */
export function symbolShapes(fill) {
	const keys = [
		[KEY.x, KEY.y],
		[KEY.x + KEY.size + KEY.gap, KEY.y],
		[KEY.x, KEY.y + KEY.size + KEY.gap],
		[KEY.x + KEY.size + KEY.gap, KEY.y + KEY.size + KEY.gap],
	];
	return [
		`<path fill="${fill}" fill-rule="evenodd" d="${D_OUTER} ${D_COUNTER}"/>`,
		...keys.map(([x, y]) => `<rect x="${round(x)}" y="${round(y)}" width="${KEY.size}" height="${KEY.size}" rx="${KEY.radius}" fill="${fill}"/>`),
	].join("");
}

/**
 * The symbol, transparent background.
 * @param {string} [fill] Colour; violet by default.
 * @returns {string} SVG document.
 */
export function symbolSvg(fill = VIOLET) {
	return doc(`width="256" height="256" viewBox="${SYMBOL_VIEWBOX}"`, symbolShapes(fill));
}

/**
 * The horizontal lockup (symbol + DECKIFY), transparent background.
 * @param {string} wordmarkFill Wordmark colour: charcoal for light backgrounds, white for dark ones.
 * @returns {string} SVG document.
 */
export function logoSvg(wordmarkFill) {
	const width = round(WORDMARK_X + WORDMARK_WIDTH - 12);
	return doc(
		`width="${round(width * 1.25)}" height="100" viewBox="12 10 ${width} 80"`,
		`${symbolShapes(VIOLET)}<path fill="${wordmarkFill}" transform="translate(${WORDMARK_X} ${WORDMARK_BASELINE})" d="${WORDMARK}"/>`,
	);
}

/**
 * The 20×20 action-list glyph (pixel grid): D 16×16, 2 px frame, four 3 px keys with a 1 px gap.
 * @param {string} [fill] Colour; white by default (Stream Deck action-list icons are white on transparent).
 * @returns {string} SVG document.
 */
export function glyph20Svg(fill = "#FFFFFF") {
	const keys = [6, 10].flatMap((x) => [6, 10].map((y) => `<rect x="${x}" y="${y}" width="3" height="3" rx="0.5"/>`));
	return doc(
		`width="20" height="20" viewBox="0 0 20 20" fill="${fill}"`,
		`<path fill-rule="evenodd" d="M3 2H10C14.8 2 18 5.6 18 10C18 14.4 14.8 18 10 18H3A1 1 0 0 1 2 17V3A1 1 0 0 1 3 2Z M4 4H10C13.6 4 16 6.7 16 10C16 13.3 13.6 16 10 16H4Z"/>${keys.join("")}`,
	);
}

/**
 * The 28×28 category glyph (pixel grid): D 22×22, 3 px frame, four 4 px keys with a 2 px gap.
 * @param {string} [fill] Colour; white by default.
 * @returns {string} SVG document.
 */
export function glyph28Svg(fill = "#FFFFFF") {
	const keys = [8, 14].flatMap((x) => [9, 15].map((y) => `<rect x="${x}" y="${y}" width="4" height="4" rx="0.75"/>`));
	return doc(
		`width="28" height="28" viewBox="0 0 28 28" fill="${fill}"`,
		`<path fill-rule="evenodd" d="M4 3H14C20.6 3 25 8 25 14C25 20 20.6 25 14 25H4A1 1 0 0 1 3 24V4A1 1 0 0 1 4 3Z M6 6H14C18.8 6 22 9.6 22 14C22 18.4 18.8 22 14 22H6Z"/>${keys.join("")}`,
	);
}

/**
 * The violet symbol on the charcoal tile (plugin icon, Marketplace app icon).
 * @param {number} size Size in pixels.
 * @returns {string} SVG document.
 */
export function tileSvg(size) {
	const mark = round(size * 0.62);
	const offset = round((size - mark) / 2);
	return doc(
		`width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"`,
		`<rect width="${size}" height="${size}" rx="${round(size * 0.2)}" fill="${CHARCOAL}"/><svg x="${offset}" y="${offset}" width="${mark}" height="${mark}" viewBox="${SYMBOL_VIEWBOX}">${symbolShapes(VIOLET)}</svg>`,
	);
}

/**
 * The "Deckify" key image of the Deckify Status action: the symbol near the top of a dark key (the title goes underneath).
 * @param {number} size Size in pixels.
 * @returns {string} SVG document.
 */
export function statusKeySvg(size) {
	const mark = round(size * 0.62);
	return doc(
		`width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"`,
		`<rect width="${size}" height="${size}" fill="${KEY_BACKGROUND}"/><svg x="${round((size - mark) / 2)}" y="${round(size * 0.1)}" width="${mark}" height="${mark}" viewBox="${SYMBOL_VIEWBOX}">${symbolShapes(VIOLET)}</svg>`,
	);
}

/**
 * Every SVG master in assets/brand/, by file name.
 * @returns {Record<string, string>} File contents.
 */
export function brandMasters() {
	return {
		"deckify-symbol.svg": symbolSvg(),
		"deckify-symbol-mono.svg": symbolSvg(CHARCOAL),
		"deckify-logo.svg": logoSvg(CHARCOAL),
		"deckify-logo-on-dark.svg": logoSvg("#FFFFFF"),
		"deckify-glyph-20.svg": glyph20Svg(),
		"deckify-glyph-28.svg": glyph28Svg(),
	};
}

/**
 * @param {string} attributes Root attributes.
 * @param {string} content Content.
 * @returns {string} SVG document.
 */
function doc(attributes, content) {
	return `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${content}</svg>\n`;
}

/**
 * @param {number} value Number.
 * @returns {number} Rounded to 2 decimals.
 */
function round(value) {
	return Math.round(value * 100) / 100;
}
