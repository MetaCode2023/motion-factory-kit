// Edit map: reading a raw recording like an editor (repeats, false starts, table talk, hooks, Shorts, terms).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sentencesOf } from '../tools/longform/common.mjs';
import { analyze, briefTemplate, editmapMarkdown } from '../tools/longform/editmap.mjs';

// A whiteboard session: table talk, a retake, a false start, two topics, one defined term and one that isn't.
const LINES = [
  'Okay is this recording?',
  'Can you see the board?',
  'Most people think the universe runs on matter, but it actually runs on information.',
  'A simulation is a program that copies the rules of a system so you can run it forward.',
  'The simulation has a clock and every tick it updates every particle.',
  'Every tick the simulation updates every particle on the grid.',
  'Hold on let me erase this.',
  'The grid has a resolution.',
  'The grid has a',
  'The grid has a smallest cell called the Planck length, and nothing in the simulation is smaller.',
  'Um so uh um like um yeah um.',
  'Now the second idea is about the observer.',
  'Why would a simulation only render what an observer looks at?',
  'Because rendering costs compute, and a game engine only draws what the camera sees.',
  'The observer is the camera, and the camera decides what gets computed.',
  'Quantum experiments show the observer changes the outcome, which is exactly what an engine saving compute would do.',
  'So the observer and the camera might be the same thing.',
  'That is a wild claim, and the observer question is the one physicists still argue about.',
];
function clip() {
  const words = []; let t = 0.5;
  LINES.forEach((line, i) => {
    for (const w of line.split(' ')) { words.push({ w, s: +t.toFixed(2), e: +(t + 0.3).toFixed(2) }); t += 0.36; }
    t += i === 10 ? 6 : 1.2;   // a long pause after the filler line (topic change)
  });
  return { id: 'board', duration: t + 1, words, sentences: sentencesOf(words) };
}
const n = (c, text) => c.sentences.find((s) => s.text.startsWith(text) && !/^[A-Za-z]/.test(s.text.slice(text.length))).n;

test('table talk and filler lines are flagged as fluff, with a reason', () => {
  const c = clip(), m = analyze(c);
  const flagged = new Set(m.fluff.map((f) => f.n));
  assert.ok(flagged.has(n(c, 'Okay is this recording')));
  assert.ok(flagged.has(n(c, 'Can you see the board')));
  assert.ok(flagged.has(n(c, 'Hold on let me erase')));
  assert.ok(flagged.has(n(c, 'Um so uh')));
  assert.ok(!flagged.has(n(c, 'Most people think')), 'content is not fluff');
});

test('a point made twice keeps one take', () => {
  const c = clip(), m = analyze(c);
  const r = m.repeats.find((x) => x.takes.some((t) => t.text.startsWith('The simulation has a clock')));
  assert.ok(r, 'repeat found');
  assert.equal(r.takes.length, 2);
  assert.equal(r.drop.length, 1);
});

test('false starts point at the restart', () => {
  const c = clip(), m = analyze(c);
  const f = m.falseStarts.map((x) => x.n);
  assert.ok(f.includes(c.sentences.find((s) => s.text === 'The grid has a').n));
  assert.ok(!f.includes(n(c, 'The grid has a smallest')), 'the full take is kept');
});

test('hooks rank the contrarian claim and skip table talk', () => {
  const c = clip(), m = analyze(c);
  assert.ok(m.hooks.length);
  assert.ok(m.hooks.slice(0, 3).some((h) => h.text.startsWith('Most people think')), JSON.stringify(m.hooks.slice(0, 3)));
  assert.ok(!m.hooks.some((h) => m.fluff.some((f) => f.n === h.n)));
});

test('sections split where the subject changes; terms note whether they are defined', () => {
  const c = clip(), m = analyze(c, { minSection: 5 });
  assert.ok(m.sections.length >= 2, JSON.stringify(m.sections.map((s) => [s.from, s.to, s.topics])));
  const sim = m.terms.find((t) => /^simulation$/i.test(t.term));
  assert.ok(sim && sim.defined, 'simulation is defined ("is a program that")');
  const obs = m.terms.find((t) => /^observer$/i.test(t.term));
  assert.ok(obs && !obs.defined, 'observer is never defined');
});

test('the map and brief render, and the brief leaves the decisions to the editor', () => {
  const m = analyze(clip());
  const md = editmapMarkdown(m);
  assert.match(md, /## Hook candidates/);
  assert.match(md, /## Said more than once/);
  const b = briefTemplate(m, 'sim-video');
  for (const h of ['The one idea', 'Hook', 'Structure', 'Cut, and why', 'Added depth', 'Formats', 'Open questions']) assert.match(b, new RegExp('## ' + h));
});
