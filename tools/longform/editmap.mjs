// tools/longform/editmap.mjs: read a raw recording the way an editor does, before anything is planned.
//
// A long whiteboard session or a rambling take is raw material, not a script. This pass turns its transcript into
// the evidence an editor reasons from: where the topics change, which lines are said more than once (keep the best
// take), false starts and table talk to cut, the lines strong enough to open on, the stretches that stand alone as
// a Short, and the terms a first-time viewer will need explained. It decides nothing by itself: Claude reads
// EDITMAP.md, makes the calls, and writes them down in the brief (docs/EDITORIAL.md) before writing a plan.
//
//   analyze(clip)        -> { stats, sections, repeats, falseStarts, fluff, hooks, shorts, terms }
//   editmapMarkdown(map) -> EDITMAP.md
//   briefTemplate(map)   -> <name>.brief.md, pre-filled with the evidence, decisions left for the editor
import { FILLERS, bare, fmt } from './common.mjs';

const STOP = new Set(("the a an and or but so to of in on at for with is it its it's that this these those i you he she we they me my your our their be was were are been being have has had do does did not no yes just like really very what when where who why how there here then than as from by about into out up down over if all any some one two can could would should will well okay ok yeah gonna got get go going know think mean thing things right lot kind sort actually basically gotta wanna let's let say said see look also even still now because something someone stuff way want need make made take much many more most them him her us every other another again first next last same different little big good great i'm you're we're they're that's there's don't doesn't didn't can't won't isn't aren't").split(' '));
const stem = (w) => w.replace(/'s$/, '').replace(/(ies)$/, 'y').replace(/(ing|ed|es|s)$/, '') || w;
const termsOf = (text) => String(text).toLowerCase().split(/[^a-z0-9']+/).map(bare).filter((w) => w && w.length > 2 && !STOP.has(w) && !FILLERS.has(w)).map(stem);
const wordsOf = (text) => String(text).split(/\s+/).filter(Boolean);
const fillerCount = (text) => wordsOf(text).filter((w) => FILLERS.has(bare(w))).length;

// Table talk: lines about the recording, not about the subject.
const META = [/\b(is (this|it) (on|recording)|can (you|everyone) (see|hear|read) (this|me|that|it|the (board|screen|camera))|hold on|one sec(ond)?|where was i|let me (start|try|say) (that |this )?(again|over)|start (that )?(again|over)|let me (just )?(erase|clean|wipe|move|grab|fix)|i lost my (train|place)|scratch that|never ?mind|sorry,? (let me|i)|take two|cut (that|this)|we'?ll (edit|cut) (that|this)|(okay|alright|all right),? (so )?(um|uh)?,? ?(where|what) was)\b/i];
// What makes a line worth opening on (cheap signals; the editor still reads them).
const HOOK = [
  [/\b(\d[\d,.]*|hundred|thousand|million|billion|trillion|percent|half|twice|ten times)\b/i, 2, 'a number'],
  [/\b(most people|everyone|nobody|no one|you'?ve been told|the truth|secret|actually|wrong|myth|lie|backwards|opposite|turns out|surprising|weird|strange|crazy|impossible|paradox)\b/i, 2, 'a turn'],
  [/\?$/, 1.5, 'a question'],
  [/\b(never|always|only|every|nothing|all of)\b/i, 1, 'absolute'],
  [/\b(imagine|picture this|what if|here'?s the thing|the reason|why)\b/i, 1, 'pulls forward'],
  [/\b(universe|reality|simulation|infinite|quantum|time|death|consciousness|money|god)\b/i, 1, 'big stakes'],
];
// Lines that only work after something else (bad openers, bad Short starts).
const DEPENDENT = /^(and|but|so|because|which|that|then|also|or|like i said|as i said|this is why|that'?s why|it|they|he|she|this|these|those)\b/i;
const DEFINES = /\b(is called|called|means|is when|is basically|is just|is the idea|stands for|defined as|in other words|think of it as)\b/i;

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) { na += v * v; if (b.has(k)) dot += v * b.get(k); }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
const bag = (sents) => { const m = new Map(); for (const s of sents) for (const t of s.terms) m.set(t, (m.get(t) || 0) + 1); return m; };
const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); let n = 0; for (const x of A) if (B.has(x)) n++; return n / (A.size + B.size - n || 1); };

export function analyze(clip, { window = 6, minSection = 45, maxShort = 55, minShort = 20 } = {}) {
  const sents = clip.sentences.map((s) => {
    const text = s.text.trim();
    return { n: s.n, s: s.s, e: s.e, text, words: wordsOf(text).length, fillers: fillerCount(text), terms: termsOf(text) };
  });
  const dur = clip.duration || (sents.length ? sents[sents.length - 1].e : 0);
  const df = new Map();
  for (const s of sents) for (const t of new Set(s.terms)) df.set(t, (df.get(t) || 0) + 1);

  // ---- sections: where the vocabulary on either side of a sentence boundary stops overlapping (TextTiling, lite)
  const gaps = [];
  for (let i = 1; i < sents.length; i++) {
    const left = bag(sents.slice(Math.max(0, i - window), i)), right = bag(sents.slice(i, i + window));
    gaps.push({ i, sim: cosine(left, right), pause: sents[i].s - sents[i - 1].e });
  }
  const depth = gaps.map((g, k) => {
    let l = g.sim, r = g.sim;
    for (let j = k; j >= 0; j--) l = Math.max(l, gaps[j].sim);
    for (let j = k; j < gaps.length; j++) r = Math.max(r, gaps[j].sim);
    return { ...g, depth: (l - g.sim) + (r - g.sim) + Math.min(g.pause, 4) * 0.05 };
  });
  const cuts = [];
  for (const d of [...depth].sort((a, b) => b.depth - a.depth)) {
    if (d.depth < 0.25) break;
    const t = sents[d.i].s;
    if ([0, ...cuts.map((i) => sents[i].s), dur].some((x) => Math.abs(x - t) < minSection)) continue;
    cuts.push(d.i);
  }
  cuts.sort((a, b) => a - b);
  const bounds = [0, ...cuts, sents.length];
  const sections = bounds.slice(0, -1).map((from, k) => {
    const part = sents.slice(from, bounds[k + 1]);
    if (!part.length) return null;
    const tf = bag(part);
    const top = [...tf].filter(([t]) => t.length > 3).map(([t, n]) => [t, n * Math.log(1 + sents.length / (df.get(t) || 1))]).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
    const words = part.reduce((a, s) => a + s.words, 0), fill = part.reduce((a, s) => a + s.fillers, 0);
    return { k: k + 1, from: part[0].n, to: part[part.length - 1].n, s: part[0].s, e: part[part.length - 1].e, topics: top, fillerRate: words ? +(fill / words).toFixed(3) : 0, first: part[0].text };
  }).filter(Boolean);

  // ---- repeats: the same point made twice or more (a retake, or circling back). Keep the cleanest, fullest take.
  const repeats = [], inCluster = new Set();
  for (let i = 0; i < sents.length; i++) {
    if (inCluster.has(i) || sents[i].terms.length < 4) continue;
    const group = [i];
    for (let j = i + 1; j < sents.length; j++) {
      if (inCluster.has(j) || sents[j].terms.length < 4) continue;
      if (jaccard(sents[i].terms, sents[j].terms) >= 0.5) group.push(j);
    }
    if (group.length < 2) continue;
    group.forEach((g) => inCluster.add(g));
    const takes = group.map((g) => sents[g]);
    const score = (s) => s.terms.length - s.fillers * 1.5 + (/[.?!]$/.test(s.text) ? 1 : 0) + (s === takes[takes.length - 1] ? 0.5 : 0);
    const best = [...takes].sort((a, b) => score(b) - score(a))[0];
    repeats.push({ keep: best.n, drop: takes.filter((t) => t !== best).map((t) => t.n), takes: takes.map((t) => ({ n: t.n, s: t.s, text: t.text })), retake: takes.every((t, k) => !k || t.s - takes[k - 1].e < 30) });
  }

  // ---- false starts: a short broken line, then a restart on the same words
  const falseStarts = [];
  for (let i = 0; i < sents.length - 1; i++) {
    const a = sents[i], b = sents[i + 1];
    const aw = wordsOf(a.text).map(bare).filter((w) => w && !FILLERS.has(w)), bw = wordsOf(b.text).map(bare).filter((w) => w && !FILLERS.has(w));
    if (aw.length && aw.length <= 8 && bw.length > aw.length && aw.slice(0, 2).join(' ') === bw.slice(0, 2).join(' ')) falseStarts.push({ n: a.n, s: a.s, text: a.text, restart: b.n });
    else if (aw.length <= 4 && !/[.?!]$/.test(a.text) && b.s - a.e < 1.5 && termsOf(a.text).every((t) => b.terms.includes(t)) && termsOf(a.text).length) falseStarts.push({ n: a.n, s: a.s, text: a.text, restart: b.n });
  }

  // ---- fluff: table talk, filler-heavy lines, lines with nothing in them
  const fluff = [];
  for (const s of sents) {
    const why = META.some((r) => r.test(s.text)) ? 'about the recording, not the subject'
      : s.words >= 5 && s.fillers / s.words > 0.25 ? 'mostly filler'
      : s.words >= 4 && !s.terms.length ? 'no content words' : null;
    if (why) fluff.push({ n: s.n, s: s.s, text: s.text, why });
  }
  const cutSet = new Set([...repeats.flatMap((r) => r.drop), ...falseStarts.map((f) => f.n), ...fluff.map((f) => f.n)]);

  // ---- hooks: lines that could open the video (wherever they were said)
  const hookOf = (s) => {
    if (s.words < 6 || s.words > 28 || cutSet.has(s.n)) return null;
    let score = 0; const why = [];
    for (const [re, w, label] of HOOK) if (re.test(s.text)) { score += w; why.push(label); }
    if (DEPENDENT.test(s.text)) { score -= 1.5; why.push('leans on the line before'); }
    score -= s.fillers;
    score += Math.min(2, s.terms.filter((t) => (df.get(t) || 0) <= 2).length * 0.5);   // says something specific
    return score > 1.5 ? { n: s.n, s: s.s, text: s.text, score: +score.toFixed(1), why } : null;
  };
  const hooks = sents.map(hookOf).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8);

  // ---- Shorts: stretches of 20-55 s inside one section that open on a strong, self-contained line
  const shorts = [];
  const sectionOf = (n) => sections.find((x) => n >= x.from && n <= x.to);
  for (const h of sents.map(hookOf).filter(Boolean)) {
    if (DEPENDENT.test(h.text)) continue;
    const sec = sectionOf(h.n), start = sents.findIndex((s) => s.n === h.n);
    let end = start, cut = 0;
    while (end + 1 < sents.length && sents[end + 1].n <= sec.to && sents[end + 1].e - h.s <= maxShort) { end++; if (cutSet.has(sents[end].n)) cut += sents[end].e - sents[end].s; }
    const len = sents[end].e - h.s - cut;
    if (len < minShort) continue;
    const part = sents.slice(start, end + 1).filter((s) => !cutSet.has(s.n));
    const density = part.reduce((a, s) => a + s.terms.length, 0) / Math.max(1, len);
    shorts.push({ from: h.n, to: sents[end].n, s: h.s, e: sents[end].e, length: +len.toFixed(1), opens: h.text, score: +(h.score + density).toFixed(1) });
  }
  const pickedShorts = [];
  for (const c of shorts.sort((a, b) => b.score - a.score)) {
    if (pickedShorts.some((p) => c.s < p.e && p.s < c.e)) continue;
    pickedShorts.push(c);
    if (pickedShorts.length >= 5) break;
  }

  // ---- terms a newcomer needs: specific words said repeatedly, and whether the speaker ever defines them
  const surface = new Map();
  for (const s of sents) for (const raw of wordsOf(s.text)) { const w = bare(raw); if (w.length > 4 && !STOP.has(w)) { const t = stem(w); if (!surface.has(t)) surface.set(t, raw.replace(/[^\w'-]/g, '')); } }
  const tf = bag(sents);
  const terms = [...tf].filter(([t, n]) => n >= 3 && t.length > 4 && surface.has(t)).map(([t, n]) => {
    const first = sents.find((s) => s.terms.includes(t));
    const defined = sents.find((s) => s.terms.includes(t) && DEFINES.test(s.text));
    return { term: surface.get(t), count: n, first: first.n, firstAt: first.s, defined: defined ? defined.n : null };
  }).sort((a, b) => b.count - a.count).slice(0, 12);

  const talk = sents.reduce((a, s) => a + (s.e - s.s), 0);
  const cutTime = sents.filter((s) => cutSet.has(s.n)).reduce((a, s) => a + (s.e - s.s), 0);
  const fillers = sents.reduce((a, s) => a + s.fillers, 0);
  return {
    clip: clip.id, duration: +dur.toFixed(1),
    stats: { sentences: sents.length, talking: +talk.toFixed(1), silence: +Math.max(0, dur - talk).toFixed(1), fillers, cutCandidates: cutSet.size, keepable: +Math.max(0, talk - cutTime - fillers * 0.35).toFixed(1) },
    sections, repeats, falseStarts, fluff, hooks, shorts: pickedShorts, terms,
  };
}

export function editmapMarkdown(m) {
  const a = (n) => `\`${m.clip}#${n}\``;
  const L = [`# Edit map: ${m.clip}`, '',
    `Raw ${fmt(m.duration)}: ${fmt(m.stats.talking)} of talking, ${fmt(m.stats.silence)} of silence, ${m.stats.fillers} fillers, ${m.stats.cutCandidates} lines flagged to cut.`,
    `Roughly ${fmt(m.stats.keepable)} survives a clean tighten before any editorial cuts. That is the ceiling, not the target.`, '',
    'This is evidence, not a decision. Read it, read the transcript, look at the contact sheet, then write the brief (docs/EDITORIAL.md).', '',
    '## Sections (where the subject changes)', '', '| # | Lines | Time | Topics | Filler rate | Opens with |', '|---|---|---|---|---|---|'];
  for (const s of m.sections) L.push(`| ${s.k} | #${s.from}-#${s.to} | ${fmt(s.s)}-${fmt(s.e)} | ${s.topics.join(', ')} | ${Math.round(s.fillerRate * 100)}% | ${s.first.slice(0, 70)} |`);
  L.push('', '## Hook candidates (could open the video)', '');
  if (!m.hooks.length) L.push('None scored well. The opener may need to be recorded: write it and say so in the brief.');
  m.hooks.forEach((h) => L.push(`- ${a(h.n)} [${fmt(h.s)}] (${h.score}: ${h.why.join(', ')}) "${h.text}"`));
  L.push('', '## Said more than once (keep one take)', '');
  if (!m.repeats.length) L.push('None found.');
  m.repeats.forEach((r) => { L.push(`- keep ${a(r.keep)}, drop ${r.drop.map((n) => '#' + n).join(', ')}${r.retake ? ' (retake)' : ' (circled back later)'}`); r.takes.forEach((t) => L.push(`    - #${t.n} [${fmt(t.s)}] ${t.text}`)); });
  L.push('', '## False starts', '');
  if (!m.falseStarts.length) L.push('None found.');
  m.falseStarts.forEach((f) => L.push(`- ${a(f.n)} [${fmt(f.s)}] "${f.text}" -> restarts at #${f.restart}`));
  L.push('', '## Fluff (table talk, filler, empty lines)', '');
  if (!m.fluff.length) L.push('None found.');
  m.fluff.forEach((f) => L.push(`- ${a(f.n)} [${fmt(f.s)}] ${f.why}: "${f.text}"`));
  L.push('', '## Stand-alone stretches (Short candidates)', '');
  if (!m.shorts.length) L.push('None long enough inside one section.');
  m.shorts.forEach((s) => L.push(`- #${s.from}-#${s.to} [${fmt(s.s)}-${fmt(s.e)}, ~${Math.round(s.length)} s after cuts] opens: "${s.opens}"`));
  L.push('', '## Terms a first-time viewer meets', '', '| Term | Said | First at | Defined? |', '|---|---|---|---|');
  m.terms.forEach((t) => L.push(`| ${t.term} | ${t.count}x | #${t.first} ${fmt(t.firstAt)} | ${t.defined ? '#' + t.defined : '**no: explain it on screen or in a pickup line**'} |`));
  return L.join('\n') + '\n';
}

export function briefTemplate(m, name = m.clip) {
  const h = m.hooks[0];
  return `# Brief: ${name}

Written before the plan. Every call below has a reason; the plan follows the brief, and the run log records what
changed after review. Guide: docs/EDITORIAL.md. Evidence: EDITMAP.md for ${m.clip} (raw ${fmt(m.duration)}).

## The one idea
<!-- One sentence a viewer could repeat to a friend. Not the topic: the claim. -->

## Who it's for and what they already know
<!-- From scripts/SERIES.md if it exists. Default: curious, has never heard the term. -->

## Hook (first 3-10 s)
<!-- Strongest candidate from the map${h ? `: ${m.clip}#${h.n} "${h.text}"` : ''}. Pick one, or write a line to record, and say why. -->

## Structure (story order, not recording order)
<!-- 4-6 beats: hook, promise, build, turn, payoff, next step. Each beat -> source lines (#n-#m) and why it earns its place. -->

## Cut, and why
<!-- Repeats (keep which take), tangents, table talk, sections that don't serve the one idea. Name the seconds saved. -->

## Added depth (not in the footage)
<!-- Terms to explain on screen, context and numbers from research (with sources), pickup lines to record. Never put words in the speaker's mouth. -->

## Formats
<!-- Long-form 16:9 length; which stretches become vertical Shorts and why each stands alone. -->

## Look and sound
<!-- Theme, music, B-roll mode, captions, from TASTE.md unless this video needs something else. -->

## Open questions (only what can't be decided from the footage, TASTE.md or the series bible)
<!-- Each with the default you'll use if nobody answers. -->
`;
}
