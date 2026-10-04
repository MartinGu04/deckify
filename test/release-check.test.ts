import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as releaseScript from "../scripts/release-check.mjs";

type Files = { pkg: { version?: unknown }; lock: { version?: unknown; packages?: Record<string, { version?: unknown }> }; manifest: { Version?: unknown } };
const release = releaseScript as {
	tagVersion: (tag: string) => string | undefined;
	releaseNotesFile: (tag: string) => string;
	versionProblems: (version: string, files: Files) => string[];
	packageProblems: (entries: string[], packagedManifest: { Version?: unknown }, version: string) => string[];
};

const ROOT = path.resolve(import.meta.dirname, "..");
const readJson = (file: string) => JSON.parse(readFileSync(path.join(ROOT, file), "utf8")) as Record<string, unknown>;
const files = (): Files => ({ pkg: readJson("package.json"), lock: readJson("package-lock.json"), manifest: readJson("com.marting.deckify.sdPlugin/manifest.json") });
const HELPER = "com.marting.deckify.sdPlugin/bin/native/deckify-media-bridge.exe";

describe("release check (run by the release workflow before publishing)", () => {
	it("accepts only v-prefixed three-part version tags", () => {
		expect(release.tagVersion("v1.0.0")).toBe("1.0.0");
		expect(release.tagVersion("v12.3.45")).toBe("12.3.45");
		for (const tag of ["1.0.0", "v1.0", "v1.0.0.0", "v1.0.0-beta", "release-1.0.0", "v1.0.0 "]) {
			expect(release.tagVersion(tag), tag).toBeUndefined();
		}
	});

	it("passes for the project's current version, which has release notes", () => {
		const version = readJson("package.json").version as string;
		expect(release.versionProblems(version, files())).toEqual([]);
		expect(existsSync(path.join(ROOT, release.releaseNotesFile(`v${version}`)))).toBe(true);
	});

	it("refuses a tag that doesn't match package.json, package-lock.json and the manifest", () => {
		expect(release.versionProblems("1.0.1", files())).toHaveLength(4);
		const stale = { ...files(), manifest: { Version: "0.9.0.0" } };
		expect(release.versionProblems("1.0.0", stale)).toEqual(['manifest.json Version is "0.9.0.0", but the tag needs "1.0.0.0".']);
	});

	it("refuses a package with another version or without the Windows media bridge", () => {
		const entries = ["com.marting.deckify.sdPlugin/manifest.json", HELPER];
		expect(release.packageProblems(entries, { Version: "1.0.0.0" }, "1.0.0")).toEqual([]);
		expect(release.packageProblems(entries, { Version: "0.9.0.0" }, "1.0.0")).toHaveLength(1);
		expect(release.packageProblems(entries.slice(0, 1), { Version: "1.0.0.0" }, "1.0.0")).toEqual([
			`The package does not contain the Windows media bridge (${HELPER}). Release packages must be built on Windows.`,
		]);
	});
});
