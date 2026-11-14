// tools/longform/library.mjs: index hours of talking footage once, then search it by topic.
//
//   index(dir)   every video in dir -> transcript (word timings), numbered sentences, shot changes,
//                a contact sheet per clip, and footage/library/.index/{library.json, LIBRARY.md, <id>.md}.
//                Re-running only processes new or changed files.
//   search(q)    ranked moments across the whole archive ("everything he said about bluffing").
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { FF, FILLERS, ROOT, VIDEO_EXT, bare, fileKey, fmt, frameAt, probe, readJSON, sentencesOf, sheet, slug, transcribe, writeJSON } from './common.mjs';

export const libDir = () => (process.env.LONGFORM_LIBRARY ? resolve(process.env.LONGFORM_LIBRARY) : join(ROOT, 'footage', 'library'));
export const IDX = () => join(libDir(), '.index');
const LIBJSON = () => join(IDX(), 'library.json');

export function loadLibrary() {
  if (!existsSync(LIBJSON())) return { clips: {} };
  return readJSON(LIBJSON());
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (VIDEO_EXT.test(e.name)) out.push(p);
  }
  return out.sort();
}

// Shot changes from ffmpeg's scene score on a small, 5 fps copy (fast even on hours of footage).
function shots(file, dur) {
  const r = spawnSync(FF, ['-hide_banner', '-i', file, '-an', '-vf', "fps=5,scale=192:-2,select='gt(scene,0.32)',showinfo", '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const cuts = [...(r.stderr || '').matchAll(/pts_time:([\d.]+)/g)].map((m) => +(+m[1]).toFixed(2)).filter((t) => t > 0.5 && t < dur - 0.5);
  const edges = [0, ...cuts, dur];
  return edges.slice(0, -1).map((s, i) => [s, +edges[i + 1].toFixed(2)]);
}

async function contactSheet(file, dur, out) {
  const tmp = out + '.parts';
  mkdirSync(tmp, { recursive: true });
  const items = [];
  for (let i = 0; i < 12; i++) {
    const t = Math.min(dur - 0.1, (dur / 12) * (i + 0.5));
    items.push({ file: frameAt(file, t, join(tmp, `${i}.jpg`)), label: fmt(t) });
  }
  await sheet(items, out, { title: basename(out, '.sheet.jpg') });
  rmSync(tmp, { recursive: true, force: true });
}

const STOP = new Set('the a an and or but so to of in on at for with is it its it\'s that this these those i you he she we they me my your our their be was were are been being have has had do does did not no yes just like really very what when where who why how there here then than as from by about into out up down over if all any some one two can could would should will well okay ok yeah gonna got get go going know think mean thing things right lot kind sort actually basically'.split(' '));
const stem = (w) => w.replace(/'s$/, '').replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '') || w;
const terms = (text) => String(text).toLowerCase().split(/[^a-z0-9']+/).map(bare).filter((w) => w && !STOP.has(w) && !FILLERS.has(w)).map(stem);

export async function index(dir = libDir(), { force = false, log = console.log } = {}) {
  dir = resolve(dir);
  const single = existsSync(dir) && statSync(dir).isFile();   // one recording (from-script) instead of a folder
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); log(`created ${relative(ROOT, dir)}/ — put your videos there and run again`); }
  const lib = loadLibrary();
  const files = single ? [dir] : walk(dir);
  const ids = new Set();
  const cache = join(IDX(), 'cache');
  for (const file of files) {
    let id = slug(basename(file));
    while (ids.has(id) || (lib.clips[id] && lib.clips[id].file !== resolve(file))) id += '-2';
    ids.add(id);
    const key = fileKey(file);
    if (!force && lib.clips[id]?.key === key && existsSync(join(IDX(), id + '.md'))) continue;
    log(`indexing ${relative(ROOT, file)} as ${id}`);
    const p = probe(file);
    const t = p.hasAudio ? await transcribe(file, cache) : { via: 'none', words: [] };
    const sentences = sentencesOf(t.words);
    const clip = { id, file: resolve(file), key, duration: +p.duration.toFixed(2), width: p.width, height: p.height, fps: p.fps,
      hasAudio: p.hasAudio, transcript: t.via, words: t.words, sentences, shots: p.hasVideo ? shots(file, p.duration) : [] };
    if (p.hasVideo) await contactSheet(file, p.duration, join(IDX(), id + '.sheet.jpg'));
    lib.clips[id] = clip;
    writeFileSync(join(IDX(), id + '.md'), clipMarkdown(clip));
  }
  if (!single) for (const id of Object.keys(lib.clips)) if (!ids.has(id) && !existsSync(lib.clips[id].file)) delete lib.clips[id];   // removed from disk
  topics(lib);
  writeJSON(LIBJSON(), lib);
  writeFileSync(join(IDX(), 'LIBRARY.md'), libraryMarkdown(lib));
  const clips = Object.values(lib.clips);
  const hours = clips.reduce((a, c) => a + c.duration, 0) / 3600;
  log(`library: ${clips.length} clips, ${hours.toFixed(2)} h, ${clips.reduce((a, c) => a + c.sentences.length, 0)} sentences -> ${relative(ROOT, join(IDX(), 'LIBRARY.md'))}`);
  return { ok: true, ids: [...ids], clips: clips.length, hours: +hours.toFixed(2), index: join(IDX(), 'LIBRARY.md'), missingTranscripts: clips.filter((c) => c.hasAudio && !c.words.length).map((c) => c.id) };
}

function topics(lib) {
  const clips = Object.values(lib.clips);
  const df = new Map(), surface = new Map();
  const tfs = clips.map((c) => {
    const tf = new Map();
    for (const s of c.sentences) for (const raw of String(s.text).toLowerCase().split(/[^a-z0-9']+/)) {
      const w = bare(raw);
      if (!w || STOP.has(w) || FILLERS.has(w)) continue;
      const t = stem(w);
      tf.set(t, (tf.get(t) || 0) + 1);
      const sf = surface.get(t) || new Map(); sf.set(w, (sf.get(w) || 0) + 1); surface.set(t, sf);
    }
    for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
    return tf;
  });
  const word = (t) => [...surface.get(t)].sort((a, b) => b[1] - a[1])[0][0];
  clips.forEach((c, i) => {
    c.topics = [...tfs[i]].filter(([w, n]) => n > 1 && w.length > 3).map(([w, n]) => [w, n * Math.log(1 + clips.length / (df.get(w) || 1))]).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => word(w));
  });
}

function clipMarkdown(c) {
  const fillers = c.words.filter((w) => FILLERS.has(bare(w.w))).length;
  const lines = [`# ${c.id}`, '', `File: ${c.file}`, `Length ${fmt(c.duration)} · ${c.width}x${c.height} @ ${c.fps} fps · transcript: ${c.transcript} · ${c.shots.length} shot(s) · ${fillers} filler(s)`,
    `Contact sheet: ${c.id}.sheet.jpg`, '', '## Sentences (anchor as `' + c.id + '#n`)', ''];
  for (const s of c.sentences) lines.push(`#${s.n} [${fmt(s.s)}–${fmt(s.e)}] ${s.text.replace(/\b(um+|uh+|erm|uhm)\b/gi, '($1)')}`);
  if (c.shots.length > 1) { lines.push('', '## Shots', ''); c.shots.forEach(([a, b], i) => lines.push(`${i + 1}. ${fmt(a)}–${fmt(b)}`)); }
  return lines.join('\n') + '\n';
}

function libraryMarkdown(lib) {
  const clips = Object.values(lib.clips);
  const lines = ['# Footage library', '', `${clips.length} clips, ${fmt(clips.reduce((a, c) => a + c.duration, 0))} total. One file per clip in this folder (\`<id>.md\`: every sentence, numbered, with times; \`<id>.sheet.jpg\`: 12 frames).`,
    'Find moments across everything with `node longform.mjs search "<topic>"`.', '', '| Clip | Length | Size | Sentences | Topics |', '|---|---|---|---|---|'];
  for (const c of clips) lines.push(`| ${c.id} | ${fmt(c.duration)} | ${c.width}x${c.height} | ${c.sentences.length} | ${(c.topics || []).join(', ')} |`);
  return lines.join('\n') + '\n';
}

// BM25 over two-sentence windows, plus a bonus for the exact phrase.
export function search(query, { limit = 12 } = {}) {
  const lib = loadLibrary();
  const docs = [];
  for (const c of Object.values(lib.clips)) c.sentences.forEach((s, i) => {
    const next = c.sentences[i + 1];
    const text = s.text + (next && next.s - s.e < 2 ? ' ' + next.text : '');
    docs.push({ clip: c.id, n: s.n, s: s.s, e: next && next.s - s.e < 2 ? next.e : s.e, text, own: s.text, terms: terms(text) });
  });
  if (!docs.length) return [];
  const q = [...new Set(terms(query))];
  const avg = docs.reduce((a, d) => a + d.terms.length, 0) / docs.length;
  const df = new Map(q.map((t) => [t, docs.filter((d) => d.terms.includes(t)).length]));
  const phrase = String(query).toLowerCase().trim();
  const scored = docs.map((d) => {
    let score = 0;
    for (const t of q) {
      const tf = d.terms.filter((x) => x === t).length;
      if (!tf) continue;
      const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
      score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * d.terms.length / avg));
    }
    if (phrase.length > 3 && d.text.toLowerCase().includes(phrase)) score *= 1.6;
    return { ...d, score };
  }).filter((d) => d.score > 0).sort((a, b) => b.score - a.score);
  const seen = new Set(), out = [];
  for (const d of scored) {   // one hit per sentence pair
    const k = `${d.clip}#${d.n}`, k2 = `${d.clip}#${d.n - 1}`;
    if (seen.has(k) || seen.has(k2)) continue;
    seen.add(k); out.push({ anchor: k, clip: d.clip, sentence: d.n, start: d.s, end: d.e, score: +d.score.toFixed(2), text: d.text });
    if (out.length >= limit) break;
  }
  return out;
}
