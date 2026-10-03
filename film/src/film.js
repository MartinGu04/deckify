// Deckify promo film: a deterministic, timeline-driven film. `seek(t)` draws the frame for film time t (seconds) from scratch, so the
// renderer (scripts/render.mjs) can capture any frame at any resolution, and the preview can scrub freely. Every key image comes from the
// plugin's own imgs/actions/, the Now Playing key is drawn by a port of the plugin's renderer, and the setup sequence is the real Deckify
// Setup page. Two compositions share one timeline: desktop 16:9 (1920×1080 logical, rendered at 2× for 3840×2160) and mobile 9:16
// (1080×1920).
import * as T from "./timeline.js";
import { nowPlayingSvg } from "./now-playing.js";

const params = new URLSearchParams(location.search);
const FORMAT = params.get("format") === "mobile" ? "mobile" : "desktop";
const MOBILE = FORMAT === "mobile";
const W = MOBILE ? 1080 : 1920;
const H = MOBILE ? 1920 : 1080;

const IMG = "/plugin/imgs/actions/";
const SPOTIFY_ICON = "/plugin/imgs/attribution/Spotify_Primary_Logo_RGB_Green.png";

// ---------------------------------------------------------------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------------------------------------------------------------

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const E = {
	linear: (k) => k,
	inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
	inOutQuint: (k) => (k < 0.5 ? 16 * k ** 5 : 1 - Math.pow(-2 * k + 2, 5) / 2),
	out: (k) => 1 - Math.pow(1 - k, 3),
	outQuint: (k) => 1 - Math.pow(1 - k, 5),
	outExpo: (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
	in: (k) => k * k * k,
	outBack: (k) => 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2),
};
/** Eased progress of `t` through [t0, t0 + dur]. */
const prog = (t, t0, dur, ease = E.linear) => ease(clamp((t - t0) / dur));
/** 0 → 1 over [a, a+fadeIn], 1 → 0 over [b, b+fadeOut]. */
const window01 = (t, a, fadeIn, b, fadeOut, ease = E.out) => Math.min(prog(t, a, fadeIn, ease), 1 - prog(t, b, fadeOut, E.in));
const inScene = (t, name, pad = 0) => t >= T.SCENES[name][0] - pad && t < T.SCENES[name][1] + pad;

// ---------------------------------------------------------------------------------------------------------------------------------
// Layout per composition. Safe areas: desktop keeps type inside a 128 px / 96 px margin; mobile keeps type and UI between y 230 and
// y 1520 (the top and bottom bands are covered by social apps' UI) and inside 72 px side margins.
// ---------------------------------------------------------------------------------------------------------------------------------

const KEY = 144;
const PITCH = 170;
const PAD_X = 56;
const PAD_Y = 90;
const keyCenter = (r, c) => [PAD_X + KEY / 2 + c * PITCH, PAD_Y + KEY / 2 + r * PITCH];
const CENTER = [468, 332];

/** Camera keyframes: [time, {f: focus point on the deck, s: where it lands on screen, z: zoom, rx/ry/rz: degrees, dof}, ease]. */
const CAMERA = MOBILE
	? [
			[0, { f: keyCenter(0, 1), s: [540, 1170], z: 2.5, rx: 18, ry: -22, rz: -3, dof: 1 }],
			[0.66, { f: keyCenter(0, 1), s: [530, 1160], z: 2.68, rx: 18, ry: -22, rz: -3, dof: 1 }, "linear"],
			[0.78, { f: keyCenter(0, 2), s: [540, 1170], z: 2.5, rx: 18, ry: -22, rz: -3, dof: 1 }, "inOut"],
			[1.16, { f: keyCenter(0, 2), s: [530, 1160], z: 2.68, rx: 18, ry: -22, rz: -3, dof: 1 }, "linear"],
			[1.28, { f: keyCenter(1, 2), s: [540, 1170], z: 2.5, rx: 20, ry: -18, rz: 2, dof: 1 }, "inOut"],
			[1.66, { f: keyCenter(1, 2), s: [530, 1160], z: 2.68, rx: 20, ry: -18, rz: 2, dof: 1 }, "linear"],
			[1.78, { f: keyCenter(0, 4), s: [540, 1170], z: 2.5, rx: 16, ry: -24, rz: -2, dof: 1 }, "inOut"],
			[2.25, { f: keyCenter(0, 4), s: [525, 1160], z: 2.75, rx: 16, ry: -24, rz: -2, dof: 1 }, "linear"],
			[2.85, { f: CENTER, s: [540, 1110], z: 1.35, rx: 20, ry: -16, rz: 0, dof: 0 }, "hold"],
			[3.2, { f: CENTER, s: [540, 1110], z: 0.98, rx: 18, ry: -14, rz: 0, dof: 0 }, "outQuint"],
			[3.5, { f: [383, 190], s: [540, 1100], z: 1.45, rx: 16, ry: -12, rz: 0, dof: 0 }, "inOut"],
			[3.88, { f: [383, 200], s: [540, 1100], z: 1.5, rx: 16, ry: -12, rz: 0, dof: 0 }, "linear"],
			[4.08, { f: [298, 332], s: [540, 1100], z: 1.45, rx: 16, ry: -12, rz: 0, dof: 0 }, "inOut"],
			[5.7, { f: [298, 332], s: [540, 1090], z: 1.6, rx: 14, ry: -10, rz: 0, dof: 0 }, "linear"],
			[6.0, { f: [723, 247], s: [540, 1130], z: 1.75, rx: 12, ry: -12, rz: 0, dof: 0 }, "inOut"],
			[8.9, { f: [723, 247], s: [540, 1120], z: 1.95, rx: 10, ry: -8, rz: 0, dof: 0 }, "linear"],
			[9.15, { f: CENTER, s: [540, 810], z: 0.88, rx: 6, ry: 0, rz: 0, dof: 0 }, "inOutQuint"],
			[12.95, { f: CENTER, s: [540, 800], z: 0.92, rx: 4, ry: 0, rz: 0, dof: 0 }, "linear"],
			[13.35, { f: CENTER, s: [540, 900], z: 0.84, rx: 12, ry: 0, rz: 0, dof: 0 }, "in"],
			[16.95, { f: CENTER, s: [540, 1350], z: 0.62, rx: 32, ry: -18, rz: 0, dof: 0 }, "hold"],
			[17.3, { f: CENTER, s: [540, 1130], z: 0.98, rx: 26, ry: -14, rz: 0, dof: 0 }, "outQuint"],
			[21, { f: CENTER, s: [540, 1110], z: 1.04, rx: 22, ry: 6, rz: 0, dof: 0 }, "linear"],
		]
	: [
			[0, { f: keyCenter(0, 1), s: [1480, 560], z: 3.0, rx: 18, ry: -22, rz: -3, dof: 1 }],
			[0.66, { f: keyCenter(0, 1), s: [1452, 548], z: 3.25, rx: 18, ry: -22, rz: -3, dof: 1 }, "linear"],
			[0.78, { f: keyCenter(0, 2), s: [1480, 560], z: 3.0, rx: 18, ry: -22, rz: -3, dof: 1 }, "inOut"],
			[1.16, { f: keyCenter(0, 2), s: [1452, 548], z: 3.25, rx: 18, ry: -22, rz: -3, dof: 1 }, "linear"],
			[1.28, { f: keyCenter(1, 2), s: [1480, 560], z: 3.0, rx: 20, ry: -18, rz: 2, dof: 1 }, "inOut"],
			[1.66, { f: keyCenter(1, 2), s: [1452, 548], z: 3.25, rx: 20, ry: -18, rz: 2, dof: 1 }, "linear"],
			[1.78, { f: keyCenter(0, 4), s: [1480, 560], z: 3.0, rx: 16, ry: -24, rz: -2, dof: 1 }, "inOut"],
			[2.25, { f: keyCenter(0, 4), s: [1435, 545], z: 3.35, rx: 16, ry: -24, rz: -2, dof: 1 }, "linear"],
			[2.85, { f: CENTER, s: [1330, 560], z: 1.4, rx: 20, ry: -18, rz: 0, dof: 0 }, "hold"],
			[3.2, { f: CENTER, s: [1330, 560], z: 1.0, rx: 18, ry: -16, rz: 0, dof: 0 }, "outQuint"],
			[3.5, { f: [383, 190], s: [1350, 540], z: 1.4, rx: 16, ry: -14, rz: 0, dof: 0 }, "inOut"],
			[3.88, { f: [383, 200], s: [1345, 540], z: 1.45, rx: 16, ry: -14, rz: 0, dof: 0 }, "linear"],
			[4.08, { f: [298, 332], s: [1350, 560], z: 1.42, rx: 16, ry: -14, rz: 0, dof: 0 }, "inOut"],
			[5.7, { f: [298, 332], s: [1335, 556], z: 1.55, rx: 14, ry: -12, rz: 0, dof: 0 }, "linear"],
			[6.0, { f: [723, 247], s: [1400, 560], z: 1.85, rx: 12, ry: -14, rz: 0, dof: 0 }, "inOut"],
			[8.9, { f: [723, 247], s: [1385, 552], z: 2.05, rx: 10, ry: -9, rz: 0, dof: 0 }, "linear"],
			[9.15, { f: CENTER, s: [1270, 600], z: 1.04, rx: 6, ry: -8, rz: 0, dof: 0 }, "inOutQuint"],
			[12.95, { f: CENTER, s: [1262, 596], z: 1.1, rx: 4, ry: -5, rz: 0, dof: 0 }, "linear"],
			[13.35, { f: CENTER, s: [1262, 700], z: 0.98, rx: 10, ry: -5, rz: 0, dof: 0 }, "in"],
			[16.95, { f: CENTER, s: [960, 700], z: 0.66, rx: 32, ry: -20, rz: 0, dof: 0 }, "hold"],
			[17.3, { f: CENTER, s: [960, 466], z: 1.12, rx: 26, ry: -14, rz: 0, dof: 0 }, "outQuint"],
			[21, { f: CENTER, s: [960, 450], z: 1.2, rx: 22, ry: 5, rz: 0, dof: 0 }, "linear"],
		];

const LAYOUT = MOBILE
	? {
			typeX: 72,
			typeWidth: 936,
			type: {
				hook: { size: 100, top: 250 },
				control: { size: 128, top: 250 },
				like: { size: 170, top: 270 },
				save: { size: 170, top: 270 },
				play: { size: 170, top: 270 },
				personal: { size: 112, top: 250 },
				setup: { size: 98, top: 250 },
			},
			panel: { x: 72, y: 1170, width: 936, columns: 2 },
			setup: { width: 600, height: 1120, anchor: [300, 430], screen: [540, 1250], scale: 1.36, push: 1.44, pushShift: 0, pushLift: 0 },
			steps: { vertical: true, x: 72, top: 250, size: 116 },
			bg: { hook: [50, 62], control: [50, 58], actions: [50, 58], personal: [50, 42], setup: [50, 55], complete: [50, 58], end: [50, 45] },
			end: { x: 540, y: 860, symbolScale: 3.6, lockupWidth: 820, taglineY: 1010, taglineSize: 50, supportY: 1088, supportSize: 25 },
			hookSymbol: { x: 540, y: 960, scale: 3.2 },
		}
	: {
			typeX: 128,
			typeWidth: 1300,
			type: {
				hook: { size: 112, center: 540 },
				control: { size: 128, center: 540 },
				like: { size: 196, center: 540 },
				save: { size: 196, center: 540 },
				play: { size: 196, center: 540 },
				personal: { size: 92, top: 112 },
				setup: { size: 76, center: 540 },
			},
			panel: { x: 128, y: 334, width: 470, columns: 1 },
			setup: { width: 1280, height: 940, anchor: [640, 420], screen: [1320, 540], scale: 1.18, push: 1.24, pushShift: 0, pushLift: 70 },
			steps: { vertical: false, center: 960, y: 936, size: 62 },
			bg: { hook: [68, 52], control: [64, 52], actions: [64, 52], personal: [64, 56], setup: [68, 50], complete: [50, 44], end: [50, 45] },
			end: { x: 960, y: 470, symbolScale: 3.4, lockupWidth: 860, taglineY: 640, taglineSize: 44, supportY: 714, supportSize: 22 },
			hookSymbol: { x: 960, y: 540, scale: 3.4 },
		};

// ---------------------------------------------------------------------------------------------------------------------------------
// Deck state: what Deckify shows, derived from a small playback model the same way the plugin's views derive it.
// ---------------------------------------------------------------------------------------------------------------------------------

const KEYS = T.LAYOUT.flatMap((row, r) => row.map(([id, action, playlist], c) => ({ id, action, playlist, r, c, index: r * 5 + c })));
const KEY_BY_ID = Object.fromEntries(KEYS.map((k) => [k.id, k]));
const PRESS_TIMES = {};
for (const event of T.DECK_EVENTS) {
	if (event.press) {
		(PRESS_TIMES[event.press] ??= []).push(event.t);
	}
}

const progressAt = (s, t) => (s.track ? s.at + (s.playing ? (t - s.trackStart) / T.TRACKS[s.track].seconds : 0) : 0);

function setTrack(s, track, t) {
	s.track = track;
	s.at = 0;
	s.trackStart = t;
}

/** Applies what a key press does in Deckify. */
function press(s, id, t) {
	const key = KEY_BY_ID[id];
	switch (key.action) {
		case "playPause":
			s.at = progressAt(s, t);
			s.trackStart = t;
			s.playing = !s.playing;
			break;
		case "next":
			setTrack(s, T.NEXT_TRACK[s.track], t);
			break;
		case "previous":
			s.at = 0;
			s.trackStart = t;
			break;
		case "volUp":
			s.volume = Math.min(100, (s.muted ? 0 : s.volume) + 10);
			s.muted = false;
			break;
		case "volDown":
			s.volume = Math.max(0, s.volume - 10);
			break;
		case "mute":
			s.muted = !s.muted;
			break;
		case "like":
			s.liked = { ...s.liked, [s.track]: !s.liked[s.track] };
			break;
		case "add":
			s.feedback = { ...s.feedback, [id]: { from: t, text: "Added", busy: 0.2 } };
			break;
		case "play":
			s.feedback = { ...s.feedback, [id]: { from: t, text: "Started", busy: 0.12 } };
			setTrack(s, T.PLAYLIST_START_TRACK[id], t);
			s.playing = true;
			break;
	}
}

function deckStateAt(t) {
	let s = null;
	for (const event of T.DECK_EVENTS) {
		if (event.t > t) {
			break;
		}
		if (event.reset) {
			s = { ...event.reset, liked: { ...event.reset.liked }, trackStart: event.t, feedback: {}, powerAt: event.reset.power ? -10 : Infinity, cleared: null };
		} else if (event.set) {
			const { power, cleared, track, at, ...rest } = event.set;
			Object.assign(s, rest);
			if (power && !s.power) {
				s.powerAt = event.t;
			}
			if (power !== undefined) {
				s.power = power;
			}
			if (cleared) {
				s.cleared = event.t;
			}
			if (track !== undefined) {
				setTrack(s, track, event.t);
				s.at = at ?? 0;
			}
		} else if (event.press) {
			press(s, event.press, event.t);
		}
	}
	return s;
}

/** Shortens a playlist name for a key title, like the plugin's playlistKeyTitle (10 characters a line, two lines). */
function playlistTitle(name) {
	if (name.length <= 10) {
		return name;
	}
	const space = name.lastIndexOf(" ", 10);
	const cut = space > 0 ? space : 10;
	return `${name.slice(0, cut).trim()}\n${name.slice(cut).trim()}`.slice(0, 22);
}

/** The key's image and title, as Deckify's views would show them. */
function keyView(key, s, t) {
	const signedOut = s.account !== "connected";
	const disabled = (img, title = "Connect") => ({ img, title });
	switch (key.action) {
		case "previous":
		case "next":
			return { img: `playback/${key.action}${signedOut ? "-disabled" : ""}.svg`, title: "" };
		case "playPause":
			return signedOut ? disabled("playback/play-disabled.svg") : { img: s.playing ? "playback/pause.svg" : "playback/play.svg", title: "" };
		case "nowPlaying":
			return { nowPlaying: true };
		case "volUp":
		case "volDown": {
			const dir = key.action === "volUp" ? "up" : "down";
			return signedOut ? disabled(`volume/volume-${dir}-disabled.svg`) : { img: `volume/volume-${dir}.svg`, title: `${s.muted ? 0 : s.volume}%` };
		}
		case "mute":
			return signedOut ? disabled("volume/speaker-disabled.svg") : { img: s.muted ? "volume/speaker-muted.svg" : "volume/speaker.svg", title: "" };
		case "like":
			return signedOut ? disabled("library/heart-disabled.svg") : { img: s.liked[s.track] ? "library/heart-filled.svg" : "library/heart-outline.svg", title: "" };
		case "add":
		case "play": {
			const base = key.action === "add" ? "playlist/add" : "playlist/play";
			if (signedOut) {
				return disabled(`${base}-disabled.svg`);
			}
			if (!s.chosen) {
				return disabled(`${base}-disabled.svg`, "Choose\nPlaylist");
			}
			const fb = s.feedback[key.id];
			if (fb && t < fb.from + T.FEEDBACK_SECONDS) {
				if (t < fb.from + fb.busy) {
					return { img: `${base}.svg`, title: key.action === "add" ? "Adding…" : playlistTitle(key.playlist) };
				}
				return { img: key.action === "add" ? "playlist/add-done.svg" : "playlist/play.svg", title: fb.text };
			}
			return { img: `${base}.svg`, title: playlistTitle(key.playlist) };
		}
		case "account":
			return {
				connected: { img: "spotify-account/connected.svg", title: "Connected" },
				connecting: { img: "spotify-account/connecting.svg", title: "Connecting" },
				disconnected: { img: "spotify-account/disconnected.svg", title: "Connect" },
			}[s.account];
	}
	return { img: null, title: "" };
}

/** Every image a key can show, so all of them are decoded before the first frame. */
function imagesFor(key) {
	switch (key.action) {
		case "previous":
		case "next":
			return [`playback/${key.action}.svg`, `playback/${key.action}-disabled.svg`];
		case "playPause":
			return ["playback/play.svg", "playback/pause.svg", "playback/play-disabled.svg"];
		case "volUp":
			return ["volume/volume-up.svg", "volume/volume-up-disabled.svg"];
		case "volDown":
			return ["volume/volume-down.svg", "volume/volume-down-disabled.svg"];
		case "mute":
			return ["volume/speaker.svg", "volume/speaker-muted.svg", "volume/speaker-disabled.svg"];
		case "like":
			return ["library/heart-outline.svg", "library/heart-filled.svg", "library/heart-disabled.svg"];
		case "add":
			return ["playlist/add.svg", "playlist/add-done.svg", "playlist/add-disabled.svg"];
		case "play":
			return ["playlist/play.svg", "playlist/play-disabled.svg"];
		case "account":
			return ["spotify-account/connected.svg", "spotify-account/connecting.svg", "spotify-account/disconnected.svg"];
	}
	return [];
}

/** Press depth 0–1 for a key: down just before the press lands, a short hold, then release. */
function pressDepth(times, t) {
	let depth = 0;
	let ring = 0;
	for (const tp of times ?? []) {
		const dt = t - tp;
		if (dt < -0.07 || dt > 0.6) {
			continue;
		}
		const d = dt < 0 ? E.out((dt + 0.07) / 0.07) : dt < 0.05 ? 1 : 1 - E.out(clamp((dt - 0.05) / 0.24));
		const r = dt < 0 ? d : 1 - E.out(clamp(dt / 0.55));
		depth = Math.max(depth, d);
		ring = Math.max(ring, r);
	}
	return { depth, ring };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
document.body.classList.toggle("mobile", MOBILE);
const stage = $("stage");
stage.style.width = `${W}px`;
stage.style.height = `${H}px`;
const rig = $("rig");
const world = $("world");

const device = document.createElement("div");
device.className = "device";
rig.append(device);

const keyEls = KEYS.map((key) => {
	const well = document.createElement("div");
	well.className = "well";
	const [x, y] = [PAD_X + key.c * PITCH, PAD_Y + key.r * PITCH];
	well.style.left = `${x}px`;
	well.style.top = `${y}px`;
	const halo = document.createElement("div");
	halo.className = "halo";
	const face = document.createElement("div");
	face.className = "face";
	const images = {};
	for (const src of imagesFor(key)) {
		const img = document.createElement("img");
		img.src = IMG + src;
		img.alt = "";
		img.style.opacity = "0";
		face.append(img);
		images[src] = img;
	}
	let np = null;
	let spotify = null;
	if (key.action === "nowPlaying") {
		np = document.createElement("div");
		np.className = "np";
		spotify = document.createElement("img");
		spotify.className = "spotify";
		spotify.src = SPOTIFY_ICON;
		spotify.alt = "";
		face.append(np, spotify);
	}
	const title = document.createElement("div");
	title.className = "title";
	const gloss = document.createElement("div");
	gloss.className = "gloss";
	const ring = document.createElement("div");
	ring.className = "ring";
	face.append(title, gloss, ring);
	well.append(halo, face);
	device.append(well);
	return { key, well, face, images, np, spotify, title, ring, halo, shown: null, npMarkup: "" };
});

// ---- Actions list (personalization) ----
const ACTION_LIST = [
	["account", "Spotify Account", "spotify-account/icon.svg"],
	["previous", "Previous Track", "playback/previous-icon.svg"],
	["playPause", "Play / Pause", "playback/play-pause-icon.svg"],
	["next", "Next Track", "playback/next-icon.svg"],
	["nowPlaying", "Now Playing", "playback/now-playing-icon.svg"],
	["volDown", "Volume Down", "volume/volume-down-icon.svg"],
	["volUp", "Volume Up", "volume/volume-up-icon.svg"],
	["mute", "Mute / Unmute", "volume/mute-icon.svg"],
	["like", "Like / Unlike", "library/like-icon.svg"],
	["add", "Add to Playlist", "playlist/add-icon.svg"],
	["play", "Play Playlist", "playlist/play-icon.svg"],
];
const panel = $("panel");
panel.style.left = `${LAYOUT.panel.x}px`;
panel.style.top = `${LAYOUT.panel.y}px`;
panel.style.width = `${LAYOUT.panel.width}px`;
panel.innerHTML = `<div class="panel-head"><img src="/plugin/imgs/plugin/category-icon.svg" alt="" />Deckify<span class="count">${ACTION_LIST.length} actions</span></div>`;
const rowsEl = document.createElement("div");
rowsEl.className = "rows";
rowsEl.style.gridTemplateColumns = `repeat(${LAYOUT.panel.columns}, 1fr)`;
if (LAYOUT.panel.columns > 1) {
	// Column-major order, so the list still reads top to bottom.
	rowsEl.style.gridAutoFlow = "column";
	rowsEl.style.gridTemplateRows = `repeat(${Math.ceil(ACTION_LIST.length / LAYOUT.panel.columns)}, auto)`;
}
panel.append(rowsEl);
const rowEls = Object.fromEntries(
	ACTION_LIST.map(([action, name, icon]) => {
		const row = document.createElement("div");
		row.className = "row";
		row.innerHTML = `<span class="hl"></span><img src="${IMG}${icon}" alt="" /><span>${name}</span>`;
		rowsEl.append(row);
		return [action, row];
	}),
);
const flyers = KEYS.map((key) => {
	const el = document.createElement("div");
	el.className = "flyer";
	el.style.opacity = "0";
	const img = document.createElement("img");
	el.append(img);
	$("flyers").append(el);
	return { key, el, img };
});

// ---- Headlines ----
const typeLayer = $("type");
let measureCtx;
function textWidth(text, size) {
	measureCtx ??= document.createElement("canvas").getContext("2d");
	measureCtx.font = `800 ${size}px Inter`;
	return measureCtx.measureText(text).width * (1 - 0.025 * 0.5);
}
/** Splits a line that would not fit the safe width (mobile), keeping the reveal order. */
function fitLines(lines, size, width) {
	return lines.flatMap((line, i) => {
		if (textWidth(line.text, size) <= width) {
			return [line];
		}
		const words = line.text.split(" ");
		const out = [];
		let current = "";
		for (const word of words) {
			const next = current ? `${current} ${word}` : word;
			if (current && textWidth(next, size) > width) {
				out.push(current);
				current = word;
			} else {
				current = next;
			}
		}
		out.push(current);
		return out.map((text, j) => ({ text, in: line.in + j * 0.1, key: `${i}.${j}` }));
	});
}
const accentDot = (text) => text.replace(/\.$/, '<span class="dot">.</span>');
let headlines = [];
function buildHeadlines() {
	headlines = T.COPY.map((block) => {
		const spec = LAYOUT.type[block.id];
		const el = document.createElement("div");
		el.className = "headline";
		el.style.fontSize = `${spec.size}px`;
		el.style.left = `${LAYOUT.typeX}px`;
		const lines = fitLines(block.lines, spec.size, LAYOUT.typeWidth).map((line) => {
			const outer = document.createElement("span");
			outer.className = "line";
			const inner = document.createElement("span");
			inner.className = "inner";
			inner.innerHTML = accentDot(line.text);
			outer.append(inner);
			el.append(outer);
			return { ...line, inner };
		});
		typeLayer.append(el);
		const top = spec.top ?? spec.center - el.offsetHeight / 2;
		el.style.top = `${top}px`;
		return { block, el, lines };
	});
}

// ---- INSTALL → CONNECT → CHOOSE → PLAY ----
const stepsEl = $("steps");
const stepWords = [];
const stepArrows = [];
function buildSteps() {
	const spec = LAYOUT.steps;
	stepsEl.style.fontSize = `${spec.size}px`;
	if (spec.vertical) {
		stepsEl.style.flexDirection = "column";
		stepsEl.style.alignItems = "flex-start";
		stepsEl.style.left = `${spec.x}px`;
		stepsEl.style.top = `${spec.top}px`;
		stepsEl.style.lineHeight = "1.02";
	}
	T.STEPS.words.forEach((word, i) => {
		if (i > 0 && !spec.vertical) {
			const arrow = document.createElement("span");
			arrow.className = "arrow";
			arrow.textContent = "→";
			arrow.style.margin = "0 0.42em";
			stepsEl.append(arrow);
			stepArrows.push(arrow);
		}
		const el = document.createElement("span");
		el.className = "word";
		el.textContent = word;
		stepsEl.append(el);
		stepWords.push(el);
	});
	if (!spec.vertical) {
		stepsEl.style.left = `${spec.center - stepsEl.offsetWidth / 2}px`;
		stepsEl.style.top = `${spec.y - stepsEl.offsetHeight / 2}px`;
	}
}

// ---- Marks: Deckify's official symbol and lockup, inlined from assets/brand/ unchanged ----
const marks = $("marks");
let hookMark;
let lockup;
async function buildMarks() {
	const [symbolSvg, logoSvg] = await Promise.all([
		fetch("/brand/deckify-symbol.svg").then((r) => r.text()),
		fetch("/brand/deckify-logo-on-dark.svg").then((r) => r.text()),
	]);
	const parse = (text) => new DOMParser().parseFromString(text, "image/svg+xml").documentElement;

	// Symbol: viewBox 11 10 80 80.
	const symbol = document.importNode(parse(symbolSvg), true);
	symbol.classList.add("mark");
	symbol.setAttribute("width", "80");
	symbol.setAttribute("height", "80");
	marks.append(symbol);
	hookMark = { svg: symbol, d: symbol.querySelector("path"), keys: [...symbol.querySelectorAll("rect")], clip: addClip(symbol, "hook-d", 11, 10, 0, 80) };
	hookMark.d.setAttribute("clip-path", "url(#hook-d)");

	// Lockup: viewBox 12 10 363.77 80.
	const logo = document.importNode(parse(logoSvg), true);
	logo.classList.add("mark");
	logo.setAttribute("width", "363.77");
	logo.setAttribute("height", "80");
	marks.append(logo);
	const paths = logo.querySelectorAll("path");
	lockup = {
		svg: logo,
		d: paths[0],
		keys: [...logo.querySelectorAll("rect")],
		word: paths[1],
		dClip: addClip(logo, "end-d", 12, 10, 0, 80),
		wordClip: addClip(logo, "end-word", 108, 0, 0, 100),
	};
	lockup.d.setAttribute("clip-path", "url(#end-d)");
	// Clip a group around the wordmark (a clip on the path itself would move with the path's own transform).
	const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
	group.setAttribute("clip-path", "url(#end-word)");
	lockup.word.replaceWith(group);
	group.append(lockup.word);
}
function addClip(svg, id, x, y, width, height) {
	const ns = "http://www.w3.org/2000/svg";
	const defs = document.createElementNS(ns, "defs");
	const clip = document.createElementNS(ns, "clipPath");
	clip.id = id;
	const rect = document.createElementNS(ns, "rect");
	for (const [k, v] of Object.entries({ x, y, width, height })) {
		rect.setAttribute(k, String(v));
	}
	clip.append(rect);
	defs.append(clip);
	svg.prepend(defs);
	return rect;
}

// ---- Grain: one seeded noise tile, shifted every frame ----
function buildGrain() {
	const size = 256;
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext("2d");
	const data = ctx.createImageData(size, size);
	let seed = 1234567;
	const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
	for (let i = 0; i < size * size; i++) {
		const v = Math.round(rand() * 255);
		data.data.set([v, v, v, 255], i * 4);
	}
	ctx.putImageData(data, 0, 0);
	$("grain").style.backgroundImage = `url(${canvas.toDataURL()})`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Deckify Setup: the real page in a frame, driven by the bridge.
// ---------------------------------------------------------------------------------------------------------------------------------

const S = T.SETUP_EVENTS;
const setupWrap = $("setup-wrap");
const frame = $("setup");
frame.style.width = `${LAYOUT.setup.width}px`;
frame.style.height = `${LAYOUT.setup.height}px`;

const doc = () => frame.contentDocument;
const q = (selector) => doc().querySelector(selector);
const visible = (el) => el && el.getClientRects().length > 0;

/** Scripted interactions, in order. `target` is what the cursor goes to (and what is pressed for clicks). */
const SETUP_SCRIPT = [
	{ t: S.typeStart - 0.03, target: "#client-id", run: () => q("#client-id").focus() },
	{ t: S.save, target: "#save-client-id", click: true },
	{ t: S.connect, target: '#connect-ready [data-action="connect"]', click: true },
	{ t: S.failure, run: (bridge) => bridge.push({ status: "disconnected", activity: null, issue: "authorization-failed" }) },
	{ t: S.copy, target: "#connect-issue .copy-button", click: true },
	{ t: S.retry, target: '#connect-issue button[data-action="connect"]', click: true },
	{ t: S.connected, run: (bridge) => bridge.push({ status: "connected", activity: null, issue: null, displayName: T.DEMO_ACCOUNT, product: "premium" }) },
];
/** When the cursor sets off for each target. */
const CURSOR_LEGS = [
	{ from: S.enter + 0.05, to: S.typeStart - 0.05, target: 0 },
	{ from: S.typeEnd - 0.02, to: S.save - 0.06, target: 1 },
	{ from: S.save + 0.06, to: S.connect - 0.06, target: 2 },
	{ from: S.failure + 0.3, to: S.copy - 0.08, target: 4 },
	{ from: S.copy + 0.3, to: S.retry - 0.08, target: 5 },
];

const setupDriver = {
	applied: 0,
	typed: 0,
	lastT: -Infinity,
	targets: {},
	async load() {
		this.applied = 0;
		this.typed = 0;
		this.targets = {};
		await new Promise((resolve) => {
			frame.onload = resolve;
			frame.src = `/setup/index.html#launch=film`;
		});
		const bridge = frame.contentWindow.__deckifyFilm;
		for (let i = 0; i < 50 && !visible(q("#client-id")); i++) {
			await bridge.tick(0);
			await new Promise((r) => requestAnimationFrame(r));
		}
		await frame.contentDocument.fonts.ready;
	},
	async seek(t) {
		if (t < this.lastT - 1e-6) {
			await this.load();
		}
		this.lastT = t;
		const bridge = frame.contentWindow.__deckifyFilm;
		while (this.applied < SETUP_SCRIPT.length && SETUP_SCRIPT[this.applied].t <= t) {
			const step = SETUP_SCRIPT[this.applied];
			this.type(step.t);
			await bridge.tick(step.t * 1000);
			if (step.target) {
				this.targets[this.applied] = this.locate(step.target) ?? this.targets[this.applied];
			}
			if (step.click) {
				q(step.target)?.click();
			}
			step.run?.(bridge);
			this.applied++;
		}
		this.type(t);
		await bridge.tick(t * 1000);
		// Pressed look just before a scripted click lands.
		for (const el of doc().querySelectorAll(".film-pressed")) {
			el.classList.remove("film-pressed");
		}
		const next = SETUP_SCRIPT.find((step) => step.click && t >= step.t - 0.11 && t < step.t);
		if (next) {
			q(next.target)?.classList.add("film-pressed");
		}
	},
	/** Types the demo Client ID into the real field, as far as film time `t` (only before it is saved). */
	type(t) {
		const typed = Math.round(prog(t, S.typeStart, S.typeEnd - S.typeStart) * T.DEMO_CLIENT_ID.length);
		if (typed !== this.typed && t < S.save) {
			const field = q("#client-id");
			field.value = T.DEMO_CLIENT_ID.slice(0, typed);
			field.dispatchEvent(new Event("input", { bubbles: true }));
			this.typed = typed;
		}
	},
	/** Centre of an element in the page, in page pixels. */
	locate(selector) {
		const el = q(selector);
		if (!visible(el)) {
			return undefined;
		}
		const r = el.getBoundingClientRect();
		return selector === "#client-id" ? [r.left + r.width * 0.62, r.top + r.height * 0.55] : [r.left + r.width * 0.55, r.top + r.height * 0.6];
	},
	target(index) {
		const step = SETUP_SCRIPT[index];
		return this.targets[index] ?? this.locate(step.target) ?? [LAYOUT.setup.width * 0.6, LAYOUT.setup.height * 0.75];
	},
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------------------------------------------------------------

function cameraAt(t) {
	let k = 0;
	while (k < CAMERA.length - 1 && CAMERA[k + 1][0] <= t) {
		k++;
	}
	const [t0, a] = CAMERA[k];
	if (k === CAMERA.length - 1) {
		return a;
	}
	const [t1, b, easeName] = CAMERA[k + 1];
	if (easeName === "hold") {
		return a;
	}
	const e = E[easeName ?? "inOut"](clamp((t - t0) / (t1 - t0)));
	return {
		f: [lerp(a.f[0], b.f[0], e), lerp(a.f[1], b.f[1], e)],
		s: [lerp(a.s[0], b.s[0], e), lerp(a.s[1], b.s[1], e)],
		z: lerp(a.z, b.z, e),
		rx: lerp(a.rx, b.rx, e),
		ry: lerp(a.ry, b.ry, e),
		rz: lerp(a.rz, b.rz, e),
		dof: lerp(a.dof, b.dof, e),
	};
}
const screenOf = (cam) => [cam.s[0] - cam.z * (cam.f[0] - CENTER[0]), cam.s[1] - cam.z * (cam.f[1] - CENTER[1])];

/** Deck visibility: hidden for the symbol flash, the setup scene and the end card. */
function deckOpacity(t) {
	if (t < T.HOOK_SYMBOL.out) {
		return 1 - prog(t, 2.04, 0.2, E.in);
	}
	if (t < 9) {
		return prog(t, 2.82, 0.22, E.out);
	}
	if (t < 16.9) {
		return 1 - prog(t, 12.95, 0.22, E.out);
	}
	if (t < T.END.fadeOut) {
		return prog(t, 16.95, 0.25, E.out);
	}
	return 1 - prog(t, T.END.fadeOut, 0.35, E.in);
}

function drawDeck(t, s) {
	const opacity = deckOpacity(t);
	world.style.opacity = opacity.toFixed(3);
	if (opacity <= 0.001) {
		world.style.visibility = "hidden";
		return;
	}
	world.style.visibility = "visible";

	const cam = cameraAt(t);
	rig.style.transform =
		`translate(${cam.s[0].toFixed(2)}px, ${cam.s[1].toFixed(2)}px) rotateX(${cam.rx.toFixed(3)}deg) rotateY(${cam.ry.toFixed(3)}deg) ` +
		`rotateZ(${cam.rz.toFixed(3)}deg) scale(${cam.z.toFixed(4)}) translate(${(-cam.f[0]).toFixed(2)}px, ${(-cam.f[1]).toFixed(2)}px)`;

	// Motion blur from the camera's screen-space speed (180° shutter at 30 fps).
	const dt = 1 / 60;
	const [x1, y1] = screenOf(cam);
	const [x0, y0] = screenOf(cameraAt(t - dt));
	const vx = Math.abs(x1 - x0) / dt;
	const vy = Math.abs(y1 - y0) / dt;
	const zoomSpeed = (Math.abs(cam.z - cameraAt(t - dt).z) / dt) * 120;
	const bx = Math.min(36, (vx + zoomSpeed * 0.3) / 160);
	const by = Math.min(36, (vy + zoomSpeed * 0.3) / 160);
	if (bx > 0.6 || by > 0.6) {
		$("motion-blur-std").setAttribute("stdDeviation", `${bx.toFixed(2)} ${by.toFixed(2)}`);
		world.style.filter = "url(#motion-blur)";
	} else {
		world.style.filter = "none";
	}

	const focusKey = [(cam.f[0] - PAD_X - KEY / 2) / PITCH, (cam.f[1] - PAD_Y - KEY / 2) / PITCH];
	const personal = s.cleared !== null && t >= s.cleared;
	for (const k of keyEls) {
		const { key } = k;
		// Depth of field: keys away from the focus point go soft in the macro shots.
		const dist = Math.hypot(key.c - focusKey[0], key.r - focusKey[1]);
		const blur = cam.dof * clamp(dist - 0.55, 0, 3) * 2.4;
		k.well.style.filter = blur > 0.2 ? `blur(${blur.toFixed(2)}px)` : "none";

		// Power: the LCD wakes in a short wave from the left (or around the focused key in the hook).
		const delay = t < 3 ? Math.hypot(key.c - 1, key.r) * 0.045 : key.c * 0.05 + key.r * 0.03;
		let lit = s.power ? prog(t, s.powerAt + delay, 0.14, E.out) : 0;
		// Personalization: keys stay empty until their action is dropped on them.
		let landing = Infinity;
		if (personal) {
			landing = T.PERSONAL_DROPS.start + key.index * T.PERSONAL_DROPS.stagger + T.PERSONAL_DROPS.flight;
			lit = Math.min(lit, prog(t, landing, 0.08, E.out));
		}
		const view = keyView(key, s, t);
		showKey(k, view, lit, s, t);

		const presses = pressDepth(PRESS_TIMES[key.id], t);
		const land = personal ? pressDepth([landing + 0.04], t) : { depth: 0, ring: 0 };
		const depth = Math.max(presses.depth, land.depth * 0.6);
		const ring = Math.max(presses.ring, land.ring * 0.7);
		k.face.style.transform = depth > 0.001 ? `scale(${(1 - 0.075 * depth).toFixed(4)})` : "none";
		k.face.style.filter = depth > 0.001 ? `brightness(${(1 + 0.18 * depth).toFixed(3)})` : "none";
		k.ring.style.opacity = (ring * 0.85).toFixed(3);
		k.halo.style.opacity = (ring * 0.55).toFixed(3);
	}
}

function showKey(k, view, lit, s, t) {
	k.face.style.opacity = "1";
	const contentOpacity = lit.toFixed(3);
	if (view.nowPlaying) {
		const item = s.account === "connected" && s.track ? { ...T.TRACKS[s.track], isPlaying: s.playing, progress: progressAt(s, t) } : null;
		const markup = nowPlayingSvg(item, null, s.account === "connected" ? "Open Spotify" : "Connect Spotify");
		if (markup !== k.npMarkup) {
			k.np.innerHTML = markup;
			k.npMarkup = markup;
		}
		k.np.style.opacity = contentOpacity;
		k.spotify.style.opacity = item ? contentOpacity : "0";
		k.title.textContent = "";
		return;
	}
	for (const [src, img] of Object.entries(k.images)) {
		img.style.opacity = src === view.img ? contentOpacity : "0";
	}
	k.title.textContent = view.title;
	k.title.style.opacity = contentOpacity;
}

function drawPanel(t) {
	const show = window01(t, 9.12, 0.4, 12.85, 0.25, E.outQuint);
	panel.style.opacity = show.toFixed(3);
	panel.style.visibility = show > 0.001 ? "visible" : "hidden";
	const enter = 1 - prog(t, 9.12, 0.45, E.outQuint);
	const exit = prog(t, 12.85, 0.25, E.in);
	panel.style.transform = `translateX(${(-60 * enter - 80 * exit).toFixed(2)}px)`;

	const P = T.PERSONAL_DROPS;
	const stageBox = stage.getBoundingClientRect();
	const scale = stageBox.width / W;
	// A row lights up as its action is picked up, then fades.
	const highlight = {};
	for (const f of flyers) {
		const dt = t - (P.start + f.key.index * P.stagger);
		const pulse = dt < -0.06 || dt > 0.4 ? 0 : dt < 0 ? (dt + 0.06) / 0.06 : 1 - E.out(dt / 0.4);
		highlight[f.key.action] = Math.max(highlight[f.key.action] ?? 0, pulse);
	}
	for (const [action, row] of Object.entries(rowEls)) {
		row.firstChild.style.opacity = (highlight[action] ?? 0).toFixed(3);
	}
	for (const f of flyers) {
		const start = P.start + f.key.index * P.stagger;
		const k = (t - start) / P.flight;
		const row = rowEls[f.key.action];
		if (k < 0 || k > 1 || show < 0.01) {
			f.el.style.opacity = "0";
			continue;
		}
		const s0 = deckStateAt(start + P.flight);
		const view = keyView(f.key, s0, start + P.flight);
		const src = view.nowPlaying ? "playback/now-playing.svg" : view.img;
		if (f.img.dataset.src !== src) {
			f.img.src = IMG + src;
			f.img.dataset.src = src;
		}
		const rr = row.getBoundingClientRect();
		const wr = keyEls[f.key.index].well.getBoundingClientRect();
		const from = [(rr.left - stageBox.left) / scale + 32, (rr.top - stageBox.top) / scale + rr.height / scale / 2];
		const toSize = wr.width / scale;
		const to = [(wr.left - stageBox.left) / scale + toSize / 2, (wr.top - stageBox.top) / scale + wr.height / scale / 2];
		const e = E.inOut(k);
		const lift = MOBILE ? 160 : 140;
		const mid = [(from[0] + to[0]) / 2, Math.min(from[1], to[1]) - lift];
		const x = (1 - e) ** 2 * from[0] + 2 * (1 - e) * e * mid[0] + e * e * to[0];
		const y = (1 - e) ** 2 * from[1] + 2 * (1 - e) * e * mid[1] + e * e * to[1];
		const size = lerp(46, toSize * 0.92, e);
		const sc = size / KEY;
		f.el.style.opacity = (k < 0.12 ? k / 0.12 : k > 0.9 ? (1 - k) / 0.1 : 1).toFixed(3);
		f.el.style.transform = `translate(${(x - size / 2).toFixed(2)}px, ${(y - size / 2).toFixed(2)}px) rotate(${(lerp(-6, 0, e)).toFixed(2)}deg) scale(${sc.toFixed(4)})`;
	}
}

function drawSetup(t) {
	const L = LAYOUT.setup;
	const show = window01(t, S.enter - 0.05, 0.4, 16.92, 0.28, E.outQuint);
	setupWrap.style.opacity = show.toFixed(3);
	setupWrap.style.visibility = show > 0.001 ? "visible" : "hidden";
	const enter = 1 - prog(t, S.enter - 0.05, 0.5, E.outQuint);
	const exit = prog(t, 16.92, 0.3, E.in);
	const push = prog(t, S.failure - 0.05, 0.45, E.inOut) * (1 - prog(t, S.retry + 0.05, 0.4, E.inOut));
	const scale = L.scale * lerp(1, L.push / L.scale, push) * (1 - 0.05 * enter) * (1 - 0.06 * exit);
	// While pushed in, aim a little lower: the guidance card sits below the step header.
	const anchorY = L.anchor[1] + push * L.pushLift;
	const x = L.screen[0] + L.pushShift * push - L.anchor[0] * scale;
	const y = L.screen[1] - anchorY * scale + 70 * enter - 40 * exit;
	setupWrap.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${scale.toFixed(4)})`;
	setupWrap.style.filter = enter > 0.02 || exit > 0.02 ? `blur(${(8 * Math.max(enter, exit)).toFixed(2)}px)` : "none";

	// Cursor.
	const cursor = $("cursor");
	const click = $("click");
	const cursorShow = window01(t, S.enter + 0.05, 0.2, S.connected + 0.1, 0.25);
	cursor.style.opacity = cursorShow.toFixed(3);
	click.style.opacity = "0";
	if (cursorShow <= 0.001) {
		return;
	}
	let pos = [L.width * 0.78, L.height * 0.9];
	for (const leg of CURSOR_LEGS) {
		const to = setupDriver.target(leg.target);
		if (t >= leg.to) {
			pos = to;
		} else if (t > leg.from) {
			const e = E.inOut((t - leg.from) / (leg.to - leg.from));
			const arc = Math.sin(e * Math.PI) * 26;
			pos = [lerp(pos[0], to[0], e) + arc * 0.3, lerp(pos[1], to[1], e) - arc];
			break;
		} else {
			break;
		}
	}
	const sx = x + pos[0] * scale;
	const sy = y + pos[1] * scale;
	const clickStep = SETUP_SCRIPT.filter((step) => step.click && t >= step.t - 0.1 && t < step.t + 0.4).pop();
	const pressed = clickStep && t < clickStep.t + 0.05 ? 0.88 : 1;
	cursor.style.transform = `translate(${(sx - 3).toFixed(2)}px, ${(sy - 2).toFixed(2)}px) scale(${(scale * 1.15 * pressed).toFixed(3)})`;
	if (clickStep && t >= clickStep.t) {
		const k = (t - clickStep.t) / 0.4;
		click.style.opacity = ((1 - k) * 0.7).toFixed(3);
		click.style.transform = `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px) scale(${(0.3 + E.out(k) * 0.9).toFixed(3)})`;
	}
}

function drawHeadlines(t) {
	let scrim = 0;
	for (const h of headlines) {
		scrim = Math.max(scrim, window01(t, h.block.lines[0].in - 0.15, 0.3, h.block.out, 0.35));
	}
	$("scrim").style.opacity = scrim.toFixed(3);
	for (const h of headlines) {
		const { block } = h;
		const active = t >= block.lines[0].in - 0.05 && t < block.out + 0.4;
		h.el.style.visibility = active ? "visible" : "hidden";
		if (!active) {
			continue;
		}
		h.lines.forEach((line, i) => {
			const inK = prog(t, line.in, 0.42, E.outExpo);
			const outK = prog(t, block.out + i * 0.03, 0.26, E.in);
			const y = (1 - inK) * 108 - outK * 108;
			line.inner.style.transform = `translateY(${y.toFixed(2)}%)`;
		});
	}
}

function drawSteps(t) {
	const show = window01(t, T.STEPS.at[0] - 0.22, 0.22, T.STEPS.out, 0.22);
	stepsEl.style.opacity = show.toFixed(3);
	stepsEl.style.visibility = show > 0.001 ? "visible" : "hidden";
	if (show <= 0.001) {
		return;
	}
	stepsEl.style.transform = `translateY(${((1 - prog(t, T.STEPS.at[0] - 0.22, 0.4, E.outQuint)) * 24).toFixed(2)}px)`;
	const allLit = prog(t, T.STEPS.at[3] + 0.5, 0.3, E.out);
	T.STEPS.at.forEach((at, i) => {
		const k = prog(t, at, 0.18, E.out);
		const pop = Math.sin(clamp((t - at) / 0.32) * Math.PI) * 0.045;
		const word = stepWords[i];
		word.style.color = mix("#3a3a42", "#ffffff", k);
		word.style.transform = `scale(${(1 + pop).toFixed(4)})`;
		if (i > 0 && stepArrows[i - 1]) {
			stepArrows[i - 1].style.color = mix("#3a3a42", "#7c5cff", Math.max(k * 0.6, allLit));
		}
	});
}

function mix(a, b, k) {
	const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
	const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
	return `rgb(${pa.map((v, i) => Math.round(lerp(v, pb[i], k))).join(",")})`;
}

/** Symbol flash at the end of the hook. */
function drawHookMark(t) {
	const { svg, keys, clip } = hookMark;
	const H0 = T.HOOK_SYMBOL;
	const active = t >= H0.in && t < H0.out + 0.05;
	svg.style.visibility = active ? "visible" : "hidden";
	if (!active) {
		return;
	}
	const L = LAYOUT.hookSymbol;
	const out = prog(t, H0.out - 0.24, 0.24, E.in);
	const scale = L.scale * (0.94 + 0.06 * prog(t, H0.in, 0.35, E.outQuint) + out * 1.4);
	svg.style.opacity = (1 - out).toFixed(3);
	svg.style.filter = out > 0.01 ? `blur(${(out * 10).toFixed(2)}px)` : "none";
	// Symbol centre (51, 50) in viewBox units (origin 11, 10).
	svg.style.transform = `translate(${(L.x - 40 * scale).toFixed(2)}px, ${(L.y - 40 * scale).toFixed(2)}px) scale(${scale.toFixed(4)})`;
	clip.setAttribute("width", (80 * prog(t, H0.in, 0.2, E.outQuint)).toFixed(3));
	keys.forEach((key, i) => {
		const k = prog(t, H0.in + 0.08 + i * 0.04, 0.2, E.outBack);
		key.style.transform = `scale(${k.toFixed(4)})`;
		key.style.opacity = clamp(k * 3).toFixed(3);
	});
}

/** End card: symbol, then the full lockup, tagline and support line, one violet cue, cut. */
function drawEnd(t) {
	const D = T.END;
	const { svg, d, keys, word, dClip, wordClip } = lockup;
	const active = t >= D.symbolIn - 0.05;
	svg.style.visibility = active ? "visible" : "hidden";
	$("tagline").style.visibility = active ? "visible" : "hidden";
	$("support").style.visibility = active ? "visible" : "hidden";
	if (!active) {
		return;
	}
	const L = LAYOUT.end;
	const toLockup = prog(t, D.lockup, 0.55, E.inOutQuint);
	const lockupScale = L.lockupWidth / 363.77;
	const scale = lerp(L.symbolScale, lockupScale, toLockup) * (0.96 + 0.04 * prog(t, D.symbolIn, 0.6, E.outQuint));
	// Before: the symbol's centre (39, 40 from the viewBox origin) at the anchor. After: the lockup's centre (181.9, 40).
	const cx = lerp(39, 181.885, toLockup);
	svg.style.transform = `translate(${(L.x - cx * scale).toFixed(2)}px, ${(L.y - 40 * scale).toFixed(2)}px) scale(${scale.toFixed(4)})`;
	dClip.setAttribute("width", (80 * prog(t, D.symbolIn, 0.3, E.outQuint)).toFixed(3));
	d.style.opacity = prog(t, D.symbolIn, 0.12).toFixed(3);
	keys.forEach((key, i) => {
		const k = prog(t, D.keysIn[i], 0.22, E.outBack);
		key.style.transform = `scale(${k.toFixed(4)})`;
		key.style.opacity = clamp(k * 3).toFixed(3);
		// The closing cue: the four keys light up once, in order, like presses.
		const cue = Math.sin(clamp((t - D.cue - i * 0.07) / 0.32) * Math.PI);
		key.style.fill = cue > 0.001 ? mix("#7c5cff", "#c9bcff", cue * 0.85) : "";
	});
	const glow = Math.sin(clamp((t - D.cue) / 0.6) * Math.PI) * 0.6;
	svg.style.filter = glow > 0.01 ? `drop-shadow(0 0 ${(6 * glow).toFixed(2)}px rgba(124, 92, 255, ${(0.5 * glow).toFixed(3)}))` : "none";
	const wk = prog(t, D.lockup + 0.12, 0.55, E.outQuint);
	wordClip.setAttribute("width", (270 * wk).toFixed(3));
	word.setAttribute("transform", `translate(${(112 - 14 * (1 - wk)).toFixed(3)} 70)`);

	const tag = $("tagline");
	const tk = prog(t, D.tagline, 0.5, E.outQuint);
	tag.style.opacity = tk.toFixed(3);
	tag.style.transform = `translateY(${((1 - tk) * 18).toFixed(2)}px)`;
	const sup = $("support");
	const sk = prog(t, D.support, 0.5, E.outQuint);
	sup.style.opacity = (sk * 0.9).toFixed(3);
	sup.style.transform = `translateY(${((1 - sk) * 12).toFixed(2)}px)`;
}

function drawAtmosphere(t, frameIndex) {
	const scene = Object.entries(T.SCENES).find(([, [a, b]]) => t >= a && t < b)?.[0] ?? "end";
	const [bx, by] = LAYOUT.bg[scene];
	const bg = $("bg").style;
	bg.setProperty("--bg-x", `${bx}%`);
	bg.setProperty("--bg-y", `${by}%`);
	const pool = t >= T.END.fadeOut ? 0.5 * (1 - prog(t, T.END.fadeOut, 0.4)) + 0.35 * prog(t, T.END.symbolIn, 0.8) : 0.9;
	bg.setProperty("--bg-a", pool.toFixed(3));
	// The only colour in the background: a whisper of violet behind the hook, the finale and the end card.
	const glow = inScene(t, "hook") ? 0.05 : inScene(t, "complete") ? 0.035 * prog(t, 18.3, 0.8) : inScene(t, "end") ? 0.05 * prog(t, T.END.symbolIn, 0.8) : 0;
	bg.setProperty("--glow-a", glow.toFixed(3));
	bg.setProperty("--glow-r", MOBILE ? "640px" : "560px");

	$("grain").style.backgroundPosition = `${(frameIndex * 73) % 256}px ${(frameIndex * 151) % 256}px`;
	const black = Math.max(1 - prog(t, 0, 0.3, E.out), t >= T.END.cut ? 1 : 0);
	$("black").style.opacity = black.toFixed(3);
}

let fps = 30;
async function seek(t) {
	const s = deckStateAt(t);
	drawDeck(t, s);
	drawPanel(t);
	if (t >= S.enter - 0.2 && t < S.exit + 0.3) {
		await setupDriver.seek(t);
	}
	drawSetup(t);
	drawHeadlines(t);
	drawSteps(t);
	drawHookMark(t);
	drawEnd(t);
	drawAtmosphere(t, Math.round(t * fps));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------------------------------------------

async function boot() {
	await Promise.all([400, 500, 600, 700, 800].map((w) => document.fonts.load(`${w} 40px Inter`)));
	await document.fonts.ready;
	buildHeadlines();
	buildSteps();
	buildGrain();
	await buildMarks();
	$("tagline").textContent = T.END.tagText;
	$("tagline").style.top = `${LAYOUT.end.taglineY - LAYOUT.end.taglineSize * 0.6}px`;
	$("tagline").style.fontSize = `${LAYOUT.end.taglineSize}px`;
	$("support").textContent = T.END.supportText;
	$("support").style.top = `${LAYOUT.end.supportY - LAYOUT.end.supportSize * 0.6}px`;
	$("support").style.fontSize = `${LAYOUT.end.supportSize}px`;
	await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
	await setupDriver.load();
	await seek(0);
}

const ready = boot();
window.__film = {
	ready,
	format: FORMAT,
	width: W,
	height: H,
	duration: T.DURATION,
	setFps(value) {
		fps = value;
	},
	seek,
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Preview player (not used when rendering)
// ---------------------------------------------------------------------------------------------------------------------------------

function fit() {
	const controls = document.body.classList.contains("rendering") ? 0 : 52;
	const k = Math.min(innerWidth / W, (innerHeight - controls) / H);
	stage.style.transform = `scale(${k})`;
	stage.style.marginRight = `${W * (k - 1)}px`;
	stage.style.marginBottom = `${H * (k - 1) + controls}px`;
}
addEventListener("resize", fit);
fit();

const scrub = $("scrub");
const timeEl = $("time");
const playButton = $("play");
$("format").href = `?format=${MOBILE ? "desktop" : "mobile"}`;
$("format").textContent = MOBILE ? "16:9" : "9:16";
let playing = false;
let playStart = 0;
let playFrom = 0;
let busy = false;
async function show(t) {
	if (busy) {
		return;
	}
	busy = true;
	await seek(t);
	busy = false;
	scrub.value = String(t);
	timeEl.textContent = `${t.toFixed(2)} s`;
}
function loop(now) {
	if (!playing) {
		return;
	}
	const t = playFrom + (now - playStart) / 1000;
	if (t >= T.DURATION) {
		playing = false;
		playButton.textContent = "Play";
		void show(T.DURATION - 0.001);
		return;
	}
	void show(t);
	requestAnimationFrame(loop);
}
playButton.addEventListener("click", async () => {
	await ready;
	playing = !playing;
	playButton.textContent = playing ? "Pause" : "Play";
	if (playing) {
		playFrom = Number(scrub.value) >= T.DURATION - 0.05 ? 0 : Number(scrub.value);
		playStart = performance.now();
		requestAnimationFrame(loop);
	}
});
scrub.addEventListener("input", async () => {
	await ready;
	playing = false;
	playButton.textContent = "Play";
	void show(Number(scrub.value));
});
const startAt = Number(params.get("t"));
if (startAt) {
	void ready.then(() => show(startAt));
}
