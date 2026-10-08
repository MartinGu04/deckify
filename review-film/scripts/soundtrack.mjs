/**
 * Writes out/soundtrack.wav for the review film: a restrained, synthesised music bed that follows the timeline (calm under setup, a
 * light pulse once the keys come alive, a resolved chord under the end card), plus a soft key tick at each physical key press the
 * footage shows (the shots' `press` times). No voice, no samples, no recorded audio: the original recordings have no usable sound.
 *
 *   node scripts/soundtrack.mjs   → out/soundtrack.wav (48 kHz stereo, loudness-normalised to −16 LUFS, −1.5 dBTP)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { FPS } from "../src/clips.js";
import { TIMELINE, TOTAL_FRAMES } from "../src/timeline.js";

const HERE = path.resolve(import.meta.dirname, "..");
const OUT = path.join(HERE, "out");
const RATE = 48000;
const SECONDS = TOTAL_FRAMES / FPS;
const N = Math.ceil(SECONDS * RATE);
const L = new Float32Array(N);
const R = new Float32Array(N);

const BPM = 92;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const sceneStart = (type, nth = 0) => TIMELINE.filter((s) => s.type === type)[nth].start / FPS;
const chapters = TIMELINE.filter((s) => s.type === "chapter").map((s) => s.start / FPS);
const outro = sceneStart("outro");

// D major: Dmaj9 – Bm9 – Gmaj9 – A6sus, voiced low and open.
const CHORDS = [
	[50, 57, 61, 64, 66],
	[47, 54, 57, 61, 62],
	[43, 50, 54, 57, 59],
	[45, 52, 54, 57, 59],
];

function add(buffer, i, v) {
	if (i >= 0 && i < N) buffer[i] += v;
}

/** Soft pad: detuned additive voices with a slow swell. */
function pad(start, length, notes, gain) {
	const s0 = Math.floor(start * RATE);
	const n = Math.floor(length * RATE);
	notes.forEach((note, k) => {
		const pan = (k / (notes.length - 1)) * 0.6 - 0.3;
		for (const detune of [-0.06, 0.06]) {
			const f = midi(note + detune);
			for (let i = 0; i < n; i++) {
				const t = i / RATE;
				const env = Math.min(1, t / 1.4) * Math.min(1, (length - t) / 1.2);
				const ph = 2 * Math.PI * f * t;
				const v = (Math.sin(ph) + 0.32 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph)) * env * gain * (0.9 + 0.1 * Math.sin(2 * Math.PI * 0.2 * t + k));
				add(L, s0 + i, v * (1 - pan));
				add(R, s0 + i, v * (1 + pan));
			}
		}
	});
}

/** Plucked note: a decaying sine with a bright attack. */
function pluck(start, note, gain, pan = 0) {
	const s0 = Math.floor(start * RATE);
	const f = midi(note);
	const n = Math.floor(1.2 * RATE);
	for (let i = 0; i < n; i++) {
		const t = i / RATE;
		const env = Math.exp(-t * 5) * Math.min(1, t * 400);
		const v = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 12)) * env * gain;
		add(L, s0 + i, v * (1 - pan));
		add(R, s0 + i, v * (1 + pan));
	}
}

/** Sub bass note. */
function sub(start, length, note, gain) {
	const s0 = Math.floor(start * RATE);
	const f = midi(note - 12);
	const n = Math.floor(length * RATE);
	for (let i = 0; i < n; i++) {
		const t = i / RATE;
		const env = Math.min(1, t / 0.6) * Math.min(1, (length - t) / 0.6);
		const v = Math.sin(2 * Math.PI * f * t) * env * gain;
		add(L, s0 + i, v);
		add(R, s0 + i, v);
	}
}

/** Soft kick: a short pitch-dropping sine. */
function kick(start, gain) {
	const s0 = Math.floor(start * RATE);
	const n = Math.floor(0.35 * RATE);
	let ph = 0;
	for (let i = 0; i < n; i++) {
		const t = i / RATE;
		ph += (2 * Math.PI * (48 + 90 * Math.exp(-t * 30))) / RATE;
		const v = Math.sin(ph) * Math.exp(-t * 9) * gain;
		add(L, s0 + i, v);
		add(R, s0 + i, v);
	}
}

/** A Stream Deck key press: a soft, damped click. */
function tick(start, gain) {
	const s0 = Math.floor(start * RATE);
	const n = Math.floor(0.06 * RATE);
	let seed = 7;
	for (let i = 0; i < n; i++) {
		const t = i / RATE;
		seed = (seed * 16807) % 2147483647;
		const noise = seed / 2147483647 - 0.5;
		const v = (Math.sin(2 * Math.PI * 1500 * t) * 0.8 + noise * 0.15) * Math.exp(-t * 120) * gain;
		add(L, s0 + i, v);
		add(R, s0 + i, v);
	}
}

// ---- Arrangement ----
const pulseFrom = chapters[1]; // the keys come alive
for (let bar = 0, t = 0; t < SECONDS; bar++, t = bar * BAR) {
	const chord = t >= outro ? CHORDS[0] : CHORDS[bar % 4];
	const length = Math.min(BAR + 1.2, SECONDS - t);
	pad(t, length, chord, 0.016);
	if (t >= chapters[0] && t < outro) sub(t, BAR + 0.5, chord[0], 0.045);
	if (t >= pulseFrom && t < outro) {
		for (let b = 0; b < 8; b++) {
			const at = t + (b * BEAT) / 2;
			if (at < outro) pluck(at, chord[1 + (b % 4)] + 12, 0.035, b % 2 ? 0.25 : -0.25);
		}
	}
	if (t >= chapters[2] && t < outro) {
		for (let b = 0; b < 4; b++) kick(t + b * BEAT, 0.14);
	}
}
// The end card: one resolved, sustained chord.
pad(outro, SECONDS - outro, [38, 50, 57, 61, 64, 69], 0.02);

// Key ticks where the footage shows a physical press.
for (const shot of TIMELINE) {
	if (shot.press !== undefined) tick(shot.start / FPS + shot.press, 0.16);
}

// ---- Space: a small stereo feedback-delay reverb ----
const wetL = new Float32Array(N);
const wetR = new Float32Array(N);
for (const [buf, out, delays] of [
	[L, wetL, [1931, 2617, 3307, 4001]],
	[R, wetR, [2083, 2789, 3491, 4211]],
]) {
	for (const d of delays) {
		const line = new Float32Array(d);
		let lp = 0;
		for (let i = 0; i < N; i++) {
			const j = i % d;
			const y = line[j];
			lp = lp * 0.6 + y * 0.4;
			line[j] = buf[i] + lp * 0.7;
			out[i] += y * 0.14;
		}
	}
}

// ---- Fades and write ----
const fadeIn = 0.6 * RATE;
const fadeOut = 1.4 * RATE;
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
	const g = Math.min(1, i / fadeIn, (N - i) / fadeOut);
	pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (L[i] + wetL[i]) * g)) * 32767), i * 4);
	pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (R[i] + wetR[i]) * g)) * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
fs.mkdirSync(OUT, { recursive: true });
const raw = path.join(OUT, "soundtrack-raw.wav");
fs.writeFileSync(raw, Buffer.concat([header, pcm]));
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", raw, "-af", "loudnorm=I=-16:TP=-1.5:LRA=9", "-ar", "48000", path.join(OUT, "soundtrack.wav")]);
fs.rmSync(raw);
console.log(`Wrote out/soundtrack.wav (${SECONDS.toFixed(2)} s).`);
