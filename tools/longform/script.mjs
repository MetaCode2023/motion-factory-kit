// tools/longform/script.mjs: script-first long-form videos.
//
// 1. Claude and the creator write the script together: spoken text with visual cues in [[double brackets]]
//    where each visual should land (cue grammar below, full reference in docs/LONGFORM.md).
// 2. `lintScript` checks it: runtime at speaking pace, a visual every ~15 s, valid cues.
//    `readingCopy` strips the cues for the teleprompter.
// 3. The creator records it (camera + mic, or just the mic). `planFromScript` transcribes the recording,
//    aligns it to the script word by word (re-read lines: the last take wins, earlier takes are cut), and
//    writes the edit plan with every cue anchored to the word it precedes.
//
// Cue grammar:  [[kind option: value | option: value]]   or   [[kind bare value]]
//   stat compare steps term quote bars superposition collapse deception ...  any scenes/longform/<name>.html
//   anim <scene path> | ...            any scene file
//   stock <search>                     free stock footage (Pexels) for this moment
//   clip <title> | search: | url: | from: | to:     a clip from elsewhere to pull (placeholder until saved)
//   broll <library clip> | from:       their own footage;  image <file>
//   face                               back to the speaker here (ends the previous visual)
//   music <track> [volume]             music from here;  sfx <name>   one effect on the next word
// Options on any visual: dur (seconds or auto), layout (full|side), offset, id, note.
// Animations: mark.<key>: <word> lands a beat (e.g. mark.flipAt: boom) on that spoken word.
// Lists: "items: a; b; c". Objects: "left.title: X". Pairs: "bars: Taxes=42; Rent=27".
// Steps: "steps: Title - body; Title - body". Any value may also be JSON.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ROOT, bare, fmt, seconds } from './common.mjs';

const VISUAL = new Set(['anim', 'stock', 'clip', 'broll', 'image']);
const OPTION_KEYS = new Set(['dur', 'layout', 'offset', 'id', 'note', 'sfx', 'max_dur']);
export const sceneFor = (kind) => { const f = join(ROOT, 'scenes', 'longform', `${kind}.html`); return existsSync(f) ? f : null; };

function parseValue(v) {
  v = v.trim();
  if (/^[[{]/.test(v)) { try { return JSON.parse(v); } catch {} }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}
function setPath(o, path, v) { const ks = path.split('.'); let x = o; ks.slice(0, -1).forEach((k) => { x = x[k] ??= {}; }); x[ks[ks.length - 1]] = v; }

// Template-aware list shapes, so cues stay short to write.
function shapeData(kind, data) {
  const list = (v) => (Array.isArray(v) ? v : String(v).split(';').map((s) => s.trim()).filter(Boolean));
  for (const side of ['left', 'right']) if (data[side]?.items != null) data[side].items = list(data[side].items);
  if (data.items != null) data.items = list(data.items);
  if (data.bars != null && !Array.isArray(data.bars)) data.bars = list(data.bars).map((p) => { const [l, v] = p.split('='); return { label: l.trim(), value: Number(v) }; });
  if (data.steps != null && !Array.isArray(data.steps)) data.steps = list(data.steps).map((p) => { const [a, ...b] = p.split(/\s+[-–—]\s+/); return { title: a.trim(), body: b.join(' - ').trim() }; });
  for (const side of ['left', 'right']) if (data[side]?.cards != null && !Array.isArray(data[side].cards)) data[side].cards = String(data[side].cards).split(/[\s,]+/).filter(Boolean);
  if (data.board != null && !Array.isArray(data.board)) data.board = String(data.board).split(/[\s,]+/).filter(Boolean);
  return data;
}

export function parseCue(raw) {
  const [head, ...parts] = raw.split('|');
  const m = head.trim().match(/^(\S+)\s*(.*)$/);
  const kind0 = (m?.[1] || '').toLowerCase(), first = (m?.[2] || '').trim();
  const opts = {}, data = {};
  const firstKV = first.match(/^([\w.]+)\s*:\s*(.*)$/);
  for (const p of [...(firstKV ? [first] : []), ...parts]) {
    const kv = p.match(/^\s*([\w.]+)\s*:\s*([\s\S]*)$/);
    if (!kv) continue;
    if (OPTION_KEYS.has(kv[1])) opts[kv[1]] = parseValue(kv[2]); else setPath(data, kv[1], parseValue(kv[2]));
  }
  if (opts.layout && !['full', 'side'].includes(opts.layout)) { data.layout = opts.layout; delete opts.layout; }   // e.g. story's layout: loop
  const arg = firstKV ? '' : first;
  let kind = kind0, scene = null;
  if (kind0 === 'anim') { scene = arg; kind = 'anim'; }
  else if (!['stock', 'clip', 'pull', 'broll', 'image', 'face', 'music', 'sfx', 'chapter'].includes(kind0)) {
    scene = sceneFor(kind0) ? `scenes/longform/${kind0}.html` : null; kind = 'anim';
    if (!scene) return { kind: 'unknown', name: kind0, raw };
  }
  if (kind === 'pull') kind = 'clip';
  return { kind, scene, arg, opts, data: kind === 'anim' ? shapeData(basename(scene || '', '.html'), data) : data, raw };
}

// Script text -> spoken words, cues (each pinned to the index of the next spoken word), chapters, meta.
export function parseScript(text) {
  const meta = {};
  let body = text.replace(/\r/g, '');
  const fm = body.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) { for (const l of fm[1].split('\n')) { const kv = l.match(/^(\w+)\s*:\s*(.*)$/); if (kv) meta[kv[1]] = parseValue(kv[2]); } body = body.slice(fm[0].length); }
  const words = [], cues = [], chapters = [];
  for (const line of body.split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('//') || l.startsWith('>')) continue;   // notes for the writer, not read aloud
    if (/^#\s/.test(l)) { meta.title ??= l.replace(/^#\s+/, ''); continue; }
    if (/^##+\s/.test(l)) { chapters.push({ title: l.replace(/^#+\s+/, '').trim(), word: words.length }); continue; }
    const re = /\[\[([\s\S]*?)\]\](?!\])/g;
    let last = 0, m;
    const pushText = (s) => { for (const w of s.replace(/[*_`]/g, '').split(/\s+/).filter(Boolean)) if (bare(w)) words.push({ w, b: bare(w) }); };
    while ((m = re.exec(l))) { pushText(l.slice(last, m.index)); cues.push({ ...parseCue(m[1]), word: words.length }); last = re.lastIndex; }
    pushText(l.slice(last));
  }
  return { meta, words, cues, chapters };
}

export function readingCopy(text) {
  const { meta } = parseScript(text);
  const out = [meta.title ? meta.title.toUpperCase() + '\n' : ''];
  let body = text.replace(/\r/g, '').replace(/^---\n[\s\S]*?\n---\n/, '');
  for (const line of body.split('\n')) {
    const l = line.trim();
    if (l.startsWith('//') || l.startsWith('>') || /^#\s/.test(l)) continue;
    if (/^##+\s/.test(l)) { out.push(`\n— ${l.replace(/^#+\s+/, '')} —\n`); continue; }
    const s = l.replace(/\[\[[\s\S]*?\]\](?!\])/g, '').replace(/[*_`]/g, '').replace(/\s{2,}/g, ' ').trim();
    out.push(s);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function lintScript(text, { wpm } = {}) {
  const S = parseScript(text);
  const pace = wpm || S.meta.wpm || 150, cadence = S.meta.cadence || 15;
  const tAt = (wi) => (wi / pace) * 60;
  const errors = [], warnings = [];
  const runtime = tAt(S.words.length);
  for (const c of S.cues) {
    if (c.kind === 'unknown') errors.push(`[[${c.raw}]]: "${c.name}" is not a cue kind or a scene in scenes/longform/`);
    if (c.kind === 'anim' && c.scene && !existsSync(join(ROOT, c.scene))) errors.push(`[[${c.raw}]]: scene not found: ${c.scene}`);
    if (c.kind === 'stock' && !c.arg && !c.data.search) errors.push(`[[${c.raw}]]: stock needs a search`);
    if (c.kind === 'clip' && !c.arg && !c.data.title) errors.push(`[[${c.raw}]]: clip needs a title`);
    if (c.kind === 'anim' && /stat\.html$/.test(c.scene || '') && c.data.value == null) errors.push(`[[${c.raw}]]: stat needs value`);
    if (c.word >= S.words.length && !['music', 'sfx'].includes(c.kind)) warnings.push(`[[${c.raw}]] is after the last spoken word`);
  }
  const vis = S.cues.filter((c) => VISUAL.has(c.kind)).map((c) => tAt(c.word));
  const gaps = [], stretch = [];
  [0, ...vis, runtime].forEach((t, i, a) => { if (i) { gaps.push(t - a[i - 1]); if (t - a[i - 1] > cadence * 1.8) stretch.push(`${fmt(a[i - 1])}–${fmt(t)}`); } });
  if (vis.length && vis[0] > 12) warnings.push(`first visual at ~${fmt(vis[0])}: open with one in the first 10 s`);
  if (stretch.length) warnings.push(`no visual for a long stretch (target every ~${cadence}s): ${stretch.join(', ')}`);
  const words = S.words.length;
  if (runtime > 12 * 60) warnings.push(`~${fmt(runtime)} at ${pace} wpm: long for a 10-minute video`);
  if (!S.chapters.length) warnings.push('no chapters (## headings): YouTube chapters help retention and search');
  const kinds = {};
  for (const c of S.cues) { const k = c.kind === 'anim' ? basename(c.scene || 'anim', '.html') : c.kind; kinds[k] = (kinds[k] || 0) + 1; }
  return { ok: !errors.length, errors, warnings, title: S.meta.title || '', words, runtime: +runtime.toFixed(1), pace,
    visuals: vis.length, every: vis.length ? +(runtime / vis.length).toFixed(1) : null, longestGap: gaps.length ? +Math.max(...gaps).toFixed(1) : null,
    chapters: S.chapters.map((c) => `${fmt(tAt(c.word))} ${c.title}`), cues: kinds };
}

// ---- alignment: script words <-> recording transcript (semi-global, later takes preferred) ----------
const lev1 = (a, b) => {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return e + (a.length - i) + (b.length - j) <= 1;
};
const NUM = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
const norm = (w) => NUM[w] || w.replace(/'s$/, '').replace(/^(\d+),?(\d*)$/, '$1$2');
function sim(a, b) {
  a = norm(a); b = norm(b);
  if (a === b) return 3;
  if (a.length >= 5 && b.length >= 5 && (lev1(a, b) || a.slice(0, 5) === b.slice(0, 5))) return 2;
  return -2;
}

export function align(script, trans) {
  const n = script.length, m = trans.length, GAP = -1;
  const W = m + 1;
  const score = new Int32Array((n + 1) * W), back = new Uint8Array((n + 1) * W);   // 1 diag, 2 up (skip script), 3 left (skip transcript)
  for (let i = 1; i <= n; i++) { score[i * W] = i * GAP; back[i * W] = 2; }
  for (let j = 1; j <= m; j++) { score[j] = 0; back[j] = 3; }                     // free leading transcript
  for (let i = 1; i <= n; i++) {
    const a = script[i - 1];
    for (let j = 1; j <= m; j++) {
      const d = score[(i - 1) * W + j - 1] + sim(a, trans[j - 1]);
      const u = score[(i - 1) * W + j] + GAP;
      const l = score[i * W + j - 1] + (i === n ? 0 : GAP);                          // free trailing transcript
      let best = d, b = 1;
      if (u > best) { best = u; b = 2; }
      if (l > best) { best = l; b = 3; }
      score[i * W + j] = best; back[i * W + j] = b;
    }
  }
  let i = n, j = m;
  const map = new Int32Array(n).fill(-1);
  while (i > 0 && j > 0) {
    const b = back[i * W + j];
    if (b === 1) { if (sim(script[i - 1], trans[j - 1]) > 0) map[i - 1] = j - 1; i--; j--; }
    else if (b === 2) i--;
    else j--;
  }
  return map;
}

// Transcript words no script word matched, grouped into runs, labelled retake (a re-read of the lines
// that follow) or ad-lib.
export function strayRuns(map, scriptB, transWords) {
  const used = new Set(map.filter((x) => x >= 0));
  const runs = [];
  let cur = null;
  transWords.forEach((w, j) => { if (!used.has(j)) { if (!cur || cur.to !== j - 1) runs.push(cur = { from: j, to: j }); else cur.to = j; } });
  const firstMatched = Math.min(...[...used]), lastMatched = Math.max(...[...used]);
  for (const r of runs) {
    const ws = transWords.slice(r.from, r.to + 1).map((w) => norm(bare(w.w))).filter(Boolean);
    r.text = transWords.slice(r.from, r.to + 1).map((w) => w.w).join(' ');
    r.edge = r.to < firstMatched ? 'before' : r.from > lastMatched ? 'after' : '';
    // The script words matched right after this run: a retake repeats them.
    const nextJ = r.to + 1, si = map.indexOf(nextJ);
    const ahead = si >= 0 ? scriptB.slice(si, si + ws.length + 4).map(norm) : [];
    const hit = ws.filter((w) => ahead.includes(w)).length;
    r.retake = ws.length >= 2 && hit / ws.length >= 0.5;
  }
  return runs;
}

// Recording + script -> plan object. clip = the library entry of the recording.
export function planFromScript(text, clip, { name } = {}) {
  const S = parseScript(text);
  const map = align(S.words.map((w) => w.b), clip.words.map((w) => bare(w.w)));
  const runs = strayRuns(map, S.words.map((w) => w.b), clip.words);
  const matched = map.filter((x) => x >= 0).length;
  const timeOf = (wi) => {   // the first matched spoken word at or after script word wi
    for (let k = wi; k < map.length; k++) if (map[k] >= 0) return { t: clip.words[map[k]].s, exact: k === wi };
    return null;
  };
  const warnings = [];
  const anchor = (wi, what) => { const r = timeOf(wi); if (!r) { warnings.push(`${what}: no recorded words after it`); return null; } if (!r.exact) warnings.push(`${what}: its word wasn't found in the recording, placed on the next one`); return `${clip.id}@${r.t.toFixed(3)}`; };

  const first = clip.words[map.find((x) => x >= 0)] || clip.words[0];
  const lastIdx = Math.max(...map);
  const last = clip.words[lastIdx >= 0 ? lastIdx : clip.words.length - 1];
  const cut = runs.filter((r) => r.retake && !r.edge).map((r) => ({ at: `${clip.id}@${Math.max(0, clip.words[r.from].s - 0.01).toFixed(3)}`, text: r.text }));
  const adlibs = runs.filter((r) => !r.retake && !r.edge && r.to - r.from >= 2);

  const theme = S.meta.theme && typeof S.meta.theme === 'object' ? S.meta.theme : undefined;
  const plan = {
    name: name || S.meta.name || (S.meta.title ? S.meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : clip.id),
    title: S.meta.title || clip.id,
    from_script: true,
    ...(theme ? { theme } : {}),
    ...(S.meta.base ? { base: S.meta.base } : {}),
    a_roll: [{ clip: clip.id, from: +Math.max(0, first.s - 0.3).toFixed(3), to: +Math.min(clip.duration, last.e + 0.4).toFixed(3) }],
    tighten: { fillers: true, max_pause: S.meta.max_pause ?? 0.45, cut },
    ...(S.meta.punch_in ? { punch_in: S.meta.punch_in } : {}),
    chapters: [], inserts: [], music: [], sfx: [],
  };
  S.chapters.forEach((ch) => { const at = anchor(ch.word, `chapter "${ch.title}"`); if (at) plan.chapters.push({ at, title: ch.title }); });
  let n = 0;
  for (const c of S.cues) {
    const what = `[[${c.raw.trim().slice(0, 40)}]]`;
    const at = anchor(c.word, what);
    if (!at) continue;
    const common = { at, offset: c.opts.offset ?? -0.12, ...(c.opts.layout ? { layout: c.opts.layout } : {}), ...(c.opts.note ? { note: c.opts.note } : {}), ...(c.opts.sfx !== undefined ? { sfx: c.opts.sfx } : {}) };
    const dur = c.opts.dur ?? 'auto';
    const id = c.opts.id || `${String(++n).padStart(2, '0')}-${c.kind === 'anim' ? basename(c.scene || 'anim', '.html') : c.kind}`;
    // mark.<key>: <word> -> that spoken word (the first after the cue) sets data.<key> in seconds into the animation.
    const marks = {};
    if (c.kind === 'anim' && c.data.mark) {
      for (const [key, word] of Object.entries(c.data.mark)) {
        const wi = S.words.findIndex((w, k) => k >= c.word && w.b === bare(String(word)));
        const a = wi >= 0 ? anchor(wi, `${what} mark ${key}`) : null;
        if (a) marks[key] = { at: a }; else if (wi < 0) warnings.push(`${what}: mark word "${word}" not in the script after the cue`);
      }
      delete c.data.mark;
    }
    if (c.kind === 'anim') plan.inserts.push({ id, kind: 'animation', scene: c.scene, data: c.data, ...(Object.keys(marks).length ? { marks } : {}), dur, ...(c.opts.max_dur ? { max_dur: c.opts.max_dur } : {}), ...common });
    else if (c.kind === 'stock') plan.inserts.push({ id, kind: 'broll', stock: c.arg || c.data.search, dur, ...common });
    else if (c.kind === 'clip') plan.inserts.push({ id, kind: 'pull', title: c.arg || c.data.title, search: c.data.search || c.arg, url: c.data.url, from: c.data.from, to: c.data.to, ...(c.data.audio ? { audio: Number(c.data.audio) } : {}), dur, ...common });
    else if (c.kind === 'broll') plan.inserts.push({ id, kind: 'broll', clip: c.arg || c.data.clip, from: c.data.from, dur, ...common });
    else if (c.kind === 'image') plan.inserts.push({ id, kind: 'image', file: c.arg || c.data.file, dur, ...common });
    else if (c.kind === 'face') plan.inserts.push({ id, kind: 'face', ...common, offset: 0 });
    else if (c.kind === 'music') { const [track, vol] = (c.arg || '').split(/\s+/); plan.music.push({ at: plan.music.length ? at : 0, track: track || c.data.track || 'calm', volume: Number(vol || c.data.volume || 0.09) }); }
    else if (c.kind === 'sfx') plan.sfx.push({ at, name: c.arg || c.data.name, volume: c.data.volume ?? 0.5, offset: c.opts.offset ?? 0 });
  }
  if (!plan.music.length) plan.music.push({ at: 0, track: 'calm', volume: 0.08 });
  const report = {
    scriptWords: S.words.length, matched, coverage: +(matched / Math.max(1, S.words.length)).toFixed(3),
    retakesCut: cut.map((c) => c.text), adlibsKept: adlibs.map((r) => `${fmt(clip.words[r.from].s)} "${r.text}"`),
    missing: missingLines(S, map), warnings,
  };
  return { plan, report };
}

// Script sentences with most words unmatched (skipped or badly misread while recording).
function missingLines(S, map) {
  const out = [];
  let start = 0;
  S.words.forEach((w, i) => {
    if (/[.?!]$/.test(w.w) || i === S.words.length - 1) {
      const seg = map.slice(start, i + 1), miss = seg.filter((x) => x < 0).length;
      if (seg.length >= 4 && miss / seg.length > 0.5) out.push(S.words.slice(start, i + 1).map((x) => x.w).join(' '));
      start = i + 1;
    }
  });
  return out;
}

export const loadScript = (file) => readFileSync(file, 'utf8');

// Load every animation cue's scene with its data and draw two frames, so a bad field (a list written as
// text, a typo'd key) shows up now, while writing, not 20 minutes into a build.
export async function tryScenes(text, { log = () => {} } = {}) {
  const { open } = await import('../../engines/skia.mjs');
  const S = parseScript(text), errors = [];
  for (const c of S.cues) {
    if (c.kind !== 'anim' || !c.scene || !existsSync(join(ROOT, c.scene))) continue;
    const dur = Number(c.opts.dur) || 6;
    try {
      const e = await open(join(ROOT, c.scene), { data: { ...(S.meta.theme || {}), ...c.data, dur } });
      e.frame(Math.min(1, dur / 3)); e.frame(dur * 0.8);
      await e.close?.();
    } catch (err) { errors.push(`[[${c.raw.trim().slice(0, 60)}]]: ${String(err.message || err).split('\n')[0]}`); }
  }
  log(`  ${S.cues.filter((c) => c.kind === 'anim').length} animations drawn`);
  return errors;
}
export { seconds };
