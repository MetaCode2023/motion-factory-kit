// tools/longform/wipes.mjs: procedural wipe masks. Each family is a small function that gives every pixel a
// "reveal time" between 0 and 1 (a reveal map); a mask frame at progress p is that map, feathered with a
// smoothstep. wipeFrames() writes the mask frames as grayscale PNGs (cached under out/.cache/wipes/<hash>/) and
// build.mjs lays them over the picture with alphamerge + overlay (see wipeGraph in transitions.mjs).
// Everything here is generated from the maths below; no mask image is stored or copied from anywhere.
// PNGs are written with skia-canvas, which the kit already depends on, so there is no new dependency.
// docs/TRANSITIONS.md: every family, the grammar, the graph, how to add a family.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Canvas } from 'skia-canvas';
import { ROOT } from './common.mjs';

export const WIPES_VERSION = 1;   // bump when any family's maths changes, so cached masks are rebuilt
const CACHE = join(ROOT, 'out', '.cache', 'wipes');
const TAU = Math.PI * 2;
const frac = (v) => v - Math.floor(v);
const tri = (v) => Math.abs(frac(v) * 2 - 1);
const rad = (d) => (d * Math.PI) / 180;
const clock = (x, y) => frac(Math.atan2(x, -y) / TAU);   // 0 at 12 o'clock, growing clockwise

// Seeded PRNG (mulberry32, the same one as FX.rng in kit/fx.js).
export function mulberry32(seed = 1) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let r = Math.imul(seed ^ (seed >>> 15), 1 | seed); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
}

// Parameters each family takes, with defaults. softness and dur are common to all and live in the spec.
export const FAMILIES = {
  linear: { angle: 0 }, clock: { angle: 0 }, clock2: { angle: 0 }, iris: {}, 'iris-in': {}, ellipse: {}, diamond: {}, box: {}, cross: {},
  'barn-h': {}, 'barn-v': {}, 'blinds-h': { count: 8 }, 'blinds-v': { count: 8 }, checker: { count: 8 }, 'diagonal-bars': { count: 6, angle: 45 },
  zigzag: { count: 8, amp: 0.08, angle: 0 }, wave: { count: 3, amp: 0.08, angle: 0 }, spiral: { turns: 0.35 }, star: { count: 5, depth: 0.5 }, noise: { count: 32, seed: 1 },
};

// Each shape takes the frame size and parameters and returns (x, y) -> t, with x and y in pixels from the centre.
// t only has to order the pixels: revealMap rescales it to 0..1.
const axes = (q) => { const a = rad(q.angle), c = Math.cos(a), s = Math.sin(a), L = Math.abs(q.w * c) + Math.abs(q.h * s); return { c, s, L }; };
const SHAPES = {
  linear: (q) => { const { c, s, L } = axes(q); return (x, y) => (x * c + y * s) / L; },
  clock: (q) => (x, y) => frac(clock(x, y) - q.angle / 360),
  clock2: (q) => (x, y) => frac(2 * (clock(x, y) - q.angle / 360)),
  iris: () => (x, y) => Math.hypot(x, y),
  'iris-in': () => (x, y) => -Math.hypot(x, y),
  ellipse: (q) => (x, y) => Math.hypot(x / q.w, y / q.h),
  diamond: () => (x, y) => Math.abs(x) + Math.abs(y),
  box: (q) => (x, y) => Math.max(Math.abs(x) / q.w, Math.abs(y) / q.h),
  cross: () => (x, y) => Math.min(Math.abs(x), Math.abs(y)),
  'barn-h': () => (x) => Math.abs(x),
  'barn-v': () => (x, y) => Math.abs(y),
  'blinds-h': (q) => (x, y) => frac((y / q.h + 0.5) * q.count),
  'blinds-v': (q) => (x) => frac((x / q.w + 0.5) * q.count),
  checker: (q) => { const cell = q.w / q.count; return (x, y) => { const X = (x + q.w / 2) / cell, Y = (y + q.h / 2) / cell; return ((Math.floor(X) + Math.floor(Y)) & 1) * 0.5 + 0.25 * (frac(X) + frac(Y)); }; },
  'diagonal-bars': (q) => {
    const { c, s, L } = axes(q), size = (Math.abs(q.w * s) + Math.abs(q.h * c)) / q.count;
    return (x, y) => { const n = (x * c + y * s) / L + 0.5, odd = Math.floor((-x * s + y * c) / size) & 1; return odd ? 1 - n : n; };
  },
  zigzag: (q) => { const { c, s, L } = axes(q); return (x, y) => (x * c + y * s) / L + q.amp * tri((-x * s + y * c) / q.h * q.count); },
  wave: (q) => { const { c, s, L } = axes(q); return (x, y) => (x * c + y * s) / L + q.amp * Math.sin(TAU * (-x * s + y * c) / q.h * q.count); },
  spiral: (q) => { const R = Math.hypot(q.w, q.h) / 2; return (x, y) => Math.hypot(x, y) / R + q.turns * clock(x, y); },
  star: (q) => (x, y) => Math.hypot(x, y) / (1 + q.depth * tri(clock(x, y) * q.count)),
  noise: (q) => {
    const cell = q.w / q.count, cols = Math.ceil(q.count), rows = Math.ceil(q.h / cell), rnd = mulberry32(q.seed), vals = Array.from({ length: cols * rows }, rnd);
    return (x, y) => vals[Math.min(rows - 1, Math.floor((y + q.h / 2) / cell)) * cols + Math.min(cols - 1, Math.floor((x + q.w / 2) / cell))];
  },
};

// One value per pixel in 0..1: the progress at which the new picture reaches that pixel.
export function revealMap(family, params, w, h) {
  const shape = SHAPES[family]({ ...FAMILIES[family], ...params, w, h });
  const t = new Float32Array(w * h);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = shape(x + 0.5 - w / 2, y + 0.5 - h / 2); t[y * w + x] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo;
  for (let i = 0; i < t.length; i++) t[i] = span > 0 ? (t[i] - lo) / span : 0;
  return t;
}

// The mask at progress p (0 all black, 1 all white): each pixel ramps up over a window of `softness`, smoothstepped.
export function maskFrame(map, p, softness) {
  const sf = Math.max(softness, 1e-3), out = new Uint8Array(map.length);
  for (let i = 0; i < map.length; i++) {
    const x = Math.min(1, Math.max(0, (p * (1 + sf) - map[i]) / sf));
    out[i] = Math.round(255 * x * x * (3 - 2 * x));
  }
  return out;
}

function png(gray, w, h) {
  const c = new Canvas(w, h), g = c.getContext('2d'), img = g.createImageData(w, h);
  for (let i = 0; i < gray.length; i++) img.data.set([gray[i], gray[i], gray[i], 255], i * 4);
  g.putImageData(img, 0, 0);
  return c.toBufferSync('png');
}

// Mask frames 0000.png ... for a wipe of `dur` seconds: the first is all black, the last all white. Returns the folder.
export function wipeFrames(spec, { w, h, fps, dur, cache = CACHE }) {
  const n = Math.max(2, Math.round(dur * fps));
  const key = createHash('sha1').update(JSON.stringify([WIPES_VERSION, spec.family, spec.params, spec.softness, w, h, n])).digest('hex').slice(0, 16);
  const dir = join(cache, key);
  if (existsSync(dir)) return dir;
  const map = revealMap(spec.family, spec.params, w, h), tmp = `${dir}.part`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  for (let i = 0; i < n; i++) writeFileSync(join(tmp, `${String(i).padStart(4, '0')}.png`), png(maskFrame(map, i / (n - 1), spec.softness), w, h));
  renameSync(tmp, dir);
  return dir;
}
