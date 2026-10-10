// The review film, frame by frame: `window.film.seek(frame)` draws any frame of the timeline, so a render is the same every time.
// Footage comes from out/clips (scripts/prepare.mjs); layout follows the zones in film.css; check() measures the frame.
import { CLIPS, FPS, clipFrames } from "./clips.js";
import { TIMELINE, TOTAL_FRAMES, TRANSITION } from "./timeline.js";

const W = 1920;
const H = 1080;
const ZONES = {
	media: { x: 96, y: 64, w: 1728, h: 784 },
	caption: { x: 96, y: 888, w: 1728, h: 128 },
	portraitCopy: { x: 140, y: 160, w: 680, h: 760 },
	portraitMedia: { x: 900, y: 60, w: 880, h: 960 },
};
const GAP = 40;
/** Footage is never shown larger than this multiple of the pixels it was prepared at. */
const MAX_SCALE = { single: 1.15, split: 1.2, stack: 1.3, portrait: 1.18 };

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeInOut = (t) => {
	t = clamp(t);
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const ramp = (f, start, length) => clamp((f - start) / length);
const el = (tag, cls, text) => {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text !== undefined) e.textContent = text;
	return e;
};

const shotsLayer = document.getElementById("shots");
const fade = document.getElementById("fade");
const glow = document.getElementById("glow");
let logoSvg = "";

// ---------------------------------------------------------------------------------------------------------------------------------
// Building the shots
// ---------------------------------------------------------------------------------------------------------------------------------

/** Positions the clips of a shot inside a zone; returns panels as [clipId, x, y, w, h]. */
function arrange(shot) {
	const sizes = shot.clips.map((id) => CLIPS[id].size);
	if (shot.type === "portrait") {
		const z = ZONES.portraitMedia;
		const [w, h] = sizes[0];
		const s = Math.min(z.w / w, z.h / h, MAX_SCALE.portrait);
		return [[shot.clips[0], z.x + (z.w - w * s) / 2, z.y + (z.h - h * s) / 2, w * s, h * s]];
	}
	const z = ZONES.media;
	if (shot.type === "single") {
		const [w, h] = sizes[0];
		const s = Math.min(z.w / w, z.h / h, MAX_SCALE.single);
		return [[shot.clips[0], z.x + (z.w - w * s) / 2, z.y + (z.h - h * s) / 2, w * s, h * s]];
	}
	if (shot.type === "split") {
		const totalW = sizes.reduce((a, [w]) => a + w, 0);
		const maxH = Math.max(...sizes.map(([, h]) => h));
		const s = Math.min((z.w - GAP) / totalW, z.h / maxH, MAX_SCALE.split);
		let x = z.x + (z.w - totalW * s - GAP) / 2;
		return shot.clips.map((id, i) => {
			const [w, h] = sizes[i];
			const panel = [id, x, z.y + (z.h - h * s) / 2, w * s, h * s];
			x += w * s + GAP;
			return panel;
		});
	}
	// stack: one above the other, each centred.
	const totalH = sizes.reduce((a, [, h]) => a + h, 0);
	const maxW = Math.max(...sizes.map(([w]) => w));
	const s = Math.min(z.w / maxW, (z.h - GAP) / totalH, MAX_SCALE.stack);
	let y = z.y + (z.h - totalH * s - GAP) / 2;
	return shot.clips.map((id, i) => {
		const [w, h] = sizes[i];
		const panel = [id, z.x + (z.w - w * s) / 2, y, w * s, h * s];
		y += h * s + GAP;
		return panel;
	});
}

function buildCaption(shot) {
	const caption = el("div", "caption");
	const label = el("div", "label");
	label.append(el("span", "chapter-name", shot.label), el("span", "source", shot.source));
	caption.append(label, el("div", "line", shot.caption));
	caption.dataset.qa = "text";
	return caption;
}

function buildShot(shot) {
	const root = el("div", `shot ${shot.type}`);
	const view = { shot, root, imgs: [], parts: {} };
	if (shot.clips) {
		const group = el("div", "group");
		const panels = arrange(shot);
		const left = Math.min(...panels.map((p) => p[1]));
		const top = Math.min(...panels.map((p) => p[2]));
		const right = Math.max(...panels.map((p) => p[1] + p[3]));
		const bottom = Math.max(...panels.map((p) => p[2] + p[4]));
		Object.assign(group.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
		for (const [id, x, y, w, h] of panels) {
			const panel = el("div", "panel");
			panel.dataset.qa = "media";
			Object.assign(panel.style, { left: `${x - left}px`, top: `${y - top}px`, width: `${w}px`, height: `${h}px` });
			const img = el("img");
			img.alt = "";
			panel.append(img);
			group.append(panel);
			view.imgs.push({ id, img, frames: clipFrames(id), shown: 0 });
		}
		view.parts.group = group;
		const caption = buildCaption(shot);
		view.parts.caption = caption;
		root.append(group, caption);
		if (shot.type === "portrait") {
			// Vertically centre the copy in its zone once laid out.
			view.centreCopy = true;
		}
	} else if (shot.type === "chapter") {
		const card = el("div", "card chapter");
		const number = el("div", "number", shot.number);
		const title = el("div", "title", shot.title);
		number.dataset.qa = "text";
		title.dataset.qa = "text";
		card.append(number, title);
		view.parts.card = card;
		root.append(card);
	} else {
		const card = el("div", "card");
		const logo = el("div");
		logo.innerHTML = logoSvg;
		const svg = logo.firstElementChild;
		svg.classList.add("logo");
		svg.removeAttribute("width");
		svg.removeAttribute("height");
		const marks = [...svg.children];
		view.parts.frame = marks[0];
		view.parts.keys = marks.slice(1, 5);
		// The wordmark carries its own SVG transform; animate a wrapper so CSS never replaces it.
		const word = document.createElementNS("http://www.w3.org/2000/svg", "g");
		marks[5].replaceWith(word);
		word.append(marks[5]);
		view.parts.word = word;
		for (const k of view.parts.keys) {
			k.style.transformBox = "fill-box";
			k.style.transformOrigin = "50% 50%";
		}
		card.append(svg);
		const lines =
			shot.type === "intro"
				? [
						["tagline", "Spotify control for your Stream Deck."],
						["small", "A functional demo, from real recordings."],
					]
				: [
						["tagline", "Spotify control. Done right."],
						["small", "For Stream Deck on Windows · Spotify Premium required"],
						["fine", "Deckify is an independent project, not affiliated with or endorsed by Spotify or Elgato."],
					];
		view.parts.lines = lines.map(([cls, text]) => {
			const line = el("div", cls, text);
			line.dataset.qa = "text";
			card.append(line);
			return line;
		});
		root.append(card);
	}
	shotsLayer.append(root);
	return view;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Drawing a frame
// ---------------------------------------------------------------------------------------------------------------------------------

function drawLogo(view, local, total) {
	const { frame, keys, word, lines } = view.parts;
	const out = view.shot.type === "intro" ? 1 - ramp(local, total - 14, 14) : 1;
	frame.style.opacity = String(ease(ramp(local, 8, 18)) * out);
	keys.forEach((k, i) => {
		const t = ease(ramp(local, 22 + i * 5, 12));
		k.style.opacity = String(t * out);
		k.style.transform = `scale(${0.4 + 0.6 * t})`;
	});
	const w = ease(ramp(local, 44, 22));
	word.style.opacity = String(w * out);
	word.style.transform = `translateX(${(1 - w) * -24}px)`;
	lines.forEach((line, i) => {
		const t = ease(ramp(local, 64 + i * 12, 16));
		line.style.opacity = String(t * out);
		line.style.transform = `translateY(${(1 - t) * 14}px)`;
	});
}

async function drawShot(view, frame) {
	const { shot, root } = view;
	const local = frame - shot.start;
	const visibleUntil = shot.start + shot.frames + (view.next ? TRANSITION : 0);
	if (frame < shot.start || frame >= visibleUntil) {
		root.style.display = "none";
		return;
	}
	root.style.display = "";
	// Incoming shots fade in over the outgoing one, which keeps holding its last frame underneath.
	const fadeIn = shot.index === 0 ? 1 : easeInOut(ramp(local, 0, TRANSITION));
	root.style.opacity = String(fadeIn);
	root.style.zIndex = String(shot.index);

	if (shot.type === "intro" || shot.type === "outro") {
		drawLogo(view, local, shot.frames);
		return;
	}
	if (shot.type === "chapter") {
		const t = ease(ramp(local, 0, 16));
		view.parts.card.style.transform = `translateY(${(1 - t) * 18}px)`;
		return;
	}
	// Media: real frames at their recorded timing; after the clip ends, its last frame holds.
	const decodes = [];
	for (const media of view.imgs) {
		const n = Math.min(Math.max(local, 0), media.frames - 1) + 1;
		if (media.shown !== n) {
			media.shown = n;
			media.img.src = `/clips/${media.id}/${String(n).padStart(4, "0")}.jpg`;
			decodes.push(media.img.decode().catch(() => undefined));
		}
	}
	const progress = clamp(local / shot.frames);
	const [z0, z1] = shot.zoom ?? [1, 1.025];
	const scale = (z0 + (z1 - z0) * easeInOut(progress)) * (0.985 + 0.015 * fadeIn);
	view.parts.group.style.transform = `scale(${scale})`;
	const c = ease(ramp(local, shot.captionAt === undefined ? 4 : Math.round(shot.captionAt * FPS), 16));
	view.parts.caption.style.opacity = String(c);
	view.parts.caption.style.transform = `translateY(${(1 - c) * 12}px)`;
	await Promise.all(decodes);
}

let views = [];

async function seek(frame) {
	const active = TIMELINE.find((s) => frame >= s.start && frame < s.start + s.frames) ?? TIMELINE.at(-1);
	// The light follows the subject: right of centre for portrait shots, centred otherwise.
	glow.style.setProperty("--gx", active.type === "portrait" ? "66%" : "50%");
	await Promise.all(views.map((v) => drawShot(v, frame)));
	// Fade from black at the start, to black at the end.
	fade.style.opacity = String(Math.max(1 - ramp(frame, 0, 10), ramp(frame, TOTAL_FRAMES - 16, 16)));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Check: measured on the drawn frame
// ---------------------------------------------------------------------------------------------------------------------------------

const rect = (e) => e.getBoundingClientRect();
const inside = (r, z, t = 0.5) => r.left >= z.x - t && r.top >= z.y - t && r.right <= z.x + z.w + t && r.bottom <= z.y + z.h + t;
const overlaps = (a, b, m = 0) => a.left < b.right + m && a.right > b.left - m && a.top < b.bottom + m && a.bottom > b.top - m;

/** Problems in the current frame: text over footage, anything off the stage or out of its zone, text wider than its box. */
function check() {
	const issues = [];
	const stage = { x: 0, y: 0, w: W, h: H };
	for (const view of views) {
		if (view.root.style.display === "none" || Number(view.root.style.opacity) < 0.02) {
			continue;
		}
		const name = `${view.shot.type} #${view.shot.index}`;
		const texts = [...view.root.querySelectorAll('[data-qa="text"]')];
		const media = [...view.root.querySelectorAll('[data-qa="media"]')];
		for (const t of texts) {
			if (!inside(rect(t), stage)) issues.push(`${name}: text leaves the frame`);
			for (const child of t.querySelectorAll("*")) {
				if (child.scrollWidth > child.clientWidth + 1 && getComputedStyle(child).whiteSpace === "nowrap") issues.push(`${name}: text clipped: "${child.textContent}"`);
			}
			for (const m of media) {
				if (overlaps(rect(t), rect(m), 24)) issues.push(`${name}: text within 24 px of footage`);
			}
		}
		const portrait = view.shot.type === "portrait";
		for (const m of media) {
			if (!inside(rect(m), portrait ? ZONES.portraitMedia : ZONES.media, 30)) issues.push(`${name}: footage outside its zone`);
		}
		if (view.parts.caption && Number(view.parts.caption.style.opacity) > 0.99) {
			const zone = portrait ? ZONES.portraitCopy : ZONES.caption;
			if (!inside(rect(view.parts.caption), zone, 1)) issues.push(`${name}: caption outside its zone`);
		}
	}
	return [...new Set(issues)];
}

// ---------------------------------------------------------------------------------------------------------------------------------

async function boot() {
	logoSvg = await (await fetch("/brand/deckify-logo-on-dark.svg")).text();
	views = TIMELINE.map(buildShot);
	views.forEach((v, i) => (v.next = views[i + 1]));
	await document.fonts.ready;
	await document.fonts.load("800 40px Inter");
	await document.fonts.load("700 40px Inter");
	await document.fonts.load("500 40px Inter");
	for (const v of views) {
		if (v.centreCopy) {
			v.root.style.display = "";
			const z = ZONES.portraitCopy;
			v.parts.caption.style.top = `${z.y + (z.h - v.parts.caption.offsetHeight) / 2}px`;
			v.root.style.display = "none";
		}
	}
	window.film = { seek, check, frames: TOTAL_FRAMES, fps: FPS, timeline: TIMELINE };
}

window.filmReady = boot();
