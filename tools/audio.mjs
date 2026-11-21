// tools/audio.mjs: clean-up for street footage, used by `footage.mjs cut` on every piece of A-roll.
//
//   wind / rumble   high-pass (80 Hz, 120 Hz with wind: true)
//   street noise    FFT denoiser that tracks the noise floor (light | medium | strong)
//   harsh "s"       de-esser
//   evenness        gentle compressor, then each piece is levelled to the same loudness so a loud
//                   host and a quiet stranger sit at the same volume (per speaker when the transcript
//                   knows who is talking)
//
// Plans control it with `"audio": { "denoise": "strong", "wind": true, "deess": true, "level": true }`
// on the plan or on one segment; `"audio": false` passes the sound through untouched.
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';

export const AUDIO_DEFAULTS = { denoise: 'medium', wind: false, deess: true, compress: true, level: true, target: -16, maxGain: 15 };
const NR = { light: 8, medium: 14, strong: 24 };

// Plan-level settings, overridden by segment-level ones. false anywhere turns cleaning off.
export function audioOptions(plan = {}, seg = {}) {
  if (plan.audio === false || seg.audio === false) return null;
  return { ...AUDIO_DEFAULTS, ...(typeof plan.audio === 'object' ? plan.audio : {}), ...(typeof seg.audio === 'object' ? seg.audio : {}) };
}

// The ffmpeg filter chain for one piece (before levelling). Empty string = nothing to do.
export function cleanChain(o) {
  if (!o) return '';
  const f = [`highpass=f=${o.wind ? 120 : 80}:poles=2`];
  if (o.wind) f.push('lowshelf=f=200:g=-6');
  if (o.denoise && NR[o.denoise]) f.push(`afftdn=nr=${NR[o.denoise]}:nf=-45:tn=1`);
  if (o.deess) f.push(`deesser=i=${o.deess === 'strong' ? 0.8 : 0.5}:m=0.5:f=0.5`);
  if (o.compress) f.push('acompressor=threshold=-26dB:ratio=3:attack=8:release=150:makeup=1');
  return f.join(',');
}

// Integrated loudness (LUFS) of a range of a file after `chain`. Silence comes back as -70.
export function loudness(file, { from = 0, dur = null, chain = '' } = {}) {
  const args = ['-hide_banner', '-nostats', ...(from ? ['-ss', from.toFixed(3)] : []), ...(dur ? ['-t', dur.toFixed(3)] : []), '-i', file,
    '-vn', '-af', [chain, 'ebur128=framelog=quiet'].filter(Boolean).join(','), '-f', 'null', '-'];
  const err = spawnSync(ffmpegPath, args, { encoding: 'utf8', maxBuffer: 1 << 26 }).stderr || '';
  const m = [...err.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  return m ? +m[1] : -70;
}

// dB to add so a piece measured at `lufs` lands on `target`. Near-silent pieces are left alone.
export function levelGain(lufs, target = AUDIO_DEFAULTS.target, max = AUDIO_DEFAULTS.maxGain) {
  if (!(lufs > -60)) return 0;
  return +Math.max(-max, Math.min(max, target - lufs)).toFixed(2);
}

// Gains for every piece. Pieces with the same speaker (same clip + speaker id) share one gain, the
// duration-weighted mean, so a person's level doesn't jump between their own jump cuts.
export function speakerGains(pieces) {
  const groups = new Map();
  pieces.forEach((p, i) => {
    const key = p.speaker != null ? `${p.clip}:${p.speaker}` : `#${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  const gains = new Array(pieces.length).fill(0);
  for (const idx of groups.values()) {
    const live = idx.filter((i) => pieces[i].lufs > -60);
    const w = live.reduce((s, i) => s + pieces[i].dur, 0);
    const mean = w ? live.reduce((s, i) => s + pieces[i].lufs * pieces[i].dur, 0) / w : -70;
    for (const i of idx) gains[i] = levelGain(mean, pieces[i].target, pieces[i].maxGain);
  }
  return gains;
}

// ---- Word edges from the audio ---------------------------------------------------------------
// Transcript word times are guesses, off in both directions: ends usually run 0.1-0.4 s early (chopping
// "infla-", "clas-"), starts are sometimes late or early by ~0.15 s. These helpers read the clip's 10 ms
// envelope (voice loudness plus a hiss channel, so a trailing "ss"/"t"/"f" counts as speech) and place each
// cut where the voice really stops/starts: at a real pause, or the quietest spot between two words that run
// together, never past the middle of the neighbouring word.
const HOP = 0.01, ENV = new Map();

export function speechEnvelope(file) {
  if (ENV.has(file)) return ENV.get(file);
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  const pcm = r.status === 0 ? new Int16Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 1) : new Int16Array(0);
  const h = 160;
  if (pcm.length < h) {
    const detail = String(r.error?.message || r.stderr || '').trim().slice(-300);
    console.warn(`  ! audio envelope decode failed for ${file}${detail ? `: ${detail}` : ''}; using transcript timing fallback`);
    return { env: new Float32Array(0), floor: 0 };
  }
  const n = Math.floor(pcm.length / h), lo = new Float32Array(n), hi = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let a = 0, b = 0;
    for (let j = i * h; j < (i + 1) * h; j++) { const x = pcm[j] / 32768, d = x - (j ? pcm[j - 1] / 32768 : 0); a += x * x; b += d * d; }
    lo[i] = Math.sqrt(a / h + 1e-12); hi[i] = Math.sqrt(b / h + 1e-12);
  }
  const p90lo = pct(lo, 0.9) || 1, p90hi = pct(hi, 0.9) || 1, env = new Float32Array(n);
  for (let i = 0; i < n; i++) env[i] = Math.max(lo[i] / p90lo, hi[i] / p90hi);
  const out = { env, floor: pct(env, 0.1) };
  ENV.set(file, out);
  return out;
}

function pct(a, q) { const s = Float32Array.from(a).sort(); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0; }
const at = (t) => Math.round(t / HOP);

function valley({ env }, lo, hi) {
  const i0 = Math.max(1, at(lo)), i1 = Math.min(env.length - 2, at(hi));
  let best = i0, bv = Infinity;
  for (let i = i0; i <= i1; i++) { const v = env[i - 1] + env[i] + env[i + 1]; if (v < bv) { bv = v; best = i; } }
  return i1 > i0 ? best * HOP : lo;
}

// 'Silence' near word w: a little above the local room noise (10th percentile within +-3 s).
function quietLevel(E, w) {
  const { env } = E, ref = pct(env.subarray(Math.max(0, at(w.s - 0.05)), Math.max(at(w.s - 0.05) + 1, at(Math.max(w.e, w.s + 0.15) + 0.1))), 0.8) || 1;
  // The envelope is normalized by each clip's 90th percentile, so the word-relative term handles
  // quiet recordings; the local 10th percentile term raises the threshold over steady room noise.
  return Math.max(0.04 * ref, 3.5 * pct(env.subarray(Math.max(0, at(w.s - 3)), at(w.e + 3)), 0.1));
}
// First run of >= minQ s below `lo`, walking from t in dir (+1 forward / -1 back); returns its near edge or null.
function pauseFrom({ env }, t, lo, dir, minQ = 0.2, look = 1.0) {
  const need = Math.round(minQ / HOP), i0 = at(t);
  let run = 0;
  for (let k = 0; k < Math.round((look + minQ) / HOP); k++) {
    const i = i0 + k * dir;
    if (i < 0 || i >= env.length) break;
    if (env[i] < lo) { if (++run >= need) return (dir > 0 ? i - need + 1 : i + need) * HOP; } else run = 0;
  }
  return null;
}

// Cut points [a, b] for a run of words first..last; prev/next are the words just outside it (or null).
// Phrase endings: if a real pause (>= 0.2 s) starts before the middle of the next word, keep EVERYTHING up to it
// plus 0.15 s. Final consonants (t, k, x) are released after a short silent closure and endings decay quietly,
// so trimming close to the word clips them. Only words that run straight on are cut in the dip between them.
export function speechCut(E, first, last, prev, next, { room = 0.15, lead = 0.08 } = {}) {
  if (!E || !E.env.length) return [Math.max(0, first.s - lead), last.e + 0.3];
  let b;
  { const wall = next ? (next.s + next.e) / 2 : last.e + 1, p = pauseFrom(E, last.e, quietLevel(E, last), 1);
    b = p != null && p <= wall ? p + room : valley(E, last.e - 0.03, Math.max(Math.min((next ? next.s : last.e) + 0.25, wall), last.e + 0.05)) + 0.01; }
  let a;
  { const wall = prev ? (prev.s + prev.e) / 2 : first.s - 1, p = pauseFrom(E, first.s, quietLevel(E, first), -1, 0.2, 0.6);
    a = p != null && p >= wall ? Math.max(p - lead, wall) : valley(E, Math.min(Math.max((prev ? prev.e : first.s) - 0.25, wall), first.s - 0.05), first.s + 0.03); }
  return [Math.max(0, a), b];
}
