import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as packScript from "../scripts/pack.mjs";

const pack = packScript as {
	SPOTIFY_LOGO: string;
	manifestFiles: (manifest: Record<string, unknown>) => string[];
	requiredFiles: () => string[];
	verifyPackageEntries: (entries: string[], manifest: Record<string, unknown>, withNative: boolean) => string[];
};
const { SPOTIFY_LOGO, manifestFiles, requiredFiles, verifyPackageEntries } = pack;

const PLUGIN = path.resolve(import.meta.dirname, "..", "com.marting.deckify.sdPlugin");
const PICKER = path.join(PLUGIN, "ui", "playlist");

/**
 * SHA-256 of Spotify_Full_Logo_RGB_White.png exactly as Spotify publishes it (Spotify newsroom logo and brand assets,
 * https://storage.googleapis.com/pr-newsroom-wp/1/2023/05/Spotify_Full_Logo_RGB_White.png). The file must stay byte-for-byte unmodified.
 */
const OFFICIAL_LOGO_SHA256 = "14a6a4faf018cf8b2f46a35a272db84b3d6b61a094707f225eb0106ea90ef979";

type Playlist = {
	id: string;
	uri: string;
	name: string;
	owner: string | null;
	mine: boolean;
	collaborative: boolean;
	public: boolean | null;
	itemCount: number | null;
};

type State = {
	type: "deckify:playlist:state";
	requestId: string | null;
	mode: "add" | "play";
	status: string;
	retryAfterSeconds: number | null;
	message: string | null;
	playlists: Playlist[];
	selected: { id: string; name: string; owner: string | null; state: string; canOpen: boolean } | null;
};

const id = (n: number) => `P${String(n)}`.padEnd(22, "q");

function playlist(n: number, name = `Playlist ${String(n)}`): Playlist {
	return { id: id(n), uri: `spotify:playlist:${id(n)}`, name, owner: "You", mine: true, collaborative: false, public: true, itemCount: n };
}

function playlists(count: number, name?: (n: number) => string): Playlist[] {
	return Array.from({ length: count }, (_, i) => playlist(i + 1, name?.(i + 1)));
}

/** Just enough of the DOM for the picker's scripts. */
class FakeElement {
	textContent = "";
	hidden = false;
	disabled = false;
	value = "";
	className = "";
	type = "";
	scrollTop = 0;
	children: FakeElement[] = [];
	readonly attributes = new Map<string, string>();
	readonly classes = new Set<string>();
	readonly listeners = new Map<string, (() => void)[]>();
	readonly classList = {
		toggle: (name: string, on: boolean) => (on ? this.classes.add(name) : this.classes.delete(name)),
	};

	constructor(readonly tag: string) {}

	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}

	getAttribute(name: string) {
		return this.attributes.get(name) ?? null;
	}

	addEventListener(event: string, listener: () => void) {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
	}

	append(...nodes: FakeElement[]) {
		this.children.push(...nodes);
	}

	replaceChildren(...nodes: FakeElement[]) {
		this.children = nodes;
	}

	fire(event: string) {
		for (const listener of this.listeners.get(event) ?? []) {
			listener();
		}
	}

	click() {
		if (!this.disabled) {
			this.fire("click");
		}
	}
}

/**
 * Loads the picker's page scripts into a fake browser, connected to a fake Stream Deck socket.
 * @returns Helpers to drive and inspect the picker.
 */
async function openPicker() {
	const html = await readFile(path.join(PICKER, "index.html"), "utf8");
	const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
	const elements = new Map<string, FakeElement>();
	const document = {
		getElementById: (elementId: string) => {
			if (!ids.has(elementId)) {
				return null;
			}
			const element = elements.get(elementId) ?? new FakeElement(elementId);
			elements.set(elementId, element);
			return element;
		},
		createElement: (tag: string) => new FakeElement(tag),
	};
	const sent: Record<string, unknown>[] = [];
	const sockets: { listeners: Map<string, (event: { data: string }) => void> }[] = [];
	class FakeWebSocket {
		static readonly OPEN = 1;
		readonly readyState = 1;
		readonly listeners = new Map<string, (event: { data: string }) => void>();
		constructor() {
			sockets.push(this);
		}
		addEventListener(event: string, listener: (event: { data: string }) => void) {
			this.listeners.set(event, listener);
		}
		send(data: string) {
			sent.push(JSON.parse(data) as Record<string, unknown>);
		}
	}
	const sandbox: Record<string, unknown> = { document, WebSocket: FakeWebSocket };
	sandbox.window = sandbox;
	vm.createContext(sandbox);
	const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((match) => match[1] ?? "");
	for (const script of scripts) {
		vm.runInContext(await readFile(path.join(PICKER, script), "utf8"), sandbox, { filename: script });
	}
	(sandbox.connectElgatoStreamDeckSocket as (...args: string[]) => void)("1234", "pi-context", "registerPropertyInspector", "{}", JSON.stringify({ action: "com.marting.deckify.spotify.play-playlist" }));
	const socket = sockets[0];
	if (!socket) {
		throw new Error("The picker did not connect.");
	}
	socket.listeners.get("open")?.({ data: "" });

	const el = (elementId: string) => {
		const element = document.getElementById(elementId);
		if (!element) {
			throw new Error(`No #${elementId} in index.html.`);
		}
		return element;
	};
	const requests = () => sent.filter((message) => message.event === "sendToPlugin").map((message) => message.payload as Record<string, unknown>);
	const latestRequestId = () => requests().at(-1)?.requestId as string;
	return {
		scripts,
		el,
		requests,
		/** Delivers a state message from the plugin (by default the answer to the latest request). */
		receive(state: Partial<State>) {
			const payload: State = {
				type: "deckify:playlist:state",
				requestId: latestRequestId(),
				mode: "play",
				status: "ready",
				retryAfterSeconds: null,
				message: null,
				playlists: [],
				selected: null,
				...state,
			};
			socket.listeners.get("message")?.({ data: JSON.stringify({ event: "sendToPropertyInspector", payload }) });
		},
		/** The playlist rows on screen. */
		rows() {
			return el("list").children.map((item) => {
				const button = item.children[0];
				if (!button) {
					throw new Error("Row without a button.");
				}
				return {
					name: button.children[0]?.textContent,
					meta: button.children[1]?.textContent,
					selected: button.getAttribute("aria-selected") === "true",
					button,
				};
			});
		},
		search(text: string) {
			el("search").value = text;
			el("search").fire("input");
		},
	};
}

const names = (rows: { name: string | undefined }[]) => rows.map((row) => row.name);
const range = (from: number, to: number, name = (n: number) => `Playlist ${String(n)}`) =>
	Array.from({ length: to - from + 1 }, (_, i) => name(from + i));

describe("playlist picker paging", () => {
	it("loads the paging helper before the picker script", async () => {
		const picker = await openPicker();
		expect(picker.scripts).toEqual(["paging.js", "inspector.js"]);
	});

	it("shows no more than 20 playlist rows at once", async () => {
		const picker = await openPicker();
		picker.receive({ playlists: playlists(100) });
		expect(picker.rows()).toHaveLength(20);
		expect(names(picker.rows())).toEqual(range(1, 20));
		expect(picker.el("pager").hidden).toBe(false);
		expect(picker.el("page-info").textContent).toBe("1–20 of 100");
		expect(picker.el("previous").disabled).toBe(true);
		expect(picker.el("next").disabled).toBe(false);
	});

	it("hides the paging controls when everything fits on one page", async () => {
		const picker = await openPicker();
		picker.receive({ playlists: playlists(20) });
		expect(picker.rows()).toHaveLength(20);
		expect(picker.el("pager").hidden).toBe(true);
	});

	it("reaches the playlists after the 20th, and can choose one there", async () => {
		const picker = await openPicker();
		picker.receive({ playlists: playlists(45) });
		picker.el("next").click();
		expect(names(picker.rows())).toEqual(range(21, 40));
		expect(picker.el("page-info").textContent).toBe("21–40 of 45");
		picker.el("next").click();
		expect(names(picker.rows())).toEqual(range(41, 45));
		expect(picker.el("next").disabled).toBe(true);
		picker.el("next").click();
		expect(names(picker.rows())).toEqual(range(41, 45));

		picker.rows()[3]?.button.click();
		expect(picker.requests().at(-1)).toEqual({
			type: "deckify:playlist:select",
			requestId: expect.stringMatching(/^pi-\d+$/) as unknown,
			playlistId: id(44),
			playlistUri: `spotify:playlist:${id(44)}`,
		});

		picker.el("previous").click();
		picker.el("previous").click();
		expect(names(picker.rows())).toEqual(range(1, 20));
		expect(picker.el("previous").disabled).toBe(true);
	});

	it("pages search results over 20 and starts each new search on the first page", async () => {
		const picker = await openPicker();
		const mixed = (n: number) => (n % 3 === 0 ? `Focus ${String(n)}` : `Mix ${String(n)}`);
		picker.receive({ playlists: playlists(90, mixed) });
		picker.el("next").click();
		picker.el("next").click();

		picker.search("MIX");
		const mixes = range(1, 90, mixed).filter((name) => name.startsWith("Mix"));
		expect(mixes).toHaveLength(60);
		expect(names(picker.rows())).toEqual(mixes.slice(0, 20));
		expect(picker.el("page-info").textContent).toBe("1–20 of 60");
		picker.el("next").click();
		picker.el("next").click();
		expect(names(picker.rows())).toEqual(mixes.slice(40, 60));
		expect(picker.el("next").disabled).toBe(true);

		picker.search("focus 1");
		const focus = range(1, 90, mixed).filter((name) => name.toLowerCase().includes("focus 1"));
		expect(names(picker.rows())).toEqual(focus);
		expect(focus.length).toBeLessThanOrEqual(20);
		expect(picker.el("pager").hidden).toBe(true);

		picker.search("nothing like this");
		expect(picker.rows()).toHaveLength(0);
		expect(picker.el("status").textContent).toBe("No playlists match your search.");

		// Searching only filters what the plugin already sent: it never asks the plugin (or Spotify) for anything.
		expect(picker.requests().map((request) => request.type)).toEqual(["deckify:playlist:list"]);
	});

	it("opens on the page that holds the key's playlist and keeps it selected across pages and searches", async () => {
		const picker = await openPicker();
		const selected = { id: id(25), name: "Playlist 25", owner: "You", state: "ok", canOpen: true };
		picker.receive({ playlists: playlists(45), selected });
		expect(names(picker.rows())).toEqual(range(21, 40));
		expect(picker.rows().filter((row) => row.selected).map((row) => row.name)).toEqual(["Playlist 25"]);

		picker.el("previous").click();
		expect(picker.rows().some((row) => row.selected)).toBe(false);
		expect(picker.el("selected-name").textContent).toBe("Playlist 25");
		expect(picker.el("open").hidden).toBe(false);

		picker.search("Playlist 2");
		// "Playlist 2", "Playlist 20".."Playlist 29": 11 matches on one page, the selected one marked.
		expect(picker.rows()).toHaveLength(11);
		expect(picker.rows().filter((row) => row.selected).map((row) => row.name)).toEqual(["Playlist 25"]);

		picker.search("");
		expect(names(picker.rows())).toEqual(range(1, 20));
		picker.el("next").click();
		expect(picker.rows().filter((row) => row.selected).map((row) => row.name)).toEqual(["Playlist 25"]);
		expect(picker.el("selected-name").textContent).toBe("Playlist 25");
	});

	it("stays on the current page when a playlist is chosen there", async () => {
		const picker = await openPicker();
		picker.receive({ playlists: playlists(45) });
		picker.el("next").click();
		picker.rows()[9]?.button.click();
		const chosen = picker.requests().at(-1);
		expect(chosen).toMatchObject({ type: "deckify:playlist:select", playlistId: id(30), playlistUri: `spotify:playlist:${id(30)}` });

		picker.receive({ playlists: playlists(45), selected: { id: id(30), name: "Playlist 30", owner: "You", state: "ok", canOpen: true } });
		expect(names(picker.rows())).toEqual(range(21, 40));
		expect(picker.rows().filter((row) => row.selected).map((row) => row.name)).toEqual(["Playlist 30"]);
	});

	it("keeps the page in range when a refresh returns fewer playlists", async () => {
		const picker = await openPicker();
		picker.receive({ playlists: playlists(45) });
		picker.el("next").click();
		picker.el("next").click();
		picker.el("refresh").click();
		expect(picker.requests().at(-1)?.type).toBe("deckify:playlist:refresh");
		picker.receive({ playlists: playlists(25) });
		expect(names(picker.rows())).toEqual(range(21, 25));
		expect(picker.el("page-info").textContent).toBe("21–25 of 25");
	});

	it("still ignores answers to older requests", async () => {
		const picker = await openPicker();
		picker.receive({ playlists: playlists(5) });
		picker.el("refresh").click();
		picker.receive({ requestId: "pi-1", playlists: playlists(45) });
		expect(picker.rows()).toHaveLength(5);
	});

	it("tells playlists with the same name apart even when they are on different pages", async () => {
		const picker = await openPicker();
		const all = playlists(30);
		all[2] = { ...playlist(3), name: "Chill" };
		all[27] = { ...playlist(28), name: "Chill" };
		picker.receive({ playlists: all });
		expect(picker.rows()[2]?.meta).toContain(`ID …${id(3).slice(-4)}`);
		picker.el("next").click();
		expect(picker.rows()[7]?.name).toBe("Chill");
		expect(picker.rows()[7]?.meta).toContain(`ID …${id(28).slice(-4)}`);
	});
});

describe("Spotify attribution in the playlist picker", () => {
	it("ships Spotify's official full logo, unmodified", async () => {
		expect(SPOTIFY_LOGO).toBe("ui/playlist/Spotify_Full_Logo_RGB_White.png");
		const logo = await readFile(path.join(PLUGIN, SPOTIFY_LOGO));
		expect(createHash("sha256").update(logo).digest("hex")).toBe(OFFICIAL_LOGO_SHA256);
		// PNG, 3432×940 (Spotify's full logo: icon and wordmark).
		expect(logo.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
		expect([logo.readUInt32BE(16), logo.readUInt32BE(20)]).toEqual([3432, 940]);
	});

	it("shows the logo locally, at least at Spotify's 70 px minimum width, next to the attribution text", async () => {
		const html = await readFile(path.join(PICKER, "index.html"), "utf8");
		const css = await readFile(path.join(PICKER, "playlist.css"), "utf8");
		const img = /<img [^>]*class="spotify-logo"[^>]*>/.exec(html)?.[0] ?? "";
		expect(img).toContain('src="Spotify_Full_Logo_RGB_White.png"');
		expect(img).toContain('alt="Spotify"');
		expect(Number(/width="(\d+)"/.exec(img)?.[1])).toBeGreaterThanOrEqual(70);
		const rule = /\.spotify-logo \{([^}]*)\}/.exec(css)?.[1] ?? "";
		expect(Number(/\bwidth: (\d+)px/.exec(rule)?.[1])).toBeGreaterThanOrEqual(70);
		expect(rule).not.toMatch(/filter|opacity|transform|clip|mask|object-fit/);
		expect(html).toContain("Playlist information provided by Spotify.");
	});

	it("keeps Spotify's logo out of Deckify's own key images and action icons", async () => {
		const images = (await readdir(path.join(PLUGIN, "imgs"), { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
		expect(images.length).toBeGreaterThan(20);
		for (const image of images) {
			const content = await readFile(path.join(image.parentPath, image.name));
			expect(createHash("sha256").update(content).digest("hex"), image.name).not.toBe(OFFICIAL_LOGO_SHA256);
			expect(content.toString("latin1"), image.name).not.toMatch(/Spotify_Full_Logo|Spotify_Primary_Logo/);
		}
		const manifest = await readFile(path.join(PLUGIN, "manifest.json"), "utf8");
		expect(manifest).not.toContain("Spotify_Full_Logo");
	});
});

describe("package verification", () => {
	async function completeEntries() {
		const manifest = JSON.parse(await readFile(path.join(PLUGIN, "manifest.json"), "utf8")) as Record<string, unknown>;
		const files = manifestFiles(manifest).flatMap((file) => (file.endsWith(".html") ? [file] : [`${file}.svg`, `${file}.png`]));
		const entries = ["bin/plugin.js", "manifest.json", ...files, ...requiredFiles()].map((file) => `com.marting.deckify.sdPlugin/${file}`);
		return { manifest, entries };
	}

	it("requires the Spotify logo and the paging script", () => {
		expect(requiredFiles()).toEqual(expect.arrayContaining([SPOTIFY_LOGO, "ui/playlist/paging.js", "ui/playlist/inspector.js"]));
	});

	it("accepts a complete package", async () => {
		const { manifest, entries } = await completeEntries();
		expect(verifyPackageEntries(entries, manifest, false)).toEqual([]);
	});

	it("fails when the Spotify attribution logo is missing", async () => {
		const { manifest, entries } = await completeEntries();
		const problems = verifyPackageEntries(
			entries.filter((entry) => entry !== `com.marting.deckify.sdPlugin/${SPOTIFY_LOGO}`),
			manifest,
			false,
		);
		expect(problems).toEqual([`The package is missing files the plugin uses: ${SPOTIFY_LOGO}`]);
	});

	it("fails when the paging script is missing", async () => {
		const { manifest, entries } = await completeEntries();
		const problems = verifyPackageEntries(
			entries.filter((entry) => !entry.endsWith("ui/playlist/paging.js")),
			manifest,
			false,
		);
		expect(problems).toEqual(["The package is missing files the plugin uses: ui/playlist/paging.js"]);
	});
});
