import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EncryptedFileTokenStore, type KeyProtector } from "../src/spotify/storage/encrypted-file-token-store";
import { findSecrets, storedSession } from "./helpers";

const run = promisify(execFile);
const SCRIPT = path.resolve(import.meta.dirname, "../scripts/dev-expire-spotify-token.mjs");
const protector: KeyProtector = { protect: (k) => Promise.resolve(Buffer.from(k)), unprotect: (b) => Promise.resolve(Buffer.from(b)) };

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "deckify-dev-expire-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("dev:expire-spotify-token", () => {
	it("expires the stored access token without touching or printing secrets", async () => {
		const file = path.join(dir, "spotify-session.json");
		await new EncryptedFileTokenStore(file, protector).save(storedSession());

		const { stdout, stderr } = await run(process.execPath, [SCRIPT, "--file", file]);

		expect(findSecrets(stdout + stderr)).toEqual([]);
		await expect(new EncryptedFileTokenStore(file, protector).load()).resolves.toEqual(storedSession({ accessTokenExpiresAt: 0 }));
	});

	it("fails clearly when no session exists", async () => {
		await expect(run(process.execPath, [SCRIPT, "--file", path.join(dir, "missing.json")])).rejects.toMatchObject({
			stderr: expect.stringContaining("Connect Spotify first") as unknown,
		});
	});
});
