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
		expect(matching(await sources(), /localhost/i)).toEqual([]);
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

	it("loads no remote scripts or styles in the Property Inspector", async () => {
		const html = (await inspectorSources()).filter((s) => s.file.endsWith(".html"));
		expect(matching(html, /(src|href)=["']https?:/)).toEqual([]);
	});
});
