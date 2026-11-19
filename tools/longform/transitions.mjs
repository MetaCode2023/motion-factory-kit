// tools/longform/transitions.mjs: what a "transition" value in a plan or script cue means. Legacy names are
// ffmpeg xfade transitions (or "cut"); "wipe:<family>(softness=0.2 dur=0.6)" or { "wipe": "iris", ... } is a
// soft-edged wipe from wipes.mjs, laid over the picture by wipeGraph. docs/TRANSITIONS.md has the grammar.
import { FAMILIES } from './wipes.mjs';

// How visuals arrive and leave. plan.transitions: 'fade' for plain fades everywhere, or your own list to cycle
// through; "transition" on one insert overrides it. Names are ffmpeg xfade transitions.
export const TRANSITIONS = ['smoothleft', 'slideup', 'circleopen', 'hblur', 'smoothup', 'slideleft'];
export const XFADE = new Set(['fade', 'dissolve', 'fadeblack', 'smoothleft', 'smoothright', 'smoothup', 'smoothdown', 'slideleft', 'slideright', 'slideup', 'slidedown', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'circleopen', 'circleclose', 'zoomin', 'radial', 'hblur', 'pixelize', 'circlecrop', 'rectcrop', 'diagtl', 'diagbr', 'squeezeh', 'squeezev']);

const RANGES = { softness: [0, 1], dur: [0.05, 5] };
const NUM = /^-?\d+(\.\d+)?$/;

function wipeSpec(family, given) {
  if (!FAMILIES[family]) throw new Error(`wipe transition: unknown family "${family}" (one of ${Object.keys(FAMILIES).join(', ')})`);
  const { softness = 0.1, dur = null, ...rest } = given;
  const spec = { type: 'wipe', family, softness, dur, params: { ...FAMILIES[family] } };
  for (const [k, v] of Object.entries({ softness, dur: dur ?? 0.4, ...rest })) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`wipe transition: ${k} must be a number`);
    const [lo, hi] = RANGES[k] || [-Infinity, Infinity];
    if (v < lo || v > hi) throw new Error(`wipe transition: ${k} must be between ${lo} and ${hi}`);
    if (k === 'count' && v < 1) throw new Error('wipe transition: count must be at least 1');
    if (k !== 'softness' && k !== 'dur') {
      if (!(k in spec.params)) throw new Error(`wipe transition: ${family} has no "${k}" (it takes ${['softness', 'dur', ...Object.keys(spec.params)].join(', ')})`);
      spec.params[k] = v;
    }
  }
  return spec;
}

function wipeString(s) {
  const m = s.match(/^wipe:([a-z0-9-]+)(?:\(([^()]*)\))?$/);
  if (!m) throw new Error(`wipe transition: can't read "${s}" (write wipe:<family> or wipe:<family>(softness=0.2 dur=0.6), no commas)`);
  const given = {};
  for (const pair of (m[2] || '').trim().split(/\s+/).filter(Boolean)) {
    const kv = pair.match(/^(\w+)=(.*)$/);
    if (!kv || !NUM.test(kv[2])) throw new Error(`wipe transition: "${pair}" in "${s}" is not name=number`);
    given[kv[1]] = Number(kv[2]);
  }
  return wipeSpec(m[1], given);
}

// null (nothing given) | { type: 'cut' } | { type: 'xfade', name } | { type: 'unknown', name } | { type: 'wipe', family, softness, dur, params }
// Throws on a malformed wipe. An unknown legacy name is not an error: the caller falls back, as it always has.
export function parseTransition(t) {
  if (t == null || t === '') return null;
  if (typeof t === 'object' && !Array.isArray(t)) {
    const { wipe, ...rest } = t;
    if (typeof wipe !== 'string') throw new Error('wipe transition: the object form needs "wipe": "<family>"');
    return wipeSpec(wipe, rest);
  }
  if (typeof t !== 'string') throw new Error('transition must be a name, "wipe:<family>" or { "wipe": "<family>" }');
  if (t.startsWith('wipe:')) return wipeString(t);
  if (t === 'cut') return { type: 'cut' };
  return XFADE.has(t) ? { type: 'xfade', name: t } : { type: 'unknown', name: t };
}

const usable = (t) => { try { return parseTransition(t)?.type !== 'unknown'; } catch { return false; } };

// The list a plan cycles through: plan.transitions as given (or 'fade', or one wipe string), minus anything
// ffmpeg could not run; the default list when nothing is left.
export function cycleOf(t) {
  const list = Array.isArray(t) ? t : t === 'fade' ? ['fade'] : typeof t === 'string' && t.startsWith('wipe:') ? [t] : [];
  const ok = list.filter((x) => x != null && usable(x));
  return ok.length ? ok : TRANSITIONS;
}

// The graph for one wipe: `toLbl` is revealed over `fromLbl` through the mask images in input `maskIdx` (a
// sequence of `d` seconds, black to white), starting `offset` seconds in. The mask is scaled to the picture.
export function wipeGraph(fromLbl, toLbl, maskIdx, d, offset, out) {
  const shift = offset > 0 ? `,setpts=PTS+${offset.toFixed(3)}/TB` : '';
  return `[${maskIdx}:v]format=gray,trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS[${out}m];[${out}m][${toLbl}]scale2ref=flags=bicubic[${out}s][${out}t];[${out}t][${out}s]alphamerge${shift}[${out}a];[${fromLbl}][${out}a]overlay=format=yuv420:eof_action=repeat[${out}]`;
}
