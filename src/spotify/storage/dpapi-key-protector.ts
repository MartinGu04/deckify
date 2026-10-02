import { spawn } from "node:child_process";
import path from "node:path";

import { TokenStoreError } from "../errors";
import type { KeyProtector } from "./encrypted-file-token-store";

/**
 * Optional entropy mixed into DPAPI; another process running as the same user must also know it to unprotect Deckify's key.
 */
const ENTROPY = "com.marting.deckify/spotify-session-key/v1";

/**
 * PowerShell program shared by protect/unprotect. It reads base64 from stdin, writes base64 to stdout, and on failure writes only the
 * exception type and message to stderr (never the input). `{{OPERATION}}` is `Protect` or `Unprotect`.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
	Add-Type -AssemblyName System.Security
	$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
	$entropy = [Text.Encoding]::UTF8.GetBytes('${ENTROPY}')
	$result = [Security.Cryptography.ProtectedData]::{{OPERATION}}($data, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
	[Array]::Clear($data, 0, $data.Length)
	[Console]::Out.Write([Convert]::ToBase64String($result))
	[Array]::Clear($result, 0, $result.Length)
	exit 0
} catch {
	[Console]::Error.Write($_.Exception.GetType().FullName + ': ' + $_.Exception.Message)
	exit 1
}
`;

/**
 * Options for {@link DpapiKeyProtector}.
 */
export type DpapiKeyProtectorOptions = {
	/** PowerShell executable; defaults to the system's Windows PowerShell (absolute path, so PATH is never consulted). */
	readonly executable?: string;

	/** Arguments passed before the encoded command; only overridden in tests. */
	readonly baseArgs?: readonly string[];

	/** Maximum time for one DPAPI call. */
	readonly timeoutMs?: number;
};

/**
 * Windows DPAPI (CurrentUser scope) via the built-in `System.Security.Cryptography.ProtectedData` class, invoked through Windows PowerShell.
 *
 * The secret is written to the child's stdin, never placed in command-line arguments, and the child never echoes it. Only the same Windows
 * user on the same machine (or their roaming profile) can unprotect the result.
 */
export class DpapiKeyProtector implements KeyProtector {
	/**
	 * Initializes a new instance of the {@link DpapiKeyProtector} class.
	 * @param options Options.
	 */
	constructor(private readonly options: DpapiKeyProtectorOptions = {}) {}

	/** @inheritdoc */
	async protect(secret: Buffer): Promise<Buffer> {
		return this.#run("Protect", secret);
	}

	/** @inheritdoc */
	async unprotect(blob: Buffer): Promise<Buffer> {
		return this.#run("Unprotect", blob);
	}

	/**
	 * Runs the DPAPI operation.
	 * @param operation Operation.
	 * @param input Input bytes.
	 * @returns Output bytes.
	 */
	async #run(operation: "Protect" | "Unprotect", input: Buffer): Promise<Buffer> {
		const stdout = await runPowerShell(SCRIPT.replace("{{OPERATION}}", operation), input.toString("base64"), {
			executable: this.options.executable ?? defaultPowerShellPath(),
			baseArgs: this.options.baseArgs,
			timeoutMs: this.options.timeoutMs ?? 20_000,
		});
		const output = stdout.trim();
		if (output.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(output)) {
			throw new TokenStoreError(`Windows DPAPI ${operation.toLowerCase()} returned no usable data.`);
		}
		return Buffer.from(output, "base64");
	}
}

/**
 * Gets the absolute path of Windows PowerShell 5.1, which ships with every supported Windows version.
 * @returns The executable path.
 */
export function defaultPowerShellPath(): string {
	return path.win32.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/**
 * Runs a PowerShell script, passing `stdinText` via stdin.
 *
 * The script is passed with `-EncodedCommand` (it contains no secrets); sensitive data only travels through stdin/stdout pipes, which are
 * captured in memory and never forwarded to the console or logs. Errors carry at most a short, single-line excerpt of stderr.
 * @param script PowerShell script.
 * @param stdinText Text to write to stdin.
 * @param options Options.
 * @param options.executable Executable path.
 * @param options.baseArgs Arguments placed before the encoded command (defaults to a non-interactive, profile-less invocation).
 * @param options.timeoutMs Timeout.
 * @returns The captured stdout.
 */
export function runPowerShell(
	script: string,
	stdinText: string,
	options: { executable: string; baseArgs?: readonly string[]; timeoutMs: number },
): Promise<string> {
	const args = [
		...(options.baseArgs ?? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"]),
		"-EncodedCommand",
		Buffer.from(script, "utf16le").toString("base64"),
	];

	return new Promise((resolve, reject) => {
		let settled = false;
		const fail = (message: string, cause?: unknown): void => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				reject(new TokenStoreError(message, cause === undefined ? undefined : { cause }));
			}
		};

		const child = spawn(options.executable, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let stderrLength = 0;

		const timer = setTimeout(() => {
			child.kill();
			fail("Windows DPAPI did not respond in time.");
		}, options.timeoutMs);

		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderrLength < 4096) {
				stderr.push(chunk);
				stderrLength += chunk.length;
			}
		});
		child.on("error", (err) => {
			fail("Windows PowerShell could not be started to access DPAPI.", err);
		});
		child.on("close", (code) => {
			if (code === 0) {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					resolve(Buffer.concat(stdout).toString("utf8"));
				}
				return;
			}
			const detail = Buffer.concat(stderr).toString("utf8").split(/\r?\n/)[0]?.trim().slice(0, 200) ?? "";
			fail(`Windows DPAPI failed (exit code ${String(code)})${detail ? `: ${detail}` : ""}.`);
		});

		// A write error (e.g. the process exited early) is reported through "close"/"error".
		child.stdin.on("error", () => undefined);
		child.stdin.end(stdinText, "utf8");
	});
}
