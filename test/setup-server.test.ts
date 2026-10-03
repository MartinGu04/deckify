import { request } from "node:http";
import { connect, createServer as createTcpServer } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DUPLICATE_REQUEST_WINDOW_MS, ExperienceSwitcher, type ExperienceDevice } from "../src/experiences/experiences";
import { isDeckifySetupUrl, SESSION_HEADER, SETUP_ASSETS, DeckifySetupServer } from "../src/setup/setup-server";
import { LAUNCH_CODE_LIFETIME_MS, SESSION_IDLE_TIMEOUT_MS, SESSION_MAX_LIFETIME_MS, SetupSession } from "../src/setup/session";
import { SpotifyAccountCommands } from "../src/spotify/account-commands";
import type { SpotifyAuthService } from "../src/spotify/auth/auth-service";
import { SPOTIFY_REDIRECT_PORT, SPOTIFY_REDIRECT_URI } from "../src/spotify/config";
import { SpotifyAuthState } from "../src/spotify/state/auth-state";
import { FAKE, findSecrets, recordingLogger } from "./helpers";

// The local Deckify Setup server, over real HTTP on 127.0.0.1: binding, session protection, the command allowlist and its lifecycle.
const PLUGIN = path.resolve(import.meta.dirname, "..", "com.marting.deckify.sdPlugin");

type Reply = { status: number; headers: Record<string, string | string[] | undefined>; text: string; json: () => Record<string, unknown> };

/**
 * Sends a raw HTTP request (full control over Host, Origin and other headers).
 * @param port Port.
 * @param options Request.
 * @param options.method Method.
 * @param options.path Path.
 * @param options.headers Headers (Host defaults to 127.0.0.1:<port>).
 * @param options.body Body.
 * @returns The response.
 */
function call(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
	return new Promise((resolve, reject) => {
		const req = request(
			{ host: "127.0.0.1", port, method: options.method ?? "GET", path: options.path, headers: { Host: `127.0.0.1:${String(port)}`, ...options.headers } },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					const text = Buffer.concat(chunks).toString("utf8");
					resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: () => JSON.parse(text) as Record<string, unknown> });
				});
			},
		);
		req.on("error", reject);
		req.end(options.body);
	});
}

function fakeAuth(state: SpotifyAuthState) {
	return {
		connect: vi.fn(() => Promise.resolve()),
		retryConnect: vi.fn(() => Promise.resolve()),
		cancelConnect: vi.fn(),
		disconnect: vi.fn(() => Promise.resolve()),
		setClientId: vi.fn((clientId: string | undefined) => {
			state.update({ status: clientId === undefined ? "not-configured" : "disconnected", clientId });
			return Promise.resolve();
		}),
	};
}

const servers: DeckifySetupServer[] = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
});

/** Stream Decks the fake SDK knows: a standard MK.2, a second MK.2, a Stream Deck + and an unplugged MK.2. */
const DEVICES: Readonly<Record<string, ExperienceDevice>> = {
	"mk2-device": { type: 0, isConnected: true },
	"second-mk2": { type: 0, isConnected: true },
	"plus-device": { type: 7, isConnected: true },
	"unplugged-mk2": { type: 0, isConnected: false },
};

/**
 * Starts a setup server with fakes and opens a session.
 * @param options Options.
 * @param options.listenPort Port to ask for first.
 * @param options.sweepIntervalMs How often ended sessions are swept.
 * @param options.origin The Stream Deck whose Spotify Account key opens setup.
 * @returns Helpers.
 */
async function startSetup(options: { listenPort?: number; sweepIntervalMs?: number; origin?: string | null } = {}) {
	const state = new SpotifyAuthState();
	state.update({ status: "not-configured" });
	const auth = fakeAuth(state);
	const saveClientId = vi.fn((_clientId: string | undefined) => Promise.resolve());
	const dashboard = vi.fn((_url: string) => Promise.resolve());
	const opened: string[] = [];
	const logger = recordingLogger();
	let now = Date.UTC(2026, 9, 3);
	// The SDK's profile switch; tests may hold or reject it.
	const switchToProfile = vi.fn((_deviceId: string, _profile: string) => Promise.resolve());
	const server = new DeckifySetupServer({
		commands: new SpotifyAccountCommands({ auth: auth as unknown as SpotifyAuthService, state, saveClientId, openUrl: dashboard, logger }),
		experiences: new ExperienceSwitcher({ getDevice: (id) => DEVICES[id], switchToProfile, clock: () => now, logger }),
		state,
		openUrl: (url) => {
			opened.push(url);
			return Promise.resolve();
		},
		pluginDir: PLUGIN,
		clock: () => now,
		logger,
		listenPort: options.listenPort,
		sweepIntervalMs: options.sweepIntervalMs,
	});
	servers.push(server);
	const origin = options.origin === null ? undefined : (options.origin ?? "mk2-device");
	await server.open("start", origin);
	const port = server.port ?? 0;
	const launchCode = () => new URL(opened.at(-1) ?? "").hash.replace("#launch=", "");
	const pageOrigin = `http://127.0.0.1:${String(port)}`;

	return {
		switchToProfile,
		state,
		auth,
		saveClientId,
		dashboard,
		opened,
		logger,
		server,
		port,
		origin: pageOrigin,
		launchCode,
		advance: (ms: number) => (now += ms),
		/** Exchanges the launch code for a session token. */
		async session(code = launchCode()) {
			return call(port, { method: "POST", path: "/api/session", headers: { Origin: pageOrigin, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, body: JSON.stringify({ launchCode: code }) });
		},
		async token() {
			const reply = await this.session();
			return String(reply.json().sessionToken);
		},
		async command(token: string, body: unknown, headers: Record<string, string> = {}) {
			return call(port, {
				method: "POST",
				path: "/api/command",
				headers: { Origin: pageOrigin, "Content-Type": "application/json", [SESSION_HEADER]: token, ...headers },
				body: JSON.stringify(body),
			});
		},
		async getState(token: string, after = -1) {
			return call(port, { path: `/api/state?after=${String(after)}`, headers: { [SESSION_HEADER]: token, "Sec-Fetch-Site": "same-origin" } });
		},
	};
}

/**
 * Tries to open a TCP connection.
 * @param host Host.
 * @param port Port.
 * @returns `true` when something accepted the connection.
 */
function canConnect(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({ host, port, timeout: 500 });
		socket.once("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.once("error", () => resolve(false));
		socket.once("timeout", () => {
			socket.destroy();
			resolve(false);
		});
	});
}

/**
 * Whether a loopback port can be bound right now.
 * @param port Port.
 * @returns `true` when free.
 */
function isFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = createTcpServer();
		probe.once("error", () => resolve(false));
		probe.listen({ host: "127.0.0.1", port }, () => probe.close(() => resolve(true)));
	});
}

describe("binding", () => {
	it("listens only on 127.0.0.1, on a dynamic port that is never Spotify's callback port", async () => {
		const setup = await startSetup();
		expect(setup.port).toBeGreaterThan(0);
		expect(setup.port).not.toBe(SPOTIFY_REDIRECT_PORT);
		expect(await canConnect("127.0.0.1", setup.port)).toBe(true);
		// Not on IPv6 loopback, and not on any other interface.
		expect(await canConnect("::1", setup.port)).toBe(false);
		const external = Object.values(networkInterfaces())
			.flat()
			.filter((address) => address !== undefined && address.family === "IPv4" && !address.internal)
			.map((address) => address?.address ?? "");
		for (const address of external) {
			expect(await canConnect(address, setup.port), address).toBe(false);
		}
	});

	it("never takes Spotify's callback port, even when the operating system offers it", async () => {
		// Ask for 43821 explicitly, as if the operating system had picked it. If it is free, the server must let it go again and use another
		// port; if it is taken, the server must still start on another port.
		const freeBefore = await isFree(SPOTIFY_REDIRECT_PORT);
		const setup = await startSetup({ listenPort: SPOTIFY_REDIRECT_PORT });
		expect(setup.port).not.toBe(SPOTIFY_REDIRECT_PORT);
		expect(isDeckifySetupUrl(setup.opened[0])).toBe(true);
		// The callback port is left as it was, for Spotify's OAuth listener.
		expect(await isFree(SPOTIFY_REDIRECT_PORT)).toBe(freeBefore);
	});

	it("keeps Spotify's OAuth callback exactly where it was", () => {
		expect(SPOTIFY_REDIRECT_URI).toBe("http://127.0.0.1:43821/callback");
	});

	it("opens the browser on a loopback Setup URL with a one-time code in the fragment", async () => {
		const setup = await startSetup();
		expect(setup.opened).toHaveLength(1);
		const url = new URL(setup.opened[0] ?? "");
		expect(url.protocol).toBe("http:");
		expect(url.hostname).toBe("127.0.0.1");
		expect(Number(url.port)).toBe(setup.port);
		expect(url.pathname).toBe("/setup");
		expect(url.search).toBe("");
		expect(url.hash).toMatch(/^#launch=[A-Za-z0-9_-]{43}$/);
	});

	it("validates Setup URLs strictly", () => {
		const code = "a".repeat(43);
		expect(isDeckifySetupUrl(`http://127.0.0.1:50000/setup#launch=${code}`)).toBe(true);
		for (const url of [
			`http://127.0.0.1:43821/setup#launch=${code}`,
			`http://localhost:50000/setup#launch=${code}`,
			`https://127.0.0.1:50000/setup#launch=${code}`,
			`http://127.0.0.1:50000/other#launch=${code}`,
			`http://127.0.0.1:50000/setup?launch=${code}`,
			`http://127.0.0.1:50000/setup#launch=${code}&x=1`,
			`http://127.0.0.1:70000/setup#launch=${code}`,
			`http://127.0.0.1:0/setup#launch=${code}`,
			`http://127.0.0.1.evil.example:50000/setup#launch=${code}`,
			"https://developer.spotify.com/dashboard",
			"javascript:alert(1)",
			undefined,
		]) {
			expect(isDeckifySetupUrl(url), String(url)).toBe(false);
		}
	});
});

describe("static files", () => {
	it("serves exactly the allowlisted Setup App files, with strict security headers", async () => {
		const setup = await startSetup();
		for (const [url, asset] of Object.entries(SETUP_ASSETS)) {
			const reply = await call(setup.port, { path: url });
			expect(reply.status, url).toBe(200);
			expect(reply.headers["content-type"], url).toBe(asset.type);
			expect(reply.headers["content-security-policy"], url).toBe(
				"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
			);
			expect(reply.headers["x-content-type-options"]).toBe("nosniff");
			expect(reply.headers["cache-control"]).toBe("no-store");
			expect(reply.headers["referrer-policy"]).toBe("no-referrer");
			expect(reply.headers["x-frame-options"]).toBe("DENY");
			expect(reply.headers["access-control-allow-origin"]).toBeUndefined();
			expect(reply.headers["set-cookie"]).toBeUndefined();
		}
	});

	it("serves nothing else from the plugin folder", async () => {
		const setup = await startSetup();
		for (const url of [
			"/",
			"/manifest.json",
			"/setup/../manifest.json",
			"/setup/%2e%2e/manifest.json",
			"/setup/..%2fmanifest.json",
			"/ui/setup/setup.js",
			"/setup/index.html",
			"/setup/icons/../../bin/plugin.js",
			"/bin/plugin.js",
			"/setup/setup.js/",
		]) {
			const reply = await call(setup.port, { path: url });
			expect(reply.status, url).toBe(404);
			expect(reply.text, url).not.toContain("Deckify");
		}
		expect((await call(setup.port, { method: "POST", path: "/setup" })).status).toBe(405);
	});

	it("rejects requests for any other host name (DNS rebinding)", async () => {
		const setup = await startSetup();
		for (const host of [`localhost:${String(setup.port)}`, "evil.example", `127.0.0.1:${String(setup.port + 1)}`, `127.0.0.1`]) {
			expect((await call(setup.port, { path: "/setup", headers: { Host: host } })).status, host).toBe(421);
		}
	});
});

describe("session protection", () => {
	it("exchanges the launch code once for a session token", async () => {
		const setup = await startSetup();
		const code = setup.launchCode();
		const first = await setup.session(code);
		expect(first.status).toBe(200);
		expect(first.json()).toEqual({ sessionToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) as unknown, entry: "start", experiences: "supported" });
		expect(first.json().sessionToken).not.toBe(code);
		// The code is single-use.
		expect((await setup.session(code)).status).toBe(403);
	});

	it("rejects a wrong, malformed or missing launch code", async () => {
		const setup = await startSetup();
		for (const code of ["", "x".repeat(43), setup.launchCode().slice(1), 42, null]) {
			expect((await setup.session(code as string)).status, String(code)).toBe(403);
		}
		// Still usable afterwards (wrong guesses do not burn the real code; there is no way to enumerate 256-bit codes).
		expect((await setup.session()).status).toBe(200);
	});

	it("requires the session token for state and commands", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		expect((await setup.getState(token)).status).toBe(200);
		for (const bad of ["", "x".repeat(43), token.slice(0, -1), setup.launchCode()]) {
			expect((await setup.getState(bad)).status, bad).toBe(403);
			expect((await setup.command(bad, { type: "connect" })).status, bad).toBe(403);
		}
		expect((await call(setup.port, { path: "/api/state" })).status).toBe(403);
		expect(setup.auth.connect).not.toHaveBeenCalled();
	});

	it("never accepts the token in the URL", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		expect((await call(setup.port, { path: `/api/state?session=${token}&${SESSION_HEADER}=${token}` })).status).toBe(403);
	});

	it("rejects cross-origin and non-JSON requests (CSRF)", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		const cases: [string, Record<string, string>][] = [
			["foreign origin", { Origin: "https://evil.example" }],
			["localhost origin", { Origin: `http://localhost:${String(setup.port)}` }],
			["null origin", { Origin: "null" }],
			["cross-site fetch", { "Sec-Fetch-Site": "cross-site" }],
			["same-site fetch", { "Sec-Fetch-Site": "same-site" }],
		];
		for (const [name, headers] of cases) {
			expect((await setup.command(token, { type: "connect" }, headers)).status, name).toBe(403);
		}
		const noOrigin = await call(setup.port, {
			method: "POST",
			path: "/api/command",
			headers: { "Content-Type": "application/json", [SESSION_HEADER]: token },
			body: JSON.stringify({ type: "connect" }),
		});
		expect(noOrigin.status).toBe(403);
		expect((await setup.command(token, { type: "connect" }, { "Content-Type": "text/plain" })).status).toBe(415);
		expect((await call(setup.port, { method: "OPTIONS", path: "/api/command", headers: { Origin: "https://evil.example" } })).status).toBe(405);
		expect((await setup.getState(token)).headers["access-control-allow-origin"]).toBeUndefined();
		expect(setup.auth.connect).not.toHaveBeenCalled();
	});

	it("expires an unused launch code, an idle session and a too-old session", async () => {
		const stale = await startSetup();
		stale.advance(LAUNCH_CODE_LIFETIME_MS + 1);
		expect((await stale.session()).status).toBe(403);

		const idle = await startSetup();
		const token = await idle.token();
		idle.advance(SESSION_IDLE_TIMEOUT_MS - 1000);
		expect((await idle.getState(token)).status).toBe(200);
		idle.advance(SESSION_IDLE_TIMEOUT_MS + 1);
		expect((await idle.getState(token)).status).toBe(403);

		const old = await startSetup();
		const oldToken = await old.token();
		for (let elapsed = 0; elapsed <= SESSION_MAX_LIFETIME_MS; elapsed += SESSION_IDLE_TIMEOUT_MS / 2) {
			old.advance(SESSION_IDLE_TIMEOUT_MS / 2);
			await old.getState(oldToken);
		}
		expect((await old.getState(oldToken)).status).toBe(403);
	});

	it("ends the previous session when setup is opened again", async () => {
		const setup = await startSetup();
		const first = await setup.token();
		await setup.server.open("account");
		expect(setup.server.port).toBe(setup.port);
		expect((await setup.getState(first)).status).toBe(403);
		const second = await setup.session();
		expect(second.json().entry).toBe("account");
		expect((await setup.getState(String(second.json().sessionToken))).status).toBe(200);
	});

	it("never logs the launch code or the session token", async () => {
		const setup = await startSetup();
		const code = setup.launchCode();
		const token = await setup.token();
		await setup.command(token, { type: "open-dashboard" });
		await setup.server.close();
		const log = setup.logger.lines.join("\n");
		expect(log).not.toContain(code);
		expect(log).not.toContain(token);
		expect(log).toContain(`127.0.0.1:${String(setup.port)}`);
	});
});

describe("state and commands", () => {
	it("returns only the public account state", async () => {
		const setup = await startSetup();
		setup.state.update({ status: "connected", clientId: FAKE.clientId, profile: { id: "u", displayName: "Test Listener", product: "premium" }, authorizedAt: 1 });
		const reply = await setup.getState(await setup.token());
		const body = reply.json();
		expect(Object.keys(body).sort()).toEqual(["clientIdError", "clientIdIssue", "state", "version"]);
		expect(Object.keys(body.state as object).sort()).toEqual(["activity", "authorizedAt", "clientId", "displayName", "issue", "message", "product", "redirectUri", "status"]);
		expect(body.state).toMatchObject({ status: "connected", displayName: "Test Listener", redirectUri: "http://127.0.0.1:43821/callback" });
		expect(findSecrets(reply.text)).toEqual([]);
		expect(reply.text).not.toMatch(/token|secret|verifier|refresh/i);
	});

	it("waits for a change, then answers with the new state", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		const first = (await setup.getState(token)).json();
		const waiting = setup.getState(token, Number(first.version));
		await new Promise((resolve) => setTimeout(resolve, 30));
		setup.state.update({ status: "connecting", clientId: FAKE.clientId, activity: "authorizing" });
		const next = (await waiting).json();
		expect(Number(next.version)).toBeGreaterThan(Number(first.version));
		expect(next.state).toMatchObject({ status: "connecting", activity: "authorizing" });
	});

	it("runs only the fixed account commands", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		for (const type of ["connect", "retry-connect", "cancel-connect", "disconnect"]) {
			expect((await setup.command(token, { type })).status, type).toBe(200);
		}
		expect(setup.auth.connect).toHaveBeenCalledTimes(1);
		expect(setup.auth.retryConnect).toHaveBeenCalledTimes(1);
		expect(setup.auth.cancelConnect).toHaveBeenCalledTimes(1);
		expect(setup.auth.disconnect).toHaveBeenCalledTimes(1);

		for (const body of [
			{ type: "open-url", url: "https://evil.example" },
			{ type: "deckify:spotify:connect" },
			{ type: "run", command: "calc.exe" },
			{ type: "read-file", path: "C:\\Windows\\win.ini" },
			{ type: "hello" },
			{ type: "save-client-id" },
			{ type: "save-client-id", clientId: 42 },
			{ type: "save-client-id", clientId: "a".repeat(300) },
			{},
			[],
			"connect",
		]) {
			expect((await setup.command(token, body)).status, JSON.stringify(body)).toBe(400);
		}
	});

	it("opens only the Spotify Developer Dashboard, whatever the request carries", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		await setup.command(token, { type: "open-dashboard" });
		await setup.command(token, { type: "open-dashboard", url: "https://evil.example/" });
		expect(setup.dashboard.mock.calls).toEqual([["https://developer.spotify.com/dashboard"], ["https://developer.spotify.com/dashboard"]]);
		// The only other URL the server ever opens is its own Setup URL.
		expect(setup.opened.every((url) => isDeckifySetupUrl(url))).toBe(true);
	});

	it("validates the Client ID with the existing validator before saving it", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		const invalid = (await setup.command(token, { type: "save-client-id", clientId: "not valid" })).json();
		expect(invalid).toMatchObject({ clientIdIssue: "invalid-client-id", clientIdError: expect.stringMatching(/does not look like a Spotify Client ID/) as unknown });
		expect(setup.saveClientId).not.toHaveBeenCalled();

		const valid = (await setup.command(token, { type: "save-client-id", clientId: ` ${FAKE.clientId} ` })).json();
		expect(setup.saveClientId).toHaveBeenCalledWith(FAKE.clientId);
		expect(valid).toMatchObject({ clientIdIssue: null, state: { status: "disconnected", clientId: FAKE.clientId } });
	});

	it("rejects oversized and malformed bodies", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		const big = await call(setup.port, {
			method: "POST",
			path: "/api/command",
			headers: { Origin: setup.origin, "Content-Type": "application/json", [SESSION_HEADER]: token },
			body: JSON.stringify({ type: "save-client-id", clientId: "a".repeat(5000) }),
		}).catch(() => ({ status: 413 }));
		expect(big.status).toBe(413);
		const malformed = await call(setup.port, {
			method: "POST",
			path: "/api/command",
			headers: { Origin: setup.origin, "Content-Type": "application/json", [SESSION_HEADER]: token },
			body: "{",
		});
		expect(malformed.status).toBe(400);
	});
});

describe("experiences", () => {
	const choose = (experience: unknown) => ({ type: "choose-experience", experience });

	it("maps each fixed experience ID to its bundled profile, on the Stream Deck that opened setup", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		for (const [id, profile] of [
			["simple", "profiles/Deckify Simple"],
			["deckify", "profiles/Deckify"],
			["power", "profiles/Deckify Power"],
		]) {
			const reply = await setup.command(token, choose(id));
			expect(reply.status, id).toBe(200);
			expect(reply.json().experience).toEqual({ id, outcome: "requested" });
			expect(setup.switchToProfile).toHaveBeenLastCalledWith("mk2-device", profile);
		}
		expect(setup.switchToProfile).toHaveBeenCalledTimes(3);
	});

	it("targets whichever Stream Deck opened setup", async () => {
		const setup = await startSetup({ origin: "second-mk2" });
		const token = await setup.token();
		await setup.command(token, choose("deckify"));
		expect(setup.switchToProfile.mock.calls).toEqual([["second-mk2", "profiles/Deckify"]]);
	});

	it("accepts only a fixed experience ID: no profile names, paths, devices, pages or other SDK commands", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		for (const body of [
			{ type: "choose-experience" },
			choose(undefined),
			choose(""),
			choose("Deckify"),
			choose("DECKIFY"),
			choose("profiles/Deckify"),
			choose("profiles/Deckify Power"),
			choose("../../manifest"),
			choose("C:\\Users\\someone\\My Profile"),
			choose("my-own-profile"),
			choose(["deckify"]),
			choose({ id: "deckify" }),
			{ ...choose("deckify"), device: "plus-device" },
			{ ...choose("deckify"), deviceId: "second-mk2" },
			{ ...choose("deckify"), profile: "profiles/Other" },
			{ ...choose("deckify"), page: 2 },
			{ type: "switch-profile", profile: "profiles/Deckify" },
			{ type: "switchToProfile", device: "mk2-device", profile: "profiles/Deckify" },
			{ type: "choose-experience", experience: "deckify", type2: "x" },
		]) {
			expect((await setup.command(token, body)).status, JSON.stringify(body)).toBe(400);
		}
		expect(setup.switchToProfile).not.toHaveBeenCalled();
	});

	it("needs the session token and the Setup App's own origin, like every other command", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		expect((await setup.command("x".repeat(43), choose("deckify"))).status).toBe(403);
		expect((await setup.command(token, choose("deckify"), { Origin: "https://evil.example" })).status).toBe(403);
		expect((await setup.command(token, choose("deckify"), { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
		expect((await setup.command(token, choose("deckify"), { "Content-Type": "text/plain" })).status).toBe(415);
		expect(setup.switchToProfile).not.toHaveBeenCalled();
	});

	it("explains an unsupported Stream Deck instead of attempting an incompatible switch", async () => {
		const setup = await startSetup({ origin: "plus-device" });
		const session = (await setup.session()).json();
		expect(session.experiences).toBe("unsupported-device");
		const reply = (await setup.command(String(session.sessionToken), choose("deckify"))).json();
		expect(reply.experience).toEqual({ id: "deckify", outcome: "unsupported-device" });
		expect(setup.switchToProfile).not.toHaveBeenCalled();
	});

	it("does not switch when the originating Stream Deck is unplugged or unknown", async () => {
		for (const origin of ["unplugged-mk2", "never-seen", null]) {
			const setup = await startSetup({ origin });
			const session = (await setup.session()).json();
			expect(session.experiences, String(origin)).toBe("device-unavailable");
			const reply = (await setup.command(String(session.sessionToken), choose("simple"))).json();
			expect(reply.experience, String(origin)).toEqual({ id: "simple", outcome: "device-unavailable" });
			expect(setup.switchToProfile).not.toHaveBeenCalled();
		}
	});

	it("sends one switch for repeated or concurrent requests, and a new one only when the user chooses again later", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		let release = (): void => undefined;
		setup.switchToProfile.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
		const first = setup.command(token, choose("deckify"));
		const second = setup.command(token, choose("deckify"));
		const other = setup.command(token, choose("power"));
		await vi.waitFor(() => expect(setup.switchToProfile).toHaveBeenCalledTimes(1));
		expect((await other).json().experience).toEqual({ id: "power", outcome: "busy" });
		release();
		expect((await first).json().experience).toEqual({ id: "deckify", outcome: "requested" });
		expect((await second).json().experience).toEqual({ id: "deckify", outcome: "requested" });
		// A repeat right afterwards (a double-click that got through) is not sent again.
		expect((await setup.command(token, choose("deckify"))).json().experience).toEqual({ id: "deckify", outcome: "requested" });
		expect(setup.switchToProfile).toHaveBeenCalledTimes(1);
		// Choosing again later is a new, explicit request.
		setup.advance(DUPLICATE_REQUEST_WINDOW_MS + 1);
		await setup.command(token, choose("deckify"));
		expect(setup.switchToProfile).toHaveBeenCalledTimes(2);
	});

	it("reports a refused switch honestly", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		setup.switchToProfile.mockRejectedValueOnce(new Error("not connected"));
		expect((await setup.command(token, choose("simple"))).json().experience).toEqual({ id: "simple", outcome: "failed" });
		// Nothing was sent successfully, so trying again is sent again.
		expect((await setup.command(token, choose("simple"))).json().experience).toEqual({ id: "simple", outcome: "requested" });
		expect(setup.switchToProfile).toHaveBeenCalledTimes(2);
	});

	it("never exposes the device ID to the page or the log", async () => {
		const setup = await startSetup();
		const session = await setup.session();
		const token = String(session.json().sessionToken);
		const replies = [session.text, (await setup.getState(token)).text, (await setup.command(token, choose("deckify"))).text];
		for (const text of replies) {
			expect(text).not.toContain("mk2-device");
		}
		expect(setup.logger.lines.join("\n")).not.toContain("mk2-device");
	});
});

describe("lifecycle", () => {
	it("closes when the user finishes", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		expect((await setup.command(token, { type: "finish" })).json()).toEqual({ finished: true });
		await vi.waitFor(() => expect(setup.server.port).toBeUndefined());
		expect(await canConnect("127.0.0.1", setup.port)).toBe(false);
	});

	it("closes by itself when the session expires", async () => {
		const setup = await startSetup({ sweepIntervalMs: 20 });
		setup.advance(LAUNCH_CODE_LIFETIME_MS + 1);
		await vi.waitFor(() => expect(setup.server.port).toBeUndefined());
		expect(await canConnect("127.0.0.1", setup.port)).toBe(false);
	});

	it("closes safely: pending requests end, closing twice is harmless, and setup can be opened again", async () => {
		const setup = await startSetup();
		const token = await setup.token();
		const first = (await setup.getState(token)).json();
		const pending = setup.getState(token, Number(first.version)).catch(() => "closed");
		await new Promise((resolve) => setTimeout(resolve, 30));
		await setup.server.close();
		await setup.server.close();
		await expect(pending).resolves.toBeDefined();
		expect(await canConnect("127.0.0.1", setup.port)).toBe(false);

		await setup.server.open();
		expect(setup.server.port).toBeDefined();
		expect(setup.opened).toHaveLength(2);
		expect((await call(setup.server.port ?? 0, { path: "/setup" })).status).toBe(200);
	});
});

describe("SetupSession", () => {
	it("uses 256-bit random secrets and compares them safely", () => {
		const session = new SetupSession("start", 0);
		expect(session.launchCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(new SetupSession("start", 0).launchCode).not.toBe(session.launchCode);
		expect(session.authorize(undefined, 0)).toBe(false);
		const token = session.exchange(session.launchCode, 1);
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(session.launchCode).toBeUndefined();
		expect(session.authorize(token, 2)).toBe(true);
		session.end();
		expect(session.authorize(token, 3)).toBe(false);
	});
});

describe("Setup App end to end (real page, real local server)", () => {
	it("walks from the welcome screen to a connected Spotify account and a chosen experience over the local API", async () => {
		const { JSDOM } = await import("jsdom");
		const setup = await startSetup();
		setup.auth.connect.mockImplementation(() => {
			setup.state.update({ status: "connecting", clientId: FAKE.clientId, activity: "authorizing" });
			setTimeout(() => {
				setup.state.update({ status: "connected", clientId: FAKE.clientId, profile: { id: "u", displayName: "Test Listener", product: "premium" }, authorizedAt: 1 });
			}, 20);
			return Promise.resolve();
		});

		// The page and its scripts, as the browser gets them from the server.
		const page = await call(setup.port, { path: "/setup" });
		const dom = new JSDOM(page.text, { runScripts: "outside-only", url: setup.opened[0] });
		const { window } = dom;
		// The browser's fetch: same-origin requests to the server, with the Origin header browsers add to POSTs.
		Object.assign(window, {
			fetch: async (target: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
				const headers: Record<string, string> = { ...init.headers, "Sec-Fetch-Site": "same-origin" };
				if (init.method === "POST") {
					headers.Origin = setup.origin;
				}
				const reply = await call(setup.port, { method: init.method, path: target, headers, body: init.body });
				return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.json()) };
			},
		});
		const scripts = [...page.text.matchAll(/<script src="([^"]+)"><\/script>/g)].map((match) => match[1] ?? "");
		expect(scripts).toEqual(["/setup/onboarding.js", "/setup/experiences.js", "/setup/setup.js"]);
		for (const script of scripts) {
			window.eval((await call(setup.port, { path: script })).text);
		}

		const doc = window.document;
		const heading = () => [...doc.querySelectorAll("[data-view]")].find((view) => !view.hasAttribute("hidden"))?.querySelector("h2")?.textContent;
		const click = (action: string) => {
			const button = [...doc.querySelectorAll<HTMLButtonElement>(`button[data-action="${action}"]`)].find((candidate) => {
				for (let node: Element | null = candidate; node; node = node.parentElement) {
					if (node.hasAttribute("hidden")) {
						return false;
					}
				}
				return true;
			});
			button?.click();
		};

		await vi.waitFor(() => expect(heading()).toBe("Connect Deckify to Spotify"));
		// The launch code is gone from the address bar and can't be used again.
		expect(window.location.hash).toBe("");
		expect((await setup.session()).status).toBe(403);

		click("start-setup");
		click("step-next");
		click("step-next");
		(doc.getElementById("client-id") as HTMLInputElement).value = FAKE.clientId;
		doc.getElementById("client-id")?.dispatchEvent(new window.Event("input"));
		click("save-client-id");
		await vi.waitFor(() => expect(heading()).toBe("Connect Spotify"));
		expect(setup.saveClientId).toHaveBeenCalledWith(FAKE.clientId);

		click("connect");
		await vi.waitFor(() => expect(heading()).toContain("You're connected"));
		expect(doc.getElementById("account-name")?.textContent).toBe("Test Listener");

		// Choose → Play: the recommended experience is preselected; nothing is switched until the user confirms.
		click("experience-start");
		expect(heading()).toBe("Choose your Deckify experience");
		expect(doc.querySelector('[data-experience="deckify"]')?.getAttribute("aria-checked")).toBe("true");
		expect(setup.switchToProfile).not.toHaveBeenCalled();
		click("experience-use");
		await vi.waitFor(() => expect(heading()).toBe("Finish in Stream Deck"));
		expect(setup.switchToProfile.mock.calls).toEqual([["mk2-device", "profiles/Deckify"]]);
		click("experience-done");
		expect(heading()).toBe("Deckify is ready.");
		expect(doc.getElementById("ready-experience")?.textContent).toBe("DECKIFY · Recommended");

		click("finish");
		await vi.waitFor(() => expect(setup.server.port).toBeUndefined());
		await vi.waitFor(() => expect(heading()).toBe("You're all set"));
		dom.window.close();
	});
});
