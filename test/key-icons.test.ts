import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain JavaScript build script without type declarations.
import { keyIconFiles } from "../scripts/export-key-icons.mjs";

const IMGS = path.resolve(import.meta.dirname, "..", "com.marting.deckify.sdPlugin", "imgs", "actions");
const files = Object.entries((keyIconFiles as () => Record<string, string>)());

describe("generated key images", () => {
	it("are committed exactly as `npm run assets` generates them", async () => {
		for (const [file, content] of files) {
			await expect(readFile(path.join(IMGS, file), "utf8"), file).resolves.toBe(content);
		}
	});

	it("are self-contained vector images (no external references, scripts or raster data)", () => {
		for (const [, content] of files) {
			expect(content).not.toMatch(/<script|<image|href=|url\(|data:/i);
		}
	});

	it("cover every image the manifest and the volume and Like views use", async () => {
		const manifest = await readFile(path.resolve(IMGS, "../../manifest.json"), "utf8");
		const names = new Set(files.map(([file]) => file));
		const manifestImages = [...manifest.matchAll(/"imgs\/actions\/((?:volume|library)\/[a-z-]+)"/g)].map((ref) => `${ref[1] ?? ""}.svg`);
		expect(manifestImages.length).toBeGreaterThanOrEqual(8);
		for (const image of manifestImages) {
			expect(names).toContain(image);
		}
		for (const image of ["volume-up", "volume-up-disabled", "volume-down", "volume-down-disabled", "speaker", "speaker-muted", "speaker-disabled"]) {
			expect(names).toContain(`volume/${image}.svg`);
		}
		for (const image of ["heart-outline", "heart-filled", "heart-unknown", "heart-disabled"]) {
			expect(names).toContain(`library/${image}.svg`);
		}
	});
});
