import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BRIDGE_SPAWN_OPTIONS, parseBridgeLine, WindowsMediaBridge } from "../src/windows/media-bridge";
import { recordingLogger } from "./helpers";

type Request = { id: string; type: string; command?: string };

/**
 * A fake helper process. `respond` decides the reply to each request: an object to send, a raw string, or `undefined` for no reply.
 */
class FakeHelper extends EventEmitter {
	readonly stdin = new PassThrough();
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly requests: Request[] = [];
	readonly rawLines: string[] = [];
	killed = false;
	respond: (request: Request) => object | string | undefined = (r) =>
		r.type === "ping" ? { id: r.id, ok: true, pong: true, spotifySession: true, version: "0.1.0" } : { id: r.id, ok: true, handled: true };

	constructor(autoSpawn = true) {
		super();
		let buffer = "";
		this.stdin.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				this.rawLines.push(line);
				const request = JSON.parse(line) as Request;
				this.requests.push(request);
				const reply = this.respond(request);
				if (reply !== undefined) {
					this.reply(reply);
				}
				newline = buffer.indexOf("\n");
			}
		});
		if (autoSpawn) {
			queueMicrotask(() => this.emit("spawn"));
		}
	}

	reply(reply: object | string): void {
		this.stdout.write(`${typeof reply === "string" ? reply : JSON.stringify(reply)}\n`);
	}

	kill(): boolean {
		this.killed = true;
		queueMicrotask(() => this.crash(null, "SIGTERM"));
		return true;
	}

	crash(code: number | null = 1, signal: string | null = null): void {
		this.emit("exit", code, signal);
	}
}

function setup(options: { exists?: boolean; helper?: () => FakeHelper; commandTimeoutMs?: number } = {}) {
	const helpers: FakeHelper[] = [];
	const spawn = vi.fn((_path: string) => {
		const helper = options.helper?.() ?? new FakeHelper();
		helpers.push(helper);
		return helper as unknown as ChildProcessWithoutNullStreams;
	});
	const logger = recordingLogger();
	let now = 0;
	const bridge = new WindowsMediaBridge({
		executablePath: "C:\\Deckify\\com.marting.deckify.sdPlugin\\bin\\native\\deckify-media-bridge.exe",
		spawn,
		exists: () => options.exists ?? true,
		logger,
		clock: () => now,
		commandTimeoutMs: options.commandTimeoutMs ?? 1_500,
	});
	return { bridge, spawn, helpers, logger, advanceClock: (ms: number) => (now += ms), current: () => helpers.at(-1) as FakeHelper };
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("WindowsMediaBridge process", () => {
	it("starts one persistent hidden process for many requests", async () => {
		const ctx = setup();
		for (const command of ["toggle", "next", "previous", "play", "pause"] as const) {
			await expect(ctx.bridge.execute(command)).resolves.toEqual({ status: "handled" });
		}
		await expect(ctx.bridge.isAvailable()).resolves.toBe(true);

		expect(ctx.spawn).toHaveBeenCalledTimes(1);
		expect(ctx.spawn).toHaveBeenCalledWith("C:\\Deckify\\com.marting.deckify.sdPlugin\\bin\\native\\deckify-media-bridge.exe");
		expect(ctx.current().requests.map((r) => r.command ?? r.type)).toEqual(["toggle", "next", "previous", "play", "pause", "ping"]);
	});

	it("launches the helper directly: no shell, hidden window, piped stdio", () => {
		expect(BRIDGE_SPAWN_OPTIONS).toEqual({ stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
	});

	it("sends only small, fixed-shape JSON lines with increasing IDs (no credentials, no metadata)", async () => {
		const ctx = setup();
		await ctx.bridge.execute("next");
		await ctx.bridge.isAvailable();
		expect(ctx.current().rawLines).toEqual(['{"id":"1","type":"command","command":"next"}', '{"id":"2","type":"ping"}']);
	});

	it("never sends commands outside the known set", async () => {
		const ctx = setup();
		await expect(ctx.bridge.execute("seek" as never)).resolves.toEqual({ status: "unavailable", reason: "unsupported-command" });
		expect(ctx.spawn).not.toHaveBeenCalled();
	});

	it("correlates concurrent requests answered out of order", async () => {
		const held: Request[] = [];
		const ctx = setup({
			helper: () => {
				const helper = new FakeHelper();
				helper.respond = (r) => {
					held.push(r);
					return undefined;
				};
				return helper;
			},
		});
		const first = ctx.bridge.execute("next");
		const second = ctx.bridge.isAvailable();
		const third = ctx.bridge.execute("previous");
		await vi.advanceTimersByTimeAsync(0);
		expect(held.map((r) => r.id)).toEqual(["1", "2", "3"]);

		ctx.current().reply({ id: "3", ok: true, handled: false, reason: "command-rejected" });
		ctx.current().reply({ id: "2", ok: true, pong: true, spotifySession: false, version: "0.1.0" });
		ctx.current().reply({ id: "1", ok: true, handled: true });

		await expect(first).resolves.toEqual({ status: "handled" });
		await expect(second).resolves.toBe(false);
		await expect(third).resolves.toEqual({ status: "unavailable", reason: "command-rejected" });
	});
});

describe("WindowsMediaBridge results", () => {
	it.each([
		[{ ok: true, handled: false, reason: "spotify-session-unavailable" }, { status: "unavailable", reason: "spotify-session-unavailable" }],
		[{ ok: true, handled: false, reason: "media-manager-unavailable" }, { status: "unavailable", reason: "media-manager-unavailable" }],
		[{ ok: false, error: "invalid-request" }, { status: "unavailable", reason: "invalid-request" }],
		[{ ok: false, error: "command-failed" }, { status: "uncertain", reason: "command-failed" }],
		[{ ok: true, pong: true, spotifySession: true }, { status: "uncertain", reason: "malformed-response" }],
		[{ ok: true, handled: false }, { status: "uncertain", reason: "malformed-response" }],
		[{ ok: "yes" }, { status: "uncertain", reason: "malformed-response" }],
	])("maps %j to %j", async (reply, expected) => {
		const ctx = setup({
			helper: () => {
				const helper = new FakeHelper();
				helper.respond = (r) => ({ id: r.id, ...reply });
				return helper;
			},
		});
		await expect(ctx.bridge.execute("next")).resolves.toEqual(expected);
	});

	it("ignores garbage lines and unknown IDs; the request then times out as uncertain", async () => {
		const ctx = setup({
			helper: () => {
				const helper = new FakeHelper();
				helper.respond = () => "this is not json";
				return helper;
			},
		});
		const pending = ctx.bridge.execute("next");
		await vi.advanceTimersByTimeAsync(0);
		ctx.current().reply({ id: "999", ok: true, handled: true });
		ctx.current().reply("x".repeat(5000));
		await vi.advanceTimersByTimeAsync(1_500);
		await expect(pending).resolves.toEqual({ status: "uncertain", reason: "timeout" });
	});

	it("treats a timed-out command as uncertain, kills the hung helper and starts a fresh one", async () => {
		let first = true;
		const ctx = setup({
			helper: () => {
				const helper = new FakeHelper();
				if (first) {
					first = false;
					helper.respond = () => undefined;
				}
				return helper;
			},
		});
		const pending = ctx.bridge.execute("toggle");
		await vi.advanceTimersByTimeAsync(1_500);
		await expect(pending).resolves.toEqual({ status: "uncertain", reason: "timeout" });
		expect(ctx.helpers[0]?.killed).toBe(true);

		await vi.advanceTimersByTimeAsync(0);
		await expect(ctx.bridge.execute("toggle")).resolves.toEqual({ status: "handled" });
		expect(ctx.spawn).toHaveBeenCalledTimes(2);
	});

	it("resolves pending commands as uncertain when the helper crashes, then restarts on demand", async () => {
		let first = true;
		const ctx = setup({
			helper: () => {
				const helper = new FakeHelper();
				if (first) {
					first = false;
					helper.respond = () => undefined;
				}
				return helper;
			},
		});
		const a = ctx.bridge.execute("next");
		const b = ctx.bridge.isAvailable();
		await vi.advanceTimersByTimeAsync(0);
		ctx.current().crash(3221225477);

		await expect(a).resolves.toEqual({ status: "uncertain", reason: "exited" });
		await expect(b).resolves.toBe(false);
		expect(ctx.logger.lines.some((l) => l.includes("Windows media bridge exited"))).toBe(true);

		await expect(ctx.bridge.execute("next")).resolves.toEqual({ status: "handled" });
		expect(ctx.spawn).toHaveBeenCalledTimes(2);
	});

	it("reports unavailable (safe fallback) when the helper cannot be started", async () => {
		const ctx = setup({
			helper: () => {
				const helper = new FakeHelper(false);
				helper.respond = () => undefined;
				queueMicrotask(() => helper.emit("error", Object.assign(new Error("spawn EACCES"), { code: "EACCES" })));
				return helper;
			},
		});
		await expect(ctx.bridge.execute("next")).resolves.toEqual({ status: "unavailable", reason: "spawn-failed" });
		expect(ctx.logger.lines.some((l) => l.includes("using Spotify Web API fallback"))).toBe(true);
		expect(ctx.logger.lines.some((l) => l.includes("exited"))).toBe(false);
	});

	it("reports unavailable without spawning when the helper executable is missing, and logs it once", async () => {
		const ctx = setup({ exists: false });
		await expect(ctx.bridge.execute("toggle")).resolves.toEqual({ status: "unavailable", reason: "not-running" });
		await expect(ctx.bridge.execute("next")).resolves.toEqual({ status: "unavailable", reason: "not-running" });
		await expect(ctx.bridge.isAvailable()).resolves.toBe(false);

		expect(ctx.spawn).not.toHaveBeenCalled();
		expect(ctx.logger.lines.filter((l) => l.includes("Windows media bridge unavailable (helper not found); using Spotify Web API fallback."))).toHaveLength(1);
	});

	it("stops restarting a crashing helper within the restart window, then tries again later", async () => {
		const ctx = setup({
			helper: () => {
				const helper = new FakeHelper();
				helper.respond = () => {
					queueMicrotask(() => helper.crash(1));
					return undefined;
				};
				return helper;
			},
		});
		for (let i = 0; i < 3; i++) {
			await expect(ctx.bridge.execute("next")).resolves.toEqual({ status: "uncertain", reason: "exited" });
		}
		await expect(ctx.bridge.execute("next")).resolves.toEqual({ status: "unavailable", reason: "not-running" });
		expect(ctx.spawn).toHaveBeenCalledTimes(3);
		expect(ctx.logger.lines.filter((l) => l.includes("keeps failing"))).toHaveLength(1);

		ctx.advanceClock(61_000);
		await expect(ctx.bridge.execute("next")).resolves.toEqual({ status: "uncertain", reason: "exited" });
		expect(ctx.spawn).toHaveBeenCalledTimes(4);
	});

	it("cleans up on dispose: pending requests resolve safely, the helper is stopped, and nothing restarts", async () => {
		const ctx = setup({
			helper: () => {
				const helper = new FakeHelper();
				helper.respond = () => undefined;
				return helper;
			},
		});
		const pending = ctx.bridge.execute("next");
		await vi.advanceTimersByTimeAsync(0);
		ctx.bridge.dispose();

		await expect(pending).resolves.toEqual({ status: "unavailable", reason: "disposed" });
		expect(ctx.helpers[0]?.killed).toBe(true);
		expect(ctx.helpers[0]?.stdin.writableEnded).toBe(true);
		await expect(ctx.bridge.execute("next")).resolves.toEqual({ status: "unavailable", reason: "not-running" });
		expect(ctx.spawn).toHaveBeenCalledTimes(1);
	});

	it("logs readiness once with the local Spotify session status", async () => {
		const ctx = setup();
		ctx.bridge.start();
		await vi.advanceTimersByTimeAsync(0);
		await ctx.bridge.isAvailable();
		expect(ctx.logger.lines.filter((l) => l.includes("Windows media bridge ready (local Spotify session: found)."))).toHaveLength(1);
	});
});

describe("parseBridgeLine", () => {
	it("accepts only well-formed responses", () => {
		expect(parseBridgeLine('{"id":"1","ok":true,"handled":true}')).toEqual({ id: "1", response: { kind: "handled" } });
		expect(parseBridgeLine('{"id":"1","ok":true,"handled":false,"reason":"spotify-session-unavailable"}').response).toEqual({
			kind: "not-handled",
			reason: "spotify-session-unavailable",
		});
		expect(parseBridgeLine('{"id":"a_b-1","ok":true,"pong":true,"spotifySession":false}').response).toEqual({ kind: "pong", spotifySession: false });
		expect(parseBridgeLine('{"id":"1","ok":false,"error":"command-failed"}').response).toEqual({ kind: "error", error: "command-failed" });
	});

	it("rejects malformed or suspicious lines", () => {
		for (const line of ["", "nope", "[]", "null", '{"id":"1"}', '{"id":"1","ok":true,"handled":false,"reason":"<script>"}', '{"id":"1","ok":false,"error":"Bad Error"}']) {
			expect(parseBridgeLine(line).response).toEqual({ kind: "malformed" });
		}
		expect(parseBridgeLine('{"id":"has space","ok":true,"handled":true}').id).toBeUndefined();
		expect(parseBridgeLine(`{"id":"1","ok":true,"handled":true,"pad":"${"x".repeat(5000)}"}`)).toEqual({ id: undefined, response: { kind: "malformed" } });
	});
});
