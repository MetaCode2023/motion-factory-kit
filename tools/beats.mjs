// tools/beats.mjs: where the beats are in a music track, so cuts and punches can land on them.
//
//   detectBeats(file, duration) -> { bpm, offset, beats: [seconds...], source: 'meta' | 'estimated' }
//
// Bundled tracks carry their tempo in sounds/music/<name>.json. Anything else is estimated from the
// audio: an onset envelope (rises in loudness, 23 ms steps), autocorrelation for the tempo (70-180
// BPM), then the phase that best lines up with the onsets. Good on music with a clear pulse; for
// ambient tracks with no drums, treat it as a suggestion.
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const SR = 11025, HOP = 256;

export function detectBeats(file, duration) {
  const meta = file.replace(/\.[^.\/]+$/, '.json');
  if (existsSync(meta)) {
    const m = JSON.parse(readFileSync(meta, 'utf8'));
    if (m.bpm) return grid(m.bpm, m.offset || 0, duration, 'meta');
  }
  // Onset strength (positive change in log energy per 23 ms hop), for the full mix and for the lows
  // only: the full mix finds the tempo, the lows (kick, bass) find where the downbeats are.
  const onsets = (filter) => {
    const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-t', String(Math.min(90, duration + 5)), ...(filter ? ['-af', filter] : []), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
    if (r.status !== 0 || !r.stdout.length) return null;
    const pcm = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
    const m = Math.floor(pcm.length / HOP), e = new Float32Array(m);
    let prev = 0;
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let j = 0; j < HOP; j++) { const v = pcm[i * HOP + j]; s += v * v; }
      const le = Math.log(1e-9 + s);
      e[i] = Math.max(0, le - prev);
      prev = le;
    }
    const mean = e.reduce((a, b) => a + b, 0) / Math.max(1, m);
    for (let i = 0; i < m; i++) e[i] = Math.max(0, e[i] - mean);
    return e;
  };
  const env = onsets(null), low = onsets('lowpass=f=160,lowpass=f=160');
  if (!env || env.length < 64) return null;
  const n = env.length;
  // Tempo: the lag with the strongest autocorrelation, weighted toward ~110 BPM.
  const fps = SR / HOP;
  let best = 0, bestLag = 0;
  for (let bpm = 70; bpm <= 180; bpm += 0.5) {
    const lag = (60 / bpm) * fps;
    let s = 0;
    for (let i = 0; i + lag < n; i++) {
      const j = i + lag, j0 = Math.floor(j), f = j - j0;
      s += env[i] * (env[j0] * (1 - f) + (env[j0 + 1] || 0) * f);
    }
    s *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 0.9, 2));
    if (s > best) { best = s; bestLag = lag; }
  }
  if (!bestLag) return null;
  // Refine: tempos in 0.1 BPM steps near the estimate, each with its best phase; keep the grid
  // that lands on the most onset energy (a 2% tempo error drifts a beat off within ~20 s).
  const coarse = 60 * fps / bestLag;
  const at = (x) => { const i = Math.floor(x), f = x - i; return (env[i] || 0) * (1 - f) + (env[i + 1] || 0) * f; };
  let bpm = coarse, top = -1;
  for (let b = coarse - 3; b <= coarse + 3; b += 0.1) {
    const period = (60 / b) * fps;
    for (let p = 0; p < period; p += 0.5) {
      let s = 0;
      for (let k = p; k < n; k += period) s += at(k) + 0.5 * at(k + period / 2);   // beats + off-beats
      if (s > top) { top = s; bpm = b; }
    }
  }
  bpm = Math.round(bpm * 10) / 10;
  // Phase from the lows: the offset whose grid catches the most kick/bass onsets.
  const period = (60 / bpm) * fps, src = low && low.length ? low : env;
  const atL = (x) => { const i = Math.floor(x), f = x - i; return (src[i] || 0) * (1 - f) + (src[i + 1] || 0) * f; };
  let phase = 0, best2 = -1;
  for (let p = 0; p < period; p += 0.25) {
    let s = 0;
    for (let k = p; k < src.length; k += period) s += atL(k);
    if (s > best2) { best2 = s; phase = p; }
  }
  return grid(bpm, phase / fps, duration, 'estimated');
}

function grid(bpm, offset, duration, source) {
  const beat = 60 / bpm, beats = [];
  for (let t = offset; t <= duration + 1e-6; t += beat) beats.push(+t.toFixed(4));
  return { bpm, offset: +offset.toFixed(4), beats, source };
}
