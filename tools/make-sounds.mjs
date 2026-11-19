#!/usr/bin/env node
// tools/make-sounds.mjs: synthesize the bundled sound library from scratch, so every sound in
// sounds/ is original and ships under the repo's MIT license. Nothing is sampled or downloaded.
//
//   node tools/make-sounds.mjs            # writes sounds/sfx/*.mp3 and sounds/music/*.mp3
//
// You never need to run this to use the kit; the MP3s are committed. It's here so the sounds can
// be tweaked and regenerated. To use your own sounds, drop MP3/WAV files into sounds/sfx or
// sounds/music and refer to them by file name (without the extension).
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SR = 44100;
const TAU = Math.PI * 2;

// ---- tiny DSP toolkit ------------------------------------------------------------------------
let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;  // deterministic noise
const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));           // attack, then exp decay
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// State-variable filter; returns { lp, bp, hp } per sample. f in Hz, q ~0.5..10.
function svf() {
  let low = 0, band = 0;
  return (x, f, q = 0.7) => {
    const k = 2 * Math.sin(Math.PI * Math.min(f, SR / 6) / SR);
    low += k * band;
    const high = x - low - band / q;
    band += k * high;
    return { lp: low, bp: band, hp: high };
  };
}

// Small Schroeder reverb (4 combs + 2 allpasses), mono in, mono out.
function reverb(x, { mix = 0.25, size = 1, damp = 0.4 } = {}) {
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ b: new Float32Array(Math.round(d * size)), i: 0, f: 0 }));
  const alls = [556, 441].map((d) => ({ b: new Float32Array(d), i: 0 }));
  const out = new Float32Array(x.length);
  for (let n = 0; n < x.length; n++) {
    let s = 0;
    for (const c of combs) {
      const y = c.b[c.i];
      c.f = y * (1 - damp) + c.f * damp;
      c.b[c.i] = x[n] * 0.015 + c.f * 0.84;
      c.i = (c.i + 1) % c.b.length;
      s += y;
    }
    for (const a of alls) {
      const y = a.b[a.i];
      a.b[a.i] = s + y * 0.5;
      a.i = (a.i + 1) % a.b.length;
      s = y - s;
    }
    out[n] = x[n] * (1 - mix) + s * mix * 3;
  }
  return out;
}

// Feedback echo (for plucks).
function echo(x, sec, fb = 0.35, mix = 0.3) {
  const d = Math.round(sec * SR), out = Float32Array.from(x);
  for (let n = d; n < out.length; n++) out[n] += out[n - d] * fb;
  return out.map((v, n) => x[n] * (1 - mix) + v * mix);
}

const peakNorm = (x, peak = 0.89) => { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); return m ? x.map((v) => (v / m) * peak) : x; };
const fadeEdges = (x, inS = 0.002, outS = 0.01) => {
  const a = Math.round(inS * SR), b = Math.round(outS * SR);
  for (let i = 0; i < a && i < x.length; i++) x[i] *= i / a;
  for (let i = 0; i < b && i < x.length; i++) x[x.length - 1 - i] *= i / b;
  return x;
};

// Encode Float32 channels to MP3 via ffmpeg (WAV in a temp file).
function save(path, chans) {
  chans = Array.isArray(chans) ? chans : [chans];
  const n = chans[0].length, ch = chans.length;
  const wav = Buffer.alloc(44 + n * ch * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * ch * 2, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(ch, 22); wav.writeUInt32LE(SR, 24);
  wav.writeUInt32LE(SR * ch * 2, 28); wav.writeUInt16LE(ch * 2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(n * ch * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, chans[c][i])) * 32767), 44 + (i * ch + c) * 2);
  }
  const tmp = join(tmpdir(), `mf-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);
  writeFileSync(tmp, wav);
  mkdirSync(dirname(path), { recursive: true });
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-c:a', 'libmp3lame', '-b:a', ch > 1 ? '160k' : '128k', path]);
  rmSync(tmp);
  if (r.status !== 0) throw new Error(String(r.stderr));
  console.log('  ' + path.slice(ROOT.length + 1));
}

// ---- sound effects -------------------------------------------------------------------------------
const SFX = {
  // Air moving past: band-passed noise sweeping up then down.
  whoosh() {
    const x = buf(0.55), f = svf();
    for (let n = 0; n < x.length; n++) {
      const t = n / SR, p = t / 0.55;
      const fc = 400 + 2600 * Math.sin(Math.PI * Math.pow(p, 0.8));
      x[n] = f(rand(), fc, 1.4).bp * Math.pow(Math.sin(Math.PI * Math.pow(p, 0.7)), 2);
    }
    return fadeEdges(peakNorm(x, 0.7));
  },
  // A finger tap on glass: a tiny click with a bright, very short tone.
  tap() {
    const x = buf(0.09), f = svf();
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      x[n] = f(rand(), 4000, 0.8).hp * env(t, 0.0005, 0.004) * 0.6 + Math.sin(TAU * 1900 * t) * env(t, 0.001, 0.012);
    }
    return fadeEdges(peakNorm(x, 0.6));
  },
  // Clock tick, for counters and step changes.
  tick() {
    const x = buf(0.05);
    for (let n = 0; n < x.length; n++) { const t = n / SR; x[n] = Math.sin(TAU * 3100 * t) * env(t, 0.0005, 0.006); }
    return fadeEdges(peakNorm(x, 0.45));
  },
  // Bubble pop: a sine dropping in pitch, for badges and chips landing.
  pop() {
    const x = buf(0.16);
    let ph = 0;
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      ph += TAU * (300 + 700 * Math.exp(-t / 0.025)) / SR;
      x[n] = Math.sin(ph) * env(t, 0.002, 0.04);
    }
    return fadeEdges(peakNorm(x, 0.75));
  },
  // A deep impact for the hook or a big reveal.
  hit() {
    const x = buf(0.9), f = svf();
    let ph = 0;
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      ph += TAU * (42 + 110 * Math.exp(-t / 0.04)) / SR;
      const body = Math.tanh(1.6 * Math.sin(ph)) * env(t, 0.002, 0.22);
      const crack = f(rand(), 1800, 0.7).lp * env(t, 0.0005, 0.03);
      x[n] = body + crack * 0.8;
    }
    return fadeEdges(peakNorm(reverb(x, { mix: 0.18, size: 1.2 }), 0.9));
  },
  // Two-note bell: the payoff / success moment.
  chime() {
    const x = buf(1.8);
    const bell = (t, f0) => [1, 2.0, 2.76, 5.4].reduce((s, r, i) => s + Math.sin(TAU * f0 * r * t) * env(t, 0.002, [0.9, 0.5, 0.3, 0.12][i]) * [1, 0.45, 0.3, 0.15][i], 0);
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      x[n] = bell(t, midi(84)) * 0.6 + (t > 0.12 ? bell(t - 0.12, midi(91)) * 0.55 : 0);
    }
    return fadeEdges(peakNorm(reverb(x, { mix: 0.3, size: 1.1 }), 0.7), 0.002, 0.2);
  },
  // Rising three-note "done" sound.
  success() {
    const x = buf(1.0);
    const notes = [[0, 72], [0.09, 76], [0.18, 79]];
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      for (const [at, m] of notes) if (t >= at) {
        const u = t - at, fr = midi(m);
        x[n] += (Math.sin(TAU * fr * u) + 0.25 * Math.sin(TAU * fr * 2 * u)) * env(u, 0.004, 0.18);
      }
    }
    return fadeEdges(peakNorm(reverb(x, { mix: 0.22 }), 0.65), 0.002, 0.1);
  },
  // Two falling, buzzy notes: something went wrong.
  error() {
    const x = buf(0.6), f = svf();
    const notes = [[0, 58], [0.16, 53]];
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      let s = 0;
      for (const [at, m] of notes) if (t >= at) {
        const u = t - at;
        s += (((midi(m) * u) % 1) * 2 - 1) * env(u, 0.005, 0.12);   // saw
      }
      x[n] = f(s, 1400, 0.8).lp;
    }
    return fadeEdges(peakNorm(x, 0.6), 0.002, 0.05);
  },
  // One keyboard key; trigger several for typing.
  type() {
    const x = buf(0.05), f = svf(), g = svf();
    for (let n = 0; n < x.length; n++) {
      const t = n / SR, r = rand();
      x[n] = f(r, 2500, 2.5).bp * env(t, 0.0003, 0.008) + g(r, 600, 3).bp * env(t, 0.0005, 0.012) * 0.5;
    }
    return fadeEdges(peakNorm(x, 0.4));
  },
  // Phone notification ding.
  notify() {
    const x = buf(0.7);
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      const a = Math.sin(TAU * 1760 * t) * env(t, 0.002, 0.12);
      const b = t > 0.08 ? Math.sin(TAU * 2349 * (t - 0.08)) * env(t - 0.08, 0.002, 0.16) : 0;
      x[n] = a * 0.8 + b;
    }
    return fadeEdges(peakNorm(reverb(x, { mix: 0.15 }), 0.6), 0.002, 0.05);
  },
  // Tension builder that ends abruptly; put it right before a hit.
  riser() {
    const x = buf(1.6), f = svf();
    let ph = 0;
    for (let n = 0; n < x.length; n++) {
      const t = n / SR, p = t / 1.6;
      ph += TAU * (200 + 900 * p * p) / SR;
      x[n] = (f(rand(), 500 + 6000 * p * p, 1.2).bp * 0.8 + Math.sin(ph) * 0.3) * Math.pow(p, 2.2);
    }
    return fadeEdges(peakNorm(x, 0.7), 0.002, 0.004);
  },
  // Soft cash-register style "ka-ching" substitute: bright bell + click, for money moments.
  coin() {
    const x = buf(0.8);
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      const a = Math.sin(TAU * midi(88) * t) * env(t, 0.001, 0.08);
      const b = t > 0.07 ? (Math.sin(TAU * midi(93) * (t - 0.07)) + 0.3 * Math.sin(TAU * midi(93) * 2.7 * (t - 0.07))) * env(t - 0.07, 0.001, 0.25) : 0;
      x[n] = a * 0.6 + b * 0.8;
    }
    return fadeEdges(peakNorm(reverb(x, { mix: 0.2 }), 0.6), 0.002, 0.1);
  },

  // ---- the short-form staples (Reels / TikTok / Shorts explainers) ----
  // A page turning: a papery flutter (filtered noise in quick flaps) that ends on a soft slap.
  pageturn() {
    const x = buf(0.55), f = svf(), g = svf();
    for (let n = 0; n < x.length; n++) {
      const t = n / SR, p = t / 0.42;
      const flutter = 0.55 + 0.45 * Math.sin(TAU * (18 + 22 * p) * t);
      const sweep = p < 1 ? Math.pow(Math.sin(Math.PI * p), 1.5) : 0;
      const slap = t > 0.4 ? g(rand(), 900, 0.9).lp * env(t - 0.4, 0.001, 0.03) * 1.6 : 0;
      x[n] = f(rand(), 2500 + 3500 * p, 0.8).bp * sweep * flutter + slap;
    }
    return fadeEdges(peakNorm(x, 0.6));
  },
  // A clean UI beep: a short square-ish tone, for a fact or label landing.
  beep() {
    const x = buf(0.16), f = svf();
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      x[n] = f(Math.tanh(3 * Math.sin(TAU * 1320 * t)), 3000, 0.7).lp * (t < 0.11 ? Math.min(1, t / 0.003) : Math.exp(-(t - 0.11) / 0.01));
    }
    return fadeEdges(peakNorm(x, 0.45));
  },
  // A round, cartoony boop: a soft sine sliding down, for a question or a playful turn.
  boop() {
    const x = buf(0.28);
    let ph = 0;
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      ph += TAU * (520 * Math.exp(-t / 0.18) + 180) / SR;
      x[n] = (Math.sin(ph) + 0.15 * Math.sin(2 * ph)) * env(t, 0.006, 0.09);
    }
    return fadeEdges(peakNorm(x, 0.7));
  },
  // Bop: a short pitched-up bloop, for words popping on screen (lighter than pop).
  bop() {
    const x = buf(0.14);
    let ph = 0;
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      ph += TAU * (500 + 900 * (1 - Math.exp(-t / 0.02))) / SR;
      x[n] = Math.sin(ph) * env(t, 0.002, 0.035);
    }
    return fadeEdges(peakNorm(x, 0.6));
  },
  // A bright single ding, for "here's the point".
  ding() {
    const x = buf(1.2);
    for (let n = 0; n < x.length; n++) {
      const t = n / SR, f0 = midi(91);
      x[n] = [1, 2.4, 3.9].reduce((s, r, i) => s + Math.sin(TAU * f0 * r * t) * env(t, 0.001, [0.45, 0.18, 0.07][i]) * [1, 0.3, 0.12][i], 0);
    }
    return fadeEdges(peakNorm(reverb(x, { mix: 0.2 }), 0.55), 0.002, 0.15);
  },
  // Camera shutter: two mechanical clicks, for a photo or a "snapshot" fact.
  shutter() {
    const x = buf(0.22), f = svf();
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      const c1 = env(t, 0.0003, 0.006), c2 = t > 0.09 ? env(t - 0.09, 0.0003, 0.01) * 0.8 : 0;
      x[n] = f(rand(), 3200, 1.2).bp * (c1 + c2) + Math.sin(TAU * 180 * t) * c1 * 0.4;
    }
    return fadeEdges(peakNorm(x, 0.6));
  },
  // Record scratch: a fast pitch wobble on a noisy tone, for "wait, what?".
  scratch() {
    const x = buf(0.45), f = svf();
    let ph = 0;
    for (let n = 0; n < x.length; n++) {
      const t = n / SR, p = t / 0.45;
      const sp = Math.sin(TAU * 4.5 * t) * (1 - p);
      ph += TAU * (220 + 380 * sp) / SR;
      const tone = ((ph / TAU) % 1) * 2 - 1;
      x[n] = f(tone * 0.6 + rand() * 0.5, 1800 + 1500 * Math.abs(sp), 1.5).bp * Math.min(1, t / 0.01) * (1 - p * 0.6);
    }
    return fadeEdges(peakNorm(x, 0.6), 0.002, 0.06);
  },
  // A deep cinematic boom with a long tail, for the big reveal (heavier than hit).
  boom() {
    const x = buf(2.2), f = svf();
    let ph = 0;
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      ph += TAU * (38 + 70 * Math.exp(-t / 0.08)) / SR;
      x[n] = Math.tanh(2.2 * Math.sin(ph)) * env(t, 0.003, 0.6) + f(rand(), 300, 0.7).lp * env(t, 0.002, 0.25) * 0.8;
    }
    return fadeEdges(peakNorm(reverb(x, { mix: 0.25, size: 1.4, damp: 0.6 }), 0.9), 0.002, 0.3);
  },
  // Digital glitch: chopped bursts of bit-crushed noise and tone, for a "reality breaks" moment.
  glitch() {
    const x = buf(0.4);
    for (let n = 0; n < x.length; n++) {
      const t = n / SR, slot = Math.floor(t / 0.035);
      const on = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1][slot % 12];
      const tone = Math.sign(Math.sin(TAU * [880, 220, 1760, 440][slot % 4] * t));
      x[n] = on * (Math.round((tone * 0.6 + rand() * 0.4) * 4) / 4) * (1 - t / 0.42);
    }
    return fadeEdges(peakNorm(x, 0.45));
  },
  // Sparkle: a quick run of high bell tones, for something magical or "mind-blown".
  sparkle() {
    const x = buf(1.0);
    const notes = [96, 100, 103, 108, 103, 108];
    for (let n = 0; n < x.length; n++) {
      const t = n / SR;
      notes.forEach((m, i) => { const at = i * 0.045; if (t >= at) x[n] += Math.sin(TAU * midi(m) * (t - at)) * env(t - at, 0.001, 0.12) * (1 - i * 0.1); });
    }
    return fadeEdges(peakNorm(reverb(x, { mix: 0.35 }), 0.45), 0.002, 0.2);
  },
  // Swipe: a short, bright air swish, for sliding a card or switching an idea (shorter than whoosh).
  swipe() {
    const x = buf(0.25), f = svf();
    for (let n = 0; n < x.length; n++) {
      const t = n / SR, p = t / 0.25;
      x[n] = f(rand(), 1500 + 6000 * p, 1.8).bp * Math.pow(Math.sin(Math.PI * p), 2);
    }
    return fadeEdges(peakNorm(x, 0.55));
  },
};

// ---- music beds ---------------------------------------------------------------------------------
// Each bed is a seamless loop (the reverb tail is wrapped back to the start). Keep them quiet and
// simple: they sit under a voice.
function bed({ bpm, bars, chords, drums, pluck, bass, padLevel = 0.5, cutoff = 1400 }) {
  const beat = 60 / bpm, barS = beat * 4, L = bars * barS, tail = 3;
  const N = Math.ceil((L + tail) * SR);
  const pad = [new Float32Array(N), new Float32Array(N)], dry = [new Float32Array(N), new Float32Array(N)];
  const add = (ch, n, v) => { if (n >= 0 && n < N) ch[n] += v; };

  // Pad: three detuned saws per chord note, lowpassed, slow attack, panned wide.
  chords.forEach((chord, ci) => {
    const t0 = ci * barS * (bars / chords.length);
    const dur = barS * (bars / chords.length);
    chord.forEach((m, vi) => {
      [-0.08, 0, 0.08].forEach((det, di) => {
        const fr = midi(m) * Math.pow(2, det / 12), f = svf(), pan = ((vi + di) % 3 - 1) * 0.6;
        const s0 = Math.round(t0 * SR), len = Math.round((dur + 1.2) * SR);
        let ph = (rand() + 1) / 2;
        for (let i = 0; i < len; i++) {
          const t = i / SR;
          const a = Math.min(1, t / 0.9) * (t > dur ? Math.exp(-(t - dur) / 0.4) : 1);
          ph += fr / SR;
          const v = f(((ph % 1) * 2 - 1), cutoff, 0.6).lp * a * 0.05 * padLevel;
          add(pad[0], s0 + i, v * (1 - pan) * 0.7); add(pad[1], s0 + i, v * (1 + pan) * 0.7);
        }
      });
    });
  });

  // Bass: root of each chord on a rhythm pattern (beats within the bar).
  if (bass) chords.forEach((chord, ci) => {
    const barsPer = bars / chords.length;
    for (let b = 0; b < barsPer; b++) for (const at of bass.pattern) {
      const start = (ci * barsPer + b) * barS + at * beat, s0 = Math.round(start * SR), len = Math.round(bass.len * beat * SR);
      const fr = midi(chord[0] - 12 * (bass.down ?? 1)), f = svf();
      for (let i = 0; i < len; i++) {
        const t = i / SR, a = env(t, 0.005, bass.decay ?? 0.25) * Math.min(1, (len - i) / 300);
        const v = f(Math.sin(TAU * fr * t) + 0.35 * (((fr * t) % 1) * 2 - 1), 500, 0.7).lp * a * 0.32;
        add(dry[0], s0 + i, v); add(dry[1], s0 + i, v);
      }
    }
  });

  // Pluck arpeggio: chord tones up an octave, sine with fast decay, echoed later.
  const pl = [new Float32Array(N), new Float32Array(N)];
  if (pluck) chords.forEach((chord, ci) => {
    const barsPer = bars / chords.length;
    const tones = [...chord.map((m) => m + 12), chord[0] + 24];
    for (let b = 0; b < barsPer; b++) pluck.pattern.forEach((at, k) => {
      const s0 = Math.round(((ci * barsPer + b) * barS + at * beat) * SR), fr = midi(tones[k % tones.length]);
      const pan = k % 2 ? 0.35 : -0.35;
      for (let i = 0; i < 0.6 * SR; i++) {
        const t = i / SR, v = (Math.sin(TAU * fr * t) + 0.2 * Math.sin(TAU * fr * 2 * t)) * env(t, 0.003, 0.14) * 0.11 * (pluck.level ?? 1);
        add(pl[0], s0 + i, v * (1 - pan)); add(pl[1], s0 + i, v * (1 + pan));
      }
    });
  });

  // Drums: soft kick, closed hat, optional clap.
  if (drums) for (let b = 0; b < bars; b++) {
    for (const at of drums.kick || []) {
      const s0 = Math.round((b * barS + at * beat) * SR); let ph = 0;
      for (let i = 0; i < 0.35 * SR; i++) {
        const t = i / SR; ph += TAU * (45 + 80 * Math.exp(-t / 0.03)) / SR;
        const v = Math.sin(ph) * env(t, 0.002, 0.11) * 0.42 * (drums.level ?? 1);
        add(dry[0], s0 + i, v); add(dry[1], s0 + i, v);
      }
    }
    for (const at of drums.hat || []) {
      const s0 = Math.round((b * barS + at * beat) * SR), f = svf();
      for (let i = 0; i < 0.06 * SR; i++) {
        const t = i / SR, v = f(rand(), 9000, 0.7).hp * env(t, 0.001, 0.015) * 0.07 * (drums.level ?? 1);
        add(dry[0], s0 + i, v * 0.8); add(dry[1], s0 + i, v * 1.2);
      }
    }
    for (const at of drums.clap || []) {
      const s0 = Math.round((b * barS + at * beat) * SR), f = svf();
      for (let i = 0; i < 0.2 * SR; i++) {
        const t = i / SR, v = f(rand(), 1500, 1.5).bp * env(t, 0.002, 0.05) * 0.18 * (drums.level ?? 1);
        add(dry[0], s0 + i, v); add(dry[1], s0 + i, v);
      }
    }
  }

  // Mix: reverb on pad and pluck, echo on pluck, then wrap the tail into the start for a clean loop.
  const out = [0, 1].map((c) => {
    const plE = echo(pl[c], beat * 0.75, 0.3, 0.35);
    const wet = reverb(pad[c].map((v, n) => v + plE[n]), { mix: 0.35, size: 1.25, damp: 0.5 });
    const L2 = Math.round(L * SR), o = new Float32Array(L2);
    for (let n = 0; n < N; n++) o[n % L2] += wet[n] + dry[c][n];
    return o;
  });
  // RMS-normalize both channels together to a quiet, consistent level.
  let ss = 0; for (const ch of out) for (const v of ch) ss += v * v;
  const rms = Math.sqrt(ss / (out[0].length * 2)), g = 0.12 / rms;
  let pk = 0; for (const ch of out) for (const v of ch) pk = Math.max(pk, Math.abs(v * g));
  const gg = pk > 0.9 ? g * 0.9 / pk : g;
  return out.map((ch) => ch.map((v) => v * gg));
}

// Progressions in MIDI notes (C4 = 60).
const MUSIC = {
  // Warm, steady, 100 bpm: the default explainer bed.
  pulse: () => bed({
    bpm: 100, bars: 16,
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],          // Am F C G
    drums: { kick: [0, 2.5], hat: [0.5, 1.5, 2.5, 3.5], level: 0.8 },
    bass: { pattern: [0, 1.5, 2.5], len: 0.9, decay: 0.3 },
    pluck: { pattern: [0, 0.75, 1.5, 2, 2.75, 3.5], level: 0.8 },
  }),
  // No drums, slow and airy, 78 bpm: for calm, trustworthy topics.
  calm: () => bed({
    bpm: 78, bars: 12,
    chords: [[48, 52, 55, 59], [45, 48, 52, 55], [41, 45, 48, 52], [43, 47, 50, 57]],   // Cmaj7 Am7 Fmaj7 G6
    pluck: { pattern: [0, 1, 2, 3], level: 0.7 }, padLevel: 0.65, cutoff: 1100,
  }),
  // Four-on-the-floor, 120 bpm: energetic product demos.
  drive: () => bed({
    bpm: 120, bars: 16,
    chords: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]],           // Dm Bb F C
    drums: { kick: [0, 1, 2, 3], hat: [0.5, 1.5, 2.5, 3.5], clap: [1, 3], level: 0.85 },
    bass: { pattern: [0.5, 1.5, 2.5, 3.5], len: 0.45, decay: 0.12, down: 1 },
    pluck: { pattern: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], level: 0.55 }, padLevel: 0.4, cutoff: 1800,
  }),
};

// `node tools/make-sounds.mjs pageturn boop` writes only those; no names writes everything.
const only = process.argv.slice(2);
const want = (name) => !only.length || only.includes(name);
console.log('sound effects:');
for (const [name, make] of Object.entries(SFX)) { const x = make(); if (want(name)) save(join(ROOT, 'sounds', 'sfx', name + '.mp3'), x); }
console.log('music beds:');
for (const [name, make] of Object.entries(MUSIC)) if (want(name)) save(join(ROOT, 'sounds', 'music', name + '.mp3'), make());
