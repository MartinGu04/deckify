// Deckify onboarding model, shared by the Deckify Setup App (the guided setup in the browser) and the compact Spotify Account Property
// Inspector: which screen to show for the plugin's public account state, and the guidance for every issue code the plugin reports. Pure
// functions only; nothing here touches a page, the plugin, the network or browser storage.
//
// The plugin is authoritative: it decides the status and the issue code. This file only turns them into words and next steps, and keeps
// the purely visual, per-session navigation state (setup step, tour page, chosen experience) that is forgotten when the page closes.
"use strict";

(() => {
	/** Setup steps, in order. */
	const STEPS = Object.freeze([
		Object.freeze({ id: "dashboard", title: "Open Spotify Dashboard", label: "Dashboard" }),
		Object.freeze({ id: "app", title: "Create your Spotify app", label: "Spotify app" }),
		Object.freeze({ id: "client-id", title: "Add your Client ID", label: "Client ID" }),
		Object.freeze({ id: "connect", title: "Connect Spotify", label: "Connect" }),
	]);

	/** After this long without Spotify's answer, the waiting screen offers troubleshooting (the plugin itself gives up after two minutes). */
	const SLOW_CONNECT_MS = 45 * 1000;

	/** Issues after which the user only needs to sign in again: their Client ID is still saved and set up. */
	const SIGN_IN_AGAIN = Object.freeze(["session-expired", "session-unreadable", "client-id-changed"]);

	const REDIRECT_TIPS = Object.freeze([
		"Your Spotify app's Redirect URIs must contain exactly the address below.",
		"It must use 127.0.0.1, not localhost.",
		"Save the settings in Spotify, then try again.",
	]);

	/**
	 * What to tell the user, and what they can do next, for every issue code the plugin reports. `actions` name the buttons to offer;
	 * `redirectUri` shows the copyable Redirect URI; `details` also shows the plugin's own message (for issues without specific guidance).
	 * Every entry has at least one next step.
	 */
	const ISSUES = Object.freeze({
		"invalid-client-id": {
			tone: "error",
			title: "That Client ID doesn't look valid",
			body: "Open your Spotify app settings, copy the Client ID again and paste it here.",
			actions: ["open-dashboard", "edit-client-id"],
		},
		"client-id-missing": {
			tone: "warning",
			title: "Add your Client ID first",
			body: "Deckify needs the Client ID of your Spotify app before it can connect.",
			actions: ["edit-client-id"],
		},
		"authorization-denied": {
			tone: "info",
			title: "Spotify connection cancelled",
			body: "No changes were made. You can try again when you're ready.",
			actions: ["connect:Try again"],
		},
		"authorization-cancelled": {
			tone: "info",
			title: "Sign-in stopped",
			body: "The Spotify sign-in was stopped before it finished. No changes were made.",
			actions: ["connect:Try again"],
		},
		"authorization-timeout": {
			tone: "warning",
			title: "Deckify didn't hear back from Spotify",
			body: "The sign-in wasn't completed in time, so Deckify stopped waiting. A few things to check:",
			tips: REDIRECT_TIPS,
			redirectUri: true,
			actions: ["connect:Try again", "open-dashboard"],
		},
		"authorization-failed": {
			tone: "warning",
			title: "Spotify sign-in didn't finish",
			body: "Spotify didn't complete the sign-in, so nothing was changed. If Spotify showed an error page, check your app's settings:",
			tips: REDIRECT_TIPS,
			redirectUri: true,
			actions: ["connect:Try again", "open-dashboard"],
		},
		"callback-port-in-use": {
			tone: "error",
			title: "Deckify couldn't listen for Spotify's answer",
			body:
				"Another app is using the local port Deckify receives the sign-in on (the one in the Redirect URI). Close apps that might be " +
				"using it, or restart the Stream Deck app, then try again.",
			actions: ["connect:Try again"],
		},
		"spotify-access-refused": {
			tone: "warning",
			title: "Spotify didn't allow this account to use the app",
			body:
				"If you're signing in with a Spotify account different from the app owner, check the app's Users Management in Spotify's " +
				"Developer Dashboard.",
			tips: Object.freeze([
				"This is a possible fix, not a confirmed cause: Spotify only said access was refused.",
				"Spotify limits Development Mode apps to a few authorized users, and currently requires the app owner to have Spotify Premium.",
			]),
			actions: ["open-dashboard", "connect:Try again"],
		},
		"premium-required": {
			tone: "warning",
			title: "Spotify Premium is required",
			body: "Spotify only allows playback control for Premium accounts, so Deckify's playback keys show Premium on this account.",
			actions: ["connect:Try again"],
		},
		"insufficient-scope": {
			tone: "warning",
			title: "Spotify didn't grant every permission",
			body: "Deckify needs all the permissions it asks for. Connect again and approve the whole request.",
			actions: ["connect:Connect again"],
		},
		"reauthorization-required": {
			tone: "info",
			title: "Deckify needs updated Spotify permissions",
			body: "Deckify added features that need additional Spotify permissions.",
			actions: ["connect:Reconnect Spotify"],
		},
		"session-expired": {
			tone: "info",
			title: "Sign in to Spotify again",
			body: "Your Spotify session expired or was revoked. Your Client ID is still saved.",
			actions: ["connect:Sign in again"],
		},
		"session-unreadable": {
			tone: "info",
			title: "Sign in to Spotify again",
			body: "Deckify couldn't read its saved Spotify session, so it removed it. Your Client ID is still saved.",
			actions: ["connect:Sign in again"],
		},
		"client-id-changed": {
			tone: "info",
			title: "Sign in to Spotify again",
			body: "Your Client ID changed, so the previous Spotify session no longer applies.",
			actions: ["connect:Sign in again"],
		},
		"session-not-saved": {
			tone: "warning",
			title: "Connected, but not saved",
			body:
				"Deckify couldn't save the session securely, so you'll need to connect again after Stream Deck restarts. If it keeps " +
				"happening, check the Deckify log.",
			actions: [],
		},
		"session-not-deleted": {
			tone: "warning",
			title: "Couldn't remove the saved session",
			body: "Deckify signed out, but couldn't delete its saved Spotify session file. Try Disconnect again, and check the Deckify log.",
			actions: ["disconnect:Disconnect again"],
		},
		network: {
			tone: "warning",
			title: "Couldn't reach Spotify",
			body: "Check your internet connection, then try again.",
			actions: ["connect:Try again"],
		},
		"rate-limited": {
			tone: "warning",
			title: "Spotify asked Deckify to slow down",
			body: "Wait a minute, then try again.",
			actions: ["connect:Try again"],
		},
		"spotify-unavailable": {
			tone: "warning",
			title: "Spotify isn't responding",
			body: "Spotify had a temporary problem. Try again in a little while.",
			actions: ["connect:Try again"],
		},
		unknown: {
			tone: "error",
			title: "Something went wrong",
			body: "Try again. If it keeps happening, restart the Stream Deck app and check the Deckify log.",
			details: true,
			actions: ["connect:Try again"],
		},
	});

	/** The four pages of the "Show me around" tour. Images are Deckify's own action icons, served by the Setup App. */
	const TOUR = Object.freeze([
		Object.freeze({
			id: "now-playing",
			title: "Now Playing",
			body: "See the current track, artist and progress directly on a key. Press it to open the song on Spotify.",
			icon: "/setup/icons/now-playing.svg",
			actions: Object.freeze(["Now Playing"]),
		}),
		Object.freeze({
			id: "like",
			title: "Like",
			body: "Save or remove the current song from your Spotify library.",
			icon: "/setup/icons/like.svg",
			actions: Object.freeze(["Like / Unlike"]),
		}),
		Object.freeze({
			id: "playlists",
			title: "Playlists",
			body: "Add the current song without duplicates, or launch a playlist from a key.",
			icon: "/setup/icons/playlists.svg",
			actions: Object.freeze(["Add to Playlist", "Play Playlist"]),
		}),
		Object.freeze({
			id: "volume",
			title: "Volume",
			body: "Control Spotify's own device volume, not the Windows mixer.",
			icon: "/setup/icons/volume.svg",
			actions: Object.freeze(["Volume Up", "Volume Down", "Mute / Unmute"]),
		}),
	]);

	/** Short status text (always shown as words, never only as a colour). */
	const STATUS_LABELS = Object.freeze({
		"not-configured": "Not set up",
		disconnected: "Not connected",
		connecting: "Connecting…",
		connected: "Connected",
		"reauthorization-required": "Reconnect needed",
		error: "Needs attention",
	});

	/**
	 * Guidance for an issue code.
	 * @param {string | null | undefined} issue Issue code from the plugin.
	 * @returns {object | undefined} The guidance (unknown codes get the generic guidance); otherwise `undefined` when there is no issue.
	 */
	function guidanceFor(issue) {
		if (!issue) {
			return undefined;
		}
		return Object.prototype.hasOwnProperty.call(ISSUES, issue) ? ISSUES[issue] : ISSUES.unknown;
	}

	/**
	 * Whether an issue only needs the user to sign in again (their Client ID is still saved and set up).
	 * @param {string | null | undefined} issue Issue code.
	 * @returns {boolean} `true` for expired, unreadable or Client-ID-changed sessions.
	 */
	function needsSignInAgain(issue) {
		return SIGN_IN_AGAIN.includes(issue);
	}

	/**
	 * Splits an action name such as `"connect:Try again"` into the action and its button label.
	 * @param {string} action Action from {@link ISSUES}.
	 * @returns {{action: string, label: string | undefined}} The parts.
	 */
	function parseAction(action) {
		const index = action.indexOf(":");
		return index < 0 ? { action, label: undefined } : { action: action.slice(0, index), label: action.slice(index + 1) };
	}

	/** Screens that need a connected account; they are left when the connection ends. */
	const CONNECTED_ROUTES = Object.freeze(["tour", "experiences", "experience-finish", "ready"]);

	/**
	 * The navigation state when a page opens.
	 * @param {"start" | "account"} [entry] Where to start: the welcome screen, or straight at the account (Client ID / connection) part.
	 * @returns {{route: string, step: number, tourPage: number, celebrate: boolean, experience: string | null}} Fresh state. `route` is one of
	 * "auto", "account", "setup", "tour", "experiences", "experience-finish" and "ready"; `experience` is the experience the user chose in
	 * this session (shown on the ready screen), if any.
	 */
	function initialUi(entry) {
		return { route: entry === "account" ? "account" : "auto", step: 1, tourPage: 0, celebrate: false, experience: null };
	}

	/**
	 * Updates the navigation state when a new account state arrives from the plugin.
	 * @param {object} ui Navigation state (not modified).
	 * @param {object | undefined} previous Previous account state.
	 * @param {object} next New account state.
	 * @returns {object} The new navigation state.
	 */
	function onStateChange(ui, previous, next) {
		const result = { ...ui };
		const wasAuthorizing = previous !== undefined && previous.status === "connecting" && previous.activity !== "restoring";
		if (next.status === "connected") {
			if (wasAuthorizing) {
				// A sign-in just finished: celebrate once, then let the user decide whether to look around.
				result.route = "auto";
				result.celebrate = true;
			}
		} else {
			result.celebrate = false;
			if (CONNECTED_ROUTES.includes(result.route)) {
				result.route = "auto";
			}
		}
		return result;
	}

	/**
	 * Chooses the screen for an account state.
	 * @param {object | undefined} state Public account state from the plugin; `undefined` until it arrives.
	 * @param {object} ui Navigation state.
	 * @returns {{view: string, step?: number, variant?: string}} The screen.
	 */
	function chooseView(state, ui) {
		if (!state) {
			return { view: "loading" };
		}
		switch (state.status) {
			case "connecting":
				return { view: state.activity === "restoring" ? "restoring" : "waiting" };
			case "not-configured":
				if (ui.route === "account") {
					return { view: "setup", step: 3 };
				}
				return ui.route === "setup" ? { view: "setup", step: clampStep(ui.step) } : { view: "welcome" };
			case "connected":
				if (ui.route === "tour") {
					return { view: "tour" };
				}
				if (ui.route === "experiences") {
					return { view: "experiences" };
				}
				if (ui.route === "experience-finish") {
					return { view: "experience-finish" };
				}
				if (ui.route === "ready") {
					return { view: "ready" };
				}
				if (ui.route === "setup") {
					return { view: "setup", step: clampStep(ui.step) };
				}
				return { view: "connected", variant: ui.celebrate ? "success" : "compact" };
			case "reauthorization-required":
				return ui.route === "setup" ? { view: "setup", step: clampStep(ui.step) } : { view: "reconnect", variant: "permissions" };
			default:
				// Disconnected or error, with a Client ID saved.
				if (ui.route === "setup") {
					return { view: "setup", step: clampStep(ui.step) };
				}
				if (SIGN_IN_AGAIN.includes(state.issue)) {
					return { view: "reconnect", variant: "session" };
				}
				return { view: "setup", step: STEPS.length };
		}
	}

	/**
	 * Keeps a step number in range.
	 * @param {number} step Step (1-based).
	 * @returns {number} A valid step.
	 */
	function clampStep(step) {
		return Math.min(Math.max(1, Math.trunc(Number(step) || 1)), STEPS.length);
	}

	globalThis.DeckifyOnboarding = Object.freeze({
		STEPS,
		SLOW_CONNECT_MS,
		ISSUES,
		TOUR,
		STATUS_LABELS,
		guidanceFor,
		needsSignInAgain,
		parseAction,
		initialUi,
		onStateChange,
		chooseView,
		clampStep,
	});
})();
