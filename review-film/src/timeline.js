// The review film's edit: every shot in order. Picture (src/film.js), sound (scripts/soundtrack.mjs) and the timestamped breakdown
// (scripts/review.mjs) all read this list, so they can't disagree.
//
// Rules this edit follows:
// - Every functional claim in a caption is shown by real footage in the same shot (src/clips.js says what each clip proves).
// - Clips play at their recorded speed. A hold freezes the clip's last real frame after the action has finished; it never stands in
//   for a response that wasn't recorded.
// - Split screens only pair clips cut from the same moment of the same recording. The desktop and phone recordings are separate takes
//   and never share a frame.

import { CLIPS, FPS } from "./clips.js";

/** Crossfade between shots, in frames. The outgoing shot holds its last frame underneath. */
export const TRANSITION = 12;

const clipSeconds = (id) => CLIPS[id].out - CLIPS[id].in;

/**
 * @typedef {object} Shot
 * @property {"intro" | "chapter" | "single" | "split" | "stack" | "portrait" | "outro"} type
 * @property {string[]} [clips] Clip IDs; split, stack and portrait shots list clips that play together.
 * @property {number} [hold] Seconds the last frame is held after the clip ends.
 * @property {number} [seconds] Length of a card.
 * @property {string} [label] Chapter label above the caption.
 * @property {string} [caption] The one-line caption.
 * @property {string} [source] Which recording this is, shown with the label.
 * @property {number} [captionAt] Seconds into the shot when its caption appears, when it must wait for what it describes.
 * @property {number} [press] Seconds into the shot when a physical key is pressed (for the key-press sound), only where the footage shows it.
 */

const DESKTOP = "Windows screen recording";
const PHONE = "Stream Deck MK.2, filmed on iPhone";

/** @type {Shot[]} */
const SHOTS = [
	{ type: "intro", seconds: 5 },

	{ type: "chapter", seconds: 1.6, number: "01", title: "Connect Spotify" },
	{
		type: "single",
		clips: ["signed-out"],
		hold: 0.3,
		zoom: [1, 1.03],
		label: "Connect Spotify",
		source: DESKTOP,
		caption: "Before you connect, every Deckify key says Connect.",
	},
	{
		type: "split",
		clips: ["setup-keys", "setup-page"],
		hold: 0.6,
		label: "Connect Spotify",
		source: DESKTOP,
		caption: "Deckify Setup: one click on Connect Spotify.",
	},
	{
		type: "split",
		clips: ["approve-keys", "approve-page"],
		hold: 0.4,
		label: "Connect Spotify",
		source: DESKTOP,
		caption: "You approve on Spotify's own page.",
	},
	{
		type: "split",
		clips: ["connected-keys", "connected-page"],
		hold: 0.8,
		// Until the keys update (28.2 s in the recording), the approve click carries the shot without a new caption.
		captionAt: 28.2 - CLIPS["connected-keys"].in,
		label: "Connect Spotify",
		source: DESKTOP,
		caption: "Connected. Every key updates on its own.",
	},

	{ type: "chapter", seconds: 1.6, number: "02", title: "Your keys, live" },
	{
		type: "single",
		clips: ["picker"],
		hold: 0.8,
		label: "Your keys, live",
		source: DESKTOP,
		caption: "Choose a playlist for a playlist key.",
	},
	{
		type: "stack",
		clips: ["live-bar", "live-keys"],
		hold: 0.8,
		label: "Your keys, live",
		source: DESKTOP,
		caption: "Music starts in Spotify, and the keys light up.",
	},
	{
		type: "stack",
		clips: ["volume-bar", "volume-keys"],
		hold: 0.6,
		label: "Your keys, live",
		source: DESKTOP,
		caption: "Volume changes in Spotify show on the keys.",
	},
	{
		type: "single",
		clips: ["now-playing"],
		hold: 0.8,
		label: "Your keys, live",
		source: DESKTOP,
		caption: "Now Playing shows the song, the artist and the progress.",
	},

	{ type: "chapter", seconds: 1.6, number: "03", title: "On the Stream Deck" },
	{
		type: "portrait",
		clips: ["press-volume"],
		label: "Volume",
		source: PHONE,
		caption: "Volume Up and Volume Down.",
	},
	{
		type: "portrait",
		clips: ["press-volume-app"],
		hold: 0.6,
		label: "Volume",
		source: "Same take, on the monitor",
		caption: "Spotify's volume, in steps of 10: 84% → 74% → 64%.",
	},
	{
		type: "portrait",
		clips: ["press-play-pause"],
		hold: 0.8,
		press: 12.3 - CLIPS["press-play-pause"].in,
		label: "Play / Pause",
		source: PHONE,
		caption: "Pause. The key turns to Play.",
	},
	{
		type: "portrait",
		clips: ["press-add"],
		hold: 0.8,
		press: 18.4 - CLIPS["press-add"].in,
		label: "Add to Playlist",
		source: PHONE,
		caption: "The song playing now is added: Adding…, then Added.",
	},
	{
		type: "portrait",
		clips: ["press-play-playlist"],
		hold: 0.3,
		press: 24.6 - CLIPS["press-play-playlist"].in,
		label: "Play Playlist",
		source: PHONE,
		caption: "The chosen playlist starts, and Now Playing follows.",
	},
	{
		type: "portrait",
		clips: ["spotify-playing"],
		hold: 0.6,
		label: "Play Playlist",
		source: "Same take, on the monitor",
		caption: "Spotify plays it: The Viral 100.",
	},
	{
		type: "portrait",
		clips: ["press-like"],
		hold: 0.8,
		press: 32.4 - CLIPS["press-like"].in,
		label: "Like",
		source: PHONE,
		caption: "Like saves the song to your Liked Songs.",
	},
	{
		type: "portrait",
		clips: ["press-like-app"],
		hold: 0.6,
		label: "Like",
		source: "Same take, on the monitor",
		caption: "The Like key shows it's saved.",
	},

	{ type: "outro", seconds: 6.5 },
];

/** Shots with their frame ranges: `start` and `frames` (the shot's own length, before the next one starts). */
export const TIMELINE = (() => {
	let start = 0;
	return SHOTS.map((shot, index) => {
		const seconds = shot.seconds ?? Math.max(...shot.clips.map(clipSeconds)) + (shot.hold ?? 0);
		const frames = Math.round(seconds * FPS);
		const entry = { ...shot, index, start, frames };
		start += frames;
		return entry;
	});
})();

/** Total frames of the film. */
export const TOTAL_FRAMES = TIMELINE.at(-1).start + TIMELINE.at(-1).frames;
