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
// Header: music: <track> [volume] (the bed under the whole video; default calm 0.1), sound: lively | calm | off
// Options on any visual: dur (seconds or auto), layout (full|side|pip|split), offset, id, note.
// Animations: mark.<key>: <word> lands a beat (e.g. mark.flipAt: boom) on that spoken word.
// Lists: "items: a; b; c". Objects: "left.title: X". Pairs: "bars: Taxes=42; Rent=27".
// Steps: "steps: Title - body; Title - body". Any value may also be JSON.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ROOT, bare, fmt, seconds } from './common.mjs';

const VISUAL = new Set(['anim', 'stock', 'clip', 'broll', 'image']);
const OPTION_KEYS = new Set(['dur', 'layout', 'offset', 'id', 'note', 'sfx', 'max_dur', 'transition']);
// A cue name is a scene file: scenes/longform/<name>.html (2D) or scenes/longform/3d/<name>.html (3D, three.js).
export const sceneFor = (kind) => ['', '3d/'].map((d) => `scenes/longform/${d}${kind}.html`).find((f) => existsSync(join(ROOT, f))) || null;

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
  if (opts.layout && !['full', 'side', 'pip', 'split'].includes(opts.layout)) { data.layout = opts.layout; delete opts.layout; }   // e.g. story's layout: loop
  const arg = firstKV ? '' : first;
  let kind = kind0, scene = null;
  if (kind0 === 'anim') { scene = arg; kind = 'anim'; }
  else if (!['stock', 'clip', 'pull', 'broll', 'image', 'face', 'music', 'sfx', 'chapter'].includes(kind0)) {
    scene = sceneFor(kind0); kind = 'anim';
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
  // Figures on screen need a source the viewer (and the creator) can check.
  const FIGURES = /(stat|bars|line|share|count|timeline|stacks3d)\.html$/;
  const unsourced = S.cues.filter((c) => c.kind === 'anim' && FIGURES.test(c.scene || '') && !c.data.source);
  if (unsourced.length) warnings.push(`${unsourced.length} visual(s) show figures with no source: ${unsourced.slice(0, 4).map((c) => `[[${c.raw.slice(0, 40)}…]]`).join(', ')}${unsourced.length > 4 ? ', …' : ''} (add source: "who, year")`);
  const kinds = {};
  for (const c of S.cues) { const k = c.kind === 'anim' ? basename(c.scene || 'anim', '.html') : c.kind; kinds[k] = (kinds[k] || 0) + 1; }
  return { ok: !errors.length, errors, warnings, title: S.meta.title || '', words, runtime: +runtime.toFixed(1), pace,
    visuals: vis.length, every: vis.length ? +(runtime / vis.length).toFixed(1) : null, longestGap: gaps.length ? +Math.max(...gaps).toFixed(1) : null,
    chapters: S.chapters.map((c) => `${fmt(tAt(c.word))} ${c.title}`), cues: kinds, retention: retention(S, pace), depth: depth(S) };
}

// ---- retention: the places a viewer is most likely to leave, found before anything is recorded --------
// Heuristics, not rules: each note says where and why; fix it or decide it's fine.
export function retention(S, pace = 150) {
  const tAt = (wi) => (wi / pace) * 60, notes = [];
  const sents = [];
  let from = 0;
  S.words.forEach((w, i) => { if (/[.?!]["')\]]*$/.test(w.w) || i === S.words.length - 1) { sents.push({ from, to: i, n: i - from + 1, text: S.words.slice(from, i + 1).map((x) => x.w).join(' '), q: /\?["')\]]*$/.test(w.w) }); from = i + 1; } });
  if (!sents.length) return { score: 0, notes: ['no spoken words'] };
  const has = (text, re) => re.test(text.toLowerCase());
  // 1. The hook: the first ~10 s must give a reason to stay.
  const hookWords = Math.round(pace / 6), hook = S.words.slice(0, hookWords).map((x) => x.w).join(' ');
  if (has(sents[0].text, /^(hey|hi|hello|welcome|what's up|so,? today|in this video|today (we|i)|my name is)/)) notes.push(`hook: opens with a greeting or "in this video" ("${sents[0].text.slice(0, 50)}…"): open on the claim, the question or the number instead`);
  else if (!has(hook, /\?|\d|\byou(r|'re)?\b|\b(never|nobody|secret|wrong|lie|why|isn't|aren't|don't|not)\b/)) notes.push(`hook: the first 10 s ("${hook.slice(0, 60)}…") has no question, number, "you" or surprise: give a reason to stay`);
  if (sents[0].n > 22) notes.push(`hook: the first sentence is ${sents[0].n} words: make the first line short enough to land in one breath`);
  // 2. A promise: by 45 s the viewer should know what they get for staying.
  const early = S.words.slice(0, Math.round(pace * 0.75)).map((x) => x.w).join(' ');
  if (!has(early, /by the end|in (a|the next) (minute|few)|i'll show|we'll (see|get to|find)|you'll (see|know|understand|learn)|stick|stay|here's (why|how|what)|the (real )?reason|turns out|but first|later/)) notes.push('promise: nothing in the first 45 s says what the viewer gets by staying ("by the end you\'ll…", "here\'s why…")');
  // 3. Re-hooks: a question or a turn at least every ~90 s.
  let last = 0;
  const turns = sents.filter((s) => s.q || has(s.text, /^(but|except|here's the (thing|problem|twist)|now|so why|and yet|the problem|it gets (worse|better|stranger))/)).map((s) => tAt(s.from));
  for (const t of [...turns, tAt(S.words.length)]) { if (t - last > 95) notes.push(`re-hook: ${fmt(last)}–${fmt(t)} has no question or turn ("but…", "here's the thing…"): give the viewer a reason to keep going`); last = t; }
  // 4. Sentences that are hard to say (and to follow) out loud.
  const long = sents.filter((s) => s.n > 34);
  if (long.length) notes.push(`${long.length} sentence(s) over 34 words (at ${long.slice(0, 3).map((s) => fmt(tAt(s.from))).join(', ')}): split them, they're hard to say and to follow`);
  const avg = S.words.length / sents.length;
  if (avg > 19) notes.push(`sentences average ${avg.toFixed(0)} words: written for the page, not the mouth (aim for 12-16)`);
  // 5. Chapters: none too long, none too thin.
  const ch = S.chapters.map((c, i) => ({ title: c.title, len: tAt((S.chapters[i + 1]?.word ?? S.words.length) - c.word), at: tAt(c.word) }));
  ch.filter((c) => c.len > 170).forEach((c) => notes.push(`chapter "${c.title}" runs ${fmt(c.len)}: split it or cut it (over ~2:45 the middle sags)`));
  ch.filter((c) => c.len < 25).forEach((c) => notes.push(`chapter "${c.title}" is only ${Math.round(c.len)} s: merge it into its neighbour`));
  // 6. Visuals: not two of the same in a row, not mostly words.
  const anims = S.cues.filter((c) => c.kind === 'anim').map((c) => ({ name: basename(c.scene || '', '.html'), t: tAt(c.word) }));
  const twice = anims.filter((a, i) => i && a.name === anims[i - 1].name);
  if (twice.length) notes.push(`same visual twice in a row: ${twice.slice(0, 4).map((a) => `${a.name} at ${fmt(a.t)}`).join(', ')}`);
  const vis = S.cues.filter((c) => VISUAL.has(c.kind)).length, wordy = anims.filter((a) => ['quote', 'term', 'compare', 'steps'].includes(a.name)).length;
  if (vis >= 8 && wordy / vis > 0.3) notes.push(`${wordy} of ${vis} visuals are mostly words (quote, term, compare, steps): show more (story, count, 3D, stock, charts)`);
  // 7. The ending: stop on the point, then say where to go next.
  const end = S.words.slice(-Math.round(pace / 3)).map((x) => x.w).join(' ');
  if (!has(end, /next|watch|subscribe|link|comment|see you|part two|part 2|video/)) notes.push('ending: the last 20 s never says what to watch or do next');
  return { score: Math.max(0, 100 - 9 * notes.length), notes };
}

// ---- depth: does the script teach the idea, or only describe that it exists? ----------------------------
// The standard is docs/PLAYBOOK.md "Depth". These are the signs of a surface-level script that can be found
// by reading the words; each note says what is missing. Heuristics, not rules: fix it or decide it's fine.
const STOCK_PHRASES = ["in today's world", "in today's fast-paced", 'game changer', 'game-changer', 'mind-blowing', 'mind blowing', 'blow your mind', "it's important to note", 'it is important to note',
  'at the end of the day', 'since the dawn of time', 'throughout history', 'let that sink in', 'buckle up', 'dive in', 'deep dive', 'delve', 'the truth is', 'believe it or not', 'simply put',
  'scientists say', 'experts say', 'experts agree', 'studies show', 'research shows', 'some people say', 'many people believe', 'revolutionize', 'revolutionary', 'unlock the secrets', 'has fascinated',
  'fascinating world', 'incredible world', 'complex topic', 'in conclusion', 'needless to say', 'as we all know', 'changed everything', 'the world of'];
export function depth(S) {
  const text = S.words.map((w) => w.w).join(' '), low = text.toLowerCase().replace(/[’]/g, "'"), n = S.words.length;
  if (n < 40) return { score: 100, notes: [] };
  const notes = [], per1000 = (k) => (k / n) * 1000;
  const any = (re) => re.test(low);
  // 1. A spine, written down before the script: what it argues, what it is up against, what it connects to.
  for (const [key, what] of [['thesis', 'the one claim the video argues, in a sentence'], ['tension', 'the competing answers and why smart people disagree'], ['bridge', 'the other field or part of life this idea turns out to explain']])
    if (!S.meta[key]) notes.push(`no "${key}:" in the header (${what})`);
  // 2. Names: who found it, which experiment, what year, what it is called.
  const names = new Set();
  S.words.forEach((w, i) => { const prev = S.words[i - 1]?.w || '.'; const raw = w.w.replace(/^["'(]+/, ''); if (/^[A-Z][a-z]{2,}/.test(raw) && !/[.?!:]["')\]]*$/.test(prev)) names.add(raw.replace(/[^A-Za-z-]/g, '').replace(/s$/, '')); });
  const years = (text.match(/\b(1[5-9]\d\d|20\d\d)\b/g) || []).length;
  if (per1000(names.size + years) < 8) notes.push(`${names.size} named people, ideas or places and ${years} date(s) in ${n} words: say who worked it out, which experiment, what year, what it's called`);
  // 3. More than one view, and what each costs.
  if (!any(/\b(interpretations?|argue[sd]?|according to|on the other hand|critics?|disagree[sd]?|versus|objections?|rivals?|debates?|others (think|say|believe)|competing|alternative|camp|school of thought|was wrong|turned out)\b/)) notes.push('one view only: name the competing explanations and what each one costs you to believe');
  // 4. How we know.
  if (!any(/\b(experiments?|measur(e|ed|ing|ement)s?|evidence|tested|observ(e|ed|ation)s?|data|prov(e|ed|en)|predict(s|ed|ion)?|derive[sd]?|showed|demonstrated|confirmed|detected)\b/)) notes.push('never says how we know: the experiment, the measurement, the prediction that came true');
  // 5. Where the knowledge stops.
  if (!any(/\b(nobody knows|no one knows|we don't know|don't yet know|still (don't|open|unsolved|argue|debated)|unsolved|unresolved|open question|remains? (a mystery|open|unclear)|not settled|unanswered|no agreement)\b/)) notes.push("no open question: say where the knowledge stops and what's still argued about");
  // 6. What it means for the person watching.
  if (!any(/\b(which means|what (this|that|it) means|this matters|that's why|the reason (this|that|it) matters|changes how|so the next time|for you\b|in your (own )?(life|head|day)|you are|you're (not|made|also|doing))\b/)) notes.push('never says what the idea means for the person watching (the "so what")');
  // 7. Phrases that could be in any video on any subject.
  const stock = STOCK_PHRASES.filter((p) => low.includes(p));
  if (stock.length) notes.push(`${stock.length} stock phrase(s) that could be in any video: ${stock.slice(0, 6).map((p) => `"${p}"`).join(', ')}: replace each with the specific thing`);
  return { score: Math.max(0, 100 - 12 * notes.length), notes };
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

  const theme = themeOf(S.meta.theme);
  const transitions = typeof S.meta.transitions === 'string' && S.meta.transitions.includes(',') ? S.meta.transitions.split(',').map((x) => x.trim()) : S.meta.transitions;
  const plan = {
    name: name || S.meta.name || (S.meta.title ? S.meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : clip.id),
    title: S.meta.title || clip.id,
    from_script: true,
    ...(theme ? { theme } : {}),
    ...(transitions ? { transitions } : {}),
    ...(S.meta.base ? { base: S.meta.base } : {}),
    a_roll: [{ clip: clip.id, from: +Math.max(0, first.s - 0.3).toFixed(3), to: +Math.min(clip.duration, last.e + 0.4).toFixed(3) }],
    tighten: { fillers: true, max_pause: S.meta.max_pause ?? 0.45, cut },
    ...(S.meta.punch_in ? { punch_in: S.meta.punch_in } : {}),
    ...(S.meta.sound !== undefined ? { sound: S.meta.sound } : {}),
    chapters: [], inserts: [], music: [], sfx: [],
  };
  S.chapters.forEach((ch) => { const at = anchor(ch.word, `chapter "${ch.title}"`); if (at) plan.chapters.push({ at, title: ch.title }); });
  let n = 0;
  for (const c of S.cues) {
    const what = `[[${c.raw.trim().slice(0, 40)}]]`;
    const at = anchor(c.word, what);
    if (!at) continue;
    const common = { at, offset: c.opts.offset ?? -0.12, ...(c.opts.layout ? { layout: c.opts.layout } : {}), ...(c.opts.note ? { note: c.opts.note } : {}), ...(c.opts.transition ? { transition: c.opts.transition } : {}), ...(c.opts.sfx !== undefined ? { sfx: c.opts.sfx } : {}) };
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
  // Music under the whole video: the header's "music: <track> [volume]" (or "none"), else the calm bed.
  if (!plan.music.length) { const [track, vol] = String(S.meta.music || 'calm').split(/\s+/); plan.music.push({ at: 0, track, volume: Number(vol || 0.1) }); }
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
    if (c.kind !== 'anim' || !c.scene || !existsSync(join(ROOT, c.scene)) || /[\\/]3d[\\/]/.test(c.scene)) continue;   // 3D scenes need Chrome: checked at build
    const dur = Number(c.opts.dur) || 6;
    try {
      const e = await open(join(ROOT, c.scene), { data: { ...(themeOf(S.meta.theme) || {}), ...c.data, dur } });
      e.frame(Math.min(1, dur / 3)); e.frame(dur * 0.8);
      await e.close?.();
    } catch (err) { errors.push(`[[${c.raw.trim().slice(0, 60)}]]: ${String(err.message || err).split('\n')[0]}`); }
  }
  log(`  ${S.cues.filter((c) => c.kind === 'anim').length} animations drawn`);
  return errors;
}
export { seconds };

// theme: blueprint  |  theme: { style, color, tint }
function themeOf(t) { return t && typeof t === 'object' ? t : typeof t === 'string' && t.trim() ? { style: t.trim() } : undefined; }
