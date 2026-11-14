// tools/longform/plan.mjs: read a long-form edit plan, cut the talking (A-roll) word-exact, and map
// every anchor ("clip@1:23.4", "clip#12", "clip#12" + word) onto the finished video's timeline.
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { FILLERS, H, ROOT, W, bare, fmt, readJSON, seconds } from './common.mjs';
import { loadLibrary } from './library.mjs';

export const KINDS = ['animation', 'broll', 'pull', 'image', 'face'];
export const LAYOUTS = ['full', 'side'];
export const TIGHTEN = { fillers: true, max_pause: 0.45, pad: 0.08 };

// Where "side" inserts sit: a 16:9 box (default top-right, half width). plan.side = { w, x, y } to move it
// off the speaker's face (x/y are the box's top-left in 1920x1080 pixels).
export function sideBox(plan = {}) {
  const w = Math.round((plan.side?.w ?? 960) / 2) * 2, h = Math.round(w * 9 / 32) * 2;
  return { w, h, x: plan.side?.x ?? W - w - 64, y: plan.side?.y ?? 96, border: plan.side?.border ?? 5 };
}

export function loadPlan(file) {
  const plan = readJSON(file);
  plan.name = plan.name || file.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
  plan.fps = plan.fps || 30;
  if (typeof plan.theme === 'string') plan.theme = { style: plan.theme };   // "theme": "blueprint"
  plan._file = resolve(file);
  return plan;
}

export const rel = (p) => (isAbsolute(p) ? p : resolve(ROOT, p));

// "clip#12" -> sentence 12's start, "clip@83.2" / "clip@1:23.2" -> source time. Returns { clip, t, sentence? }.
export function parseAnchor(a, lib, { end = false } = {}) {
  if (typeof a === 'number') return { out: a };
  const m = String(a).match(/^(.+?)([#@])(.+)$/);
  if (!m) throw new Error(`can't read anchor "${a}" (use clip#sentence, clip@seconds, clip@m:ss or a number of output seconds)`);
  const [, id, kind, rest] = m;
  const clip = lib.clips[id];
  if (!clip) throw new Error(`unknown clip "${id}" in "${a}" (see footage/library/.index/LIBRARY.md)`);
  if (kind === '@') {
    const t = seconds(rest);
    if (!Number.isFinite(t)) throw new Error(`bad time in "${a}"`);
    return { clip: id, t };
  }
  const n = parseInt(rest, 10);
  const s = clip.sentences.find((x) => x.n === n);
  if (!s) throw new Error(`"${a}": ${id} has sentences #1-#${clip.sentences.length}`);
  return { clip: id, t: end ? s.e : s.s, sentence: s };
}

// The word inside a sentence (or the nearest one after the anchor) whose text matches.
function findWord(clip, anchor, word) {
  const target = bare(word);
  const from = anchor.sentence ? anchor.sentence.from : clip.words.findIndex((w) => w.e >= anchor.t);
  const to = anchor.sentence ? anchor.sentence.to + 40 : from + 80;
  for (let i = Math.max(0, from); i <= Math.min(clip.words.length - 1, to); i++) if (bare(clip.words[i].w).startsWith(target)) return clip.words[i];
  return null;
}

// Word-exact cut list: [{ clip, s, e, out, d }] in output order.
export function cutList(plan, lib) {
  const tighten = plan.tighten === false ? null : { ...TIGHTEN, ...(plan.tighten || {}) };
  const drop = new Set((tighten?.drop || []).map(String));
  const cuts = [];
  for (const [ri, r] of (plan.a_roll || []).entries()) {
    const clip = lib.clips[r.clip];
    if (!clip) throw new Error(`a_roll[${ri}]: unknown clip "${r.clip}"`);
    const from = r.from == null ? 0 : String(r.from).startsWith('#') ? parseAnchor(r.clip + r.from, lib).t : seconds(r.from);
    const to = r.to == null ? clip.duration : String(r.to).startsWith('#') ? parseAnchor(r.clip + r.to, lib, { end: true }).t : seconds(r.to);
    if (!(to > from)) throw new Error(`a_roll[${ri}]: "to" must be after "from"`);
    const t = r.tighten === false ? null : tighten;
    const words = clip.words.filter((w) => w.s >= from - 0.05 && w.e <= to + 0.05);
    if (!t || !words.length) { cuts.push({ clip: r.clip, s: from, e: Math.min(to, clip.duration) }); continue; }
    const dropped = new Set();
    for (const s of clip.sentences) if (drop.has(`${r.clip}#${s.n}`)) for (let i = s.from; i <= s.to; i++) dropped.add(i);
    // tighten.cut: [{ at: "clip#n", text: "they're running um" }] removes those exact words (false starts, repeats).
    for (const [ci, c] of (tighten?.cut || []).entries()) {
      if (!String(c.at).startsWith(r.clip + '#') && !String(c.at).startsWith(r.clip + '@')) continue;
      const a = parseAnchor(c.at, lib), want = String(c.text).split(/\s+/).map(bare).filter(Boolean);
      const start = a.sentence ? a.sentence.from : clip.words.findIndex((w) => w.e >= a.t);
      let hit = -1;
      for (let i = Math.max(0, start); i < Math.min(clip.words.length, start + 120) && hit < 0; i++) if (want.every((x, k) => bare(clip.words[i + k]?.w || '') === x)) hit = i;
      if (hit < 0) throw new Error(`tighten.cut[${ci}]: "${c.text}" not found at ${c.at}`);
      for (let k = 0; k < want.length; k++) dropped.add(hit + k);
    }
    const keep = words.map((w) => ({ w, i: clip.words.indexOf(w) })).filter(({ w, i }) => !dropped.has(i) && !(t.fillers && FILLERS.has(bare(w.w))));
    let seg = null;
    const segs = [];
    keep.forEach(({ w, i }, k) => {
      const prev = keep[k - 1];
      const joined = prev && prev.i === i - 1 && w.s - prev.w.e <= t.max_pause;
      if (!seg || !joined) segs.push(seg = { s: w.s, e: w.e, first: i, last: i });
      else { seg.e = w.e; seg.last = i; }
    });
    // Pad each piece, but never into a neighbour's words (or a removed filler).
    segs.forEach((g, k) => {
      const before = clip.words[g.first - 1], after = clip.words[g.last + 1];
      const lo = Math.max(from, before ? (before.e + g.s) / 2 : g.s - t.pad, g.s - t.pad);
      const hi = Math.min(to, after ? (g.e + after.s) / 2 : g.e + t.pad, g.e + t.pad);
      cuts.push({ clip: r.clip, s: +lo.toFixed(3), e: +hi.toFixed(3) });
    });
  }
  let out = 0;
  for (const c of cuts) {
    const frames = Math.max(1, Math.round((c.e - c.s) * plan.fps));
    c.d = frames / plan.fps; c.e = +(c.s + c.d).toFixed(3); c.out = +out.toFixed(4); out += c.d;
  }
  return cuts;
}

// Source time in a clip -> output time (a time inside a removed gap lands on the next kept piece).
export function mapTime(cuts, clip, t) {
  let best = null;
  for (const c of cuts) {
    if (c.clip !== clip) continue;
    if (t >= c.s - 1e-3 && t <= c.e + 1e-3) return c.out + Math.max(0, t - c.s);
    if (c.s > t && (!best || c.s < best.s)) best = c;
  }
  return best ? best.out : null;
}

export function resolveAt(item, cuts, lib, where) {
  if (typeof item.at === 'number') return item.at + (item.offset || 0);
  const a = parseAnchor(item.at, lib);
  let t = a.t;
  if (item.word) {
    const w = findWord(lib.clips[a.clip], a, item.word);
    if (!w) throw new Error(`${where}: word "${item.word}" not found near ${item.at}`);
    t = w.s;
  }
  const out = mapTime(cuts, a.clip, t);
  if (out == null) throw new Error(`${where}: ${item.at}${item.word ? ` ("${item.word}")` : ''} is not inside the A-roll (add that part to a_roll, or anchor elsewhere)`);
  return out + (item.offset || 0);
}

// Everything the build needs, resolved and checked. Problems are collected, not thrown, so the
// agent sees all of them at once.
export function resolvePlan(plan, lib = loadLibrary()) {
  const errors = [], warnings = [];
  let cuts = [];
  try { cuts = cutList(plan, lib); } catch (e) { errors.push(e.message); return { errors, warnings }; }
  const total = cuts.reduce((a, c) => a + c.d, 0);
  const source = (plan.a_roll || []).reduce((a, r) => { const c = lib.clips[r.clip]; return a + (c ? (r.to == null ? c.duration : String(r.to).startsWith('#') ? parseAnchor(r.clip + r.to, lib, { end: true }).t : seconds(r.to)) - (r.from == null ? 0 : String(r.from).startsWith('#') ? parseAnchor(r.clip + r.from, lib).t : seconds(r.from)) : 0); }, 0);

  const inserts = [];
  for (const [i, ins] of (plan.inserts || []).entries()) {
    const where = `inserts[${i}]${ins.id ? ` (${ins.id})` : ''}`;
    if (!KINDS.includes(ins.kind)) { errors.push(`${where}: kind must be one of ${KINDS.join(', ')}`); continue; }
    let at;
    try { at = resolveAt(ins, cuts, lib, where); } catch (e) { errors.push(e.message); continue; }
    const auto = ins.dur === 'auto' || (ins.dur == null && plan.from_script);
    const dur = auto ? 0 : +(ins.dur ?? 5);
    const layout = ins.layout || 'full';
    if (!LAYOUTS.includes(layout)) errors.push(`${where}: layout must be ${LAYOUTS.join(' or ')}`);
    const r = { i, where, auto, maxDur: ins.max_dur, id: ins.id || `${ins.kind}-${i + 1}`, kind: ins.kind, at: +Math.max(0, at).toFixed(3), dur, layout, sfx: ins.sfx === undefined ? (layout === 'full' ? 'whoosh' : 'pop') : ins.sfx, note: ins.note || '', src: ins };
    if (ins.kind === 'animation') {
      if (!ins.scene || !existsSync(rel(ins.scene))) errors.push(`${where}: scene file not found: ${ins.scene}`);
      r.scene = ins.scene && rel(ins.scene); r.data = { ...(plan.theme || {}), ...(ins.data || {}) };
      // marks: { flipAt: { at: "clip#13", word: "boom" } } -> data.flipAt = seconds into the insert,
      // so an animation's beat lands on a spoken word.
      for (const [key, spec] of Object.entries(ins.marks || {})) {
        try { r.data[key] = +(resolveAt(typeof spec === 'object' ? spec : { at: spec }, cuts, lib, `${where}.marks.${key}`) - at).toFixed(3); } catch (e) { errors.push(e.message); }
        if (r.data[key] < 0) warnings.push(`${where}: mark ${key} lands before the insert starts`);
      }
    } else if (ins.kind === 'broll') {
      if (ins.clip) {
        const c = lib.clips[ins.clip];
        if (!c) errors.push(`${where}: unknown clip "${ins.clip}"`);
        else {
          const from = ins.from == null ? 0 : String(ins.from).startsWith('#') ? parseAnchor(ins.clip + ins.from, lib).t : seconds(ins.from);
          if (from + dur > c.duration + 0.05) errors.push(`${where}: ${ins.clip} is only ${fmt(c.duration)} long`);
          r.file = c.file; r.from = from;
        }
      } else if (ins.file) {
        if (!existsSync(rel(ins.file))) errors.push(`${where}: file not found: ${ins.file} (stock footage goes in assets/broll/)`);
        r.file = rel(ins.file); r.from = seconds(ins.from ?? 0);
      } else if (ins.stock) {
        // Stock footage by search ("poker chips close up"): `node longform.mjs stock <plan>` downloads it to
        // assets/broll/<id>.mp4. Until then it builds as a labelled placeholder, like a pull.
        const saved = join(ROOT, 'assets', 'broll', `${r.id}.mp4`);
        if (existsSync(saved)) { r.file = saved; r.from = seconds(ins.from ?? 0); r.stock = ins.stock; }
        else Object.assign(r, { kind: 'pull', stock: ins.stock, search: ins.stock, url: '', from: '', to: '', title: `Stock: ${ins.stock}` });
      } else errors.push(`${where}: broll needs "clip" (from the library), "file" or "stock" (a search)`);
      r.audio = ins.audio ?? 0;
    } else if (ins.kind === 'image') {
      if (!ins.file || !existsSync(rel(ins.file))) errors.push(`${where}: image not found: ${ins.file}`);
      r.file = ins.file && rel(ins.file);
    } else if (ins.kind === 'pull') {
      if (!ins.url && !ins.search) errors.push(`${where}: a pull needs "url" (or "search" if the exact source isn't known yet)`);
      r.url = ins.url || ''; r.search = ins.search || ''; r.from = ins.from ?? ''; r.to = ins.to ?? ''; r.title = ins.title || ins.note || 'Clip to pull';
      // Once the clip is saved (assets/broll/<id>.mp4, or "file"), it replaces the placeholder: trimmed
      // to its start ("clip_from", default 0) and muted unless "audio" is set.
      const saved = ins.file ? rel(ins.file) : join(ROOT, 'assets', 'broll', `${r.id}.mp4`);
      if (existsSync(saved)) Object.assign(r, { kind: 'broll', pulled: true, file: saved, from: seconds(ins.clip_from ?? 0), audio: ins.audio ?? 0 });
    }
    inserts.push(r);
  }
  inserts.sort((a, b) => a.at - b.at);
  // Voice-only: no picture in the recording (or plan.base = "backdrop"); the animated backdrop + captions fill the gaps.
  const voiceOnly = plan.base === 'backdrop' || (plan.a_roll || []).every((r) => lib.clips[r.clip] && !lib.clips[r.clip].height);
  // "auto" lengths run to the next visual (or [[face]]), capped so the speaker comes back between ideas.
  inserts.forEach((ins, k) => {
    if (ins.auto) {
      const next = inserts[k + 1]?.at ?? total;
      const cap = ins.maxDur ?? (ins.kind === 'pull' && !ins.stock ? 8 : null) ?? plan.auto_max ?? (voiceOnly ? 12 : ins.kind === 'animation' ? 7 : 5);
      ins.dur = +Math.max(2, Math.min(cap, next - ins.at - 0.25)).toFixed(2);
      if (next - ins.at < 2.25) warnings.push(`${ins.where}: only ${(next - ins.at).toFixed(1)} s before the next visual; move one cue`);
    }
    if (ins.kind === 'face') return;
    if (ins.dur < 1 || ins.dur > 30) warnings.push(`${ins.where}: ${ins.dur}s is unusual (1.5-8 s reads best)`);
    if (ins.at + ins.dur > total + 0.01) {
      if (ins.auto) ins.dur = +Math.max(1, total - ins.at - 0.1).toFixed(2);
      else errors.push(`${ins.where}: ends at ${fmt(ins.at + ins.dur)}, after the video ends (${fmt(total)})`);
    }
  });
  for (let k = inserts.length - 1; k >= 0; k--) if (inserts[k].kind === 'face') inserts.splice(k, 1);
  for (const ins of inserts) if (ins.kind === 'animation' && ins.src.marks) for (const [key, spec] of Object.entries(ins.src.marks)) {
    if (ins.data[key] > ins.dur) warnings.push(`${ins.where}: mark ${key} lands at ${ins.data[key]}s, after the insert ends (${ins.dur}s)`);
  }
  for (let k = 1; k < inserts.length; k++) {
    const a = inserts[k - 1], b = inserts[k];
    if (b.at < a.at + a.dur - 0.05) errors.push(`${a.id} (${fmt(a.at)}–${fmt(a.at + a.dur)}) overlaps ${b.id} (starts ${fmt(b.at)})`);
  }

  const chapters = [];
  for (const [i, ch] of (plan.chapters || []).entries()) {
    try { chapters.push({ at: +resolveAt(ch, cuts, lib, `chapters[${i}]`).toFixed(2), title: ch.title }); } catch (e) { errors.push(e.message); }
  }
  chapters.sort((a, b) => a.at - b.at);
  if (chapters.length) {
    if (chapters[0].at > 0.5) warnings.push('YouTube chapters must start at 0:00 (the first is moved there)');
    chapters[0].at = 0;
    if (chapters.length < 3) warnings.push('YouTube shows chapters only with 3 or more');
    chapters.forEach((c, k) => { const next = chapters[k + 1]?.at ?? total; if (next - c.at < 10) warnings.push(`chapter "${c.title}" is shorter than YouTube's 10 s minimum`); });
  }

  const music = [];
  for (const [i, m] of (plan.music || []).entries()) {
    let at;
    try { at = resolveAt(m, cuts, lib, `music[${i}]`); } catch (e) { errors.push(e.message); continue; }
    const file = m.file ? rel(m.file) : join(ROOT, 'sounds', 'music', `${m.track || 'calm'}.mp3`);
    if (m.track !== 'none' && !existsSync(file)) errors.push(`music[${i}]: not found: ${m.file || m.track}`);
    music.push({ at: +at.toFixed(3), file: m.track === 'none' ? null : file, volume: m.volume ?? 0.12, name: m.track || m.file });
  }
  music.sort((a, b) => a.at - b.at);
  music.forEach((m, k) => { m.end = music[k + 1]?.at ?? total; });

  const sfx = [];
  for (const [i, s] of (plan.sfx || []).entries()) {
    try { sfx.push({ at: +resolveAt(s, cuts, lib, `sfx[${i}]`).toFixed(3), name: s.name, volume: s.volume ?? 0.5 }); } catch (e) { errors.push(e.message); }
  }
  for (const ins of inserts) if (ins.sfx && ins.kind !== 'face') sfx.push({ at: Math.max(0, ins.at - (ins.sfx === 'whoosh' ? 0.12 : 0)), name: ins.sfx, volume: 0.42, from: ins.id });
  for (const s of sfx) if (!existsSync(join(ROOT, 'sounds', 'sfx', `${s.name}.mp3`))) errors.push(`sfx "${s.name}" not in sounds/sfx/`);

  // Punch-ins: alternate framing on every Nth cut where the same clip continues (a jump cut).
  const pi = plan.punch_in === false ? null : { every: 2, zoom: 1.12, focus: [0.5, 0.42], ...(plan.punch_in || {}) };
  let k = 0;
  cuts.forEach((c, i) => {
    const jump = i > 0 && cuts[i - 1].clip === c.clip;
    if (!jump) k = 0; else k++;
    c.zoom = pi && jump && k % pi.every === pi.every - 1 ? pi.zoom : 1;
    c.focus = pi?.focus || [0.5, 0.5];
  });

  // The words that stay, on the output timeline (captions and the report).
  const words = [];
  for (const c of cuts) for (const w of lib.clips[c.clip].words) if (w.s >= c.s - 1e-3 && w.e <= c.e + 1e-3 && !FILLERS.has(bare(w.w))) words.push({ w: w.w, s: +(c.out + w.s - c.s).toFixed(3), e: +(c.out + w.e - c.s).toFixed(3) });

  const burn = plan.captions?.burn ?? (voiceOnly ? 'gaps' : false);
  return { errors, warnings, cuts, total, source, inserts, chapters, music, sfx, words, lib, voiceOnly, captions: { burn } };
}
