// Local paging for the playlist picker: the plugin sends the whole (already filtered) playlist list once, and the picker shows it at most
// PAGE_SIZE rows at a time. Searching filters that list in the page; nothing here talks to the plugin or to Spotify.
"use strict";

(() => {
	/** The most playlist rows shown at once. */
	const PAGE_SIZE = 20;

	/**
	 * Filters playlists by name, case-insensitively.
	 * @param {Array<{name: string}>} playlists Playlists.
	 * @param {string} query Search text.
	 * @returns {Array<{name: string}>} The matching playlists, in their original order.
	 */
	function filterPlaylists(playlists, query) {
		const needle = String(query || "").trim().toLocaleLowerCase();
		return needle ? playlists.filter((playlist) => String(playlist.name || "").toLocaleLowerCase().includes(needle)) : playlists.slice();
	}

	/**
	 * One page of playlists.
	 * @param {Array<object>} matches Playlists to page through (already filtered).
	 * @param {number} page Requested page (0-based); clamped to the pages that exist.
	 * @returns {{items: Array<object>, page: number, pageCount: number, total: number, first: number, last: number}} The page, with the
	 * 1-based positions of its first and last rows (0 when empty).
	 */
	function pageOf(matches, page) {
		const total = matches.length;
		const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
		const current = Math.min(Math.max(0, Math.trunc(Number(page) || 0)), pageCount - 1);
		const start = current * PAGE_SIZE;
		const items = matches.slice(start, start + PAGE_SIZE);
		return { items, page: current, pageCount, total, first: items.length > 0 ? start + 1 : 0, last: start + items.length };
	}

	/**
	 * The page that contains a playlist.
	 * @param {Array<{id: string}>} matches Playlists to page through.
	 * @param {string | undefined} id Playlist ID.
	 * @returns {number | undefined} The page (0-based), or `undefined` when the playlist is not in the list.
	 */
	function pageContaining(matches, id) {
		const index = id ? matches.findIndex((playlist) => playlist.id === id) : -1;
		return index < 0 ? undefined : Math.floor(index / PAGE_SIZE);
	}

	globalThis.DeckifyPlaylistPaging = Object.freeze({ PAGE_SIZE, filterPlaylists, pageOf, pageContaining });
})();
