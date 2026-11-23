// tools/longform/echoes.mjs: find where the speaker already said the same thing, earlier in their life, for a
// flashback ("a year ago I put it like this..."). The new recording's sentences are matched against the rest of
// the footage library and, optionally, an archive of their past transcripts (every YouTube video they've made).
//
//   node longform.mjs echoes edits/longform/x.json [--archive <dir>] [--top 5] [--older 90]
//   node longform.mjs echoes edits/longform/x.json --pull 3 [--apply]
//
// The first form writes out/longform/<name>/ECHOES.md: each match with the date, the source, both quotes and a
// score, best first. `--pull n` takes match n: from the archive it cuts those seconds from the YouTube video into
// the footage library and indexes them; from the library it's ready as is. It prints the a_roll item to splice
// in; `--apply` splices it into the plan right after the sentence it echoes (as a `flashback`).
//
// Archive format (what the studio's Librarian exports): <base>.transcript.json = [{ start, end, text }] next to
// <base>.info.json = { id, title, upload_date, webpage_url }.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { ROOT, fmt, readJSON, seconds } from './common.mjs';
import { index, libDir, loadLibrary } from './library.mjs';
import { clipDate, dateLabel, loadPlan, mapTime, parseAnchor, resolvePlan } from './plan.mjs';

const STOP = new Set(('a an the and or but if then so of to in on at by for with from as is are was were be been being it its this that these those there here i me my we our you your he she they them their his her ' +
  'not no do does did done have has had will would can could should may might must just very really also too than more most much many some any all each every ' +
  'what which who whom whose when where why how about into over under out up down off again once only own same such both few other ' +
  'like get got gonna wanna kind sort thing things stuff yeah okay ok um uh know mean right well going go see say said says one two lot little actually basically literally').split(' '));
const stem = (w) => (w.length > 5 ? w.replace(/(ingly|edly|ing|ed|es|ly|s)$/, '') : w.length > 3 ? w.replace(/s$/, '') : w);
export const terms = (text) => String(text).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);

/** A small TF-IDF index over chunks: { add(chunk), score(text) -> [{ chunk, score, shared }] }. */
export function tfidf() {
  const chunks = [], post = new Map();
  let idf = null;
  return {
    chunks,
    add(c) {
      const tf = new Map();
      for (const t of terms(c.text)) tf.set(t, (tf.get(t) || 0) + 1);
      c.tf = tf; c.i = chunks.length; chunks.push(c);
      for (const t of tf.keys()) { let p = post.get(t); if (!p) post.set(t, (p = [])); p.push(c.i); }
      idf = null;
    },
    score(text, { min = 0.3, shared = 3, limit = 5, skip = () => false } = {}) {
      const N = chunks.length || 1;
      idf ||= new Map([...post].map(([t, p]) => [t, Math.log(1 + N / p.length)]));
      const norm = (tf) => Math.sqrt([...tf].reduce((a, [t, n]) => a + (n * (idf.get(t) || 0)) ** 2, 0)) || 1;
      for (const c of chunks) c.norm ??= norm(c.tf);
      const q = new Map();
      for (const t of terms(text)) q.set(t, (q.get(t) || 0) + 1);
      const qn = norm(q), acc = new Map();
      for (const [t, n] of q) {
        const p = post.get(t);
        if (!p || (N > 200 && p.length > N * 0.08)) continue;   // words that are everywhere say nothing
        const w = n * (idf.get(t) || 0);
        for (const i of p) { const a = acc.get(i) || { dot: 0, shared: 0 }; a.dot += w * (chunks[i].tf.get(t) * (idf.get(t) || 0)); a.shared++; acc.set(i, a); }
      }
      return [...acc].filter(([i, a]) => a.shared >= shared && !skip(chunks[i])).map(([i, a]) => ({ chunk: chunks[i], score: +(a.dot / (qn * chunks[i].norm)).toFixed(3), shared: a.shared }))
        .filter((r) => r.score >= min).sort((a, b) => b.score - a.score).slice(0, limit);
    },
  };
}

/** Past transcripts -> chunks of about a sentence or two (10-30 words), each with its time and video. */
export function archiveChunks(dir) {
  const out = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.transcript.json'))) {
    const base = f.replace(/\.transcript\.json$/, '');
    const infoF = join(dir, base + '.info.json');
    const info = existsSync(infoF) ? readJSON(infoF) : {};
    let cues;
    try { cues = readJSON(join(dir, f)); } catch { continue; }
    let cur = null;
    const flush = () => { if (cur && cur.words >= 10) out.push(cur); cur = null; };
    for (const c of cues) {
      const n = String(c.text).split(/\s+/).length;
      if (cur && (c.start - cur.end > 1.5 || cur.words + n > 30)) flush();
      if (/^\[(music|applause|laughter)\]$/i.test(c.text.trim())) { flush(); continue; }
      cur ||= { source: 'archive', video: info.id || base.split('_').slice(1).join('_'), title: info.title || base, date: (info.upload_date || base.slice(0, 8)).replace(/^(\d{4})(\d\d)(\d\d)$/, '$1-$2-$3'), url: info.webpage_url, start: c.start, end: c.end, text: '', words: 0 };
      const text = String(c.text).replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/>>\s*/g, '').trim();
      cur.text += (cur.text ? ' ' : '') + text; cur.end = c.end; cur.words += n;
      if (/[.?!]$/.test(c.text.trim()) && cur.words >= 12) flush();
    }
    flush();
  }
  return out;
}

const echoesFile = (plan) => join(ROOT, 'out', 'longform', plan.name, 'echoes.json');

const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 864e5;

export async function echoes(planFile, { archive = null, top = 5, min = 0.45, older = 90, log = console.log } = {}) {
  const plan = loadPlan(planFile), lib = loadLibrary();
  const R = resolvePlan(plan, lib, { autoBroll: false, clips: false });
  if (R.errors.length) throw new Error(`fix the plan first:\n  ${R.errors.join('\n  ')}`);
  // The sentences said now (not inside existing flashbacks).
  const now = [];
  const used = new Set();
  for (const r of plan.a_roll || []) {
    if (r.flashback) continue;
    const c = lib.clips[r.clip]; used.add(r.clip);
    const from = r.from == null ? 0 : String(r.from).startsWith('#') ? parseAnchor(r.clip + r.from, lib).t : seconds(r.from);
    const to = r.to == null ? c.duration : String(r.to).startsWith('#') ? parseAnchor(r.clip + r.to, lib, { end: true }).t : seconds(r.to);
    for (const s of c.sentences) {
      if (s.s < from - 0.05 || s.e > to + 0.05 || terms(s.text).length < 5) continue;
      const at = mapTime(R.cuts, r.clip, s.s);
      if (at != null) now.push({ clip: r.clip, n: s.n, text: s.text, at });
    }
  }
  // Everything said before: the other recordings in the library, and the archive.
  const idx = tfidf();
  for (const c of Object.values(lib.clips)) {
    if (used.has(c.id)) continue;
    for (const s of c.sentences || []) idx.add({ source: 'library', clip: c.id, n: s.n, text: s.text, start: s.s, end: s.e, date: clipDate(c), title: c.id });
  }
  if (archive) { const ch = archiveChunks(archive); ch.forEach((c) => idx.add(c)); log(`  archive: ${ch.length} passages from ${relative(process.cwd(), archive) || archive}`); }
  if (!idx.chunks.length) throw new Error('nothing to compare with: index older recordings into the library, or pass --archive <dir of *.transcript.json>');

  // A flashback reaches back: only moments at least `older` days before this recording (its date, the plan's
  // "date", or today). That also keeps out the very video a clip was cut from.
  const nowDate = plan.date || (plan.a_roll || []).map((r) => clipDate(lib.clips[r.clip])).filter(Boolean).sort().pop() || new Date().toISOString().slice(0, 10);
  const skip = (c) => !c.date || days(nowDate, c.date) < older;
  const found = [], taken = new Set();
  for (const s of now) for (const r of idx.score(s.text, { min, shared: 4, limit: 3, skip })) found.push({ now: s, ...r });
  // Further back reads better ("two years ago I said..."): a small lift for age, up to two years.
  const lift = (f) => f.score * (1 + 0.12 * Math.min(2, days(nowDate, f.chunk.date) / 365));
  found.sort((a, b) => lift(b) - lift(a));
  const list = [];
  for (const f of found) {
    const key = f.chunk.source === 'archive' ? `${f.chunk.video}@${Math.round(f.chunk.start)}` : `${f.chunk.clip}#${f.chunk.n}`;
    if (taken.has(key) || list.some((x) => x.now.clip === f.now.clip && x.now.n === f.now.n)) continue;
    taken.add(key); list.push(f);
    if (list.length >= top) break;
  }
  const items = list.map((f, k) => ({ n: k + 1, score: f.score, shared: f.shared, now: { clip: f.now.clip, sentence: f.now.n, at: +f.now.at.toFixed(2), text: f.now.text },
    then: { source: f.chunk.source, date: f.chunk.date, title: f.chunk.title, clip: f.chunk.clip, sentence: f.chunk.n, video: f.chunk.video, url: f.chunk.url, start: f.chunk.start, end: f.chunk.end, text: f.chunk.text } }));
  const outDir = join(ROOT, 'out', 'longform', plan.name);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(echoesFile(plan), JSON.stringify({ plan: relative(ROOT, plan._file), archive, items }, null, 2));
  const md = [`# Echoes: ${plan.title || plan.name}`, '',
    `Moments where you said the same thing before (at least ${older} days before ${nowDate}). A flashback is a spice: one, two at most, and only where it lands; plenty of videos need none. \`node longform.mjs echoes <plan> --pull <n> --apply\``,
    'cuts it in right after the sentence it echoes (rewind, the old clip with its date, back to now).', '',
    ...items.flatMap((i) => [`## ${i.n}. ${i.then.date ? dateLabel(i.then.date) : 'undated'} · score ${i.score}`, '',
      `**Now (${fmt(i.now.at)}):** "${i.now.text}"`, '',
      `**Then:** "${i.then.text}"`, '',
      `Source: ${i.then.source === 'archive' ? `[${i.then.title}](https://youtu.be/${i.then.video}?t=${Math.floor(i.then.start)}) at ${fmt(i.then.start)}` : `${i.then.clip} #${i.then.sentence}`}`, ''])].join('\n');
  writeFileSync(join(outDir, 'ECHOES.md'), md + '\n');
  return { ok: true, echoes: items.length, report: join(outDir, 'ECHOES.md'), items };
}

/** Take echo n: make it a library clip if it isn't one, then the a_roll item (and splice it in with apply). */
export async function pullEcho(planFile, n, { apply = false, log = console.log, download } = {}) {
  const plan = loadPlan(planFile);
  const f = echoesFile(plan);
  if (!existsSync(f)) throw new Error('run `node longform.mjs echoes <plan>` first');
  const it = readJSON(f).items.find((x) => x.n === n);
  if (!it) throw new Error(`no echo ${n} in ${relative(ROOT, f)}`);
  let item;
  if (it.then.source === 'library') {
    item = { clip: it.then.clip, from: `#${it.then.sentence}`, to: `#${it.then.sentence}`, flashback: { date: it.then.date || '' } };
  } else {
    const dir = libDir();
    mkdirSync(dir, { recursive: true });
    const name = `${(it.then.date || '').replace(/-/g, '')}_${it.then.video}_${Math.round(it.then.start)}.mp4`;
    const file = join(dir, name);
    if (!existsSync(file)) {
      const dl = download || (await import('../clips/index.mjs')).downloadSection;
      dl(it.then.video, Math.max(0, it.then.start - 0.6), it.then.end + 0.8, file);
      log(`  cut ${fmt(it.then.start)}-${fmt(it.then.end)} of "${it.then.title}" -> ${relative(ROOT, file)}`);
    }
    await index(dir, { log: () => {} });
    const clip = Object.values(loadLibrary().clips).find((c) => basename(c.file) === name);
    if (!clip) throw new Error(`indexed ${name} but it isn't in the library`);
    // Keep exactly the passage: from its first word to its last (the cut has slack on both sides, which can catch
    // the end of the sentence before or the start of the one after).
    const toks = String(it.then.text).toLowerCase().match(/[a-z0-9']+/g) || [];
    const b = (w) => String(w).toLowerCase().replace(/[^a-z0-9']/g, '');
    const lead = Math.min(0.6, it.then.start), span = it.then.end - it.then.start;
    const first = clip.words.find((w) => b(w.w) === toks[0] && w.s <= lead + 1.2);
    const last = [...clip.words].reverse().find((w) => b(w.w) === toks[toks.length - 1] && w.s <= lead + span + 0.6);
    item = { clip: clip.id, flashback: { date: it.then.date || '' } };
    if (first && last && last.e > first.s) {
      const after = clip.words[clip.words.indexOf(last) + 1];
      item.from = +Math.max(0, first.s - 0.1).toFixed(2);
      item.to = +Math.min(clip.duration, last.e + 0.25, after ? (last.e + after.s) / 2 : Infinity).toFixed(2);
    }
  }
  if (apply) {
    const raw = readJSON(plan._file);
    const lib = loadLibrary();
    const k = raw.a_roll.findIndex((r) => {
      if (r.flashback || r.clip !== it.now.clip) return false;
      const c = lib.clips[r.clip], s = c.sentences.find((x) => x.n === it.now.sentence);
      const from = r.from == null ? 0 : String(r.from).startsWith('#') ? parseAnchor(r.clip + r.from, lib).t : seconds(r.from);
      const to = r.to == null ? c.duration : String(r.to).startsWith('#') ? parseAnchor(r.clip + r.to, lib, { end: true }).t : seconds(r.to);
      return s && s.s >= from - 0.05 && s.e <= to + 0.05;
    });
    if (k < 0) throw new Error(`sentence ${it.now.clip}#${it.now.sentence} isn't in the plan's a_roll any more`);
    const r = raw.a_roll[k], c = lib.clips[r.clip];
    const last = c.sentences.filter((s) => {
      const to = r.to == null ? c.duration : String(r.to).startsWith('#') ? parseAnchor(r.clip + r.to, lib, { end: true }).t : seconds(r.to);
      return s.e <= to + 0.05;
    }).pop();
    const parts = [{ ...r, to: `#${it.now.sentence}` }, item];
    if (last && last.n > it.now.sentence) parts.push({ ...r, from: `#${it.now.sentence + 1}` });
    raw.a_roll.splice(k, 1, ...parts);
    writeFileSync(plan._file, JSON.stringify(raw, null, 2) + '\n');
    log(`  spliced into ${relative(ROOT, plan._file)} a_roll[${k + 1}], after "${it.now.text.slice(0, 60)}"`);
  }
  return { ok: true, item, applied: apply };
}
