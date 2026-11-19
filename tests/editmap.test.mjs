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
  'The observer works like the camera, and the camera decides what gets computed.',
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

// ---- the critic: reads a plan like a first-time viewer
import { critique } from '../tools/longform/critique.mjs';
import { resolvePlan } from '../tools/longform/plan.mjs';

test('critique flags table talk at the open, repeats kept, an undefined term, a long static stretch', () => {
  const c = clip();
  const lib = { clips: { board: { ...c, file: '/x/board.mp4', key: 'k', hasAudio: true } } };
  const R = resolvePlan({ name: 'raw', fps: 30, tighten: false, a_roll: [{ clip: 'board' }], inserts: [] }, lib, { autoBroll: false });
  assert.deepEqual(R.errors, []);
  const kinds = critique({ name: 'raw' }, R, { staticMax: 15 }).notes.map((n) => n.kind);
  for (const k of ['opener', 'repeats', 'fluff', 'static']) assert.ok(kinds.includes(k), `${k} in ${kinds}`);
  // Open on the strong line, drop the table talk and the second take: those notes go away.
  const n = (t) => c.sentences.find((s) => s.text.startsWith(t)).n;
  const drop = ['Okay is this', 'Can you see', 'Hold on', 'Um so uh', 'Every tick'].map((t) => `board#${n(t)}`);
  const R2 = resolvePlan({ name: 'cut', fps: 30, tighten: { drop }, a_roll: [{ clip: 'board', from: `#${n('Most people')}` }], inserts: [] }, lib, { autoBroll: false });
  const k2 = critique({ name: 'cut' }, R2, { staticMax: 15 }).notes.map((x) => x.kind);
  for (const k of ['opener', 'repeats', 'fluff']) assert.ok(!k2.includes(k), `${k} gone (${k2})`);
});

import { crossTakes } from '../tools/longform/editmap.mjs';
test('best take across recordings: the same point in two sessions, the cleaner take first', () => {
  const mk = (id, lines) => { const words = []; let t = 0; for (const l of lines) { for (const w of l.split(' ')) { words.push({ w, s: t, e: t + 0.3 }); t += 0.36; } t += 1.2; } return { id, words, sentences: sentencesOf(words), duration: t }; };
  const a = mk('session1', ['Um so the simulation um renders only what the observer um looks at to save compute.', 'Something unrelated about breakfast cereal today.']);
  const b = mk('session2', ['The simulation renders only what the observer looks at, to save compute.', 'Gravity bends light around heavy stars and galaxies.']);
  const g = crossTakes({ clips: { session1: a, session2: b } });
  assert.equal(g.length, 1);
  assert.equal(g[0].best, 'session2#1');
  assert.equal(g[0].takes.length, 2);
});

import { proposeRules } from '../tools/longform/extras.mjs';
test('feedback notes that read like standing preferences become proposed taste rules', () => {
  const r = proposeRules([{ t: 3, text: 'Always put the face in the corner circle' }, { t: 9, text: 'wrong card here, should be the queen' }, { t: 20, text: 'Music is too loud under the voice' }, { t: 30, text: 'I love these pop-up words' }]);
  assert.deepEqual(r.map((x) => x.t), [3, 20, 30]);
});

import { boardFromFrames } from '../tools/longform/board.mjs';
test('whiteboard scan: a bright board, with drawing found only where a small part of it changes', () => {
  const frame = (ink) => { const f = new Uint8Array(64 * 36).fill(235); for (let i = 0; i < ink; i++) f[64 * 10 + 5 + i] = 20; return f; };
  // 0-4 s still, 4-8 s a line being drawn (grows each frame), 8-10 s still, then a cut to a dark frame.
  const frames = [];
  for (let i = 0; i < 8; i++) frames.push(frame(0));
  for (let i = 0; i < 8; i++) frames.push(frame(i * 4 + 4));
  for (let i = 0; i < 4; i++) frames.push(frame(32));
  frames.push(new Uint8Array(64 * 36).fill(30));
  const b = boardFromFrames(frames, { fps: 2 });
  assert.ok(b.white);
  assert.equal(b.active.length, 1, JSON.stringify(b.active));
  assert.ok(b.active[0][0] >= 3.5 && b.active[0][0] <= 4.5 && b.active[0][1] >= 7.5 && b.active[0][1] <= 8.5, JSON.stringify(b.active));
});

import { auto } from '../tools/longform/auto.mjs';
import { mkdtempSync, mkdirSync as mkd, writeFileSync as wf, existsSync as ex, readFileSync as rf } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('drop folder: a file is only picked up once its size holds still, and briefs waiting are queued', async () => {
  const root = mkdtempSync(join(tmpdir(), 'auto-'));
  const inbox = join(root, 'inbox'), plans = join(root, 'plans');
  mkd(inbox, { recursive: true }); mkd(plans, { recursive: true });
  wf(join(inbox, 'session.txt'), 'not a video');
  wf(join(plans, 'old.brief.md'), '# Brief\n\n## The one idea\n<!-- todo -->\n\n## Hook\n');
  const prevLib = process.env.LONGFORM_LIBRARY; process.env.LONGFORM_LIBRARY = join(root, 'library');
  try {
    wf(join(inbox, 'take.mp4'), 'partial');
    const r1 = await auto({ inbox, plans, queueFile: join(root, 'QUEUE.md'), log: () => {}, build: false });
    assert.deepEqual(r1.waiting, ['take.mp4'], 'first sighting waits');
    assert.deepEqual(r1.needBrief, ['old']);
    wf(join(inbox, 'take.mp4'), 'partial plus more');
    const r2 = await auto({ inbox, plans, queueFile: join(root, 'QUEUE.md'), log: () => {}, build: false });
    assert.deepEqual(r2.waiting, ['take.mp4'], 'still growing: waits again');
    assert.ok(ex(join(inbox, 'take.mp4')));
    assert.match(rf(r2.queue, 'utf8'), /write the brief/);
  } finally { if (prevLib === undefined) delete process.env.LONGFORM_LIBRARY; else process.env.LONGFORM_LIBRARY = prevLib; }
});

test('audit fixes: parallel examples are not repeats; a finished line is not a false start; terms count every use', () => {
  const mk = (lines) => { const words = []; let t = 0; for (const l of lines) { for (const w of l.split(' ')) { words.push({ w, s: t, e: t + 0.3 }); t += 0.36; } t += 1.2; } return { id: 'c', words, sentences: sentencesOf(words), duration: t }; };
  const m = analyze(mk([
    'The probability of drawing an ace from the deck is four in fifty two.',
    'The probability of drawing a king from the deck is four in fifty two.',
    'And the dealer shuffles the deck.',
    'And the cards come out one at a time.',
    'Superposition is called the cloud of maybe.',
    'Now superposition shows up again, and superposition once more.',
  ]));
  assert.equal(m.repeats.length, 0, JSON.stringify(m.repeats));
  assert.equal(m.falseStarts.length, 0, JSON.stringify(m.falseStarts));
  const sp = m.terms.find((t) => t.term === 'superposition');
  assert.ok(sp && sp.count >= 2 && sp.defined, JSON.stringify(m.terms));
});
