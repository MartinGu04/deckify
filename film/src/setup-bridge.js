// Film bridge for the real Deckify Setup page. Loaded before onboarding.js and setup.js (see scripts/serve.mjs), it stands in for the
// plugin's local API and replaces the page's timers with a virtual clock, so the unchanged Deckify Setup code renders the same frame for
// the same film time, every time. Nothing in the page itself is modified: every screen, word and button comes from Deckify's own code.
"use strict";

(() => {
	// ---- Virtual clock: setTimeout & co. run on film time, advanced by the film. ----
	const realSetTimeout = window.setTimeout.bind(window);
	let now = 0;
	let nextId = 1;
	const timers = new Map();
	window.setTimeout = (fn, ms = 0, ...args) => {
		const id = nextId++;
		timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, args });
		return id;
	};
	window.clearTimeout = (id) => {
		timers.delete(Number(id));
	};
	window.setInterval = () => 0;
	window.clearInterval = () => undefined;

	/** Runs every timer due by `ms`, in order. */
	function advanceTo(ms) {
		for (;;) {
			let due;
			for (const [id, timer] of timers) {
				if (timer.at <= ms && (!due || timer.at < due[1].at)) {
					due = [id, timer];
				}
			}
			if (!due) {
				break;
			}
			timers.delete(due[0]);
			now = due[1].at;
			due[1].fn(...due[1].args);
		}
		now = Math.max(now, ms);
	}

	// ---- CSS animations (spinner, the 180 ms "appear") follow the virtual clock too. ----
	const born = new WeakMap();
	function syncAnimations() {
		for (const animation of document.getAnimations()) {
			if (!born.has(animation)) {
				born.set(animation, now);
			}
			animation.pause();
			animation.currentTime = now - born.get(animation);
		}
	}

	// ---- The plugin's local API, answered in the page. ----
	let version = 0;
	let state = {
		status: "not-configured",
		activity: null,
		clientId: null,
		redirectUri: "http://127.0.0.1:43821/callback",
		issue: null,
		message: null,
		displayName: null,
		product: null,
	};
	let waiting = [];

	const payload = () => ({ version, state, clientIdError: null, clientIdIssue: null });
	const json = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));

	function push(change) {
		state = { ...state, ...change };
		version++;
		const resolvers = waiting;
		waiting = [];
		for (const resolve of resolvers) {
			resolve(payload());
		}
	}

	window.fetch = (input, init = {}) => {
		const url = new URL(typeof input === "string" ? input : input.url, location.href);
		if (url.pathname === "/api/session") {
			return json({ sessionToken: "film", entry: "account" });
		}
		if (url.pathname === "/api/state") {
			const after = Number(url.searchParams.get("after"));
			if (version > after) {
				return json(payload());
			}
			return new Promise((resolve) => waiting.push(resolve)).then((body) => json(body).then((r) => r));
		}
		if (url.pathname === "/api/command") {
			const command = JSON.parse(init.body || "{}");
			if (command.type === "save-client-id") {
				push({ status: "disconnected", clientId: String(command.clientId).trim(), issue: null });
			} else if (command.type === "connect" || command.type === "retry-connect") {
				push({ status: "connecting", activity: "authorizing", issue: null });
			}
			return json(payload());
		}
		return Promise.reject(new Error(`Not available in the film: ${url.pathname}`));
	};

	// Copy works without a real clipboard (the page shows its own "Copied" feedback).
	Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true });

	/** Lets the page's pending work settle: promise chains and the real tasks behind them (reading a response body takes one). */
	const settle = () => new Promise((resolve) => realSetTimeout(resolve, 0));

	window.__deckifyFilm = {
		/** Advances the virtual clock to `ms` and settles pending work. */
		async tick(ms) {
			for (let i = 0; i < 3; i++) {
				await settle();
			}
			advanceTo(ms);
			for (let i = 0; i < 3; i++) {
				await settle();
			}
			syncAnimations();
		},
		/** Publishes a new account state, as the plugin would. */
		push,
		get state() {
			return state;
		},
	};
})();
