import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LIKE_KEY_IMAGES } from "../src/actions/like-view";
import { ActionUUID } from "../src/identifiers";
// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as keyIcons from "../scripts/export-key-icons.mjs";
// @ts-expect-error -- plain JavaScript build script without type declarations.
import * as packScript from "../scripts/pack.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PLUGIN = path.join(ROOT, "com.marting.deckify.sdPlugin");
const SOURCE = path.join(ROOT, "assets", "spotify-like-icon");
const pack = packScript as { SPOTIFY_LIKE_ICON: string; requiredFiles: () => string[] };
const icons = keyIcons as { LIKE_ICON_BOX: { x: number; y: number; size: number }; likeKeyFiles: () => Record<string, string> };

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/**
 * SHA-256 of Spotify's official Like icon files exactly as Spotify publishes them on its Design & Branding Guidelines page
 * (https://developer.spotify.com/documentation/design, "like-icon-svg.zip" and "like-icon-png.zip", files dated 2024-09-20). The files must
 * stay byte-for-byte unmodified.
 */
const OFFICIAL_LIKE_ICONS: Readonly<Record<string, string>> = {
	"like-icon-like.svg": "e26c263137d9ea1e75082a3937745d1c030c4a2878605a443492aac905160607",
	"like-icon-liked.svg": "c44b6b5e397af23516c19fe9e3508e679c9e44b2b664b9fe1d0e88ee45e66cab",
	"like-icon-like.png": "213198cad574931cc35d5bc087f4877546abadd43df01dfb9e16a83a24487c09",
	"like-icon-liked.png": "140006fc7b301fa4db7c363d152f7ecd7c9d9c9ed3ba831e9aff4ea317a7a7f3",
};

/**
 * The Spotify PNG embedded in a Like key image.
 * @param svg Key image.
 * @returns The embedded bytes, and every `<image>` element.
 */
function embedded(svg: string): { png: Buffer; images: string[] } {
	const images = [...svg.matchAll(/<image [^>]*\/>/g)].map((m) => m[0]);
	const data = /xlink:href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/.exec(images[0] ?? "")?.[1] ?? "";
	return { png: Buffer.from(data, "base64"), images };
}

describe("Spotify's official Like icons", () => {
	it("are kept exactly as Spotify publishes them (the + icon and its active state, SVG and PNG)", async () => {
		expect((await readdir(SOURCE)).sort()).toEqual(Object.keys(OFFICIAL_LIKE_ICONS).sort());
		for (const [file, hash] of Object.entries(OFFICIAL_LIKE_ICONS)) {
			expect(sha256(await readFile(path.join(SOURCE, file))), file).toBe(hash);
		}
		for (const file of ["like-icon-like.png", "like-icon-liked.png"]) {
			const png = await readFile(path.join(SOURCE, file));
			expect([png.readUInt32BE(16), png.readUInt32BE(20)], file).toEqual([135, 135]);
		}
	});

	it("are the inactive and active Like key images, embedded byte-for-byte at their original proportions with nothing drawn over them", async () => {
		const files = icons.likeKeyFiles();
		expect(Object.keys(files).sort()).toEqual(["library/like-add.svg", "library/like-added.svg"]);
		for (const [state, official] of [
			["add", "like-icon-like.png"],
			["added", "like-icon-liked.png"],
		] as const) {
			const image = LIKE_KEY_IMAGES[state];
			const svg = (await readFile(path.join(PLUGIN, image), "utf8")).replaceAll("\r\n", "\n");
			expect(svg, image).toBe(files[image.replace("imgs/actions/", "")]);
			const { png, images } = embedded(svg);
			expect(images, image).toHaveLength(1);
			expect(sha256(png), image).toBe(OFFICIAL_LIKE_ICONS[official]);
			const { x, y, size } = icons.LIKE_ICON_BOX;
			expect(images[0]).toContain(`x="${String(x)}" y="${String(y)}" width="${String(size)}" height="${String(size)}"`);
			// Spotify's icon is the last element: nothing covers it, and nothing recolours, crops or fades it.
			expect(svg.trim().split("\n").at(-2)?.trim(), image).toBe(images[0]);
			expect(svg, image).not.toMatch(/filter|opacity|mask|clip|transform|preserveAspectRatio|<path|<circle/);
		}
	});

	it("keep checking and unavailable distinguishable with Deckify's own glyphs, never an altered Spotify icon", async () => {
		const images = await Promise.all(Object.values(LIKE_KEY_IMAGES).map((image) => readFile(path.join(PLUGIN, image), "utf8")));
		expect(new Set(images).size).toBe(4);
		for (const state of ["checking", "unavailable"] as const) {
			const svg = await readFile(path.join(PLUGIN, LIKE_KEY_IMAGES[state]), "utf8");
			expect(svg, state).not.toMatch(/<image|data:|href=/);
			expect(svg, state).toContain("Deckify's own glyph");
		}
	});

	it("use Spotify's official + icon, unmodified, as the Like / Unlike action-list icon", async () => {
		const manifest = JSON.parse(await readFile(path.join(PLUGIN, "manifest.json"), "utf8")) as {
			Actions: { UUID: string; Icon: string; States: { Image: string }[] }[];
		};
		const like = manifest.Actions.find((a) => a.UUID === ActionUUID.Like);
		expect(ActionUUID.Like).toBe("com.marting.deckify.spotify.like");
		expect(like?.Icon).toBe("imgs/attribution/like-icon-like");
		expect(like?.States.map((s) => s.Image)).toEqual(["imgs/actions/library/like-unavailable"]);
		expect(pack.SPOTIFY_LIKE_ICON).toBe("imgs/attribution/like-icon-like.svg");
		expect(sha256(await readFile(path.join(PLUGIN, pack.SPOTIFY_LIKE_ICON)))).toBe(OFFICIAL_LIKE_ICONS["like-icon-like.svg"]);
		// Only the SVG ships under that name, so Stream Deck can't pick another file for the extension-less path.
		expect((await readdir(path.join(PLUGIN, "imgs", "attribution"))).filter((f) => f.startsWith("like-icon-like."))).toEqual(["like-icon-like.svg"]);
	});

	it("are required in the package", () => {
		expect(pack.requiredFiles()).toEqual(
			expect.arrayContaining([
				"imgs/attribution/like-icon-like.svg",
				...Object.values(LIKE_KEY_IMAGES),
			]),
		);
	});
});

describe("the heart artwork", () => {
	it("is gone from the plugin, the generators and the README illustration", async () => {
		const plugin = (await readdir(path.join(PLUGIN, "imgs"), { recursive: true })).map(String);
		expect(plugin.filter((file) => /heart/i.test(file))).toEqual([]);
		for (const file of ["scripts/export-key-icons.mjs", "scripts/export-deck-overview.mjs", "src/actions/like-view.ts", "com.marting.deckify.sdPlugin/manifest.json"]) {
			expect(await readFile(path.join(ROOT, file), "utf8"), file).not.toMatch(/heart/i);
		}
		const overview = await readFile(path.join(ROOT, "docs", "media", "deck-layout-overview.svg"), "utf8");
		// The former heart path ("M72 98C60 88 33 71 ...") must not appear anywhere in the illustration.
		expect(overview).not.toContain("M72 98C60 88");
	});
});
