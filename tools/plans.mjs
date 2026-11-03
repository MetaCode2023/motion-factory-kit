// tools/plans.mjs: check an edit plan against the footage index before cutting anything.
// checkPlan(plan, clips) -> { ok, errors: [...], warnings: [...], estimatedLength }
// Used by `footage.mjs cut/build` (errors stop the plan) and the MCP server's footage_check_plan.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLAN_KEYS = ['name', 'angle', 'hooks', 'hook', 'hookStyle', 'comment', 'segments', 'broll', 'product', 'productAt', 'cta', 'endCard',
  'music', 'look', 'captions', 'caption', 'hashtags', 'punch', 'focus', 'focusY', 'face', 'tight', 'keepFillers', 'maxPause', 'audio', 'street', 'tally', 'voiceId'];
const SEG_KEYS = ['clip', 'sentence', 'sentences', 'from', 'to', 'focus', 'focusY', 'face', 'zoom', 'tight', 'keepFillers', 'maxPause', 'audio', 'question', 'person', 'n', 'answer'];

export function loadIndex(footDir) {
  const f = join(footDir, 'index.json');
  if (!existsSync(f)) return null;
  return new Map(JSON.parse(readFileSync(f, 'utf8')).clips.map((c) => [c.id, c]));
}

export function checkPlan(plan, clips) {
  const errors = [], warnings = [];
  if (!clips) return { ok: false, errors: ['no footage index yet: run footage_index (node footage.mjs index) first'], warnings, estimatedLength: 0 };
  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['the plan must be an object'], warnings, estimatedLength: 0 };
  if (!plan.name || !/^[\w.-]+$/.test(plan.name)) errors.push('name: required, letters/numbers/-/_ only (it becomes the file name)');
  for (const k of Object.keys(plan)) if (!PLAN_KEYS.includes(k)) warnings.push(`unknown key "${k}" (ignored)`);
  const segs = Array.isArray(plan.segments) ? plan.segments : [];
  if (!segs.length) errors.push('segments: at least one is needed');
  let len = 0;
  const used = [];
  segs.forEach((s, i) => {
    const at = `segments[${i}]`;
    for (const k of Object.keys(s || {})) if (!SEG_KEYS.includes(k)) warnings.push(`${at}: unknown key "${k}"`);
    const c = clips.get(s?.clip);
    if (!c) { errors.push(`${at}: unknown clip "${s?.clip}"`); return; }
    let from = s.from ?? 0, to = s.to ?? c.duration;
    const sn = s.sentences ?? (s.sentence != null ? [s.sentence, s.sentence] : null);
    if (sn) {
      const [a, b] = Array.isArray(sn) ? [sn[0], sn[sn.length - 1]] : [sn, sn];
      const sa = c.sentences[a], sb = c.sentences[b];
      if (!sa || !sb) { errors.push(`${at}: ${c.id} has no sentence s${!sa ? a : b} (it has s0-s${c.sentences.length - 1})`); return; }
      if (b < a) { errors.push(`${at}: sentences go backwards`); return; }
      from = sa.s; to = sb.e;
    } else if (s.from == null && s.to == null && c.sentences.length) warnings.push(`${at}: no sentence or from/to, so the whole clip (${c.duration.toFixed(1)}s) is used`);
    if (!(to > from)) { errors.push(`${at}: "to" must be after "from"`); return; }
    if (to > c.duration + 0.05) errors.push(`${at}: ends at ${to}s but ${c.id} is ${c.duration.toFixed(1)}s long`);
    if (used.some((u) => u.clip === c.id && from < u.to - 0.05 && to > u.from + 0.05)) warnings.push(`${at}: repeats part of ${c.id} already used`);
    used.push({ clip: c.id, from, to });
    len += Math.max(0, to - from);
    if (s.question != null && s.question !== true && typeof s.question !== 'string') errors.push(`${at}: question is true (use the words said) or text`);
    if (s.person != null && typeof s.person !== 'string' && !s.person.name) errors.push(`${at}: person needs a name (only one the person gave)`);
  });
  (plan.broll || []).forEach((b, i) => {
    if (!clips.get(b?.clip)) errors.push(`broll[${i}]: unknown clip "${b?.clip}"`);
    if (b?.over != null && !segs[b.over]) errors.push(`broll[${i}]: over ${b.over} is not a segment`);
  });
  const hooks = plan.hooks || (plan.hook ? [plan.hook] : []);
  if (!Array.isArray(hooks)) errors.push('hooks: a list of strings');
  else hooks.forEach((h, i) => { if (String(h).length > 70) warnings.push(`hooks[${i}]: ${String(h).length} characters; on-screen hooks read best under ~50`); });
  if (plan.tally) {
    const opts = plan.tally.options || [];
    if (!opts.length || opts.some((o) => !o.label || !(+o.value >= 0))) errors.push('tally.options: [{ label, value }] with real counts');
  }
  if (plan.street?.total != null && !(+plan.street.total > 0)) errors.push('street.total: a number');
  const est = +(len * 0.92).toFixed(1);   // fillers and pauses come out
  if (est && est < 6) warnings.push(`about ${est}s long: very short for an ad`);
  if (est > 60) warnings.push(`about ${est}s long: most ads land at 12-25s`);
  return { ok: !errors.length, errors, warnings, estimatedLength: est };
}
