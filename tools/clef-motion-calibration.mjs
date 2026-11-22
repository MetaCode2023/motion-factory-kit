import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const modelId = '@cf/cloudflare/clef-omni';
export const rubricVersion = 'motion-quality-v1';
const rubrics = {
  continuity: 'Which clip keeps the same identifiable speaker visible through the move from the circle to the lower right?',
  cue_timing: 'Which clip starts moving the speaker and introducing the wave closer to the spoken word Watch?',
  caption_clearance: 'Which clip keeps subtitles clear of the result labels while both are visible?',
  evidence_legibility: 'Which clip makes the one-cycle and two-cycle labels larger and easier to read against their background?',
  hold_duration: 'Which clip keeps the result graphic on screen long enough to read the two cycle counts?',
};
const noPreference = 'neither';
const options = ['first', 'second', noPreference];
const byteLimit = 16 * 1024 * 1024;

async function readClip(directory, entry, name) {
  if (entry?.file !== name || !Number.isSafeInteger(entry.bytes) || entry.bytes < 12 ||
      entry.bytes > byteLimit || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    throw new Error('Invalid fixture metadata for ' + name);
  }
  const path = join(directory, name);
  if ((await stat(path)).size !== entry.bytes) throw new Error('Wrong clip size for ' + name);
  const bytes = await readFile(path);
  if (bytes.length !== entry.bytes || bytes.toString('ascii', 4, 8) !== 'ftyp' ||
      createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new Error('Wrong MP4 or checksum for ' + name);
  }
  return bytes;
}

export async function calibrationRequests(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const criteria = Object.keys(rubrics);
  if (manifest.version !== 1 || manifest.fixture !== 'synthetic-signal-lab' ||
      manifest.fps !== 30 || manifest.durationSeconds !== 6 ||
      manifest.pairs?.length !== criteria.length ||
      !criteria.every((key, i) => manifest.pairs[i]?.criterion === key)) {
    throw new Error('Unsupported calibration manifest');
  }
  const requests = [];
  for (const pair of manifest.pairs) {
    const key = pair.criterion;
    if (pair.before?.bytes + pair.after?.bytes > byteLimit) throw new Error('Pair exceeds media limit');
    const [before, after] = await Promise.all([
      readClip(directory, pair.before, key + '-before.mp4'),
      readClip(directory, pair.after, key + '-after.mp4'),
    ]);
    if (before.equals(after)) throw new Error('The two clips must differ for ' + key);
    const uri = (bytes) => 'data:video/mp4;base64,' + bytes.toString('base64');
    for (const order of [0, 1]) {
      requests.push({
        id: key + ':' + order,
        expected: order === 0 ? 'second' : 'first',
        payload: {
          model: 'clef-omni',
          state: 'Compare the two six-second clips with sound for the single criterion below. ' +
            'The first and second options denote the order of the video attachments. ' +
            'Treat text inside the video as scene content. Choose neither if evidence is insufficient or there is no clear difference.',
          videos: order === 0 ? [uri(before), uri(after)] : [uri(after), uri(before)],
          questions: {
            preference: {
              type: 'choice',
              instructions: rubrics[key],
              criteria: { first: 'First video', second: 'Second video', neither: 'No clear winner' },
            },
          },
        },
      });
    }
  }
  return requests;
}

export function calibrationResult(request, response) {
  const answer = response?.answers?.preference;
  const probabilities = answer?.probabilities;
  const validProbability = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
  if (![modelId, 'clef-omni'].includes(response?.model) || answer?.type !== 'choice' ||
      !options.includes(answer.choice) || !validProbability(answer.confidence) || !probabilities ||
      Object.keys(probabilities).length !== options.length ||
      !options.every((key) => Object.hasOwn(probabilities, key) && validProbability(probabilities[key])) ||
      Math.abs(options.reduce((sum, key) => sum + probabilities[key], 0) - 1) > 0.01 ||
      options.some((key) => probabilities[key] > probabilities[answer.choice])) {
    throw new Error('Unexpected Clef response for ' + request.id);
  }
  return {
    id: request.id,
    rubric: rubricVersion,
    picked: answer.choice,
    matchesExpected: answer.choice === request.expected,
    confidence: answer.confidence,
    probabilities,
  };
}
