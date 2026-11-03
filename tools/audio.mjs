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
