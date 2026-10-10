// Every piece of real footage the review film uses: where it comes from (file and seconds), how it is framed, what is blurred, and what
// it proves. scripts/prepare.mjs cuts the clips from these specs, src/film.js plays them, and scripts/review.mjs writes the timestamped
// breakdown from them. Times are seconds in the original recording; boxes are [x, y, width, height] in the original's pixels.
//
// Sources (not committed; passed to scripts/prepare.mjs):
//   desktop: "Deckify-desktop-compressed.mp4", Windows screen recording, 1920×1080 at 60 fps, 80.4 s, no audio
//   phone:   "WhatsApp Video 2026-10-09 at 01.08.32.mp4", iPhone footage of the Stream Deck MK.2, 576×1024 (portrait) at 30 fps, 38.6 s
// The two are separate takes (the desktop clock reads 01:05–01:06, the phone's 01:07): the film never shows them as simultaneous.

/** The Stream Deck keys and the Deckify Property Inspector, in the desktop recording from 17 s on. */
const KEYS_AND_INSPECTOR = [120, 300, 520, 650];
/** The Stream Deck keys alone (desktop, from 17 s on). */
const KEYS = [140, 305, 480, 290];
/** Spotify's player bar (desktop, from 43 s on). */
const PLAYER_BAR = [790, 902, 1010, 86];

/** The Spotify Account inspector shows the account's display name once connected. */
const ACCOUNT_NAME = { box: [325, 846, 170, 30], why: "Spotify display name in the Spotify Account inspector" };
/** Album or playlist artwork in Spotify's player bar. */
const PLAYER_ART = { box: [1730, 906, 72, 76], why: "album artwork (not ours to publish)" };

export const CLIPS = {
	// ---- Desktop: connecting Spotify ----
	"signed-out": {
		source: "desktop",
		in: 8.6,
		out: 13.6,
		crop: [376, 127, 998, 771],
		size: [1048, 810],
		shows: "The Stream Deck app with Deckify's actions list. Every Deckify key shows Connect; the Spotify Account inspector shows Not connected and Set up Deckify. The pointer opens account setup.",
	},
	"setup-keys": {
		source: "desktop",
		in: 18.5,
		out: 20.12,
		crop: KEYS_AND_INSPECTOR,
		size: [568, 710],
		shows: "Keys show Connect; the Spotify Account key turns to Connecting at 20.0 s, the moment Connect Spotify is clicked.",
	},
	"setup-page": {
		source: "desktop",
		in: 18.5,
		out: 20.12,
		crop: [870, 135, 840, 560],
		size: [1067, 710],
		shows: "Deckify Setup, step 4 of 4: Connect Spotify is clicked at 20.0 s (the browser's address bar is cropped out). The clip ends before the browser leaves for Spotify.",
	},
	"approve-keys": {
		source: "desktop",
		in: 21.0,
		out: 22.4,
		crop: KEYS_AND_INSPECTOR,
		size: [568, 710],
		shows: "The Spotify Account key and inspector wait for Spotify (Connecting, Waiting for Spotify…).",
	},
	"approve-page": {
		source: "desktop",
		in: 21.0,
		out: 22.4,
		crop: [960, 120, 640, 860],
		size: [528, 710],
		blur: [{ box: [1035, 393, 522, 72], why: "Spotify account name and picture on the consent page" }],
		shows: "Spotify's own authorization page for the user's Deckify app (in Hebrew; the address bar with the Client ID is cropped out).",
	},
	"connected-keys": {
		source: "desktop",
		in: 24.0,
		out: 29.4,
		crop: KEYS_AND_INSPECTOR,
		size: [568, 710],
		blur: [{ ...ACCOUNT_NAME, from: 27.9 }],
		shows: "After Spotify's approval (25.3 s), every key updates at 28.2 s: Spotify Account → Connected; playback and volume keys → No Device (nothing playing yet); playlist keys → Choose Playlist.",
	},
	"connected-page": {
		source: "desktop",
		in: 24.0,
		out: 29.4,
		// From y 150: below the consent page's heading, which the page has scrolled half out of view here.
		crop: [960, 150, 640, 830],
		size: [528, 685],
		blur: [{ box: [1028, 164, 536, 82], why: "Spotify account name and picture on the consent page", to: 25.5 }],
		shows: "The approve button is clicked at 25.3 s; Deckify's local page answers \"Deckify is connected to Spotify\" at 25.5 s (the address bar with the authorization code is cropped out).",
	},

	// ---- Desktop: choosing a playlist ----
	picker: {
		source: "desktop",
		in: 50.0,
		out: 52.25,
		crop: [120, 300, 520, 656],
		size: [642, 810],
		blur: [{ box: [345, 864, 264, 92], why: "the user's own playlist names, some with people's names" }],
		shows: "The Play Playlist key's inspector loads the user's playlists; The Viral 100 (by uDiscover Playlists, a public playlist) is chosen at 51.6 s, and the key's title changes from Choose Playlist to No Device.",
	},

	// ---- Desktop: the keys follow Spotify ----
	"live-keys": {
		source: "desktop",
		in: 54.0,
		out: 59.2,
		crop: KEYS,
		size: [744, 450],
		shows: "Playback is started in Spotify with the mouse (about 53.9 s, then Happier at 57 s); at 58.3 s every key lights up with live state: pause icon, volume 100%, playlist and Like keys ready.",
	},
	"live-bar": {
		source: "desktop",
		in: 54.0,
		out: 59.2,
		// The player's centre and right: the Stream Deck window still covers its left end here.
		crop: [1085, 902, 715, 86],
		size: [1038, 125],
		blur: [PLAYER_ART],
		shows: "Spotify's player bar (Spotify in Firefox): playback starts, then Happier by Bastille, Marshmello plays.",
	},
	"volume-keys": {
		source: "desktop",
		in: 59.2,
		out: 61.8,
		crop: KEYS,
		size: [744, 450],
		shows: "The volume keys change from 100% to 54% (61.0–61.5 s) as Spotify's volume changes. The clip ends before the Stream Deck window, being resized, slides over Spotify's player bar.",
	},
	"volume-bar": {
		source: "desktop",
		in: 59.2,
		out: 61.8,
		crop: PLAYER_BAR,
		size: [1314, 112],
		blur: [PLAYER_ART],
		shows: "Spotify's volume slider is dragged with the mouse (the pointer is visible on it).",
	},
	"now-playing": {
		source: "desktop",
		in: 63.4,
		out: 67.4,
		crop: KEYS,
		size: [816, 493],
		shows: "The Now Playing action is dropped on a key and immediately shows the current song (Happier · Marshmello…), Spotify's icon and the progress bar.",
	},

	// ---- Phone: the physical Stream Deck MK.2 ----
	"press-volume": {
		source: "phone",
		in: 1.4,
		out: 5.6,
		crop: [0, 0, 576, 1024],
		size: [456, 810],
		stabilize: true,
		shows: "Volume keys are pressed on the MK.2 (the percentages are too small to read in this shot).",
	},
	"press-volume-app": {
		source: "phone",
		in: 6.6,
		out: 9.85,
		crop: [0, 0, 576, 1024],
		size: [456, 810],
		stabilize: true,
		shows: "The same take, on the monitor: the Volume Up / Down keys in the Stream Deck app step 84% → 74% → 84% → 74% → 64% (the presses are off camera).",
	},
	"press-play-pause": {
		source: "phone",
		in: 11.5,
		out: 13.2,
		crop: [0, 0, 576, 1024],
		// After stabilisation: drops the top of the frame, where the camera catches the Windows taskbar clock.
		reframe: [24, 86, 528, 938],
		size: [456, 810],
		stabilize: true,
		shows: "Play / Pause is pressed at about 12.3 s; by 13.0 s the key shows Play and the Now Playing key's corner shows Paused.",
	},
	"press-add": {
		source: "phone",
		in: 17.9,
		out: 20.75,
		crop: [0, 0, 576, 1024],
		size: [456, 810],
		stabilize: true,
		shows: "Add to Playlist is pressed at 18.3–18.8 s; the key shows Adding… (19.0 s), then Stream Deck's check mark and Added (20.05 s), which Deckify only shows once Spotify has added the song.",
	},
	"press-play-playlist": {
		source: "phone",
		in: 24.2,
		out: 27.2,
		crop: [0, 0, 576, 1024],
		size: [456, 810],
		stabilize: true,
		shows: "Play Playlist is pressed at 24.5–25.5 s; the check mark and Started appear at 25.75 s, and Now Playing changes from Happier to a Noah Kahan song (Draw You Out – From The…) at 26.5 s.",
	},
	"spotify-playing": {
		source: "phone",
		in: 28.4,
		out: 29.6,
		crop: [0, 0, 576, 1024],
		size: [456, 810],
		track: "viral-100",
		shows: "The same take, on the monitor: Spotify marks The Viral 100 as playing (green, speaker icon) and the player shows a track from The Hunger Games album by Noah Kahan. Playlist rows above it are blurred.",
	},
	"press-like": {
		source: "phone",
		in: 31.0,
		out: 33.9,
		crop: [0, 0, 576, 1024],
		size: [456, 810],
		stabilize: true,
		shows: "Like / Unlike is pressed at 32.3–32.8 s; at 33.0 s the key shows Spotify's liked icon and Added, which Deckify only shows once Spotify has saved the song.",
	},
	"press-like-app": {
		source: "phone",
		in: 36.9,
		out: 38.5,
		crop: [0, 0, 576, 1024],
		size: [456, 810],
		stabilize: true,
		shows: "The same take, on the monitor: the Like key in the Stream Deck app shows the liked state.",
	},
};

/** Frames per second of the film and of every prepared clip. */
export const FPS = 30;

/**
 * Number of frames in a clip at the film's frame rate.
 * @param {string} id Clip ID.
 * @returns {number} Frames.
 */
export function clipFrames(id) {
	const clip = CLIPS[id];
	return Math.round((clip.out - clip.in) * FPS);
}
