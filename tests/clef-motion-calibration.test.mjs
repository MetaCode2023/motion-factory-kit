import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { calibrationRequests, calibrationResult, modelId } from '../tools/clef-motion-calibration.mjs';

test('emit both orders without exposing expected labels in the Clef request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'clef-fixtures-'));
  try {
    const pairs = [];
    for (const criterion of ['continuity', 'cue_timing', 'caption_clearance', 'evidence_legibility', 'hold_duration']) {
      const pair = { criterion };
      for (const label of ['before', 'after']) {
        const file = criterion + '-' + label + '.mp4';
        const bytes = Buffer.from('0000ftyp synthetic test data ' + label);
        pair[label] = { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
        await writeFile(join(directory, file), bytes);
      }
      pairs.push(pair);
    }
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({
      version: 1, fixture: 'synthetic-signal-lab', durationSeconds: 6, fps: 30, pairs,
    }));
    const requests = await calibrationRequests(directory);
    assert.equal(requests.length, 10);
    for (let i = 0; i < requests.length; i += 2) {
      const [a, b] = requests.slice(i, i + 2);
      assert.equal(a.expected, 'second');
      assert.equal(b.expected, 'first');
      assert.deepEqual(a.payload.videos, [...b.payload.videos].reverse());
      assert.notDeepEqual(a.payload.videos[0], a.payload.videos[1]);
      assert.deepEqual(a.payload.questions, b.payload.questions);
      assert.deepEqual(Object.keys(a.payload).sort(), ['model', 'questions', 'state', 'videos']);
      assert.equal(a.payload.model, 'clef-omni');
    }
    await writeFile(join(directory, pairs[0].after.file), Buffer.from('0000ftyp synthetic test data other'));
    await assert.rejects(calibrationRequests(directory), /checksum|size/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reject an invalid response and do not silently turn abstentions into matches', () => {
  const request = { id: 'continuity:0', expected: 'second' };
  const response = (choice, probabilities) => ({
    model: modelId, answers: { preference: { type: 'choice', choice, probabilities, confidence: 0.8 } },
  });
  assert.equal(calibrationResult(request, response('second', { first: 0.05, second: 0.9, neither: 0.05 })).matchesExpected, true);
  assert.equal(calibrationResult(request, response('neither', { first: 0.1, second: 0.1, neither: 0.8 })).matchesExpected, false);
  assert.throws(() => calibrationResult(request, response('first', { first: 0.1, second: 0.8, neither: 0.1 })), /Unexpected/);
  assert.throws(() => calibrationResult(request, response('second', { first: 0.7, second: 0.9, neither: 0.1 })), /Unexpected/);
  assert.throws(() => calibrationResult(request, { ...response('second', { first: 0, second: 1, neither: 0 }), model: 'unknown' }), /Unexpected/);
});
