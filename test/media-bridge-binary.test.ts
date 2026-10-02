import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { WindowsMediaBridge } from "../src/windows/media-bridge";

// Exercises the real compiled helper through the real bridge (real process, pipes and protocol) when a build is available:
// - Windows CI: the release build staged into the plugin, talking to real GSMTC (no Spotify session on the runner).
// - Elsewhere: a local `cargo build` (no GSMTC: every command reports unavailable).
// Skipped when no build exists (e.g. the Ubuntu CI job, which does not build native code).
const ROOT = path.resolve(import.meta.dirname, "..");
const candidates = [
	process.env.DECKIFY_MEDIA_BRIDGE_PATH,
	path.join(ROOT, "com.marting.deckify.sdPlugin", "bin", "native", "deckify-media-bridge.exe"),
	path.join(ROOT, "native", "media-bridge", "target", "release", process.platform === "win32" ? "deckify-media-bridge.exe" : "deckify-media-bridge"),
	path.join(ROOT, "native", "media-bridge", "target", "debug", process.platform === "win32" ? "deckify-media-bridge.exe" : "deckify-media-bridge"),
].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);
const executable = candidates.find((candidate) => existsSync(candidate) && (process.platform === "win32" || !candidate.endsWith(".exe")));

describe.skipIf(executable === undefined)("real media bridge helper", () => {
	it("answers pings and never reports a command as handled without a Spotify session", async () => {
		const bridge = new WindowsMediaBridge({ executablePath: executable ?? "", commandTimeoutMs: 10_000, pingTimeoutMs: 10_000 });
		try {
			// No Spotify app runs in CI, so no command may be performed (and no other app's session may be used).
			await expect(bridge.isAvailable()).resolves.toBe(false);
			for (const command of ["toggle", "play", "pause", "next", "previous"] as const) {
				const result = await bridge.execute(command);
				expect(result.status).toBe("unavailable");
				expect(["spotify-session-unavailable", "media-manager-unavailable"]).toContain(result.status === "unavailable" ? result.reason : "");
			}
		} finally {
			bridge.dispose();
		}
	}, 30_000);
});
