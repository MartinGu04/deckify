import { readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as packScript from "../scripts/pack.mjs";
import { SPOTIFY_REDIRECT_URI } from "../src/spotify/config";
import { FAKE, findSecrets } from "./helpers";

// The Spotify Account Property Inspector after the Phase 8 pivot: a compact entry point to Deckify Setup, run in a DOM against a fake
// Stream Deck socket. The guided setup itself is tested in setup-app.test.ts.
const PI = path.resolve(import.meta.dirname, "..", "com.marting.deckify.sdPlugin", "ui", "spotify-account");
const pack = packScript as { requiredFiles: () => string[] };

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
const CONNECTED: PublicState = { ...DISCONNECTED, status: "connected", displayName: "Test Listener", product: "premium", authorizedAt: 1 };

/** Every message type the page may send to the plugin. */
const ALLOWED_REQUESTS = [
	"deckify:spotify:hello",
	"deckify:spotify:open-setup",
	"deckify:spotify:connect",
	"deckify:spotify:cancel-connect",
	"deckify:spotify:disconnect",
	"deckify:spotify:open-dashboard",
];

/**
 * Loads the Property Inspector into a fresh DOM connected to a fake Stream Deck socket.
 * @param options Options.
 * @param options.clipboard Whether the Clipboard API works.
 * @returns Helpers to drive and inspect the page.
 */
async function openInspector(options: { clipboard?: boolean } = {}) {
	const html = await readFile(path.join(PI, "index.html"), "utf8");
	const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://property-inspector.invalid/ui/spotify-account/index.html" });
	const window = dom.window;
	const document = window.document;

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
	const clipboard = { writeText: vi.fn((_text: string) => Promise.resolve()) };
	if (options.clipboard !== false) {
		Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: clipboard });
	}

	const sent: Record<string, unknown>[] = [];
	const sockets: { listeners: Map<string, (event: { data: string }) => void> }[] = [];
	class FakeWebSocket {
		static readonly OPEN = 1;
		readonly readyState = 1;
		readonly listeners = new Map<string, (event: { data: string }) => void>();
		constructor(readonly url: string) {
			sockets.push(this);
		}
		addEventListener(event: string, listener: (event: { data: string }) => void) {
			this.listeners.set(event, listener);
		}
		send(data: string) {
			sent.push(JSON.parse(data) as Record<string, unknown>);
		}
	}
	Object.assign(window, { WebSocket: FakeWebSocket });

	const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((match) => match[1] ?? "");
	for (const script of scripts) {
		window.eval(await readFile(path.join(PI, script), "utf8"));
	}
	(window as unknown as { connectElgatoStreamDeckSocket: (...args: string[]) => void }).connectElgatoStreamDeckSocket(
		"1234",
		"pi-context",
		"registerPropertyInspector",
		"{}",
		JSON.stringify({ action: "com.marting.deckify.spotify.account" }),
	);
	const socket = sockets[0];
	if (!socket) {
		throw new Error("The Property Inspector did not connect.");
	}
	socket.listeners.get("open")?.({ data: "" });

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
	const text = (root: Element) => {
		const parts: string[] = [];
		const walk = (node: Node) => {
			if (node.nodeType === 3) {
				parts.push(node.textContent ?? "");
			} else if (node.nodeType === 1 && shown(node as Element)) {
				node.childNodes.forEach(walk);
			}
		};
		walk(root);
		return parts.join(" ").replace(/\s+/g, " ").trim();
	};

	return {
		window,
		document,
		sent,
		storage,
		clipboard,
		el,
		shown,
		buttons,
		view,
		screen: () => view().dataset.view,
		heading: () => view().querySelector("h2")?.textContent.trim(),
		text: () => text(view()),
		requests: () => sent.filter((message) => message.event === "sendToPlugin").map((message) => message.payload as Record<string, unknown>),
		receive(state: Partial<PublicState>) {
			const payload = { type: "deckify:spotify:state", state: { ...NOT_CONFIGURED, ...state }, clientIdError: null, clientIdIssue: null };
			socket.listeners.get("message")?.({ data: JSON.stringify({ event: "sendToPropertyInspector", payload }) });
		},
		click(action: string, index = 0) {
			const button = buttons(action)[index];
			if (!button) {
				throw new Error(`No visible "${action}" button on the ${String(view().dataset.view)} screen.`);
			}
			button.click();
			return button;
		},
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
	};
}

describe("compact Spotify Account Property Inspector", () => {
	it("is no longer a wizard: no steps, no Client ID field, no tour", async () => {
		const html = await readFile(path.join(PI, "index.html"), "utf8");
		expect(html).not.toMatch(/id="stepper"|id="client-id"|data-view="tour"|data-view="setup"|data-view="welcome"|Show me around|step-next/);
		const pi = await openInspector();
		pi.receive(NOT_CONFIGURED);
		expect(pi.document.querySelectorAll("input:not([readonly])")).toHaveLength(0);
		expect(pi.document.querySelectorAll("[data-view]").length).toBeLessThanOrEqual(6);
	});

	it("not connected: says so and offers Set up Deckify, which opens Deckify Setup through the plugin", async () => {
		const pi = await openInspector();
		pi.receive(NOT_CONFIGURED);
		expect(pi.screen()).toBe("disconnected");
		expect(pi.el("status-text").textContent).toBe("Not connected");
		expect(pi.heading()).toBe("Not connected");
		expect(pi.text()).toContain("Connect Deckify to Spotify to get started.");

		const [setup] = pi.buttons("open-setup");
		expect(setup?.textContent).toBe("Set up Deckify");
		expect(setup?.classList.contains("primary")).toBe(true);
		setup?.click();
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:open-setup", entry: "start" });
		// No second browser tab from a double click.
		expect(setup?.disabled).toBe(true);
		setup?.click();
		expect(pi.requests().filter((request) => request.type === "deckify:spotify:open-setup")).toHaveLength(1);
		pi.advance(5000);
		expect(setup?.disabled).toBe(false);
	});

	it("not connected: 'Already set up?' opens Deckify Setup at the account part", async () => {
		const pi = await openInspector();
		pi.receive(DISCONNECTED);
		const button = pi.click("open-account-setup");
		expect(button.textContent).toBe("Already set up? Open account setup");
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:open-setup", entry: "account" });
	});

	it("names a problem in one line and leaves the guidance to Deckify Setup", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, status: "error", issue: "authorization-timeout" });
		expect(pi.el("status-text").textContent).toBe("Not connected");
		expect(pi.shown(pi.el("problem"))).toBe(true);
		expect(pi.el("problem-title").textContent).toBe("Deckify didn't hear back from Spotify");
		expect(pi.text()).toContain("Deckify Setup explains what to try next.");
		expect(pi.buttons("open-setup")).toHaveLength(1);
	});

	it("while signing in: waits, and can cancel or open Deckify Setup", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, status: "connecting", activity: "authorizing" });
		expect(pi.screen()).toBe("waiting");
		expect(pi.el("status-text").textContent).toBe("Connecting…");
		pi.click("cancel-connect");
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:cancel-connect" });

		pi.receive({ ...DISCONNECTED, status: "connecting", activity: "restoring" });
		expect(pi.screen()).toBe("restoring");
		expect(pi.el("status-text").textContent).toBe("Checking…");
	});

	it("connected: shows the account summary, Open Deckify Setup, compact help and Disconnect", async () => {
		const pi = await openInspector();
		pi.receive(CONNECTED);
		expect(pi.screen()).toBe("connected");
		expect(pi.heading()).toBe("✓ Connected");
		expect(pi.el("status-text").textContent).toBe("Connected");
		expect(pi.el("account-name").textContent).toBe("Test Listener");
		expect(pi.el("account-premium").textContent).toBe("Yes");
		expect(pi.el("account-status").textContent).toBe("Connected");
		expect(pi.buttons("open-setup").map((button) => button.textContent)).toEqual(["Open Deckify Setup"]);

		const help = pi.view().querySelector("details.help");
		expect(help?.querySelector("summary")?.textContent).toBe("Account and setup help");
		expect(help?.hasAttribute("open")).toBe(false);
		expect(pi.el("saved-client-id").textContent).toBe(FAKE.clientId);
		expect(help?.querySelector<HTMLInputElement>("[data-redirect-uri]")?.value).toBe("http://127.0.0.1:43821/callback");

		pi.click("open-account-setup");
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:open-setup", entry: "account" });
		pi.advance(5000);
		pi.click("open-dashboard");
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:open-dashboard" });
		pi.advance(5000);
		pi.click("disconnect");
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:disconnect" });
		pi.receive(DISCONNECTED);
		expect(pi.screen()).toBe("disconnected");
	});

	it("connected without Premium: says what that means", async () => {
		const pi = await openInspector();
		pi.receive({ ...CONNECTED, product: "free" });
		expect(pi.el("account-premium").textContent).toBe("No (Spotify Free)");
		expect(pi.shown(pi.el("premium-note"))).toBe(true);
	});

	it("copies the Redirect URI with feedback", async () => {
		const pi = await openInspector();
		pi.receive(CONNECTED);
		const button = pi.click("copy-redirect-uri");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(pi.clipboard.writeText).toHaveBeenCalledWith("http://127.0.0.1:43821/callback");
		expect(button.textContent).toBe("Copied");
		pi.advance(2000);
		expect(button.textContent).toBe("Copy");
	});

	it("reconnect required: a compact screen with Reconnect Spotify and Open Deckify Setup, not the wizard", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, status: "reauthorization-required", issue: "reauthorization-required" });
		expect(pi.screen()).toBe("reconnect");
		expect(pi.heading()).toBe("Deckify needs updated Spotify permissions");
		expect(pi.el("status-text").textContent).toBe("Reconnect needed");
		const [reconnect] = pi.buttons("connect");
		expect(reconnect?.textContent).toBe("Reconnect Spotify");
		expect(reconnect?.classList.contains("primary")).toBe(true);
		expect(pi.buttons("open-setup").map((button) => button.textContent)).toEqual(["Open Deckify Setup"]);
		reconnect?.click();
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:connect" });
	});

	it("an expired session asks to sign in again, keeping the Client ID", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, issue: "session-expired" });
		expect(pi.screen()).toBe("reconnect");
		expect(pi.heading()).toBe("Sign in to Spotify again");
		expect(pi.click("connect").textContent).toBe("Sign in again");
	});

	it("sends only known requests, without URLs, tokens or secrets, and uses no browser storage", async () => {
		const pi = await openInspector();
		pi.receive(NOT_CONFIGURED);
		pi.click("open-setup");
		pi.advance(5000);
		pi.receive(CONNECTED);
		pi.click("open-dashboard");
		pi.advance(5000);
		pi.click("disconnect");

		for (const request of pi.requests()) {
			expect(ALLOWED_REQUESTS).toContain(request.type);
			expect(Object.keys(request).filter((key) => key !== "type" && !(request.type === "deckify:spotify:open-setup" && key === "entry"))).toEqual([]);
		}
		const wire = JSON.stringify(pi.sent);
		expect(findSecrets(wire)).toEqual([]);
		expect(wire).not.toMatch(/https?:\/\/|token|secret|verifier/i);
		expect(pi.storage).toEqual([]);
	});

	it("has one title, a heading per screen, a polite status and keyboard-reachable buttons", async () => {
		const pi = await openInspector();
		expect(pi.document.querySelectorAll("h1")).toHaveLength(1);
		for (const view of pi.document.querySelectorAll("[data-view]")) {
			expect(view.querySelectorAll("h2"), view.getAttribute("data-view") ?? "").toHaveLength(1);
		}
		expect(pi.el("status").getAttribute("role")).toBe("status");
		for (const button of pi.document.querySelectorAll("button")) {
			expect(button.getAttribute("type")).toBe("button");
		}
		const css = await readFile(path.join(PI, "account.css"), "utf8");
		expect(css).toMatch(/:focus-visible \{[^}]*outline: 2px solid/);
		expect(css).toMatch(/prefers-reduced-motion: reduce/);
	});

	it("loads only local files the package ships", async () => {
		const html = await readFile(path.join(PI, "index.html"), "utf8");
		const local = [...html.matchAll(/<(?:link|script)[^>]*(?:href|src)="([^"]+)"/g)].map((match) => path.posix.join("ui/spotify-account", match[1] ?? ""));
		expect(local).toEqual(["ui/shared/inspector.css", "ui/spotify-account/account.css", "ui/shared/onboarding.js", "ui/spotify-account/inspector.js"]);
		expect(pack.requiredFiles()).toEqual(expect.arrayContaining(local));
	});
});
