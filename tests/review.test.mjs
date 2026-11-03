// The approval loop: review page, feedback -> FEEDBACK.md / approved/ / DELIVERY.csv review column.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyFeedback, batchAds, writeReview } from '../tools/review.mjs';
import { writeDelivery } from '../tools/delivery.mjs';

function fakeBatch() {
  const dir = join(mkdtempSync(join(tmpdir(), 'mfk-review-')), 'client-oct');
  mkdirSync(dir, { recursive: true });
  for (const f of ['price-v1.mp4', 'price-v2.mp4', 'price-v1.4x5.mp4', 'price-v2.4x5.mp4', 'switch.mp4', 'switch.4x5.mp4']) writeFileSync(join(dir, f), 'x');
  writeFileSync(join(dir, 'price-v1.report.md'), '- PASS **sound**\n');
  writeFileSync(join(dir, 'switch.report.md'), '- FIX **footage**: placeholder\n');
  writeDelivery(dir, [{ name: 'price', angle: 'price', hooks: ['Hook A', 'Hook B'] }, { name: 'switch', angle: 'intent', hooks: ['Only hook'] }]);
  return dir;
}

test('the review page lists every ad with its hook variants and sizes', () => {
  const dir = fakeBatch();
  try {
    const ads = batchAds(dir);
    assert.deepEqual(ads.map((a) => a.name), ['price', 'switch']);
    const price = ads[0];
    assert.equal(price.files.filter((f) => f.size === '9:16').length, 2);
    assert.equal(price.files.find((f) => f.file === 'price-v2.mp4').hook, 'Hook B');
    assert.equal(ads[1].files[0].checks, '1 to fix');
    const html = readFileSync(writeReview(dir), 'utf8');
    assert.match(html, /"batch":"client-oct"/);
    assert.ok(!/<\/script>[^]*"ads"/.test(html.split('const DATA')[1].split('\n')[0]), 'data cannot close the script tag');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('feedback copies approved files, lists the changes and marks the sheet', () => {
  const dir = fakeBatch();
  try {
    const r = applyFeedback(dir, { batch: 'client-oct', reviewer: 'Client', decisions: {
      'price-v1.mp4': { status: 'approved', note: '' },
      'price-v2.mp4': { status: 'changes', note: 'Hook B is too long' },
      'switch.mp4': { status: 'approved', note: 'love it' },
    } });
    assert.deepEqual(r.redo, ['price']);
    assert.deepEqual(r.approved, ['switch']);
    for (const f of ['price-v1.mp4', 'price-v1.4x5.mp4', 'switch.mp4', 'switch.4x5.mp4']) assert.ok(existsSync(join(dir, 'approved', f)), f);
    assert.ok(!existsSync(join(dir, 'approved', 'price-v2.mp4')));
    const md = readFileSync(join(dir, 'FEEDBACK.md'), 'utf8');
    assert.match(md, /### price/);
    assert.match(md, /Hook B is too long/);
    assert.match(md, /--redo/);
    const csv = readFileSync(join(dir, 'DELIVERY.csv'), 'utf8').trim().split('\n');
    assert.ok(csv[0].endsWith(',review'));
    assert.ok(csv.find((l) => l.startsWith('price,price-v2.mp4')).endsWith(',changes'));
    assert.ok(csv.find((l) => l.startsWith('switch,switch.4x5.mp4')).endsWith(',approved'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
