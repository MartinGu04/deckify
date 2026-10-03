import { readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as packScript from "../scripts/pack.mjs";
import { SETUP_ASSETS } from "../src/setup/setup-server";
import { SPOTIFY_REDIRECT_URI } from "../src/spotify/config";
import { FAKE, findSecrets } from "./helpers";

// Behaviour of the Deckify Setup App (the guided setup in the browser), run in a DOM against a fake local Deckify Setup server. These tests
// check what the user can do and what the page sends, not wording or pixels. The real server is covered in setup-server.test.ts.
const PLUGIN = path.resolve(import.meta.dirname, "..", "com.marting.deckify.sdPlugin");
const pack = packScript as { requiredFiles: () => string[]; verifyPackageEntries: (entries: string[], manifest: Record<string, unknown>, withNative: boolean) => string[] };

type PublicState = {
	status: string;
	clientId: string;
	redirectUri: string;
	displayName: string | null;
	product: string | null;
	authorizedAt: number | null;
	message: string | null;
	issue: string | null;
	activity: string | null;
};

const NOT_CONFIGURED: PublicState = {
	status: "not-configured",
	clientId: "",
	redirectUri: SPOTIFY_REDIRECT_URI,
	displayName: null,
	product: null,
	authorizedAt: null,
	message: null,
	issue: null,
	activity: null,
};
const DISCONNECTED: PublicState = { ...NOT_CONFIGURED, status: "disconnected", clientId: FAKE.clientId };
const AUTHORIZING: PublicState = { ...DISCONNECTED, status: "connecting", activity: "authorizing", message: "Waiting for you to sign in..." };
const CONNECTED: PublicState = { ...DISCONNECTED, status: "connected", displayName: "Test Listener", product: "premium", authorizedAt: 1 };

const LAUNCH_CODE = "L".repeat(43);
const SESSION_TOKEN = "S".repeat(43);

/** Every command the page may send. */
const ALLOWED_COMMANDS = ["save-client-id", "connect", "retry-connect", "cancel-connect", "disconnect", "open-dashboard", "choose-experience", "finish"];

type Options = {
	/** How `navigator.clipboard.writeText` behaves; `"missing"` leaves the Clipboard API out. */
	clipboard?: "ok" | "reject" | "missing";
	/** What `document.execCommand("copy")` returns; `undefined` leaves it out. */
	execCommand?: boolean;
	/** Where the server says setup starts. */
	entry?: "start" | "account";
	/** The URL fragment the browser was opened with. */
	hash?: string;
	/** Whether the server accepts the launch code. */
	sessionOk?: boolean;
	/** What the server says about the Stream Deck that opened setup. */
	experiences?: "supported" | "unsupported-device" | "device-unavailable";
};

type Recorded = { method: string; path: string; headers: Record<string, string>; body: unknown; init: Record<string, unknown> };
type CommandResult = { clientIdError?: string; clientIdIssue?: string };

/**
 * Loads the Setup App into a fresh DOM, talking to a fake Deckify Setup server, with controllable timers.
 * @param options Environment options.
 * @returns Helpers to drive and inspect the page.
 */
async function openSetup(options: Options = {}) {
	const html = await readFile(path.join(PLUGIN, "ui", "setup", "index.html"), "utf8");
	const dom = new JSDOM(html, { runScripts: "outside-only", url: `http://127.0.0.1:50123/setup${options.hash ?? `#launch=${LAUNCH_CODE}`}` });
	const window = dom.window;
	const document = window.document;

	// Timers the test advances by hand.
	let now = 0;
	let nextId = 1;
	const timers = new Map<number, { at: number; fn: () => void }>();
	Object.assign(window, {
		setTimeout: (fn: () => void, ms = 0) => {
			const id = nextId++;
			timers.set(id, { at: now + ms, fn });
			return id;
		},
		clearTimeout: (id: number | undefined) => {
			if (id !== undefined) {
				timers.delete(id);
			}
		},
	});

	// Any use of browser storage or cookies is recorded.
	const storage: string[] = [];
	for (const name of ["localStorage", "sessionStorage", "indexedDB", "caches"]) {
		Object.defineProperty(window, name, {
			configurable: true,
			get: () => {
				storage.push(name);
				return undefined;
			},
		});
	}
	Object.defineProperty(document, "cookie", {
		configurable: true,
		get: () => {
			storage.push("cookie");
			return "";
		},
		set: () => storage.push("cookie"),
	});

	const clipboard = { writeText: vi.fn((_text: string) => (options.clipboard === "reject" ? Promise.reject(new Error("denied")) : Promise.resolve())) };
	if (options.clipboard !== "missing") {
		Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: clipboard });
	}
	const execCommand = vi.fn((_command: string) => options.execCommand === true);
	if (options.execCommand !== undefined) {
		Object.assign(document, { execCommand });
	}

	// The fake Deckify Setup server.
	const server = {
		version: 0,
		state: undefined as PublicState | undefined,
		waiters: [] as (() => void)[],
		requests: [] as Recorded[],
		holdCommands: false,
		sessionAlive: options.sessionOk !== false,
		/** How the plugin answers a chosen experience. */
		experienceOutcome: "requested",
		onCommand: undefined as ((command: Record<string, unknown>) => CommandResult | undefined) | undefined,
	};
	const respond = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
	const payload = (extra: CommandResult = {}) => ({ version: server.version, state: server.state, clientIdError: null, clientIdIssue: null, ...extra });
	const fetch = vi.fn(async (input: string, init: Record<string, unknown> = {}) => {
		const url = new URL(input, window.location.href);
		const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
		const headers = (init.headers ?? {}) as Record<string, string>;
		server.requests.push({ method: String(init.method), path: `${url.pathname}${url.search}`, headers, body, init });
		const authorized = server.sessionAlive && headers["X-Deckify-Setup-Session"] === SESSION_TOKEN;
		switch (url.pathname) {
			case "/api/session":
				return (body as { launchCode?: string }).launchCode === LAUNCH_CODE && server.sessionAlive
					? respond(200, { sessionToken: SESSION_TOKEN, entry: options.entry ?? "start", experiences: options.experiences ?? "supported" })
					: respond(403, { error: "session-expired" });
			case "/api/state": {
				if (!authorized) {
					return respond(403, { error: "session-expired" });
				}
				const after = Number(url.searchParams.get("after"));
				if (server.state === undefined || after >= server.version) {
					await new Promise<void>((resolve) => server.waiters.push(resolve));
				}
				return server.sessionAlive ? respond(200, payload()) : respond(403, { error: "session-expired" });
			}
			case "/api/command": {
				if (!authorized) {
					return respond(403, { error: "session-expired" });
				}
				if (server.holdCommands) {
					return new Promise(() => undefined);
				}
				const result = server.onCommand?.(body as Record<string, unknown>);
				const command = body as { type: string; experience?: string };
				if (command.type === "choose-experience") {
					return respond(200, { ...payload(), experience: { id: command.experience, outcome: server.experienceOutcome } });
				}
				return respond(200, command.type === "finish" ? { finished: true } : payload(result));
			}
			default:
				return respond(404, {});
		}
	});
	Object.assign(window, { fetch });

	const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((match) => match[1] ?? "");
	for (const script of scripts) {
		const asset = SETUP_ASSETS[script];
		if (!asset) {
			throw new Error(`${script} is not a Setup App asset.`);
		}
		window.eval(await readFile(path.join(PLUGIN, asset.file), "utf8"));
	}
	await settle();

	/** Whether an element and all its ancestors are shown. */
	const shown = (element: Element | null): boolean => {
		for (let node = element; node; node = node.parentElement) {
			if (node.hasAttribute("hidden")) {
				return false;
			}
		}
		return element !== null;
	};
	const el = (id: string) => {
		const element = document.getElementById(id);
		if (!element) {
			throw new Error(`No #${id} in index.html.`);
		}
		return element;
	};
	const buttons = (action: string) => [...document.querySelectorAll<HTMLButtonElement>(`button[data-action="${action}"]`)].filter(shown);
	const view = () => {
		const views = [...document.querySelectorAll("[data-view]")].filter(shown);
		expect(views).toHaveLength(1);
		return views[0] as HTMLElement;
	};

	const app = {
		window,
		document,
		server,
		storage,
		clipboard,
		execCommand,
		fetch,
		scripts,
		el,
		shown,
		buttons,
		view,
		/** The name of the screen on display. */
		screen: () => view().dataset.view,
		/** The visible heading of the screen on display. */
		heading: () => view().querySelector("h2")?.textContent.trim(),
		/** Text of the screen on display (hidden parts included only when shown). */
		text: () => visibleText(view(), shown),
		/** Commands the page sent, in order. */
		commands: () => server.requests.filter((request) => request.path === "/api/command").map((request) => request.body as Record<string, unknown>),
		/** The plugin's account state changes; the page's waiting state request answers. */
		async receive(state: Partial<PublicState>) {
			server.state = { ...NOT_CONFIGURED, ...state };
			server.version++;
			for (const wake of server.waiters.splice(0)) {
				wake();
			}
			await settle();
		},
		/** Deckify closes setup (the session ends). */
		async endSession() {
			server.sessionAlive = false;
			for (const wake of server.waiters.splice(0)) {
				wake();
			}
			await settle();
		},
		/** Presses the only visible button for an action. */
		click(action: string, index = 0) {
			const button = buttons(action)[index];
			if (!button) {
				throw new Error(`No visible "${action}" button on the ${String(view().dataset.view)} screen.`);
			}
			button.click();
			return button;
		},
		/** Advances the fake clock, running due timers. */
		advance(ms: number) {
			const until = now + ms;
			for (;;) {
				const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) {
					break;
				}
				timers.delete(due[0]);
				now = due[1].at;
				due[1].fn();
			}
			now = until;
		},
		type(value: string) {
			const input = el("client-id") as HTMLInputElement;
			input.value = value;
			input.dispatchEvent(new window.Event("input"));
		},
	};
	return app;
}

/**
 * Collects the text of the shown parts of an element.
 * @param root Element.
 * @param shown Visibility check.
 * @returns The text, whitespace collapsed.
 */
function visibleText(root: Element, shown: (element: Element) => boolean): string {
	const parts: string[] = [];
	const walk = (node: Node) => {
		if (node.nodeType === 3) {
			parts.push(node.textContent ?? "");
		} else if (node.nodeType === 1 && shown(node as Element)) {
			const element = node as Element;
			if (element.tagName === "INPUT") {
				parts.push(` ${(element as HTMLInputElement).value} `);
			}
			element.childNodes.forEach(walk);
		}
	};
	walk(root);
	return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Lets promise callbacks (fetch answers, the clipboard) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("session", () => {
	it("exchanges the one-time launch code, removes it from the address bar, and then sends only the session token", async () => {
		const app = await openSetup();
		await app.receive(NOT_CONFIGURED);

		expect(app.window.location.href).toBe("http://127.0.0.1:50123/setup");
		const [exchange, ...rest] = app.server.requests;
		expect(exchange).toMatchObject({ method: "POST", path: "/api/session", body: { launchCode: LAUNCH_CODE } });
		expect(exchange?.headers).toEqual({ "Content-Type": "application/json" });
		expect(rest.length).toBeGreaterThan(0);
		for (const request of rest) {
			expect(request.headers["X-Deckify-Setup-Session"]).toBe(SESSION_TOKEN);
			expect(request.path).not.toContain(SESSION_TOKEN);
			expect(request.path).not.toContain(LAUNCH_CODE);
			expect(request.init).toMatchObject({ credentials: "omit", cache: "no-store" });
		}
		// Only same-origin, relative paths.
		expect(app.fetch.mock.calls.map(([url]) => url).filter((url) => !url.startsWith("/api/"))).toEqual([]);
	});

	it("shows that setup has closed when the link was already used or expired", async () => {
		const app = await openSetup({ sessionOk: false });
		expect(app.screen()).toBe("expired");
		expect(app.heading()).toBe("This setup window has closed");
		expect(app.text()).toContain("Set up Deckify");
		expect(app.el("status-text").textContent).toBe("Closed");
	});

	it("shows that setup has closed when opened without a launch code", async () => {
		const app = await openSetup({ hash: "" });
		expect(app.screen()).toBe("expired");
		expect(app.server.requests).toEqual([]);
	});

	it("stops when Deckify ends the session", async () => {
		const app = await openSetup();
		await app.receive(NOT_CONFIGURED);
		await app.endSession();
		expect(app.screen()).toBe("expired");
	});

	it("starts at the account part when opened from 'Already set up?'", async () => {
		const app = await openSetup({ entry: "account" });
		await app.receive(NOT_CONFIGURED);
		expect(app.screen()).toBe("setup");
		expect(app.heading()).toBe("Add your Client ID");
	});
});

describe("first run", () => {
	it("opens on a branded welcome with the requirements up front", async () => {
		const app = await openSetup();
		expect(app.screen()).toBe("loading");
		await app.receive(NOT_CONFIGURED);

		expect(app.screen()).toBe("welcome");
		expect(app.heading()).toBe("Connect Deckify to Spotify");
		expect(app.text()).toContain("Setup takes a couple of minutes. Deckify will guide you through creating the Spotify app it needs.");
		for (const requirement of ["Spotify Premium", "A Spotify Developer account", "No Client Secret required"]) {
			expect(app.text()).toContain(requirement);
		}
		expect(app.buttons("start-setup").map((button) => button.textContent)).toEqual(["Start setup"]);
		expect(app.view().querySelector(".hero-mark")).not.toBeNull();
		expect(app.commands()).toEqual([]);
	});
});

describe("guided setup", () => {
	it("walks through the four steps with Next and Back, showing progress", async () => {
		const app = await openSetup();
		await app.receive(NOT_CONFIGURED);
		app.click("start-setup");

		const current = () => app.document.querySelector("#stepper [aria-current='step']")?.getAttribute("data-step");
		expect(app.screen()).toBe("setup");
		expect(app.heading()).toBe("Open Spotify Dashboard");
		expect(app.el("step-counter").textContent).toBe("Step 1 of 4");
		expect(current()).toBe("1");
		expect([...app.document.querySelectorAll("#stepper .step-label")].map((label) => label.textContent)).toEqual(["Dashboard", "Spotify app", "Client ID", "Connect"]);

		app.click("step-next");
		expect(app.heading()).toBe("Create your Spotify app");
		expect(current()).toBe("2");
		expect(app.document.querySelector("#stepper li[data-step='1']")?.getAttribute("data-state")).toBe("done");

		app.click("step-next");
		expect(app.heading()).toBe("Add your Client ID");
		expect(app.text()).toContain("Paste your Spotify Client ID");
		// Without a saved Client ID there is nothing to connect yet.
		expect(app.buttons("step-next")[0]?.disabled).toBe(true);

		app.click("step-back");
		expect(current()).toBe("2");
		app.click("step-back");
		app.click("step-back");
		expect(app.screen()).toBe("welcome");
	});

	it("moves keyboard focus to the heading of each new step", async () => {
		const app = await openSetup();
		await app.receive(NOT_CONFIGURED);
		app.click("start-setup");
		expect(app.document.activeElement?.id).toBe("setup-title");
		app.click("step-next");
		expect(app.document.activeElement?.id).toBe("setup-title");
		expect(app.document.activeElement?.textContent).toBe("Create your Spotify app");
	});

	it("step 1 explains why, shows Deckify → your Spotify app → Spotify, and opens the Dashboard through Deckify without a URL", async () => {
		const app = await openSetup();
		await app.receive(NOT_CONFIGURED);
		app.click("start-setup");
		expect(app.text()).toContain("Deckify uses your own Spotify app so no secret credential has to be shipped inside the plugin.");
		expect([...app.view().querySelectorAll(".flow-node > span:last-child")].map((node) => node.textContent.trim())).toEqual(["Deckify", "Your Spotify app", "Spotify"]);

		const button = app.click("open-dashboard");
		expect(button.textContent).toBe("Open Spotify Dashboard");
		expect(app.commands().at(-1)).toEqual({ type: "open-dashboard" });
	});

	it("step 2 shows the exact Redirect URI, Web API, the localhost warning and the Development Mode note", async () => {
		const app = await openSetup();
		await app.receive(NOT_CONFIGURED);
		app.click("start-setup");
		app.click("step-next");

		const text = app.text();
		expect(text).toContain("Create an app.");
		expect(text).toMatch(/any app name and description, for example Deckify/);
		expect(text).toContain("select Web API");
		expect(text).toContain("Do not use localhost.");
		expect(text).toContain("Spotify currently requires Premium for the owner of a Development Mode app.");

		const fields = [...app.view().querySelectorAll<HTMLInputElement>("[data-redirect-uri]")].filter(app.shown);
		expect(fields.map((field) => field.value)).toEqual(["http://127.0.0.1:43821/callback"]);
		expect(fields[0]?.readOnly).toBe(true);
		expect(app.buttons("copy-redirect-uri").map((button) => button.textContent)).toEqual(["Copy Redirect URI"]);
	});

	it("keeps the Development Mode limits in a collapsed section and presents them as Spotify's rules", async () => {
		const app = await openSetup();
		await app.receive(NOT_CONFIGURED);
		app.click("start-setup");
		app.click("step-next");

		const details = app.view().querySelector("details.help");
		expect(details?.querySelector("summary")?.textContent).toBe("About Spotify Development Mode");
		expect(details?.hasAttribute("open")).toBe(false);
		const help = details?.textContent.replace(/\s+/g, " ") ?? "";
		expect(help).toContain("app owner to have Spotify Premium");
		expect(help).toContain("one Development Mode Client ID");
		expect(help).toContain("up to five Spotify accounts");
		expect(help).toContain("Users Management");
		expect(help).toContain("These are Spotify's rules for Development Mode apps, not Deckify limits.");
		expect(app.document.body.textContent).not.toMatch(/extended quota|approved by Spotify|official Spotify app/i);
		expect(app.document.body.textContent).toContain("not affiliated with or endorsed by Spotify");
	});

	it("step 3 saves with Save & Continue, confirms briefly, and moves on to Connect", async () => {
		const app = await openSetup();
		await app.receive(NOT_CONFIGURED);
		app.click("start-setup");
		app.click("step-next");
		app.click("step-next");
		expect(app.text()).toContain("Client ID is safe to use in installed apps. Deckify never asks for your Client Secret.");
		expect(app.buttons("save-client-id").map((button) => button.textContent)).toEqual(["Save & Continue"]);

		app.server.onCommand = (command) => {
			if (command.type === "save-client-id") {
				app.server.state = { ...DISCONNECTED };
				app.server.version++;
			}
			return undefined;
		};
		app.type(` ${FAKE.clientId} `);
		app.click("save-client-id");
		// The raw input goes to the plugin, which trims and validates it with its existing validator.
		expect(app.commands().at(-1)).toEqual({ type: "save-client-id", clientId: ` ${FAKE.clientId} ` });
		await settle();

		expect(app.heading()).toBe("Connect Spotify");
		expect(app.shown(app.el("client-id-saved"))).toBe(true);
		expect(app.el("client-id-saved").getAttribute("role")).toBe("status");
		expect(app.text()).toContain("Client ID saved.");
		expect(app.text()).toContain("Your browser will open Spotify's authorization page.");
		app.advance(4000);
		expect(app.shown(app.el("client-id-saved"))).toBe(false);

		app.click("step-back");
		expect((app.el("client-id") as HTMLInputElement).value).toBe(FAKE.clientId);
		expect(app.text()).toContain("Client ID saved.");
	});

	it("saves with Enter, and asks for a Client ID instead of sending an empty one", async () => {
		const app = await openSetup();
		await app.receive(NOT_CONFIGURED);
		app.click("have-client-id");
		expect(app.heading()).toBe("Add your Client ID");
		expect(app.document.activeElement?.id).toBe("client-id");

		const input = app.el("client-id");
		input.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Enter" }));
		expect(app.commands()).toEqual([]);
		expect(app.text()).toContain("Paste your Client ID first.");

		app.type(FAKE.clientId);
		input.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Enter" }));
		expect(app.commands().at(-1)).toEqual({ type: "save-client-id", clientId: FAKE.clientId });
	});

	it("does not advance when the Client ID is invalid, and explains what to do", async () => {
		const app = await openSetup();
		await app.receive(NOT_CONFIGURED);
		app.click("have-client-id");
		app.server.onCommand = () => ({ clientIdError: "That does not look like a Spotify Client ID.", clientIdIssue: "invalid-client-id" });
		app.type("not-a-client-id");
		app.click("save-client-id");
		await settle();

		expect(app.heading()).toBe("Add your Client ID");
		expect(app.shown(app.el("client-id-saved"))).toBe(false);
		const card = app.el("client-id-issue");
		expect(app.shown(card)).toBe(true);
		expect(card.querySelector("h3")?.textContent).toContain("That Client ID doesn't look valid");
		expect(card.textContent).toContain("Open your Spotify app settings, copy the Client ID again and paste it here.");
		expect(card.textContent).not.toMatch(/secret/i);
		expect([...card.querySelectorAll("button")].map((button) => button.dataset.action)).toEqual(["open-dashboard"]);
		expect((app.el("client-id") as HTMLInputElement).value).toBe("not-a-client-id");

		card.querySelector<HTMLButtonElement>("button")?.click();
		expect(app.commands().at(-1)).toEqual({ type: "open-dashboard" });
	});

	it("offers both Open Dashboard and Edit Client ID wherever an invalid Client ID is reported", async () => {
		const model = await loadModel();
		expect(model.guidanceFor("invalid-client-id").actions).toEqual(["open-dashboard", "edit-client-id"]);
	});
});

describe("connecting", () => {
	it("sends Connect once, then shows a clear waiting state without fake progress", async () => {
		const app = await openSetup();
		await app.receive(DISCONNECTED);
		expect(app.heading()).toBe("Connect Spotify");

		app.server.holdCommands = true;
		const button = app.click("connect");
		expect(button.textContent).toBe("Connect Spotify");
		expect(button.disabled).toBe(true);
		button.click();
		expect(app.commands().filter((command) => command.type === "connect")).toHaveLength(1);

		await app.receive(AUTHORIZING);
		expect(app.screen()).toBe("waiting");
		expect(app.heading()).toBe("Waiting for Spotify…");
		expect(app.text()).toContain("Complete the authorization in your browser.");
		expect(app.text()).not.toMatch(/\d+ ?%/);
		expect(app.el("status-text").textContent).toBe("Connecting…");
		expect(app.view().querySelector("progress, [role='progressbar']")).toBeNull();
	});

	it("re-enables Connect if Deckify never answers", async () => {
		const app = await openSetup();
		await app.receive(DISCONNECTED);
		app.server.holdCommands = true;
		const button = app.click("connect");
		expect(button.disabled).toBe(true);
		app.advance(5000);
		expect(button.disabled).toBe(false);
	});

	it("offers troubleshooting when Spotify takes long, without declaring a failure or a wrong Redirect URI", async () => {
		const app = await openSetup();
		await app.receive(AUTHORIZING);
		expect(app.shown(app.el("slow-help"))).toBe(false);

		app.advance(44_999);
		expect(app.shown(app.el("slow-help"))).toBe(false);
		app.advance(1);
		expect(app.shown(app.el("slow-help"))).toBe(true);
		expect(app.screen()).toBe("waiting");
		expect(app.el("status-text").textContent).toBe("Connecting…");

		const help = visibleText(app.el("slow-help"), app.shown);
		expect(help).toContain("Taking longer than expected?");
		expect(help).toContain("Check that your Spotify app contains exactly: http://127.0.0.1:43821/callback");
		expect(help).not.toMatch(/is wrong|mismatch|incorrect/i);
		expect(app.el("announcer").textContent).toContain("Taking longer than expected?");

		expect(app.buttons("copy-redirect-uri")).toHaveLength(1);
		expect(app.buttons("open-dashboard")).toHaveLength(1);
		app.click("retry-connect");
		expect(app.commands().at(-1)).toEqual({ type: "retry-connect" });
		expect(app.shown(app.el("slow-help"))).toBe(false);
	});

	it("can cancel a sign-in that is waiting for the browser", async () => {
		const app = await openSetup();
		await app.receive(AUTHORIZING);
		app.click("cancel-connect");
		expect(app.commands().at(-1)).toEqual({ type: "cancel-connect" });
	});

	it("shows a quiet check, not the browser wait, while a saved session is restored", async () => {
		const app = await openSetup();
		await app.receive({ ...DISCONNECTED, status: "connecting", activity: "restoring" });
		expect(app.screen()).toBe("restoring");
		expect(app.el("status-text").textContent).toBe("Checking…");
		app.advance(60_000);
		expect(app.shown(app.el("slow-help"))).toBe(false);
	});
});

describe("issue guidance", () => {
	it("cancelled authorization: no changes were made, try again", async () => {
		const app = await openSetup();
		await app.receive({ ...DISCONNECTED, issue: "authorization-denied", message: "Spotify access was not granted." });

		expect(app.heading()).toBe("Connect Spotify");
		const card = app.el("connect-issue");
		expect(card.querySelector("h3")?.textContent).toContain("Spotify connection cancelled");
		expect(card.textContent).toContain("No changes were made. You can try again when you're ready.");
		const tryAgain = card.querySelector<HTMLButtonElement>("button[data-action='connect']");
		expect(tryAgain?.textContent).toBe("Try again");
		expect(app.buttons("connect")).toHaveLength(1);
		tryAgain?.click();
		expect(app.commands().at(-1)).toEqual({ type: "connect" });
	});

	it("timeout: suggests checking the exact Redirect URI and 127.0.0.1 without claiming it is wrong", async () => {
		const app = await openSetup();
		await app.receive({ ...DISCONNECTED, status: "error", issue: "authorization-timeout", message: "Spotify sign-in timed out." });

		const card = app.el("connect-issue");
		const text = visibleText(card, app.shown);
		expect(text).toContain("Deckify didn't hear back from Spotify");
		expect(text).toContain("127.0.0.1, not localhost");
		expect(text).toContain("http://127.0.0.1:43821/callback");
		expect(text).not.toMatch(/is wrong|mismatch|incorrect/i);
		expect([...card.querySelectorAll("button")].map((button) => button.dataset.action)).toEqual(["copy-redirect-uri", "connect", "open-dashboard"]);
	});

	it("access refused: points to Users Management as a possible fix, not a diagnosis", async () => {
		const app = await openSetup();
		await app.receive({ ...DISCONNECTED, status: "error", issue: "spotify-access-refused", message: "Spotify refused access (HTTP 403)." });

		const text = visibleText(app.el("connect-issue"), app.shown);
		expect(text).toContain("Spotify didn't allow this account to use the app");
		expect(text).toContain("If you're signing in with a Spotify account different from the app owner, check the app's Users Management");
		expect(text).toContain("possible fix, not a confirmed cause");
		expect(text).toMatch(/Development Mode/);
		expect(text).not.toMatch(/you are not registered|you must add|is not allowlisted/i);
		expect(app.el("connect-issue").querySelector("button")?.dataset.action).toBe("open-dashboard");
	});

	it("never suggests Users Management for other errors", async () => {
		const model = await loadModel();
		for (const [issue, guidance] of Object.entries(model.ISSUES)) {
			expect(JSON.stringify(guidance).includes("Users Management"), issue).toBe(issue === "spotify-access-refused");
		}
	});

	it("unclassified errors still say what to try next, and show the plugin's message only as a detail", async () => {
		const app = await openSetup();
		await app.receive({ ...DISCONNECTED, status: "error", issue: "unknown", message: "Spotify returned an unexpected response." });
		const text = visibleText(app.el("connect-issue"), app.shown);
		expect(text).toContain("Something went wrong");
		expect(text).toContain("Try again.");
		expect(text).toContain("Details: Spotify returned an unexpected response.");
	});

	it("treats an issue code it doesn't know as unclassified", async () => {
		const app = await openSetup();
		await app.receive({ ...DISCONNECTED, status: "error", issue: "something-new", message: "Boom." });
		expect(visibleText(app.el("connect-issue"), app.shown)).toContain("Something went wrong");
	});

	it("has guidance with a title, an explanation and a next step for every issue code the plugin can send", async () => {
		const model = await loadModel();
		const source = await readFile(path.resolve(import.meta.dirname, "..", "src", "spotify", "account-issues.ts"), "utf8");
		const union = source.slice(source.indexOf("export type SpotifyAccountIssue"), source.indexOf("export function"));
		const codes = [...union.matchAll(/\| "([a-z-]+)"/g)].map((match) => match[1] ?? "");
		expect(codes.length).toBeGreaterThanOrEqual(15);
		expect(Object.keys(model.ISSUES).sort()).toEqual([...codes].sort());
		for (const code of codes) {
			const guidance = model.guidanceFor(code);
			expect(guidance.title, code).toBeTruthy();
			expect(guidance.body, code).toBeTruthy();
			expect(guidance.actions.length > 0 || /try|connect again|check/i.test(guidance.body), code).toBe(true);
		}
	});
});

describe("copy Redirect URI", () => {
	it("copies exactly the Redirect URI and confirms it", async () => {
		const app = await openSetup({ clipboard: "ok" });
		await app.receive(NOT_CONFIGURED);
		app.click("start-setup");
		app.click("step-next");

		const button = app.click("copy-redirect-uri");
		await settle();
		expect(app.clipboard.writeText).toHaveBeenCalledWith("http://127.0.0.1:43821/callback");
		expect(button.textContent).toBe("Copied");
		expect(app.el("announcer").textContent).toBe("Redirect URI copied.");

		app.advance(2000);
		expect(button.textContent).toBe("Copy Redirect URI");
	});

	it("falls back to the copy command when the Clipboard API is refused", async () => {
		const app = await openSetup({ clipboard: "reject", execCommand: true });
		await app.receive(NOT_CONFIGURED);
		app.click("start-setup");
		app.click("step-next");

		const button = app.click("copy-redirect-uri");
		await settle();
		expect(app.execCommand).toHaveBeenCalledWith("copy");
		expect(button.textContent).toBe("Copied");
	});

	it("selects the Redirect URI for Ctrl+C when copying isn't available", async () => {
		const app = await openSetup({ clipboard: "missing", execCommand: false });
		await app.receive(NOT_CONFIGURED);
		app.click("start-setup");
		app.click("step-next");

		const button = app.click("copy-redirect-uri");
		await settle();
		const field = button.closest(".copy-row")?.querySelector("input") as HTMLInputElement;
		expect(app.document.activeElement).toBe(field);
		expect(field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)).toBe("http://127.0.0.1:43821/callback");
		expect(button.textContent).toBe("Press Ctrl+C");
	});
});

describe("connected", () => {
	it("celebrates a new connection, making Choose my Deckify experience the next step and the tour optional", async () => {
		const app = await openSetup();
		await app.receive(DISCONNECTED);
		app.click("connect");
		await app.receive(AUTHORIZING);
		await app.receive(CONNECTED);

		expect(app.screen()).toBe("connected");
		expect(app.heading()).toContain("You're connected");
		expect(app.el("account-name").textContent).toBe("Test Listener");
		expect(app.el("account-premium").textContent).toBe("Yes");
		expect(app.el("account-status").textContent).toBe("Connected");
		expect(app.el("status-text").textContent).toBe("Connected");
		const [choose] = app.buttons("experience-start");
		expect(choose?.textContent).toBe("Choose my Deckify experience");
		expect(choose?.classList.contains("primary")).toBe(true);
		const [tour] = app.buttons("tour-start");
		expect(tour?.textContent).toBe("Show me around first");
		expect(tour?.classList.contains("primary")).toBe(false);
		expect(app.buttons("show-ready")).toHaveLength(0);
		expect(app.buttons("disconnect")).toHaveLength(1);
		expect(app.document.activeElement?.id).toBe("connected-title");

		// The tour is optional: the experience chooser is one click away.
		app.click("experience-start");
		expect(app.screen()).toBe("experiences");
		expect(app.commands()).toEqual([{ type: "connect" }]);
	});

	it("shows the account view, not setup, when reopened while connected", async () => {
		const app = await openSetup();
		await app.receive(CONNECTED);
		expect(app.screen()).toBe("connected");
		expect(app.heading()).toBe("Connected to Spotify");
		expect(app.shown(app.el("success-text"))).toBe(false);
		expect(app.buttons("tour-start")[0]?.classList.contains("primary")).toBe(false);
		expect(app.buttons("tour-start")[0]?.textContent).toBe("Show me around");
		// People who set up before can still pick an experience from here.
		// Hierarchy: choosing an experience is primary, the tour secondary, Done a low-emphasis text action that is still offered.
		const emphasis = (button: HTMLButtonElement | undefined) => (button?.classList.contains("primary") ? "primary" : button?.classList.contains("link") ? "text" : "secondary");
		const actions = [...app.view().querySelectorAll<HTMLButtonElement>(".actions button")].filter(app.shown).slice(0, 3);
		expect(actions.map((button) => [button.textContent, emphasis(button)])).toEqual([
			["Choose a Deckify experience", "primary"],
			["Show me around", "secondary"],
			["Done", "text"],
		]);
		expect(app.buttons("finish").map((button) => button.textContent)).toEqual(["Done"]);
		expect(app.view().querySelector("details.help summary")?.textContent).toBe("Account setup help");

		app.click("edit-client-id");
		expect(app.heading()).toBe("Add your Client ID");
		expect(app.text()).toContain("Saving a different Client ID signs Deckify out");
		app.click("step-back");
		app.click("step-back");
		app.click("step-back");
		expect(app.screen()).toBe("connected");
	});

	it("explains what a non-Premium account can't do", async () => {
		const app = await openSetup();
		await app.receive({ ...CONNECTED, product: "free" });
		expect(app.el("account-premium").textContent).toBe("No (Spotify Free)");
		expect(app.shown(app.el("premium-note"))).toBe(true);
		expect(app.el("premium-note").textContent).toContain("Spotify only allows playback control for Premium accounts.");
		expect(app.el("premium-note").textContent).not.toMatch(/Development Mode/);
	});

	it("does not invent a plan Spotify didn't report", async () => {
		const app = await openSetup();
		await app.receive({ ...CONNECTED, product: null });
		expect(app.el("account-premium").textContent).toBe("Not reported by Spotify");
		expect(app.shown(app.el("premium-note"))).toBe(false);
	});

	it("still disconnects", async () => {
		const app = await openSetup();
		await app.receive(CONNECTED);
		app.click("disconnect");
		expect(app.commands().at(-1)).toEqual({ type: "disconnect" });
		await app.receive(DISCONNECTED);
		expect(app.heading()).toBe("Connect Spotify");
	});
});

describe("tour and finish", () => {
	it("pages through Now Playing, Like, Playlists and Volume, then continues to the experience chooser", async () => {
		const app = await openSetup();
		await app.receive(AUTHORIZING);
		await app.receive(CONNECTED);
		app.click("tour-start");

		const page = () => ({ title: app.heading(), counter: app.el("tour-counter").textContent, body: app.el("tour-body").textContent });
		const chips = () => [...app.el("tour-actions").querySelectorAll("li")].map((chip) => chip.textContent);
		expect(app.screen()).toBe("tour");
		expect(page()).toMatchObject({ title: "Now Playing", counter: "1 of 4" });
		expect(page().body).toContain("Press it to open the song on Spotify.");
		expect(chips()).toEqual(["Now Playing"]);
		expect(app.buttons("tour-prev")[0]?.disabled).toBe(true);
		expect(app.buttons("tour-done")).toHaveLength(0);

		app.click("tour-next");
		expect(page()).toMatchObject({ title: "Like", counter: "2 of 4", body: "Save or remove the current song from your Spotify library." });
		app.click("tour-next");
		expect(page()).toMatchObject({ title: "Playlists", body: "Add the current song without duplicates, or launch a playlist from a key." });
		expect(chips()).toEqual(["Add to Playlist", "Play Playlist"]);
		app.click("tour-prev");
		expect(page().title).toBe("Like");
		app.click("tour-next");
		app.click("tour-next");
		expect(page()).toMatchObject({ title: "Volume", counter: "4 of 4", body: "Control Spotify's own device volume, not the Windows mixer." });
		expect(app.buttons("tour-next")).toHaveLength(0);
		expect(app.buttons("tour-done")[0]?.textContent).toBe("Choose my experience");

		app.click("tour-done");
		expect(app.screen()).toBe("experiences");
		expect(app.heading()).toBe("Choose your Deckify experience");
		// The tour itself is local: it never asked Deckify for anything.
		expect(app.commands()).toEqual([]);
	});

	it("says 'drag Deckify actions' once, on the ready screen, not on every tour card", async () => {
		const html = await readFile(path.join(PLUGIN, "ui", "setup", "index.html"), "utf8");
		expect(html.match(/Drag Deckify actions/g)).toHaveLength(1);
		const tour = /<section class="view" data-view="tour"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
		expect(tour).not.toContain("Drag Deckify actions");
		const model = await loadModel();
		expect(JSON.stringify(model.TOUR)).not.toContain("Drag");
	});

	it("Done finishes setup: Deckify closes it and the page says so", async () => {
		const app = await openSetup();
		await app.receive(CONNECTED);
		app.click("tour-start");
		app.click("tour-next");
		app.click("tour-next");
		app.click("tour-next");
		app.click("tour-done");
		app.click("experience-skip");
		app.click("finish");
		await settle();
		expect(app.commands().at(-1)).toEqual({ type: "finish" });
		expect(app.screen()).toBe("finished");
		expect(app.text()).toContain("You can close this tab.");
	});

	it("names only actions that exist, using the actions' own icons (Like: Spotify's official + icon), which the Setup App serves", async () => {
		const model = await loadModel();
		const manifest = JSON.parse(await readFile(path.join(PLUGIN, "manifest.json"), "utf8")) as { Actions: { Name: string; Icon: string }[] };
		const names = manifest.Actions.map((action) => action.Name);
		for (const page of model.TOUR) {
			for (const action of page.actions) {
				expect(names, action).toContain(action);
			}
			const asset = SETUP_ASSETS[page.icon];
			expect(asset, page.icon).toBeDefined();
			expect(manifest.Actions.map((action) => `${action.Icon}.svg`)).toContain(asset?.file);
		}
	});
});

type Catalog = {
	ACTIONS: Record<string, { name: string; uuid: string; icon: string }>;
	EXPERIENCES: { id: string; label: string; description: string; recommended: boolean; layout: (string | null)[][] }[];
	DEFAULT_EXPERIENCE: string;
};

/**
 * Loads experiences.js on its own.
 * @returns Its exports.
 */
async function loadCatalog(): Promise<Catalog> {
	const dom = new JSDOM("", { runScripts: "outside-only" });
	dom.window.eval(await readFile(path.join(PLUGIN, "ui", "setup", "experiences.js"), "utf8"));
	return (dom.window as unknown as { DeckifyExperiences: Catalog }).DeckifyExperiences;
}

/**
 * Opens the Setup App on the experience chooser, right after connecting.
 * @param options Environment options.
 * @returns The app.
 */
async function openChooser(options: Options = {}) {
	const app = await openSetup(options);
	await app.receive(AUTHORIZING);
	await app.receive(CONNECTED);
	app.click("experience-start");
	return app;
}

describe("choosing an experience", () => {
	const cards = (app: Awaited<ReturnType<typeof openSetup>>) => [...app.el("experience-list").querySelectorAll<HTMLButtonElement>(".experience-card")];
	const checked = (app: Awaited<ReturnType<typeof openSetup>>) => cards(app).map((card) => card.getAttribute("aria-checked"));

	it("offers exactly two layout choices, DECKIFY first, recommended and selected, then SIMPLE", async () => {
		const app = await openChooser();
		expect(app.screen()).toBe("experiences");
		expect(app.heading()).toBe("Choose your Deckify experience");
		expect(app.el("experience-list").getAttribute("role")).toBe("radiogroup");
		expect(cards(app).map((card) => card.querySelector(".experience-name")?.textContent)).toEqual(["DECKIFY", "SIMPLE"]);
		expect(cards(app).map((card) => card.querySelector(".experience-description")?.textContent)).toEqual([
			"The complete Deckify experience.",
			"The essentials. Clean and focused.",
		]);
		expect(cards(app).map((card) => card.getAttribute("role"))).toEqual(["radio", "radio"]);
		expect(cards(app).map((card) => card.dataset.experience)).toEqual(["deckify", "simple"]);
		expect(checked(app)).toEqual(["true", "false"]);
		// Exactly one badge, on DECKIFY.
		expect(cards(app).map((card) => card.querySelector(".experience-badge")?.textContent ?? null)).toEqual(["Recommended", null]);
		expect(app.text()).not.toMatch(/power/i);
		expect(app.buttons("experience-use").map((button) => [button.textContent, button.classList.contains("primary")])).toEqual([["Use this experience", true]]);
		// Layouts, not plans: no prices, tiers or feature checklists.
		expect(app.text()).not.toMatch(/\$|€|£|price|per month|\/mo\b|plan\b|tier|free trial|upgrade/i);
		// Nothing is installed by opening or browsing the chooser.
		expect(app.commands()).toEqual([]);
	});

	it("previews each experience's exact 5 × 3 layout with Deckify's own action icons", async () => {
		const app = await openChooser();
		const catalog = await loadCatalog();
		for (const [index, card] of cards(app).entries()) {
			const experience = catalog.EXPERIENCES[index];
			const tiles = [...card.querySelectorAll<HTMLElement>(".deck-key")];
			expect(tiles).toHaveLength(15);
			const drawn = tiles.map((tile) => tile.dataset.key ?? null);
			expect(drawn).toEqual(experience?.layout.flat());
			for (const tile of tiles) {
				const icon = tile.querySelector("img");
				if (tile.dataset.key === undefined) {
					expect(icon).toBeNull();
					expect(tile.classList.contains("empty")).toBe(true);
				} else {
					expect(icon?.getAttribute("src")).toBe(catalog.ACTIONS[tile.dataset.key]?.icon);
					expect(SETUP_ASSETS[icon?.getAttribute("src") ?? ""], tile.dataset.key).toBeDefined();
					expect(icon?.getAttribute("alt")).toBe("");
				}
			}
			// Screen readers get the layout in words.
			expect(card.querySelector(".sr-only")?.textContent).toMatch(/^Top row: .+\. Middle row: .+\. Bottom row: .+\.$/);
			expect(card.querySelector(".deck-preview")?.getAttribute("aria-hidden")).toBe("true");
		}
		// No Spotify artwork or song metadata in a preview.
		expect(app.el("experience-list").textContent).not.toMatch(/spotify:|open\.spotify|album|artist/i);
	});

	it("selects with a click or the arrow keys without sending anything", async () => {
		const app = await openChooser();
		app.click("experience-select", 1);
		expect(checked(app)).toEqual(["false", "true"]);
		expect(app.document.activeElement).toBe(cards(app)[1]);
		app.el("experience-list").dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
		expect(checked(app)).toEqual(["true", "false"]);
		app.el("experience-list").dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
		expect(checked(app)).toEqual(["false", "true"]);
		app.el("experience-list").dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(checked(app)).toEqual(["true", "false"]);
		expect(app.commands().filter((command) => command.type === "choose-experience")).toEqual([]);
	});

	it("sends only the experience ID, once, then asks the user to finish in Stream Deck without claiming success", async () => {
		const app = await openChooser();
		app.server.holdCommands = true;
		app.click("experience-select", 1);
		const use = app.click("experience-use");
		// A double-click (or any click while the request is on its way) sends nothing more.
		use.click();
		app.click("experience-select", 0);
		expect(use.disabled).toBe(true);
		const sent = app.commands().filter((command) => command.type === "choose-experience");
		expect(sent).toEqual([{ type: "choose-experience", experience: "simple" }]);
		expect(checked(app)).toEqual(["false", "true"]);

		app.server.holdCommands = false;
		const fresh = await openChooser();
		fresh.click("experience-use");
		await settle();
		expect(fresh.screen()).toBe("experience-finish");
		expect(fresh.heading()).toBe("Finish in Stream Deck");
		expect(fresh.el("experience-finish-name").textContent).toBe("DECKIFY");
		expect(fresh.text()).toContain("Stream Deck may ask you to install the Deckify profile once. Approve it to continue.");
		// No fake progress, no claim that the profile was installed.
		expect(fresh.text()).not.toMatch(/\d+ ?%|installed|success/i);
		expect(fresh.view().querySelector(".spinner, progress")).toBeNull();
		expect(fresh.commands().filter((command) => command.type === "choose-experience")).toEqual([{ type: "choose-experience", experience: "deckify" }]);
	});

	it("ends on a ready screen naming the experience, with a way back to the chooser", async () => {
		const app = await openChooser();
		app.click("experience-use");
		await settle();
		app.click("experience-done");
		expect(app.screen()).toBe("ready");
		expect(app.heading()).toBe("Deckify is ready.");
		expect(app.el("ready-experience").textContent).toBe("DECKIFY · Recommended");
		expect(app.text()).toContain("Your controls are ready on Stream Deck.");
		expect(app.text()).not.toContain("Drag Deckify actions");
		expect(app.buttons("finish").map((button) => [button.textContent, button.classList.contains("primary")])).toEqual([["Done", true]]);

		app.click("experience-start");
		expect(app.screen()).toBe("experiences");
		expect(checked(app)).toEqual(["true", "false"]);
		app.click("experience-select", 1);
		app.click("experience-use");
		await settle();
		app.click("experience-done");
		expect(app.el("ready-experience").textContent).toBe("SIMPLE");
		expect(app.commands().filter((command) => command.type === "choose-experience").map((command) => command.experience)).toEqual(["deckify", "simple"]);
	});

	it("can be skipped, keeping the drag-and-drop ready screen", async () => {
		const app = await openChooser();
		app.click("experience-skip");
		expect(app.screen()).toBe("ready");
		expect(app.shown(app.el("ready-experience"))).toBe(false);
		expect(app.text()).toContain("Drag Deckify actions from the Stream Deck actions list onto your keys.");
		expect(app.buttons("experience-start").map((button) => button.textContent)).toEqual(["Choose a Deckify experience"]);
		expect(app.commands().filter((command) => command.type === "choose-experience")).toEqual([]);
	});

	it("explains a Stream Deck the layouts don't fit instead of offering to install them", async () => {
		const app = await openChooser({ experiences: "unsupported-device" });
		expect(app.shown(app.el("experience-unsupported"))).toBe(true);
		expect(app.el("experience-unsupported").textContent).toContain("Stream Deck and Stream Deck MK.2");
		expect(app.buttons("experience-use")).toHaveLength(0);
		expect(cards(app).every((card) => card.disabled)).toBe(true);
		app.click("experience-skip");
		expect(app.screen()).toBe("ready");
		expect(app.buttons("experience-start")).toHaveLength(0);
		expect(app.commands().filter((command) => command.type === "choose-experience")).toEqual([]);
	});

	it("switches to that explanation if the plugin reports an unsupported device", async () => {
		const app = await openChooser();
		app.server.experienceOutcome = "unsupported-device";
		app.click("experience-use");
		await settle();
		expect(app.screen()).toBe("experiences");
		expect(app.shown(app.el("experience-unsupported"))).toBe(true);
		expect(app.buttons("experience-use")).toHaveLength(0);
	});

	it("says when Stream Deck can't be reached or refuses, and lets the user try again", async () => {
		const app = await openChooser();
		app.server.experienceOutcome = "device-unavailable";
		app.click("experience-use");
		await settle();
		expect(app.screen()).toBe("experiences");
		expect(app.el("experience-issue").textContent).toContain("Deckify can't reach your Stream Deck");
		expect(app.buttons("experience-use")[0]?.disabled).toBe(false);

		app.server.experienceOutcome = "failed";
		app.click("experience-use");
		await settle();
		expect(app.el("experience-issue").getAttribute("role")).toBe("alert");
		expect(app.el("experience-issue").textContent).toContain("Stream Deck didn't accept the request");

		app.server.experienceOutcome = "requested";
		app.click("experience-use");
		await settle();
		expect(app.screen()).toBe("experience-finish");
	});

	it("leaves the chooser if Spotify disconnects", async () => {
		const app = await openChooser();
		await app.receive(DISCONNECTED);
		expect(app.screen()).toBe("setup");
		await app.receive(CONNECTED);
		expect(app.screen()).toBe("connected");
	});
});

describe("reconnect", () => {
	it("asks for updated permissions in a compact screen instead of the first-run wizard", async () => {
		const app = await openSetup();
		await app.receive({ ...DISCONNECTED, status: "reauthorization-required", issue: "reauthorization-required" });

		expect(app.screen()).toBe("reconnect");
		expect(app.heading()).toBe("Deckify needs updated Spotify permissions");
		expect(app.text()).toContain("Deckify added features that need additional Spotify permissions.");
		expect(app.view().querySelector("details summary")?.textContent).toBe("Why?");
		const button = app.click("connect");
		expect(button.textContent).toBe("Reconnect Spotify");
		expect(app.commands().at(-1)).toEqual({ type: "connect" });
	});

	it("asks an expired session to sign in again, also without the wizard", async () => {
		const app = await openSetup();
		await app.receive({ ...DISCONNECTED, issue: "session-expired" });
		expect(app.screen()).toBe("reconnect");
		expect(app.heading()).toBe("Sign in to Spotify again");
		expect(app.click("connect").textContent).toBe("Sign in again");
	});
});

describe("security and privacy of the page", () => {
	it("never asks for a Client Secret", async () => {
		const app = await openSetup();
		await app.receive(NOT_CONFIGURED);
		const inputs = [...app.document.querySelectorAll("input, textarea, select")];
		expect(inputs.map((input) => input.id || input.getAttribute("aria-label")).sort()).toEqual(["Redirect URI", "Redirect URI", "Redirect URI", "client-id"]);
		for (const input of inputs) {
			expect(input.outerHTML).not.toMatch(/secret|password/i);
		}
		const sentences = app.document.body.textContent.split(/(?<=[.!?])\s+|\n/).filter((sentence) => /client secret/i.test(sentence));
		expect(sentences.length).toBeGreaterThanOrEqual(2);
		for (const sentence of sentences) {
			expect(sentence).toMatch(/\bnever\b|\bNo Client Secret\b/);
		}
	});

	it("never shows localhost as the Redirect URI", async () => {
		const app = await openSetup();
		await app.receive(DISCONNECTED);
		expect(app.document.body.innerHTML).not.toMatch(/\/\/localhost/i);
		for (const field of app.document.querySelectorAll<HTMLInputElement>("[data-redirect-uri]")) {
			expect(field.value).toBe("http://127.0.0.1:43821/callback");
		}
		const mentions = app.document.body.textContent.split(/(?<=[.!?])\s+/).filter((sentence) => /localhost/i.test(sentence));
		for (const mention of mentions) {
			expect(mention).toMatch(/not localhost|Do not use localhost/);
		}
	});

	it("sends only allowlisted commands, without tokens, URLs or secrets, and uses no browser storage or cookies", async () => {
		const app = await openSetup({ clipboard: "ok" });
		await app.receive(NOT_CONFIGURED);
		app.click("start-setup");
		app.click("open-dashboard");
		app.click("step-next");
		app.click("copy-redirect-uri");
		await settle();
		app.click("step-next");
		app.type(FAKE.clientId);
		app.click("save-client-id");
		await app.receive(DISCONNECTED);
		app.click("connect");
		await app.receive(AUTHORIZING);
		app.advance(45_000);
		app.click("retry-connect");
		await app.receive(AUTHORIZING);
		await app.receive(CONNECTED);
		app.click("tour-start");
		app.click("tour-next");
		app.click("tour-next");
		app.click("tour-next");
		app.click("tour-done");
		app.click("experience-select", 1);
		app.click("experience-use");
		await settle();
		app.click("experience-done");
		app.click("finish");
		await settle();

		const commands = app.commands();
		expect(commands.map((command) => command.type)).toEqual(["open-dashboard", "save-client-id", "connect", "retry-connect", "choose-experience", "finish"]);
		const extraKeys: Record<string, string> = { "save-client-id": "clientId", "choose-experience": "experience" };
		for (const command of commands) {
			expect(ALLOWED_COMMANDS).toContain(command.type);
			expect(Object.keys(command).filter((key) => key !== "type" && key !== extraKeys[String(command.type)])).toEqual([]);
		}
		// Only the experience ID: no profile name, file path or device.
		expect(commands.find((command) => command.type === "choose-experience")).toEqual({ type: "choose-experience", experience: "simple" });
		const wire = JSON.stringify(app.server.requests.map((request) => [request.path, request.body]));
		expect(findSecrets(wire)).toEqual([]);
		expect(wire).not.toMatch(/https?:\/\/|token|secret|verifier/i);
		expect(app.storage).toEqual([]);
	});

	it("loads only its own local scripts, styles and images", async () => {
		const app = await openSetup();
		expect(app.scripts).toEqual(["/setup/onboarding.js", "/setup/experiences.js", "/setup/setup.js"]);
		const links = [...app.document.querySelectorAll("link[href], script[src], img[src]")].map((node) => node.getAttribute("href") ?? node.getAttribute("src") ?? "");
		for (const link of links) {
			expect(link, link).toMatch(/^\/setup\//);
			expect(SETUP_ASSETS[link], link).toBeDefined();
		}
	});
});

describe("accessibility", () => {
	it("has one page title, a heading per screen, and a polite status", async () => {
		const app = await openSetup();
		expect(app.document.querySelectorAll("h1")).toHaveLength(1);
		for (const view of app.document.querySelectorAll("[data-view]")) {
			expect(view.querySelectorAll("h2"), view.getAttribute("data-view") ?? "").toHaveLength(1);
			expect(view.getAttribute("aria-labelledby")).toBe(view.querySelector("h2")?.id);
		}
		expect(app.el("status").getAttribute("role")).toBe("status");
		expect(app.el("announcer").getAttribute("aria-live")).toBe("polite");
	});

	it("writes every status out in words", async () => {
		const app = await openSetup();
		const labels: string[] = [];
		for (const status of ["not-configured", "disconnected", "connecting", "connected", "reauthorization-required", "error"]) {
			await app.receive({ ...DISCONNECTED, status });
			labels.push(app.el("status-text").textContent);
		}
		expect(labels).toEqual(["Not set up", "Not connected", "Connecting…", "Connected", "Reconnect needed", "Needs attention"]);
	});

	it("announces errors and keeps buttons keyboard-reachable", async () => {
		const app = await openSetup();
		await app.receive({ ...DISCONNECTED, status: "error", issue: "unknown" });
		expect(app.el("connect-issue").getAttribute("role")).toBe("alert");
		for (const button of app.document.querySelectorAll("button")) {
			expect(button.getAttribute("type")).toBe("button");
			expect(button.getAttribute("tabindex")).not.toBe("-1");
		}
	});

	it("shows keyboard focus, respects reduced motion, adapts to small windows and loads no remote fonts", async () => {
		const css = await readFile(path.join(PLUGIN, "ui", "setup", "setup.css"), "utf8");
		expect(css).toMatch(/:focus-visible \{[^}]*outline: 2px solid/);
		expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation: none !important/);
		expect(css).toMatch(/@media \(max-width: 720px\)/);
		expect(css).toMatch(/max-width: 820px/);
		expect(css).not.toMatch(/@import|@font-face|url\(/);
		const html = await readFile(path.join(PLUGIN, "ui", "setup", "index.html"), "utf8");
		// Deckify violet, not Spotify green.
		expect(`${css}${html}`).not.toMatch(/#1db954|#1ed760/i);
		expect(css).toMatch(/--accent: #7c5cff/i);
	});
});

describe("Deckify branding", () => {
	it("draws the approved B1 mark", async () => {
		const html = await readFile(path.join(PLUGIN, "ui", "setup", "index.html"), "utf8");
		const master = await readFile(path.resolve(import.meta.dirname, "..", "assets", "brand", "deckify-symbol.svg"), "utf8");
		const frame = /<path [^>]*d="([^"]+)"/.exec(master)?.[1] ?? "";
		expect(frame).not.toBe("");
		// The app bar, the welcome hero and the Deckify node of the diagram.
		expect(html.split(`d="${frame}"`)).toHaveLength(4);
		// The browser tab shows the B1 symbol master, unchanged.
		expect(await readFile(path.join(PLUGIN, "ui", "setup", "icon.svg"), "utf8")).toBe(master);
		expect(html).toContain('<link rel="icon" href="/setup/icon.svg" type="image/svg+xml" />');
	});
});

describe("package", () => {
	it("ships every file the Setup App server serves", () => {
		const required = pack.requiredFiles();
		for (const [url, asset] of Object.entries(SETUP_ASSETS)) {
			const icon = asset.file.startsWith("imgs/actions/");
			expect(icon || required.includes(asset.file), url).toBe(true);
		}
	});

	it("rejects a package without the Setup App", async () => {
		const manifest = JSON.parse(await readFile(path.join(PLUGIN, "manifest.json"), "utf8")) as Record<string, unknown>;
		const entries = ["bin/plugin.js", "manifest.json", "ui/spotify-account/index.html"].map((file) => `com.marting.deckify.sdPlugin/${file}`);
		const problems = pack.verifyPackageEntries(entries, manifest, false).join("\n");
		for (const file of ["ui/setup/index.html", "ui/setup/setup.js", "ui/setup/setup.css", "ui/shared/onboarding.js"]) {
			expect(problems).toContain(file);
		}
	});
});

type Guidance = { tone: string; title: string; body: string; tips?: string[]; actions: string[] };
type Model = {
	ISSUES: Record<string, Guidance>;
	TOUR: { id: string; title: string; body: string; icon: string; actions: string[] }[];
	guidanceFor: (issue: string) => Guidance;
	chooseView: (state: PublicState | undefined, ui: Record<string, unknown>) => { view: string; step?: number; variant?: string };
	initialUi: (entry?: string) => Record<string, unknown>;
	onStateChange: (ui: Record<string, unknown>, previous: PublicState | undefined, next: PublicState) => Record<string, unknown>;
};

/**
 * Loads onboarding.js on its own.
 * @returns Its exports.
 */
async function loadModel(): Promise<Model> {
	const dom = new JSDOM("", { runScripts: "outside-only" });
	dom.window.eval(await readFile(path.join(PLUGIN, "ui", "shared", "onboarding.js"), "utf8"));
	return (dom.window as unknown as { DeckifyOnboarding: Model }).DeckifyOnboarding;
}

describe("onboarding model", () => {
	it("chooses screens from the plugin's state", async () => {
		const model = await loadModel();
		const auto = model.initialUi();
		expect(model.chooseView(undefined, auto)).toEqual({ view: "loading" });
		expect(model.chooseView(NOT_CONFIGURED, auto)).toEqual({ view: "welcome" });
		expect(model.chooseView(NOT_CONFIGURED, model.initialUi("account"))).toEqual({ view: "setup", step: 3 });
		expect(model.chooseView(NOT_CONFIGURED, { ...auto, route: "setup", step: 2 })).toEqual({ view: "setup", step: 2 });
		expect(model.chooseView(DISCONNECTED, auto)).toEqual({ view: "setup", step: 4 });
		expect(model.chooseView(DISCONNECTED, model.initialUi("account"))).toEqual({ view: "setup", step: 4 });
		expect(model.chooseView({ ...DISCONNECTED, status: "error", issue: "network" }, auto)).toEqual({ view: "setup", step: 4 });
		expect(model.chooseView({ ...DISCONNECTED, issue: "client-id-changed" }, auto)).toEqual({ view: "reconnect", variant: "session" });
		expect(model.chooseView(AUTHORIZING, auto)).toEqual({ view: "waiting" });
		expect(model.chooseView({ ...AUTHORIZING, activity: "restoring" }, auto)).toEqual({ view: "restoring" });
		expect(model.chooseView(CONNECTED, auto)).toEqual({ view: "connected", variant: "compact" });
		expect(model.chooseView(CONNECTED, model.initialUi("account"))).toEqual({ view: "connected", variant: "compact" });
		expect(model.chooseView(CONNECTED, { ...auto, celebrate: true })).toEqual({ view: "connected", variant: "success" });
		expect(model.chooseView(CONNECTED, { ...auto, route: "ready" })).toEqual({ view: "ready" });
		expect(model.chooseView(CONNECTED, { ...auto, route: "experiences" })).toEqual({ view: "experiences" });
		expect(model.chooseView(CONNECTED, { ...auto, route: "experience-finish" })).toEqual({ view: "experience-finish" });
		expect(model.chooseView(DISCONNECTED, { ...auto, route: "experiences" })).toEqual({ view: "setup", step: 4 });
		expect(model.chooseView({ ...DISCONNECTED, status: "reauthorization-required" }, auto)).toEqual({ view: "reconnect", variant: "permissions" });
		expect(model.chooseView(NOT_CONFIGURED, { ...auto, route: "setup", step: 99 })).toEqual({ view: "setup", step: 4 });
	});

	it("celebrates only a sign-in that just finished, and leaves the tour or ready screen when the connection ends", async () => {
		const model = await loadModel();
		const auto = model.initialUi();
		expect(model.onStateChange(auto, AUTHORIZING, CONNECTED)).toMatchObject({ celebrate: true, route: "auto" });
		expect(model.onStateChange(auto, { ...AUTHORIZING, activity: "restoring" }, CONNECTED)).toMatchObject({ celebrate: false });
		expect(model.onStateChange(auto, undefined, CONNECTED)).toMatchObject({ celebrate: false });
		expect(model.onStateChange({ ...auto, route: "tour", celebrate: true }, CONNECTED, DISCONNECTED)).toMatchObject({ route: "auto", celebrate: false });
		expect(model.onStateChange({ ...auto, route: "ready" }, CONNECTED, DISCONNECTED)).toMatchObject({ route: "auto" });
		for (const route of ["experiences", "experience-finish"]) {
			expect(model.onStateChange({ ...auto, route }, CONNECTED, DISCONNECTED)).toMatchObject({ route: "auto" });
			expect(model.onStateChange({ ...auto, route }, CONNECTED, CONNECTED)).toMatchObject({ route });
		}
		expect(auto).toMatchObject({ experience: null });
	});
});
