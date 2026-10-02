import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithStdioTuple, type StdioPipe } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

import type { LocalCommandResult, LocalPlaybackCommand, LocalPlaybackCommandTransport } from "../playback/local-commands";
import { silentLogger, type Logger } from "../shared/logger";

/** Starts the helper process. Injectable so tests can use a fake process. */
export type SpawnBridgeProcess = (executablePath: string) => ChildProcessWithoutNullStreams;

/**
 * Options for {@link WindowsMediaBridge}.
 */
export type WindowsMediaBridgeOptions = {
	/** Absolute path of `deckify-media-bridge.exe` inside the installed plugin. */
	readonly executablePath: string;
	readonly spawn?: SpawnBridgeProcess;
	readonly exists?: (path: string) => boolean;
	readonly logger?: Logger;
	readonly clock?: () => number;

	/** How long a command may take before its outcome is treated as unknown. */
	readonly commandTimeoutMs?: number;

	/** How long an availability check may take. */
	readonly pingTimeoutMs?: number;

	/** At most this many helper starts within {@link restartWindowMs}; beyond that, the Web API is used until the window passes. */
	readonly maxStartsPerWindow?: number;
	readonly restartWindowMs?: number;
};

/** Commands the helper accepts. Anything else is never sent. */
const COMMANDS: ReadonlySet<string> = new Set<LocalPlaybackCommand>(["toggle", "play", "pause", "next", "previous"]);

/** Longest response line accepted from the helper. */
const MAX_RESPONSE_LENGTH = 4096;

/** A parsed helper response. */
export type BridgeResponse =
	| { readonly kind: "handled" }
	| { readonly kind: "not-handled"; readonly reason: string }
	| { readonly kind: "pong"; readonly spotifySession: boolean }
	| { readonly kind: "error"; readonly error: string }
	| { readonly kind: "malformed" };

/** Why a request got no helper response. */
type RequestFailure = "not-running" | "spawn-failed" | "write-failed" | "timeout" | "exited" | "disposed";

type Reply = BridgeResponse | { readonly kind: "failure"; readonly failure: RequestFailure };

type Pending = { readonly settle: (reply: Reply) => void };

/**
 * Talks to the bundled Windows media-session helper (`deckify-media-bridge.exe`), which sends commands to the local Spotify app through
 * Windows GSMTC and never touches other apps' sessions.
 *
 * - One persistent, hidden helper process (no shell, no console window), started on demand and restarted after a crash within a budget.
 * - JSON-lines requests with correlation IDs; several requests may be pending.
 * - Never throws and never crashes Deckify: if the helper is missing, broken or slow, commands report `unavailable` (safe Web API fallback)
 *   or `uncertain` (possibly performed: no fallback, so a press can never be executed twice).
 * - No Spotify credentials or metadata are ever sent to the helper.
 */
export class WindowsMediaBridge implements LocalPlaybackCommandTransport {
	readonly id = "windows-gsmtc";

	readonly #executablePath: string;
	readonly #spawn: SpawnBridgeProcess;
	readonly #exists: (path: string) => boolean;
	readonly #logger: Logger;
	readonly #clock: () => number;
	readonly #commandTimeoutMs: number;
	readonly #pingTimeoutMs: number;
	readonly #maxStartsPerWindow: number;
	readonly #restartWindowMs: number;

	#child: ChildProcessWithoutNullStreams | undefined;
	#spawned = false;
	readonly #pending = new Map<string, Pending>();
	#nextId = 0;
	readonly #starts: number[] = [];
	#disabled = false;
	#disposed = false;
	#announcedBackoff = false;
	#announcedReady = false;

	/**
	 * Initializes a new instance of the {@link WindowsMediaBridge} class.
	 * @param options Options.
	 */
	constructor(options: WindowsMediaBridgeOptions) {
		this.#executablePath = options.executablePath;
		this.#spawn = options.spawn ?? spawnHidden;
		this.#exists = options.exists ?? existsSync;
		this.#logger = options.logger ?? silentLogger;
		this.#clock = options.clock ?? Date.now;
		this.#commandTimeoutMs = options.commandTimeoutMs ?? 1_500;
		this.#pingTimeoutMs = options.pingTimeoutMs ?? 1_000;
		this.#maxStartsPerWindow = options.maxStartsPerWindow ?? 3;
		this.#restartWindowMs = options.restartWindowMs ?? 60_000;
	}

	/**
	 * Starts the helper ahead of the first key press (so the first command is fast) and logs whether a Spotify session is visible.
	 */
	start(): void {
		void this.isAvailable();
	}

	/** @inheritdoc */
	async execute(command: LocalPlaybackCommand): Promise<LocalCommandResult> {
		if (!COMMANDS.has(command)) {
			return { status: "unavailable", reason: "unsupported-command" };
		}
		const reply = await this.#request({ type: "command", command }, this.#commandTimeoutMs);
		return toCommandResult(reply);
	}

	/** @inheritdoc */
	async isAvailable(): Promise<boolean> {
		const reply = await this.#request({ type: "ping" }, this.#pingTimeoutMs);
		if (reply.kind !== "pong") {
			return false;
		}
		if (!this.#announcedReady) {
			this.#announcedReady = true;
			this.#logger.info(`Windows media bridge ready (local Spotify session: ${reply.spotifySession ? "found" : "not found"}).`);
		}
		return reply.spotifySession;
	}

	/** @inheritdoc */
	dispose(): void {
		this.#disposed = true;
		this.#settleAll({ kind: "failure", failure: "disposed" });
		const child = this.#child;
		this.#child = undefined;
		if (child !== undefined) {
			child.stdin.end();
			child.kill();
		}
	}

	/**
	 * Sends one request and waits for its response.
	 * @param payload Request without ID.
	 * @param timeoutMs Timeout.
	 * @returns The reply.
	 */
	#request(payload: { type: "command"; command: LocalPlaybackCommand } | { type: "ping" }, timeoutMs: number): Promise<Reply> {
		const child = this.#ensureProcess();
		if (child === undefined) {
			return Promise.resolve({ kind: "failure", failure: "not-running" });
		}

		const id = String(++this.#nextId);
		return new Promise<Reply>((resolve) => {
			const timer = setTimeout(() => {
				if (this.#pending.delete(id)) {
					resolve({ kind: "failure", failure: "timeout" });
					// A hung helper is replaced: kill it, and the next request starts a fresh one.
					this.#logger.warn("Windows media bridge did not respond in time; restarting it.");
					child.kill();
				}
			}, timeoutMs);

			this.#pending.set(id, {
				settle: (reply) => {
					clearTimeout(timer);
					resolve(reply);
				},
			});

			child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`, (err) => {
				if (err) {
					// The request never reached the helper, so it was not performed.
					this.#settle(id, { kind: "failure", failure: this.#spawned ? "write-failed" : "spawn-failed" });
				}
			});
		});
	}

	/**
	 * Returns the running helper, starting it when needed and allowed.
	 * @returns The process; otherwise `undefined` when the bridge is unavailable.
	 */
	#ensureProcess(): ChildProcessWithoutNullStreams | undefined {
		if (this.#disposed || this.#disabled) {
			return undefined;
		}
		if (this.#child !== undefined) {
			return this.#child;
		}

		if (!this.#exists(this.#executablePath)) {
			this.#disabled = true;
			this.#logger.info("Windows media bridge unavailable (helper not found); using Spotify Web API fallback.");
			return undefined;
		}

		const now = this.#clock();
		while (this.#starts.length > 0 && now - (this.#starts[0] ?? 0) > this.#restartWindowMs) {
			this.#starts.shift();
		}
		if (this.#starts.length >= this.#maxStartsPerWindow) {
			if (!this.#announcedBackoff) {
				this.#announcedBackoff = true;
				this.#logger.warn("Windows media bridge keeps failing; using Spotify Web API fallback for now.");
			}
			return undefined;
		}
		this.#announcedBackoff = false;
		this.#starts.push(now);

		let child: ChildProcessWithoutNullStreams;
		try {
			child = this.#spawn(this.#executablePath);
		} catch (err) {
			this.#logger.warn("Windows media bridge could not be started; using Spotify Web API fallback.", err);
			return undefined;
		}
		this.#child = child;
		this.#spawned = false;
		this.#announcedReady = false;
		this.#attach(child);
		return child;
	}

	/**
	 * Wires up a new helper process.
	 * @param child The process.
	 */
	#attach(child: ChildProcessWithoutNullStreams): void {
		let stderr = "";
		let started = false;

		child.once("spawn", () => {
			started = true;
			this.#spawned = true;
		});
		child.on("error", (err) => {
			if (this.#child !== child) {
				return;
			}
			this.#child = undefined;
			// A spawn failure means no request reached the helper.
			this.#settleAll({ kind: "failure", failure: this.#spawned ? "exited" : "spawn-failed" });
			this.#logger.warn("Windows media bridge unavailable; using Spotify Web API fallback.", err);
		});
		child.once("exit", (code, signal) => {
			if (this.#child === child) {
				this.#child = undefined;
			}
			this.#settleAll({ kind: "failure", failure: "exited" });
			if (!this.#disposed && started) {
				const detail = stderr.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? "";
				this.#logger.warn(
					`Windows media bridge exited (${signal ?? `code ${String(code)}`})${detail ? `: ${detail}` : ""}; it will be restarted when needed.`,
				);
			}
		});

		child.stdin.on("error", () => undefined);
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderr.length < 1000) {
				stderr += chunk.toString("utf8");
			}
		});
		const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
		lines.on("line", (line) => {
			this.#onLine(line);
		});
	}

	/**
	 * Routes one response line to its pending request.
	 * @param line Raw line.
	 */
	#onLine(line: string): void {
		const { id, response } = parseBridgeLine(line);
		if (id === undefined || !this.#pending.has(id)) {
			this.#logger.debug("Ignored an unexpected Windows media bridge response.");
			return;
		}
		this.#settle(id, response);
	}

	#settle(id: string, reply: Reply): void {
		const pending = this.#pending.get(id);
		if (pending !== undefined) {
			this.#pending.delete(id);
			pending.settle(reply);
		}
	}

	#settleAll(reply: Reply): void {
		for (const id of [...this.#pending.keys()]) {
			this.#settle(id, reply);
		}
	}
}

/**
 * Starts the helper directly (no shell), hidden, with piped stdio.
 * @param executablePath Absolute path of the helper.
 * @returns The process.
 */
function spawnHidden(executablePath: string): ChildProcessWithoutNullStreams {
	return spawn(executablePath, [], BRIDGE_SPAWN_OPTIONS);
}

/** How the helper is started: the absolute executable path directly (no shell, no arguments), hidden, with piped stdio. */
export const BRIDGE_SPAWN_OPTIONS: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe> = {
	stdio: ["pipe", "pipe", "pipe"],
	windowsHide: true,
	shell: false,
};

/**
 * Parses one helper response line defensively.
 * @param line Raw line.
 * @returns The correlation ID (when readable) and the response.
 */
export function parseBridgeLine(line: string): { id: string | undefined; response: BridgeResponse } {
	if (line.length > MAX_RESPONSE_LENGTH) {
		return { id: undefined, response: { kind: "malformed" } };
	}
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return { id: undefined, response: { kind: "malformed" } };
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return { id: undefined, response: { kind: "malformed" } };
	}
	const record = value as Record<string, unknown>;
	const id = typeof record.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(record.id) ? record.id : undefined;
	const token = (field: unknown): string | undefined => (typeof field === "string" && /^[a-z][a-z-]{0,63}$/.test(field) ? field : undefined);

	if (record.ok === true && record.handled === true) {
		return { id, response: { kind: "handled" } };
	}
	if (record.ok === true && record.handled === false) {
		const reason = token(record.reason);
		return { id, response: reason === undefined ? { kind: "malformed" } : { kind: "not-handled", reason } };
	}
	if (record.ok === true && record.pong === true && typeof record.spotifySession === "boolean") {
		return { id, response: { kind: "pong", spotifySession: record.spotifySession } };
	}
	if (record.ok === false) {
		const error = token(record.error);
		return { id, response: error === undefined ? { kind: "malformed" } : { kind: "error", error } };
	}
	return { id, response: { kind: "malformed" } };
}

/**
 * Maps a helper reply to a command result. Only replies that guarantee the command was not performed allow a fallback.
 * @param reply Reply.
 * @returns The result.
 */
function toCommandResult(reply: Reply): LocalCommandResult {
	switch (reply.kind) {
		case "handled":
			return { status: "handled" };
		case "not-handled":
			return { status: "unavailable", reason: reply.reason };
		case "error":
			// "invalid-request" is refused before anything happens; any other error may have happened after the command was issued.
			return reply.error === "invalid-request" ? { status: "unavailable", reason: reply.error } : { status: "uncertain", reason: reply.error };
		case "failure":
			return reply.failure === "timeout" || reply.failure === "exited"
				? { status: "uncertain", reason: reply.failure }
				: { status: "unavailable", reason: reply.failure };
		case "pong":
		case "malformed":
			return { status: "uncertain", reason: "malformed-response" };
	}
}
