/**
 * Release safeguards, run by .github/workflows/release.yml. It builds and publishes nothing: it only refuses a release that doesn't add up.
 *
 *   node scripts/release-check.mjs v1.0.0              # before building: the tag matches the project version, and release notes exist
 *   node scripts/release-check.mjs v1.0.0 --package    # after `npm run pack`: the package is that version and bundles the Windows helper
 *
 * The release version lives in three files, in two formats, and all must match the tag (`v1.2.3`):
 * - `package.json` and `package-lock.json`: npm's three-part version, `1.2.3`;
 * - the Stream Deck manifest's `Version`: Stream Deck's four-part version, the same three parts plus `.0` (`1.2.3.0`).
 *
 * The Windows helper's `Cargo.toml` version is the version of an internal crate that is never published on its own; it is not a release
 * version and is not checked.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { HELPER_ENTRY, listZipEntries, MANIFEST_ENTRY, PACKAGE_NAME, readZipEntry } from "./pack.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The version a release tag names.
 * @param {string} tag A tag such as `v1.0.0`.
 * @returns {string | undefined} `1.0.0`, or `undefined` when the tag isn't `v` followed by a three-part version.
 */
export function tagVersion(tag) {
	return /^v(\d+\.\d+\.\d+)$/.exec(tag)?.[1];
}

/**
 * The release notes file for a tag: the GitHub Release body.
 * @param {string} tag A tag such as `v1.0.0`.
 * @returns {string} Repository-relative path.
 */
export function releaseNotesFile(tag) {
	return `docs/releases/${tag}.md`;
}

/**
 * Checks that every release version in the project is the tag's version.
 * @param {string} version The tag's version, e.g. `1.0.0`.
 * @param {{ pkg: { version?: unknown }, lock: { version?: unknown, packages?: Record<string, { version?: unknown }> }, manifest: { Version?: unknown } }} files
 *   Parsed `package.json`, `package-lock.json` and plugin manifest.
 * @returns {string[]} What disagrees.
 */
export function versionProblems(version, { pkg, lock, manifest }) {
	const expected = [
		["package.json version", pkg.version, version],
		["package-lock.json version", lock.version, version],
		['package-lock.json packages[""].version', lock.packages?.[""]?.version, version],
		["manifest.json Version", manifest.Version, `${version}.0`],
	];
	return expected
		.filter(([, actual, wanted]) => actual !== wanted)
		.map(([field, actual, wanted]) => `${String(field)} is ${JSON.stringify(actual)}, but the tag needs ${JSON.stringify(wanted)}.`);
}

/**
 * Checks a built package against the release: the manifest version, and the Windows media bridge.
 * @param {string[]} entries The package's ZIP entry names.
 * @param {{ Version?: unknown }} packagedManifest The manifest read from the package.
 * @param {string} version The tag's version, e.g. `1.0.0`.
 * @returns {string[]} What is wrong.
 */
export function packageProblems(entries, packagedManifest, version) {
	const problems = [];
	if (packagedManifest.Version !== `${version}.0`) {
		problems.push(`The packaged manifest is version ${JSON.stringify(packagedManifest.Version)}, not ${version}.0.`);
	}
	if (!entries.includes(HELPER_ENTRY)) {
		problems.push(`The package does not contain the Windows media bridge (${HELPER_ENTRY}). Release packages must be built on Windows.`);
	}
	return problems;
}

/** @param {string} file Repository-relative path. */
const readJson = (file) => JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));

/**
 * Runs the checks for a tag.
 * @param {string | undefined} tag The tag being released.
 * @param {boolean} checkPackage Also check dist/'s package.
 * @returns {string[]} What is wrong.
 */
function check(tag, checkPackage) {
	const version = tag === undefined ? undefined : tagVersion(tag);
	if (tag === undefined || version === undefined) {
		return [`Release tags look like v1.2.3, not ${JSON.stringify(tag)}.`];
	}
	const problems = versionProblems(version, {
		pkg: readJson("package.json"),
		lock: readJson("package-lock.json"),
		manifest: readJson("com.marting.deckify.sdPlugin/manifest.json"),
	});
	if (!existsSync(path.join(ROOT, releaseNotesFile(tag)))) {
		problems.push(`There are no release notes for ${tag}: add ${releaseNotesFile(tag)}.`);
	}
	if (checkPackage) {
		const packageFile = path.join(ROOT, "dist", PACKAGE_NAME);
		if (!existsSync(packageFile)) {
			return [...problems, `The package dist/${PACKAGE_NAME} doesn't exist. Run npm run pack first.`];
		}
		const zip = readFileSync(packageFile);
		problems.push(...packageProblems(listZipEntries(zip), JSON.parse(readZipEntry(zip, MANIFEST_ENTRY).toString("utf8")), version));
	}
	return problems;
}

if (import.meta.main) {
	const [tag, option] = process.argv.slice(2);
	if (option !== undefined && option !== "--package") {
		console.error("Usage: node scripts/release-check.mjs <tag> [--package]");
		process.exit(1);
	}
	const problems = check(tag, option === "--package");
	if (problems.length > 0) {
		for (const problem of problems) {
			console.error(problem);
		}
		process.exit(1);
	}
	console.log(option === "--package" ? `Verified: dist/${PACKAGE_NAME} is ${String(tag)} and bundles the Windows media bridge.` : `Verified: ${String(tag)} matches the project version, and its release notes exist.`);
}
