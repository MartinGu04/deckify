// Deckify Setup App: the guided Spotify setup, in the default browser.
//
// Served by the Deckify plugin from 127.0.0.1 while setup is open. The page is untrusted presentation: it opens with a one-time launch code
// in the URL fragment (never sent to a server), exchanges it once for a session token that lives only in this page's memory, and sends that
// token in a header with every request. It only ever receives non-sensitive state (Client ID, connection status, display name, plan and a
// structured issue code) and can only ask for the plugin's fixed account operations, or for one of Deckify's fixed experiences by ID; OAuth
// tokens never reach it, and it never names a profile, a file or a Stream Deck device (the plugin maps the ID to its bundled profile and
// uses the Stream Deck that opened setup). The plugin is authoritative for the account state and decides every issue code; onboarding.js
// turns those into screens and guidance, and experiences.js describes the layouts. This page never opens links itself and uses no browser
// storage or cookies: the setup step, tour page and chosen experience are forgotten when it closes.
"use strict";

(() => {
	const model = globalThis.DeckifyOnboarding;
	const catalog = globalThis.DeckifyExperiences;

	/** How long "Copied" stays on a copy button. */
	const COPY_FEEDBACK_MS = 2000;

	/** A request button stays disabled at most this long if the plugin sends no new state (normally the next state re-enables it). */
	const BUSY_TIMEOUT_MS = 5000;

	/** How long "Client ID saved." stays on the Connect step. */
	const SAVED_NOTICE_MS = 4000;

	/** After this many failed state requests in a row, Deckify Setup is treated as closed. */
	const MAX_POLL_FAILURES = 3;

	/** Header carrying the session token. */
	const SESSION_HEADER = "X-Deckify-Setup-Session";

	/** Default labels for the buttons the guidance can offer. */
	const ACTION_LABELS = {
		connect: "Connect Spotify",
		"retry-connect": "Retry Connect",
		disconnect: "Disconnect",
		"open-dashboard": "Open Spotify Dashboard",
		"edit-client-id": "Edit Client ID",
		"copy-redirect-uri": "Copy Redirect URI",
	};

	/** Requests that change the Spotify session or the Stream Deck; disabled after a press so they cannot be sent twice. */
	const SESSION_ACTIONS = ["connect", "retry-connect", "cancel-connect", "disconnect", "finish", "experience-use"];

	/** What to say when Stream Deck could not be asked to switch to an experience. */
	const EXPERIENCE_ISSUES = {
		"device-unavailable": {
			tone: "warning",
			title: "Deckify can't reach your Stream Deck",
			body: "Make sure your Stream Deck is plugged in and the Stream Deck app is running, then try again.",
			actions: [],
		},
		failed: {
			tone: "error",
			title: "Stream Deck didn't accept the request",
			body: "Try again. If it keeps happening, restart the Stream Deck app and check the Deckify log.",
			actions: [],
		},
	};

	const $ = (id) => document.getElementById(id);
	const el = {
		status: $("status"),
		statusText: $("status-text"),
		announcer: $("announcer"),
		views: Array.from(document.querySelectorAll("[data-view]")),
		stepperItems: Array.from(document.querySelectorAll("#stepper li")),
		stepCounter: $("step-counter"),
		setupTitle: $("setup-title"),
		steps: Array.from(document.querySelectorAll(".step")),
		stepBack: document.querySelector('[data-action="step-back"]'),
		stepNext: $("step-next"),
		clientId: $("client-id"),
		clientIdFeedback: $("client-id-feedback"),
		clientIdIssue: $("client-id-issue"),
		clientIdChangeNote: $("client-id-change-note"),
		connectReady: $("connect-ready"),
		connectDone: $("connect-done"),
		connectIssue: $("connect-issue"),
		slowHelp: $("slow-help"),
		connectedTitle: $("connected-title"),
		successText: $("success-text"),
		accountName: $("account-name"),
		accountPremium: $("account-premium"),
		premiumNote: $("premium-note"),
		connectedIssue: $("connected-issue"),
		tourStart: $("tour-start"),
		successBadge: $("success-badge"),
		accountDone: $("account-done"),
		clientIdSaved: $("client-id-saved"),
		tourActions: $("tour-actions"),
		tourDots: Array.from(document.querySelectorAll("#tour-dots li")),
		savedClientId: $("saved-client-id"),
		tourCounter: $("tour-counter"),
		tourIcon: $("tour-icon"),
		tourTitle: $("tour-title"),
		tourBody: $("tour-body"),
		tourPrev: $("tour-prev"),
		tourNext: $("tour-next"),
		tourDone: $("tour-done"),
		reconnectTitle: $("reconnect-title"),
		reconnectBody: $("reconnect-body"),
		reconnectIssue: $("reconnect-issue"),
		reconnectButton: $("reconnect-button"),
		reconnectWhy: $("reconnect-why"),
		experienceStart: $("experience-start"),
		experienceList: $("experience-list"),
		experienceUnsupported: $("experience-unsupported"),
		experienceIssue: $("experience-issue"),
		experienceChoose: $("experience-choose"),
		experienceUse: $("experience-use"),
		experienceNote: $("experience-note"),
		experienceFinishName: $("experience-finish-name"),
		readyExperience: $("ready-experience"),
		readyExperienceName: $("ready-experience-name"),
		readyExperienceBadge: $("ready-experience-badge"),
		readyChosen: $("ready-chosen"),
		readyManual: $("ready-manual"),
		readyChange: $("ready-change"),
	};

	/** Session token for this page; kept in memory only. */
	let sessionToken;
	/** Version of the latest state applied, so an older answer never replaces a newer one. */
	let version = -1;
	/** Set when the session is gone (link used, expired, or Deckify closed setup) or the user finished. */
	let ended = null;

	/** Latest public account state from the plugin; `undefined` until it arrives. */
	let state;
	/** Latest Client ID problem from the plugin: `{ message, issue }`, or `null`. */
	let clientIdProblem = null;
	/** Navigation state (setup step, tour page); never persisted. */
	let ui = model.initialUi();
	/** Identifies the screen on display, to move focus only when it changes. */
	let screenKey = "";

	let clientIdDirty = false;
	/** The (trimmed) Client ID last sent for saving, until the plugin confirms or rejects it. */
	let pendingClientId;
	let clientIdHint = "";
	let savedNotice = false;
	let savedTimer;

	let busy = false;
	let busyTimer;
	let slow = false;
	let slowTimer;

	/** Whether the Stream Deck that opened setup can use Deckify's experiences, as the plugin reported it. */
	let experienceSupport = "supported";
	/** The experience selected on the chooser (not yet requested). */
	let selectedExperience = catalog.DEFAULT_EXPERIENCE;
	/** Why the last experience request did not reach Stream Deck: a key of EXPERIENCE_ISSUES, or `null`. */
	let experienceProblem = null;
	/** The chooser cards, by experience ID; built once. */
	const experienceCards = new Map();

	/**
	 * Starts the session: takes the launch code out of the URL, exchanges it, then follows the account state.
	 */
	async function start() {
		const launchCode = new URLSearchParams(window.location.hash.slice(1)).get("launch");
		// The launch code works once; remove it from the address bar and history right away.
		window.history.replaceState(null, "", window.location.pathname);
		if (!launchCode) {
			end("expired");
			return;
		}
		let session;
		try {
			session = await request("POST", "/api/session", { launchCode }, false);
		} catch {
			session = undefined;
		}
		if (!session || typeof session.sessionToken !== "string") {
			end("expired");
			return;
		}
		sessionToken = session.sessionToken;
		ui = model.initialUi(session.entry);
		experienceSupport = typeof session.experiences === "string" ? session.experiences : "device-unavailable";
		void follow();
	}

	/**
	 * Follows the account state: each request waits on the server until the state changes.
	 */
	async function follow() {
		let failures = 0;
		while (!ended) {
			try {
				const payload = await request("GET", `/api/state?after=${version}`);
				failures = 0;
				if (payload) {
					receive(payload);
				}
			} catch (err) {
				if (err && err.sessionEnded) {
					end("expired");
					return;
				}
				failures++;
				if (failures >= MAX_POLL_FAILURES) {
					end("expired");
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 1000 * failures));
			}
		}
	}

	/**
	 * Sends a request to the local Deckify Setup server.
	 * @param {"GET" | "POST"} method Method.
	 * @param {string} path Same-origin path.
	 * @param {object} [body] JSON body.
	 * @param {boolean} [authenticated] Whether to send the session token.
	 * @returns {Promise<object | undefined>} The JSON answer.
	 */
	async function request(method, path, body, authenticated = true) {
		const headers = {};
		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
		}
		if (authenticated) {
			headers[SESSION_HEADER] = sessionToken;
		}
		const response = await fetch(path, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			cache: "no-store",
			credentials: "omit",
			redirect: "error",
			referrerPolicy: "no-referrer",
		});
		if (response.status === 403) {
			const error = new Error("Deckify Setup session ended.");
			error.sessionEnded = true;
			throw error;
		}
		if (!response.ok) {
			throw new Error(`Deckify Setup request failed (${response.status}).`);
		}
		return response.json();
	}

	/**
	 * Sends an account command to the plugin and applies the answer.
	 * @param {object} command Command (`type` plus, for the Client ID, `clientId`).
	 */
	async function sendCommand(command) {
		try {
			const payload = await request("POST", "/api/command", command);
			if (payload && payload.state) {
				receive(payload);
			}
		} catch (err) {
			if (err && err.sessionEnded) {
				end("expired");
			} else {
				setBusy(false);
				render();
			}
		}
	}

	/**
	 * Asks the plugin to switch the Stream Deck that opened setup to an experience. Sends only the experience ID.
	 * @param {string} id Experience ID.
	 */
	async function chooseExperience(id) {
		let answer;
		try {
			answer = await request("POST", "/api/command", { type: "choose-experience", experience: id });
		} catch (err) {
			if (err && err.sessionEnded) {
				end("expired");
				return;
			}
			answer = undefined;
		}
		const outcome = answer && answer.experience && answer.experience.id === id ? answer.experience.outcome : "failed";
		experienceProblem = null;
		switch (outcome) {
			case "requested":
				ui = { ...ui, route: "experience-finish", experience: id };
				break;
			case "unsupported-device":
				experienceSupport = "unsupported-device";
				break;
			case "busy":
				// Another request is still on its way to Stream Deck; its answer decides.
				break;
			case "device-unavailable":
				experienceProblem = "device-unavailable";
				break;
			default:
				experienceProblem = "failed";
		}
		setBusy(false);
		if (answer && answer.state) {
			receive(answer);
		}
		render();
	}

	/**
	 * Stops following the account state and shows why.
	 * @param {"expired" | "finished"} reason Why setup ended.
	 */
	function end(reason) {
		ended = reason;
		sessionToken = undefined;
		setBusy(false);
		render();
	}

	/**
	 * Applies a state message from the plugin.
	 * @param {{state: object, clientIdError: string | null, clientIdIssue: string | null}} payload Message.
	 */
	function receive(payload) {
		if (ended || typeof payload.version !== "number" || payload.version < version) {
			return;
		}
		version = payload.version;
		const next = payload.state;
		ui = model.onStateChange(ui, state, next);

		if (pendingClientId !== undefined) {
			if (payload.clientIdError) {
				pendingClientId = undefined;
			} else if (next.clientId === pendingClientId) {
				pendingClientId = undefined;
				clientIdDirty = false;
				// Saved: confirm briefly and move on to connecting.
				if ((ui.route === "setup" || ui.route === "account") && model.chooseView(state, ui).step === 3 && next.clientId) {
					ui.route = "setup";
					ui.step = 4;
					showSavedNotice();
				}
			}
		}
		clientIdProblem = payload.clientIdError ? { message: payload.clientIdError, issue: payload.clientIdIssue || "unknown" } : null;

		setBusy(false);
		state = next;
		render();
	}

	/**
	 * Renders the current screen.
	 * @param {HTMLElement} [focusTarget] Element to focus instead of the new screen's heading.
	 */
	function render(focusTarget) {
		const screen = ended ? { view: ended } : model.chooseView(state, ui);
		for (const view of el.views) {
			view.hidden = view.dataset.view !== screen.view;
		}
		renderStatus();
		el.clientIdSaved.hidden = !savedNotice;

		switch (screen.view) {
			case "setup":
				renderSetup(screen.step);
				break;
			case "waiting":
				renderWaiting();
				break;
			case "connected":
				renderConnected(screen.variant === "success");
				break;
			case "tour":
				renderTour();
				break;
			case "reconnect":
				renderReconnect(screen.variant);
				break;
			case "experiences":
				renderExperiences();
				break;
			case "experience-finish":
				renderExperienceFinish();
				break;
			case "ready":
				renderReady();
				break;
		}
		for (const input of document.querySelectorAll("[data-redirect-uri]")) {
			input.value = state ? state.redirectUri : "";
		}
		for (const button of document.querySelectorAll("button[data-action]")) {
			if (SESSION_ACTIONS.includes(button.dataset.action)) {
				button.disabled = busy;
			}
		}
		updateSlowTimer(screen.view === "waiting");

		const key = [screen.view, screen.step, screen.variant, screen.view === "tour" ? ui.tourPage : ""].join(":");
		const previousKey = screenKey;
		screenKey = key;
		if (focusTarget) {
			focusTarget.focus();
		} else if (key !== previousKey && previousKey !== "" && !previousKey.startsWith("loading")) {
			// Keyboard and screen reader users land on the new screen's heading instead of a button that just disappeared.
			const heading = document.querySelector(`[data-view="${screen.view}"] h2`);
			if (heading) {
				heading.focus();
			}
		}
	}

	/** Renders the status pill (always as words; the colour only repeats them). */
	function renderStatus() {
		const status = ended ? "closed" : state ? state.status : "loading";
		el.status.dataset.status = status;
		el.statusText.textContent = ended
			? "Closed"
			: !state
			? "Loading…"
			: state.status === "connecting" && state.activity === "restoring"
				? "Checking…"
				: model.STATUS_LABELS[state.status] || state.status;
	}

	/**
	 * Renders a setup step.
	 * @param {number} step Step (1-based).
	 */
	function renderSetup(step) {
		for (const item of el.stepperItems) {
			const n = Number(item.dataset.step);
			item.dataset.state = n === step ? "current" : n < step ? "done" : "todo";
			if (n === step) {
				item.setAttribute("aria-current", "step");
			} else {
				item.removeAttribute("aria-current");
			}
		}
		el.stepCounter.textContent = `Step ${step} of ${model.STEPS.length}`;
		el.setupTitle.textContent = model.STEPS[step - 1].title;
		for (const section of el.steps) {
			section.hidden = Number(section.dataset.step) !== step;
		}

		const savedClientId = state.clientId || "";
		// Back from the first step leaves setup, unless setup is the only place to go.
		el.stepBack.hidden = step === 1 && model.chooseView(state, { ...ui, route: "auto" }).view === "setup";
		el.stepNext.hidden = step === model.STEPS.length;
		el.stepNext.disabled = step === 3 && !savedClientId;

		if (step === 3) {
			if (!clientIdDirty) {
				el.clientId.value = savedClientId;
			}
			el.clientIdFeedback.textContent = clientIdHint || (savedClientId && !clientIdDirty && !clientIdProblem ? "✓ Client ID saved." : "");
			renderIssue(el.clientIdIssue, clientIdProblem ? model.guidanceFor(clientIdProblem.issue) : undefined, { omit: ["edit-client-id"] });
			el.clientIdChangeNote.hidden = !(state.status === "connected" || state.status === "reauthorization-required");
		}

		if (step === 4) {
			const connected = state.status === "connected";
			let issue = null;
			if (!savedClientId) {
				issue = "client-id-missing";
			} else if (!connected && state.status !== "connecting") {
				issue = state.issue;
			}
			const guidance = model.guidanceFor(issue);
			const offersConnect = Boolean(guidance && guidance.actions.some((action) => model.parseAction(action).action === "connect"));
			el.connectDone.hidden = !connected;
			el.connectReady.hidden = connected || offersConnect || !savedClientId;
			renderIssue(el.connectIssue, guidance);
		}
	}

	/** Renders the waiting-for-Spotify screen. */
	function renderWaiting() {
		el.slowHelp.hidden = !slow;
	}

	/**
	 * Renders the connected screen.
	 * @param {boolean} success Whether the user has just connected.
	 */
	function renderConnected(success) {
		el.connectedTitle.replaceChildren(document.createTextNode(success ? "You're connected " : "Connected to Spotify"));
		if (success) {
			const party = document.createElement("span");
			party.setAttribute("aria-hidden", "true");
			party.textContent = "🎉";
			el.connectedTitle.append(party);
		}
		el.successBadge.hidden = !success;
		el.successText.hidden = !success;
		// Choosing an experience is always the suggested next step (primary); the tour stays optional (secondary). Reopened later, Done is
		// offered as a low-emphasis text action, so setup can still be left without choosing.
		el.experienceStart.textContent = success ? "Choose my Deckify experience" : "Choose a Deckify experience";
		el.tourStart.textContent = success ? "Show me around first" : "Show me around";
		el.accountDone.hidden = success;

		el.accountName.textContent = state.displayName || "Spotify account";
		const product = state.product;
		el.accountPremium.textContent =
			product === "premium" ? "Yes" : product ? `No (Spotify ${product.charAt(0).toUpperCase()}${product.slice(1)})` : "Not reported by Spotify";
		const notPremium = Boolean(product) && product !== "premium";
		el.premiumNote.hidden = !notPremium;
		el.savedClientId.textContent = state.clientId || "";

		const issue = notPremium && state.issue === "premium-required" ? null : state.issue;
		renderIssue(el.connectedIssue, model.guidanceFor(issue), { omit: ["connect"] });
	}

	/** Renders the current tour page. */
	function renderTour() {
		const pages = model.TOUR;
		const index = Math.min(Math.max(0, ui.tourPage), pages.length - 1);
		const page = pages[index];
		el.tourCounter.textContent = `${index + 1} of ${pages.length}`;
		el.tourIcon.setAttribute("src", page.icon);
		el.tourTitle.textContent = page.title;
		el.tourBody.textContent = page.body;
		el.tourActions.replaceChildren(
			...page.actions.map((name) => {
				const chip = document.createElement("li");
				chip.textContent = name;
				return chip;
			}),
		);
		el.tourDots.forEach((dot, n) => {
			dot.dataset.state = n === index ? "current" : n < index ? "done" : "todo";
		});
		el.tourPrev.disabled = index === 0;
		el.tourNext.hidden = index === pages.length - 1;
		el.tourDone.hidden = index !== pages.length - 1;
	}

	/** Renders the experience chooser. */
	function renderExperiences() {
		buildExperienceCards();
		const unsupported = experienceSupport === "unsupported-device";
		for (const [id, card] of experienceCards) {
			const selected = id === selectedExperience;
			card.setAttribute("aria-checked", String(selected));
			card.dataset.selected = String(selected);
			card.disabled = unsupported;
		}
		el.experienceList.classList.toggle("is-unavailable", unsupported);
		el.experienceUnsupported.hidden = !unsupported;
		el.experienceChoose.hidden = unsupported;
		el.experienceNote.hidden = unsupported;
		renderIssue(el.experienceIssue, unsupported || !experienceProblem ? undefined : EXPERIENCE_ISSUES[experienceProblem]);
	}

	/** Builds the chooser cards from experiences.js (once). Text is set as text; nothing is parsed as HTML. */
	function buildExperienceCards() {
		if (experienceCards.size > 0) {
			return;
		}
		for (const experience of catalog.EXPERIENCES) {
			const card = document.createElement("button");
			card.type = "button";
			card.className = "experience-card";
			card.setAttribute("role", "radio");
			card.dataset.action = "experience-select";
			card.dataset.experience = experience.id;
			card.dataset.recommended = String(experience.recommended);

			const header = document.createElement("span");
			header.className = "experience-header";
			const name = document.createElement("span");
			name.className = "experience-name";
			name.textContent = experience.label;
			header.append(name);
			if (experience.recommended) {
				const badge = document.createElement("span");
				badge.className = "experience-badge";
				badge.textContent = "Recommended";
				header.append(badge);
			}
			const check = document.createElement("span");
			check.className = "experience-check";
			check.setAttribute("aria-hidden", "true");
			header.append(check);

			const description = document.createElement("span");
			description.className = "experience-description";
			description.textContent = experience.description;

			const layout = document.createElement("span");
			layout.className = "sr-only";
			layout.textContent = catalog.describeLayout(experience);

			card.append(header, description, layoutPreview(experience), layout);
			experienceCards.set(experience.id, card);
			el.experienceList.append(card);
		}
	}

	/**
	 * Draws an experience's 5 × 3 key layout with Deckify's own action icons (empty keys stay empty).
	 * @param {object} experience Experience from experiences.js.
	 * @returns {HTMLElement} The preview.
	 */
	function layoutPreview(experience) {
		const deck = document.createElement("span");
		deck.className = "deck-preview";
		deck.setAttribute("aria-hidden", "true");
		experience.layout.forEach((keys, rowIndex) => {
			keys.forEach((key, column) => {
				const tile = document.createElement("span");
				tile.className = key === null ? "deck-key empty" : "deck-key";
				tile.dataset.position = `${column},${rowIndex}`;
				if (key !== null) {
					tile.dataset.key = key;
					const icon = document.createElement("img");
					icon.src = catalog.ACTIONS[key].icon;
					icon.alt = "";
					icon.width = 20;
					icon.height = 20;
					tile.append(icon);
				}
				deck.append(tile);
			});
		});
		return deck;
	}

	/** Renders the "Finish in Stream Deck" screen. */
	function renderExperienceFinish() {
		const experience = catalog.find(ui.experience);
		el.experienceFinishName.textContent = experience ? experience.label : "";
	}

	/** Renders the ready screen, naming the experience chosen in this session, if any. */
	function renderReady() {
		const experience = catalog.find(ui.experience);
		el.readyExperience.hidden = !experience;
		el.readyExperienceName.textContent = experience ? experience.label : "";
		el.readyExperienceBadge.textContent = experience && experience.recommended ? " · Recommended" : "";
		el.readyChosen.hidden = !experience;
		el.readyManual.hidden = Boolean(experience);
		el.readyChange.textContent = experience ? "Choose a different experience" : "Choose a Deckify experience";
		el.readyChange.hidden = experienceSupport === "unsupported-device";
	}

	/**
	 * Selects an experience on the chooser.
	 * @param {string} id Experience ID.
	 * @param {boolean} [focus] Whether to move focus to its card.
	 */
	function selectExperience(id, focus = false) {
		if (!catalog.find(id)) {
			return;
		}
		selectedExperience = id;
		experienceProblem = null;
		render(focus ? experienceCards.get(id) : undefined);
	}

	/**
	 * Renders the compact reconnect screen.
	 * @param {"permissions" | "session"} variant New permissions, or a session that must be signed in again.
	 */
	function renderReconnect(variant) {
		const guidance = model.guidanceFor(variant === "permissions" ? "reauthorization-required" : state.issue);
		el.reconnectTitle.textContent = guidance.title;
		el.reconnectBody.textContent = guidance.body;
		const connect = guidance.actions.map(model.parseAction).find((action) => action.action === "connect");
		el.reconnectButton.textContent = (connect && connect.label) || "Reconnect Spotify";
		el.reconnectWhy.hidden = variant !== "permissions";
		// A failed reconnect (e.g. cancelled in the browser) explains itself here; the screen keeps its own Reconnect button.
		const failure = variant === "permissions" && state.issue !== "reauthorization-required" ? state.issue : null;
		renderIssue(el.reconnectIssue, model.guidanceFor(failure), { omit: ["connect"] });
	}

	/**
	 * Shows guidance for an issue in a container: what happened, what to try next, and buttons for the next steps.
	 * @param {HTMLElement} container Container.
	 * @param {object | undefined} guidance Guidance from onboarding.js; `undefined` hides the container.
	 * @param {{omit?: string[]}} [options] Actions not to offer (because the screen already has them).
	 */
	function renderIssue(container, guidance, options = {}) {
		if (!guidance) {
			container.hidden = true;
			container.replaceChildren();
			delete container.dataset.key;
			return;
		}
		const omit = options.omit || [];
		const actions = guidance.actions.map(model.parseAction).filter((action) => !omit.includes(action.action));
		const details = guidance.details && state.message ? state.message : "";
		const key = JSON.stringify([guidance.title, actions, details]);
		container.hidden = false;
		if (container.dataset.key === key) {
			// Unchanged: keep the elements (and focus, and copy feedback).
			return;
		}
		container.dataset.key = key;
		container.className = `issue tone-${guidance.tone}`;
		container.setAttribute("role", guidance.tone === "error" ? "alert" : "status");

		const title = document.createElement("h3");
		const icon = document.createElement("span");
		icon.className = "issue-icon";
		icon.setAttribute("aria-hidden", "true");
		icon.textContent = guidance.tone === "info" ? "i" : "!";
		title.append(icon, document.createTextNode(guidance.title));
		const body = document.createElement("p");
		body.textContent = guidance.body;
		const children = [title, body];

		if (guidance.tips && guidance.tips.length > 0) {
			const tips = document.createElement("ul");
			for (const text of guidance.tips) {
				const tip = document.createElement("li");
				tip.textContent = text;
				tips.append(tip);
			}
			children.push(tips);
		}
		if (guidance.redirectUri) {
			children.push(copyRow());
		}
		if (details) {
			const detail = document.createElement("p");
			detail.className = "muted";
			detail.textContent = `Details: ${details}`;
			children.push(detail);
		}
		if (actions.length > 0) {
			const row = document.createElement("div");
			row.className = "actions";
			actions.forEach((action, index) => {
				const button = document.createElement("button");
				button.type = "button";
				button.dataset.action = action.action;
				button.textContent = action.label || ACTION_LABELS[action.action] || action.action;
				if (index === 0) {
					button.className = "primary";
				}
				row.append(button);
			});
			children.push(row);
		}
		container.replaceChildren(...children);
	}

	/**
	 * Builds a read-only Redirect URI field with its Copy button.
	 * @returns {HTMLElement} The row.
	 */
	function copyRow() {
		const row = document.createElement("div");
		row.className = "copy-row";
		const input = document.createElement("input");
		input.type = "text";
		input.className = "copy-value";
		input.readOnly = true;
		input.setAttribute("data-redirect-uri", "");
		input.setAttribute("aria-label", "Redirect URI");
		input.value = state ? state.redirectUri : "";
		const button = document.createElement("button");
		button.type = "button";
		button.className = "copy-button";
		button.dataset.action = "copy-redirect-uri";
		button.textContent = ACTION_LABELS["copy-redirect-uri"];
		row.append(input, button);
		return row;
	}

	/**
	 * Shows the troubleshooting help when the browser sign-in takes long; resets when the waiting screen is left.
	 * @param {boolean} waiting Whether the waiting screen is shown.
	 */
	function updateSlowTimer(waiting) {
		if (!waiting) {
			clearTimeout(slowTimer);
			slowTimer = undefined;
			slow = false;
			return;
		}
		if (!slow && slowTimer === undefined) {
			slowTimer = setTimeout(() => {
				slowTimer = undefined;
				slow = true;
				render();
				announce("Taking longer than expected? Troubleshooting tips are shown.");
			}, model.SLOW_CONNECT_MS);
		}
	}

	/**
	 * Disables the session buttons until the plugin answers.
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

	/** Shows "Client ID saved." on the Connect step for a moment. */
	function showSavedNotice() {
		savedNotice = true;
		clearTimeout(savedTimer);
		savedTimer = setTimeout(() => {
			savedNotice = false;
			render();
		}, SAVED_NOTICE_MS);
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
	 * Copies the Redirect URI. Falls back to selecting it when the clipboard is not available to the Property Inspector.
	 * @param {HTMLButtonElement} button The Copy button that was pressed.
	 */
	async function copyRedirectUri(button) {
		if (!state) {
			return;
		}
		const text = state.redirectUri;
		const row = button.closest(".copy-row");
		const field = row ? row.querySelector("[data-redirect-uri]") : null;
		let copied = false;
		try {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
				await navigator.clipboard.writeText(text);
				copied = true;
			}
		} catch {
			copied = false;
		}
		if (!copied && field) {
			field.value = text;
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

	/** Sends the Client ID to the plugin, which validates it (the same validator as ever) and saves it. */
	function saveClientId() {
		const value = el.clientId.value.trim();
		if (!value && !(state && state.clientId)) {
			clientIdHint = "Paste your Client ID first.";
			render(el.clientId);
			return;
		}
		clientIdHint = "";
		pendingClientId = value;
		void sendCommand({ type: "save-client-id", clientId: el.clientId.value });
	}

	/**
	 * Goes to a setup step.
	 * @param {number} step Step (1-based).
	 * @param {HTMLElement} [focusTarget] Element to focus.
	 */
	function goToStep(step, focusTarget) {
		ui = { ...ui, route: "setup", step: model.clampStep(step) };
		render(focusTarget);
	}

	/**
	 * Handles a button press.
	 * @param {string} action The button's `data-action`.
	 * @param {HTMLButtonElement} button The button.
	 */
	function onAction(action, button) {
		const screen = model.chooseView(state, ui);
		switch (action) {
			case "start-setup":
				goToStep(1);
				break;
			case "have-client-id":
				goToStep(3, el.clientId);
				break;
			case "step-next":
				goToStep((screen.step || 1) + 1);
				break;
			case "step-back":
				if ((screen.step || 1) <= 1) {
					ui = { ...ui, route: "auto" };
					render();
				} else {
					goToStep(screen.step - 1);
				}
				break;
			case "exit-setup":
				ui = { ...ui, route: "auto" };
				render();
				break;
			case "edit-client-id":
				goToStep(3, el.clientId);
				break;
			case "save-client-id":
				saveClientId();
				break;
			case "copy-redirect-uri":
				void copyRedirectUri(button);
				break;
			case "open-dashboard":
				// The plugin opens its one fixed dashboard address; this message cannot carry a URL.
				void sendCommand({ type: "open-dashboard" });
				button.disabled = true;
				setTimeout(() => {
					button.disabled = false;
				}, 1500);
				break;
			case "connect":
			case "retry-connect":
			case "cancel-connect":
			case "disconnect":
				if (busy) {
					return;
				}
				if (action === "retry-connect") {
					clearTimeout(slowTimer);
					slowTimer = undefined;
					slow = false;
				}
				setBusy(true);
				render();
				void sendCommand({ type: action });
				break;
			case "finish":
				if (busy) {
					return;
				}
				setBusy(true);
				render();
				void request("POST", "/api/command", { type: "finish" })
					.catch(() => undefined)
					.then(() => end("finished"));
				break;
			case "tour-start":
				ui = { ...ui, route: "tour", tourPage: 0 };
				render();
				break;
			case "tour-prev":
				ui = { ...ui, tourPage: Math.max(0, ui.tourPage - 1) };
				render();
				break;
			case "tour-next":
				ui = { ...ui, tourPage: Math.min(model.TOUR.length - 1, ui.tourPage + 1) };
				render();
				break;
			case "tour-done":
			case "experience-start":
				// The tour ends at the chooser; the ready screen's "Choose a different experience" comes back to it.
				selectedExperience = ui.experience || catalog.DEFAULT_EXPERIENCE;
				experienceProblem = null;
				ui = { ...ui, route: "experiences", celebrate: false, tourPage: 0 };
				render();
				break;
			case "experience-select":
				if (!busy) {
					selectExperience(button.dataset.experience, true);
				}
				break;
			case "experience-use":
				if (busy || experienceSupport === "unsupported-device") {
					return;
				}
				setBusy(true);
				render();
				void chooseExperience(selectedExperience);
				break;
			case "experience-skip":
				ui = { ...ui, route: "ready", celebrate: false, experience: null };
				render();
				break;
			case "experience-done":
				ui = { ...ui, route: "ready", celebrate: false };
				render();
				break;
		}
	}

	document.addEventListener("click", (event) => {
		const button = event.target instanceof Element ? event.target.closest("button[data-action]") : null;
		if (button && !button.disabled) {
			onAction(button.dataset.action, button);
		}
	});
	// The chooser is a radio group: arrow keys move the selection between the cards.
	el.experienceList.addEventListener("keydown", (event) => {
		const steps = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
		if (!(event.key in steps) || busy || experienceSupport === "unsupported-device") {
			return;
		}
		event.preventDefault();
		const ids = catalog.EXPERIENCES.map((experience) => experience.id);
		const index = ids.indexOf(selectedExperience);
		selectExperience(ids[(index + steps[event.key] + ids.length) % ids.length], true);
	});
	el.clientId.addEventListener("input", () => {
		clientIdDirty = true;
		clientIdHint = "";
	});
	el.clientId.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			saveClientId();
		}
	});

	render();
	void start();
})();
