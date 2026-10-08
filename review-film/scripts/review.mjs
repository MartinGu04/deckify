/**
 * Internal review material for the review film, written to review/ (not for upload):
 *
 *   review/breakdown.md      every shot with its film timecode, caption, the exact original footage (file, in–out), framing, blurs,
 *                            and what the footage shows, so every functional claim can be traced to a recorded moment
 *   review/contact-sheet.jpg two frames of every shot, taken from the rendered film
 *
 *   node scripts/review.mjs   (after scripts/render.mjs)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { CLIPS, FPS } from "../src/clips.js";
import { TIMELINE, TOTAL_FRAMES, TRANSITION } from "../src/timeline.js";

const HERE = path.resolve(import.meta.dirname, "..");
const REVIEW = path.join(HERE, "review");
const FILM = path.join(HERE, "out", "deckify-review-film-1920x1080.mp4");
const FILES = {
	desktop: "Deckify-desktop-compressed.mp4 (Windows screen recording, 1920×1080, 60 fps)",
	phone: "WhatsApp Video 2026-10-09 at 01.08.32.mp4 (iPhone, Stream Deck MK.2, 576×1024, 30 fps)",
};

const tc = (seconds) => {
	const m = Math.floor(seconds / 60);
	const s = seconds - m * 60;
	return `${m}:${s.toFixed(2).padStart(5, "0")}`;
};
const filmIn = (shot) => shot.start / FPS;
const filmOut = (shot) => (shot.start + shot.frames) / FPS;

function breakdown() {
	const lines = [
		"# Deckify review film: timestamped breakdown",
		"",
		"Internal review material, generated from `src/timeline.js` and `src/clips.js` by `scripts/review.mjs`. Not for upload.",
		"",
		`**Film:** \`deckify-review-film-1920x1080.mp4\`, 1920×1080, ${FPS} fps, H.264, ${(TOTAL_FRAMES / FPS).toFixed(2)} s.`,
		"",
		"**Original footage:**",
		"",
		`- **Desktop:** ${FILES.desktop}. No audio track.`,
		`- **Phone:** ${FILES.phone}. Its own sound isn't used.`,
		"- They are separate takes: the desktop clock reads 01:05–01:06 and the phone's 01:07. The film never shows them side by side.",
		"",
		"**How to read this:**",
		"",
		"- *Film* times are in the rendered film; *source* times are seconds in the original file.",
		"- Clips play at recorded speed. A *hold* freezes the clip's last real frame after the action has finished.",
		`- Shots crossfade over ${TRANSITION} frames (${(TRANSITION / FPS).toFixed(2)} s); the outgoing shot holds its last frame under the incoming one.`,
		"- Boxes are `[x, y, width, height]` in the original's pixels.",
		"",
		"## Shot list",
		"",
		"| Film | Shot | Caption | Source footage |",
		"| --- | --- | --- | --- |",
	];
	for (const shot of TIMELINE) {
		const when = `${tc(filmIn(shot))}–${tc(filmOut(shot))}`;
		if (!shot.clips) {
			const what = { intro: "Intro: Deckify logo, tagline", chapter: `Chapter card: ${shot.number} ${shot.title}`, outro: "End card: logo, tagline, requirements, disclaimer" }[shot.type];
			lines.push(`| ${when} | ${what} | – | none (title card) |`);
			continue;
		}
		const sources = shot.clips.map((id) => `${CLIPS[id].source} ${tc(CLIPS[id].in)}–${tc(CLIPS[id].out)} (\`${id}\`)`).join("<br>");
		const hold = shot.hold ? `, hold ${shot.hold.toFixed(1)} s` : "";
		lines.push(`| ${when} | ${shot.type}${hold} | ${shot.caption} | ${sources} |`);
	}

	lines.push("", "## Every functional claim, traced to the footage", "");
	for (const shot of TIMELINE.filter((s) => s.clips)) {
		lines.push(`### ${tc(filmIn(shot))} · ${shot.label}: "${shot.caption}"`, "");
		if (shot.captionAt !== undefined) {
			lines.push(`The caption appears at film ${tc(filmIn(shot) + shot.captionAt)}, when what it describes happens.`, "");
		}
		if (shot.press !== undefined) {
			lines.push(`Key-press sound at film ${tc(filmIn(shot) + shot.press)}, where the footage shows the press.`, "");
		}
		for (const id of shot.clips) {
			const c = CLIPS[id];
			lines.push(
				`- **\`${id}\`**: ${c.source}, source ${tc(c.in)}–${tc(c.out)}, crop \`[${c.crop.join(", ")}]\`${c.reframe ? `, reframed \`[${c.reframe.join(", ")}]\` after stabilisation` : ""}${c.stabilize ? ", stabilised" : ""}.`,
				`  - **Shows:** ${c.shows}`,
			);
			for (const b of c.blur ?? []) {
				const window = b.from !== undefined ? ` from source ${tc(b.from)}` : b.to !== undefined ? ` until source ${tc(b.to)}` : "";
				lines.push(`  - **Blurred:** \`[${b.box.join(", ")}]\`${window}: ${b.why}.`);
			}
			if (c.track) {
				lines.push("  - **Blurred:** everything above Spotify's playing row, tracked frame by frame (`scripts/blur_above_playing_row.py`): other people's names as playlist owners.");
			}
		}
		lines.push("");
	}

	lines.push(
		"## Privacy",
		"",
		"- **Never on screen:** the browser's address bar (it holds the Client ID during sign-in and the authorization code afterwards), the Windows taskbar, desktop icons and notifications. Every desktop crop stays inside the app windows.",
		"- **Blurred:** the Spotify account name and picture on Spotify's consent page; the display name in the Spotify Account inspector; the user's own playlist names in the picker; other people's names in the Spotify library (phone); album artwork in Spotify's player bar.",
		"- **Left visible, as evidence:** the chosen public playlist (*The Viral 100*, by uDiscover Playlists), track titles and artists of commercially released songs (*Happier* by Bastille and Marshmello; a Noah Kahan track from *The Hunger Games* album), Spotify's own consent text, and Deckify's own UI.",
		"",
		"## Not shown (no sufficient real footage)",
		"",
		"- **Next / Previous Track** and **Mute / Unmute:** the keys appear in the layout, but no recording shows a press and its result.",
		"- **The SIMPLE / DECKIFY experience chooser:** the recording connects from the Spotify Account inspector, not through the chooser.",
		"- **A volume press with a readable result on the hardware:** the MK.2 shot can't resolve the percentages. The film pairs it with the same take's monitor shot, where they read 84% → 74% → 64%; the presses themselves are off camera there.",
		"- **Desktop and hardware at the same moment:** the two recordings are separate takes, so no split screen pairs them.",
		"",
	);
	return lines.join("\n");
}

function contactSheet() {
	if (!fs.existsSync(FILM)) {
		console.log("  (no rendered film yet: skipped the contact sheet)");
		return;
	}
	const dir = fs.mkdtempSync(path.join(HERE, "out", "sheet-"));
	let n = 0;
	for (const shot of TIMELINE) {
		const start = filmIn(shot) + TRANSITION / FPS;
		const late = shot.captionAt !== undefined ? filmIn(shot) + shot.captionAt + 0.8 : filmOut(shot) - 0.15;
		for (const t of shot.clips ? [start + 0.2, late] : [filmIn(shot) + shot.frames / FPS / 2]) {
			n++;
			execFileSync("ffmpeg", [
				"-v", "error", "-y", "-ss", t.toFixed(3), "-i", FILM, "-frames:v", "1",
				"-vf", `scale=480:270,drawtext=fontfile=${"/usr/share/fonts/opentype/inter/Inter-Bold.otf"}:text='${tc(t).replace(":", "\\:")}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`,
				path.join(dir, `${String(n).padStart(3, "0")}.png`),
			]);
		}
	}
	execFileSync("ffmpeg", ["-v", "error", "-y", "-pattern_type", "glob", "-i", path.join(dir, "*.png"), "-vf", "tile=6x7:padding=6:color=0x222222", "-frames:v", "1", "-q:v", "3", path.join(REVIEW, "contact-sheet.jpg")]);
	fs.rmSync(dir, { recursive: true });
	console.log(`  review/contact-sheet.jpg (${n} frames)`);
}

fs.mkdirSync(REVIEW, { recursive: true });
fs.writeFileSync(path.join(REVIEW, "breakdown.md"), breakdown());
console.log("  review/breakdown.md");
contactSheet();
