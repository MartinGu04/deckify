// Playlist picker (Add to Playlist / Play Playlist).
//
// Talks only to the Deckify plugin through Stream Deck's Property Inspector WebSocket. The plugin calls Spotify and sends back sanitized
// playlist data; this page never sees tokens or API URLs, never opens links itself and uses no browser storage. Playlist names are shown
// exactly as Spotify returns them, always through textContent (never as HTML).
"use strict";

(() => {
	const elements = {
		selectedName: document.getElementById("selected-name"),
		selectedDetail: document.getElementById("selected-detail"),
		selectedWarning: document.getElementById("selected-warning"),
		open: document.getElementById("open"),
		search: document.getElementById("search"),
		refresh: document.getElementById("refresh"),
		filterNote: document.getElementById("filter-note"),
		status: document.getElementById("status"),
		list: document.getElementById("list"),
	};

	let socket;
	let context;
	let actionUUID;
	let nextRequest = 0;
	let latestRequest = null;
	let state = null;

	/**
	 * Entry point called by Stream Deck when the Property Inspector loads.
	 * @param {string} port WebSocket port.
	 * @param {string} uuid Property Inspector context.
	 * @param {string} registerEvent Registration event name.
	 * @param {string} _info Application info (JSON).
	 * @param {string} actionInfo Action info (JSON).
	 */
	window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, _info, actionInfo) => {
		context = uuid;
		actionUUID = JSON.parse(actionInfo).action;
		showStatus("Loading playlists...");
		socket = new WebSocket(`ws://127.0.0.1:${port}`);
		socket.addEventListener("open", () => {
			socket.send(JSON.stringify({ event: registerEvent, uuid }));
			request("deckify:playlist:list");
		});
		socket.addEventListener("message", (message) => {
			const data = JSON.parse(message.data);
			if (data.event === "sendToPropertyInspector" && data.payload && data.payload.type === "deckify:playlist:state") {
				receive(data.payload);
			}
		});
	};

	/**
	 * Sends a request to the plugin and remembers it as the latest one.
	 * @param {string} type Request type.
	 * @param {object} [extra] Extra fields (only playlistId / playlistUri for selections).
	 */
	function request(type, extra) {
		nextRequest += 1;
		latestRequest = `pi-${nextRequest}`;
		const payload = Object.assign({ type, requestId: latestRequest }, extra || {});
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ event: "sendToPlugin", action: actionUUID, context, payload }));
		}
	}

	/**
	 * Accepts pushed updates and the answer to the latest request; answers to older requests are ignored.
	 * @param {object} next State from the plugin.
	 */
	function receive(next) {
		if (next.requestId !== null && next.requestId !== latestRequest) {
			return;
		}
		state = next;
		render();
	}

	function showStatus(text, kind) {
		elements.status.hidden = !text;
		elements.status.textContent = text || "";
		elements.status.classList.toggle("error", kind === "error");
		elements.status.classList.toggle("warning", kind === "warning");
	}

	function statusText(current, visibleCount) {
		switch (current.status) {
			case "signed-out":
				return ["Connect Spotify in the Spotify Account key to choose a playlist.", "warning"];
			case "reauthorization-required":
				return ["Reconnect Spotify in the Spotify Account key to use playlists.", "warning"];
			case "limited":
				return [`Spotify is limiting requests. Try again${current.retryAfterSeconds ? ` in ${current.retryAfterSeconds} s` : " later"}.`, "warning"];
			case "loading":
				return current.playlists.length === 0 ? ["Loading playlists...", ""] : ["", ""];
			case "error":
				return [current.message || "Spotify is not available right now. Try Refresh.", "error"];
			default:
				break;
		}
		if (current.message) {
			return [current.message, "error"];
		}
		if (current.status === "ready" && current.playlists.length === 0) {
			return current.mode === "add"
				? ["No playlists you can add to. Create a playlist in Spotify (or join a collaborative one), then Refresh.", ""]
				: ["No playlists found. Create or follow a playlist in Spotify, then Refresh.", ""];
		}
		if (visibleCount === 0 && current.playlists.length > 0) {
			return ["No playlists match your search.", ""];
		}
		return ["", ""];
	}

	/**
	 * Describes a playlist's owner and size, so playlists with the same name stay distinguishable.
	 * @param {object} playlist Playlist.
	 * @param {Set<string>} duplicateNames Names used more than once.
	 * @returns {string} The description.
	 */
	function describe(playlist, duplicateNames) {
		const parts = [];
		if (playlist.mine) {
			parts.push(playlist.public === false ? "Mine · Private" : "Mine");
		} else if (playlist.owner) {
			parts.push(`by ${playlist.owner}`);
		}
		if (playlist.collaborative) {
			parts.push("Collaborative");
		}
		if (typeof playlist.itemCount === "number") {
			parts.push(`${playlist.itemCount} ${playlist.itemCount === 1 ? "item" : "items"}`);
		}
		if (duplicateNames.has(playlist.name)) {
			parts.push(`ID …${playlist.id.slice(-4)}`);
		}
		return parts.join(" · ");
	}

	function render() {
		const current = state;
		if (!current) {
			return;
		}
		elements.filterNote.textContent =
			current.mode === "add" ? "Only playlists you own or collaborate on can be chosen." : "All playlists in your Spotify library.";

		// Selection
		const selected = current.selected;
		elements.selectedName.textContent = selected ? selected.name || "Untitled playlist" : "None selected";
		elements.selectedDetail.textContent = selected && selected.owner ? (selected.owner === "You" ? "Your playlist" : `by ${selected.owner}`) : "";
		const warnings = {
			unavailable: "This playlist is no longer available. Choose another one.",
			"not-writable": "Deckify can no longer add to this playlist. Choose another one.",
		};
		const warning = selected ? warnings[selected.state] : undefined;
		elements.selectedWarning.hidden = !warning;
		elements.selectedWarning.textContent = warning || "";
		elements.open.hidden = !(selected && selected.canOpen);

		// List
		const query = elements.search.value.trim().toLocaleLowerCase();
		const counts = new Map();
		for (const playlist of current.playlists) {
			counts.set(playlist.name, (counts.get(playlist.name) || 0) + 1);
		}
		const duplicateNames = new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
		const visible = current.playlists.filter((playlist) => !query || playlist.name.toLocaleLowerCase().includes(query));

		elements.list.replaceChildren(
			...visible.map((playlist) => {
				const item = document.createElement("li");
				const button = document.createElement("button");
				button.type = "button";
				button.setAttribute("role", "option");
				button.setAttribute("aria-selected", String(Boolean(selected && selected.id === playlist.id)));
				const name = document.createElement("span");
				name.className = "playlist-name";
				name.textContent = playlist.name || "Untitled playlist";
				const meta = document.createElement("span");
				meta.className = "playlist-meta";
				meta.textContent = describe(playlist, duplicateNames);
				button.append(name, meta);
				button.addEventListener("click", () => {
					request("deckify:playlist:select", { playlistId: playlist.id, playlistUri: playlist.uri });
				});
				item.append(button);
				return item;
			}),
		);

		const [text, kind] = statusText(current, visible.length);
		showStatus(text, kind);
		elements.refresh.disabled = current.status === "loading" || current.status === "signed-out" || current.status === "reauthorization-required";
	}

	elements.search.addEventListener("input", render);
	elements.refresh.addEventListener("click", () => {
		elements.refresh.disabled = true;
		request("deckify:playlist:refresh");
	});
	elements.open.addEventListener("click", () => {
		request("deckify:playlist:open");
	});
})();
