import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parseCSV, toData } from '../tools/csv.mjs';
import { detectBeats } from '../tools/beats.mjs';

const kit = (extra = {}) => {
  const window = { ...extra };
  vm.runInNewContext(readFileSync(new URL('../kit/motion.js', import.meta.url), 'utf8'), { window });
  return window.M;
};

test('CSV rows become nested template data with hook variants and lists', () => {
  const rows = parseCSV('name,hook1,hook2,product.name,product.price,reasons\n"A, B",POV: it works,"Say ""hi""",Glow,29,x | y | z\n');
  const d = toData(rows[0]);
  assert.equal(d.name, 'A, B');
  assert.deepEqual(d.hooks, ['POV: it works', 'Say "hi"']);
  assert.deepEqual(d.product, { name: 'Glow', price: 29 });
  assert.deepEqual(d.reasons, ['x', 'y', 'z']);
});

test('M.data merges injected rows over defaults, keeping nested defaults', () => {
  const M = kit({ DATA: { product: { price: '$19' }, cta: '', hooks: ['New'] } });
  const D = JSON.parse(JSON.stringify(M.data({ product: { name: 'Glow', price: '$29' }, cta: 'Shop', hooks: ['Old'] })));   // plain objects (vm realm)
  assert.deepEqual(D.product, { name: 'Glow', price: '$19' });
  assert.equal(D.cta, 'Shop');                     // empty cells keep the default
  assert.deepEqual(D.hooks, ['New']);
});

test('beats snap cuts and pulse; preview without beats leaves times alone', () => {
  const M = kit({ BEATS: { bpm: 120, beats: [0, 0.5, 1, 1.5, 2, 2.5, 3] } });
  assert.equal(M.snap(1.2), 1);
  assert.equal(M.snap(1.4, 2), 1);
  assert.equal(M.snap(1.6, 2), 2);
  assert.ok(M.onBeat(1.0) > 0.99 && M.onBeat(1.3) < 0.2);
  assert.equal(kit().snap(1.23), 1.23);
});

test('narration cues come from make.mjs when present, estimated otherwise', () => {
  const real = [{ start: 0.3, end: 2.1, text: 'a' }];
  assert.deepEqual(JSON.parse(JSON.stringify(kit({ CUES: real }).cues([{ text: 'a' }]))), real);
  const est = kit().cues([{ text: 'one two three' }, { text: 'four five' }]);
  assert.equal(est.length, 2);
  assert.ok(est[1].start > est[0].end);
});

test('bundled tracks report their tempo; the estimate matches it', () => {
  const meta = detectBeats(new URL('../sounds/music/drive.mp3', import.meta.url).pathname, 4);
  assert.equal(meta.bpm, 120);
  assert.equal(meta.source, 'meta');
  assert.deepEqual(meta.beats.slice(0, 3), [0, 0.5, 1]);
});
