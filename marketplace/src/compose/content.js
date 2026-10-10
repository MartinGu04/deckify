// Copy and media for each Marketplace image. Layout lives in compose.css / compose.js; this file is only words and choices.
//
// Rules for the copy (checked by the QA in compose.js where they can be): English, short, no "Official", no links, no endorsement claim,
// every claim true of Deckify v1.0 (README.md is the reference). Step names are Deckify Setup's own (ui/shared/onboarding.js STEPS).

/** @typedef {{ id: string, file: string, kind: "thumbnail" | "gallery", eyebrow?: string, headline: string, body?: string, points?: string[], steps?: string[], note?: string, copyWidth?: number, media: object }} Slide */

/**
 * The playlist keys as they are right after a press ("Added", "Started"). Their idle titles are two lines ("Add to / Playlist",
 * "Play / Playlist"), and Stream Deck draws a two-line bottom title over the lower part of the playlist icon, so the idle keys show text on
 * artwork. The QA in compose.js rejects any key title that touches its icon.
 */
const PRESSED_PLAYLIST_KEYS = { "add-to-playlist": "add-to-playlist-pressed", "play-playlist": "play-playlist-pressed" };

/** @type {Slide[]} */
export const SLIDES = [
	{
		id: "thumbnail",
		file: "deckify-thumbnail-1920x960.png",
		kind: "thumbnail",
		headline: "Spotify control.\nDone right.",
		note: "For Stream Deck on Windows",
		media: { type: "deck", experience: "deckify", states: PRESSED_PLAYLIST_KEYS },
	},
	{
		id: "overview",
		file: "deckify-gallery-1-overview-1920x960.png",
		kind: "gallery",
		eyebrow: "Deckify for Stream Deck",
		headline: "Your music,\nat your fingertips.",
		body: "Play, skip, see what's playing, set the volume, like songs and start playlists. Every key shows Spotify's live state.",
		note: "Windows · Spotify Premium required",
		media: { type: "deck", experience: "deckify", states: PRESSED_PLAYLIST_KEYS, caption: "The DECKIFY layout on a 15-key Stream Deck" },
	},
	{
		id: "setup",
		file: "deckify-gallery-2-easy-setup-1920x960.png",
		kind: "gallery",
		eyebrow: "Easy setup",
		headline: "Guided setup\nin four steps.",
		steps: ["Open Spotify Dashboard", "Create your Spotify app", "Add your Client ID", "Connect Spotify"],
		note: "No Client Secret. Your session stays encrypted on your PC.",
		copyWidth: 560,
		media: { type: "capture", capture: "setup-connected" },
	},
	{
		id: "experiences",
		file: "deckify-gallery-3-two-experiences-1920x960.png",
		kind: "gallery",
		eyebrow: "Two starter layouts",
		headline: "Pick your\nexperience.",
		points: [
			"**DECKIFY** · Recommended\nEvery Deckify action, with Now Playing in the centre.",
			"**SIMPLE**\nThe essentials in a clean 3 × 3 block.",
		],
		note: "Both are editable Stream Deck profiles.",
		copyWidth: 560,
		media: { type: "capture", capture: "setup-experiences" },
	},
	{
		id: "controls",
		file: "deckify-gallery-4-everyday-controls-1920x960.png",
		kind: "gallery",
		eyebrow: "Everyday controls",
		headline: "Keys that\nkeep up.",
		body: "Each key updates as Spotify does, and confirms what you just did.",
		media: {
			type: "keys",
			rows: [
				["play-pause", "next", "now-playing"],
				["volume-down", "mute", "volume-up"],
				["like-pressed", "add-to-playlist-pressed", "play-playlist-pressed"],
			],
		},
	},
];
