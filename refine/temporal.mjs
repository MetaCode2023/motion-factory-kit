// refine/temporal.mjs: Phase 4 measurements on an ordered frame sequence (a low-res preview).
//
// Decodes the preview with ffmpeg into small grey frames and measures what a contact sheet can't
// show: flicker, camera jitter, texture swimming, physics pops, duplicated/dropped frames and
// pacing. Every result carries the sampling it was measured at, because these are measured on a
// downscaled preview and anything between samples can be missed.
import { spawn, spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export const DEFAULT_THRESHOLDS = Object.freeze({
  flickerRms: 0.9,        // residual mean-luma wobble, 0-255 units, after a 5-frame moving average
  flickerPeak: 3.0,
  jitterRms: 0.22,        // px at analysis scale: RMS of the camera path's second difference
  swimming: 0.85,         // 1 - spatial autocorrelation of frame differences (1 = white per-pixel boil)
  popFactor: 4.5,         // a frame-to-frame change this many times the median, away from a cut
  duplicateRatio: 0.04,   // share of frames identical to the previous one while the shot moves
  frozenSeconds: 1.2,     // no visible motion for this long
  pacingRatio: 3.2,       // busiest second vs median second, away from cuts
});

// ffmpeg's stream header: "Stream #0:0...: Video: h264 ..., 480x270 ..., 30 fps, ..."
export function probe(file) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const s = r.stderr || '';
  const m = s.match(/Stream #\d+:\d+[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})[^\n]*?([\d.]+) fps/);
  const d = s.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return {
    width: m ? Number(m[1]) : null, height: m ? Number(m[2]) : null, fps: m ? Number(m[3]) : null,
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null,
  };
}

// Decode every frame (no resampling of time) as w x h grey bytes.
export function decodeGray(file, w, h) {
  return new Promise((done, fail) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-fps_mode', 'passthrough',
      '-vf', `scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', '-']);
    const chunks = [];
    let err = '';
    p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', (c) => (err += c));
    p.on('error', fail);
    p.on('close', (code) => {
      if (code !== 0) return fail(new Error('ffmpeg decode failed: ' + err.slice(-400)));
      const buf = Buffer.concat(chunks), size = w * h, frames = [];
      for (let o = 0; o + size <= buf.length; o += size) frames.push(buf.subarray(o, o + size));
      done(frames);
    });
  });
}

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const r3 = (v) => Math.round(v * 1000) / 1000;

// Translation between two frames by SAD block search over +-R px (central region), with a
// parabolic sub-pixel refinement. Good enough to see a camera path wobble.
function shift(a, b, w, h, R = 3) {
  const x0 = Math.floor(w * 0.15), x1 = Math.ceil(w * 0.85), y0 = Math.floor(h * 0.15), y1 = Math.ceil(h * 0.85);
  const cost = (dx, dy) => {
    let s = 0;
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) s += Math.abs(a[y * w + x] - b[(y + dy) * w + (x + dx)]);
    return s;
  };
  let best = [0, 0], bc = Infinity;
  const C = {};
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const c = cost(dx, dy); C[`${dx},${dy}`] = c; if (c < bc) { bc = c; best = [dx, dy]; } }
  const sub = (cm, c0, cp) => { const d = cm - 2 * c0 + cp; return d > 0 ? 0.5 * (cm - cp) / d : 0; };
  const [bx, by] = best;
  const fx = Math.abs(bx) < R ? sub(C[`${bx - 1},${by}`], bc, C[`${bx + 1},${by}`]) : 0;
  const fy = Math.abs(by) < R ? sub(C[`${bx},${by - 1}`], bc, C[`${bx},${by + 1}`]) : 0;
  return [bx + fx, by + fy];
}

// Measure an ordered sequence. `cuts` are shot-time boundaries where big changes are expected.
export function analyzeSequence(frames, { width: w, height: h, fps, cuts = [], expectedFrames = null, expectMotion = true, thresholds = {} }) {
  const T = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const n = frames.length;
  const nearCut = (i) => cuts.some((c) => Math.abs(i / fps - c) <= 1.5 / fps);
  const luma = frames.map((f) => { let s = 0; for (let i = 0; i < f.length; i++) s += f[i]; return s / f.length; });
  const energy = [0], dup = [false], path = [[0, 0]], swim = [];
  for (let i = 1; i < n; i++) {
    const a = frames[i - 1], b = frames[i];
    let d = 0;
    for (let k = 0; k < a.length; k++) d += Math.abs(a[k] - b[k]);
    d /= a.length;
    energy.push(d);
    dup.push(d < 0.02);
    const [dx, dy] = shift(a, b, w, h);
    path.push([path[i - 1][0] + dx, path[i - 1][1] + dy]);
    // Swimming / boiling: real motion changes pixels in spatially coherent blobs; boiling texture,
    // per-frame noise and sparkle change them independently pixel to pixel. Measure the lag-1
    // spatial autocorrelation of the frame difference: 1 - autocorrelation is ~1 for white boil.
    if (!nearCut(i) && d > 0.05) {
      let num = 0, den = 0;
      for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
        const k = y * w + x, dv = b[k] - a[k];
        num += dv * ((b[k + 1] - a[k + 1]) + (b[k + w] - a[k + w]));
        den += 2 * dv * dv;
      }
      swim.push(den > 0 ? 1 - num / den : 0);
    }
  }

  // Flicker: what's left of the mean-luma curve after a 5-frame moving average (cuts excluded).
  const resid = [];
  for (let i = 2; i < n - 2; i++) {
    if (nearCut(i) || nearCut(i - 2) || nearCut(i + 2)) continue;
    resid.push(luma[i] - mean(luma.slice(i - 2, i + 3)));
  }
  const flickerRms = Math.sqrt(mean(resid.map((r) => r * r)));
  const flickerPeak = resid.length ? Math.max(...resid.map(Math.abs)) : 0;

  // Jitter: the camera path should be smooth; its second difference is the shake.
  const acc = [];
  for (let i = 2; i < n; i++) if (!nearCut(i) && !nearCut(i - 1)) acc.push(Math.hypot(path[i][0] - 2 * path[i - 1][0] + path[i - 2][0], path[i][1] - 2 * path[i - 1][1] + path[i - 2][1]));
  const jitterRms = Math.sqrt(mean(acc.map((a) => a * a)));

  // Pops: sudden frame changes far above the shot's own norm, away from cuts (physics blow-ups,
  // a particle system resetting, a texture swap).
  const med = median(energy.slice(1));
  const pops = [];
  for (let i = 1; i < n; i++) if (!nearCut(i) && energy[i] > Math.max(3, med * T.popFactor)) pops.push(r3(i / fps));

  // Duplicate frames while the shot is meant to move = dropped/held frames (frame-rate drop).
  const moving = med > 0.05 || expectMotion;
  const dupCount = dup.filter(Boolean).length;
  const duplicateRatio = n > 1 ? dupCount / (n - 1) : 0;
  let run = 0, longestStill = 0;
  for (let i = 1; i < n; i++) { run = energy[i] < 0.02 ? run + 1 : 0; longestStill = Math.max(longestStill, run); }

  // Pacing: motion energy per second.
  const perSecond = [];
  for (let s = 0; s * fps < n; s++) perSecond.push(mean(energy.slice(Math.max(1, Math.round(s * fps)), Math.round((s + 1) * fps))));
  const pacingRatio = median(perSecond) > 0 ? Math.max(...perSecond) / median(perSecond) : 0;
  const swimming = median(swim);

  const checks = [
    { id: 'flicker', pass: flickerRms <= T.flickerRms && flickerPeak <= T.flickerPeak, value: { rms: r3(flickerRms), peak: r3(flickerPeak) }, limit: { rms: T.flickerRms, peak: T.flickerPeak }, routes: 'temporal' },
    { id: 'jitter', pass: jitterRms <= T.jitterRms, value: r3(jitterRms), limit: T.jitterRms, routes: 'temporal' },
    { id: 'swimming', pass: swimming <= T.swimming, value: r3(swimming), limit: T.swimming, routes: 'temporal' },
    { id: 'physics', pass: pops.length === 0, value: pops, limit: `no change > ${T.popFactor}x median away from cuts`, routes: 'temporal' },
    { id: 'frame-rate', pass: !(moving && duplicateRatio > T.duplicateRatio) && (expectedFrames == null || n >= Math.floor(expectedFrames * 0.98)), value: { frames: n, expectedFrames, duplicates: dupCount, duplicateRatio: r3(duplicateRatio) }, limit: T.duplicateRatio, routes: 'temporal' },
    { id: 'frozen', pass: !(expectMotion && longestStill / fps > T.frozenSeconds), value: r3(longestStill / fps), limit: T.frozenSeconds, routes: 'temporal' },
    { id: 'pacing', pass: pacingRatio <= T.pacingRatio, value: r3(pacingRatio), limit: T.pacingRatio, routes: 'temporal' },
  ];
  return {
    ok: checks.every((c) => c.pass), checks,
    series: { luma: luma.map(r3), energy: energy.map(r3), path: path.map(([x, y]) => [r3(x), r3(y)]), perSecond: perSecond.map(r3) },
    sampling: { frames: n, fps, analysisSize: `${w}x${h}`, note: `measured on every decoded preview frame at ${w}x${h}; detail finer than ~${Math.round(1920 / w)} px at 1080p and anything the preview resolution hides is not measured` },
  };
}

// Pick the frames a critic should see: contract keyframes, both sides of every cut, the moment
// of peak motion and of the largest camera acceleration, and the first/last frames.
export function keyframeTimes({ duration, fps, keyframes = [], cuts = [], energy = [], max = 12 }) {
  const last = Math.max(0, duration - 1 / fps);
  const ts = new Set([0, last, ...keyframes.map((k) => k.t)]);
  for (const c of cuts) { ts.add(Math.max(0, c - 2 / fps)); ts.add(Math.min(last, c + 2 / fps)); }
  if (energy.length > 2) {
    let peak = 1;
    for (let i = 1; i < energy.length; i++) if (energy[i] > energy[peak]) peak = i;
    ts.add(Math.min(last, peak / fps));
  }
  const sorted = [...ts].map((t) => Math.round(t * fps) / fps).sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 0.5 / fps);
  if (sorted.length <= max) return sorted;
  const keep = new Set([sorted[0], sorted.at(-1), ...keyframes.map((k) => Math.round(k.t * fps) / fps)]);
  const rest = sorted.filter((t) => !keep.has(t));
  const step = rest.length / Math.max(1, max - keep.size);
  for (let i = 0; keep.size < max && i < rest.length; i += step) keep.add(rest[Math.floor(i)]);
  return [...keep].sort((a, b) => a - b);
}
