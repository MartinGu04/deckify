/**
 * Generates Deckify's vector key images for the volume and playlist actions from simple geometry (no third-party icon sets or Spotify
 * artwork), and the Like / Unlike key images. Run with `npm run assets`; `test/key-icons.test.ts` fails when the committed files differ
 * from this output.
 *
 * Key images are 144×144 drawings shown at 72×72 on the Stream Deck MK.2, in the Deckify style of the playback keys: a dark key, a Deckify
 * violet symbol in the upper part (the bottom is left free for the title), grey when unavailable. Action icons are white on transparent.
 *
 * Like / Unlike follows Spotify's Design & Branding Guidelines: its inactive and active states show Spotify's official Like icons (the +
 * icon and its active state), embedded byte-for-byte from `assets/spotify-like-icon/` (Spotify's PNG files, at their original square
 * proportions, with no filter, recolouring or cropping). Checking and unavailable use Deckify's own neutral grey glyphs, so Spotify's
 * icon is never altered to show them. The Like action-list icon is Spotify's official SVG itself (`imgs/attribution/like-icon-like.svg`).
 */
import fs from "node:fs";
import path from "node:path";

import { KEY_BACKGROUND as BACKGROUND, VIOLET } from "./brand.mjs";

/** Spotify's official Like icons, exactly as downloaded from Spotify's Design & Branding Guidelines (`like-icon-png.zip`). */
export const SPOTIFY_LIKE_ICON_DIR = path.resolve(import.meta.dirname, "..", "assets", "spotify-like-icon");
/** Where Spotify's icon sits on a Like key (144×144 drawing): centred, in the upper part, leaving the bottom free for the title. */
export const LIKE_ICON_BOX = { x: 36, y: 14, size: 72 };

const UNAVAILABLE = "#4F4F4F";
const WHITE = "#FFFFFF";
const RED = "#FF5C5C";
const CHECKING = "#8A8A8A";

const SPEAKER = "M28 52h16l24-19v62L44 76H28z";

const speaker = (color) => `<path d="${SPEAKER}" fill="${color}" stroke="${color}" stroke-width="6" stroke-linejoin="round"/>`;
const plus = (color) =>
	`<rect x="84" y="58" width="32" height="12" rx="4" fill="${color}"/>\n\t<rect x="94" y="48" width="12" height="32" rx="4" fill="${color}"/>`;
const minus = (color) => `<rect x="84" y="58" width="32" height="12" rx="4" fill="${color}"/>`;
const waves = (color) =>
	`<path d="M82 50a20 20 0 0 1 0 28" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>\n` +
	`\t<path d="M95 39a36 36 0 0 1 0 50" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>`;
const cross = (color) => `<path d="M86 51l26 26M112 51l-26 26" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"/>`;
const listLines = (color) =>
	`<rect x="26" y="36" width="56" height="10" rx="4" fill="${color}"/>\n` +
	`\t<rect x="26" y="54" width="56" height="10" rx="4" fill="${color}"/>\n` +
	`\t<rect x="26" y="72" width="38" height="10" rx="4" fill="${color}"/>`;
const listPlus = (color) =>
	`<rect x="78" y="73" width="34" height="11" rx="4" fill="${color}"/>\n\t<rect x="89.5" y="61.5" width="11" height="34" rx="4" fill="${color}"/>`;
const listCheck = (color) => `<path d="M78 78l10 10 21-22" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;
const listPlay = (color) => `<path d="M86 62l26 16-26 16z" fill="${color}" stroke="${color}" stroke-width="6" stroke-linejoin="round"/>`;
const dots = (color) => [48, 72, 96].map((cx) => `<circle cx="${cx}" cy="50" r="8" fill="${color}"/>`).join("\n\t");
const dash = (color) => `<rect x="46" y="44" width="52" height="12" rx="6" fill="${color}"/>`;

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
		"volume/volume-up.svg": key("Volume Up key", speaker(VIOLET), plus(VIOLET)),
		"volume/volume-up-disabled.svg": key("Volume Up key: unavailable", speaker(UNAVAILABLE), plus(UNAVAILABLE)),
		"volume/volume-down.svg": key("Volume Down key", speaker(VIOLET), minus(VIOLET)),
		"volume/volume-down-disabled.svg": key("Volume Down key: unavailable", speaker(UNAVAILABLE), minus(UNAVAILABLE)),
		"volume/speaker.svg": key("Mute / Unmute key: sound on (press to mute)", speaker(VIOLET), waves(VIOLET)),
		"volume/speaker-muted.svg": key("Mute / Unmute key: muted, Spotify volume 0 (press to unmute)", speaker(WHITE), cross(RED)),
		"volume/speaker-disabled.svg": key("Mute / Unmute key: unavailable", speaker(UNAVAILABLE), waves(UNAVAILABLE)),
		"library/like-checking.svg": key("Like / Unlike key: checking whether the current track is in Liked Songs (Deckify's own glyph)", dots(CHECKING)),
		"library/like-unavailable.svg": key("Like / Unlike key: unavailable, e.g. not connected, no device or not a song (Deckify's own glyph)", dash(UNAVAILABLE)),
		"playlist/add.svg": key("Add to Playlist key: adds the current song to the key's playlist", listLines(VIOLET), listPlus(VIOLET)),
		"playlist/add-done.svg": key("Add to Playlist key: the song was added (or already in the playlist)", listLines(VIOLET), listCheck(VIOLET)),
		"playlist/add-disabled.svg": key("Add to Playlist key: unavailable (no playlist chosen, not a song, not connected, ...)", listLines(UNAVAILABLE), listPlus(UNAVAILABLE)),
		"playlist/play.svg": key("Play Playlist key: starts the key's playlist on the active device", listLines(VIOLET), listPlay(VIOLET)),
		"playlist/play-disabled.svg": key("Play Playlist key: unavailable (no playlist chosen, no device, not connected, ...)", listLines(UNAVAILABLE), listPlay(UNAVAILABLE)),
		"volume/volume-up-icon.svg": icon("Volume Up action icon", speaker(WHITE), plus(WHITE)),
		"volume/volume-down-icon.svg": icon("Volume Down action icon", speaker(WHITE), minus(WHITE)),
		"volume/mute-icon.svg": icon("Mute / Unmute action icon", speaker(WHITE), cross(WHITE)),
		"playlist/add-icon.svg": icon("Add to Playlist action icon", listLines(WHITE), listPlus(WHITE)),
		"playlist/play-icon.svg": icon("Play Playlist action icon", listLines(WHITE), listPlay(WHITE)),
	};
}

/**
 * The Like / Unlike key images for the inactive and active states: Deckify's dark key with Spotify's official Like icon embedded unchanged.
 * @param {(file: string) => Buffer} [read] Reads one of Spotify's files from `assets/spotify-like-icon/`.
 * @returns {Record<string, string>} File contents by path relative to `com.marting.deckify.sdPlugin/imgs/actions`.
 */
export function likeKeyFiles(read = (file) => fs.readFileSync(path.join(SPOTIFY_LIKE_ICON_DIR, file))) {
	const official = (file) =>
		`<image x="${LIKE_ICON_BOX.x}" y="${LIKE_ICON_BOX.y}" width="${LIKE_ICON_BOX.size}" height="${LIKE_ICON_BOX.size}" xlink:href="data:image/png;base64,${read(file).toString("base64")}"/>`;
	const likeKey = (comment, file) =>
		[
			`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="72" height="72" viewBox="0 0 144 144">`,
			`\t<!-- ${comment}: Spotify's official ${file}, unmodified. -->`,
			`\t<rect width="144" height="144" fill="${BACKGROUND}"/>`,
			`\t${official(file)}`,
			`</svg>`,
			``,
		].join("\n");
	return {
		"library/like-add.svg": likeKey("Like / Unlike key: current track is not in Liked Songs (press to add)", "like-icon-like.png"),
		"library/like-added.svg": likeKey("Like / Unlike key: current track is in Liked Songs, the active state (press to remove)", "like-icon-liked.png"),
	};
}

if (import.meta.main) {
	const dir = path.resolve(import.meta.dirname, "..", "com.marting.deckify.sdPlugin", "imgs", "actions");
	for (const [file, content] of Object.entries({ ...keyIconFiles(), ...likeKeyFiles() })) {
		const dest = path.join(dir, file);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, content);
		console.log(`  wrote ${path.relative(process.cwd(), dest)}`);
	}
}
