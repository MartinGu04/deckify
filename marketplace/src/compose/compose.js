// Composes one Marketplace image (?slide=<id>) from content.js, the real key states and the real Deckify Setup captures that
// scripts/render.mjs prepared in /out/data.json, then measures the result. `window.__compose` resolves to the QA report; render.mjs refuses
// to write an image whose report has issues.
import { SLIDES } from "./content.js";

/** Minimum space between any text block and any media block, in canvas pixels. */
const CLEARANCE = 32;
/** Smallest allowed type, in canvas pixels: about 13 px when the gallery is shown at half size. */
const MIN_TEXT = { gallery: 26, thumbnail: 40 };
/**
 * Text inside a Deckify Setup capture, once scaled onto the canvas: its body text (the size most of its words use) and its smallest
 * label (e.g. the "Recommended" badge, whose meaning the copy repeats in large type).
 */
const MIN_CAPTURE_BODY_TEXT = 18;
const MIN_CAPTURE_TEXT = 13;
/** Largest key, in canvas pixels: on the deck, and in the key showcase. */
const MAX_KEY = 176;
const MAX_SHOWCASE_KEY = 184;
/** Words that must never appear in a listing image. */
const FORBIDDEN = [
	[/\bofficial\b/i, "the word Official"],
	[/https?:|www\.|\.com\b|\.net\b/i, "a link"],
	[/\.(png|svg|jpe?g|json|mjs|js|ts|html|css)\b/i, "a file name"],
	[/imgs\/|marketplace\/|\/out\/|sdPlugin|placeholder/i, "a development path or placeholder"],
	[/(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/i, "a Client ID-shaped value"],
	[/\b(BQ|AQ)[\w-]{40,}/, "a token-shaped value"],
	[/lorem|todo|tbd|xxx/i, "placeholder copy"],
];

const $ = (tag, attrs = {}, ...children) => {
	const el = document.createElement(tag);
	for (const [name, value] of Object.entries(attrs)) {
		if (name === "class") {
			el.className = value;
		} else if (name === "style") {
			Object.assign(el.style, value);
		} else {
			el.setAttribute(name, value);
		}
	}
	el.append(...children.filter((c) => c !== undefined && c !== null));
	return el;
};

/** Plain text with **bold** runs; everything is escaped by using text nodes. */
function rich(text) {
	const out = document.createDocumentFragment();
	text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
		if (part.startsWith("**") && part.endsWith("**")) {
			out.append($("strong", {}, part.slice(2, -2)));
		} else if (part) {
			out.append(document.createTextNode(part));
		}
	});
	return out;
}

const text = (tag, cls, content, qa = "text") => $(tag, { class: cls, "data-qa": qa }, rich(content));

// ---------------------------------------------------------------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------------------------------------------------------------

function buildCopy(slide) {
	const copy = $("div", { class: "copy" });
	copy.append($("img", { class: "brand", src: "/brand/deckify-logo-on-dark.svg", alt: "Deckify", "data-qa": "brand" }));
	if (slide.eyebrow) {
		copy.append(text("p", "eyebrow", slide.eyebrow));
	}
	copy.append(text("h1", "headline", slide.headline));
	if (slide.body) {
		copy.append(text("p", "body", slide.body));
	}
	if (slide.steps) {
		copy.append(
			$(
				"ol",
				{ class: "steps" },
				...slide.steps.map((step, i) => $("li", { "data-qa": "text" }, $("span", { class: "num" }, String(i + 1)), $("span", {}, step))),
			),
		);
	}
	if (slide.points) {
		copy.append($("ul", { class: "points" }, ...slide.points.map((point) => text("li", "", point))));
	}
	if (slide.note) {
		copy.append(text("p", "note", slide.note));
	}
	// The last block keeps no trailing margin, so the copy is centred on its content.
	copy.lastElementChild.style.marginBottom = "0";
	return copy;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------------------------------------------------------------

/** A key face: the plugin's image (or rendered Now Playing SVG) and the plugin's title. */
function keyFace(state) {
	const key = $("div", { class: "key" });
	if (!state) {
		key.classList.add("empty");
		return key;
	}
	if (state.svg) {
		const np = $("div", { class: "np" });
		np.innerHTML = state.svg;
		key.append(np);
	} else {
		key.append($("img", { src: `/plugin/${state.image}`, alt: "" }));
	}
	if (state.title) {
		key.append($("div", { class: "title", "data-qa": "key-title" }, state.title));
	}
	return key;
}

function buildMedia(slide, data) {
	const media = $("div", { class: "media" });
	const m = slide.media;
	let visual;
	if (m.type === "deck") {
		visual = $("div", { class: "deck", "data-qa": "media" });
		for (const row of data.layouts[m.experience]) {
			for (const id of row) {
				visual.append(keyFace(id === null ? undefined : data.keys[m.states?.[id] ?? id]));
			}
		}
	} else if (m.type === "capture") {
		const capture = data.captures[m.capture];
		visual = $("img", { class: "shot", src: capture.src, alt: "", "data-qa": "media", "data-capture": m.capture });
	} else if (m.type === "keys") {
		visual = $("div", { class: "showcase", "data-qa": "media" });
		for (const row of m.rows) {
			for (const id of row) {
				const state = data.keys[id];
				visual.append($("div", { class: "cell" }, keyFace(state), $("span", { class: "label", "data-qa": "label" }, data.actions[state.action])));
			}
		}
	}
	// Hidden until fit() sizes it, so its natural size never takes part in the layout.
	visual.style.display = "none";
	media.append(visual);
	if (m.caption) {
		media.append(text("p", "caption", m.caption, "caption"));
	}
	return { media, visual };
}

/**
 * Sizes the visual to the space its cell leaves after the caption: the largest size that fits, capped (keys) or never above the
 * capture's own pixels. This is the only place sizes are computed, and it only ever scales product media, never type.
 */
function fit(slide, data, media, visual) {
	const cell = media.getBoundingClientRect();
	const caption = media.querySelector(".caption");
	const gap = caption ? parseFloat(getComputedStyle(media).rowGap) : 0;
	const width = cell.width;
	const height = cell.height - (caption ? caption.getBoundingClientRect().height + gap : 0);
	const m = slide.media;
	visual.style.display = "";
	if (m.type === "deck") {
		// Deck width = 5 keys + 4 gaps (0.17 key) + 2 paddings (0.24 key); height = 3 keys + 2 gaps + 2 paddings.
		const key = Math.floor(Math.min(width / 6.16, height / 3.82, MAX_KEY));
		visual.style.setProperty("--key", `${key}px`);
		visual.style.setProperty("--key-gap", `${Math.round(key * 0.17)}px`);
		visual.style.setProperty("--deck-pad", `${Math.round(key * 0.24)}px`);
		return { key };
	}
	if (m.type === "capture") {
		const capture = data.captures[m.capture];
		const cssWidth = capture.width / capture.dsf;
		const cssHeight = capture.height / capture.dsf;
		const scale = Math.min(width / cssWidth, height / cssHeight, capture.dsf);
		visual.style.width = `${Math.floor(cssWidth * scale)}px`;
		visual.style.height = `${Math.floor(cssHeight * scale)}px`;
		return { scale, captureMinText: capture.minTextPx * scale, captureBodyText: capture.bodyTextPx * scale };
	}
	// Key showcase: three columns as wide as the widest label (or the key), three rows of key + label.
	const labels = [...visual.querySelectorAll(".label")];
	const labelWidth = Math.max(...labels.map((l) => l.getBoundingClientRect().width));
	const labelHeight = Math.max(...labels.map((l) => l.getBoundingClientRect().height));
	const rowGap = 44;
	const colGap = 40;
	const rows = m.rows.length;
	const key = Math.floor(Math.min((height - (rows - 1) * rowGap) / rows - labelHeight - 16, (width - 2 * colGap) / 3, MAX_SHOWCASE_KEY));
	visual.style.setProperty("--key", `${key}px`);
	visual.style.setProperty("--col", `${Math.ceil(Math.max(key, labelWidth))}px`);
	visual.style.setProperty("--col-gap", `${colGap}px`);
	visual.style.setProperty("--row-gap", `${rowGap}px`);
	return { key };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// QA: measured on the rendered page
// ---------------------------------------------------------------------------------------------------------------------------------

const box = (el) => {
	const r = el.getBoundingClientRect();
	return { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
};
const inside = (a, b, tolerance = 0.5) => a.x >= b.x - tolerance && a.y >= b.y - tolerance && a.r <= b.r + tolerance && a.b <= b.b + tolerance;
const intersects = (a, b, margin = 0) => a.x < b.r + margin && a.r > b.x - margin && a.y < b.b + margin && a.b > b.y - margin;
const name = (el) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""} "${el.textContent.trim().slice(0, 40)}"`;

/** Every rendered line of text under an element (one rect per line fragment). */
function lineRects(el) {
	const rects = [];
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (!node.textContent.trim()) {
			continue;
		}
		const range = document.createRange();
		range.selectNodeContents(node);
		for (const r of range.getClientRects()) {
			rects.push({ node, rect: { x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } });
		}
	}
	return rects;
}

/**
 * Counts artwork pixels under a key title: the key image is drawn on its own (without the title) at its on-canvas size, and every pixel
 * inside the title's line boxes (grown by 2 px) that differs from the key background counts.
 * @returns {number | undefined} Pixels of artwork under the title; `undefined` when the image can't be read.
 */
function inkUnder(img, key, lines) {
	if (!img) {
		return undefined;
	}
	const size = Math.round(key.w);
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	try {
		ctx.drawImage(img, 0, 0, size, size);
		const { data } = ctx.getImageData(0, 0, size, size);
		const background = [0x12, 0x12, 0x12];
		let ink = 0;
		for (const line of lines) {
			const x0 = Math.max(0, Math.floor(line.x - key.x - 2));
			const x1 = Math.min(size, Math.ceil(line.r - key.x + 2));
			const y0 = Math.max(0, Math.floor(line.y - key.y - 2));
			const y1 = Math.min(size, Math.ceil(line.b - key.y + 2));
			for (let y = y0; y < y1; y++) {
				for (let x = x0; x < x1; x++) {
					const i = (y * size + x) * 4;
					if (Math.abs(data[i] - background[0]) + Math.abs(data[i + 1] - background[1]) + Math.abs(data[i + 2] - background[2]) > 24) {
						ink++;
					}
				}
			}
		}
		return ink;
	} catch {
		return undefined;
	}
}

function qa(slide, sizes) {
	const issues = [];
	const canvas = box(document.querySelector(".canvas"));
	const safe = box(document.querySelector(".frame"));
	const texts = [...document.querySelectorAll('[data-qa="text"]')];
	const captions = [...document.querySelectorAll('[data-qa="caption"]')];
	const labels = [...document.querySelectorAll('[data-qa="label"]')];
	const media = [...document.querySelectorAll('[data-qa="media"]')];
	const brand = [...document.querySelectorAll('[data-qa="brand"]')];
	const minText = MIN_TEXT[slide.kind];

	if (document.documentElement.scrollWidth > canvas.w || document.documentElement.scrollHeight > canvas.h) {
		issues.push("Content overflows the 1920×960 canvas.");
	}
	for (const el of [...texts, ...captions, ...media, ...brand]) {
		if (!inside(box(el), safe)) {
			issues.push(`Outside the safe frame: ${name(el)}`);
		}
	}
	// Text never meets media: every line of every text block keeps CLEARANCE from every media block.
	for (const t of texts) {
		for (const { rect } of lineRects(t)) {
			for (const m of media) {
				if (intersects(rect, box(m), CLEARANCE)) {
					issues.push(`Text within ${CLEARANCE}px of media: ${name(t)}`);
				}
			}
		}
	}
	// A caption belongs to its media: it sits under it, never on it.
	for (const c of captions) {
		for (const m of media) {
			if (intersects(box(c), box(m), 12)) {
				issues.push(`Caption touches its media: ${name(c)}`);
			}
		}
	}
	// Text blocks never overlap each other.
	const blocks = [...texts, ...captions];
	for (let i = 0; i < blocks.length; i++) {
		for (let j = i + 1; j < blocks.length; j++) {
			if (blocks[i].contains(blocks[j]) || blocks[j].contains(blocks[i])) {
				continue;
			}
			if (intersects(box(blocks[i]), box(blocks[j]))) {
				issues.push(`Text blocks overlap: ${name(blocks[i])} / ${name(blocks[j])}`);
			}
		}
	}
	// Nothing clipped: no line is wider than its block, and every line stays inside its block's column and the safe frame. (Nothing in
	// the composition clips with overflow: hidden, so a line outside its box would still show; these checks catch it before it can.)
	for (const t of [...blocks, ...labels]) {
		if (t.scrollWidth > t.clientWidth + 1) {
			issues.push(`Text wider than its box: ${name(t)}`);
		}
		const column = box(t.closest(".copy, .media"));
		for (const { rect } of lineRects(t)) {
			if (!inside(rect, safe) || !inside(rect, column)) {
				issues.push(`A line leaves its column or the safe frame: ${name(t)}`);
			}
		}
	}
	// Type sizes: every text node in copy, captions and labels.
	for (const t of [...blocks, ...labels]) {
		for (const { node } of lineRects(t)) {
			const size = parseFloat(getComputedStyle(node.parentElement).fontSize);
			if (size < minText) {
				issues.push(`Text below ${minText}px (${size}px): ${name(node.parentElement)}`);
			}
		}
	}
	// Key titles stay on their key and off its artwork: the key image is drawn alone, and no pixel under a title line (plus 2 px) may
	// differ from the key background.
	for (const title of document.querySelectorAll('[data-qa="key-title"]')) {
		const keyEl = title.closest(".key");
		const key = box(keyEl);
		const lines = lineRects(title).map(({ rect }) => rect);
		for (const rect of lines) {
			if (!inside(rect, key, 0)) {
				issues.push(`Key title doesn't fit its key: "${title.textContent}"`);
			}
		}
		const ink = inkUnder(keyEl.querySelector("img"), key, lines);
		if (ink === undefined) {
			issues.push(`Couldn't check the artwork under the key title "${title.textContent}".`);
		} else if (ink > 0) {
			issues.push(`Key title overlaps its icon (${ink} px): "${title.textContent.replace(/\n/g, " / ")}"`);
		}
	}
	// Showcase labels don't collide with each other or with keys of other cells.
	const keys = [...document.querySelectorAll(".key")];
	for (const label of labels) {
		for (const other of labels) {
			if (other !== label && intersects(box(label), box(other), 8)) {
				issues.push(`Labels collide: ${name(label)} / ${name(other)}`);
			}
		}
		for (const key of keys) {
			if (intersects(box(label), box(key), 4)) {
				issues.push(`Label touches a key: ${name(label)}`);
			}
		}
	}
	// Images: loaded, and captures never shown larger than their own pixels.
	for (const img of document.querySelectorAll("img")) {
		if (!img.complete || img.naturalWidth === 0) {
			issues.push(`Image failed to load: ${img.getAttribute("src")}`);
		}
	}
	for (const shot of document.querySelectorAll("img.shot")) {
		if (shot.getBoundingClientRect().width > shot.naturalWidth + 0.5) {
			issues.push(`Capture upscaled beyond its pixels: ${shot.dataset.capture}`);
		}
	}
	if (sizes.captureBodyText !== undefined && sizes.captureBodyText < MIN_CAPTURE_BODY_TEXT) {
		issues.push(`Body text in the capture is ${sizes.captureBodyText.toFixed(1)}px on the canvas (minimum ${MIN_CAPTURE_BODY_TEXT}px).`);
	}
	if (sizes.captureMinText !== undefined && sizes.captureMinText < MIN_CAPTURE_TEXT) {
		issues.push(`Smallest text in the capture is ${sizes.captureMinText.toFixed(1)}px on the canvas (minimum ${MIN_CAPTURE_TEXT}px).`);
	}
	// Words: nothing internal, no links, no "Official", no credentials.
	const visibleText = document.body.innerText;
	for (const [pattern, what] of FORBIDDEN) {
		if (pattern.test(visibleText)) {
			issues.push(`Visible text contains ${what}.`);
		}
	}

	const textSizes = texts.flatMap((t) => lineRects(t).map(({ node }) => parseFloat(getComputedStyle(node.parentElement).fontSize)));
	const gapToMedia = Math.min(
		...texts.flatMap((t) => lineRects(t).flatMap(({ rect }) => media.map((m) => Math.max(box(m).x - rect.r, rect.x - box(m).r, box(m).y - rect.b, rect.y - box(m).b)))),
	);
	return {
		slide: slide.id,
		issues: [...new Set(issues)],
		metrics: {
			minTextPx: Math.min(...textSizes),
			minGapTextToMediaPx: Math.round(gapToMedia),
			keyPx: sizes.key,
			captureScale: sizes.scale === undefined ? undefined : Number(sizes.scale.toFixed(3)),
			captureMinTextPx: sizes.captureMinText === undefined ? undefined : Number(sizes.captureMinText.toFixed(1)),
			captureBodyTextPx: sizes.captureBodyText === undefined ? undefined : Number(sizes.captureBodyText.toFixed(1)),
			media: media.map((m) => box(m)),
			copy: box(document.querySelector(".copy")),
		},
	};
}

// ---------------------------------------------------------------------------------------------------------------------------------

async function compose() {
	const id = new URLSearchParams(location.search).get("slide");
	const slide = SLIDES.find((s) => s.id === id);
	if (!slide) {
		throw new Error(`Unknown slide: ${id}`);
	}
	const data = await (await fetch("/out/data.json", { cache: "no-store" })).json();
	document.body.classList.add(slide.kind);
	const frame = document.querySelector(".frame");
	if (slide.copyWidth) {
		frame.style.setProperty("--copy-w", `${slide.copyWidth}px`);
	}
	const { media, visual } = buildMedia(slide, data);
	frame.append(buildCopy(slide), media);

	await document.fonts.ready;
	await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
	const sizes = fit(slide, data, media, visual);
	await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	return qa(slide, sizes);
}

window.__compose = compose();
