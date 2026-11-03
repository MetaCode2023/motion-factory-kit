#!/usr/bin/env node
// footage.mjs: the raw-footage editor. A folder of client footage in, finished ads out.
//
//   node footage.mjs index [footage/raw]       # transcribe + thumbnail every clip -> footage/INDEX.md
//   node footage.mjs cut edits/ad-01.json      # one edit plan -> an A-roll with exact word timings
//   node footage.mjs build edits/ [--variants] [--formats 4:5,1:1,16:9] [--batch client-oct]
//                                              # every plan -> finished ads + DELIVERY.csv + review.html
//   node footage.mjs feedback out/client-oct/review.json   # client decisions -> FEEDBACK.md, approved/
//   node footage.mjs build edits/ --redo out/client-oct/review.json   # re-cut only the flagged ads
//
// The editing decisions live in edit plans (edits/*.json) that Claude writes after reading
// footage/INDEX.md and looking at the thumbnail strips. See docs/EDITOR.md for the plan format.
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDelivery } from './tools/delivery.mjs';
import { applyFeedback, writeReview } from './tools/review.mjs';
import { cropFilter, pickTrack } from './tools/reframe.mjs';
import { audioOptions, cleanChain, loudness, speakerGains } from './tools/audio.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
const flag = (n) => rest.includes('--' + n);
const opt = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
const VALUED = ['batch', 'formats', 'template', 'look', 'jobs', 'only', 'redo'];
const positional = rest.filter((a, i) => !a.startsWith('--') && !VALUED.includes(rest[i - 1]?.slice(2)));

const FOOT = process.env.FOOTAGE_DIR ? resolve(process.env.FOOTAGE_DIR) : join(ROOT, 'footage');
const INDEX = join(FOOT, 'index.json');
const CACHE = join(ROOT, 'out', '.cache', 'footage');
const KEY = process.env.ELEVENLABS_API_KEY;
const W = 1080, H = 1920, FPS = 30;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|mts)$/i;
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'ah', 'hmm', 'mm', 'mhm']);
const bare = (w) => String(w).toLowerCase().replace(/[^a-z']/g, '');

function ff(args, what) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 27 });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${what}): ${r.stderr.slice(-800)}`);
  return r;
}
function probe(file) {
  const err = spawnSync(ffmpegPath, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  const d = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const v = err.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  const fps = err.match(/([\d.]+) fps/);
  const rot = err.match(/rotation of (-?[\d.]+) degrees/) || err.match(/rotate\s*:\s*(-?\d+)/);
  let w = v ? +v[1] : 0, h = v ? +v[2] : 0;
  if (rot && Math.abs(Math.abs(+rot[1]) % 180 - 90) < 1) [w, h] = [h, w];   // ffmpeg auto-rotates on decode
  return { duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0, width: w, height: h, fps: fps ? +fps[1] : 0, hasAudio: /Audio:/.test(err) };
}
const fileKey = (file) => { const st = statSync(file); return createHash('sha1').update([resolve(file), st.size, st.mtimeMs].join('|')).digest('hex').slice(0, 16); };
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

// ---- transcription -------------------------------------------------------------------------------
async function transcribe(file, key) {
  mkdirSync(CACHE, { recursive: true });
  const json = join(CACHE, key + '.words.json');
  if (existsSync(json)) return JSON.parse(readFileSync(json, 'utf8'));
  const wav = join(CACHE, key + '.wav');
  ff(['-i', file, '-vn', '-ac', '1', '-ar', '16000', wav], 'extract audio');
  let words = null, via = 'none';
  if (KEY) {
    const form = new FormData();
    form.append('model_id', 'scribe_v1');
    form.append('diarize', 'true');          // who is talking: host vs. the person being interviewed
    form.append('file', new Blob([readFileSync(wav)], { type: 'audio/wav' }), 'audio.wav');
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': KEY }, body: form });
    if (!res.ok) throw new Error(`ElevenLabs speech-to-text ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    words = (data.words || []).filter((w) => (w.type || 'word') === 'word' && String(w.text).trim()).map((w) => ({ w: String(w.text).trim(), s: w.start, e: w.end, ...(w.speaker_id != null ? { sp: String(w.speaker_id) } : {}) }));
    via = 'elevenlabs';
  } else if (spawnSync('whisper', ['--help']).status === 0) {     // optional local fallback (openai-whisper)
    const dir = join(CACHE, key + '-whisper');
    mkdirSync(dir, { recursive: true });
    const r = spawnSync('whisper', [wav, '--model', process.env.WHISPER_MODEL || 'small', '--word_timestamps', 'True', '--output_format', 'json', '--output_dir', dir], { encoding: 'utf8' });
    const out = join(dir, basename(wav, '.wav') + '.json');
    if (r.status === 0 && existsSync(out)) {
      words = JSON.parse(readFileSync(out, 'utf8')).segments.flatMap((sg) => (sg.words || []).map((w) => ({ w: w.word.trim(), s: w.start, e: w.end })));
      via = 'whisper';
    }
  }
  rmSync(wav, { force: true });
  const result = { via, words: words || [] };
  if (words) writeFileSync(json, JSON.stringify(result));
  return result;
}
function speechSegments(file) {   // without a transcript: where someone is talking, from silence detection
  const err = spawnSync(ffmpegPath, ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-32dB:d=0.45', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const dur = probe(file).duration, segs = [];
  let start = 0;
  for (const line of err.split('\n')) {
    const a = line.match(/silence_start: ([\d.]+)/), b = line.match(/silence_end: ([\d.]+)/);
    if (a) { if (+a[1] - start > 0.3) segs.push([+start.toFixed(2), +(+a[1]).toFixed(2)]); }
    if (b) start = +b[1];
  }
  if (dur - start > 0.3) segs.push([+start.toFixed(2), +dur.toFixed(2)]);
  return segs;
}
function sentencesOf(words) {
  const out = [];
  let cur = null;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (!cur || /[.?!]$/.test(prev?.w || '') || w.s - (prev?.e ?? 0) > 0.7 || cur.words.length >= 28 || (w.sp != null && w.sp !== prev?.sp)) out.push(cur = { words: [] });
    cur.words.push({ ...w, i });
  });
  return out.map((s, n) => ({ n, s: s.words[0].s, e: s.words[s.words.length - 1].e, from: s.words[0].i, to: s.words[s.words.length - 1].i, text: s.words.map((w) => w.w).join(' '), ...(majority(s.words) != null ? { speaker: majority(s.words) } : {}) }));
}
function majority(words) {
  const n = {};
  for (const w of words) if (w.sp != null) n[w.sp] = (n[w.sp] || 0) + (w.e - w.s);
  const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

// ---- faces (automatic reframing) -----------------------------------------------------------------
const PY = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0);
let facesWarned = false;
function findFaces(file, key) {
  mkdirSync(CACHE, { recursive: true });
  const json = join(CACHE, key + '.faces.json');
  if (existsSync(json)) return JSON.parse(readFileSync(json, 'utf8'));
  if (!PY) return null;
  const r = spawnSync(PY, [join(ROOT, 'tools', 'faces.py'), ffmpegPath, file, '3'], { encoding: 'utf8', maxBuffer: 1 << 27 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { return null; }
  if (out.error) { if (!facesWarned) console.warn(`\n  ! face tracking off: ${out.error}`); facesWarned = true; return null; }
  writeFileSync(json, JSON.stringify(out));
  return out;
}
const tracks = new Map();
function trackOf(clip, pick = 'largest') {
  if (pick === false || !clip.faces) return null;
  const k = clip.id + ':' + pick;
  if (!tracks.has(k)) tracks.set(k, pickTrack(clip.faces, pick));
  return tracks.get(k);
}
// Needs reframing (and so a face track) when its shape isn't already close to 9:16.
const needsReframe = (p) => p.width && p.height && Math.abs(p.width / p.height - W / H) > 0.04;

// ---- index ---------------------------------------------------------------------------------------
async function index(dir) {
  dir = resolve(dir || join(FOOT, 'raw'));
  if (!existsSync(dir)) { console.error(`No footage folder at ${relative(ROOT, dir)}. Put the client's clips there (or pass a folder).`); process.exit(2); }
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (VIDEO_EXT.test(f)) files.push(p); } };
  walk(dir);
  if (!files.length) { console.error('No video files found.'); process.exit(2); }
  const old = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : { clips: [] };
  const ids = new Map(old.clips.map((c) => [c.path, c.id]));
  let next = Math.max(0, ...old.clips.map((c) => +c.id.slice(1))) + 1;
  mkdirSync(join(FOOT, 'thumbs'), { recursive: true });
  if (!KEY) console.warn('  ! ELEVENLABS_API_KEY not set: clips get speech segments and thumbnails, but no transcripts.');
  const clips = [];
  for (const file of files) {
    const path = relative(ROOT, file).split('\\').join('/');
    const id = ids.get(path) || `C${String(next++).padStart(2, '0')}`;
    const p = probe(file), key = fileKey(file);
    const thumb = join(FOOT, 'thumbs', `${id}.jpg`);
    if (!existsSync(thumb) || statSync(thumb).mtimeMs < statSync(file).mtimeMs) {
      const n = 6;
      ff(['-i', file, '-vf', `fps=${n}/${Math.max(0.5, p.duration).toFixed(3)},scale=-2:300,tile=${n}x1:padding=4:color=black`, '-frames:v', '1', '-q:v', '4', thumb], 'thumbnails');
    }
    const t = p.hasAudio ? await transcribe(file, key) : { via: 'none', words: [] };
    const faces = needsReframe(p) && !flag('no-faces') ? findFaces(file, key) : null;
    const words = t.words.map((w) => ({ ...w, ...(FILLERS.has(bare(w.w)) ? { filler: true } : {}) }));
    clips.push({ id, path, ...p, vertical: p.height > p.width, transcript: t.via, words, sentences: sentencesOf(words), speech: words.length ? [] : (p.hasAudio ? speechSegments(file) : []), ...(faces ? { faces: faces.samples, faceShare: +(faces.samples.filter((x) => x[1].length).length / Math.max(1, faces.samples.length)).toFixed(2) } : {}), thumb: relative(ROOT, thumb).split('\\').join('/') });
    process.stdout.write(`\r  indexed ${clips.length}/${files.length}`);
  }
  writeFileSync(INDEX, JSON.stringify({ indexed: new Date().toISOString(), folder: relative(ROOT, dir), clips }, null, 1));
  const total = clips.reduce((a, c) => a + c.duration, 0);
  const md = [
    `# Footage index`, '',
    `${clips.length} clips, ${fmt(total)} total, from \`${relative(ROOT, dir)}\`. Transcripts: ${[...new Set(clips.map((c) => c.transcript))].join(', ')}.`, '',
    'Each clip: its ID (use it in edit plans), length, shape, a thumbnail strip (6 frames across the clip),',
    'and every sentence with its sentence number and start-end seconds. `(um)` marks fillers the cutter removes.',
    '`A:` / `B:` mark who is talking (from speech-to-text); in street interviews A is usually the host.',
    'Write plans in `edits/` (see docs/EDITOR.md), then `node footage.mjs build edits/`.', '',
    ...clips.flatMap((c) => [
      `## ${c.id} · ${basename(c.path)}`,
      `${fmt(c.duration)} · ${c.width}x${c.height} ${c.vertical ? 'vertical' : 'horizontal'} · ${c.fps ? c.fps + ' fps' : ''}${c.hasAudio ? '' : ' · no audio'}${c.faces ? ` · face found in ${Math.round(c.faceShare * 100)}% (auto-reframe)` : ''} · thumbs: \`${c.thumb}\``, '',
      ...(c.sentences.length
        ? c.sentences.map((s) => `- s${s.n} [${s.s.toFixed(2)}–${s.e.toFixed(2)}]${s.speaker != null ? ` ${speakerName(c, s.speaker)}:` : ''} ${c.words.slice(s.from, s.to + 1).map((w) => (w.filler ? `(${w.w})` : w.w)).join(' ')}`)
        : c.speech.length ? [`- speech at: ${c.speech.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)}`).join(', ')} (no transcript)`] : ['- (no speech: B-roll)']),
      '',
    ]),
  ];
  writeFileSync(join(FOOT, 'INDEX.md'), md.join('\n'));
  console.log(`\n  -> ${relative(ROOT, join(FOOT, 'INDEX.md'))} (${clips.length} clips, ${fmt(total)})`);
}

// Speakers as A, B, C in order of first appearance in the clip (the host is usually A: they ask first).
function speakerName(clip, sp) {
  const order = [...new Set(clip.words.filter((w) => w.sp != null).map((w) => w.sp))];
  return String.fromCharCode(65 + Math.max(0, order.indexOf(sp)));
}

// ---- cut -----------------------------------------------------------------------------------------
const loadIndex = () => {
  if (!existsSync(INDEX)) { console.error('Run `node footage.mjs index` first.'); process.exit(2); }
  const idx = JSON.parse(readFileSync(INDEX, 'utf8'));
  return new Map(idx.clips.map((c) => [c.id, c]));
};

// One plan segment -> the time ranges to keep from its clip, tightened to word edges with fillers
// and long pauses removed.
function rangesFor(seg, clip, plan) {
  let from = seg.from ?? 0, to = seg.to ?? clip.duration;
  const sents = seg.sentences ?? (seg.sentence != null ? [seg.sentence, seg.sentence] : null);
  if (sents) {
    const [a, b] = Array.isArray(sents) ? [sents[0], sents[sents.length - 1]] : [sents, sents];
    const sa = clip.sentences[a], sb = clip.sentences[b];
    if (!sa || !sb) throw new Error(`${seg.clip}: no sentence s${!sa ? a : b}`);
    from = sa.s; to = sb.e;
  }
  const tight = seg.tight ?? plan.tight ?? true;
  const words = clip.words.filter((w) => w.e > from + 0.02 && w.s < to - 0.02);
  if (!tight || !words.length) return [[Math.max(0, from), Math.min(clip.duration, to)]];
  const keepFillers = seg.keepFillers ?? plan.keepFillers ?? false;
  const maxGap = seg.maxPause ?? plan.maxPause ?? 0.4;
  const runs = [];
  let cur = null;
  for (const w of words) {
    if (w.filler && !keepFillers) { cur = null; continue; }
    if (!cur || w.s - cur.e > maxGap) runs.push(cur = { s: w.s, e: w.e, words: [] });
    cur.e = w.e; cur.words.push(w);
  }
  return runs.map((r) => [Math.max(0, r.s - 0.06), Math.min(clip.duration, r.e + 0.12)]);
}

async function cut(planFile, { quiet = false } = {}) {
  const clips = loadIndex();
  const plan = JSON.parse(readFileSync(planFile, 'utf8'));
  const name = plan.name || basename(planFile, '.json');
  const dir = join(ROOT, 'out', 'edits', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'parts'), { recursive: true });
  const pieces = [];   // { clip, a, b, zoom, focus, seg }
  (plan.segments || []).forEach((seg, si) => {
    const clip = clips.get(seg.clip);
    if (!clip) throw new Error(`${name}: unknown clip ${seg.clip}`);
    for (const [a, b] of rangesFor(seg, clip, plan)) pieces.push({ clip, a, b, seg, si, speaker: majority(clip.words.filter((w) => w.s >= a - 0.01 && w.e <= b + 0.05)) });
  });
  if (!pieces.length) throw new Error(`${name}: the plan has no segments`);
  // Audio clean-up: measure each piece after cleaning, then level speakers to the same loudness.
  for (const p of pieces) {
    p.audio = p.clip.hasAudio ? audioOptions(plan, p.seg) : null;
    p.chain = cleanChain(p.audio);
    p.lufs = p.audio?.level ? loudness(resolve(ROOT, p.clip.path), { from: p.a, dur: p.b - p.a, chain: p.chain }) : -70;
    Object.assign(p, { dur: p.b - p.a, target: p.audio?.target, maxGain: p.audio?.maxGain });
  }
  const gains = speakerGains(pieces.map((p) => ({ clip: p.clip.id, speaker: p.speaker, lufs: p.audio?.level ? p.lufs : -70, dur: p.dur, target: p.target, maxGain: p.maxGain })));
  pieces.forEach((p, k) => (p.gain = gains[k]));
  // Jump cuts alternate between a normal and a punched-in frame, which hides the cut (classic UGC).
  const punch = plan.punch ?? 1.1;
  const words = [], segStarts = [], segEnds = [], segWords = [];
  let t = 0, prevSeg = -1, toggle = false;
  const files = [];
  for (const [k, p] of pieces.entries()) {
    if (k > 0) toggle = !toggle;
    const zoom = p.seg.zoom ?? (punch && toggle ? punch : 1);
    const file = join(dir, 'parts', `${String(k).padStart(3, '0')}.mp4`);
    p.crop = cropFilter(p.clip, { zoom, focus: p.seg.focus ?? plan.focus, focusY: p.seg.focusY ?? plan.focusY, track: trackOf(p.clip, p.seg.face ?? plan.face), a: p.a, b: p.b });
    const src = resolve(ROOT, p.clip.path), dur = p.b - p.a;
    const audio = p.clip.hasAudio
      ? ['-map', '0:a:0', '-af', ['aresample=44100', p.chain, p.gain ? `volume=${p.gain}dB` : '', 'aformat=channel_layouts=stereo', `afade=t=in:d=0.012,afade=t=out:st=${Math.max(0, dur - 0.018).toFixed(3)}:d=0.018`].filter(Boolean).join(',')]
      : [];
    ff(['-ss', p.a.toFixed(3), '-t', dur.toFixed(3), '-i', src,
      ...(p.clip.hasAudio ? [] : ['-f', 'lavfi', '-t', dur.toFixed(3), '-i', 'anullsrc=r=44100:cl=stereo']),
      '-map', '0:v:0', ...(p.clip.hasAudio ? audio : ['-map', '1:a:0']),
      '-vf', p.crop.filter,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2',
      '-t', dur.toFixed(3), file], `cut ${p.clip.id} ${p.a.toFixed(2)}-${p.b.toFixed(2)}`);
    files.push(file);
    if (p.si !== prevSeg) { segStarts[p.si] = t; prevSeg = p.si; }
    for (const w of p.clip.words) if (w.s >= p.a - 0.01 && w.e <= p.b + 0.05 && !(w.filler && !(p.seg.keepFillers ?? plan.keepFillers))) {
      words.push({ w: w.w, s: +(t + w.s - p.a).toFixed(3), e: +(t + Math.min(w.e, p.b) - p.a).toFixed(3) });
      (segWords[p.si] ||= []).push(w.w);
    }
    t += dur;
    segEnds[p.si] = t;
  }
  const aroll = join(dir, 'aroll.mp4');
  writeFileSync(join(dir, 'parts.txt'), files.map((f) => `file '${f}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', join(dir, 'parts.txt'), '-c', 'copy', '-movflags', '+faststart', aroll], 'join');
  writeFileSync(join(dir, 'aroll.words.json'), JSON.stringify(words));
  const duration = +probe(aroll).duration.toFixed(3);

  // B-roll cutaways: cut to vertical, silent. at: seconds in the ad, or over: a segment index.
  const broll = (plan.broll || []).map((b, i) => {
    const clip = clips.get(b.clip);
    if (!clip) throw new Error(`${name}: unknown B-roll clip ${b.clip}`);
    const from = b.from ?? 0, len = Math.min((b.to ?? clip.duration) - from, b.dur ?? 99);
    const at = b.at ?? ((segStarts[b.over ?? 0] ?? 0) + (b.offset ?? 0.3));
    const file = join(dir, `broll-${i}.mp4`);
    ff(['-ss', from.toFixed(3), '-t', len.toFixed(3), '-i', resolve(ROOT, clip.path), '-an', '-vf', cropFilter(clip, { zoom: b.zoom ?? 1.04, focus: b.focus, focusY: b.focusY ?? (b.focus != null ? 0.5 : undefined), track: trackOf(clip, b.face), a: from, b: from + len }).filter,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', file], `B-roll ${b.clip}`);
    return { src: file, at: +Math.min(at, Math.max(0, duration - 1)).toFixed(3), dur: +Math.min(len, duration - at).toFixed(3) };
  });

  // Time taken out inside segments: the gaps between kept pieces (fillers, pauses, stumbles).
  const removed = pieces.reduce((acc, p, k) => (k && pieces[k - 1].si === p.si ? acc + Math.max(0, p.a - pieces[k - 1].b) : acc), 0);
  const data = {
    name, angle: plan.angle || '', aroll, duration,
    hooks: plan.hooks || (plan.hook ? [plan.hook] : []), comment: plan.comment || null, cta: plan.cta || '',
    product: plan.product || null, productAt: plan.productAt ?? null, broll, music: plan.music ?? 'pulse', look: plan.look ?? 'punchy',
    endCard: plan.endCard || null, caption: plan.caption || '', hashtags: plan.hashtags || [],
    segments: segStarts.map((s, i) => segmentInfo(plan.segments[i], i, s, segEnds[i], segWords[i])),
    street: plan.street || null, tally: plan.tally || null, captionStyle: plan.captions || null, hookStyle: plan.hookStyle || 'box',
  };
  writeFileSync(join(dir, 'data.json'), JSON.stringify(data, null, 1));
  const cleaned = pieces.filter((p) => p.audio).length, lv = pieces.filter((p) => p.gain).map((p) => Math.abs(p.gain));
  if (!quiet) console.log(`  ${name}: ${pieces.length} cuts, ${duration.toFixed(1)}s (removed ${Math.max(0, removed).toFixed(1)}s of fillers and pauses)${cleaned ? `, audio cleaned${lv.length ? `, levels evened (up to ${Math.max(...lv).toFixed(1)} dB)` : ''}` : ''} -> ${relative(ROOT, aroll)}`);
  return { name, dir, data, dataFile: join(dir, 'data.json'), plan };
}

// What the polish layer needs to know about one segment: where it sits and its street-interview
// overlays. A question card shows the words actually spoken (question: true) unless the plan gives text.
function segmentInfo(seg, i, start, end, spoken = []) {
  const said = spoken.join(' ').replace(/\s+([,.?!])/g, '$1').trim();
  const q = seg.question === true ? said : (typeof seg.question === 'string' ? seg.question : null);
  return {
    i, start: +start.toFixed(3), end: +(end ?? start).toFixed(3),
    ...(q ? { question: q } : {}),
    ...(seg.person ? { person: typeof seg.person === 'string' ? { name: seg.person } : seg.person } : {}),
    ...(seg.n != null ? { n: seg.n } : {}),
    ...(seg.answer != null ? { answer: String(seg.answer) } : {}),
  };
}

// ---- build ---------------------------------------------------------------------------------------
async function build(target) {
  let plans = (statSync(target).isDirectory() ? readdirSync(target).filter((f) => f.endsWith('.json')).sort().map((f) => join(target, f)) : [target]);
  if (!plans.length) { console.error('No edit plans (.json) found.'); process.exit(2); }
  const redo = opt('redo') ? JSON.parse(readFileSync(opt('redo'), 'utf8')) : null;
  const batch = opt('batch', redo?.batch || (basename(resolve(target)) === 'edits' ? 'delivery' : basename(target, '.json')));
  const outdir = join(ROOT, 'out', batch);
  // --only a,b or --redo review.json: rebuild just those ads; the rest of the batch stays as it is.
  let only = opt('only') ? opt('only').split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (redo) { mkdirSync(outdir, { recursive: true }); only = applyFeedback(outdir, redo).redo; console.log(`  feedback: ${only.length} ad(s) need changes${only.length ? ': ' + only.join(', ') : ''}`); }
  if (only) {
    const nameOf = (pf) => { try { return JSON.parse(readFileSync(pf, 'utf8')).name || basename(pf, '.json'); } catch { return basename(pf, '.json'); } };
    plans = plans.filter((pf) => only.includes(nameOf(pf)));
    if (!plans.length) { console.log('  nothing to rebuild.'); return; }
  }
  mkdirSync(outdir, { recursive: true });
  const template = resolve(opt('template', join(ROOT, 'scenes', 'templates', 'raw-edit.html')));
  const pass = [...(flag('variants') ? ['--variants'] : []), ...(opt('formats') ? ['--formats', opt('formats')] : []), ...(flag('fast') ? ['--fast'] : []), ...(opt('look') ? ['--look', opt('look')] : [])];
  const results = [];
  for (const [i, pf] of plans.entries()) {
    console.log(`\n=== ${i + 1}/${plans.length}: ${basename(pf)} ===`);
    try {
      const c = await cut(pf);
      const r = spawnSync(process.execPath, [join(ROOT, 'make.mjs'), template, '--data', c.dataFile, '--name', c.name, '--outdir', outdir, ...pass], { stdio: 'inherit' });
      results.push({ name: c.name, angle: c.data.angle, hooks: c.data.hooks, duration: c.data.duration, ok: r.status === 0 });
    } catch (e) {
      console.error('  ! ' + e.message);
      results.push({ name: basename(pf, '.json'), ok: false, error: e.message });
    }
  }
  // Keep earlier results for ads not rebuilt this time, so the sheet and review page cover the batch.
  const keep = join(outdir, '.results.json');
  const prev = existsSync(keep) ? JSON.parse(readFileSync(keep, 'utf8')) : [];
  const all = [...prev.filter((p) => !results.some((r) => r.name === p.name)), ...results];
  writeFileSync(keep, JSON.stringify(all));
  const sheet = writeDelivery(outdir, all);
  if (redo) {
    // Re-cut ads are new versions: their old decisions and approved copies no longer apply.
    const rebuilt = new Set(results.map((r) => r.name));
    const ofAd = (f) => rebuilt.has(f.replace(/(-v\d+)?(\.(4x5|1x1|16x9))?\.mp4$/, ''));
    const apd = join(outdir, 'approved');
    if (existsSync(apd)) for (const f of readdirSync(apd)) if (ofAd(f)) rmSync(join(apd, f));
    applyFeedback(outdir, { ...redo, decisions: Object.fromEntries(Object.entries(redo.decisions || {}).filter(([f]) => !ofAd(f))) });
  }
  const page = writeReview(outdir);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} ads built -> ${relative(ROOT, outdir)}  (sheet: ${relative(ROOT, sheet)}, review page: ${relative(ROOT, page)})`);
}

if (cmd === 'index') await index(positional[0]);
else if (cmd === 'cut') { for (const p of positional) await cut(p); }
else if (cmd === 'build') await build(positional[0] || join(ROOT, 'edits'));
else if (cmd === 'review') { const d = resolve(positional[0] || join(ROOT, 'out', 'delivery')); console.log(`  -> ${relative(ROOT, writeReview(d))}`); }
else if (cmd === 'feedback') {
  const f = resolve(positional[0] || ''), fb = JSON.parse(readFileSync(f, 'utf8'));
  const d = join(ROOT, 'out', fb.batch || basename(dirname(f)));
  const r = applyFeedback(d, fb);
  console.log(`  ${r.approved.length} approved (copied to ${relative(ROOT, join(d, 'approved'))}), ${r.redo.length} need changes -> ${relative(ROOT, join(d, 'FEEDBACK.md'))}`);
}
else {
  console.log('usage:\n  node footage.mjs index [footage/raw]\n  node footage.mjs cut edits/ad-01.json\n  node footage.mjs build edits/ [--variants] [--formats 4:5,1:1,16:9] [--batch name] [--fast] [--only a,b] [--redo out/<batch>/review.json]\n  node footage.mjs review out/<batch>          # (re)write the approval page\n  node footage.mjs feedback out/<batch>/review.json   # FEEDBACK.md + approved/ from the exported decisions');
  process.exit(cmd ? 2 : 0);
}
