import { readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as packScript from "../scripts/pack.mjs";
import { SPOTIFY_REDIRECT_URI } from "../src/spotify/config";
import { FAKE, findSecrets } from "./helpers";

// Behaviour of the Spotify Account Property Inspector's guided setup, run in a DOM against a fake Stream Deck socket. These tests check
// what the user can do and what the page sends to the plugin, not wording or pixels.
const PI = path.resolve(import.meta.dirname, "..", "com.marting.deckify.sdPlugin", "ui", "spotify-account");
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

/** Every message type the page may send to the plugin. */
const ALLOWED_REQUESTS = [
	"deckify:spotify:hello",
	"deckify:spotify:save-client-id",
	"deckify:spotify:connect",
	"deckify:spotify:retry-connect",
	"deckify:spotify:cancel-connect",
	"deckify:spotify:disconnect",
	"deckify:spotify:open-dashboard",
];

type Options = {
	/** How `navigator.clipboard.writeText` behaves; `"missing"` leaves the Clipboard API out. */
	clipboard?: "ok" | "reject" | "missing";
	/** What `document.execCommand("copy")` returns; `undefined` leaves it out. */
	execCommand?: boolean;
};

/**
 * Loads the Property Inspector into a fresh DOM connected to a fake Stream Deck socket, with controllable timers.
 * @param options Environment options.
 * @returns Helpers to drive and inspect the page.
 */
async function openInspector(options: Options = {}) {
	const html = await readFile(path.join(PI, "index.html"), "utf8");
	const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://property-inspector.invalid/ui/spotify-account/index.html" });
	const window = dom.window;
	const document = window.document;

	// Timers the test advances by hand.
	let now = 0;
	let nextId = 1;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const setTimeoutFake = (fn: () => void, ms = 0) => {
		const id = nextId++;
		timers.set(id, { at: now + ms, fn });
		return id;
	};
	const clearTimeoutFake = (id: number | undefined) => {
		if (id !== undefined) {
			timers.delete(id);
		}
	};
	Object.assign(window, { setTimeout: setTimeoutFake, clearTimeout: clearTimeoutFake });

	// Any use of browser storage is recorded.
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

	return {
		window,
		document,
		sent,
		storage,
		clipboard,
		execCommand,
		scripts,
		socket,
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
		requests: () => sent.filter((message) => message.event === "sendToPlugin").map((message) => message.payload as Record<string, unknown>),
		/** Delivers a state message from the plugin. */
		receive(state: Partial<PublicState>, extra: { clientIdError?: string | null; clientIdIssue?: string | null } = {}) {
			const payload = { type: "deckify:spotify:state", state: { ...NOT_CONFIGURED, ...state }, clientIdError: null, clientIdIssue: null, ...extra };
			socket.listeners.get("message")?.({ data: JSON.stringify({ event: "sendToPropertyInspector", payload }) });
		},
		/** Presses the only visible button for an action. */
		click(action: string, index = 0) {
			const candidates = buttons(action);
			const button = candidates[index];
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

/** Lets promise callbacks (e.g. the clipboard) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("first run", () => {
	it("opens on a branded welcome with the requirements up front", async () => {
		const pi = await openInspector();
		expect(pi.screen()).toBe("loading");
		pi.receive(NOT_CONFIGURED);

		expect(pi.screen()).toBe("welcome");
		expect(pi.heading()).toBe("Connect Deckify to Spotify");
		expect(pi.text()).toContain("Setup takes a couple of minutes. Deckify will guide you through creating the Spotify app it needs.");
		for (const requirement of ["Spotify Premium", "A Spotify Developer account", "No Client Secret required"]) {
			expect(pi.text()).toContain(requirement);
		}
		expect(pi.buttons("start-setup").map((button) => button.textContent)).toEqual(["Start setup"]);
		expect(pi.view().querySelector(".hero-mark")).not.toBeNull();
	});

	it("says hello to the plugin and nothing else until the user acts", async () => {
		const pi = await openInspector();
		pi.receive(NOT_CONFIGURED);
		expect(pi.requests()).toEqual([{ type: "deckify:spotify:hello" }]);
		expect(pi.sent[0]).toEqual({ event: "registerPropertyInspector", uuid: "pi-context" });
	});
});

describe("guided setup", () => {
	it("walks through the four steps with Next and Back, showing progress", async () => {
		const pi = await openInspector();
		pi.receive(NOT_CONFIGURED);
		pi.click("start-setup");

		const current = () => pi.document.querySelector("#stepper [aria-current='step']")?.getAttribute("data-step");
		expect(pi.screen()).toBe("setup");
		expect(pi.heading()).toBe("Open Spotify Dashboard");
		expect(pi.el("step-counter").textContent).toBe("Step 1 of 4");
		expect(current()).toBe("1");

		pi.click("step-next");
		expect(pi.heading()).toBe("Create your Spotify app");
		expect(current()).toBe("2");
		expect(pi.document.querySelector("#stepper li[data-step='1']")?.getAttribute("data-state")).toBe("done");

		pi.click("step-next");
		expect(pi.heading()).toBe("Add your Client ID");
		expect(pi.text()).toContain("Paste your Spotify Client ID");
		// Without a saved Client ID there is nothing to connect yet.
		expect(pi.buttons("step-next")[0]?.disabled).toBe(true);

		pi.click("step-back");
		expect(current()).toBe("2");
		pi.click("step-back");
		pi.click("step-back");
		expect(pi.screen()).toBe("welcome");
	});

	it("moves keyboard focus to the heading of each new step", async () => {
		const pi = await openInspector();
		pi.receive(NOT_CONFIGURED);
		pi.click("start-setup");
		expect(pi.document.activeElement?.id).toBe("setup-title");
		pi.click("step-next");
		expect(pi.document.activeElement?.id).toBe("setup-title");
		expect(pi.document.activeElement?.textContent).toBe("Create your Spotify app");
	});

	it("step 1 explains why and opens the Spotify Developer Dashboard through the plugin, without passing a URL", async () => {
		const pi = await openInspector();
		pi.receive(NOT_CONFIGURED);
		pi.click("start-setup");
		expect(pi.text()).toContain("Deckify uses your own Spotify app so no secret credential has to be shipped inside the plugin.");

		const button = pi.click("open-dashboard");
		expect(button.textContent).toBe("Open Spotify Dashboard");
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:open-dashboard" });
		// No double tabs from a double click.
		expect(button.disabled).toBe(true);
		pi.advance(1500);
		expect(button.disabled).toBe(false);
	});

	it("step 2 shows the exact Redirect URI, Web API, the localhost warning and the Development Mode note", async () => {
		const pi = await openInspector();
		pi.receive(NOT_CONFIGURED);
		pi.click("start-setup");
		pi.click("step-next");

		const text = pi.text();
		expect(text).toContain("Create an app.");
		expect(text).toMatch(/any app name and description, for example Deckify/);
		expect(text).toContain("select Web API");
		expect(text).toContain("Do not use localhost.");
		expect(text).toContain("Spotify currently requires Premium for the owner of a Development Mode app.");

		const fields = [...pi.view().querySelectorAll<HTMLInputElement>("[data-redirect-uri]")].filter(pi.shown);
		expect(fields.map((field) => field.value)).toEqual(["http://127.0.0.1:43821/callback"]);
		expect(fields[0]?.readOnly).toBe(true);
		expect(pi.buttons("copy-redirect-uri").map((button) => button.textContent)).toEqual(["Copy Redirect URI"]);
	});

	it("keeps the Development Mode limits in a collapsed section and presents them as Spotify's rules", async () => {
		const pi = await openInspector();
		pi.receive(NOT_CONFIGURED);
		pi.click("start-setup");
		pi.click("step-next");

		const details = pi.view().querySelector("details.help");
		expect(details?.querySelector("summary")?.textContent).toBe("About Spotify Development Mode");
		expect(details?.hasAttribute("open")).toBe(false);
		const help = details?.textContent.replace(/\s+/g, " ") ?? "";
		expect(help).toContain("app owner to have Spotify Premium");
		expect(help).toContain("one Development Mode Client ID");
		expect(help).toContain("up to five Spotify accounts");
		expect(help).toContain("Users Management");
		expect(help).toContain("These are Spotify's rules for Development Mode apps, not Deckify limits.");
		// No claims about Spotify approval or extended access.
		expect(pi.document.body.textContent).not.toMatch(/extended quota|approved by Spotify|endorsed|official Spotify app/i);
	});

	it("step 3 saves the Client ID through the plugin's validator and moves on to Connect", async () => {
		const pi = await openInspector();
		pi.receive(NOT_CONFIGURED);
		pi.click("start-setup");
		pi.click("step-next");
		pi.click("step-next");
		expect(pi.text()).toContain("Client ID is safe to use in installed apps. Deckify never asks for your Client Secret.");

		pi.type(` ${FAKE.clientId} `);
		pi.click("save-client-id");
		// The raw input goes to the plugin, which trims and validates it.
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:save-client-id", clientId: ` ${FAKE.clientId} ` });
		expect(pi.heading()).toBe("Add your Client ID");

		pi.receive(DISCONNECTED);
		expect(pi.heading()).toBe("Connect Spotify");
		expect(pi.text()).toContain("Your browser will open Spotify's authorization page.");
		pi.click("step-back");
		expect((pi.el("client-id") as HTMLInputElement).value).toBe(FAKE.clientId);
		expect(pi.text()).toContain("Client ID saved.");
	});

	it("saves with Enter, and asks for a Client ID instead of sending an empty one", async () => {
		const pi = await openInspector();
		pi.receive(NOT_CONFIGURED);
		pi.click("have-client-id");
		expect(pi.heading()).toBe("Add your Client ID");
		expect(pi.document.activeElement?.id).toBe("client-id");

		const input = pi.el("client-id");
		input.dispatchEvent(new pi.window.KeyboardEvent("keydown", { key: "Enter" }));
		expect(pi.requests().map((request) => request.type)).toEqual(["deckify:spotify:hello"]);
		expect(pi.text()).toContain("Paste your Client ID first.");

		pi.type(FAKE.clientId);
		input.dispatchEvent(new pi.window.KeyboardEvent("keydown", { key: "Enter" }));
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:save-client-id", clientId: FAKE.clientId });
	});

	it("explains an invalid Client ID with next steps, keeps the input, and never mentions the Client Secret there", async () => {
		const pi = await openInspector();
		pi.receive(NOT_CONFIGURED);
		pi.click("have-client-id");
		pi.type("not-a-client-id");
		pi.click("save-client-id");
		pi.receive(NOT_CONFIGURED, { clientIdError: "That does not look like a Spotify Client ID.", clientIdIssue: "invalid-client-id" });

		expect(pi.heading()).toBe("Add your Client ID");
		const card = pi.el("client-id-issue");
		expect(pi.shown(card)).toBe(true);
		expect(card.querySelector("h3")?.textContent).toContain("That Client ID doesn't look valid");
		expect(card.textContent).toContain("Open your Spotify app settings, copy the Client ID again and paste it here.");
		expect(card.textContent).not.toMatch(/secret/i);
		expect([...card.querySelectorAll("button")].map((button) => button.dataset.action)).toEqual(["open-dashboard"]);
		expect((pi.el("client-id") as HTMLInputElement).value).toBe("not-a-client-id");

		card.querySelector<HTMLButtonElement>("button")?.click();
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:open-dashboard" });
	});

	it("offers both Open Dashboard and Edit Client ID wherever an invalid Client ID is reported", async () => {
		const model = await loadModel();
		expect(model.guidanceFor("invalid-client-id").actions).toEqual(["open-dashboard", "edit-client-id"]);
	});
});

describe("connecting", () => {
	it("sends Connect once, then shows a clear waiting state without fake progress", async () => {
		const pi = await openInspector();
		pi.receive(DISCONNECTED);
		expect(pi.heading()).toBe("Connect Spotify");

		const button = pi.click("connect");
		expect(button.textContent).toBe("Connect Spotify");
		expect(button.disabled).toBe(true);
		button.click();
		expect(pi.requests().filter((request) => request.type === "deckify:spotify:connect")).toHaveLength(1);

		pi.receive(AUTHORIZING);
		expect(pi.screen()).toBe("waiting");
		expect(pi.heading()).toBe("Waiting for Spotify…");
		expect(pi.text()).toContain("Complete the authorization in your browser.");
		expect(pi.text()).not.toMatch(/\d+ ?%/);
		expect(pi.el("status-text").textContent).toBe("Connecting…");
		expect(pi.view().querySelector("progress, [role='progressbar']")).toBeNull();
	});

	it("re-enables Connect if the plugin never answers", async () => {
		const pi = await openInspector();
		pi.receive(DISCONNECTED);
		const button = pi.click("connect");
		expect(button.disabled).toBe(true);
		pi.advance(5000);
		expect(button.disabled).toBe(false);
	});

	it("offers troubleshooting when Spotify takes long, without declaring a failure or a wrong Redirect URI", async () => {
		const pi = await openInspector();
		pi.receive(AUTHORIZING);
		expect(pi.shown(pi.el("slow-help"))).toBe(false);

		pi.advance(44_999);
		expect(pi.shown(pi.el("slow-help"))).toBe(false);
		pi.advance(1);
		expect(pi.shown(pi.el("slow-help"))).toBe(true);
		expect(pi.screen()).toBe("waiting");
		expect(pi.el("status-text").textContent).toBe("Connecting…");

		const help = visibleText(pi.el("slow-help"), pi.shown);
		expect(help).toContain("Taking longer than expected?");
		expect(help).toContain("Check that your Spotify app contains exactly: http://127.0.0.1:43821/callback");
		expect(help).not.toMatch(/is wrong|mismatch|incorrect/i);
		expect(pi.el("announcer").textContent).toContain("Taking longer than expected?");

		expect(pi.buttons("copy-redirect-uri")).toHaveLength(1);
		expect(pi.buttons("open-dashboard")).toHaveLength(1);
		pi.click("retry-connect");
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:retry-connect" });
		// Retrying starts the clock again.
		expect(pi.shown(pi.el("slow-help"))).toBe(false);
	});

	it("can cancel a sign-in that is waiting for the browser", async () => {
		const pi = await openInspector();
		pi.receive(AUTHORIZING);
		pi.click("cancel-connect");
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:cancel-connect" });
	});

	it("shows a quiet check, not the browser wait, while a saved session is restored", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, status: "connecting", activity: "restoring" });
		expect(pi.screen()).toBe("restoring");
		expect(pi.el("status-text").textContent).toBe("Checking…");
		pi.advance(60_000);
		expect(pi.shown(pi.el("slow-help"))).toBe(false);
	});
});

describe("issue guidance", () => {
	it("cancelled authorization: no changes were made, try again", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, issue: "authorization-denied", message: "Spotify access was not granted." });

		expect(pi.heading()).toBe("Connect Spotify");
		const card = pi.el("connect-issue");
		expect(card.querySelector("h3")?.textContent).toContain("Spotify connection cancelled");
		expect(card.textContent).toContain("No changes were made. You can try again when you're ready.");
		const tryAgain = card.querySelector<HTMLButtonElement>("button[data-action='connect']");
		expect(tryAgain?.textContent).toBe("Try again");
		// One Connect button, in the card.
		expect(pi.buttons("connect")).toHaveLength(1);
		tryAgain?.click();
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:connect" });
	});

	it("timeout: suggests checking the exact Redirect URI and 127.0.0.1 without claiming it is wrong", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, status: "error", issue: "authorization-timeout", message: "Spotify sign-in timed out." });

		const card = pi.el("connect-issue");
		const text = visibleText(card, pi.shown);
		expect(text).toContain("Deckify didn't hear back from Spotify");
		expect(text).toContain("127.0.0.1, not localhost");
		expect(text).toContain("http://127.0.0.1:43821/callback");
		expect(text).not.toMatch(/is wrong|mismatch|incorrect/i);
		expect([...card.querySelectorAll("button")].map((button) => button.dataset.action)).toEqual(["copy-redirect-uri", "connect", "open-dashboard"]);
	});

	it("access refused: points to Users Management as a possible fix, not a diagnosis", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, status: "error", issue: "spotify-access-refused", message: "Spotify refused access (HTTP 403)." });

		const text = visibleText(pi.el("connect-issue"), pi.shown);
		expect(text).toContain("Spotify didn't allow this account to use the app");
		expect(text).toContain("If you're signing in with a Spotify account different from the app owner, check the app's Users Management");
		expect(text).toContain("possible fix, not a confirmed cause");
		expect(text).toMatch(/Development Mode/);
		expect(text).not.toMatch(/you are not registered|you must add|is not allowlisted/i);
		expect(pi.el("connect-issue").querySelector("button")?.dataset.action).toBe("open-dashboard");
	});

	it("never suggests Users Management for other errors", async () => {
		const model = await loadModel();
		for (const [issue, guidance] of Object.entries(model.ISSUES)) {
			const text = JSON.stringify(guidance);
			expect(text.includes("Users Management"), issue).toBe(issue === "spotify-access-refused");
		}
	});

	it("unclassified errors still say what to try next, and show the plugin's message only as a detail", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, status: "error", issue: "unknown", message: "Spotify returned an unexpected response." });
		const text = visibleText(pi.el("connect-issue"), pi.shown);
		expect(text).toContain("Something went wrong");
		expect(text).toContain("Try again.");
		expect(text).toContain("Details: Spotify returned an unexpected response.");
	});

	it("treats an issue code it doesn't know as unclassified", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, status: "error", issue: "something-new", message: "Boom." });
		expect(visibleText(pi.el("connect-issue"), pi.shown)).toContain("Something went wrong");
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
			// A button, or an instruction in the text itself.
			expect(guidance.actions.length > 0 || /try|connect again|check/i.test(guidance.body), code).toBe(true);
		}
	});
});

describe("copy Redirect URI", () => {
	it("copies exactly the Redirect URI and confirms it", async () => {
		const pi = await openInspector({ clipboard: "ok" });
		pi.receive(NOT_CONFIGURED);
		pi.click("start-setup");
		pi.click("step-next");

		const button = pi.click("copy-redirect-uri");
		await settle();
		expect(pi.clipboard.writeText).toHaveBeenCalledWith("http://127.0.0.1:43821/callback");
		expect(button.textContent).toBe("Copied");
		expect(pi.el("announcer").textContent).toBe("Redirect URI copied.");

		pi.advance(2000);
		expect(button.textContent).toBe("Copy Redirect URI");
	});

	it("falls back to the copy command when the Clipboard API is refused", async () => {
		const pi = await openInspector({ clipboard: "reject", execCommand: true });
		pi.receive(NOT_CONFIGURED);
		pi.click("start-setup");
		pi.click("step-next");

		const button = pi.click("copy-redirect-uri");
		await settle();
		expect(pi.execCommand).toHaveBeenCalledWith("copy");
		expect(button.textContent).toBe("Copied");
	});

	it("selects the Redirect URI for Ctrl+C when copying isn't available", async () => {
		const pi = await openInspector({ clipboard: "missing", execCommand: false });
		pi.receive(NOT_CONFIGURED);
		pi.click("start-setup");
		pi.click("step-next");

		const button = pi.click("copy-redirect-uri");
		await settle();
		const field = button.closest(".copy-row")?.querySelector("input") as HTMLInputElement;
		expect(pi.document.activeElement).toBe(field);
		expect(field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)).toBe("http://127.0.0.1:43821/callback");
		expect(button.textContent).toBe("Press Ctrl+C");
		expect(pi.el("announcer").textContent).toContain("Press Ctrl+C");
	});
});

describe("connected", () => {
	it("celebrates a new connection with the account, Premium and status, and offers the tour", async () => {
		const pi = await openInspector();
		pi.receive(DISCONNECTED);
		pi.click("connect");
		pi.receive(AUTHORIZING);
		pi.receive(CONNECTED);

		expect(pi.screen()).toBe("connected");
		expect(pi.heading()).toContain("You're connected");
		expect(pi.el("account-name").textContent).toBe("Test Listener");
		expect(pi.el("account-premium").textContent).toBe("Yes");
		expect(pi.el("account-status").textContent).toBe("Connected");
		expect(pi.el("status-text").textContent).toBe("Connected");
		expect(pi.buttons("tour-start").map((button) => button.textContent)).toEqual(["Show me around"]);
		expect(pi.buttons("disconnect")).toHaveLength(1);
		expect(pi.document.activeElement?.id).toBe("connected-title");

		// The tour is optional.
		pi.click("dismiss-success");
		expect(pi.heading()).toBe("Connected to Spotify");
	});

	it("shows the compact connected state, not setup, when reopened while connected", async () => {
		const pi = await openInspector();
		pi.receive(CONNECTED);
		expect(pi.screen()).toBe("connected");
		expect(pi.heading()).toBe("Connected to Spotify");
		expect(pi.shown(pi.el("success-text"))).toBe(false);
		expect(pi.shown(pi.el("stepper"))).toBe(false);
		// Setup help stays reachable.
		expect(pi.view().querySelector("details.help summary")?.textContent).toBe("Account setup help");
		pi.click("edit-client-id");
		expect(pi.heading()).toBe("Add your Client ID");
		expect(pi.text()).toContain("Saving a different Client ID signs Deckify out");
		pi.click("step-back");
		pi.click("step-back");
		pi.click("step-back");
		expect(pi.screen()).toBe("connected");
	});

	it("explains what a non-Premium account can't do", async () => {
		const pi = await openInspector();
		pi.receive({ ...CONNECTED, product: "free" });
		expect(pi.el("account-premium").textContent).toBe("No (Spotify Free)");
		expect(pi.shown(pi.el("premium-note"))).toBe(true);
		expect(pi.el("premium-note").textContent).toContain("Spotify only allows playback control for Premium accounts.");
		// Account Premium is not confused with the Development Mode owner rule.
		expect(pi.el("premium-note").textContent).not.toMatch(/Development Mode/);
	});

	it("does not invent a plan Spotify didn't report", async () => {
		const pi = await openInspector();
		pi.receive({ ...CONNECTED, product: null });
		expect(pi.el("account-premium").textContent).toBe("Not reported by Spotify");
		expect(pi.shown(pi.el("premium-note"))).toBe(false);
	});

	it("warns when the session couldn't be saved", async () => {
		const pi = await openInspector();
		pi.receive({ ...CONNECTED, issue: "session-not-saved", message: "Connected, but..." });
		expect(visibleText(pi.el("connected-issue"), pi.shown)).toContain("connect again after Stream Deck restarts");
	});

	it("still disconnects", async () => {
		const pi = await openInspector();
		pi.receive(CONNECTED);
		pi.click("disconnect");
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:disconnect" });
		pi.receive(DISCONNECTED);
		expect(pi.heading()).toBe("Connect Spotify");
	});
});

describe("tour", () => {
	it("pages through Now Playing, Like, Playlists and Volume, then returns to the account", async () => {
		const pi = await openInspector();
		pi.receive(AUTHORIZING);
		pi.receive(CONNECTED);
		pi.click("tour-start");

		const page = () => ({ title: pi.heading(), counter: pi.el("tour-counter").textContent, body: pi.el("tour-body").textContent });
		expect(pi.screen()).toBe("tour");
		expect(page()).toMatchObject({ title: "Now Playing", counter: "1 of 4" });
		expect(page().body).toContain("Press it to open the song on Spotify.");
		expect(pi.buttons("tour-prev")[0]?.disabled).toBe(true);
		expect(pi.buttons("tour-done")).toHaveLength(0);

		pi.click("tour-next");
		expect(page()).toMatchObject({ title: "Like", counter: "2 of 4", body: "Save or remove the current song from your Spotify library." });
		pi.click("tour-next");
		expect(page()).toMatchObject({ title: "Playlists", body: "Add the current song without duplicates, or launch a playlist from a key." });
		pi.click("tour-prev");
		expect(page().title).toBe("Like");
		pi.click("tour-next");
		pi.click("tour-next");
		expect(page()).toMatchObject({ title: "Volume", counter: "4 of 4", body: "Control Spotify's own device volume, not the Windows mixer." });
		expect(pi.buttons("tour-next")).toHaveLength(0);

		pi.click("tour-done");
		expect(pi.screen()).toBe("connected");
		expect(pi.heading()).toBe("Connected to Spotify");
		// The tour is purely local: it never asked the plugin for anything.
		expect(pi.requests().map((request) => request.type)).toEqual(["deckify:spotify:hello"]);
	});

	it("uses Deckify's own action icons, which the package ships", async () => {
		const model = await loadModel();
		const required = pack.requiredFiles();
		const manifest = JSON.parse(await readFile(path.join(PI, "..", "..", "manifest.json"), "utf8")) as { Actions: { Icon: string }[] };
		const icons = new Set(manifest.Actions.map((action) => `${action.Icon}.svg`));
		for (const page of model.TOUR) {
			const file = path.posix.join("ui/spotify-account", page.icon);
			expect(icons.has(file) || required.includes(file), file).toBe(true);
		}
	});
});

describe("reconnect", () => {
	it("asks for updated permissions in a compact screen instead of the first-run wizard", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, status: "reauthorization-required", issue: "reauthorization-required", message: "Deckify needs additional Spotify permissions." });

		expect(pi.screen()).toBe("reconnect");
		expect(pi.heading()).toBe("Deckify needs updated Spotify permissions");
		expect(pi.text()).toContain("Deckify added features that need additional Spotify permissions.");
		expect(pi.shown(pi.el("stepper"))).toBe(false);
		expect(pi.view().querySelector("details summary")?.textContent).toBe("Why?");
		expect(pi.view().querySelector("details")?.textContent).toContain("Your Client ID stays saved");

		const button = pi.click("connect");
		expect(button.textContent).toBe("Reconnect Spotify");
		expect(pi.requests().at(-1)).toEqual({ type: "deckify:spotify:connect" });
	});

	it("explains a failed reconnect without leaving the reconnect screen", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, status: "reauthorization-required", issue: "authorization-denied" });
		expect(pi.screen()).toBe("reconnect");
		expect(visibleText(pi.el("reconnect-issue"), pi.shown)).toContain("Spotify connection cancelled");
		expect(pi.buttons("connect")).toHaveLength(1);
	});

	it("asks an expired session to sign in again, also without the wizard", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, issue: "session-expired" });
		expect(pi.screen()).toBe("reconnect");
		expect(pi.heading()).toBe("Sign in to Spotify again");
		expect(pi.click("connect").textContent).toBe("Sign in again");
		expect(pi.shown(pi.el("reconnect-why"))).toBe(false);
	});
});

describe("security and privacy of the page", () => {
	it("never asks for a Client Secret", async () => {
		const pi = await openInspector();
		pi.receive(NOT_CONFIGURED);
		const inputs = [...pi.document.querySelectorAll("input, textarea, select")];
		expect(inputs.map((input) => input.id || input.getAttribute("aria-label")).sort()).toEqual(["Redirect URI", "Redirect URI", "Redirect URI", "client-id"]);
		for (const input of inputs) {
			expect(input.outerHTML).not.toMatch(/secret|password/i);
		}
		// "Client Secret" only ever appears to say it isn't needed.
		const sentences = pi.document.body.textContent.split(/(?<=[.!?])\s+|\n/).filter((sentence) => /client secret/i.test(sentence));
		expect(sentences.length).toBeGreaterThanOrEqual(2);
		for (const sentence of sentences) {
			expect(sentence).toMatch(/\bnever\b|\bNo Client Secret\b/);
		}
	});

	it("never shows localhost as the Redirect URI", async () => {
		const pi = await openInspector();
		pi.receive(DISCONNECTED);
		expect(pi.document.body.innerHTML).not.toMatch(/\/\/localhost/i);
		for (const field of pi.document.querySelectorAll<HTMLInputElement>("[data-redirect-uri]")) {
			expect(field.value).toBe("http://127.0.0.1:43821/callback");
		}
		// Every mention of localhost is a warning against it.
		const mentions = pi.document.body.textContent.split(/(?<=[.!?])\s+/).filter((sentence) => /localhost/i.test(sentence));
		for (const mention of mentions) {
			expect(mention).toMatch(/not localhost|Do not use localhost/);
		}
	});

	it("sends only known requests, without tokens, URLs or secrets, and uses no browser storage", async () => {
		const pi = await openInspector({ clipboard: "ok" });
		pi.receive(NOT_CONFIGURED);
		pi.click("start-setup");
		pi.click("open-dashboard");
		pi.click("step-next");
		pi.click("copy-redirect-uri");
		await settle();
		pi.click("step-next");
		pi.type(FAKE.clientId);
		pi.click("save-client-id");
		pi.receive(DISCONNECTED);
		pi.click("connect");
		pi.receive(AUTHORIZING);
		pi.advance(45_000);
		pi.click("retry-connect");
		pi.receive(AUTHORIZING);
		pi.receive(CONNECTED);
		pi.click("tour-start");
		pi.click("tour-next");
		pi.click("tour-next");
		pi.click("tour-next");
		pi.click("tour-done");
		pi.click("disconnect");

		const requests = pi.requests();
		expect(requests.map((request) => request.type)).toEqual([
			"deckify:spotify:hello",
			"deckify:spotify:open-dashboard",
			"deckify:spotify:save-client-id",
			"deckify:spotify:connect",
			"deckify:spotify:retry-connect",
			"deckify:spotify:disconnect",
		]);
		for (const request of requests) {
			expect(ALLOWED_REQUESTS).toContain(request.type);
			expect(Object.keys(request).filter((key) => key !== "type" && !(request.type === "deckify:spotify:save-client-id" && key === "clientId"))).toEqual([]);
		}
		const wire = JSON.stringify(pi.sent);
		expect(findSecrets(wire)).toEqual([]);
		expect(wire).not.toMatch(/https?:\/\/|token|secret|verifier/i);
		expect(pi.storage).toEqual([]);
	});

	it("loads only its own local scripts and styles", async () => {
		const pi = await openInspector();
		expect(pi.scripts).toEqual(["onboarding.js", "inspector.js"]);
		const links = [...pi.document.querySelectorAll("link[href], script[src], img[src]")].map((node) => node.getAttribute("href") ?? node.getAttribute("src") ?? "");
		for (const link of links) {
			expect(link, link).not.toMatch(/^[a-z]+:|^\/\//i);
		}
	});
});

describe("accessibility", () => {
	it("has one page title, a heading per screen, and a polite status", async () => {
		const pi = await openInspector();
		expect(pi.document.querySelectorAll("h1")).toHaveLength(1);
		for (const view of pi.document.querySelectorAll("[data-view]")) {
			expect(view.querySelectorAll("h2"), view.getAttribute("data-view") ?? "").toHaveLength(1);
			expect(view.getAttribute("aria-labelledby")).toBe(view.querySelector("h2")?.id);
		}
		expect(pi.el("status").getAttribute("role")).toBe("status");
		expect(pi.el("announcer").getAttribute("aria-live")).toBe("polite");
	});

	it("writes every status out in words", async () => {
		const pi = await openInspector();
		const labels: string[] = [];
		for (const status of ["not-configured", "disconnected", "connecting", "connected", "reauthorization-required", "error"]) {
			pi.receive({ ...DISCONNECTED, status });
			labels.push(pi.el("status-text").textContent);
		}
		expect(labels).toEqual(["Not set up", "Not connected", "Connecting…", "Connected", "Reconnect needed", "Needs attention"]);
	});

	it("announces errors and keeps buttons keyboard-reachable", async () => {
		const pi = await openInspector();
		pi.receive({ ...DISCONNECTED, status: "error", issue: "unknown" });
		expect(pi.el("connect-issue").getAttribute("role")).toBe("alert");
		for (const button of pi.document.querySelectorAll("button")) {
			expect(button.getAttribute("type")).toBe("button");
			expect(button.getAttribute("tabindex")).not.toBe("-1");
		}
	});

	it("shows keyboard focus and respects reduced motion", async () => {
		const css = await readFile(path.join(PI, "onboarding.css"), "utf8");
		expect(css).toMatch(/:focus-visible \{[^}]*outline: 2px solid/);
		expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation: none !important/);
		// Deckify violet, not Spotify green.
		expect(`${css}${await readFile(path.join(PI, "index.html"), "utf8")}`).not.toMatch(/#1db954|#1ed760/i);
	});
});

describe("package", () => {
	it("ships every file the Spotify Account Property Inspector loads", async () => {
		const html = await readFile(path.join(PI, "index.html"), "utf8");
		const local = [...html.matchAll(/<(?:link|script)[^>]*(?:href|src)="([^"]+)"/g)].map((match) => path.posix.join("ui/spotify-account", match[1] ?? ""));
		expect(local).toEqual(["ui/shared/inspector.css", "ui/spotify-account/onboarding.css", "ui/spotify-account/onboarding.js", "ui/spotify-account/inspector.js"]);
		expect(pack.requiredFiles()).toEqual(expect.arrayContaining(local));
	});

	it("rejects a package without the onboarding files", async () => {
		const manifest = JSON.parse(await readFile(path.join(PI, "..", "..", "manifest.json"), "utf8")) as Record<string, unknown>;
		const entries = ["bin/plugin.js", "manifest.json", "ui/spotify-account/index.html"].map((file) => `com.marting.deckify.sdPlugin/${file}`);
		const problems = pack.verifyPackageEntries(entries, manifest, false).join("\n");
		expect(problems).toContain("ui/spotify-account/onboarding.js");
		expect(problems).toContain("ui/spotify-account/onboarding.css");
	});
});

type Guidance = { tone: string; title: string; body: string; tips?: string[]; actions: string[] };
type Model = {
	ISSUES: Record<string, Guidance>;
	TOUR: { id: string; title: string; body: string; icon: string }[];
	guidanceFor: (issue: string) => Guidance;
	chooseView: (state: PublicState | undefined, ui: Record<string, unknown>) => { view: string; step?: number; variant?: string };
	initialUi: () => Record<string, unknown>;
	onStateChange: (ui: Record<string, unknown>, previous: PublicState | undefined, next: PublicState) => Record<string, unknown>;
};

/**
 * Loads onboarding.js on its own.
 * @returns Its exports.
 */
async function loadModel(): Promise<Model> {
	const dom = new JSDOM("", { runScripts: "outside-only" });
	dom.window.eval(await readFile(path.join(PI, "onboarding.js"), "utf8"));
	return (dom.window as unknown as { DeckifyOnboarding: Model }).DeckifyOnboarding;
}

describe("onboarding model", () => {
	it("chooses screens from the plugin's state", async () => {
		const model = await loadModel();
		const auto = model.initialUi();
		expect(model.chooseView(undefined, auto)).toEqual({ view: "loading" });
		expect(model.chooseView(NOT_CONFIGURED, auto)).toEqual({ view: "welcome" });
		expect(model.chooseView(NOT_CONFIGURED, { ...auto, route: "setup", step: 2 })).toEqual({ view: "setup", step: 2 });
		expect(model.chooseView(DISCONNECTED, auto)).toEqual({ view: "setup", step: 4 });
		expect(model.chooseView({ ...DISCONNECTED, status: "error", issue: "network" }, auto)).toEqual({ view: "setup", step: 4 });
		expect(model.chooseView({ ...DISCONNECTED, issue: "client-id-changed" }, auto)).toEqual({ view: "reconnect", variant: "session" });
		expect(model.chooseView(AUTHORIZING, auto)).toEqual({ view: "waiting" });
		expect(model.chooseView({ ...AUTHORIZING, activity: "restoring" }, auto)).toEqual({ view: "restoring" });
		expect(model.chooseView(CONNECTED, auto)).toEqual({ view: "connected", variant: "compact" });
		expect(model.chooseView(CONNECTED, { ...auto, celebrate: true })).toEqual({ view: "connected", variant: "success" });
		expect(model.chooseView({ ...DISCONNECTED, status: "reauthorization-required" }, auto)).toEqual({ view: "reconnect", variant: "permissions" });
		expect(model.chooseView(NOT_CONFIGURED, { ...auto, route: "setup", step: 99 })).toEqual({ view: "setup", step: 4 });
	});

	it("celebrates only a sign-in that just finished, and leaves the tour when the connection ends", async () => {
		const model = await loadModel();
		const auto = model.initialUi();
		expect(model.onStateChange(auto, AUTHORIZING, CONNECTED)).toMatchObject({ celebrate: true, route: "auto" });
		expect(model.onStateChange(auto, { ...AUTHORIZING, activity: "restoring" }, CONNECTED)).toMatchObject({ celebrate: false });
		expect(model.onStateChange(auto, undefined, CONNECTED)).toMatchObject({ celebrate: false });
		expect(model.onStateChange({ ...auto, route: "tour", celebrate: true }, CONNECTED, DISCONNECTED)).toMatchObject({ route: "auto", celebrate: false });
	});
});

describe("Deckify branding", () => {
	it("draws the approved B1 mark in Deckify violet", async () => {
		const html = await readFile(path.join(PI, "index.html"), "utf8");
		const master = await readFile(path.resolve(import.meta.dirname, "..", "assets", "brand", "deckify-symbol.svg"), "utf8");
		const frame = /<path [^>]*d="([^"]+)"/.exec(master)?.[1] ?? "";
		expect(frame).not.toBe("");
		// The header mark and the welcome mark.
		expect(html.split(`d="${frame}"`)).toHaveLength(3);
		const css = await readFile(path.join(PI, "onboarding.css"), "utf8");
		expect(css).toMatch(/\.brand-mark \{[^}]*color: var\(--accent\)/);
		const shared = await readFile(path.join(PI, "..", "shared", "inspector.css"), "utf8");
		expect(shared).toMatch(/--accent: #7c5cff/i);
	});
});
