import { fileURLToPath } from "node:url";

import type { LocalPlaybackCommandTransport } from "../playback/local-commands";
import type { Logger } from "../shared/logger";
import { WindowsMediaBridge } from "./media-bridge";

/**
 * Absolute path of the bundled helper: `<plugin>.sdPlugin/bin/native/deckify-media-bridge.exe`, resolved from the bundled `bin/plugin.js`, so
 * it never depends on the working directory or the repository.
 * @returns The path.
 */
export function bundledMediaBridgePath(): string {
	return fileURLToPath(new URL("native/deckify-media-bridge.exe", import.meta.url));
}

/**
 * Creates the local command transport for this platform: the Windows media bridge on Windows; none elsewhere (the Web API is used).
 * @param logger Logger.
 * @returns The transport, or `undefined` when local control is not supported.
 */
export function createLocalCommandTransport(logger: Logger): LocalPlaybackCommandTransport | undefined {
	if (process.platform !== "win32") {
		return undefined;
	}
	const bridge = new WindowsMediaBridge({ executablePath: bundledMediaBridgePath(), logger });
	bridge.start();
	return bridge;
}
