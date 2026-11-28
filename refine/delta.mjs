// refine/delta.mjs: step 6 (delta identification) and the advisory half of step 7.
//
// Compares a render's measurements with its mapped reference plate and the DESIGN.md targets, and
// writes a qualitative delta log: which way each measurable property is off, by how much relative
// to its tolerance, and which creative criterion it bears on. There is no overall quality score.
// The single `distance` number is only for early stopping (has the loop stopped moving?).
import { histogramDistance, hueDistance, structureDistance } from './pixels.mjs';

// Tolerances are in the metric's own units. A gap of 1.0 means "exactly at tolerance".
export const COMPARISONS = Object.freeze([
  { metric: 'lumaMean', criterion: 'lighting', tol: 6, what: 'overall exposure (L*)' },
  { metric: 'contrast', criterion: 'lighting', tol: 8, what: 'tonal range p05-p95 (L*)' },
  { metric: 'falloff', criterion: 'lighting', tol: 0.35, what: 'surface-to-depth brightness falloff', log: true },
  { metric: 'hist', criterion: 'lighting', tol: 0.035, what: 'tonal distribution', fn: (r, f) => histogramDistance(r.hist, f.hist), signed: false },
  { metric: 'bMean', criterion: 'color', tol: 5, what: 'blue-yellow balance / colour temperature (b*)' },
  { metric: 'aMean', criterion: 'color', tol: 5, what: 'green-magenta balance (a*)' },
  { metric: 'chroma', criterion: 'color', tol: 6, what: 'saturation (C*)' },
  { metric: 'hue', criterion: 'color', tol: 14, what: 'dominant hue (degrees)', fn: (r, f) => hueDistance(r.hue, f.hue), signed: false },
  { metric: 'structure', criterion: 'composition', tol: 11, what: 'coarse layout of light and colour (mean dE over a 4x4 grid)', fn: (r, f) => structureDistance(r.structure, f.structure), signed: false },
  { metric: 'thirdsDistance', criterion: 'composition', tol: 0.07, what: 'focal point placement relative to the reference' },
  { metric: 'detail', criterion: 'materials', tol: 0.45, what: 'surface/texture detail (Laplacian)', log: true },
  { metric: 'speckleDensity', criterion: 'materials', tol: 0.55, what: 'particulate density (marine snow, sparkle)', log: true },
  { metric: 'bands', criterion: 'spatial', tol: 7, what: 'atmospheric depth profile top-to-bottom (L* per band)', fn: (r, f) => mean(r.bands.map((v, i) => Math.abs(v - f.bands[i]))), signed: false },
]);

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function compareToReference(render, reference) {
  return COMPARISONS.map((c) => {
    let gapRaw, direction = null;
    if (c.fn) gapRaw = c.fn(render, reference);
    else if (c.log) {
      gapRaw = Math.log((render[c.metric] + 1e-3) / (reference[c.metric] + 1e-3));
      direction = gapRaw > 0 ? 'lower' : 'raise';
      gapRaw = Math.abs(gapRaw);
    } else {
      const d = render[c.metric] - reference[c.metric];
      direction = d > 0 ? 'lower' : 'raise';
      gapRaw = Math.abs(d);
    }
    const gap = r3(gapRaw / c.tol);
    const val = (m) => (c.fn ? undefined : m[c.metric]);
    return {
      kind: 'reference', metric: c.metric, criterion: c.criterion, what: c.what,
      render: val(render), reference: val(reference), gap, pass: gap <= 1,
      direction: gap <= 1 ? null : direction,
    };
  });
}

// DESIGN.md targets: { metric: { min?, max?, value?, tol? } } checked directly on the render.
export function checkTargets(render, targets = {}) {
  const out = [];
  for (const [metric, t] of Object.entries(targets)) {
    const v = render[metric];
    if (typeof v !== 'number') { out.push({ kind: 'target', metric, criterion: t.criterion || 'lighting', pass: false, gap: 1, render: null, note: `metric "${metric}" is not measured` }); continue; }
    let gap = 0, direction = null;
    const span = t.tol ?? (Math.abs(t.value ?? t.max ?? t.min ?? 1) * 0.15 || 1);
    if (typeof t.value === 'number') { gap = Math.abs(v - t.value) / span; direction = v > t.value ? 'lower' : 'raise'; }
    if (typeof t.min === 'number' && v < t.min) { gap = Math.max(gap, 1 + (t.min - v) / span); direction = 'raise'; }
    if (typeof t.max === 'number' && v > t.max) { gap = Math.max(gap, 1 + (v - t.max) / span); direction = 'lower'; }
    out.push({ kind: 'target', metric, criterion: t.criterion || 'lighting', what: t.why || null, render: v, target: { min: t.min, max: t.max, value: t.value }, gap: r3(gap), pass: gap <= 1, direction: gap <= 1 ? null : direction });
  }
  return out;
}

// Generic-aesthetic tripwires for the originality criterion: flat lighting, the evenly spread
// default noise field, and large areas of default primary colours. They flag, they don't approve.
export function genericity(render) {
  const out = [];
  const flag = (metric, pass, note) => out.push({ kind: 'genericity', metric, criterion: 'originality', pass, gap: pass ? 0 : 1.5, note });
  flag('flatLighting', render.contrast >= 18 && render.lumaStd >= 6, `tonal range ${render.contrast} L*, std ${render.lumaStd}: flat lighting reads as an unlit default`);
  flag('uniformNoise', !(render.speckleDensity > 1 && render.speckleClustering < 0.12), `speckle clustering ${render.speckleClustering}: particles spread evenly like a default noise field rather than following light and depth`);
  flag('defaultPrimaries', render.primaryFraction < 0.02, `${Math.round(render.primaryFraction * 100)}% of the frame is pure default primaries`);
  return out;
}

// The early-stopping distance: mean of capped gaps. Explicitly not a quality score.
export function distance(items) {
  if (!items.length) return 0;
  return r3(mean(items.map((i) => Math.min(i.gap, 3))) / 3);
}

export function deltaLog(items) {
  return items.filter((i) => !i.pass).map((i) => {
    const dir = i.direction ? `${i.direction} it` : 'bring it closer';
    if (i.kind === 'genericity') return `[${i.criterion}] t=${i.t ?? '?'} ${i.note}`;
    if (i.kind === 'target') return `[${i.criterion}] t=${i.t ?? '?'} ${i.metric} ${i.render} is outside the DESIGN.md target ${JSON.stringify(i.target)}: ${dir}`;
    const vals = i.render === undefined ? `differs from ${i.reference_id ?? 'the reference'}` : `render ${i.render} vs reference ${i.reference}`;
    return `[${i.criterion}] t=${i.t ?? '?'} ${i.what}: ${vals} (gap ${i.gap}x tolerance): ${dir}`;
  });
}

// Advisory parameter moves from the contract's tuning map:
//   tuning: { lumaMean: [{ param: 'exposure', gain: 0.01, min: 0.3, max: 2 }], ... }
// A positive gain means "raising the param raises the metric". The runner (Claude Code or a
// person) decides what to actually change; these are recorded next to what was changed.
export function suggestAdjustments(items, params, tuning = {}) {
  // Sum the signed pull on each param across every failing item (several frames often agree), then
  // make one bounded move per param.
  const pull = new Map();
  for (const item of items) {
    if (item.pass || !item.direction || !tuning[item.metric]) continue;
    const want = item.direction === 'raise' ? 1 : -1;
    for (const t of tuning[item.metric]) {
      const p = pull.get(t.param) || { t, sum: 0, because: new Set() };
      p.sum += want * Math.sign(t.gain) * Math.min(item.gap, 3) * Math.abs(t.gain);
      p.because.add(`${item.metric} ${item.direction} (${item.criterion})`);
      pull.set(t.param, p);
    }
  }
  const next = { ...params }, moves = [];
  for (const [param, { t, sum, because }] of pull) {
    const n = items.filter((i) => !i.pass && i.direction && tuning[i.metric]?.some((x) => x.param === param)).length || 1;
    const step = Math.max(-(t.maxStep ?? Infinity), Math.min(t.maxStep ?? Infinity, sum / n));
    const cur = Number(next[param] ?? t.default ?? 0);
    const val = Math.max(t.min ?? -Infinity, Math.min(t.max ?? Infinity, r3(cur + step)));
    if (val !== cur) { moves.push({ param, from: cur, to: val, because: [...because].join('; ') }); next[param] = val; }
  }
  return { params: next, moves };
}
