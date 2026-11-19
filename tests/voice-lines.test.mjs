import test from 'node:test';
import assert from 'node:assert/strict';
import { alignLines, splitLines } from '../tools/voice-lines.mjs';

test('voice-lines: one take is cut into lines at the pauses nearest each sentence end', () => {
  const lines = splitLines('One short line. A much longer second line, with a comma in it. End.');
  assert.equal(lines.length, 3);
  // silences: lead-in, end of line 1, the comma inside line 2, end of line 2, tail
  const silences = [{ start: 0, end: 0.3 }, { start: 1.5, end: 1.9 }, { start: 3.2, end: 3.4 }, { start: 5.0, end: 5.6 }, { start: 6.2, end: 6.5 }];
  const out = alignLines(lines, silences, 6.5);
  assert.deepEqual(out.map((l) => [l.start, l.end]), [[0.3, 1.5], [1.9, 5.0], [5.6, 6.2]]);
});
