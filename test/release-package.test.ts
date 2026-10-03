import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as packScript from "../scripts/pack.mjs";

type Manifest = Record<string, unknown> & { Nodejs?: Record<string, unknown> };
const pack = packScript as {
	MANIFEST_ENTRY: string;
	packRelease: (options: { pluginDir: string; outputDir: string; quiet: boolean }) => string;
	releaseManifest: (manifest: Manifest) => Manifest;
	verifyPackagedManifest: (packaged: Manifest, committed: Manifest) => string[];
	verifyProfileEntries: (entries: string[], manifest: Manifest) => string[];
	listZipEntries: (zip: Buffer) => string[];
	readZipEntry: (zip: Buffer, name: string) => Buffer;
};

const PLUGIN = path.resolve(import.meta.dirname, "..", "com.marting.deckify.sdPlugin");
const committedText = readFileSync(path.join(PLUGIN, "manifest.json"), "utf8");
const committed = JSON.parse(committedText) as Manifest;

describe("release package (packed with the real Stream Deck CLI by the release pipeline)", () => {
	let work: string;
	let zip: Buffer;

	beforeAll(() => {
		// The plugin folder as committed, with a stand-in for the bundled code so the test does not depend on a build.
		work = mkdtempSync(path.join(tmpdir(), "deckify-release-test-"));
		const pluginDir = path.join(work, "com.marting.deckify.sdPlugin");
		cpSync(PLUGIN, pluginDir, { recursive: true, filter: (source) => !["bin", "logs"].includes(path.relative(PLUGIN, source).split(path.sep)[0] ?? "") });
		mkdirSync(path.join(pluginDir, "bin"));
		writeFileSync(path.join(pluginDir, "bin", "plugin.js"), "// stand-in\n");
		zip = readFileSync(pack.packRelease({ pluginDir, outputDir: path.join(work, "dist"), quiet: true }));
	}, 120_000);

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	it("does not enable Node.js debugging in the packaged manifest", () => {
		const packaged = JSON.parse(pack.readZipEntry(zip, pack.MANIFEST_ENTRY).toString("utf8")) as Manifest;
		expect(packaged.Nodejs).toEqual({ Version: "24" });
		expect(pack.verifyPackagedManifest(packaged, committed)).toEqual([]);
	});

	it("is the v1.0 release, with the permanent UUIDs", () => {
		const packaged = JSON.parse(pack.readZipEntry(zip, pack.MANIFEST_ENTRY).toString("utf8")) as Manifest & { Actions: { UUID: string }[] };
		expect([packaged.Version, packaged.Author, packaged.UUID]).toEqual(["1.0.0.0", "MARTIN.G", "com.marting.deckify"]);
		expect(packaged.Actions.map((a) => a.UUID)).toEqual((committed.Actions as { UUID: string }[]).map((a) => a.UUID));
	});

	it("contains both bundled experience profiles and no other", () => {
		const entries = pack.listZipEntries(zip);
		expect(pack.verifyProfileEntries(entries, committed)).toEqual([]);
		expect(entries.filter((entry) => entry.endsWith(".streamDeckProfile")).sort()).toEqual([
			"com.marting.deckify.sdPlugin/profiles/DECKIFY ⭐ Recommended.streamDeckProfile",
			"com.marting.deckify.sdPlugin/profiles/SIMPLE.streamDeckProfile",
		]);
	});

	it("leaves the committed plugin folder untouched", () => {
		expect(readFileSync(path.join(PLUGIN, "manifest.json"), "utf8")).toBe(committedText);
	});
});

describe("release manifest", () => {
	it("drops only Nodejs.Debug", () => {
		const release = pack.releaseManifest(committed);
		expect(release.Nodejs).toEqual({ Version: "24" });
		expect({ ...release, Nodejs: committed.Nodejs }).toEqual(committed);
		expect(committed.Nodejs?.Debug).toBe("enabled");
	});

	it.each(["enabled", "break", "--inspect=127.0.0.1:12345"])("rejects a package whose manifest has Nodejs.Debug %s", (debug) => {
		const packaged = { ...committed, Nodejs: { Version: "24", Debug: debug } };
		expect(pack.verifyPackagedManifest(packaged, committed)).toEqual([`The packaged manifest enables Node.js debugging (Nodejs.Debug: ${JSON.stringify(debug)}).`]);
	});

	it("accepts an explicit disabled, and rejects any other difference from the committed manifest", () => {
		expect(pack.verifyPackagedManifest({ ...committed, Nodejs: { Version: "24", Debug: "disabled" } }, committed)).toEqual([]);
		expect(pack.verifyPackagedManifest({ ...pack.releaseManifest(committed), Version: "0.1.0.0" }, committed)).toEqual([
			"The packaged manifest differs from the committed manifest (other than Nodejs.Debug).",
		]);
	});

	it("reads stored and deflated ZIP entries", () => {
		const text = Buffer.from('{"Nodejs":{"Version":"24"}}');
		const archive = zipOf([
			{ name: "a/stored.json", method: 0, data: text },
			{ name: "a/deflated.json", method: 8, data: deflateRawSync(text) },
		]);
		expect(pack.listZipEntries(archive)).toEqual(["a/stored.json", "a/deflated.json"]);
		expect(pack.readZipEntry(archive, "a/stored.json")).toEqual(text);
		expect(pack.readZipEntry(archive, "a/deflated.json")).toEqual(text);
		expect(() => pack.readZipEntry(archive, "a/missing.json")).toThrow("The archive has no a/missing.json.");
	});
});

/**
 * Builds a minimal ZIP archive (no CRCs: only what the reader uses).
 * @param files Entries with already-compressed data.
 * @returns The archive.
 */
function zipOf(files: { name: string; method: number; data: Buffer }[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const file of files) {
		const name = Buffer.from(file.name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(file.method, 8);
		local.writeUInt32LE(file.data.length, 18);
		local.writeUInt16LE(name.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(file.method, 10);
		central.writeUInt32LE(file.data.length, 20);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, name, file.data);
		centrals.push(central, name);
		offset += local.length + name.length + file.data.length;
	}
	const directory = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}
