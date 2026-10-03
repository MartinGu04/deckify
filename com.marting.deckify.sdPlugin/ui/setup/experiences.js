// Deckify experiences: the three ready-made Stream Deck layouts Deckify Setup offers after Spotify is connected. Pure data only; nothing here
// touches a page, the plugin, the network or browser storage.
//
// These are editable starting layouts for the same plugin and the same actions, bundled as Stream Deck profiles (manifest "Profiles").
// Each layout is the exact 5 × 3 key grid of its bundled profile, row by row ("column,row" in Stream Deck terms), with `null` for an empty
// key. The Setup App draws its previews from this data, and `npm run profiles:check` / the tests compare every bundled profile against it,
// so a preview can't drift from the profile it describes. The page only ever sends an experience `id` to the plugin.
"use strict";

(() => {
	/** Deckify actions used in the layouts: their names in the Stream Deck actions list, permanent UUIDs and preview icons. */
	const ACTIONS = Object.freeze({
		account: Object.freeze({ name: "Spotify Account", uuid: "com.marting.deckify.spotify.account", icon: "/setup/icons/account.svg" }),
		previous: Object.freeze({ name: "Previous Track", uuid: "com.marting.deckify.spotify.previous", icon: "/setup/icons/previous.svg" }),
		"play-pause": Object.freeze({ name: "Play / Pause", uuid: "com.marting.deckify.spotify.play-pause", icon: "/setup/icons/play-pause.svg" }),
		next: Object.freeze({ name: "Next Track", uuid: "com.marting.deckify.spotify.next", icon: "/setup/icons/next.svg" }),
		"now-playing": Object.freeze({ name: "Now Playing", uuid: "com.marting.deckify.spotify.now-playing", icon: "/setup/icons/now-playing.svg" }),
		"volume-down": Object.freeze({ name: "Volume Down", uuid: "com.marting.deckify.spotify.volume-down", icon: "/setup/icons/volume-down.svg" }),
		mute: Object.freeze({ name: "Mute / Unmute", uuid: "com.marting.deckify.spotify.mute", icon: "/setup/icons/mute.svg" }),
		"volume-up": Object.freeze({ name: "Volume Up", uuid: "com.marting.deckify.spotify.volume-up", icon: "/setup/icons/volume-up.svg" }),
		like: Object.freeze({ name: "Like / Unlike", uuid: "com.marting.deckify.spotify.like", icon: "/setup/icons/like.svg" }),
		"add-to-playlist": Object.freeze({ name: "Add to Playlist", uuid: "com.marting.deckify.spotify.add-to-playlist", icon: "/setup/icons/add-to-playlist.svg" }),
		"play-playlist": Object.freeze({ name: "Play Playlist", uuid: "com.marting.deckify.spotify.play-playlist", icon: "/setup/icons/play-playlist.svg" }),
	});

	/** Keys of the standard Stream Deck / Stream Deck MK.2. */
	const COLUMNS = 5;
	const ROWS = 3;

	const row = (...keys) => Object.freeze(keys);

	/** The experiences, in the order the chooser shows them. */
	const EXPERIENCES = Object.freeze([
		Object.freeze({
			id: "simple",
			label: "SIMPLE",
			description: "The essentials. Clean and focused.",
			recommended: false,
			// A centred 3 × 3 block: playback on top, volume below, Now Playing in the middle between Like and the account key.
			layout: Object.freeze([
				row(null, "previous", "play-pause", "next", null),
				row(null, "like", "now-playing", "account", null),
				row(null, "volume-down", "mute", "volume-up", null),
			]),
		}),
		Object.freeze({
			id: "deckify",
			label: "DECKIFY",
			description: "The complete Deckify experience.",
			recommended: true,
			// Now Playing anchors the centre. Playback across the top, volume across the bottom; the middle row is the song and your library:
			// Like and Add to Playlist act on the song Now Playing shows, flanked by the account key and Play Playlist.
			layout: Object.freeze([
				row(null, "previous", "play-pause", "next", null),
				row("account", "like", "now-playing", "add-to-playlist", "play-playlist"),
				row(null, "volume-down", "mute", "volume-up", null),
			]),
		}),
		Object.freeze({
			id: "power",
			label: "POWER",
			description: "Everything within reach.",
			recommended: false,
			// One dense page: the SIMPLE controls on the left, and a bank of playlist keys on the right (four Play Playlist and two Add to
			// Playlist keys, each one set to its own playlist).
			layout: Object.freeze([
				row("previous", "play-pause", "next", "play-playlist", "play-playlist"),
				row("like", "now-playing", "account", "play-playlist", "play-playlist"),
				row("volume-down", "mute", "volume-up", "add-to-playlist", "add-to-playlist"),
			]),
		}),
	]);

	/** The experience the chooser selects first. */
	const DEFAULT_EXPERIENCE = "deckify";

	/**
	 * Finds an experience.
	 * @param {string | null | undefined} id Experience ID.
	 * @returns {object | undefined} The experience; otherwise `undefined`.
	 */
	function find(id) {
		return EXPERIENCES.find((experience) => experience.id === id);
	}

	/**
	 * Describes a layout row by row, for screen readers.
	 * @param {object} experience Experience.
	 * @returns {string} The description.
	 */
	function describeLayout(experience) {
		const names = ["Top row", "Middle row", "Bottom row"];
		return experience.layout
			.map((keys, index) => {
				const used = keys.filter((key) => key !== null).map((key) => ACTIONS[key].name);
				return `${names[index]}: ${used.length > 0 ? used.join(", ") : "empty"}.`;
			})
			.join(" ");
	}

	globalThis.DeckifyExperiences = Object.freeze({ ACTIONS, COLUMNS, ROWS, EXPERIENCES, DEFAULT_EXPERIENCE, find, describeLayout });
})();
