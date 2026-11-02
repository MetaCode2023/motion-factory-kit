#!/usr/bin/env node
// make.mjs: one command from scene to finished, postable MP4 — picture, narration, word-timed
// captions, music ducked under the voice, sound effects, loudness-normalized for social.
//
//   node make.mjs scenes/mine/x.html                 # -> out/x.mp4 (+ out/x.sheet.png)
//   node make.mjs scenes/mine/x.html --voice-only    # just make the narration; prints line timings
//   node make.mjs scenes/mine/x.html --no-voice      # music + effects only (no ElevenLabs calls)
//   node make.mjs scenes/mine/x.html --no-captions   # skip burned-in captions
//   node make.mjs scenes/mine/x.html --variants      # every M.pick variant -> out/x-v1.mp4, x-v2.mp4...
//   node make.mjs scenes/mine/x.html --formats 4:5,1:1,16:9   # also feed, square and YouTube versions
//   node make.mjs scenes/mine/x.html --fast          # skip the picture score (quicker drafts)
//
// Every build ends with a self-check: out/x.report.md (PASS/FIX list) and out/x.cuts.png.
//
// Video clips (M.video, e.g. Higgsfield UGC) bring their own audio; with captions: true their speech
// is transcribed (ElevenLabs speech-to-text) into the same word-by-word captions.
//
// The scene declares its sound in M.setup (see kit/motion.js):
//   voice: [{ at: 0.3, text: '...' }, { at: 4.8, text: '...' }]   or { file: 'assets/vo/1.mp3', text: '...' }
//   sfx:   [{ at: 0, name: 'hit' }, { at: 4.6, name: 'whoosh', volume: 0.5 }]
//   music: 'pulse' | { track: 'calm', volume: 0.2 }
//   captions: true
//
// Narration uses ElevenLabs when ELEVENLABS_API_KEY is set (voice: ELEVENLABS_VOICE_ID or --voice).
// Each line is cached in out/.cache, so re-running after a visual change costs nothing.
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './engines/skia.mjs';
import { detectBeats } from './tools/beats.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const VALUED = ['out', 'voice', 'model', 'variant', 'formats', 'look', 'data', 'name', 'outdir'];
const scene = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]?.slice(2)));
if (!scene || !existsSync(scene)) {
  console.error('usage: node make.mjs <scene.html> [--voice-only] [--no-voice] [--no-captions] [--variants] [--voice <id>] [--out file.mp4]');
  process.exit(2);
}

const VARIANT = Number(opt('variant', 0));
// --data row.json fills M.data() in the scene; --name / --outdir set where the result goes (batches).
const DATA = opt('data') ? JSON.parse(readFileSync(opt('data'), 'utf8')) : null;
const name = (opt('name') || (DATA && DATA.name) || basename(scene, extname(scene))) + (opt('variant') != null ? `-v${VARIANT + 1}` : '');
const OUT = resolve(opt('out', join(opt('outdir', 'out'), name + '.mp4')));
const WORK = join(ROOT, 'out', '.work', name);
const CACHE = join(ROOT, 'out', '.cache', 'voice');
mkdirSync(WORK, { recursive: true }); mkdirSync(CACHE, { recursive: true }); mkdirSync(dirname(OUT), { recursive: true });
const warnings = [];
const warn = (m) => { warnings.push(m); console.warn('  ! ' + m); };

function ff(argv, what) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${what}):\n${r.stderr}`);
  return r;
}
function seconds(file) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = r.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}
const findSound = (kind, id) => {
  if (!id) return null;
  for (const p of [id, join(ROOT, id), join(ROOT, 'sounds', kind, id), ...['.mp3', '.wav', '.m4a'].map((e) => join(ROOT, 'sounds', kind, id + e))]) {
    if (existsSync(p) && !p.endsWith('/')) return p;
  }
  return null;
};

// ---- 1. read the scene's sound plan -------------------------------------------------------------
// Things handed to the scene before it runs (beats of the music, real narration timings), so its
// timeline can be built from them. Every later render/still gets the same.
const INJECT = {};
const readV = async () => { const e = await open(scene, { variant: VARIANT, data: DATA, inject: INJECT }); const v = JSON.parse(JSON.stringify(e.V)); await e.close(); return v; };
let V = await readV();

// --variants: run this script once per variant, then stop.
if (flag('variants')) {
  const n = V.variants || 1;
  const pass = args.filter((a, i) => a !== '--variants' && a !== scene && !(args[i - 1] === '--out') && a !== '--out');   // --formats etc. pass through
  let failed = 0;
  for (let i = 0; i < n; i++) {
    if (n > 1) console.log(`\n=== variant ${i + 1}/${n} ===`);
    // A scene with a single version keeps its plain name (no -v1).
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), scene, ...(n > 1 ? ['--variant', String(i)] : []), ...pass], { stdio: 'inherit' });
    if (r.status !== 0) failed++;
  }
  process.exit(failed ? 1 : 0);
}
// Beats: from the bundled track's tempo file, or estimated from the audio.
{
  const m = typeof V.music === 'string' ? { track: V.music } : V.music;
  const mf = m?.track ? findSound('music', m.track) : null;
  if (mf) {
    const b = detectBeats(mf, V.duration + 2);
    if (b) { INJECT.BEATS = b; V = await readV(); console.log(`  beats: ${b.bpm} BPM (${b.source === 'meta' ? 'from the track' : 'estimated'})`); }
  }
}
const voiceLines = (V.voice || []).map((l) => (typeof l === 'string' ? { text: l } : l));
const music = typeof V.music === 'string' ? { track: V.music } : V.music;
console.log(`${name}: ${V.duration}s, ${voiceLines.length} voice lines, ${(V.sfx || []).length} effects, music: ${music?.track || 'none'}`);

// ---- 2. narration -------------------------------------------------------------------------------
const KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = opt('voice', V.voiceId || process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB');   // "Adam", a stock voice
const MODEL = opt('model', 'eleven_multilingual_v2');

// Character timings from ElevenLabs -> word timings.
function wordsFromAlignment(al) {
  const out = [];
  let cur = null;
  al.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) { cur = null; return; }
    if (!cur) out.push(cur = { w: '', s: al.character_start_times_seconds[i], e: 0 });
    cur.w += ch; cur.e = al.character_end_times_seconds[i];
  });
  return out;
}
// Spread words over a known duration, weighted by length (for files without timing data).
function spreadWords(text, dur) {
  const ws = String(text || '').split(/\s+/).filter(Boolean);
  const weight = ws.map((w) => w.length + 2), total = weight.reduce((a, b) => a + b, 0) || 1;
  let s = 0;
  return ws.map((w, i) => { const d = (weight[i] / total) * dur; const o = { w, s, e: s + d * 0.92 }; s += d; return o; });
}
async function tts(text) {
  const id = createHash('sha1').update([VOICE_ID, MODEL, text].join('\n')).digest('hex').slice(0, 16);
  const mp3 = join(CACHE, id + '.mp3'), json = join(CACHE, id + '.json');
  if (existsSync(mp3) && existsSync(json)) return { file: mp3, words: JSON.parse(readFileSync(json, 'utf8')), cached: true };
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: MODEL }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  writeFileSync(mp3, Buffer.from(data.audio_base64, 'base64'));
  const al = data.alignment || data.normalized_alignment;
  const words = al ? wordsFromAlignment(al) : spreadWords(text, seconds(mp3));
  writeFileSync(json, JSON.stringify(words));
  return { file: mp3, words, cached: false };
}

const placed = [];   // { start, dur, file|null, words (absolute) }
if (voiceLines.length) {
  const useVoice = !flag('no-voice');
  if (useVoice && !KEY && voiceLines.some((l) => !l.file)) {
    warn('ELEVENLABS_API_KEY is not set, so lines without a file are silent. Captions use estimated timing.');
  }
  let cursor = 0;
  for (const [i, line] of voiceLines.entries()) {
    const start = line.at != null ? line.at : cursor + 0.25;
    let file = null, words, dur;
    if (useVoice && line.file) {
      file = findSound('vo', line.file) || resolve(dirname(scene), line.file);
      if (!existsSync(file)) throw new Error(`voice file not found: ${line.file}`);
      dur = seconds(file); words = spreadWords(line.text, dur);
    } else if (useVoice && KEY) {
      const r = await tts(line.text);
      file = r.file; words = r.words; dur = seconds(file);
      console.log(`  voice ${i + 1}: ${r.cached ? 'cached' : 'generated'}`);
    } else {
      words = M_estimate(line.text); dur = words.length ? words[words.length - 1].e : 0;
    }
    if (start < cursor - 0.05) warn(`voice line ${i + 1} starts at ${start.toFixed(2)}s but line ${i} is still talking until ${cursor.toFixed(2)}s. Move it to at: ${(cursor + 0.2).toFixed(1)} or shorten line ${i}.`);
    if (start + dur > V.duration) warn(`voice line ${i + 1} runs to ${(start + dur).toFixed(2)}s, past the video's ${V.duration}s. Lengthen duration or shorten the line.`);
    placed.push({ start, dur, file, words: words.map((w) => ({ w: w.w, s: +(w.s + start).toFixed(3), e: +(w.e + start).toFixed(3) })) });
    cursor = start + dur;
  }
  console.log('\n  line  start   end    text');
  placed.forEach((p, i) => console.log(`  ${String(i + 1).padStart(4)}  ${p.start.toFixed(2).padStart(5)}  ${(p.start + p.dur).toFixed(2).padStart(5)}   ${voiceLines[i].text.slice(0, 60)}`));
  console.log('');
}
function M_estimate(text) {   // same estimate as M.estimateWords in the kit
  let s = 0;
  return String(text || '').split(/\s+/).filter(Boolean).map((w) => { const d = 0.12 + w.length * 0.045; const o = { w, s, e: s + d }; s += d + 0.06; return o; });
}

// Real narration timings -> the scene (M.cues), then re-read it: its cuts and length may follow them.
if (placed.length) {
  INJECT.CUES = placed.map((p, i) => ({ start: +p.start.toFixed(3), end: +(p.start + p.dur).toFixed(3), text: voiceLines[i].text }));
  V = await readV();
}
const injectFile = join(WORK, 'inject.json');
writeFileSync(injectFile, JSON.stringify(INJECT));

// ---- 2b. video clips: audio and transcribed captions ---------------------------------------------
const allMedia = (V.media || []).map((m) => ({ ...m, file: resolve(dirname(scene), m.src) }));
for (const m of allMedia) {
  m.missing = !existsSync(m.file);
  if (m.missing) { warn(`clip not found: ${m.src} (it renders as a placeholder)`); continue; }
  m.hasAudio = /Audio:/.test(spawnSync(ffmpegPath, ['-hide_banner', '-i', m.file], { encoding: 'utf8' }).stderr);
}
const media = allMedia.filter((m) => !m.missing);
async function transcribe(m) {
  const id = createHash('sha1').update(['stt', m.file, readFileSync(m.file).length, m.trim, m.speed].join('|')).digest('hex').slice(0, 16);
  const json = join(CACHE, id + '.stt.json');
  if (existsSync(json)) return JSON.parse(readFileSync(json, 'utf8'));
  const wav = join(WORK, id + '.wav');
  ff(['-ss', String(m.trim || 0), '-i', m.file, '-vn', '-ac', '1', '-ar', '16000', ...(m.speed && m.speed !== 1 ? ['-af', `atempo=${m.speed}`] : []), wav], 'extract speech');
  const form = new FormData();
  form.append('model_id', 'scribe_v1');
  form.append('file', new Blob([readFileSync(wav)], { type: 'audio/wav' }), 'speech.wav');
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': KEY }, body: form });
  if (!res.ok) throw new Error(`ElevenLabs speech-to-text ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const out = (data.words || []).filter((w) => (w.type || 'word') === 'word' && String(w.text).trim())
    .map((w) => ({ w: String(w.text).trim(), s: w.start, e: w.end }));
  writeFileSync(json, JSON.stringify(out));
  return out;
}
const mediaWords = [];
for (const m of allMedia.filter((x) => x.captions)) {
  let ws = null;
  const side = m.file.replace(/\.[^.\/]+$/, '.words.json');   // word timings written by footage.mjs
  if (m.missing) { if (m.transcript) ws = M_estimate(m.transcript); }
  else if (existsSync(side)) {
    ws = JSON.parse(readFileSync(side, 'utf8')).map((w) => ({ w: w.w, s: (w.s - (m.trim || 0)) / (m.speed || 1), e: (w.e - (m.trim || 0)) / (m.speed || 1) })).filter((w) => w.s >= 0);
    console.log(`  captions: ${ws.length} words from ${basename(side)}`);
  } else if (KEY && m.hasAudio) { ws = await transcribe(m); console.log(`  captions: transcribed ${m.src} (${ws.length} words)`); }
  else if (m.transcript) { ws = spreadWords(m.transcript, Math.max(0.5, (seconds(m.file) - (m.trim || 0)) / (m.speed || 1))); warn(`captions for ${m.src} use estimated timing (set ELEVENLABS_API_KEY for exact word timing).`); }
  else warn(`captions for ${m.src} need ELEVENLABS_API_KEY (or a transcript: '...' option on M.video).`);
  if (ws) mediaWords.push(...ws.map((w) => ({ w: w.w, s: +(w.s + m.at).toFixed(3), e: +(w.e + m.at).toFixed(3) })).filter((w) => w.s < V.duration));
}

const words = [...placed.flatMap((p) => p.words), ...mediaWords].sort((a, b) => a.s - b.s);
const capFile = join(WORK, 'captions.json');
writeFileSync(capFile, JSON.stringify(words));
if (flag('voice-only')) {
  console.log(`Captions timing: ${capFile}`);
  process.exit(0);
}

// ---- 3. picture ---------------------------------------------------------------------------------
const video = join(WORK, 'video.mp4');
const rargs = [join(ROOT, 'render.mjs'), scene, '--out', video, '--sheet', '--variant', String(VARIANT), '--inject', injectFile, ...(opt('data') ? ['--data', resolve(opt('data'))] : [])];
if (V.captions && !flag('no-captions') && words.length) rargs.push('--captions', capFile);
const rr = spawnSync(process.execPath, rargs, { stdio: 'inherit' });
if (rr.status !== 0) process.exit(rr.status || 1);

// ---- 4. sound mix -------------------------------------------------------------------------------
const D = V.duration;
const inputs = [], chains = [], buses = { voice: [], sfx: [] };
const input = (file, loop = false) => { inputs.push(...(loop ? ['-stream_loop', '-1'] : []), '-i', file); return inputs.filter((x) => x === '-i').length - 1; };   // 0-based ffmpeg input index
const FMT = 'aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo';

placed.filter((p) => p.file).forEach((p, i) => {
  const k = input(p.file);
  chains.push(`[${k}:a]${FMT},adelay=${Math.round(p.start * 1000)}:all=1[v${i}]`);
  buses.voice.push(`[v${i}]`);
});
(V.sfx || []).forEach((s, i) => {
  const file = findSound('sfx', s.name || s.file);
  if (!file) { warn(`sound effect "${s.name || s.file}" not found in sounds/sfx`); return; }
  const k = input(file);
  chains.push(`[${k}:a]${FMT},volume=${s.volume ?? 0.6},adelay=${Math.round((s.at || 0) * 1000)}:all=1[s${i}]`);
  buses.sfx.push(`[s${i}]`);
});
media.filter((m) => m.hasAudio && m.audio !== false).forEach((m, i) => {
  const k = input(m.file, !!m.loop);
  const tempo = m.speed && m.speed !== 1 ? `,atempo=${Math.min(2, Math.max(0.5, m.speed))}` : '';
  chains.push(`[${k}:a]${FMT},atrim=start=${m.trim || 0},asetpts=PTS-STARTPTS${tempo},volume=${m.volume ?? 1},adelay=${Math.round(m.at * 1000)}:all=1[c${i}]`);
  (m.speech ? buses.voice : buses.sfx).push(`[c${i}]`);
});
let musicLabel = null;
if (music?.track) {
  const file = findSound('music', music.track);
  if (!file) warn(`music "${music.track}" not found in sounds/music`);
  else {
    const k = input(file, true);
    chains.push(`[${k}:a]${FMT},atrim=0:${D},volume=${music.volume ?? 0.22},afade=t=in:d=0.4,afade=t=out:st=${Math.max(0, D - 1.2)}:d=1.2[m0]`);
    musicLabel = '[m0]';
  }
}

const final = OUT;
const hasAudio = buses.voice.length || buses.sfx.length || musicLabel;
// Colour grade + film grain (luma-only noise, new every frame), applied once at the end.
const LOOKS = {
  cinematic: "eq=contrast=1.06:saturation=1.1:gamma=0.98,curves=all='0/0.03 0.25/0.22 0.75/0.79 1/0.97',vignette=angle=PI/5,noise=c0s=4:c0f=t,unsharp=5:5:0.3",
  punchy: 'eq=contrast=1.12:saturation=1.28,unsharp=5:5:0.55,noise=c0s=2:c0f=t',
  film: "eq=saturation=0.9:contrast=1.05,colorbalance=rs=0.04:bs=-0.03:rh=0.03:bh=-0.05,curves=all='0/0.05 1/0.95',vignette=angle=PI/4.5,noise=c0s=7:c0f=t+u",
  clean: '',
};
const lookName = opt('look', V.look || '');
if (lookName && !(lookName in LOOKS)) warn(`unknown look "${lookName}" (use ${Object.keys(LOOKS).join(', ')})`);
// Grain is random every frame, so cap the bitrate (~14 Mbps; platforms re-compress uploads anyway).
const vcodec = LOOKS[lookName] ? ['-vf', LOOKS[lookName], '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-maxrate', '14M', '-bufsize', '28M', '-pix_fmt', 'yuv420p'] : ['-c:v', 'copy'];
if (!hasAudio) {
  ff(['-i', video, ...vcodec, '-movflags', '+faststart', final], 'picture');
} else {
  const mixIn = [];
  if (buses.voice.length) {
    chains.push(`${buses.voice.join('')}amix=inputs=${buses.voice.length}:normalize=0,asplit=2[vo][vkey]`);
    mixIn.push('[vo]');
    if (musicLabel) { chains.push(`${musicLabel}[vkey]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=350[mduck]`); mixIn.push('[mduck]'); }
    else chains.push('[vkey]anullsink');
  } else if (musicLabel) mixIn.push(musicLabel);
  if (buses.sfx.length) { chains.push(`${buses.sfx.join('')}amix=inputs=${buses.sfx.length}:normalize=0[fx]`); mixIn.push('[fx]'); }
  chains.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0,apad,atrim=0:${D},loudnorm=I=-14:TP=-2:LRA=11,alimiter=limit=0.79:level=disabled,${FMT}[aout]`);
  const vi = input(video);
  ff([...inputs, '-filter_complex', chains.join(';'), '-map', `${vi}:v`, '-map', '[aout]',
    ...vcodec, '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-t', String(D), '-movflags', '+faststart', final], 'mix');
}

// ---- 5. other sizes ----------------------------------------------------------------------------
// From a vertical build: 4:5 is a centred crop (it keeps the whole safe zone); 1:1 and 16:9 put the
// vertical video over a blurred, darkened copy of itself.
const FORMATS = {
  '4:5': { w: 1080, h: 1350, crop: true }, '1:1': { w: 1080, h: 1080 }, '16:9': { w: 1920, h: 1080 }, '9:16': null,
};
const made = [final];
if (opt('formats')) {
  const vertical = Math.abs(V.width / V.height - 9 / 16) < 0.02;
  for (const f of String(opt('formats')).split(',').map((x) => x.trim()).filter(Boolean)) {
    const spec = FORMATS[f];
    if (spec === null) continue;
    if (!spec) { warn(`unknown format "${f}" (use 4:5, 1:1, 16:9)`); continue; }
    if (!vertical) { warn(`--formats needs a vertical (9:16) scene; this one is ${V.width}x${V.height}`); break; }
    const out = final.replace(/\.mp4$/i, `.${f.replace(':', 'x')}.mp4`);
    const vf = spec.crop
      ? `scale=${spec.w}:-2,crop=${spec.w}:${spec.h}:0:${Math.round((spec.w * V.height / V.width) * 0.43 - spec.h / 2)}`
      : `split[a][b];[a]scale=${spec.w}:${spec.h}:force_original_aspect_ratio=increase,crop=${spec.w}:${spec.h},boxblur=30:3,eq=brightness=-0.32:saturation=0.8[bg];[b]scale=-2:${spec.h}[fg];[bg][fg]overlay=(W-w)/2:0`;
    ff(['-i', final, '-filter_complex', `[0:v]${vf}[v]`, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-maxrate', '14M', '-bufsize', '28M', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out], `format ${f}`);
    made.push(out);
    console.log(`  ${f.padEnd(5)} -> ${out}`);
  }
}

// ---- 5b. post kit: cover image, subtitles file, upload caption -----------------------------------
const kit = [];
const coverT = Math.max(0, Math.min(D - 0.1, V.cover ?? 0.7));
for (const f of made) {
  const cover = f.replace(/\.mp4$/i, '.cover.jpg');
  ff(['-ss', String(coverT), '-i', f, '-frames:v', '1', '-q:v', '2', cover], 'cover');
  kit.push(cover);
}
if (words.length) {
  // .srt for YouTube / accessibility / search: lines of up to ~7 words, split at sentences and pauses.
  const cues = [];
  let cur = null;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (!cur || cur.words.length >= 7 || cur.text.length + w.w.length > 40 || /[.?!]$/.test(prev?.w || '') || w.s - (prev?.e ?? 0) > 0.6) cues.push(cur = { words: [], text: '' });
    cur.words.push(w); cur.text = cur.words.map((x) => x.w).join(' ');
  });
  const ts = (x) => { const ms = Math.max(0, Math.round(x * 1000)); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  const srt = cues.map((c, i) => `${i + 1}\n${ts(c.words[0].s)} --> ${ts(Math.max(c.words[c.words.length - 1].e, c.words[0].s + 0.6))}\n${c.text}\n`).join('\n');
  const srtFile = final.replace(/\.mp4$/i, '.srt');
  writeFileSync(srtFile, srt);
  kit.push(srtFile);
}
if (V.post && (V.post.caption || V.post.hashtags)) {
  const tags = [].concat(V.post.hashtags || []).filter(Boolean).map((h) => '#' + String(h).replace(/^#/, '').replace(/\s+/g, ''));
  const postFile = final.replace(/\.mp4$/i, '.post.txt');
  writeFileSync(postFile, [V.post.caption || '', '', tags.join(' ')].join('\n').trim() + '\n');
  kit.push(postFile);
}

// ---- 6. self-check ------------------------------------------------------------------------------
// Everything Claude (or you) should look at before calling the video done, in one report:
// out/<name>.report.md plus out/<name>.cuts.png (a still right after every cut).
const sheet = video.replace(/\.mp4$/, '.sheet.png');
if (existsSync(sheet)) writeFileSync(final.replace(/\.mp4$/i, '.sheet.png'), readFileSync(sheet));
const checks = [];   // [ok: boolean, area, text]
const check = (ok, area, text) => checks.push([ok, area, text]);

let peak = null, loud = null;
if (hasAudio) {
  const vd = spawnSync(ffmpegPath, ['-hide_banner', '-i', final, '-af', 'volumedetect,ebur128=framelog=quiet', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  peak = +(vd.match(/max_volume: ([-\d.]+)/)?.[1] ?? -99);
  loud = +(vd.match(/\n\s+I:\s+([-\d.]+) LUFS/)?.[1] ?? -99);
  check(peak <= -0.5, 'sound', `peak ${peak} dB${peak > -0.5 ? ' (may clip)' : ''}`);
  check(loud > -18 && loud < -11, 'sound', `loudness ${loud} LUFS (social target about -14)`);
  console.log(`  audio: peak ${peak} dB, loudness ${loud} LUFS`);
} else check(false, 'sound', 'no sound at all: add music, effects or narration');
if (voiceLines.length) check(placed.every((p) => p.file) || flag('no-voice'), 'sound', placed.every((p) => p.file) ? `narration: ${placed.length} lines` : 'narration lines are silent (no ELEVENLABS_API_KEY)');
if (V.captions) check(!flag('no-captions') && words.length > 0, 'captions', words.length ? `${words.length} words captioned${KEY ? '' : ' (estimated timing)'}` : 'captions are on but there are no words to show');
const missing = allMedia.filter((m) => m.missing);
check(!missing.length, 'footage', missing.length ? `placeholders still showing for: ${missing.map((m) => m.src).join(', ')}` : `${media.length} clip(s) found`);
check(D >= 6 && D <= 90, 'length', `${D}s`);
for (const w of warnings) if (!/^clip not found|ELEVENLABS_API_KEY is not set/.test(w)) check(false, 'build', w);

// Picture checks need the quality scorer (Python). Text-only frames make the UI-zone check exact,
// so footage under the TikTok buttons isn't mistaken for text.
const py = ['python3', 'python'].find((c) => spawnSync(c, ['--version']).status === 0);
let score = null;
if (!flag('fast') && py) {
  const textArgs = [join(ROOT, 'render.mjs'), scene, '--out', join(WORK, 'text.mp4'), '--text-only', '--variant', String(VARIANT), '--crf', '28', '--inject', injectFile, ...(opt('data') ? ['--data', resolve(opt('data'))] : [])];
  if (V.captions && !flag('no-captions') && words.length) textArgs.push('--captions', capFile);
  const tr = spawnSync(process.execPath, textArgs, { encoding: 'utf8' });
  if (tr.status === 0) writeFileSync(join(WORK, 'text-mask.json'), JSON.stringify({ video_sha256: createHash('sha256').update(readFileSync(video)).digest('hex'),
    // Transitions throw text around for a split second by design; don't flag those moments.
    ignore: (V.cuts || []).map((c) => [c - 0.35, c + 0.35]) }));
  const sr = spawnSync(py, [join(ROOT, 'score.py'), video], { encoding: 'utf8' });
  if (sr.status === 0) {
    score = JSON.parse(sr.stdout);
    const sw = score.warnings || [];
    check(!sw.length, 'picture', sw.length ? sw.join('; ') : `no frozen stretches, quick open, frame filled, words clear of the app UI`);
  } else check(false, 'picture', 'quality scorer failed: ' + (sr.stderr || '').trim().split('\n').pop());
} else if (!py) check(true, 'picture', 'skipped the picture score (Python not found)');

// Stills right after each cut (and frame 0, and the end), with captions, for a quick visual check.
const cutsPng = final.replace(/\.mp4$/i, '.cuts.png');
try {
  const { Canvas, loadImage } = await import('skia-canvas');
  const eng = await open(scene, { variant: VARIANT, data: DATA, inject: INJECT, captions: V.captions && words.length ? words : null });
  const times = [0, ...(V.cuts || []).map((c) => Math.min(D - 0.05, c + 0.2)), Math.max(0, D - 0.4)];
  const tw = 240, th = Math.round(tw * V.height / V.width), pad = 6;
  const sheetC = new Canvas(times.length * (tw + pad) + pad, th + pad * 2 + 28), c2 = sheetC.getContext('2d');
  c2.fillStyle = '#444'; c2.fillRect(0, 0, sheetC.width, sheetC.height);
  for (const [i, t] of times.entries()) {
    c2.drawImage(await loadImage(await eng.still(t)), pad + i * (tw + pad), pad, tw, th);
    c2.fillStyle = '#fff'; c2.font = '600 18px sans-serif'; c2.fillText(`${t.toFixed(1)}s`, pad + i * (tw + pad) + 4, th + pad + 22);
  }
  await eng.close();
  writeFileSync(cutsPng, await sheetC.toBuffer('png'));
} catch (e) { check(false, 'build', 'could not make the cut stills: ' + e.message); }

const failed = checks.filter(([ok]) => !ok);
const rel = (p) => p.startsWith(ROOT) ? p.slice(ROOT.length + 1) : p;
const report = [
  `# ${name}`, '',
  `${failed.length ? `**${failed.length} thing(s) to fix or confirm.**` : '**All checks passed.**'} Look at the stills either way.`, '',
  ...checks.map(([ok, area, text]) => `- ${ok ? 'PASS' : 'FIX '} **${area}**: ${text}`), '',
  '## Files', ...made.map((f) => `- ${rel(f)}`), ...kit.map((f) => `- ${rel(f)}`), `- ${rel(cutsPng)} (frame 0, just after each cut, the end)`, `- ${rel(final.replace(/\.mp4$/i, '.sheet.png'))} (six evenly spaced frames)`, '',
  ...(score ? ['## Picture score', '```json', JSON.stringify({ size: score.size, frame0_text: score.frame0_text, longest_still_s: score.longest_still_s, open_motion: score.open_motion, median_fill: score.median_fill, unsafe_ink: score.unsafe_ink }, null, 2), '```', ''] : []),
  ...(placed.length ? ['## Narration timing', '| line | start | end | text |', '|---|---|---|---|', ...placed.map((p, i) => `| ${i + 1} | ${p.start.toFixed(2)} | ${(p.start + p.dur).toFixed(2)} | ${voiceLines[i].text} |`), ''] : []),
];
const reportFile = final.replace(/\.mp4$/i, '.report.md');
writeFileSync(reportFile, report.join('\n'));
console.log(`\n${name}: done -> ${rel(final)}`);
console.log(failed.length ? `Check: ${failed.length} to fix or confirm (see ${rel(reportFile)}):` : `Check: all passed (${rel(reportFile)})`);
for (const [, area, text] of failed) console.log(`  - ${area}: ${text}`);
