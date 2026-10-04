/**
 * Synthesises the film's soundtrack: a restrained 120 BPM electronic bed and the UI sounds, placed from the same timeline the picture
 * uses (src/timeline.js), so every press, click and state change is in sync by construction. No samples, no third-party audio.
 *
 *   node scripts/soundtrack.mjs   → out/soundtrack.wav (48 kHz stereo, loudness-normalised to −14 LUFS, −1 dBTP)
 *
 * This is a production-ready temp score: final picture-locked music can replace it later without touching the film.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as T from "../src/timeline.js";

const SR = 48000;
const LENGTH = T.DURATION;
const N = Math.ceil(LENGTH * SR);
const OUT = path.resolve(import.meta.dirname, "..", "out");

// Buses: dry music, reverb send, delay send, SFX (dry).
const bus = () => [new Float32Array(N), new Float32Array(N)];
const music = bus();
const verbSend = bus();
const delaySend = bus();
const sfx = bus();

// Deterministic noise.
let seed = 22222;
const noise = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const NOTE = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
const n = (name) => {
	const m = /^([A-G]#?)(-?\d)$/.exec(name);
	return midi(NOTE[m[1]] + (Number(m[2]) + 1) * 12);
};

/** Adds a mono signal (sample function of time since start) to a bus, panned. */
function add(target, t0, dur, pan, gain, fn) {
	const start = Math.max(0, Math.round(t0 * SR));
	const end = Math.min(N, Math.round((t0 + dur) * SR));
	const l = Math.cos(((pan + 1) * Math.PI) / 4) * gain;
	const r = Math.sin(((pan + 1) * Math.PI) / 4) * gain;
	for (let i = start; i < end; i++) {
		const v = fn((i - start) / SR, i);
		target[0][i] += v * l;
		target[1][i] += v * r;
	}
}

/** Chamberlin state-variable filter; returns {lp, bp, hp}. */
function svf() {
	let low = 0;
	let band = 0;
	return (x, fc, q = 0.7) => {
		const f = 2 * Math.sin((Math.PI * Math.min(fc, SR / 6)) / SR);
		low += f * band;
		const high = x - low - q * band;
		band += f * high;
		return { lp: low, bp: band, hp: high };
	};
}
/** PolyBLEP saw. */
function saw(freq) {
	let phase = (noise() + 1) / 2;
	const dt = freq / SR;
	return () => {
		phase += dt;
		if (phase >= 1) {
			phase -= 1;
		}
		let v = 2 * phase - 1;
		if (phase < dt) {
			const x = phase / dt;
			v -= x + x - x * x - 1;
		} else if (phase > 1 - dt) {
			const x = (phase - 1) / dt;
			v -= x * x + x + x + 1;
		}
		return v;
	};
}
const env = (t, attack, decay) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));

// ------------------------------------------------------------------------------------------------------------------------------
// Music
// ------------------------------------------------------------------------------------------------------------------------------

const BEAT = 60 / T.BPM;
const BAR = BEAT * 4;
/** One chord per bar: [bass, pad voicing]. vi – IV – I – V in D. */
const CHORDS = [
	["B1", ["B3", "D4", "F#4", "A4", "C#5"]],
	["G1", ["B3", "D4", "F#4", "A4"]],
	["D2", ["A3", "C#4", "F#4", "A4"]],
	["A1", ["A3", "C#4", "E4", "F#4", "B4"]],
];
const chordAt = (t) => CHORDS[Math.floor(t / BAR) % CHORDS.length];

/** Section intensity, 0–1 per element, by time. */
function mixAt(t) {
	const [hook, control, actions, personal, setup, complete] = [T.SCENES.hook, T.SCENES.control, T.SCENES.actions, T.SCENES.personal, T.SCENES.setup, T.SCENES.complete];
	if (t < 2.25) return { kick: t >= 0.5 ? 0.8 : 0, hat: t >= 1 ? 0.5 : 0, bass: 0.6, pad: 0.7, arp: 0.3, clap: 0, cutoff: 1400 };
	if (t < hook[1]) return { kick: 0, hat: 0, bass: 0, pad: 0.4, arp: 0, clap: 0, cutoff: 900 };
	if (t < control[1] || t < actions[1]) return { kick: 1, hat: 0.8, bass: 1, pad: 0.75, arp: 0.5, clap: t >= actions[0] ? 0.7 : 0, cutoff: 2200 };
	if (t < personal[1]) return { kick: 1, hat: 1, bass: 1, pad: 0.85, arp: 0.8, clap: 0.8, cutoff: 3200 };
	if (t < setup[1]) {
		const calm = t >= T.SETUP_EVENTS.failure && t < T.SETUP_EVENTS.connected;
		return { kick: calm ? 0.55 : 0.8, half: true, hat: calm ? 0 : 0.5, bass: 0.8, pad: 0.8, arp: calm ? 0.25 : 0.5, clap: 0, cutoff: calm ? 1100 : 1800 };
	}
	if (t < complete[1]) return { kick: 1.05, hat: 1, sixteenths: t >= 18.85, bass: 1.05, pad: 0.9, arp: 1, clap: 0.9, cutoff: 2600 + (t - complete[0]) * 500 };
	return { kick: 0, hat: 0, bass: 0, pad: 0, arp: 0, clap: 0, cutoff: 2000 };
}

// Kick, with the times kept for sidechain ducking.
const kicks = [];
for (let b = 0; b * BEAT < T.END.fadeOut; b++) {
	const t = b * BEAT;
	const m = mixAt(t);
	if (!m.kick || (m.half && b % 2 === 1)) continue;
	kicks.push(t);
	add(music, t, 0.5, 0, 0.72 * m.kick, (s) => {
		// Pitch falls from 156 Hz to 46 Hz; the phase is the integral of that sweep.
		const ph = 2 * Math.PI * (46 * s + 110 * 0.03 * (1 - Math.exp(-s / 0.03)));
		return Math.sin(ph) * Math.exp(-s / 0.26) + noise() * Math.exp(-s / 0.002) * 0.25;
	});
}
const duck = new Float32Array(N).fill(1);
for (const t of kicks) {
	for (let i = Math.round(t * SR), k = 0; i < N && k < 0.3 * SR; i++, k++) {
		duck[i] = Math.min(duck[i], 1 - 0.65 * Math.exp(-k / SR / 0.09));
	}
}

// Hats (8ths, 16ths in the finale), clap on 2 and 4.
for (let s16 = 0; s16 * BEAT / 4 < T.END.fadeOut; s16++) {
	const t = (s16 * BEAT) / 4;
	const m = mixAt(t);
	const onEighth = s16 % 2 === 0;
	if (m.hat && (onEighth || m.sixteenths)) {
		const off = s16 % 4 === 2;
		const f = svf();
		add(music, t, 0.08, off ? 0.25 : -0.2, (off ? 0.16 : 0.09) * m.hat * (onEighth ? 1 : 0.6), (s) => f(noise(), 9000, 0.5).hp * Math.exp(-s / (off ? 0.03 : 0.018)));
	}
	if (m.clap && (s16 % 16 === 4 || s16 % 16 === 12)) {
		const f = svf();
		add(music, t, 0.3, 0, 0.32 * m.clap, (s) => f(noise(), 1500, 0.9).bp * (Math.exp(-s / 0.07) + 0.5 * Math.exp(-Math.abs(s - 0.012) / 0.004)));
		const fv = svf();
		add(verbSend, t, 0.3, 0, 0.12 * m.clap, (s) => fv(noise(), 1800, 0.9).bp * Math.exp(-s / 0.06));
	}
}

// Sub bass: 8th-note pulse on the root, sidechained.
for (let e = 0; e * BEAT / 2 < T.END.fadeOut; e++) {
	const t = (e * BEAT) / 2;
	const m = mixAt(t);
	if (!m.bass) continue;
	const f0 = n(chordAt(t)[0]);
	const len = m.half ? BEAT * 0.95 : BEAT / 2;
	const osc = saw(f0);
	const lp = svf();
	add(music, t, len, 0, 0.3 * m.bass, (s, i) => {
		const tone = Math.sin(2 * Math.PI * f0 * s) * 0.8 + lp(osc(), 380 + 900 * Math.exp(-s / 0.05), 0.6).lp * 0.45;
		return tone * env(s, 0.004, m.half ? 0.35 : 0.16) * Math.min(1, (len - s) / 0.01) * duck[i];
	});
}

// Pads: detuned saws per chord tone, lowpassed, slow swell, wide.
function pad(t0, dur, notes, level, cutoff, release = 0.4) {
	notes.forEach((name, v) => {
		const f = n(name);
		for (const [detune, pan] of [[-0.006, -0.7], [0.006, 0.7]]) {
			const osc = saw(f * (1 + detune));
			const lp = svf();
			const lp2 = svf();
			add(music, t0, dur + release, pan * (0.5 + v * 0.1), (level * 0.05) / Math.sqrt(notes.length), (s, i) => {
				const a = Math.min(1, s / 0.25) * (s > dur ? Math.exp(-(s - dur) / (release / 3)) : 1);
				const c = typeof cutoff === "function" ? cutoff(s) : cutoff;
				return lp2(lp(osc(), c, 0.9).lp, c, 0.9).lp * a * (0.55 + 0.45 * duck[i]);
			});
			add(verbSend, t0, dur + release, pan, (level * 0.025) / Math.sqrt(notes.length), (s) => Math.sin(2 * Math.PI * f * (1 + detune) * s) * Math.min(1, s / 0.3) * (s > dur ? Math.exp(-(s - dur) / 0.2) : 1));
		}
	});
}
for (let b = 0; b * BAR < T.END.fadeOut; b++) {
	const t0 = b * BAR;
	const [, notes] = chordAt(t0);
	// Split each bar at section changes so levels follow the picture.
	const cuts = [t0, ...[2.25, 3, 9, 13, T.SETUP_EVENTS.failure, T.SETUP_EVENTS.connected, 17, T.END.fadeOut].filter((c) => c > t0 && c < t0 + BAR), t0 + BAR];
	for (let k = 0; k < cuts.length - 1; k++) {
		const a = cuts[k];
		const end = Math.min(cuts[k + 1], T.END.fadeOut);
		if (end <= a) continue;
		const m = mixAt(a);
		if (m.pad) pad(a, end - a, notes, m.pad, m.cutoff, end === T.END.fadeOut ? 0.25 : 0.05);
	}
}

// Arp: 16th-note plucks over the chord, into a dotted-eighth ping-pong delay.
const ARP = [0, 2, 1, 3, 2, 4, 1, 3];
for (let s16 = 0; s16 * BEAT / 4 < T.END.fadeOut; s16++) {
	const t = (s16 * BEAT) / 4;
	const m = mixAt(t);
	if (!m.arp || (s16 % 2 === 1 && t < 17)) continue;
	const notes = chordAt(t)[1];
	const name = notes[ARP[s16 % ARP.length] % notes.length];
	const f = n(name) * 2;
	const lp = svf();
	const osc = saw(f);
	const pan = s16 % 2 ? 0.35 : -0.35;
	const voice = (s) => lp(osc() * 0.6 + Math.sin(2 * Math.PI * f * s) * 0.6, m.cutoff * 1.2 * Math.exp(-s / 0.09) + 300, 0.8).lp * env(s, 0.002, 0.11);
	add(music, t, 0.4, pan, 0.11 * m.arp, voice);
	const lp2 = svf();
	const osc2 = saw(f);
	add(delaySend, t, 0.4, pan, 0.07 * m.arp, (s) => lp2(osc2() * 0.6, 1800, 0.8).lp * env(s, 0.002, 0.11));
}

// End: final chord (Dmaj9) after the impact, decaying under the lockup.
pad(T.END.symbolIn, T.END.cut - T.END.symbolIn - 0.3, ["D3", "A3", "C#4", "E4", "F#4", "A4"], 1.0, (s) => 700 + 1600 * Math.exp(-s / 1.2), 0.3);
add(music, T.END.symbolIn, 2.3, 0, 0.34, (s) => Math.sin(2 * Math.PI * n("D1") * s) * env(s, 0.01, 0.9));

// ------------------------------------------------------------------------------------------------------------------------------
// UI sounds
// ------------------------------------------------------------------------------------------------------------------------------

function pluck(t, name, gain, pan = 0, decay = 0.35) {
	const f = n(name);
	const voice = (s) => (Math.sin(2 * Math.PI * f * s) + 0.25 * Math.sin(4 * Math.PI * f * s) * Math.exp(-s / 0.05)) * env(s, 0.002, decay);
	add(sfx, t, decay * 5, pan, gain, voice);
	add(verbSend, t, decay * 5, pan, gain * 0.6, voice);
}
function tick(t, gain, fc = 3200, pan = 0) {
	const f = svf();
	add(sfx, t, 0.03, pan, gain, (s) => f(noise(), fc, 0.6).bp * Math.exp(-s / 0.004));
}
function keyPress(t, gain = 0.5) {
	// A soft, damped mechanical key: thock + top click.
	tick(t - 0.012, gain * 0.9, 2600);
	add(sfx, t - 0.012, 0.08, 0, gain * 0.55, (s) => Math.sin(2 * Math.PI * (170 - 300 * s) * s) * Math.exp(-s / 0.018));
	tick(t + 0.09, gain * 0.35, 4200);
}
function sweep(t, dur, f0, f1, gain, pan = 0, verb = 0.5) {
	const f = svf();
	const voice = (s) => f(noise(), f0 * Math.pow(f1 / f0, s / dur), 1.2).bp * Math.sin((Math.PI * Math.min(s, dur)) / dur);
	add(sfx, t, dur, pan, gain, voice);
	const fv = svf();
	add(verbSend, t, dur, pan, gain * verb, (s) => fv(noise(), f0 * Math.pow(f1 / f0, s / dur), 1.2).bp * Math.sin((Math.PI * Math.min(s, dur)) / dur));
}
const blip = (t, f0, f1, dur, gain, pan = 0) =>
	add(sfx, t, dur + 0.05, pan, gain, (s) => Math.sin(2 * Math.PI * (f0 + ((f1 - f0) * Math.min(s, dur)) / dur / 2) * s) * env(s, 0.003, dur / 2.5));

const DROP_NOTES = ["D5", "E5", "F#5", "A5", "B5", "D6", "E6", "F#6"];
for (const [t, name, detail] of T.soundCues()) {
	if (name.startsWith("press:")) {
		const id = name.slice(6);
		keyPress(t, 0.5);
		if (id === "next") sweep(t, 0.18, 600, 4000, 0.18, 0.3, 0.3);
		if (id === "volUp") blip(t + 0.01, 980, 1180, 0.06, 0.12, 0.2);
		if (id === "volDown") blip(t + 0.01, 880, 720, 0.06, 0.12, -0.2);
		if (id === "mute") blip(t + 0.01, 520, 380, 0.07, 0.12);
		if (id === "like") (pluck(t + 0.02, "E6", 0.09, -0.2, 0.25), pluck(t + 0.09, "B6", 0.08, 0.2, 0.3));
		if (id.startsWith("add")) (pluck(t + 0.2, "A5", 0.09, -0.1, 0.25), pluck(t + 0.27, "D6", 0.09, 0.1, 0.35));
		if (id.startsWith("play") && id !== "playPause") (pluck(t + 0.12, "D5", 0.08), pluck(t + 0.17, "A5", 0.08), pluck(t + 0.22, "D6", 0.08, 0, 0.45));
		continue;
	}
	switch (name) {
		case "drop":
			tick(t, 0.16, 3000, -0.4 + (detail.i % 5) * 0.2);
			pluck(t, DROP_NOTES[detail.i % DROP_NOTES.length], 0.035, -0.4 + (detail.i % 5) * 0.2, 0.18);
			break;
		case "type":
			tick(t, 0.07, 3600 + ((t * 1000) % 7) * 200, 0.1);
			break;
		case "click":
			tick(t, 0.32, 3000, 0.15);
			tick(t + 0.05, 0.14, 2200, 0.15);
			break;
		case "copy":
			tick(t, 0.3, 3000, 0.25);
			pluck(t + 0.03, "A6", 0.05, 0.25, 0.15);
			break;
		case "notice":
			pluck(t, "F#5", 0.07, 0, 0.3);
			pluck(t + 0.12, "D5", 0.07, 0, 0.4);
			break;
		case "success":
			pluck(t, "D5", 0.08, -0.2, 0.3);
			pluck(t + 0.06, "F#5", 0.08, 0, 0.3);
			pluck(t + 0.12, "A5", 0.08, 0.2, 0.5);
			break;
		case "select":
			pluck(t, "A5", 0.06, 0, 0.25);
			break;
		case "powerOn":
			add(sfx, t, 0.6, 0, 0.12, (s) => Math.sin(2 * Math.PI * (180 + 260 * s) * s) * env(s, 0.12, 0.15));
			sweep(t, 0.5, 2000, 9000, 0.05, 0, 0.8);
			break;
		case "rise":
			add(music, t, 0.6, 0, 0.3, (s) => Math.sin(2 * Math.PI * 46 * s) * Math.min(1, s / 0.3) * Math.exp(-s / 0.5));
			break;
		case "symbol":
			add(sfx, t, 0.9, 0, 0.45, (s) => Math.sin(2 * Math.PI * (60 - 20 * s) * s) * env(s, 0.005, 0.25));
			sweep(t, 0.7, 6000, 1500, 0.06, 0, 1);
			break;
		case "whoosh":
			sweep(t - 0.12, 0.3, 300, 2400, 0.16, 0, 0.4);
			break;
		case "fall":
			sweep(t, 0.4, 2400, 300, 0.1, 0, 0.6);
			break;
		case "impact":
			add(sfx, t, 1.2, 0, 0.5, (s) => Math.sin(2 * Math.PI * (52 - 12 * s) * s) * env(s, 0.004, 0.4));
			tick(t, 0.2, 900);
			break;
		case "key0":
		case "key1":
		case "key2":
		case "key3": {
			const i = Number(name.slice(3));
			keyPress(t, 0.22);
			pluck(t, ["D5", "F#5", "A5", "D6"][i], 0.06, [-0.3, 0.3, -0.3, 0.3][i], 0.3);
			break;
		}
		case "sweep":
			sweep(T.END.lockup, 0.6, 800, 5000, 0.05, 0, 1);
			break;
		case "sparkle":
			["D6", "F#6", "A6", "C#7"].forEach((note, i) => pluck(t + i * 0.07, note, 0.035, [-0.4, 0.4, -0.2, 0.2][i], 0.4));
			break;
	}
}

// ------------------------------------------------------------------------------------------------------------------------------
// Effects and master
// ------------------------------------------------------------------------------------------------------------------------------

/** Freeverb (Jezar's tunings), stereo. */
function freeverb([inL, inR], room = 0.86, damp = 0.25, wet = 1) {
	const scale = SR / 44100;
	const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
	const aps = [556, 441, 341, 225];
	const out = bus();
	for (const [ch, spread] of [[0, 0], [1, 23]]) {
		const input = ch ? inR : inL;
		const comb = combs.map((len) => ({ buf: new Float32Array(Math.round((len + spread) * scale)), i: 0, store: 0 }));
		const ap = aps.map((len) => ({ buf: new Float32Array(Math.round((len + spread) * scale)), i: 0 }));
		for (let i = 0; i < N; i++) {
			const x = input[i] * 0.015;
			let y = 0;
			for (const c of comb) {
				const o = c.buf[c.i];
				c.store = o * (1 - damp) + c.store * damp;
				c.buf[c.i] = x + c.store * room;
				c.i = (c.i + 1) % c.buf.length;
				y += o;
			}
			for (const a of ap) {
				const o = a.buf[a.i];
				a.buf[a.i] = y + o * 0.5;
				a.i = (a.i + 1) % a.buf.length;
				y = o - y;
			}
			out[ch][i] = y * wet;
		}
	}
	return out;
}
/** Ping-pong delay: returns only the echoes, alternating sides. */
function pingPong([inL, inR], time, feedback) {
	const d = Math.round(time * SR);
	const out = bus();
	for (let i = d; i < N; i++) {
		out[0][i] = inR[i - d] + feedback * out[1][i - d];
		out[1][i] = inL[i - d] + feedback * out[0][i - d];
	}
	return out;
}

const delayed = pingPong(delaySend, BEAT * 0.75, 0.38);
for (let ch = 0; ch < 2; ch++) for (let i = 0; i < N; i++) verbSend[ch][i] += delayed[ch][i] * 0.5;
const reverb = freeverb(verbSend);

const master = bus();
const cut = Math.round(T.END.cut * SR);
for (let i = 0; i < N; i++) {
	// The picture cuts to black at END.cut; the sound stops with it (a 25 ms fade, so it doesn't click).
	const gate = i < cut ? 1 : Math.max(0, 1 - (i - cut) / (0.025 * SR));
	for (let ch = 0; ch < 2; ch++) {
		const x = (music[ch][i] + sfx[ch][i] + reverb[ch][i] * 0.9 + delayed[ch][i] * 0.35) * gate;
		master[ch][i] = Math.tanh(x * 1.1) / 1.1;
	}
}

// Write a float WAV, then normalise loudness with ffmpeg.
fs.mkdirSync(OUT, { recursive: true });
const raw = path.join(OUT, "soundtrack-raw.wav");
const data = Buffer.alloc(N * 2 * 4);
for (let i = 0; i < N; i++) {
	data.writeFloatLE(master[0][i], i * 8);
	data.writeFloatLE(master[1][i], i * 8 + 4);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(3, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 8, 28);
header.writeUInt16LE(8, 32);
header.writeUInt16LE(32, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
fs.writeFileSync(raw, Buffer.concat([header, data]));

const final = path.join(OUT, "soundtrack.wav");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-af", "highpass=f=28,loudnorm=I=-14:TP=-1:LRA=9", "-ar", String(SR), "-c:a", "pcm_s24le", final]);
fs.rmSync(raw);
console.log(final);
