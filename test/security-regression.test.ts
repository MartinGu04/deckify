import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static guards that keep Phase 2's security properties from regressing. Test files are excluded (they contain deliberate negative cases).
const ROOT = path.resolve(import.meta.dirname, "..");
const SCANNED = ["src", "com.marting.deckify.sdPlugin/ui", "com.marting.deckify.sdPlugin/manifest.json", "scripts"];

async function collect(entry: string): Promise<string[]> {
	const full = path.join(ROOT, entry);
	const stats = await readdir(full, { withFileTypes: true }).catch(() => undefined);
	if (stats === undefined) {
		return [full];
	}
	const files = await Promise.all(stats.map((d) => (d.isDirectory() ? collect(path.join(entry, d.name)) : Promise.resolve([path.join(full, d.name)]))));
	return files.flat();
}

/**
 * Converts an absolute path to a repository-relative path with "/" separators on every OS, so assertions and filters on paths behave the
 * same on Windows and Linux.
 * @param file Absolute path.
 * @param root Repository root.
 * @param platformPath Path implementation (injectable to test Windows behaviour on any OS).
 * @returns The POSIX-style relative path.
 */
function toRepoPath(file: string, root = ROOT, platformPath: path.PlatformPath = path): string {
	return platformPath.relative(root, file).split(platformPath.sep).join("/");
}

async function sources(): Promise<{ file: string; text: string }[]> {
	const files = (await Promise.all(SCANNED.map(collect))).flat().filter((f) => /\.(ts|js|mjs|html|json)$/.test(f));
	return Promise.all(files.map(async (file) => ({ file: toRepoPath(file), text: await readFile(file, "utf8") })));
}

async function inspectorSources(): Promise<{ file: string; text: string }[]> {
	const ui = (await sources()).filter((s) => s.file.startsWith("com.marting.deckify.sdPlugin/ui/"));
	// Guard against a filter that silently matches nothing (e.g. a path-separator mismatch), which would make the checks below vacuous.
	expect(ui.map((s) => s.file)).toEqual(
		expect.arrayContaining(["com.marting.deckify.sdPlugin/ui/spotify-account/index.html", "com.marting.deckify.sdPlugin/ui/spotify-account/inspector.js"]),
	);
	return ui;
}

/**
 * Drops matches on comment lines (documentation may name what the code must never do).
 * @param lines Matches from {@link matching}.
 * @returns Matches on code lines.
 */
function codeOnly(lines: string[]): string[] {
	return lines.filter((line) => !/^[^:]+:\d+: (\*|\/\/|\/\*)/.test(line));
}

function matching(files: { file: string; text: string }[], pattern: RegExp): string[] {
	return files.flatMap(({ file, text }) => text.split("\n").flatMap((line, i) => (pattern.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])));
}

describe("security scan paths", () => {
	it("normalizes Windows paths to forward slashes", () => {
		expect(toRepoPath("C:\\work\\deckify\\src\\spotify\\config.ts", "C:\\work\\deckify", path.win32)).toBe("src/spotify/config.ts");
		expect(toRepoPath("C:\\work\\deckify\\com.marting.deckify.sdPlugin\\ui\\spotify-account\\index.html", "C:\\work\\deckify", path.win32)).toBe(
			"com.marting.deckify.sdPlugin/ui/spotify-account/index.html",
		);
	});

	it("keeps POSIX paths unchanged", () => {
		expect(toRepoPath("/work/deckify/src/spotify/config.ts", "/work/deckify", path.posix)).toBe("src/spotify/config.ts");
	});

	it("scans the expected files using forward-slash paths on every OS", async () => {
		const files = (await sources()).map((s) => s.file);
		expect(files).toEqual(
			expect.arrayContaining([
				"src/spotify/config.ts",
				"src/spotify/auth/callback-server.ts",
				"com.marting.deckify.sdPlugin/manifest.json",
				"com.marting.deckify.sdPlugin/ui/spotify-account/index.html",
				"com.marting.deckify.sdPlugin/ui/spotify-account/inspector.js",
				"scripts/dev-expire-spotify-token.mjs",
			]),
		);
		expect(files.filter((file) => file.includes("\\"))).toEqual([]);
	});
});

describe("security regression checks", () => {
	it("never sends or accepts a Spotify client secret", async () => {
		expect(matching(await sources(), /client_secret|clientSecret|client-secret/i)).toEqual([]);
	});

	it("never uses localhost (only the 127.0.0.1 loopback literal)", async () => {
		// The only mentions allowed are the setup guide's warnings against it, in the Spotify Account Property Inspector's copy.
		const warning = /\b(not localhost|Do not use localhost)\b/;
		const mentions = matching(await sources(), /localhost/i);
		const warnings = mentions.filter((line) => line.startsWith("com.marting.deckify.sdPlugin/ui/spotify-account/") && warning.test(line));
		expect(mentions.filter((line) => !warnings.includes(line))).toEqual([]);
		expect(warnings.length).toBeLessThanOrEqual(3);
		for (const line of warnings) {
			// A warning is prose, never an address, a host or a URL.
			expect(line).not.toMatch(/\/\/localhost|localhost:|["'`]localhost|localhost["'`]|=\s*["'`]?localhost/i);
			expect(line.match(/localhost/gi)).toHaveLength(1);
		}
	});

	it("never uses localhost as an address anywhere", async () => {
		expect(matching(await sources(), /\/\/localhost|localhost:\d|host:\s*["'`]localhost/i)).toEqual([]);
	});

	it("only ever uses loopback port 43821 for HTTP", async () => {
		const ports = matching(await sources(), /127\.0\.0\.1:\d+/).filter((line) => !line.includes("127.0.0.1:43821"));
		expect(ports).toEqual([]);
		expect(matching(await sources(), /SPOTIFY_REDIRECT_PORT = /)).toEqual(["src/spotify/config.ts:9: export const SPOTIFY_REDIRECT_PORT = 43821;"]);
	});

	it("defines the redirect URI in exactly one place", async () => {
		expect(matching(await sources(), /export const SPOTIFY_REDIRECT_URI\b/)).toHaveLength(1);
		expect(matching(await sources(), /["'`]https?:\/\/127\.0\.0\.1/)).toEqual([]);
	});

	it("never requests the implicit grant", async () => {
		expect(matching(await sources(), /response_type["']?\s*[:=]\s*["']token["']/)).toEqual([]);
	});

	it("never passes tokens, codes or verifiers to a logger", async () => {
		const logCalls = matching(await sources(), /logger\.(debug|info|warn|error|trace)\(/);
		expect(logCalls.filter((line) => /accessToken\b|refreshToken\b|codeVerifier|\bcode\b(?!_)|tokens\b/.test(line))).toEqual([]);
	});

	it("keeps the Property Inspector free of browser storage", async () => {
		const ui = await inspectorSources();
		expect(matching(ui, /localStorage|sessionStorage|indexedDB|document\.cookie/)).toEqual([]);
		expect(matching(ui, /access_?token|refresh_?token|code_?verifier/i)).toEqual([]);
	});

	it("never runs anything through a shell", async () => {
		const files = (await sources()).filter((s) => s.file.startsWith("src/") || s.file.startsWith("scripts/"));
		expect(matching(files, /shell:\s*true|\bexecSync?\(|\bexecFileSync\(.*shell/)).toEqual([]);
	});

	it("keeps Spotify credentials away from the Windows media bridge", async () => {
		const bridge = (await sources()).filter((s) => s.file.startsWith("src/windows/"));
		expect(bridge.map((s) => s.file)).toEqual(expect.arrayContaining(["src/windows/media-bridge.ts", "src/windows/index.ts"]));
		// The bridge depends only on the transport-independent local command contract and the logger, never on auth, tokens or the API.
		expect(matching(bridge, /from "\.\.\/spotify\//)).toEqual([]);
		expect(matching(bridge, /access_?token|refresh_?token|clientId|client_id|Authorization/i)).toEqual([]);
	});

	it("uses only Spotify's generic library endpoints, never the deprecated /me/tracks ones", async () => {
		const src = (await sources()).filter((s) => s.file.startsWith("src/"));
		expect(codeOnly(matching(src, /\/me\/tracks/))).toEqual([]);
		expect(codeOnly(matching(src, /\/me\/library/)).length).toBeGreaterThanOrEqual(3);
	});

	it("sends Spotify URIs to the library only as an encoded query parameter", async () => {
		const src = (await sources()).filter((s) => s.file.startsWith("src/"));
		const uriParams = codeOnly(matching(src, /uris=/));
		expect(uriParams.length).toBeGreaterThanOrEqual(3);
		expect(uriParams.filter((line) => !line.includes("uris=${encodeTrackUri("))).toEqual([]);
	});

	it("never logs track URIs, titles or artists", async () => {
		const logCalls = matching(await sources(), /logger\.(debug|info|warn|error|trace)\(/);
		expect(logCalls.filter((line) => /\b(uri|trackUri)\b|\.(uri|title|subtitle|item)\b/.test(line))).toEqual([]);
	});

	it("controls volume only through Spotify (no Windows Core Audio) and leaves the native helper protocol unchanged", async () => {
		const src = (await sources()).filter((s) => s.file.startsWith("src/"));
		expect(matching(src, /ISimpleAudioVolume|IAudioEndpointVolume|MMDevice|WASAPI|Core Audio API/i)).toEqual([]);
		const bridge = src.filter((s) => s.file.startsWith("src/windows/"));
		expect(matching(bridge, /volume|library/i)).toEqual([]);
		const native = await Promise.all(
			["native/media-bridge/src/protocol.rs", "native/media-bridge/src/dispatch.rs", "native/media-bridge/src/gsmtc.rs", "native/media-bridge/Cargo.toml"].map(
				async (file) => ({ file, text: await readFile(path.join(ROOT, file), "utf8") }),
			),
		);
		expect(matching(native, /volume|library|playlist|Media_Audio|ISimpleAudioVolume/i)).toEqual([]);
		expect(matching(bridge, /playlist/i)).toEqual([]);
	});

	it("keeps the volume Property Inspector to its one bounded setting", async () => {
		const volume = (await inspectorSources()).filter((s) => s.file.startsWith("com.marting.deckify.sdPlugin/ui/volume/"));
		expect(volume.map((s) => s.file)).toEqual(
			expect.arrayContaining(["com.marting.deckify.sdPlugin/ui/volume/index.html", "com.marting.deckify.sdPlugin/ui/volume/inspector.js"]),
		);
		const sends = matching(volume, /JSON\.stringify\(\{ event: "setSettings"/);
		expect(sends).toHaveLength(1);
		expect(sends[0]).toContain("payload: { volumeStep: step }");
		expect(matching(volume, /fetch\(|XMLHttpRequest|https?:\/\/(?!127\.0\.0\.1)/)).toEqual([]);
	});

	it("never uses the deprecated /playlists/{id}/tracks endpoints (source and, when built, the bundle)", async () => {
		const src = (await sources()).filter((s) => s.file.startsWith("src/"));
		expect(codeOnly(matching(src, /playlists\/[^\n]*\/tracks|\/tracks["'`?]/))).toEqual([]);
		expect(codeOnly(matching(src, /\/playlists\/\$\{[^}]+\}\/items/)).length).toBeGreaterThanOrEqual(2);
		const bundle = await readFile(path.join(ROOT, "com.marting.deckify.sdPlugin/bin/plugin.js"), "utf8").catch(() => undefined);
		if (bundle !== undefined) {
			expect(bundle).not.toMatch(/playlists\/\$\{[^}]+\}\/tracks|\/me\/tracks/);
		}
	});

	it("validates every playlist ID before it reaches a request path", async () => {
		const src = (await sources()).filter((s) => s.file.startsWith("src/"));
		const paths = codeOnly(matching(src, /`\/playlists\/\$\{/));
		expect(paths.length).toBeGreaterThanOrEqual(3);
		expect(paths.filter((line) => !line.includes("/playlists/${checkedId(playlistId)}"))).toEqual([]);
	});

	it("keeps the playlist picker away from Spotify and credentials", async () => {
		const picker = (await inspectorSources()).filter((s) => s.file.startsWith("com.marting.deckify.sdPlugin/ui/playlist/"));
		expect(picker.map((s) => s.file)).toEqual(
			expect.arrayContaining(["com.marting.deckify.sdPlugin/ui/playlist/index.html", "com.marting.deckify.sdPlugin/ui/playlist/inspector.js"]),
		);
		expect(matching(picker, /api\.spotify\.com|accounts\.spotify\.com|fetch\(|XMLHttpRequest|innerHTML|outerHTML|insertAdjacentHTML|"openUrl"|access_?token|refresh_?token|client_?id|Authorization:|Bearer /i)).toEqual([]);
		// The plugin side of the picker never touches the session or tokens.
		const pluginSide = (await sources()).filter((s) => /^src\/actions\/playlist-/.test(s.file) || s.file.startsWith("src/playlists/"));
		expect(pluginSide.length).toBeGreaterThanOrEqual(6);
		expect(matching(pluginSide, /from "\.\.\/spotify\/(auth|storage)|accessToken|refreshToken|clientId/)).toEqual([]);
	});

	it("opens only validated links", async () => {
		const src = (await sources()).filter((s) => s.file.startsWith("src/"));
		const calls = codeOnly(matching(src, /openUrl\(/)).filter((line) => !/^\S+: (export type|readonly|openUrl\(url: string\))/.test(line.replace(/^(\S+:\d+): /, "$1: ")));
		// The auth flow opens Spotify's authorize URL; the playlist picker opens only a link that passed toSpotifyPlaylistUrl; Now Playing opens
		// only a link built by spotifyItemUrl; the Spotify Account action opens only the fixed Spotify Developer Dashboard address.
		expect(calls.map((line) => line.split(":")[0]).sort()).toEqual([
			"src/actions/now-playing.ts",
			"src/actions/playlist-key-action.ts",
			"src/actions/spotify-account.ts",
			"src/plugin.ts",
			"src/plugin.ts",
			"src/plugin.ts",
			"src/plugin.ts",
			"src/spotify/auth/auth-service.ts",
		]);
		expect(calls.find((line) => line.startsWith("src/actions/spotify-account.ts"))).toContain("this.#openUrl(SPOTIFY_DEVELOPER_DASHBOARD_URL)");
		expect(matching(src, /SPOTIFY_DEVELOPER_DASHBOARD_URL = /).map((line) => line.replace(/:\d+: /, ": "))).toEqual([
			'src/spotify/links.ts: export const SPOTIFY_DEVELOPER_DASHBOARD_URL = "https://developer.spotify.com/dashboard";',
		]);
		const pickerOpen = calls.find((line) => line.startsWith("src/actions/playlist-key-action.ts"));
		expect(pickerOpen).toContain("this.#inspector.openUrl(url)");
		const nowPlaying = (await readFile(path.join(ROOT, "src/actions/now-playing.ts"), "utf8")).replaceAll("\r\n", "\n");
		expect(nowPlaying).toContain("const url = snapshot.availability === \"active\" ? spotifyItemUrl(snapshot.item?.uri) : undefined;");
		expect(calls.find((line) => line.startsWith("src/actions/now-playing.ts"))).toContain("this.#openUrl(url)");
	});

	it("never logs playlist or track identifiers or names", async () => {
		const logCalls = matching(await sources(), /logger\.(debug|info|warn|error|trace)\(/);
		expect(logCalls.filter((line) => /playlistId|playlistUri|trackUri|ownerDisplayName|ownerId|playlist\.name|metadata\.name|selection\b/.test(line))).toEqual([]);
	});

	it("keeps the Spotify Account setup page away from Spotify, links, HTML injection and credentials", async () => {
		const account = (await inspectorSources()).filter((s) => s.file.startsWith("com.marting.deckify.sdPlugin/ui/spotify-account/"));
		expect(account.map((s) => s.file).sort()).toEqual([
			"com.marting.deckify.sdPlugin/ui/spotify-account/index.html",
			"com.marting.deckify.sdPlugin/ui/spotify-account/inspector.js",
			"com.marting.deckify.sdPlugin/ui/spotify-account/onboarding.js",
		]);
		// No Spotify endpoints, no network calls, no way to open or navigate to a URL, no HTML built from strings.
		expect(
			matching(account, /api\.spotify\.com|accounts\.spotify\.com|fetch\(|XMLHttpRequest|sendBeacon|window\.open|location\s*=|location\.(href|assign|replace)|innerHTML|outerHTML|insertAdjacentHTML|document\.write|"openUrl"|eval\(/),
		).toEqual([]);
		// The only absolute URL is Stream Deck's own WebSocket; the dashboard address lives in the plugin.
		expect(codeOnly(matching(account, /[a-z]+:\/\//i)).map((line) => line.replace(/^\S+:\d+: /, ""))).toEqual(["socket = new WebSocket(`ws://127.0.0.1:${port}`);"]);
		// Nothing token-shaped, and no input for anything but the Client ID.
		expect(matching(account, /access_?token|refresh_?token|code_?verifier|Authorization:|Bearer |type="password"/i)).toEqual([]);
	});

	it("loads no remote scripts or styles in the Property Inspector", async () => {
		const html = (await inspectorSources()).filter((s) => s.file.endsWith(".html"));
		expect(matching(html, /(src|href)=["']https?:/)).toEqual([]);
	});
});
