/**
 * Cuts every clip in src/clips.js from the original recordings into JPEG frame sequences (30 fps, the exact size the film shows them at):
 * crop, privacy blur, stabilisation (phone), light clean-up, scale. Frames go to out/clips/<id>/ with out/clips/manifest.json.
 *
 *   node scripts/prepare.mjs --desktop <desktop.mp4> --phone <phone.mp4>
 *
 * Defaults: footage/desktop.mp4 and footage/phone.mp4 (git-ignored). The originals are never modified and never committed: they contain
 * the Client ID and an authorization code in the browser's address bar, which no clip includes.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { CLIPS, FPS, clipFrames } from "../src/clips.js";

const HERE = path.resolve(import.meta.dirname, "..");
const OUT = path.join(HERE, "out", "clips");
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith("--") ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []));
const SOURCES = {
	desktop: path.resolve(args.desktop ?? path.join(HERE, "footage", "desktop.mp4")),
	phone: path.resolve(args.phone ?? path.join(HERE, "footage", "phone.mp4")),
};
const only = args.only?.split(",");

const ffmpeg = (argv) => execFileSync("ffmpeg", ["-v", "error", "-y", ...argv], { stdio: ["ignore", "inherit", "inherit"] });

/**
 * The filter that blurs each box (in the original's pixels) after the crop, only during its time window.
 * @param {object} clip Clip.
 * @returns {string[]} Filter chain segments, from [in] to [blurred].
 */
function blurChain(clip) {
	const [cx, cy] = clip.crop;
	const parts = [];
	let label = "base";
	(clip.blur ?? []).forEach((b, i) => {
		const [x, y, w, h] = b.box;
		const from = (b.from ?? clip.in) - clip.in;
		const to = (b.to ?? clip.out) - clip.in;
		// Pixelate, then blur: unreadable, and still clearly a deliberate redaction.
		parts.push(
			`[${label}]split[keep${i}][cut${i}]`,
			`[cut${i}]crop=${w}:${h}:${x - cx}:${y - cy},scale=${Math.max(2, Math.round(w / 14))}:${Math.max(2, Math.round(h / 14))},scale=${w}:${h}:flags=neighbor,gblur=sigma=6[mask${i}]`,
			`[keep${i}][mask${i}]overlay=${x - cx}:${y - cy}:enable='between(t,${from.toFixed(3)},${to.toFixed(3)})'[b${i}]`,
		);
		label = `b${i}`;
	});
	return { parts, label };
}

function prepare(id) {
	const clip = CLIPS[id];
	const dir = path.join(OUT, id);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	const [cx, cy, cw, ch] = clip.crop;
	const [w, h] = clip.size;
	const duration = clip.out - clip.in;
	const input = ["-ss", clip.in.toFixed(3), "-t", duration.toFixed(3), "-i", SOURCES[clip.source]];

	let pre = `fps=${FPS},crop=${cw}:${ch}:${cx}:${cy}`;
	if (clip.stabilize) {
		const trf = path.join(dir, "transforms.trf");
		ffmpeg([...input, "-vf", `fps=${FPS},vidstabdetect=shakiness=7:accuracy=15:result=${trf}`, "-f", "null", "-"]);
		pre += `,vidstabtransform=input=${trf}:smoothing=14:zoom=7:optzoom=0:interpol=bicubic`;
	}
	if (clip.reframe) {
		const [rx, ry, rw, rh] = clip.reframe;
		pre += `,crop=${rw}:${rh}:${rx}:${ry}`;
	}
	const clean = clip.source === "phone" ? ",hqdn3d=1.5:1.5:4:4,eq=gamma=1.1:saturation=1.04" : "";
	const { parts, label } = blurChain(clip);
	const graph = [`[0:v]${pre}${clean}[base]`, ...parts, `[${label}]scale=${w}:${h}:flags=lanczos,unsharp=3:3:0.35[out]`].join(";");
	ffmpeg([...input, "-filter_complex", graph, "-map", "[out]", "-q:v", "2", path.join(dir, "%04d.jpg")]);

	if (clip.track === "viral-100") {
		execFileSync("python3", ["-I", path.join(HERE, "scripts", "blur_above_playing_row.py"), dir], { stdio: "inherit" });
	}
	fs.rmSync(path.join(dir, "transforms.trf"), { force: true });

	// Exactly the expected number of frames: drop extras, repeat the last one if ffmpeg's rounding left one short.
	const expected = clipFrames(id);
	const frames = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort();
	frames.slice(expected).forEach((f) => fs.rmSync(path.join(dir, f)));
	for (let n = frames.length + 1; n <= expected; n++) {
		fs.copyFileSync(path.join(dir, frames.at(-1)), path.join(dir, `${String(n).padStart(4, "0")}.jpg`));
	}
	if (expected - frames.length > 2) {
		throw new Error(`${id}: only ${frames.length} of ${expected} frames.`);
	}
	return { frames: expected, size: clip.size };
}

for (const file of Object.values(SOURCES)) {
	if (!fs.existsSync(file)) {
		throw new Error(`Missing footage: ${file}`);
	}
}
fs.mkdirSync(OUT, { recursive: true });
const manifestFile = path.join(OUT, "manifest.json");
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : {};
for (const id of Object.keys(CLIPS)) {
	if (only && !only.includes(id)) {
		continue;
	}
	manifest[id] = prepare(id);
	console.log(`  ${id}: ${manifest[id].frames} frames`);
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, "\t"));
