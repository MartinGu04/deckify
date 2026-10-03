// Spotify Account Property Inspector: a compact entry point to Deckify Setup.
//
// Talks to the Deckify plugin through Stream Deck's Property Inspector WebSocket. It only ever handles non-sensitive data (Client ID,
// connection status, display name, plan, Redirect URI and a structured issue code); OAuth tokens never reach this page. The guided setup
// itself lives in Deckify Setup, which the plugin opens in the default browser; this page only asks for it. It never opens links itself and
// deliberately uses no browser storage.
"use strict";

(() => {
	const model = globalThis.DeckifyOnboarding;

	/** How long "Copied" stays on a copy button. */
	const COPY_FEEDBACK_MS = 2000;

	/** A request button stays disabled at most this long if the plugin sends no new state. */
	const BUSY_TIMEOUT_MS = 5000;

	/** Requests that change the Spotify session or open a browser window; disabled after a press so they cannot be sent twice. */
	const GUARDED_ACTIONS = ["connect", "cancel-connect", "disconnect", "open-setup", "open-account-setup", "open-dashboard"];

	const $ = (id) => document.getElementById(id);
	const el = {
		status: $("status"),
		statusText: $("status-text"),
		announcer: $("announcer"),
		views: Array.from(document.querySelectorAll("[data-view]")),
		problem: $("problem"),
		problemTitle: $("problem-title"),
		accountName: $("account-name"),
		accountPremium: $("account-premium"),
		premiumNote: $("premium-note"),
		connectedProblem: $("connected-problem"),
		savedClientId: $("saved-client-id"),
		reconnectTitle: $("reconnect-title"),
		reconnectBody: $("reconnect-body"),
		reconnectProblem: $("reconnect-problem"),
		reconnectButton: $("reconnect-button"),
	};

	let socket;
	let context;
	let actionUUID;

	/** Latest public account state from the plugin; `undefined` until it arrives. */
	let state;
	/** Identifies the screen on display, to move focus only when it changes. */
	let screenKey = "";
	let busy = false;
	let busyTimer;

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
			if (data.event === "sendToPropertyInspector" && data.payload && data.payload.type === "deckify:spotify:state" && data.payload.state) {
				state = data.payload.state;
				setBusy(false);
				render();
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
	 * Chooses the screen for the account state.
	 * @returns {{view: string, variant?: string}} The screen.
	 */
	function chooseView() {
		if (!state) {
			return { view: "loading" };
		}
		switch (state.status) {
			case "connecting":
				return { view: state.activity === "restoring" ? "restoring" : "waiting" };
			case "connected":
				return { view: "connected" };
			case "reauthorization-required":
				return { view: "reconnect", variant: "permissions" };
			default:
				return model.needsSignInAgain(state.issue) ? { view: "reconnect", variant: "session" } : { view: "disconnected" };
		}
	}

	/** Renders the current screen. */
	function render() {
		const screen = chooseView();
		for (const view of el.views) {
			view.hidden = view.dataset.view !== screen.view;
		}

		const status = state ? state.status : "loading";
		el.status.dataset.status = status;
		el.statusText.textContent = !state
			? "Loading…"
			: state.status === "connecting" && state.activity === "restoring"
				? "Checking…"
				: state.status === "connected"
					? "Connected"
					: state.status === "connecting" || state.status === "reauthorization-required"
						? model.STATUS_LABELS[state.status]
						: "Not connected";

		if (screen.view === "disconnected") {
			// A problem gets one line here; Deckify Setup has the full guidance.
			const guidance = state.issue && state.issue !== "client-id-missing" ? model.guidanceFor(state.issue) : undefined;
			el.problem.hidden = !guidance;
			el.problemTitle.textContent = guidance ? guidance.title : "";
		}
		if (screen.view === "connected") {
			el.accountName.textContent = state.displayName || "Spotify account";
			const product = state.product;
			el.accountPremium.textContent = product === "premium" ? "Yes" : product ? `No (Spotify ${capitalize(product)})` : "Not reported by Spotify";
			el.premiumNote.hidden = !(product && product !== "premium");
			el.savedClientId.textContent = state.clientId || "";
			const guidance = state.issue && state.issue !== "premium-required" ? model.guidanceFor(state.issue) : undefined;
			el.connectedProblem.hidden = !guidance;
			el.connectedProblem.textContent = guidance ? `${guidance.title}. ${guidance.body}` : "";
		}
		if (screen.view === "reconnect") {
			const guidance = model.guidanceFor(screen.variant === "permissions" ? "reauthorization-required" : state.issue);
			el.reconnectTitle.textContent = guidance.title;
			el.reconnectBody.textContent = guidance.body;
			el.reconnectButton.textContent = screen.variant === "permissions" ? "Reconnect Spotify" : "Sign in again";
			const failure = screen.variant === "permissions" && state.issue && state.issue !== "reauthorization-required" ? model.guidanceFor(state.issue) : undefined;
			el.reconnectProblem.hidden = !failure;
			el.reconnectProblem.textContent = failure ? `${failure.title}. ${failure.body}` : "";
		}

		for (const input of document.querySelectorAll("[data-redirect-uri]")) {
			input.value = state ? state.redirectUri : "";
		}
		for (const button of document.querySelectorAll("button[data-action]")) {
			if (GUARDED_ACTIONS.includes(button.dataset.action)) {
				button.disabled = busy;
			}
		}

		const key = `${screen.view}:${screen.variant || ""}`;
		const previousKey = screenKey;
		screenKey = key;
		if (key !== previousKey && previousKey !== "" && !previousKey.startsWith("loading")) {
			const heading = document.querySelector(`[data-view="${screen.view}"] h2`);
			if (heading) {
				heading.focus();
			}
		}
	}

	/**
	 * Capitalizes a word.
	 * @param {string} word Word.
	 * @returns {string} The word with a capital first letter.
	 */
	function capitalize(word) {
		return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
	}

	/**
	 * Disables the guarded buttons until the plugin answers (or briefly, for requests that change no state).
	 * @param {boolean} value Whether a request is pending.
	 */
	function setBusy(value) {
		busy = value;
		clearTimeout(busyTimer);
		busyTimer = undefined;
		if (value) {
			busyTimer = setTimeout(() => {
				busyTimer = undefined;
				busy = false;
				render();
			}, BUSY_TIMEOUT_MS);
		}
	}

	/**
	 * Reads a message to assistive technology.
	 * @param {string} text Message.
	 */
	function announce(text) {
		el.announcer.textContent = "";
		el.announcer.textContent = text;
	}

	/**
	 * Copies the Redirect URI, or selects it for Ctrl+C when the clipboard is not available to the Property Inspector.
	 * @param {HTMLButtonElement} button The Copy button.
	 */
	async function copyRedirectUri(button) {
		if (!state) {
			return;
		}
		const row = button.closest(".copy-row");
		const field = row ? row.querySelector("[data-redirect-uri]") : null;
		let copied = false;
		try {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
				await navigator.clipboard.writeText(state.redirectUri);
				copied = true;
			}
		} catch {
			copied = false;
		}
		if (!copied && field) {
			field.value = state.redirectUri;
			field.focus();
			field.select();
			try {
				copied = typeof document.execCommand === "function" && document.execCommand("copy") === true;
			} catch {
				copied = false;
			}
		}
		if (button.dataset.label === undefined) {
			button.dataset.label = button.textContent;
		}
		button.textContent = copied ? "Copied" : "Press Ctrl+C";
		button.dataset.feedback = copied ? "copied" : "selected";
		announce(copied ? "Redirect URI copied." : "Redirect URI selected. Press Ctrl+C to copy it.");
		clearTimeout(Number(button.dataset.timer));
		button.dataset.timer = String(
			setTimeout(() => {
				button.textContent = button.dataset.label;
				delete button.dataset.feedback;
			}, COPY_FEEDBACK_MS),
		);
	}

	document.addEventListener("click", (event) => {
		const button = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
		if (!button || button.disabled) {
			return;
		}
		const action = button.dataset.action;
		switch (action) {
			case "copy-redirect-uri":
				void copyRedirectUri(button);
				return;
			case "open-setup":
			case "open-account-setup":
				// The plugin opens Deckify Setup on 127.0.0.1; this message carries no URL.
				sendToPlugin({ type: "deckify:spotify:open-setup", entry: action === "open-account-setup" ? "account" : "start" });
				announce("Opening Deckify Setup in your browser.");
				break;
			case "open-dashboard":
				sendToPlugin({ type: "deckify:spotify:open-dashboard" });
				break;
			case "connect":
			case "cancel-connect":
			case "disconnect":
				sendToPlugin({ type: `deckify:spotify:${action}` });
				break;
			default:
				return;
		}
		setBusy(true);
		render();
	});

	render();
})();
