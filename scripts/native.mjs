/**
 * Builds and tests the Windows media bridge helper (native/media-bridge, Rust).
 *
 *   node scripts/native.mjs build   # Windows: cargo build --release, then stage the .exe into the plugin (bin/native/)
 *   node scripts/native.mjs test    # any OS: cargo test (protocol, Spotify selection and dispatch tests)
 *
 * Requires the Rust toolchain (rustup); the pinned version is in native/media-bridge/rust-toolchain.toml. End users never need it: the built
 * helper ships inside the .streamDeckPlugin package.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CRATE = path.join(ROOT, "native", "media-bridge");
const MANIFEST = path.join(CRATE, "Cargo.toml");
const BUILT = path.join(CRATE, "target", "release", "deckify-media-bridge.exe");
export const STAGED = path.join(ROOT, "com.marting.deckify.sdPlugin", "bin", "native", "deckify-media-bridge.exe");

/**
 * Runs cargo directly (no shell).
 * @param {string[]} args Arguments.
 */
function cargo(args) {
	const result = spawnSync("cargo", args, { cwd: CRATE, stdio: "inherit", shell: false });
	if (result.error) {
		console.error(`Could not run cargo (${result.error.message}). Install Rust from https://rustup.rs to build the Windows media bridge.`);
		process.exit(1);
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

/**
 * Builds the release helper and stages it into the plugin folder.
 * @returns {boolean} `true` when the helper was built.
 */
export function buildNative() {
	if (process.platform !== "win32") {
		console.log("Skipping the Windows media bridge build (Windows only). The plugin falls back to the Spotify Web API without it.");
		return false;
	}
	cargo(["build", "--release", "--locked", "--manifest-path", MANIFEST]);
	if (!existsSync(BUILT)) {
		console.error(`Build did not produce ${BUILT}.`);
		process.exit(1);
	}
	mkdirSync(path.dirname(STAGED), { recursive: true });
	copyFileSync(BUILT, STAGED);
	console.log(`Staged ${path.relative(ROOT, STAGED)}`);
	return true;
}

if (import.meta.main) {
	const command = process.argv[2];
	if (command === "build") {
		buildNative();
	} else if (command === "test") {
		cargo(["test", "--locked", "--manifest-path", MANIFEST]);
	} else {
		console.error("Usage: node scripts/native.mjs <build|test>");
		process.exit(1);
	}
}
