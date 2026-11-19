// tools/longform/critique.mjs: the editor's second look. Before the build (as part of `check`) and after it
// (CRITIQUE.md), read the edit the way a first-time viewer meets it and list what they'd trip on:
//
//   opener      does it open on a strong, self-contained line, or on table talk / a line that leans on the last one?
//   promise     does the viewer hear why to keep watching in the first 45 s?
//   order       is it the recording top to bottom (fine for a tight take, a smell for a long whiteboard session)?
//   repeats     are two takes of the same point both still in?
//   fluff       is table talk ("can you see the board?") still in?
//   terms       is a term used repeatedly, never defined by the speaker, and not explained by any visual?
//   static      a stretch with nothing new on screen (talking head only) for too long
//   sameness    the same animation twice in a row
//   pace        a slow minute (few words, long silences)
//   ending      does it end on a finished thought, with somewhere to go next?
//   brief       do the kept words still carry the brief's one idea?
//
// Each note has a time on the finished video and a suggested fix. It never edits the plan: the editor decides.
import { existsSync, readFileSync } from 'node:fs';
import { fmt } from './common.mjs';
import { DEPENDENT, META, analyze, hookScore, termsOf } from './editmap.mjs';

const PROMISE = /\b(here'?s the thing|nobody tells you|no one tells you|in this video|by the end|i'?ll show|i'?m going to show|let me show|you'?ll (see|learn|know|understand)|here'?s (why|how|what)|the answer|we'?re going to|stick around|what if|why does|why do|how does|how do|\?)/i;
const NEXT = /\b(next (time|video|week)|subscribe|follow|comment|let me know|watch (this|the next)|so next time|what do you think|try (this|it)|\?)/i;

const sentenceAt = (clip, t) => clip.sentences.find((s) => t >= s.s - 0.05 && t <= s.e + 0.05);
const inCuts = (cuts, clip, s) => cuts.some((c) => c.clip === clip && s.s >= c.s - 0.05 && s.e <= c.e + 0.05);
const partlyIn = (cuts, clip, s) => cuts.some((c) => c.clip === clip && s.s < c.e - 0.05 && s.e > c.s + 0.05);
const outTime = (cuts, clip, t) => { const c = cuts.find((x) => x.clip === clip && t >= x.s - 0.05 && t <= x.e + 0.05); return c ? c.out + Math.max(0, t - c.s) : null; };

export function critique(plan, R, { briefFile, staticMax = 20, slowWpm = 105 } = {}) {
  const notes = [];
  const add = (kind, t, text, fix) => notes.push({ kind, t: t == null ? null : +t.toFixed(1), text, fix });
  const lib = R.lib, cuts = R.cuts || [];
  if (!cuts.length) return { score: 0, notes: [] };
  const used = [...new Set(cuts.map((c) => c.clip))].filter((id) => lib.clips[id]?.sentences?.length);
  const maps = Object.fromEntries(used.map((id) => [id, analyze(lib.clips[id])]));

  // ---- opener
  const first = cuts[0], fc = lib.clips[first.clip], fs = fc && (sentenceAt(fc, first.s + 0.05) || fc.sentences.find((s) => s.s >= first.s - 0.05 && s.s < first.e));
  if (fs) {
    const meta = META.some((r) => r.test(fs.text)), leans = DEPENDENT.test(fs.text);
    const score = maps[first.clip]?.hooks.find((h) => h.n === fs.n)?.score ?? hookScore(fs.text);
    const best = used.flatMap((id) => maps[id].hooks.map((h) => ({ ...h, clip: id }))).sort((a, b) => b.score - a.score)[0];
    if (meta) add('opener', 0, `Opens on table talk: "${fs.text}".`, best ? `Open on ${best.clip}#${best.n}: "${best.text}"` : 'Drop it; open on the first line about the subject.');
    else if (leans) add('opener', 0, `The first line leans on something the viewer hasn't heard: "${fs.text}".`, best ? `Open on ${best.clip}#${best.n}: "${best.text}" (or a line that stands alone).` : 'Open on a line that stands alone.');
    else if (best && best.score - score >= 3 && !(best.clip === first.clip && best.n === fs.n)) add('opener', 0, `A stronger opener is further in: ${best.clip}#${best.n} "${best.text}" (${best.why.join(', ')}).`, 'Cold-open on it, then come back to the start (a_roll ranges can be in any order).');
  }

  // ---- promise in the first 45 s
  const early = R.words.filter((w) => w.s < 45).map((w) => w.w).join(' ');
  if (R.total > 90 && early && !PROMISE.test(early)) add('promise', 45, 'No promise or question in the first 45 s: nothing tells the viewer why to stay.', 'Move a "here\'s why / what if / by the end" line up, put the central question on screen, or write a pickup line.');

  // ---- recording order
  for (const id of used) {
    const mine = cuts.filter((c) => c.clip === id), c = lib.clips[id];
    const inOrder = mine.every((x, i) => !i || x.s >= mine[i - 1].s);
    const kept = mine.reduce((a, x) => a + (x.e - x.s), 0), talk = c.sentences.reduce((a, s) => a + (s.e - s.s), 0);
    if (inOrder && c.duration > 180 && talk && kept / talk > 0.8) add('order', null, `${id} is used top to bottom (${Math.round(kept / talk * 100)}% of the talking, in recording order).`, 'Fine for a tight take. For a raw session, check the brief: is the story order really the recording order?');
  }

  // ---- repeats and fluff still in
  for (const id of used) {
    const c = lib.clips[id];
    for (const r of maps[id].repeats) {
      const kept = r.takes.filter((t) => inCuts(cuts, id, c.sentences[t.n - 1]));
      if (kept.length >= 2) add('repeats', outTime(cuts, id, kept[1].s), `Said twice and both kept: ${kept.map((k) => `${id}#${k.n}`).join(' and ')} ("${kept[0].text.slice(0, 60)}...").`, `Keep ${id}#${r.keep}; add the other to tighten.drop.`);
    }
    for (const f of maps[id].fluff) {
      const s = c.sentences[f.n - 1];
      if (s && partlyIn(cuts, id, s)) add('fluff', outTime(cuts, id, s.s), `Still in (${f.why}): ${id}#${f.n} "${f.text}".`, `Add "${id}#${f.n}" to tighten.drop.`);
    }
  }

  // ---- terms nobody explains
  const shown = JSON.stringify((R.inserts || []).map((i) => [i.data, i.scene, i.title, i.query, i.id])).toLowerCase();
  const keptText = R.words.map((w) => w.w).join(' ').toLowerCase();
  const drawn = (R.inserts || []).filter((i) => !i.autoBroll && i.kind === 'animation');
  const termNotes = [];
  for (const id of used) for (const t of maps[id].terms) {
    const term = t.term.toLowerCase(), head = term.split(' ')[0];
    if (t.defined || shown.includes(term) || !keptText.includes(term) || (t.count < 2 && !term.includes(' '))) continue;
    const w = R.words.find((x) => x.w.toLowerCase().replace(/[^a-z'-]/g, '').startsWith(head.slice(0, Math.max(4, head.length - 2))));
    if (w && drawn.some((i) => w.s >= i.at - 2 && w.s <= i.at + i.dur + 8)) continue;   // a drawn visual is right there
    termNotes.push([w ? w.s : null, `"${t.term}" is said ${t.count}x, never defined, and no visual explains it.`]);
  }
  termNotes.slice(0, 4).forEach(([t, text]) => add('terms', t, text, 'A term card or story visual on its first use, or a pickup line defining it.'));

  // ---- nothing new on screen
  const vis = (R.inserts || []).map((i) => [i.at, i.at + i.dur]).sort((a, b) => a[0] - b[0]);
  let last = 0;
  for (const [a, b] of [...vis, [R.total, R.total]]) {
    if (a - last > staticMax) add('static', last, `${Math.round(a - last)} s with nothing new on screen (${fmt(last)}-${fmt(a)}).`, 'A split or pip visual, B-roll, or a punch-in on what is being drawn.');
    last = Math.max(last, b);
  }

  // ---- the same visual twice in a row
  const anim = (R.inserts || []).filter((i) => !i.autoBroll);
  anim.forEach((i, k) => { const p = anim[k - 1]; if (p && i.scene && i.scene === p.scene) add('sameness', i.at, `Two ${i.scene} visuals in a row (${p.id}, ${i.id}).`, 'Change one to another template, or merge them.'); });

  // ---- slow stretches
  for (let t = 0; t + 60 <= R.total + 1e-6; t += 30) {
    const n = R.words.filter((w) => w.s >= t && w.s < t + 60).length;
    if (n && n < slowWpm) { add('pace', t, `Slow minute at ${fmt(t)}: ${n} words.`, 'Tighten pauses (tighten.max_pause), drop a beat, or cover it with a visual that moves.'); t += 30; }
  }

  // ---- ending
  const tail = R.words.filter((w) => w.s > R.total - 30).map((w) => w.w).join(' ');
  const lastWord = R.words[R.words.length - 1];
  if (lastWord && !/[.?!]$/.test(lastWord.w)) add('ending', R.total, `Ends mid-sentence ("...${R.words.slice(-5).map((w) => w.w).join(' ')}").`, 'End the a_roll on a finished sentence.');
  if (R.total > 180 && tail && !NEXT.test(tail)) add('ending', R.total - 30, 'The last 30 s give the viewer nowhere to go (no question, no next step).', 'End on a question or a "next time you see X..." line, or add an end card.');

  // ---- does the edit still carry the brief's one idea?
  if (briefFile && existsSync(briefFile)) {
    const idea = (readFileSync(briefFile, 'utf8').split(/^## The one idea\s*$/m)[1] || '').split(/^## /m)[0].replace(/<!--[\s\S]*?-->/g, '').trim();
    const want = [...new Set(termsOf(idea))].filter((t) => t.length > 3);
    const have = new Set(termsOf(keptText));
    if (want.length >= 3) {
      const hit = want.filter((t) => have.has(t)).length / want.length;
      if (hit < 0.3) add('brief', null, `Only ${Math.round(hit * 100)}% of the brief's one-idea words are said in the cut.`, 'Either the cut drifted from the idea, or the brief needs rewriting to what the video really says.');
    }
  }

  const weight = { opener: 12, promise: 10, repeats: 6, fluff: 5, terms: 4, static: 5, order: 4, sameness: 3, pace: 3, ending: 5, brief: 10 };
  const score = Math.max(0, 100 - notes.reduce((a, n) => a + (weight[n.kind] || 3), 0));
  return { score, notes };
}

export function critiqueMarkdown(name, c) {
  const L = [`# Critique: ${name}`, '', `Editor score ${c.score}/100. Read as a first-time viewer. Fix what you agree with, rebuild, and say why for what you leave.`, ''];
  if (!c.notes.length) L.push('Nothing flagged.');
  for (const n of c.notes) L.push(`- **${n.kind}**${n.t != null ? ` at ${fmt(n.t)}` : ''}: ${n.text}\n  - fix: ${n.fix}`);
  return L.join('\n') + '\n';
}
