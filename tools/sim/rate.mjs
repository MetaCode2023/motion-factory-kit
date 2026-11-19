// tools/sim/rate.mjs: pure logic for `sim rate` (no network, no D1; the Clef call is injected). See docs/LEARNING.md.
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
const ROW = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
export const RATINGS_UPSERT = `INSERT INTO ratings (output_id, dimension, rater, rubric_version, pass, model, score, probs, justification, stop_reason, rated_at, build_id)
VALUES ${[ROW, ROW, ROW, ROW].join(', ')}
ON CONFLICT(output_id, dimension, rater, rubric_version, pass) DO UPDATE SET
  model = excluded.model, score = excluded.score, probs = excluded.probs, justification = excluded.justification,
  stop_reason = excluded.stop_reason, rated_at = excluded.rated_at, build_id = excluded.build_id`;
export const ratingParams = (rows, ratedAt) => rows.flatMap((r) => [r.output_id, r.dimension, r.rater, r.rubric_version, r.pass, r.model, r.score,
  r.probs == null ? null : JSON.stringify(r.probs), r.justification, r.stop_reason, ratedAt, r.build_id]);

const LEVELS = ['very weak', 'weak', 'average', 'strong', 'very strong'];
const score = (instructions) => ({ type: 'score', instructions, criteria: LEVELS });
const noul = (instructions) => ({ type: 'noul', instructions });
const RUBRIC = {
  hook: score('How strong is the opening 3 seconds of this short video at making a viewer who knows nothing about the topic keep watching?'),
  visuals: score('How visually engaging is this short video: do the pictures on screen change, show the idea, and stay readable on a phone?'),
  pacing: score('How well paced is this short video: no dead air, no rambling, each moment earns its place?'),
  overall: score('Overall, how likely is a viewer to watch this short video to the end?'),
  opens_on_speech: noul('Does someone start speaking within the first second of the video?'),
  stands_alone: noul('Would this video make sense to someone who has never seen anything else from this channel?'),
  clear_payoff: noul('Does the video end on a clear conclusion or payoff rather than trailing off mid-thought?'),
  dead_air: noul('Is there any stretch of two seconds or more where nobody speaks and nothing changes on screen?'),
  screen_changes: noul('Does what is shown on screen change at least once every five seconds?'),
  captions: noul('Are the spoken words shown as captions on screen?'),
};
const DIMENSIONS = ['hook', 'visuals', 'pacing', 'overall'];
const MODEL = '@cf/cloudflare/clef-omni';
const MAX_BYTES = 16 * 1048576, MAX_PARTS = 2, MAX_PART_S = 60;

export async function fileSha256(file) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

export function clipParts(duration) {
  if (duration <= MAX_PART_S) return [{ start: 0, dur: duration }];
  if (duration > MAX_PART_S * MAX_PARTS) throw new Error(`a short over ${MAX_PART_S * MAX_PARTS} s cannot be rated (this one is ${duration.toFixed(1)} s)`);
  return [{ start: 0, dur: duration / 2 }, { start: duration / 2, dur: duration / 2 }];
}

export const smallCopyArgs = (input, output, part) => ['-ss', String(part.start), '-i', input, '-t', String(part.dur), '-vf', 'scale=-2:480',
  '-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', output];

export function buildBody({ parts, state, outputId }) {
  if (parts.length > MAX_PARTS) throw new Error(`${outputId}: at most ${MAX_PARTS} videos per request (got ${parts.length})`);
  for (const p of parts) if (p.length > MAX_BYTES) throw new Error(`${outputId}: a part is ${(p.length / 1048576).toFixed(1)} MiB, over the 16 MiB limit`);
  return { model: 'clef-omni', state, questions: CLEF.rubric, videos: parts.map((p) => ({ content_type: 'video/mp4', base64: p.toString('base64') })) };
}

export function mapClefAnswers({ answers, rubric, outputId, buildId }) {
  const checks = {};
  for (const [id, q] of Object.entries(rubric)) if (q.type === 'noul' && typeof answers[id]?.noul === 'number') checks[id] = answers[id].noul;
  const rows = DIMENSIONS.map((dimension) => {
    const a = answers[dimension], base = { output_id: outputId, dimension, rater: 'clef-omni', rubric_version: 1, pass: 1, model: MODEL, justification: null, build_id: buildId };
    let probs = null;
    if (a && typeof a.score === 'number') {
      probs = {};
      // Clef keys probabilities by level index ("0".."4") and repeats the labels in `legend`.
      const criteria = rubric[dimension].criteria;
      for (const [level, label] of Object.entries(a.legend || {})) {
        if (criteria[level] !== label) throw new Error(`${outputId}: ${dimension} level "${level}" is "${label}", not the rubric's "${criteria[level]}"`);
      }
      for (const [level, p] of Object.entries(a.probabilities || {})) {
        if (!Number.isInteger(+level) || criteria[+level] === undefined) throw new Error(`${outputId}: ${dimension} has a probability for level "${level}", which is not in the rubric`);
        probs[String(Number(level) + 1)] = p;
      }
    }
    if (dimension === 'overall') probs = { ...(probs || {}), checks };
    if (!a || typeof a.score !== 'number') return { ...base, score: null, probs, stop_reason: 'missing_answer' };
    return { ...base, score: Math.min(5, Math.max(1, Math.round(a.score) + 1)), probs, stop_reason: null };
  });
  return { rows, checks };
}

export const CLEF = {
  name: 'clef-omni', model: MODEL, path: `/ai/run/${MODEL}`, rubric_version: 1, maxPartS: MAX_PART_S, maxParts: MAX_PARTS, maxBytes: MAX_BYTES, rubric: RUBRIC,
  async rate({ call, parts, state, outputId, buildId }) {
    const res = await call(buildBody({ parts, state, outputId }));
    const { rows, checks } = mapClefAnswers({ answers: res.answers || {}, rubric: RUBRIC, outputId, buildId });
    return { rows, usage: res.usage, checks };
  },
};
export const RATERS = { 'clef-omni': CLEF };
