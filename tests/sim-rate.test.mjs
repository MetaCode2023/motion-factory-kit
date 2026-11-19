// tools/sim/rate.mjs: the Clef-omni rubric, the answer mapping, the small-copy plan and the request body. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLEF, RATERS, mapClefAnswers, clipParts, smallCopyArgs, buildBody, fileSha256 } from '../tools/sim/rate.mjs';

const LEVELS = ['very weak', 'weak', 'average', 'strong', 'very strong'];
const SCORES = ['hook', 'visuals', 'pacing', 'overall'];
const CHECKS = ['opens_on_speech', 'stands_alone', 'clear_payoff', 'dead_air', 'screen_changes', 'captions'];
// The live API keys probabilities by level index ("0".."4") and sends the labels separately as `legend`.
const LEGEND = Object.fromEntries(LEVELS.map((l, i) => [String(i), l]));
const probsFor = (hot) => Object.fromEntries(LEVELS.map((l, i) => [String(i), i === hot ? 0.6 : 0.1]));
const answers = (over = {}) => ({
  ...Object.fromEntries(SCORES.map((d) => [d, { type: 'score', score: 2.73, legend: LEGEND, probabilities: probsFor(3) }])),
  ...Object.fromEntries(CHECKS.map((c, i) => [c, { type: 'noul', noul: i / 10 }])),
  ...over,
});
const map = (a) => mapClefAnswers({ answers: a, rubric: CLEF.rubric, outputId: 'j/short/a', buildId: 'B1' });

test('clef rubric has the four dimensions and six checks, each score question with five criteria', () => {
  assert.deepEqual(Object.keys(CLEF.rubric).filter((k) => CLEF.rubric[k].type === 'score'), SCORES);
  assert.deepEqual(Object.keys(CLEF.rubric).filter((k) => CLEF.rubric[k].type === 'noul'), CHECKS);
  for (const d of SCORES) assert.deepEqual(CLEF.rubric[d].criteria, LEVELS);
  for (const q of Object.values(CLEF.rubric)) assert.ok(q.instructions.length > 20);
  assert.equal(RATERS['clef-omni'], CLEF);
  assert.equal(CLEF.model, '@cf/cloudflare/clef-omni');
  assert.equal(CLEF.path, '/ai/run/@cf/cloudflare/clef-omni');
});

test('the rubric is pinned to its version', () => {
  assert.equal(CLEF.rubric_version, 1);
  assert.equal(createHash('sha256').update(JSON.stringify(CLEF.rubric)).digest('hex'), '50dbc3772cda1b3d65117d9d028a94f3e211010383af729e5975ff59625744d1');
});

test('clef answers map to four rating rows', () => {
  const { rows, checks } = map(answers());
  assert.deepEqual(rows.map((r) => r.dimension), SCORES);
  for (const r of rows) {
    assert.equal(r.score, 4);
    assert.equal(r.rater, 'clef-omni');
    assert.equal(r.model, '@cf/cloudflare/clef-omni');
    assert.equal(r.rubric_version, 1);
    assert.equal(r.pass, 1);
    assert.equal(r.build_id, 'B1');
    assert.equal(r.output_id, 'j/short/a');
    assert.equal(r.stop_reason, null);
    assert.equal(r.justification, null);
  }
  assert.deepEqual(Object.keys(rows[0].probs), ['1', '2', '3', '4', '5']);
  assert.equal(rows[0].probs['4'], 0.6);
  assert.deepEqual(Object.keys(rows[3].probs.checks), CHECKS);
  assert.equal(rows[3].probs.checks.captions, 0.5);
  assert.equal(rows[0].probs.checks, undefined);
  assert.deepEqual(Object.keys(checks), CHECKS);
});

test('a missing answer gives a NULL score with stop_reason missing_answer', () => {
  const a = answers();
  delete a.pacing;
  const r = map(a).rows.find((x) => x.dimension === 'pacing');
  assert.equal(r.score, null);
  assert.equal(r.stop_reason, 'missing_answer');
  assert.equal(r.probs, null);
  assert.equal(map(a).rows.find((x) => x.dimension === 'hook').score, 4);
});

test('a probability level outside the rubric is an error', () => {
  const a = answers({ hook: { type: 'score', score: 1, probabilities: { ...probsFor(1), 5: 0.1 } } });
  assert.throws(() => map(a), /level "5"/);
});

test('a legend that disagrees with the rubric labels is an error', () => {
  const a = answers({ hook: { type: 'score', score: 1, legend: { ...LEGEND, 4: 'amazing' }, probabilities: probsFor(1) } });
  assert.throws(() => map(a), /amazing/);
});

test('maps a real Clef-omni score answer', () => {
  const real = { type: 'score', score: 1.5387, legend: { 0: 'very weak', 1: 'weak', 2: 'average', 3: 'strong', 4: 'very strong' },
    probabilities: { 0: 0.2395, 1: 0.2349, 2: 0.3313, 3: 0.1359, 4: 0.0584 }, confidence: 0.0552 };
  const r = map(answers({ hook: real })).rows[0];
  assert.equal(r.score, 3);
  assert.deepEqual(r.probs, { 1: 0.2395, 2: 0.2349, 3: 0.3313, 4: 0.1359, 5: 0.0584 });
});

test('scores are clamped to 1..5', () => {
  const s = (v) => map(answers({ hook: { type: 'score', score: v, probabilities: probsFor(0) } })).rows[0].score;
  assert.equal(s(-0.6), 1);
  assert.equal(s(4.6), 5);
  assert.equal(s(0), 1);
});

test('clipParts: up to 60 s is one part; 60.01 to 120 s is two halves; over 120 s is an error', () => {
  assert.deepEqual(clipParts(45), [{ start: 0, dur: 45 }]);
  assert.deepEqual(clipParts(60), [{ start: 0, dur: 60 }]);
  assert.deepEqual(clipParts(100), [{ start: 0, dur: 50 }, { start: 50, dur: 50 }]);
  const two = clipParts(60.01);
  assert.equal(two.length, 2);
  assert.ok(two.every((p) => p.dur <= 60));
  assert.throws(() => clipParts(120.5), /120/);
});

test('smallCopyArgs gives 480p crf 30 mono 64k with -ss/-t per part', () => {
  const a = smallCopyArgs('in.mp4', 'out.mp4', { start: 50, dur: 50 });
  const at = (f) => a[a.indexOf(f) + 1];
  assert.equal(at('-ss'), '50');
  assert.equal(at('-t'), '50');
  assert.equal(at('-i'), 'in.mp4');
  assert.equal(at('-vf'), 'scale=-2:480');
  assert.equal(at('-c:v'), 'libx264');
  assert.equal(at('-crf'), '30');
  assert.equal(at('-preset'), 'veryfast');
  assert.equal(at('-c:a'), 'aac');
  assert.equal(at('-b:a'), '64k');
  assert.equal(at('-ac'), '1');
  assert.equal(a[a.length - 1], 'out.mp4');
});

test('buildBody puts up to two videos as video/mp4 base64 and includes state', () => {
  const b = buildBody({ parts: [Buffer.from('abc'), Buffer.from('de')], state: 'a short', outputId: 'j/short/a' });
  assert.equal(b.model, 'clef-omni');
  assert.equal(b.state, 'a short');
  assert.deepEqual(b.questions, CLEF.rubric);
  assert.deepEqual(b.videos, [{ content_type: 'video/mp4', base64: 'YWJj' }, { content_type: 'video/mp4', base64: 'ZGU=' }]);
  assert.throws(() => buildBody({ parts: [Buffer.from('a'), Buffer.from('b'), Buffer.from('c')], state: 's', outputId: 'j/short/a' }), /at most 2/);
});

test('a part over 16 MiB is an error naming the output', () => {
  const big = Buffer.alloc(16 * 1048576 + 1);
  assert.throws(() => buildBody({ parts: [big], state: 's', outputId: 'j/short/toobig' }), /j\/short\/toobig/);
  assert.doesNotThrow(() => buildBody({ parts: [Buffer.alloc(16 * 1048576)], state: 's', outputId: 'x' }));
});

test('CLEF.rate calls once with the body and returns rows, usage and checks', async () => {
  let body;
  const out = await CLEF.rate({ call: async (b) => { body = b; return { answers: answers(), usage: { input_tokens: 77 } }; },
    parts: [Buffer.from('abc')], state: 'a short', outputId: 'j/short/a', buildId: 'B1' });
  assert.equal(body.videos.length, 1);
  assert.equal(out.rows.length, 4);
  assert.equal(out.usage.input_tokens, 77);
  assert.equal(out.checks.opens_on_speech, 0);
});

test('fileSha256 matches node:crypto for a known file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfk-sha-'));
  try {
    const f = join(dir, 'x.bin'), data = Buffer.from('hello clef');
    writeFileSync(f, data);
    assert.equal(await fileSha256(f), createHash('sha256').update(data).digest('hex'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
