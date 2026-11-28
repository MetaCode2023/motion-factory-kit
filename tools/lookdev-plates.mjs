#!/usr/bin/env node
// tools/lookdev-plates.mjs: physically motivated lookdev reference plates for the underwater
// refinement demo, rendered per pixel (a different technique from the canvas scene that is refined
// against them, so they work as an external target rather than a copy of the scene).
//
//   node tools/lookdev-plates.mjs [--out refine/lookdev/underwater] [--width 960]
//
// Model: a pinhole camera under a rippled surface. Sunlight refracts through the surface, is
// focused into caustics, and is attenuated per channel (red first). Each view ray is marched for
// single scattering, so light shafts come from the caustic pattern itself instead of being drawn on
// top. A seafloor, a turtle-like ellipsoid hero with wrap-lit thin flippers (a cheap subsurface
// stand-in) and depth-of-field marine snow complete the three plates:
//
//   plate-1-establishing  wide: shafts fanning from upper left, deep falloff, distant reef
//   plate-2-hero          the hero lit from above, caustics across the shell, translucent flipper edges
//   plate-3-macro         rack focus into marine snow near the lens, background soft and dim
//
// These are procedural stand-ins for art-directed plates (Google Stitch, a moodboard, concept art).
// Replace them by writing new PNGs and updating the contract's sha256s; the loop doesn't care how a
// plate was made, only that it is the declared target.
import { Canvas } from 'skia-canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', 'refine/lookdev/underwater');
const W = Number(opt('width', 960)), H = Math.round(W * 9 / 16);

// Seeded PRNG: the plates are reproducible byte for byte.
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Clear tropical water, per metre: absorption-dominated extinction, red first.
const SIGMA = [0.32, 0.075, 0.045];
const SCATTER = [0.010, 0.030, 0.036];
const SUN = [1.0, 0.96, 0.86];
const SURFACE_Y = 9;
const sunDir = norm([0.32, -1, 0.18]);             // refracted sun direction (down and to the right)

function norm(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }

// Caustic focus at a surface point: a few interfering ripples, sharpened into bright lines.
function caustic(x, z) {
  let v = 0;
  v += Math.sin(x * 0.9 + Math.sin(z * 0.7) * 1.6);
  v += Math.sin(z * 1.1 - x * 0.4 + Math.sin(x * 0.55) * 1.3);
  v += Math.sin((x + z) * 0.6 + 2.1);
  v = Math.abs(v) / 3;
  return 0.35 + 1.9 * Math.pow(1 - v, 5);
}
// Coherent shaft groups: banded transmission across the surface (long swells focusing light),
// so shafts survive integration along the ray instead of averaging away like fine caustics.
function window_(x, z) {
  const band = 0.5 + 0.5 * Math.sin(x * 0.55 + Math.sin(z * 0.08) * 1.2 + 0.4);
  const band2 = 0.5 + 0.5 * Math.sin(x * 1.37 - z * 0.12 + 1.9);
  return 0.18 + 1.6 * Math.pow(band, 4) + 0.5 * Math.pow(band2, 6);
}

// Sunlight arriving at a point under water.
function sunAt(p) {
  const d = (SURFACE_Y - p[1]) / -sunDir[1];
  if (d <= 0) return [SUN[0], SUN[1], SUN[2]];
  const sx = p[0] - sunDir[0] * d, sz = p[2] - sunDir[2] * d;
  const c = caustic(sx, sz) * window_(sx, sz);
  return SUN.map((s, i) => s * c * Math.exp(-SIGMA[i] * d));
}

const tonemap = (x) => { const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return Math.max(0, Math.min(1, (x * (a * x + b)) / (x * (c * x + d) + e))); };
const srgb = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

function plate({ seed, cam, look, fov, blur = 0, floorY, hero = null, snow, focus, aperture, exposure, steps = 36, maxDist = 60 }) {
  const R = rng(seed);
  const img = new Float32Array(W * H * 3);
  look = Object.assign([...look], { blur });
  const fwd = norm(look), right = norm([fwd[2], 0, -fwd[0]]), up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const tanF = Math.tan(fov / 2);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const u = ((px + 0.5) / W * 2 - 1) * tanF, v = (1 - (py + 0.5) / H * 2) * tanF * H / W;
    const dir = norm([fwd[0] + u * right[0] + v * up[0], fwd[1] + u * right[1] + v * up[1], fwd[2] + u * right[2] + v * up[2]]);
    // What the ray hits: the hero, the floor, or nothing within maxDist.
    let tEnd = maxDist, surf = null;
    if (dir[1] < 0) { const tf = (floorY - cam[1]) / dir[1]; if (tf > 0 && tf < tEnd) { tEnd = tf; surf = 'floor'; } }
    if (dir[1] > 0) { const ts = (SURFACE_Y - cam[1]) / dir[1]; if (ts < tEnd) { tEnd = ts; surf = 'surface'; } }
    let heroHit = null;
    if (hero) for (const part of hero.parts) {
      const t = hitEllipsoid(cam, dir, part);
      if (t && t < tEnd) { tEnd = t; surf = 'hero'; heroHit = part; }
    }
    // Single scattering along the ray, jittered to avoid banding.
    const acc = [0, 0, 0];
    const ds = tEnd / steps, j = R();
    for (let k = 0; k < steps; k++) {
      const s = (k + j) * ds;
      const p = [cam[0] + dir[0] * s, cam[1] + dir[1] * s, cam[2] + dir[2] * s];
      const L = sunAt(p);
      const cosT = -(dir[0] * sunDir[0] + dir[1] * sunDir[1] + dir[2] * sunDir[2]);
      const g = 0.72, phase = (1 - g * g) / Math.pow(1 + g * g - 2 * g * cosT, 1.5) * 0.35;   // Henyey-Greenstein, forward-peaked like water
      for (let i = 0; i < 3; i++) acc[i] += L[i] * SCATTER[i] * phase * Math.exp(-SIGMA[i] * s) * ds;
    }
    // Ambient sky-light from above, fading with depth: the deep-water colour.
    const depthAt = (y) => Math.max(0, SURFACE_Y - y);
    let col = [0, 0, 0];
    const pEnd = [cam[0] + dir[0] * tEnd, cam[1] + dir[1] * tEnd, cam[2] + dir[2] * tEnd];
    if (surf === 'floor') {
      const n = 0.5 + 0.5 * Math.sin(pEnd[0] * 1.7) * Math.sin(pEnd[2] * 2.3), rock = Math.max(0, Math.sin(pEnd[0] * 0.21 + Math.sin(pEnd[2] * 0.3) * 2)) ** 3;
      const alb = [0.55 - rock * 0.3 + n * 0.08, 0.52 - rock * 0.25 + n * 0.07, 0.42 - rock * 0.2 + n * 0.05];
      const L = sunAt(pEnd), amb = depthAt(pEnd[1]);
      col = alb.map((a, i) => a * (L[i] * 0.85 * -sunDir[1] + 0.05 * Math.exp(-SIGMA[i] * amb)));
    } else if (surf === 'hero') {
      const nrm = ellipsoidNormal(pEnd, heroHit);
      // Paintover choice (DESIGN.md): the shell keeps its amber where the key light lands, so the key
      // reaching the hero loses less red than physics alone would leave (red extinction 0.1/m, not 0.32).
      const Lp = sunAt(pEnd), dS = (SURFACE_Y - pEnd[1]) / -sunDir[1];
      const L = [Lp[0] * Math.exp((SIGMA[0] - 0.1) * dS), Lp[1], Lp[2]];
      const ndl = -(nrm[0] * sunDir[0] + nrm[1] * sunDir[1] + nrm[2] * sunDir[2]);
      const wrap = heroHit.thin ? 0.55 : 0.12;              // thin flippers pass light through
      const diff = Math.max(0, (ndl + wrap) / (1 + wrap));
      const ao = 0.35 + 0.65 * Math.max(0, nrm[1] * 0.5 + 0.5);
      const alb = heroAlbedo(pEnd, heroHit);
      const back = heroHit.thin ? Math.max(0, -ndl) * 0.35 : 0;   // transmitted light at the edges, warmer
      const spec = Math.pow(Math.max(0, -(dir[0] * nrm[0] + dir[1] * nrm[1] + dir[2] * nrm[2]) * 0 + Math.max(0, ndl)), 24) * 0.08 * (heroHit.thin ? 0.3 : 1);
      col = alb.map((a, i) => (a * (L[i] * diff * ao + 0.035 * ao) + L[i] * back * [1.0, 0.7, 0.4][i] * a + spec * L[i]));
    } else {
      // Open water: the deep colour, much darker looking down than looking up at the surface.
      const up = Math.max(-1, Math.min(1, dir[1] * 2.2));
      col = [0.002, 0.018, 0.045].map((c) => c * Math.exp(up * 1.6));
    }
    // Same paintover on the view path for the hero: its amber survives the few metres to the lens.
    const sv = surf === 'hero' ? [0.1, SIGMA[1], SIGMA[2]] : SIGMA;
    for (let i = 0; i < 3; i++) img[(py * W + px) * 3 + i] = col[i] * Math.exp(-sv[i] * tEnd) + acc[i];
  }
  // Background defocus (macro plates): blur the whole volume before the in-focus snow lands on it.
  if (look.blur) for (let pass = 0; pass < 3; pass++) boxBlur(img, W, H, look.blur);
  // Marine snow: 3-D particles, splatted with their defocus disc, lit by the light where they are.
  for (let k = 0; k < snow.count; k++) {
    const p = [cam[0] + (R() - 0.5) * snow.spread[0], cam[1] + (R() - 0.5) * snow.spread[1], cam[2] + snow.near + R() ** 1.6 * (snow.far - snow.near)];
    const rel = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
    const z = rel[0] * fwd[0] + rel[1] * fwd[1] + rel[2] * fwd[2];
    if (z < 0.05) continue;
    const sx = (rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2]) / z / tanF, sy = (rel[0] * up[0] + rel[1] * up[1] + rel[2] * up[2]) / z / (tanF * H / W);
    const X = (sx + 1) / 2 * W, Y = (1 - sy) / 2 * H;
    if (X < -40 || X > W + 40 || Y < -40 || Y > H + 40) continue;
    const size = (snow.size * (0.4 + R())) / z * W * 0.5;
    const coc = Math.abs(z - focus) / z * aperture * W * 0.5;          // circle of confusion, px
    const rad = Math.max(0.6, Math.hypot(size, coc));
    const L = sunAt(p), att = SIGMA.map((s) => Math.exp(-s * z));
    const energy = snow.brightness * size * size / (rad * rad);
    const r = Math.ceil(rad * 2);
    for (let yy = Math.max(0, Math.floor(Y - r)); yy < Math.min(H, Math.ceil(Y + r)); yy++) for (let xx = Math.max(0, Math.floor(X - r)); xx < Math.min(W, Math.ceil(X + r)); xx++) {
      const d = Math.hypot(xx - X, yy - Y) / rad;
      const w = coc > size * 1.5 ? (d < 1 ? 0.85 + 0.15 * d : Math.max(0, 1 - (d - 1) * 4)) : Math.exp(-d * d * 2);   // bokeh disc vs crisp speck
      if (w <= 0) continue;
      for (let i = 0; i < 3; i++) img[(yy * W + xx) * 3 + i] += energy * w * (L[i] * 0.8 + 0.06) * att[i];
    }
  }
  // Tone map, vignette, fine deterministic grain.
  const c = new Canvas(W, H), ctx = c.getContext('2d'), id = ctx.createImageData(W, H);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const vx = px / W - 0.5, vy = py / H - 0.5, vig = 1 - 0.55 * (vx * vx + vy * vy) * 1.6;
    const g = (R() - 0.5) * 0.012;
    for (let i = 0; i < 3; i++) id.data[(py * W + px) * 4 + i] = Math.round(255 * srgb(tonemap(img[(py * W + px) * 3 + i] * exposure * vig) + g));
    id.data[(py * W + px) * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

function boxBlur(img, w, h, r) {
  const tmp = new Float32Array(img.length);
  for (const [a, b, horiz] of [[img, tmp, true], [tmp, img, false]]) {
    const n = horiz ? w : h, m = horiz ? h : w;
    for (let j = 0; j < m; j++) for (let c = 0; c < 3; c++) {
      let sum = 0;
      const at = (i) => (horiz ? (j * w + Math.max(0, Math.min(w - 1, i))) : (Math.max(0, Math.min(h - 1, i)) * w + j)) * 3 + c;
      for (let i = -r; i <= r; i++) sum += a[at(i)];
      for (let i = 0; i < n; i++) { b[at(i)] = sum / (2 * r + 1); sum += a[at(i + r + 1)] - a[at(i - r)]; }
    }
  }
}

function hitEllipsoid(o, d, e) {
  const oc = [(o[0] - e.c[0]) / e.r[0], (o[1] - e.c[1]) / e.r[1], (o[2] - e.c[2]) / e.r[2]];
  const dd = [d[0] / e.r[0], d[1] / e.r[1], d[2] / e.r[2]];
  const a = dd[0] ** 2 + dd[1] ** 2 + dd[2] ** 2, b = 2 * (oc[0] * dd[0] + oc[1] * dd[1] + oc[2] * dd[2]), c = oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t > 0 ? t : null;
}
function ellipsoidNormal(p, e) { return norm([(p[0] - e.c[0]) / e.r[0] ** 2, (p[1] - e.c[1]) / e.r[1] ** 2, (p[2] - e.c[2]) / e.r[2] ** 2]); }
function heroAlbedo(p, e) {
  if (e.kind === 'shell') {
    // Scutes: a cellular pattern in the shell's own frame, dark seams, warm amber plates.
    const u = (p[0] - e.c[0]) / e.r[0] * 3.2, w = (p[2] - e.c[2]) / e.r[2] * 2.6;
    let d1 = 9, d2 = 9;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const cx = Math.floor(u) + i + 0.5 + 0.35 * Math.sin((Math.floor(u) + i) * 12.9 + (Math.floor(w) + j) * 78.2);
      const cz = Math.floor(w) + j + 0.5 + 0.35 * Math.cos((Math.floor(u) + i) * 39.3 + (Math.floor(w) + j) * 11.1);
      const d = Math.hypot(u - cx, w - cz);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    const seam = Math.min(1, (d2 - d1) * 6);
    return [0.42 * seam + 0.06, 0.30 * seam + 0.05, 0.16 * seam + 0.04];
  }
  const spots = 0.75 + 0.25 * Math.sin(p[0] * 31) * Math.sin(p[2] * 27);
  return [0.36 * spots, 0.34 * spots, 0.26 * spots];
}

// A turtle-like hero: shell, head and four thin flippers.
function turtle(c, s) {
  return { parts: [
    { kind: 'shell', c, r: [1.05 * s, 0.34 * s, 0.8 * s] },
    { kind: 'skin', c: [c[0] + 1.18 * s, c[1] + 0.02 * s, c[2] - 0.05 * s], r: [0.34 * s, 0.2 * s, 0.22 * s] },
    { kind: 'skin', thin: true, c: [c[0] + 0.45 * s, c[1] - 0.02 * s, c[2] - 0.95 * s], r: [0.75 * s, 0.07 * s, 0.32 * s] },
    { kind: 'skin', thin: true, c: [c[0] + 0.45 * s, c[1] - 0.02 * s, c[2] + 0.95 * s], r: [0.75 * s, 0.07 * s, 0.32 * s] },
    { kind: 'skin', thin: true, c: [c[0] - 0.85 * s, c[1] - 0.03 * s, c[2] - 0.55 * s], r: [0.38 * s, 0.06 * s, 0.2 * s] },
    { kind: 'skin', thin: true, c: [c[0] - 0.85 * s, c[1] - 0.03 * s, c[2] + 0.55 * s], r: [0.38 * s, 0.06 * s, 0.2 * s] },
  ] };
}

const PLATES = [
  // Wide: shafts fan down from the upper left, the reef sinks into deep blue, the hero small on the right third.
  ['plate-1-establishing', { seed: 11, cam: [0, 1.0, -14], look: [0.0, 0.1, 1], fov: 1.3, floorY: -3.2, exposure: 2.6,
    hero: turtle([4.6, 3.6, 6], 0.9), snow: { count: 2800, near: 0.6, far: 24, spread: [30, 16], size: 0.012, brightness: 1.5 }, focus: 14, aperture: 0.018 }],
  // Hero: from above and behind, caustics dancing across the scutes, light passing through the thin flipper edges.
  ['plate-2-hero', { seed: 22, cam: [-0.4, 3.6, -4.4], look: [0.2, -0.36, 1], fov: 1.0, floorY: -3.2, exposure: 2.4,
    hero: turtle([1.3, 1.5, 1.9], 1.2), snow: { count: 1800, near: 0.5, far: 14, spread: [16, 10], size: 0.012, brightness: 1.4 }, focus: 7.6, aperture: 0.03 }],
  // Macro: the camera has pushed past the hero; focus racks to snow drifting a metre from the lens and the
  // turtle over the caustic floor melts into the background.
  ['plate-3-macro', { seed: 33, cam: [0.3, 3.1, -1.2], look: [0.18, -0.3, 1], fov: 0.8, floorY: -3.2, exposure: 2.4, blur: 5,
    hero: turtle([2.0, 1.5, 3.9], 1.2), snow: { count: 1100, near: 0.25, far: 8, spread: [4.5, 3.2], size: 0.009, brightness: 2.6 }, focus: 1.1, aperture: 0.05 }],
];

mkdirSync(OUT, { recursive: true });
for (const [name, p] of PLATES) {
  const started = Date.now();
  const c = plate(p);
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, await c.toBuffer('png'));
  console.log(`${file} ${W}x${H} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
