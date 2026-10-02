/**
 * Generates Deckify's vector key images for the volume and Liked Songs actions from simple geometry (no third-party icon sets or Spotify
 * artwork). Run with `npm run assets`; `test/key-icons.test.ts` fails when the committed files differ from this output.
 *
 * Key images are 144×144 drawings shown at 72×72 on the Stream Deck MK.2, in the Deckify style of the playback keys: a dark key, a green
 * symbol in the upper part (the bottom is left free for the title), grey when unavailable. Action icons are white on transparent.
 */
import fs from "node:fs";
import path from "node:path";

const BACKGROUND = "#121212";
const GREEN = "#22D46E";
const UNAVAILABLE = "#4F4F4F";
const WHITE = "#FFFFFF";
const RED = "#FF5C5C";
const CHECKING = "#8A8A8A";

const SPEAKER = "M28 52h16l24-19v62L44 76H28z";
const HEART = "M72 98C60 88 33 71 33 51C33 39 42 30 54 30C62 30 68 34 72 41C76 34 82 30 90 30C102 30 111 39 111 51C111 71 84 88 72 98Z";

const speaker = (color) => `<path d="${SPEAKER}" fill="${color}" stroke="${color}" stroke-width="6" stroke-linejoin="round"/>`;
const plus = (color) =>
	`<rect x="84" y="58" width="32" height="12" rx="4" fill="${color}"/>\n\t<rect x="94" y="48" width="12" height="32" rx="4" fill="${color}"/>`;
const minus = (color) => `<rect x="84" y="58" width="32" height="12" rx="4" fill="${color}"/>`;
const waves = (color) =>
	`<path d="M82 50a20 20 0 0 1 0 28" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>\n` +
	`\t<path d="M95 39a36 36 0 0 1 0 50" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>`;
const cross = (color) => `<path d="M86 51l26 26M112 51l-26 26" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/>`;
const heart = (color, filled) =>
	filled
		? `<path d="${HEART}" fill="${color}" stroke="${color}" stroke-width="4" stroke-linejoin="round"/>`
		: `<path d="${HEART}" fill="none" stroke="${color}" stroke-width="9" stroke-linejoin="round"/>`;

/**
 * A key image.
 * @param {string} comment What the image shows.
 * @param {string[]} shapes SVG elements.
 * @returns {string} The SVG document.
 */
function key(comment, ...shapes) {
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 144 144">`,
		`\t<!-- ${comment} -->`,
		`\t<rect width="144" height="144" fill="${BACKGROUND}"/>`,
		...shapes.map((shape) => `\t${shape}`),
		`</svg>`,
		``,
	].join("\n");
}

/**
 * An action-list icon.
 * @param {string} comment What the icon shows.
 * @param {string[]} shapes SVG elements.
 * @returns {string} The SVG document.
 */
function icon(comment, ...shapes) {
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 144 144">`,
		`\t<!-- ${comment}: monochrome white on transparent background. -->`,
		...shapes.map((shape) => `\t${shape}`),
		`</svg>`,
		``,
	].join("\n");
}

/**
 * Every generated image, by path relative to `com.marting.deckify.sdPlugin/imgs/actions`.
 * @returns {Record<string, string>} File contents by path.
 */
export function keyIconFiles() {
	return {
		"volume/volume-up.svg": key("Volume Up key", speaker(GREEN), plus(GREEN)),
		"volume/volume-up-disabled.svg": key("Volume Up key: unavailable", speaker(UNAVAILABLE), plus(UNAVAILABLE)),
		"volume/volume-down.svg": key("Volume Down key", speaker(GREEN), minus(GREEN)),
		"volume/volume-down-disabled.svg": key("Volume Down key: unavailable", speaker(UNAVAILABLE), minus(UNAVAILABLE)),
		"volume/speaker.svg": key("Mute / Unmute key: sound on (press to mute)", speaker(GREEN), waves(GREEN)),
		"volume/speaker-muted.svg": key("Mute / Unmute key: muted, Spotify volume 0 (press to unmute)", speaker(WHITE), cross(RED)),
		"volume/speaker-disabled.svg": key("Mute / Unmute key: unavailable", speaker(UNAVAILABLE), waves(UNAVAILABLE)),
		"library/heart-outline.svg": key("Like / Unlike key: current track is not in Liked Songs (press to like)", heart(GREEN, false)),
		"library/heart-filled.svg": key("Like / Unlike key: current track is in Liked Songs (press to unlike)", heart(GREEN, true)),
		"library/heart-unknown.svg": key("Like / Unlike key: checking whether the current track is liked", heart(CHECKING, false)),
		"library/heart-disabled.svg": key("Like / Unlike key: unavailable (not connected, no device, or not a song)", heart(UNAVAILABLE, false)),
		"volume/volume-up-icon.svg": icon("Volume Up action icon", speaker(WHITE), plus(WHITE)),
		"volume/volume-down-icon.svg": icon("Volume Down action icon", speaker(WHITE), minus(WHITE)),
		"volume/mute-icon.svg": icon("Mute / Unmute action icon", speaker(WHITE), cross(WHITE)),
		"library/like-icon.svg": icon("Like / Unlike action icon", heart(WHITE, true)),
	};
}

if (import.meta.main) {
	const dir = path.resolve(import.meta.dirname, "..", "com.marting.deckify.sdPlugin", "imgs", "actions");
	for (const [file, content] of Object.entries(keyIconFiles())) {
		const dest = path.join(dir, file);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, content);
		console.log(`  wrote ${path.relative(process.cwd(), dest)}`);
	}
}
