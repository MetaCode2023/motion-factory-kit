// Long-form editor: word-exact cutting, anchors, time mapping and plan checks, on an in-memory library.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sentencesOf } from '../tools/longform/common.mjs';
import { cutList, mapTime, resolvePlan, sideBox } from '../tools/longform/plan.mjs';

// "Hello there. Um so this is the um the point. Okay." with a long pause before "Okay".
function fakeLib() {
  const words = [
    ['Hello', 0.5, 0.8], ['there.', 0.85, 1.2],
    ['Um', 1.6, 1.9], ['so', 2.3, 2.45], ['this', 2.5, 2.7], ['is', 2.75, 2.85], ['the', 2.9, 3.0], ['um', 3.4, 3.7], ['the', 4.1, 4.2], ['point.', 4.25, 4.7],
    ['Okay.', 7.0, 7.4],
  ].map(([w, s, e]) => ({ w, s, e }));
  return { clips: { a: { id: 'a', file: '/x/a.mp4', key: 'k', duration: 8, words, sentences: sentencesOf(words), hasAudio: true } } };
}

test('sentences are numbered from 1 and split on punctuation and long pauses', () => {
  const s = fakeLib().clips.a.sentences;
  assert.equal(s[0].n, 1);
  assert.equal(s[0].text, 'Hello there.');
  assert.equal(s[s.length - 1].text, 'Okay.');
});

test('tightening drops fillers and long pauses, word-exact, frame-rounded', () => {
  const lib = fakeLib();
  const cuts = cutList({ fps: 30, a_roll: [{ clip: 'a' }] }, lib);
  const kept = (c) => lib.clips.a.words.filter((w) => w.s >= c.s - 1e-3 && w.e <= c.e + 1e-3).map((w) => w.w);
  const all = cuts.flatMap(kept);
  assert.ok(!all.some((w) => /^um$/i.test(w)), 'no fillers');
  assert.deepEqual(all, ['Hello', 'there.', 'so', 'this', 'is', 'the', 'the', 'point.', 'Okay.']);
  for (const c of cuts) assert.ok(Math.abs(c.d * 30 - Math.round(c.d * 30)) < 1e-6, 'whole frames');
  const total = cuts.reduce((a, c) => a + c.d, 0);
  assert.ok(total < 8 - 2.5, `removed the dead air (total ${total})`);
  for (let i = 1; i < cuts.length; i++) assert.ok(Math.abs(cuts[i].out - (cuts[i - 1].out + cuts[i - 1].d)) < 1e-3, 'back to back');
});

test('tighten.cut removes a false start; drop removes a sentence', () => {
  const lib = fakeLib();
  const cuts = cutList({ fps: 30, a_roll: [{ clip: 'a' }], tighten: { cut: [{ at: 'a#2', text: 'the um' }], drop: ['a#1'] } }, lib);
  const kept = cuts.flatMap((c) => lib.clips.a.words.filter((w) => w.s >= c.s - 1e-3 && w.e <= c.e + 1e-3).map((w) => w.w));
  assert.deepEqual(kept, ['so', 'this', 'is', 'the', 'point.', 'Okay.']);
});

test('anchors map from source time to the cut timeline', () => {
  const lib = fakeLib();
  const cuts = cutList({ fps: 30, a_roll: [{ clip: 'a' }] }, lib);
  const ok = mapTime(cuts, 'a', 7.0);
  assert.ok(ok > 0 && ok < 7.0 - 2, 'later words move earlier');
  assert.equal(mapTime(cuts, 'a', 6.0), cuts.find((c) => c.s > 6).out, 'a time in a removed gap lands on the next piece');
});

test('resolvePlan places inserts on words, sets marks, and reports problems all at once', () => {
  const lib = fakeLib();
  const plan = { name: 't', fps: 30, a_roll: [{ clip: 'a' }],
    inserts: [
      { kind: 'pull', at: 'a#2', word: 'point', dur: 1.5, search: 'x' },
      { kind: 'pull', at: 'a#2', word: 'nope', dur: 1, search: 'y' },
      { kind: 'wiggle', at: 'a#1' },
      { kind: 'animation', at: 'b#1', scene: 'nope.html' },
    ],
    chapters: [{ at: 'a#1', title: 'Start' }] };
  const R = resolvePlan(plan, lib);
  assert.ok(R.errors.some((e) => /word "nope" not found/.test(e)));
  assert.ok(R.errors.some((e) => /kind must be/.test(e)));
  assert.ok(R.errors.some((e) => /unknown clip "b"/.test(e)));
  const pull = R.inserts.find((i) => i.kind === 'pull');
  const pointWord = lib.clips.a.words.find((w) => w.w === 'point.');
  assert.ok(Math.abs(pull.at - mapTime(R.cuts, 'a', pointWord.s)) < 1e-3);
  assert.ok(R.warnings.some((w) => /3 or more/.test(w)));
});

test('overlapping inserts and inserts past the end are errors', () => {
  const lib = fakeLib();
  const R = resolvePlan({ name: 't', fps: 30, a_roll: [{ clip: 'a' }], inserts: [
    { kind: 'pull', at: 0.2, dur: 2, search: 'a' }, { kind: 'pull', at: 1.0, dur: 2, search: 'b' }, { kind: 'pull', at: 3.5, dur: 20, search: 'c' }] }, lib);
  assert.ok(R.errors.some((e) => /overlaps/.test(e)));
  assert.ok(R.errors.some((e) => /after the video ends/.test(e)));
});

test('side box is 16:9 and stays inside the frame', () => {
  const b = sideBox({});
  assert.equal(Math.round((b.w / b.h) * 9), 16);
  assert.ok(b.x + b.w <= 1920 && b.y + b.h <= 1080);
  assert.equal(sideBox({ side: { w: 800, x: 100 } }).x, 100);
});

// ---- script-first -------------------------------------------------------------------------------
import { align, lintScript, parseCue, parseScript, planFromScript, readingCopy } from '../tools/longform/script.mjs';

test('cues parse into kinds, options and template-shaped data', () => {
  const s = parseCue('stat value: 1,326 | label: hands | dur: 5');
  assert.equal(s.kind, 'anim'); assert.match(s.scene, /stat\.html$/); assert.equal(s.data.value, '1,326'); assert.equal(s.opts.dur, 5);
  const b = parseCue('bars bars: Taxes=42; Rent=27 | unit: %');
  assert.deepEqual(b.data.bars, [{ label: 'Taxes', value: 42 }, { label: 'Rent', value: 27 }]);
  const st = parseCue('steps steps: Observe - every bet is a clue; Update - re-weight');
  assert.deepEqual(st.data.steps[1], { title: 'Update', body: 're-weight' });
  const c = parseCue('compare left.title: A | left.items: x; y | right.title: B');
  assert.deepEqual(c.data.left, { title: 'A', items: ['x', 'y'] });
  assert.equal(parseCue('stock poker chips close up').arg, 'poker chips close up');
  assert.equal(parseCue('clip A famous bluff | search: bluff').kind, 'clip');
  assert.equal(parseCue('wiggle x: 1').kind, 'unknown');
});

const SCRIPT = `---
title: Test Video
---
// a note, not read
## One
[[quote text: Hello world.]] Hello world, this is a test of the script.
[[stock city at night]] The second line has more words in it. [[face]] Back to me now.
## Two
[[sfx hit]] Boom. That is the end of it.`;

test('scripts split into spoken words, cues on the next word, chapters; reading copy drops cues and notes', () => {
  const S = parseScript(SCRIPT);
  assert.equal(S.meta.title, 'Test Video');
  assert.equal(S.chapters.length, 2);
  assert.equal(S.words[S.cues[0].word].w, 'Hello');
  assert.equal(S.words[S.cues.find((c) => c.kind === 'face').word].w, 'Back');
  const read = readingCopy(SCRIPT);
  assert.ok(!/\[\[|note/.test(read) && /Hello world, this is a test/.test(read) && /— Two —/.test(read));
  const lint = lintScript(SCRIPT);
  assert.ok(lint.ok); assert.equal(lint.visuals, 2);
});

test('alignment matches the last take and labels the earlier one a retake to cut', () => {
  const S = parseScript(SCRIPT);
  const said = 'Hello world, this is a test of the script. The second line has more The second line has more words in it. Back to me now. Boom. That is the end of it.'.split(' ');
  let t = 0;
  const words = said.map((w) => ({ w, s: (t += 0.4), e: t + 0.3 }));
  const clip = { id: 'rec', duration: t + 1, words, sentences: [] };
  const { plan, report } = planFromScript(SCRIPT, clip);
  assert.equal(report.coverage, 1);
  assert.deepEqual(report.retakesCut, ['The second line has more']);
  assert.equal(plan.tighten.cut.length, 1);
  const stockAt = Number(plan.inserts.find((i) => i.kind === 'broll').at.split('@')[1]);
  assert.ok(Math.abs(stockAt - words[14].s) < 1e-3, 'stock lands on the second (kept) take');
  assert.ok(plan.inserts.some((i) => i.kind === 'face') && plan.sfx.length === 1 && plan.chapters.length === 2);
  const map = align(['a', 'b', 'c'], ['x', 'a', 'b', 'c', 'y']);
  assert.deepEqual([...map], [1, 2, 3], 'leading and trailing chatter is free');
});

test('a cue whose JSON ends in ]]] keeps the whole value', () => {
  const c = parseScript('[[superposition hands: [{"label":"A","cards":["Ah","Jh"],"p":0.4}]]] Hello.').cues[0];
  assert.deepEqual(c.data.hands[0].cards, ['Ah', 'Jh']);
  assert.ok(!/\]/.test(readingCopy('[[x a: [1]]] Hello.')));
});

test('animations schedule each item on the word that names it, the rest spread between', async () => {
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const ctx = { window: {}, M: { clamp: (x) => Math.max(0, Math.min(1, x)), ease: { inOutCubic: (x) => x } }, FX: {} };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../scenes/longform/lf.js', import.meta.url), 'utf8'), ctx);
  const LF = ctx.window.LF;
  const D = { dur: 8, words: [{ w: 'You', t: 0.2 }, { w: 'start', t: 0.5 }, { w: 'uncertain.', t: 1.0 }, { w: 'watch.', t: 2.5 }, { w: 'update.', t: 3.9 }, { w: 'decide.', t: 6.0 }] };
  const at = LF.schedule(D, ['Uncertain', 'Observe', 'Update', 'Decide']);
  assert.ok(Math.abs(at[0] - 0.9) < 0.01 && Math.abs(at[2] - 3.8) < 0.01 && Math.abs(at[3] - 5.9) < 0.01, JSON.stringify(at));
  // A first item said late (or out of order) doesn't leave the frame empty or hold up the rest.
  const late = LF.schedule({ dur: 8, words: [{ w: 'quantum', t: 1.0 }, { w: 'poker', t: 5.0 }] }, ['poker', 'quantum']);
  assert.ok(late[0] <= 1.4 && late[1] > late[0] && late[1] < 6.8, JSON.stringify(late));
  assert.ok(at[1] > at[0] && at[1] < at[2], 'an unsaid item lands between its neighbours');
  assert.equal(LF.when(D, 'nothing like it'), null);
  const even = LF.schedule({ dur: 6 }, ['a1', 'b2', 'c3']);
  assert.ok(even[0] < even[1] && even[1] < even[2] && even[2] <= 4.8, 'no words: an even spread');
});
