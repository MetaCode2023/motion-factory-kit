// tools/longform/common.mjs: shared helpers for the long-form (16:9, 5-20 min) editor.
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSidecar } from '../transcripts.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FF = ffmpegPath;
export const PY = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0);
export const W = 1920, H = 1080;
export const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'ah', 'hmm', 'mm', 'mhm']);
export const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|mts|wav|mp3|m4a|aac|flac|ogg)$/i;   // audio-only recordings too (voice-only videos)
export const bare = (w) => String(w).toLowerCase().replace(/[^a-z0-9']/g, '');

export function ff(args, what) {
  const r = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${what}): ${(r.stderr || '').slice(-1200)}`);
  return r;
}

export function probe(file) {
  const err = spawnSync(FF, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  const d = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const vline = err.split('\n').find((l) => /Stream.*Video:/.test(l) && !/attached pic/.test(l)) || '';   // ignore mp3 cover art
  const v = vline.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  const fps = err.match(/([\d.]+) fps/);
  const hz = err.match(/Audio:.*?(\d{4,6}) Hz/);
  const rot = err.match(/rotation of (-?[\d.]+) degrees/) || err.match(/rotate\s*:\s*(-?\d+)/);
  let w = v ? +v[1] : 0, h = v ? +v[2] : 0;
  if (rot && Math.abs(Math.abs(+rot[1]) % 180 - 90) < 1) [w, h] = [h, w];
  return { duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0, width: w, height: h, fps: fps ? +fps[1] : 0,
    hasVideo: !!v, hasAudio: /Audio:/.test(err), sampleRate: hz ? +hz[1] : 48000 };
}

export const fileKey = (file) => { const st = statSync(file); return createHash('sha1').update([resolve(file), st.size, st.mtimeMs].join('|')).digest('hex').slice(0, 16); };
export const fmt = (s) => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = (s % 60).toFixed(1).padStart(4, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
export const fmtChapter = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
export const slug = (s) => String(s).toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'clip';
export const writeJSON = (f, o) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(o, null, 2)); };
export const readJSON = (f) => JSON.parse(readFileSync(f, 'utf8'));

// "1:23.5" | "1:02:03" | 83.5 -> seconds
export function seconds(v) {
  if (typeof v === 'number') return v;
  const m = String(v).trim().match(/^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return NaN;
  const parts = [m[1], m[2], m[3]].filter((x) => x != null).map(Number);
  return parts.reduce((a, b) => a * 60 + b, 0);
}

// ---- transcription (same order as footage.mjs): sidecar -> ElevenLabs -> faster-whisper -> whisper CLI
export async function transcribe(file, cacheDir) {
  const side = readSidecar(file);
  if (side) return side;
  mkdirSync(cacheDir, { recursive: true });
  const key = fileKey(file);
  const json = join(cacheDir, key + '.words.json');
  if (existsSync(json)) return readJSON(json);
  const wav = join(cacheDir, key + '.wav');
  ff(['-i', file, '-vn', '-ac', '1', '-ar', '16000', wav], 'extract audio');
  let words = null, via = 'none';
  const KEY = process.env.ELEVENLABS_API_KEY;
  if (KEY) {
    const form = new FormData();
    form.append('model_id', 'scribe_v1');
    form.append('diarize', 'true');
    form.append('file', new Blob([readFileSync(wav)], { type: 'audio/wav' }), 'audio.wav');
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': KEY }, body: form });
    if (res.ok) {
      const data = await res.json();
      words = (data.words || []).filter((w) => (w.type || 'word') === 'word' && String(w.text).trim()).map((w) => ({ w: String(w.text).trim(), s: w.start, e: w.end, ...(w.speaker_id != null ? { sp: String(w.speaker_id) } : {}) }));
      via = 'elevenlabs';
    } else console.warn(`  ElevenLabs speech-to-text ${res.status}; trying local whisper`);
  }
  if (!words && PY) {
    const r = spawnSync(PY, [join(ROOT, 'tools', 'transcribe.py'), wav], { encoding: 'utf8', maxBuffer: 1 << 28 });
    try { const o = JSON.parse(r.stdout.trim().split('\n').pop()); if (o.words) { words = o.words; via = 'faster-whisper'; } } catch {}
  }
  if (!words && spawnSync('whisper', ['--help']).status === 0) {
    const dir = join(cacheDir, key + '-whisper');
    mkdirSync(dir, { recursive: true });
    const r = spawnSync('whisper', [wav, '--model', process.env.WHISPER_MODEL || 'small', '--word_timestamps', 'True', '--output_format', 'json', '--output_dir', dir], { encoding: 'utf8' });
    const out = join(dir, key + '.json');
    if (r.status === 0 && existsSync(out)) {
      words = readJSON(out).segments.flatMap((sg) => (sg.words || []).map((w) => ({ w: w.word.trim(), s: w.start, e: w.end })));
      via = 'whisper';
    }
  }
  rmSync(wav, { force: true });
  const result = { via, words: words || [] };
  if (words) writeFileSync(json, JSON.stringify(result));
  return result;
}

// Sentences, numbered from 1 (the "#n" in plan anchors and in the library index).
export function sentencesOf(words) {
  const out = [];
  let cur = null;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (!cur || /[.?!]$/.test(prev?.w || '') || w.s - (prev?.e ?? 0) > 0.9 || cur.length >= 40) out.push(cur = []);
    cur.push(i);
  });
  return out.map((idx, k) => ({ n: k + 1, s: words[idx[0]].s, e: words[idx[idx.length - 1]].e, from: idx[0], to: idx[idx.length - 1],
    text: idx.map((i) => words[i].w).join(' ') }));
}

// ---- contact sheets (frames + labels), drawn with skia-canvas so the bundled fonts work everywhere
export async function sheet(items, out, { cols = 4, w = 480, h = 270, title = '' } = {}) {
  const { Canvas, loadImage, FontLibrary } = await import('skia-canvas');
  const mono = join(ROOT, 'fonts', 'jetbrains-mono-latin-600-normal.woff2');
  if (existsSync(mono) && !FontLibrary.has('JB Mono')) FontLibrary.use('JB Mono', [mono]);
  const pad = 6, top = title ? 44 : 0, rows = Math.ceil(items.length / cols);
  const cv = new Canvas(cols * (w + pad) + pad, top + rows * (h + pad) + pad);
  const c = cv.getContext('2d');
  c.fillStyle = '#0b0c10'; c.fillRect(0, 0, cv.width, cv.height);
  if (title) { c.fillStyle = '#e8e8ee'; c.font = '600 22px "JB Mono"'; c.fillText(title, pad + 4, 30); }
  for (let i = 0; i < items.length; i++) {
    const x = pad + (i % cols) * (w + pad), y = top + pad + Math.floor(i / cols) * (h + pad);
    try { c.drawImage(await loadImage(items[i].file), x, y, w, h); } catch { c.fillStyle = '#333'; c.fillRect(x, y, w, h); }
    if (items[i].label) {
      c.font = '600 17px "JB Mono"';
      const tw = c.measureText(items[i].label).width;
      c.fillStyle = 'rgba(0,0,0,0.72)'; c.fillRect(x, y + h - 30, Math.min(w, tw + 16), 30);
      c.fillStyle = '#fff'; c.fillText(items[i].label, x + 8, y + h - 9, w - 16);
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  await cv.toFile(out, { quality: 0.85 });
  return out;
}

export function frameAt(file, t, out, w = 480, h = 270) {
  ff(['-ss', Math.max(0, t).toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`, '-q:v', '3', out], 'frame');
  return out;
}
