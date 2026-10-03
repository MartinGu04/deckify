import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { silentLogger, type Logger } from "../shared/logger";
import { parseSpotifyAccountCommand, type ClientIdProblem, type PublicSpotifyAccountPayload, type SpotifyAccountCommand } from "../spotify/account-commands";
import { SPOTIFY_REDIRECT_PORT } from "../spotify/config";
import type { SpotifyAuthState } from "../spotify/state/auth-state";
import { createSecret, SetupSession } from "./session";

/** The Setup App is only ever served on the IPv4 loopback address. */
export const SETUP_HOST = "127.0.0.1";

/** Path of the Setup App page. */
export const SETUP_PATH = "/setup";

/** Header that carries the session token on every API request. A custom header also means other websites cannot send it without CORS. */
export const SESSION_HEADER = "x-deckify-setup-session";

/** How long a state request waits for a change before answering with the unchanged state. */
export const STATE_WAIT_MS = 25 * 1000;

/** Largest request body accepted (the largest legitimate one is a Client ID). */
const MAX_BODY_BYTES = 4096;

/** How often an idle or expired session is looked for. */
const SWEEP_INTERVAL_MS = 30 * 1000;

/** Binding a dynamic port is retried this many times if the operating system happens to hand out Spotify's callback port. */
const MAX_BIND_ATTEMPTS = 5;

/**
 * The only files the Setup App server serves: URL path → plugin-relative file. Requests are never mapped onto the file system any other way.
 */
export const SETUP_ASSETS: Readonly<Record<string, { readonly file: string; readonly type: string }>> = Object.freeze({
	[SETUP_PATH]: { file: "ui/setup/index.html", type: "text/html; charset=utf-8" },
	[`${SETUP_PATH}/setup.css`]: { file: "ui/setup/setup.css", type: "text/css; charset=utf-8" },
	[`${SETUP_PATH}/setup.js`]: { file: "ui/setup/setup.js", type: "text/javascript; charset=utf-8" },
	[`${SETUP_PATH}/onboarding.js`]: { file: "ui/shared/onboarding.js", type: "text/javascript; charset=utf-8" },
	[`${SETUP_PATH}/icon.svg`]: { file: "ui/setup/icon.svg", type: "image/svg+xml" },
	[`${SETUP_PATH}/icons/now-playing.svg`]: { file: "imgs/actions/playback/now-playing-icon.svg", type: "image/svg+xml" },
	[`${SETUP_PATH}/icons/like.svg`]: { file: "imgs/actions/library/like-icon.svg", type: "image/svg+xml" },
	[`${SETUP_PATH}/icons/playlists.svg`]: { file: "imgs/actions/playlist/add-icon.svg", type: "image/svg+xml" },
	[`${SETUP_PATH}/icons/volume.svg`]: { file: "imgs/actions/volume/volume-up-icon.svg", type: "image/svg+xml" },
});

/** Content Security Policy of every response: the page may load only its own files and talk only to this server. */
const CONTENT_SECURITY_POLICY =
	"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The Setup App URL, with the one-time launch code in the fragment (never sent to any server). */
const SETUP_URL_PATTERN = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/setup#launch=[A-Za-z0-9_-]{43}$/;

/**
 * Whether a URL is a Deckify Setup App URL: loopback, a valid port other than Spotify's callback port, the setup path and a launch code.
 * @param url Candidate URL.
 * @returns `true` only for a well-formed Setup App URL.
 */
export function isDeckifySetupUrl(url: unknown): url is string {
	const match = typeof url === "string" ? SETUP_URL_PATTERN.exec(url) : null;
	const port = Number(match?.[1]);
	return match !== null && port > 0 && port <= 65535 && port !== SPOTIFY_REDIRECT_PORT;
}

/**
 * The account operations the Setup App server needs (see `SpotifyAccountCommands`).
 */
export type SetupAccountCommands = {
	payload(clientIdProblem?: ClientIdProblem): PublicSpotifyAccountPayload;
	run(command: SpotifyAccountCommand): Promise<ClientIdProblem | undefined>;
};

/**
 * Dependencies of {@link DeckifySetupServer}.
 */
export type DeckifySetupServerOptions = {
	readonly commands: SetupAccountCommands;

	/** Shared account state; every change is pushed to a waiting Setup App. */
	readonly state: Pick<SpotifyAuthState, "subscribe">;

	/** Opens a URL in the default browser; only ever called with a {@link isDeckifySetupUrl} URL. */
	readonly openUrl: (url: string) => Promise<void>;

	/** The plugin folder (`com.marting.deckify.sdPlugin`); defaults to the folder of the bundled plugin. */
	readonly pluginDir?: string;
	readonly clock?: () => number;
	readonly logger?: Logger;

	/** Port to ask the operating system for; `0` (the default) means any free port. Tests only. */
	readonly listenPort?: number;

	/** Creates the launch code and session token; tests only. */
	readonly createSecret?: () => string;

	/** How often to look for an ended session; tests only. */
	readonly sweepIntervalMs?: number;
};

/**
 * Serves the Deckify Setup App on `127.0.0.1` and a dynamic port, for one setup session at a time.
 *
 * The browser page is untrusted presentation: it receives only the public account state and may request only the fixed Spotify account
 * commands (plus "finish"). OAuth stays in the auth service and its own callback listener on port 43821. Every request must come to
 * `127.0.0.1:<port>` (DNS rebinding), every API request must carry the session token, and every API POST must come from the Setup App's own
 * origin (CSRF). The server stops when the session finishes, is replaced, idles or expires.
 */
export class DeckifySetupServer {
	readonly #commands: SetupAccountCommands;
	readonly #state: Pick<SpotifyAuthState, "subscribe">;
	readonly #openUrl: (url: string) => Promise<void>;
	readonly #pluginDir: string;
	readonly #clock: () => number;
	readonly #logger: Logger;
	readonly #listenPort: number;
	readonly #createSecret: () => string;
	readonly #sweepIntervalMs: number;

	#server: Server | undefined;
	#port: number | undefined;
	#starting: Promise<number> | undefined;
	#session: SetupSession | undefined;
	#version = 0;
	readonly #waiters = new Set<() => void>();
	#unsubscribe: (() => void) | undefined;
	#sweep: NodeJS.Timeout | undefined;

	/**
	 * Initializes a new instance of the {@link DeckifySetupServer} class.
	 * @param options Dependencies.
	 */
	constructor(options: DeckifySetupServerOptions) {
		this.#commands = options.commands;
		this.#state = options.state;
		this.#openUrl = options.openUrl;
		this.#pluginDir = options.pluginDir ?? fileURLToPath(new URL("../", import.meta.url));
		this.#clock = options.clock ?? Date.now;
		this.#logger = options.logger ?? silentLogger;
		this.#listenPort = options.listenPort ?? 0;
		this.#createSecret = options.createSecret ?? createSecret;
		this.#sweepIntervalMs = options.sweepIntervalMs ?? SWEEP_INTERVAL_MS;
	}

	/**
	 * The port the server listens on, while it runs.
	 * @returns The port; otherwise `undefined`.
	 */
	get port(): number | undefined {
		return this.#port;
	}

	/**
	 * Starts a new setup session (ending any previous one) and opens the Setup App in the default browser.
	 * @param entry Where the Setup App starts.
	 */
	async open(entry: "start" | "account" = "start"): Promise<void> {
		const port = await this.#ensureListening();
		this.#session?.end();
		const session = new SetupSession(entry, this.#clock(), this.#createSecret);
		this.#session = session;
		const url = `http://${SETUP_HOST}:${port}${SETUP_PATH}#launch=${session.launchCode ?? ""}`;
		if (!isDeckifySetupUrl(url)) {
			throw new Error("Refusing to open an invalid Deckify Setup URL.");
		}
		this.#logger.info("Opening Deckify Setup in the default browser.");
		await this.#openUrl(url);
	}

	/**
	 * Ends the session and stops the server. Safe to call more than once.
	 */
	async close(): Promise<void> {
		this.#session?.end();
		this.#session = undefined;
		clearInterval(this.#sweep);
		this.#sweep = undefined;
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		for (const wake of [...this.#waiters]) {
			wake();
		}
		const server = this.#server;
		this.#server = undefined;
		this.#port = undefined;
		this.#starting = undefined;
		if (server !== undefined) {
			await new Promise<void>((resolve) => {
				server.close(() => {
					resolve();
				});
				server.closeAllConnections();
			});
			this.#logger.info("Deckify Setup closed.");
		}
	}

	/**
	 * Starts listening unless already running.
	 * @returns The port.
	 */
	#ensureListening(): Promise<number> {
		if (this.#port !== undefined) {
			return Promise.resolve(this.#port);
		}
		this.#starting ??= this.#listen().catch((err: unknown) => {
			this.#starting = undefined;
			throw err;
		});
		return this.#starting;
	}

	/**
	 * Binds to `127.0.0.1` on a dynamic port that is never Spotify's callback port.
	 * @returns The port.
	 */
	async #listen(): Promise<number> {
		for (let attempt = 1; attempt <= MAX_BIND_ATTEMPTS; attempt++) {
			const server = createServer((req, res) => {
				void this.#handle(req, res);
			});
			server.keepAliveTimeout = 1000;
			const requested = attempt === 1 ? this.#listenPort : 0;
			const port = await new Promise<number | undefined>((resolve, reject) => {
				const onError = (err: NodeJS.ErrnoException): void => {
					// A specific port that is taken: fall back to a dynamic one.
					if (requested !== 0 && err.code === "EADDRINUSE") {
						resolve(undefined);
					} else {
						reject(err);
					}
				};
				server.once("error", onError);
				server.listen({ host: SETUP_HOST, port: requested, exclusive: true }, () => {
					server.off("error", onError);
					resolve((server.address() as AddressInfo).port);
				});
			});
			if (port === undefined) {
				continue;
			}
			if (port === SPOTIFY_REDIRECT_PORT) {
				// Never occupy the port Spotify redirects to; ask for another one.
				await new Promise<void>((resolve) => {
					server.close(() => {
						resolve();
					});
				});
				continue;
			}
			server.on("error", (err) => this.#logger.error("Deckify Setup server error.", err));
			this.#server = server;
			this.#port = port;
			this.#unsubscribe = this.#state.subscribe(() => {
				this.#version++;
				for (const wake of [...this.#waiters]) {
					wake();
				}
			});
			this.#sweep = setInterval(() => {
				if (this.#session === undefined || this.#session.isExpired(this.#clock())) {
					this.#logger.info("Deckify Setup session ended.");
					void this.close();
				}
			}, this.#sweepIntervalMs);
			this.#sweep.unref();
			this.#logger.info(`Deckify Setup is listening on ${SETUP_HOST}:${String(port)}.`);
			return port;
		}
		throw new Error("Could not find a free port for Deckify Setup.");
	}

	/**
	 * Handles one request.
	 * @param req Request.
	 * @param res Response.
	 */
	async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		try {
			const port = this.#port;
			// DNS rebinding: a page on another name that resolves to 127.0.0.1 carries its own Host header.
			if (port === undefined || req.headers.host !== `${SETUP_HOST}:${String(port)}`) {
				send(res, 421, { error: "unexpected-host" });
				return;
			}
			const pathname = new URL(req.url ?? "/", `http://${SETUP_HOST}`).pathname;
			const asset = Object.prototype.hasOwnProperty.call(SETUP_ASSETS, pathname) ? SETUP_ASSETS[pathname] : undefined;

			if (asset !== undefined) {
				if (req.method !== "GET") {
					send(res, 405, { error: "method-not-allowed" });
					return;
				}
				await this.#serveAsset(res, asset);
				return;
			}

			switch (pathname) {
				case "/api/session":
					await this.#handleSession(req, res, port);
					return;
				case "/api/state":
					await this.#handleState(req, res, port);
					return;
				case "/api/command":
					await this.#handleCommand(req, res, port);
					return;
				default:
					send(res, 404, { error: "not-found" });
			}
		} catch (err) {
			this.#logger.error("Deckify Setup request failed.", err);
			if (!res.headersSent) {
				send(res, 500, { error: "internal" });
			}
		}
	}

	/**
	 * Serves one of the allowlisted files.
	 * @param res Response.
	 * @param asset The file.
	 * @param asset.file Plugin-relative path.
	 * @param asset.type Content type.
	 */
	async #serveAsset(res: ServerResponse, asset: { file: string; type: string }): Promise<void> {
		const body = await readFile(path.join(this.#pluginDir, asset.file));
		res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": asset.type, "Content-Length": body.length });
		res.end(body);
	}

	/**
	 * `POST /api/session`: exchanges the one-time launch code for the session token.
	 * @param req Request.
	 * @param res Response.
	 * @param port Server port.
	 */
	async #handleSession(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
		if (!checkApiRequest(req, res, port, "POST")) {
			return;
		}
		const body = await readJson(req, res);
		if (body === undefined) {
			return;
		}
		const session = this.#session;
		const launchCode = typeof body === "object" && body !== null && "launchCode" in body ? body.launchCode : undefined;
		const token = session?.exchange(launchCode, this.#clock());
		if (session === undefined || token === undefined) {
			send(res, 403, { error: "session-expired" });
			return;
		}
		send(res, 200, { sessionToken: token, entry: session.entry });
	}

	/**
	 * `GET /api/state?after=<version>`: the public account state, waiting up to {@link STATE_WAIT_MS} for a newer version.
	 * @param req Request.
	 * @param res Response.
	 * @param port Server port.
	 */
	async #handleState(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
		if (!checkApiRequest(req, res, port, "GET") || !this.#authorize(req, res)) {
			return;
		}
		const after = Number(new URL(req.url ?? "/", `http://${SETUP_HOST}`).searchParams.get("after") ?? "-1");
		if (Number.isInteger(after) && after >= this.#version) {
			await new Promise<void>((resolve) => {
				const wake = (): void => {
					clearTimeout(timer);
					this.#waiters.delete(wake);
					resolve();
				};
				const timer = setTimeout(wake, STATE_WAIT_MS);
				this.#waiters.add(wake);
				res.once("close", wake);
			});
		}
		if (!res.writableEnded && !res.destroyed) {
			send(res, 200, { version: this.#version, ...this.#commands.payload() });
		}
	}

	/**
	 * `POST /api/command`: runs one allowlisted account command, or finishes the session.
	 * @param req Request.
	 * @param res Response.
	 * @param port Server port.
	 */
	async #handleCommand(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
		if (!checkApiRequest(req, res, port, "POST") || !this.#authorize(req, res)) {
			return;
		}
		const body = await readJson(req, res);
		if (body === undefined) {
			return;
		}
		if (typeof body === "object" && body !== null && "type" in body && body.type === "finish") {
			send(res, 200, { finished: true });
			res.once("finish", () => {
				void this.close();
			});
			return;
		}
		const command = parseSpotifyAccountCommand(body);
		if (command === undefined) {
			send(res, 400, { error: "unknown-command" });
			return;
		}
		const problem = await this.#commands.run(command);
		send(res, 200, { version: this.#version, ...this.#commands.payload(problem) });
	}

	/**
	 * Checks the session token header.
	 * @param req Request.
	 * @param res Response (answered 403 on failure).
	 * @returns `true` when authorized.
	 */
	#authorize(req: IncomingMessage, res: ServerResponse): boolean {
		if (this.#session?.authorize(req.headers[SESSION_HEADER], this.#clock()) === true) {
			return true;
		}
		send(res, 403, { error: "session-expired" });
		return false;
	}
}

/** Headers on every response. */
const SECURITY_HEADERS = {
	"Cache-Control": "no-store",
	"Content-Security-Policy": CONTENT_SECURITY_POLICY,
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Resource-Policy": "same-origin",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
} as const;

/**
 * Sends a JSON response.
 * @param res Response.
 * @param status HTTP status.
 * @param body Body.
 */
function send(res: ServerResponse, status: number, body: unknown): void {
	const json = JSON.stringify(body);
	res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(json) });
	res.end(json);
}

/**
 * Rejects API requests that are not same-origin requests from the Setup App (answering them).
 * @param req Request.
 * @param res Response.
 * @param port Server port.
 * @param method Expected method.
 * @returns `true` when the request may proceed.
 */
function checkApiRequest(req: IncomingMessage, res: ServerResponse, port: number, method: "GET" | "POST"): boolean {
	if (req.method !== method) {
		send(res, 405, { error: "method-not-allowed" });
		return false;
	}
	const origin = req.headers.origin;
	const site = req.headers["sec-fetch-site"];
	const sameOrigin = origin === undefined ? method === "GET" : origin === `http://${SETUP_HOST}:${String(port)}`;
	if (!sameOrigin || (site !== undefined && site !== "same-origin")) {
		send(res, 403, { error: "cross-origin" });
		return false;
	}
	if (method === "POST" && !/^application\/json(;|$)/.test(req.headers["content-type"] ?? "")) {
		send(res, 415, { error: "unsupported-media-type" });
		return false;
	}
	return true;
}

/**
 * Reads a small JSON body (answering the request when it is too large or malformed).
 * @param req Request.
 * @param res Response.
 * @returns The parsed body; otherwise `undefined`.
 */
async function readJson(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req as AsyncIterable<Buffer>) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) {
			send(res, 413, { error: "too-large" });
			req.destroy();
			return undefined;
		}
		chunks.push(chunk);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
	} catch {
		send(res, 400, { error: "malformed" });
		return undefined;
	}
}
