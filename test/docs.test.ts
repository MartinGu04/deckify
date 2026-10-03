import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as overviewScript from "../scripts/export-deck-overview.mjs";

// Keeps the public documentation in step with the code: facts, links and images, never prose or punctuation.
const ROOT = path.resolve(import.meta.dirname, "..");
const PLUGIN = path.join(ROOT, "com.marting.deckify.sdPlugin");
const overview = overviewScript as { deckOverviewSvg: () => string; OVERVIEW_FILE: string };

type ManifestAction = { Name: string; UUID: string; Icon: string; VisibleInActionsList?: boolean };
type Manifest = { OS: { Platform: string }[]; CategoryIcon: string; Actions: ManifestAction[] };

const read = (file: string) => readFile(path.join(ROOT, file), "utf8").then((text) => text.replaceAll("\r\n", "\n"));
const manifest = async () => JSON.parse(await read("com.marting.deckify.sdPlugin/manifest.json")) as Manifest;

async function markdownFiles(): Promise<string[]> {
	const docs = (await readdir(path.join(ROOT, "docs"), { recursive: true })).filter((f) => f.endsWith(".md")).map((f) => path.join("docs", f));
	return ["README.md", "SECURITY.md", "assets/brand/README.md", ...docs].map((f) => f.replaceAll("\\", "/"));
}

/** Markdown without fenced code blocks and inline code, where example links are not real links. */
function prose(markdown: string): string {
	return markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/** Local link and image targets in a Markdown file. */
function localTargets(markdown: string): string[] {
	const text = prose(markdown);
	const targets = [...text.matchAll(/\]\(([^)\s]+)\)/g), ...text.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? "");
	return targets.filter((target) => !/^(https?:|mailto:)/.test(target));
}

/** GitHub's heading anchors. */
function anchors(markdown: string): Set<string> {
	const headings = [...prose(markdown).matchAll(/^#{1,6} (.+)$/gm)].map((m) => m[1] ?? "");
	return new Set(
		headings.map((heading) =>
			heading
				.replace(/[*_]/g, "")
				.toLowerCase()
				.replace(/[^\p{L}\p{N}\s-]/gu, "")
				.trim()
				.replace(/\s/g, "-"),
		),
	);
}

describe("documentation links and images", () => {
	it("link only to files and headings that exist", async () => {
		const broken: string[] = [];
		for (const file of await markdownFiles()) {
			const markdown = await read(file);
			for (const target of localTargets(markdown)) {
				const [pathPart = "", anchor] = target.split("#");
				const resolved = pathPart === "" ? file : path.posix.join(path.posix.dirname(file), pathPart);
				if (!existsSync(path.join(ROOT, resolved))) {
					broken.push(`${file}: ${target}`);
					continue;
				}
				if (anchor !== undefined && resolved.endsWith(".md") && !anchors(await read(resolved)).has(anchor)) {
					broken.push(`${file}: ${target} (no such heading)`);
				}
			}
		}
		expect(broken).toEqual([]);
	});

	it("reference only local images that exist (no placeholders)", async () => {
		const readme = await read("README.md");
		const images = localTargets(readme).filter((target) => /\.(svg|png|gif|jpe?g|webp|mp4)$/i.test(target));
		expect(images).toEqual(["docs/media/deck-layout-overview.svg"]);
		for (const image of images) {
			expect(existsSync(path.join(ROOT, image)), image).toBe(true);
		}
	});
});

describe("README facts", () => {
	it("lists exactly the public actions in the manifest, and not the hidden Deckify Status", async () => {
		const readme = await read("README.md");
		const table = readme.slice(readme.indexOf("## Actions"), readme.indexOf("## Requirements"));
		const listed = [...table.matchAll(/^\| \*\*([^*]+)\*\* \|/gm)].map((m) => m[1]);
		const visible = (await manifest()).Actions.filter((a) => a.VisibleInActionsList !== false).map((a) => a.Name);
		expect(listed).toEqual(visible);
		expect(readme).not.toMatch(/Deckify Status|com\.marting\.deckify\.status/);
	});

	it("puts Spotify Premium, Windows and the bring-your-own Client ID up front", async () => {
		const readme = await read("README.md");
		const firstScreen = readme.slice(0, readme.indexOf("## What is Deckify?"));
		expect(firstScreen).toContain("Spotify Premium required");
		expect(firstScreen).toContain("Windows");
		const beforeInstall = readme.slice(0, readme.indexOf("### 3. Install Deckify"));
		expect(beforeInstall).toContain("Client ID");
		expect(beforeInstall).toContain("http://127.0.0.1:43821/callback");
	});

	it("never claims macOS support (the plugin is Windows-only)", async () => {
		expect((await manifest()).OS.map((os) => os.Platform)).toEqual(["windows"]);
		const lines = (await read("README.md")).split("\n").filter((line) => /mac ?os/i.test(line));
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) {
			expect(line, line).toMatch(/isn't supported|not supported|^No\.|\?/);
		}
	});

	it("claims no public release, download or Marketplace listing that doesn't exist", async () => {
		const readme = await read("README.md");
		expect(readme).not.toMatch(/marketplace\.elgato\.com|\/releases\/(download|latest|tag)|img\.shields\.io\/(github\/(downloads|v|release|stars)|codecov|coverage)/i);
		expect(readme).not.toMatch(/\[[^\]]*download[^\]]*\]\(/i);
		expect(readme.replace(/\n>\s*/g, " ")).toMatch(/no (downloadable|public) release yet/i);
	});

	it("doesn't put Spotify's logo or the development-era Deckify mark in the README or public media", async () => {
		const readme = await read("README.md");
		expect(readme).not.toMatch(/Spotify_(Full|Primary)_Logo|deckify-(icon|logo)\.png|marketplace(@2x)?\.png|logo=spotify/i);
		const media = (await readdir(path.join(ROOT, "docs", "media"))).filter((f) => f !== "README.md");
		expect(media).toEqual(["deck-layout-overview.svg"]);
		const svg = await read("docs/media/deck-layout-overview.svg");
		expect(svg).not.toMatch(/<image|data:image|\.png|Spotify_/);
	});

	it("never contains secrets", async () => {
		for (const file of await markdownFiles()) {
			const text = await read(file);
			// Spotify access / refresh tokens, 32-hex Client IDs or secrets, and secret assignments.
			expect(text, file).not.toMatch(/\b(BQ|AQ)[\w-]{40,}|(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])|client_secret\s*[=:]|Bearer [\w-]{20,}/i);
		}
	});
});

describe("code facts the documentation relies on", () => {
	it("still never uses the deprecated playlist /tracks or /me/tracks endpoints", async () => {
		const files = (await readdir(path.join(ROOT, "src"), { recursive: true })).filter((f) => f.endsWith(".ts"));
		for (const file of files) {
			const code = (await read(path.join("src", file))).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
			expect(code, file).not.toMatch(/\/playlists\/\$\{[^}]+\}\/tracks|\/me\/tracks/);
		}
	});

	it("keeps action-list and category icons monochrome white on transparent", async () => {
		const { CategoryIcon, Actions } = await manifest();
		for (const icon of [CategoryIcon, ...Actions.map((a) => a.Icon)]) {
			const svg = await read(`com.marting.deckify.sdPlugin/${icon}.svg`);
			const colours = new Set([...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]));
			expect([...colours].filter((c) => c !== "#FFFFFF" && c !== "none"), icon).toEqual([]);
			expect(svg, icon).toMatch(/width="(20|28)" height="(20|28)"/);
		}
	});

	it("keeps the README overview illustration in sync with the shipped key images", async () => {
		expect(await read(path.relative(ROOT, overview.OVERVIEW_FILE))).toBe(overview.deckOverviewSvg());
	});

	it("keeps documentation and brand-review files out of the plugin folder", async () => {
		const files = await readdir(PLUGIN, { recursive: true });
		expect(files.filter((f) => /concept-|deck-layout-overview|deckify-(icon|logo)\.png/.test(f))).toEqual([]);
	});
});

describe("brand-review concepts", () => {
	/** Hue (degrees) and saturation of a hex colour. */
	function hueSaturation(hex: string): [number, number] {
		const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const delta = max - min;
		const saturation = max === 0 ? 0 : delta / max;
		if (delta === 0) {
			return [0, 0];
		}
		const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
		return [(hue * 60 + 360) % 360, saturation];
	}

	it.each(["a", "b", "c", "b1", "b2", "b3", "b1-final"])("concept %s avoids Spotify Green, circles and waves", async (concept) => {
		const svg = await read(`docs/brand-review/concept-${concept}.svg`);
		const colours = [...svg.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0]);
		expect(colours.length).toBeGreaterThan(3);
		for (const colour of colours) {
			const [hue, saturation] = hueSaturation(colour);
			// Spotify Green (#1ED760 / #1DB954) sits around 140°; reject every saturated green.
			expect(saturation < 0.25 || hue < 75 || hue > 175, colour).toBe(true);
		}
		expect(svg).not.toMatch(/<circle|<ellipse/);
		expect(svg).toMatch(/REVIEW (CONCEPT|SHEET)/);
	});

	it("final B1 sheet shows the approved geometry in every required context", async () => {
		const svg = await read("docs/brand-review/concept-b1-final.svg");
		expect(svg).toContain("#7C5CFF");
		// The enlarged key grid: four 15.75 keys with a 3.4 gap inside the unchanged B1 frame.
		expect(svg).toContain("M18 10H50C74 10 90 28 90 50C90 72 74 90 50 90H18A6 6 0 0 1 12 84V16A6 6 0 0 1 18 10Z M27 25H50C65 25 75 36 75 50C75 64 65 75 50 75H27Z");
		for (const [x, y] of [["30.5", "32.55"], ["49.65", "32.55"], ["30.5", "51.7"], ["49.65", "51.7"]]) {
			expect(svg).toContain(`<rect x="${x}" y="${y}" width="15.75" height="15.75" rx="3.4"`);
		}
		for (const part of ["Symbol", "lockup on dark", "lockup on light", "288×288", "Key 144×144", "72×72", "Action glyph 40/20", "category 56/28", "One-colour"]) {
			expect(svg, part).toContain(part);
		}
	});

	it.each(["b1", "b2", "b3"])("refined concept %s uses the Deckify violet and shows every required size", async (concept) => {
		const svg = await read(`docs/brand-review/concept-${concept}.svg`);
		expect(svg).toContain("#7C5CFF");
		for (const part of ["Symbol", "lockup on dark", "lockup on light", "288×288", "Key 144×144", "72×72", "Glyph 40×40 and 20×20", "One-colour"]) {
			expect(svg, part).toContain(part);
		}
	});
});
