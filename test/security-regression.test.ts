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

async function sources(): Promise<{ file: string; text: string }[]> {
	const files = (await Promise.all(SCANNED.map(collect))).flat().filter((f) => /\.(ts|js|mjs|html|json)$/.test(f));
	return Promise.all(files.map(async (file) => ({ file: path.relative(ROOT, file), text: await readFile(file, "utf8") })));
}

function matching(files: { file: string; text: string }[], pattern: RegExp): string[] {
	return files.flatMap(({ file, text }) => text.split("\n").flatMap((line, i) => (pattern.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])));
}

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
		const ui = (await sources()).filter((s) => s.file.startsWith("com.marting.deckify.sdPlugin/ui"));
		expect(matching(ui, /localStorage|sessionStorage|indexedDB|document\.cookie/)).toEqual([]);
		expect(matching(ui, /access_?token|refresh_?token|code_?verifier/i)).toEqual([]);
	});

	it("loads no remote scripts or styles in the Property Inspector", async () => {
		const ui = (await sources()).filter((s) => s.file.endsWith(".html"));
		expect(matching(ui, /(src|href)=["']https?:/)).toEqual([]);
	});
});
