// The film's edit decision list: every scene, line of copy, key press, Deckify Setup event and sound cue, in seconds. The film (film.js)
// and the soundtrack (scripts/soundtrack.mjs) both read this file, so picture and sound can never drift apart. Times sit on a 120 BPM grid
// (one beat = 0.5 s) wherever the action allows, so cuts and presses land on the music.

export const DURATION = 24;
export const BPM = 120;

/** Scenes: [start, end). */
export const SCENES = {
	hook: [0, 3],
	control: [3, 6],
	actions: [6, 9],
	personal: [9, 13],
	setup: [13, 17],
	complete: [17, 21],
	end: [21, 24],
};

/** Demo tracks. Fictional titles and artists, so no real artist or private data appears on screen. */
export const TRACKS = {
	a: { title: "Low Orbit", artist: "Halcyon Rooms", seconds: 214 },
	b: { title: "Velvet Static", artist: "Marla Venn", seconds: 198 },
	c: { title: "Northbound", artist: "The Quiet Engines", seconds: 231 },
};
export const NEXT_TRACK = { a: "b", b: "c", c: "a" };

/**
 * The 5×3 layout: the README's example layout, with the free bottom row given to more playlists ("free keys for more playlists").
 * Each entry: [id, action, playlist name (playlist keys only)].
 */
export const LAYOUT = [
	[["previous", "previous"], ["playPause", "playPause"], ["next", "next"], ["nowPlaying", "nowPlaying"], ["like", "like"]],
	[["volDown", "volDown"], ["mute", "mute"], ["volUp", "volUp"], ["addKeepers", "add", "Keepers"], ["playNight", "play", "Night Drive"]],
	[["account", "account"], ["playStudio", "play", "Studio Session"], ["playRun", "play", "Morning Run"], ["playSunday", "play", "Sunday Slow"], ["addRoad", "add", "Road Trip"]],
];

/** Which playlist the Play Playlist keys start (they change the track to this one). */
export const PLAYLIST_START_TRACK = { playNight: "c", playStudio: "a", playRun: "b", playSunday: "a" };

/** The demo Client ID and account shown in Deckify Setup (fake values; never a real Client ID). */
export const DEMO_CLIENT_ID = "4f9c2e7a1b8d4c6e9a0f3b5d7e1c2a84";
export const DEMO_ACCOUNT = "Deckify Demo";
export const REDIRECT_URI = "http://127.0.0.1:43821/callback";

/** The state of the deck at the start of a scene (see film.js for what each field means). */
const LIVE = { power: 1, account: "connected", chosen: true, track: "a", playing: false, at: 0.32, volume: 60, muted: false, liked: {} };

/**
 * Deck events, in order. `reset` replaces the deck's state (only at cuts), `press` presses a key (film.js applies what that key does in
 * Deckify), `set` changes state directly (power, account status, playlist selection). Every press is also a sound cue.
 */
export const DECK_EVENTS = [
	// HOOK: the deck wakes up in the dark, then macro shots of four keys.
	{ t: 0, reset: { ...LIVE, power: 0, liked: {} } },
	{ t: 0.12, set: { power: 1 } },
	{ t: 0.3, press: "playPause" },
	{ t: 0.86, press: "next" },
	{ t: 1.36, press: "volUp" },
	{ t: 1.86, press: "like" },

	// CONTROL
	{ t: 3, reset: { ...LIVE, liked: {} } },
	{ t: 3.3, press: "playPause" },
	{ t: 3.75, press: "next" },
	{ t: 4.15, press: "volUp" },
	{ t: 4.45, press: "volUp" },
	{ t: 4.85, press: "volDown" },
	{ t: 5.25, press: "mute" },
	{ t: 5.6, press: "mute" },

	// MUSIC ACTIONS: like, add, play.
	{ t: 6.25, press: "like" },
	{ t: 7.1, press: "addKeepers" },
	{ t: 7.95, press: "playNight" },

	// PERSONALIZATION: the deck starts empty and is filled from the actions list (see PERSONAL_DROPS).
	{ t: 9.0, set: { power: 1, cleared: true } },
	{ t: 12.25, press: "playSunday" },

	// COMPLETE: install → connect → choose → play.
	{ t: 17, reset: { ...LIVE, power: 0, account: "disconnected", chosen: false, track: null, playing: false, volume: 70, liked: {} } },
	{ t: 17.25, set: { power: 1 } },
	{ t: 18.05, set: { account: "connecting" } },
	{ t: 18.3, set: { account: "connected", track: "a", at: 0.12 } },
	{ t: 18.85, set: { chosen: true } },
	{ t: 19.65, press: "playNight" },
	{ t: 20.15, press: "like" },
	{ t: 20.5, press: "volUp" },
];

/** PERSONALIZATION: keys dragged from the actions list onto the deck. Start time, flight time, and the order (row-major). */
export const PERSONAL_DROPS = { start: 9.55, stagger: 0.115, flight: 0.36 };

/** Seconds that "Added" / "Started" stay on a playlist key. */
export const FEEDBACK_SECONDS = 1.6;

/** Deckify Setup events (the real page, driven through scripts/serve.mjs's bridge). */
export const SETUP_EVENTS = {
	enter: 13.0,
	typeStart: 13.3,
	typeEnd: 13.74,
	save: 13.9,
	connect: 14.15,
	failure: 14.5,
	copy: 15.15,
	retry: 15.85,
	connected: 16.2,
	exit: 17.0,
};

/**
 * On-screen copy. Each block: lines revealed one after another, held, then cleared together. `accent` colours the closing period
 * violet (the only colour in the type).
 */
export const COPY = [
	{ id: "hook", lines: [{ text: "YOUR SPOTIFY.", in: 0.35 }, { text: "AT YOUR FINGERTIPS.", in: 1.2 }], out: 1.94 },
	{ id: "control", lines: [{ text: "CONTROL", in: 3.12 }, { text: "EVERYTHING.", in: 3.3 }], out: 5.82 },
	{ id: "like", lines: [{ text: "LIKE IT.", in: 6.05 }], out: 6.9 },
	{ id: "save", lines: [{ text: "SAVE IT.", in: 6.92 }], out: 7.78 },
	{ id: "play", lines: [{ text: "PLAY IT.", in: 7.8 }], out: 8.85 },
	{ id: "personal", lines: [{ text: "YOUR DECK.", in: 9.3 }, { text: "YOUR WAY.", in: 10.9 }], out: 12.85 },
	{ id: "setup", lines: [{ text: "NO CRYPTIC", in: 14.55 }, { text: "ERRORS.", in: 14.7 }, { text: "JUST ANSWERS.", in: 15.35 }], out: 16.9 },
];

/** INSTALL → CONNECT → CHOOSE → PLAY: when each word lights, and when the row clears. */
export const STEPS = { words: ["INSTALL", "CONNECT", "CHOOSE", "PLAY"], at: [17.25, 18.05, 18.85, 19.65], out: 20.85 };

/** End card. */
export const END = {
	fadeOut: 21.0,
	symbolIn: 21.45,
	keysIn: [21.7, 21.78, 21.86, 21.94],
	lockup: 22.2,
	tagline: 22.7,
	support: 22.95,
	cue: 23.3,
	cut: 23.75,
	tagText: "Spotify control. Done right.",
	supportText: "For Stream Deck on Windows · Spotify Premium required",
};

/** The symbol flash between the hook and CONTROL. */
export const HOOK_SYMBOL = { in: 2.25, out: 2.95 };

/** Sound cues that are not key presses: [time, sound]. Key presses add their own (see soundCues). */
const EXTRA_CUES = [
	[0.0, "rise"],
	[0.12, "powerOn"],
	[2.25, "symbol"],
	[2.9, "whoosh"],
	[8.95, "whoosh"],
	[12.95, "whoosh"],
	[SETUP_EVENTS.save, "click"],
	[SETUP_EVENTS.connect, "click"],
	[SETUP_EVENTS.failure, "notice"],
	[SETUP_EVENTS.copy, "copy"],
	[SETUP_EVENTS.retry, "click"],
	[SETUP_EVENTS.connected, "success"],
	[16.95, "whoosh"],
	[17.25, "powerOn"],
	[18.3, "success"],
	[18.85, "select"],
	[END.fadeOut, "fall"],
	[END.symbolIn, "impact"],
	...END.keysIn.map((t, i) => [t, `key${i}`]),
	[END.lockup, "sweep"],
	[END.cue, "sparkle"],
];

/**
 * Every sound cue, sorted: [time, sound, detail].
 * @returns {[number, string, object?][]} Cues.
 */
export function soundCues() {
	const cues = [...EXTRA_CUES];
	for (const event of DECK_EVENTS) {
		if (event.press) {
			cues.push([event.t, `press:${event.press}`]);
		}
	}
	for (let i = 0; i < 15; i++) {
		cues.push([PERSONAL_DROPS.start + i * PERSONAL_DROPS.stagger + PERSONAL_DROPS.flight, "drop", { i }]);
	}
	for (let i = SETUP_EVENTS.typeStart; i < SETUP_EVENTS.typeEnd; i += 0.055) {
		cues.push([i, "type"]);
	}
	return cues.sort((a, b) => a[0] - b[0]);
}
