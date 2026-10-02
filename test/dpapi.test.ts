import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TokenStoreError } from "../src/spotify/errors";
import { defaultPowerShellPath, DpapiKeyProtector, runPowerShell } from "../src/spotify/storage/dpapi-key-protector";

// The real DPAPI can only run on Windows; these tests replace powershell.exe with a small Node script to verify the process contract:
// secrets travel via stdin (never argv), output is validated, and failures become TokenStoreError.
const SECRET = "fake-dpapi-secret-material";
let dir: string;
let fakePowerShell: string;
let argvLog: string;

beforeAll(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "deckify-dpapi-"));
	argvLog = path.join(dir, "argv.json");
	fakePowerShell = path.join(dir, "fake-powershell.mjs");
	await writeFile(
		fakePowerShell,
		`#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));
const script = Buffer.from(process.argv.at(-1), "base64").toString("utf16le");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
	if (input.trim() === Buffer.from("FAIL").toString("base64")) {
		process.stderr.write("System.Security.Cryptography.CryptographicException: Key not valid for use in specified state.\\nsecond line");
		process.exit(1);
	}
	if (input.trim() === Buffer.from("HANG").toString("base64")) {
		setInterval(() => {}, 1000);
		return;
	}
	if (input.trim() === Buffer.from("GARBAGE").toString("base64")) {
		process.stdout.write("not base64!");
		return;
	}
	const data = Buffer.from(input.trim(), "base64");
	const out = script.includes("::Protect(") ? Buffer.concat([Buffer.from("P:"), data]) : data.subarray(2);
	process.stdout.write(out.toString("base64"));
});
`,
	);
	await chmod(fakePowerShell, 0o755);
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

const protector = (): DpapiKeyProtector => new DpapiKeyProtector({ executable: fakePowerShell, baseArgs: [], timeoutMs: 5000 });

describe.skipIf(process.platform === "win32")("DpapiKeyProtector process contract", () => {
	it("round-trips through protect and unprotect", async () => {
		const blob = await protector().protect(Buffer.from(SECRET));
		expect(blob.toString()).toBe(`P:${SECRET}`);
		await expect(protector().unprotect(blob)).resolves.toEqual(Buffer.from(SECRET));
	});

	it("passes the secret via stdin, never as a command-line argument", async () => {
		await protector().protect(Buffer.from(SECRET));
		const argv = JSON.parse(await readFile(argvLog, "utf8")) as string[];

		expect(argv[0]).toBe("-EncodedCommand");
		const joined = argv.join(" ");
		expect(joined).not.toContain(SECRET);
		expect(joined).not.toContain(Buffer.from(SECRET).toString("base64"));

		const script = Buffer.from(argv[1] ?? "", "base64").toString("utf16le");
		expect(script).toContain("[Security.Cryptography.DataProtectionScope]::CurrentUser");
		expect(script).toContain("[Console]::In.ReadToEnd()");
		expect(script).not.toContain(SECRET);
	});

	it("reports failures as TokenStoreError with only the first stderr line", async () => {
		const error = await protector()
			.unprotect(Buffer.from("FAIL"))
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(TokenStoreError);
		expect((error as Error).message).toBe(
			"Windows DPAPI failed (exit code 1): System.Security.Cryptography.CryptographicException: Key not valid for use in specified state..",
		);
	});

	it("rejects unusable output", async () => {
		await expect(protector().unprotect(Buffer.from("GARBAGE"))).rejects.toThrow(/no usable data/);
	});

	it("times out", async () => {
		const quick = new DpapiKeyProtector({ executable: fakePowerShell, baseArgs: [], timeoutMs: 300 });
		await expect(quick.protect(Buffer.from("HANG"))).rejects.toThrow(/did not respond in time/);
	});

	it("reports a missing PowerShell executable", async () => {
		await expect(runPowerShell("exit 0", "", { executable: path.join(dir, "missing.exe"), timeoutMs: 1000 })).rejects.toThrow(
			/could not be started/,
		);
	});
});

describe("defaultPowerShellPath", () => {
	it("uses the absolute Windows PowerShell path (never PATH lookup)", () => {
		expect(defaultPowerShellPath()).toMatch(/\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
	});
});
