import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const load = (extra = {}) => {
  const window = { ...extra };
  vm.runInNewContext(readFileSync(new URL('../kit/motion.js', import.meta.url), 'utf8'), { window });
  return window.M;
};

test('estimated words follow the voice lines in order and never overlap', () => {
  const M = load();
  const w = M.estimateWords([{ at: 0.3, text: 'Most people swipe away.' }, { at: 0.5, text: 'Open on the problem.' }]);
  assert.equal(w.length, 8);
  assert.equal(w[0].s, 0.3);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].s >= w[i - 1].e, `word ${i} starts before the previous one ends`);
});

test('caption chunks hold at most 3 words, break on punctuation, and cover each word', () => {
  const M = load();
  const words = M.estimateWords([{ at: 0, text: 'Okay so my skin was so dry. I tried everything, honestly.' }]);
  const chunks = M.captionChunks(words);
  assert.ok(chunks.every((c) => c.words.length <= 3));
  assert.ok(chunks.some((c) => c.words[c.words.length - 1].w === 'dry.'));
  for (const w of words) assert.ok(chunks.some((c) => w.s >= c.s && w.s < c.e), `"${w.w}" is never shown`);
});

test('M.pick chooses by variant and records how many variants exist', () => {
  assert.equal(load().pick(['a', 'b', 'c']), 'a');
  const M = load({ VARIANT: 2 });
  assert.equal(M.pick(['a', 'b', 'c']), 'c');
  assert.equal(M._variants, 3);
});
