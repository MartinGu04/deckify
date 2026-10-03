import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain JavaScript build script without type declarations.
import { keyIconFiles, likeKeyFiles } from "../scripts/export-key-icons.mjs";

const IMGS = path.resolve(import.meta.dirname, "..", "com.marting.deckify.sdPlugin", "imgs", "actions");
const files = Object.entries((keyIconFiles as () => Record<string, string>)());
const likeFiles = Object.entries((likeKeyFiles as () => Record<string, string>)());

describe("generated key images", () => {
	it("are committed exactly as `npm run assets` generates them", async () => {
		for (const [file, content] of [...files, ...likeFiles]) {
			// Git may check text files out with CRLF (e.g. core.autocrlf on Windows); the committed content is what matters.
			const committed = (await readFile(path.join(IMGS, file), "utf8")).replaceAll("\r\n", "\n");
			expect(committed, file).toBe(content);
		}
	});

	it("are self-contained vector images (no external references, scripts or raster data), except Spotify's Like icons (see spotify-like-icon.test.ts)", () => {
		for (const [, content] of files) {
			expect(content).not.toMatch(/<script|<image|href=|url\(|data:/i);
		}
	});

	it("cover every image the manifest and the volume and Like views use", async () => {
		const manifest = await readFile(path.resolve(IMGS, "../../manifest.json"), "utf8");
		const names = new Set([...files, ...likeFiles].map(([file]) => file));
		const manifestImages = [...manifest.matchAll(/"imgs\/actions\/((?:volume|library)\/[a-z-]+)"/g)].map((ref) => `${ref[1] ?? ""}.svg`);
		expect(manifestImages.length).toBeGreaterThanOrEqual(7);
		for (const image of manifestImages) {
			expect(names).toContain(image);
		}
		for (const image of ["volume-up", "volume-up-disabled", "volume-down", "volume-down-disabled", "speaker", "speaker-muted", "speaker-disabled"]) {
			expect(names).toContain(`volume/${image}.svg`);
		}
		for (const image of ["like-add", "like-added", "like-checking", "like-unavailable"]) {
			expect(names).toContain(`library/${image}.svg`);
		}
	});
});
