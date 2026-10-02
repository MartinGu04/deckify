// Spotify Account Property Inspector.
//
// Talks to the Deckify plugin through Stream Deck's Property Inspector WebSocket. It only ever handles non-sensitive data (Client ID,
// connection status, display name); OAuth tokens never reach this page. It deliberately uses no browser storage.
"use strict";

(() => {
	const STATUS_LABELS = {
		"not-configured": "Not configured",
		disconnected: "Disconnected",
		connecting: "Connecting...",
		connected: "Connected",
		"reauthorization-required": "Reconnect required",
		error: "Error",
	};

	const elements = {
		status: document.getElementById("status"),
		accountRow: document.getElementById("account-row"),
		accountName: document.getElementById("account-name"),
		accountDetail: document.getElementById("account-detail"),
		premiumRow: document.getElementById("premium-row"),
		messageRow: document.getElementById("message-row"),
		message: document.getElementById("message"),
		clientId: document.getElementById("client-id"),
		saveClientId: document.getElementById("save-client-id"),
		clientIdError: document.getElementById("client-id-error"),
		redirectUri: document.getElementById("redirect-uri"),
		connect: document.getElementById("connect"),
		disconnect: document.getElementById("disconnect"),
	};

	let socket;
	let context;
	let actionUUID;
	let clientIdDirty = false;
	let clientIdSavePending = false;

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
		socket = new WebSocket(`ws://127.0.0.1:${port}`);
		socket.addEventListener("open", () => {
			socket.send(JSON.stringify({ event: registerEvent, uuid }));
			sendToPlugin({ type: "deckify:spotify:hello" });
		});
		socket.addEventListener("message", (message) => {
			const data = JSON.parse(message.data);
			if (data.event === "sendToPropertyInspector" && data.payload && data.payload.type === "deckify:spotify:state") {
				render(data.payload.state, data.payload.clientIdError);
			}
		});
	};

	/**
	 * Sends a message to the plugin.
	 * @param {object} payload Message.
	 */
	function sendToPlugin(payload) {
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ event: "sendToPlugin", action: actionUUID, context, payload }));
		}
	}

	/**
	 * Renders the state received from the plugin.
	 * @param {object} state Public Spotify account state.
	 * @param {string | null} clientIdError Validation error for the Client ID field.
	 */
	function render(state, clientIdError) {
		elements.status.textContent = STATUS_LABELS[state.status] || state.status;
		elements.status.dataset.status = state.status;

		const connected = state.status === "connected";
		elements.accountRow.hidden = !connected || !state.displayName;
		elements.accountName.textContent = state.displayName || "";
		const details = [];
		if (state.product) {
			details.push(`Spotify ${state.product}`);
		}
		if (state.authorizedAt) {
			details.push(`authorized ${new Date(state.authorizedAt).toLocaleDateString()}`);
		}
		elements.accountDetail.textContent = details.join(" · ");
		elements.premiumRow.hidden = !(connected && state.product && state.product !== "premium");

		elements.messageRow.hidden = !state.message;
		elements.message.textContent = state.message || "";
		elements.message.classList.toggle("error", state.status === "error");

		// Keep what the user is typing; only adopt the stored Client ID when the field is untouched or a save succeeded.
		if (clientIdSavePending) {
			clientIdSavePending = false;
			if (!clientIdError) {
				clientIdDirty = false;
			}
		}
		if (!clientIdDirty) {
			elements.clientId.value = state.clientId;
		}
		elements.clientIdError.hidden = !clientIdError;
		elements.clientIdError.textContent = clientIdError || "";
		elements.redirectUri.textContent = state.redirectUri;

		const reauthorize = state.status === "reauthorization-required";
		elements.connect.hidden = !(state.status === "disconnected" || state.status === "error" || reauthorize);
		elements.connect.textContent = reauthorize ? "Reconnect Spotify" : "Connect Spotify";
		elements.disconnect.hidden = !(connected || state.status === "connecting" || state.status === "error" || reauthorize);
		elements.connect.disabled = false;
		elements.disconnect.disabled = false;
	}

	elements.clientId.addEventListener("input", () => {
		clientIdDirty = true;
	});
	elements.clientId.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			elements.saveClientId.click();
		}
	});
	elements.saveClientId.addEventListener("click", () => {
		clientIdSavePending = true;
		sendToPlugin({ type: "deckify:spotify:save-client-id", clientId: elements.clientId.value });
	});
	elements.connect.addEventListener("click", () => {
		elements.connect.disabled = true;
		sendToPlugin({ type: "deckify:spotify:connect" });
	});
	elements.disconnect.addEventListener("click", () => {
		elements.disconnect.disabled = true;
		sendToPlugin({ type: "deckify:spotify:disconnect" });
	});
})();
