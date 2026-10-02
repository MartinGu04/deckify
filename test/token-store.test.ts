import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TokenStoreError } from "../src/spotify/errors";
import { EncryptedFileTokenStore, type KeyProtector } from "../src/spotify/storage/encrypted-file-token-store";
import { MemoryTokenStore } from "../src/spotify/storage/token-store";
import { FAKE, findSecrets, storedSession } from "./helpers";

/**
 * Stand-in for DPAPI: "protects" by XOR with a per-user secret and tags the blob. Wrong-user unprotect fails like DPAPI does.
 * @param user Simulated Windows user.
 * @returns The protector.
 */
function fakeProtector(user = "alice"): KeyProtector & { protect: ReturnType<typeof vi.fn>; unprotect: ReturnType<typeof vi.fn> } {
	const mask = Buffer.alloc(32, user);
	const xor = (data: Buffer): Buffer => Buffer.from(data.map((b, i) => b ^ (mask[i % mask.length] ?? 0)));
	return {
		protect: vi.fn((secret: Buffer) => Promise.resolve(Buffer.concat([Buffer.from(`${user}:`), xor(secret)]))),
		unprotect: vi.fn((blob: Buffer) => {
			const prefix = Buffer.from(`${user}:`);
			if (!blob.subarray(0, prefix.length).equals(prefix)) {
				return Promise.reject(new TokenStoreError("Windows DPAPI failed (exit code 1): CryptographicException: Key not valid for use in specified state."));
			}
			return Promise.resolve(xor(blob.subarray(prefix.length)));
		}),
	};
}

let dir: string;
let file: string;

beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "deckify-token-store-"));
	file = path.join(dir, "Deckify", "spotify-session.json");
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("EncryptedFileTokenStore", () => {
	it("round-trips a session", async () => {
		const store = new EncryptedFileTokenStore(file, fakeProtector());
		await store.save(storedSession());
		await expect(new EncryptedFileTokenStore(file, fakeProtector()).load()).resolves.toEqual(storedSession());
	});

	it("never writes tokens in plaintext", async () => {
		await new EncryptedFileTokenStore(file, fakeProtector()).save(storedSession());
		const text = await readFile(file, "utf8");

		expect(findSecrets(text)).toEqual([]);
		expect(text).not.toMatch(/"accessToken"|"refreshToken"/);
		expect(JSON.parse(text)).toMatchObject({ format: "deckify.spotify-session", version: 1, clientId: FAKE.clientId });
	});

	it("only passes the random data key to the protector, never token material", async () => {
		const protector = fakeProtector();
		await new EncryptedFileTokenStore(file, protector).save(storedSession());

		expect(protector.protect).toHaveBeenCalledTimes(1);
		const secret = protector.protect.mock.calls[0]?.[0] as Buffer;
		expect(secret).toHaveLength(32);
		expect(findSecrets(secret.toString("latin1"))).toEqual([]);
	});

	it("caches the data key so refresh saves do not re-invoke DPAPI", async () => {
		const protector = fakeProtector();
		const store = new EncryptedFileTokenStore(file, protector);
		await store.save(storedSession());
		await store.save(storedSession({ accessToken: FAKE.accessToken2 }));
		await store.load();

		expect(protector.protect).toHaveBeenCalledTimes(1);
		expect(protector.unprotect).not.toHaveBeenCalled();
	});

	it("cannot be decrypted by another user", async () => {
		await new EncryptedFileTokenStore(file, fakeProtector("alice")).save(storedSession());
		await expect(new EncryptedFileTokenStore(file, fakeProtector("mallory")).load()).rejects.toBeInstanceOf(TokenStoreError);
	});

	it("detects tampering with the ciphertext or authenticated metadata", async () => {
		await new EncryptedFileTokenStore(file, fakeProtector()).save(storedSession());
		const original = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;

		for (const change of [{ clientId: FAKE.otherClientId }, { authorizedAt: 1 }, { ciphertext: Buffer.from("tampered").toString("base64") }]) {
			await writeFile(file, JSON.stringify({ ...original, ...change }));
			await expect(new EncryptedFileTokenStore(file, fakeProtector()).load()).rejects.toBeInstanceOf(TokenStoreError);
		}
	});

	it("still decrypts after the development refresh test rewrites accessTokenExpiresAt", async () => {
		await new EncryptedFileTokenStore(file, fakeProtector()).save(storedSession());
		const data = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
		await writeFile(file, JSON.stringify({ ...data, accessTokenExpiresAt: 0 }));

		await expect(new EncryptedFileTokenStore(file, fakeProtector()).load()).resolves.toEqual(storedSession({ accessTokenExpiresAt: 0 }));
	});

	it("returns undefined when nothing is stored", async () => {
		await expect(new EncryptedFileTokenStore(file, fakeProtector()).load()).resolves.toBeUndefined();
	});

	it("rejects corrupt files", async () => {
		const store = new EncryptedFileTokenStore(file, fakeProtector());
		await store.save(storedSession());
		for (const content of ["not json", "{}", JSON.stringify({ format: "deckify.spotify-session", version: 2 })]) {
			await writeFile(file, content);
			await expect(new EncryptedFileTokenStore(file, fakeProtector()).load()).rejects.toBeInstanceOf(TokenStoreError);
		}
	});

	it("clear() deletes the file and succeeds when nothing is stored", async () => {
		const store = new EncryptedFileTokenStore(file, fakeProtector());
		await store.save(storedSession());
		await store.clear();

		await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(store.load()).resolves.toBeUndefined();
		await expect(store.clear()).resolves.toBeUndefined();
	});

	it("uses a fresh data key after clear()", async () => {
		const protector = fakeProtector();
		const store = new EncryptedFileTokenStore(file, protector);
		await store.save(storedSession());
		await store.clear();
		await store.save(storedSession());
		expect(protector.protect).toHaveBeenCalledTimes(2);
	});

	it("propagates protector failures as TokenStoreError without writing a file", async () => {
		const protector = fakeProtector();
		protector.protect.mockRejectedValue(new TokenStoreError("Windows PowerShell could not be started to access DPAPI."));
		await expect(new EncryptedFileTokenStore(file, protector).save(storedSession())).rejects.toBeInstanceOf(TokenStoreError);
		await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describe("MemoryTokenStore", () => {
	it("stores, loads and clears", async () => {
		const store = new MemoryTokenStore();
		await store.save(storedSession());
		await expect(store.load()).resolves.toEqual(storedSession());
		await store.clear();
		await expect(store.load()).resolves.toBeUndefined();
	});
});
