// tools/longform/interchange.mjs: bring a cut that was trimmed in another editor (xmeml or EDL) back into a plan.
// Rules, messages and data shapes: docs/INTERCHANGE.md. Untested in external editors; tested only on this kit's own exports.
//
//   importCut(text, kind, lib, { fps, probe }) -> { a_roll, errors, warnings }   kind: 'xmeml' | 'edl'
//     three steps: PARSE (read the file into events, reject what the kit cannot represent), MATCH (each event's
//     media to a library clip), VALIDATE (no gaps or overlaps on the picture track). a_roll is [] when errors is not.
//   matchClip(lib, { path, name, duration }) -> { id, how: 'path' | 'name' } | { error }
//   readXmeml(text) -> { rate, video: [track], audio: [track] }, each track a list of items (clipitem, generatoritem, transitionitem)
//   importPlan(planFile, cutFile, { lib, probe }) -> importCut's result plus { ok, file, check }; writes <plan>.imported.json
//     (the plan with a_roll replaced; every range has tighten: false) and never touches the original plan.
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { probe as realProbe, readJSON, writeJSON } from './common.mjs';
import { parseEDL } from './edl.mjs';
import { loadLibrary } from './library.mjs';
import { loadPlan, resolvePlan } from './plan.mjs';
import { framesToTC, rateOf, tcToFrames } from './timecode.mjs';
import { all, kid, kids, parseXML, txt } from './xml.mjs';

const KNOWN_EFFECTS = ['Basic Motion', 'Audio Levels'];
const SPEED = 'speed change or time remap is not supported (the build cuts at normal speed)';
const NOT_AFTER = 'cut straight between clips; the build adds its own transitions';

const norm = (p) => { const r = resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
const num = (n, name) => Number(txt(n, name));
const rateFrom = (n) => { const tb = num(n, 'timebase'); return rateOf(txt(n, 'ntsc').toUpperCase() === 'TRUE' ? tb * 1000 / 1001 : tb); };
const fileOf = (url) => { const p = decodeURIComponent(url.replace(/^file:\/\/(localhost)?/i, '')); return /^\/[A-Za-z]:/.test(p) ? p.slice(1) : p; };

// ---- xmeml: read the file
export function readXmeml(text) {
  let doc;
  try { doc = parseXML(text); } catch (e) { throw new Error(`can't read the XML: ${e.message}`); }
  const sequence = doc.name === 'sequence' ? doc : all(doc, 'sequence')[0];
  if (!sequence) throw new Error('no sequence found in the XML (export a sequence, not a bin)');
  const rate = rateFrom(kid(sequence, 'rate'));
  const described = new Map(all(doc, 'file').filter((f) => f.children.length).map((f) => [f.attrs.id, f]));
  const fileInfo = (f) => {
    const full = f && (f.children.length ? f : described.get(f.attrs.id));
    if (!full) return null;
    const r = kid(full, 'rate') ? rateFrom(kid(full, 'rate')) : rate;
    return { name: txt(full, 'name'), path: txt(full, 'pathurl') ? fileOf(txt(full, 'pathurl')) : '', duration: num(full, 'duration') / r.fps };
  };
  const item = (n) => {
    const filters = kids(n, 'filter').map((f) => kid(f, 'effect')).filter(Boolean).map((e) => ({ name: txt(e, 'name'), id: txt(e, 'effectid'), params: Object.fromEntries(kids(e, 'parameter').map((p) => [txt(p, 'parameterid'), txt(p, 'value')])) }));
    const speed = kid(n, 'speed');
    return { kind: n.name, name: txt(n, 'name') || txt(kid(n, 'effect') || n, 'name'), start: num(n, 'start'), end: num(n, 'end'), in: num(n, 'in'), out: num(n, 'out'),
      rate: kid(n, 'rate') ? rateFrom(kid(n, 'rate')) : rate, file: fileInfo(kid(n, 'file')), nested: !!kid(n, 'sequence'), filters,
      retimed: (speed && Math.abs(parseFloat(speed.text) - 100) > 0.01) || filters.some((f) => /time ?remap/i.test(f.name + f.id)) };
  };
  const media = kid(sequence, 'media') || { children: [] };
  const read = (kind) => kids(kid(media, kind) || { children: [] }, 'track').map((t) => t.children.filter((c) => /^(clipitem|generatoritem|transitionitem)$/.test(c.name)).map(item));
  return { rate, video: read('video'), audio: read('audio') };
}

// ---- PARSE: xmeml -> events. An event: { where, start, end (record frames), srcIn, srcOut (frames at srcRate), srcRate,
// ref, bad, timeline }. bad events are never matched; timeline false keeps an item out of the gap check.
function parseXmeml(text) {
  const x = readXmeml(text), errors = [], warnings = [];
  const useV = !!x.video[0]?.length, label = useV ? 'V1' : 'A1', items = (useV ? x.video[0] : x.audio[0]) || [];
  const tc = (f) => framesToTC(f, x.rate);
  const events = items.map((it, i) => {
    const where = `${label} ${it.kind === 'transitionitem' ? 'transition' : 'clip'} ${i + 1}${it.name ? ` ("${it.name}")` : ''}`;
    const e = { where, start: it.start, end: it.end, srcIn: it.in, srcOut: it.out, srcRate: it.rate, ref: it.file, bad: false, timeline: it.kind !== 'transitionitem' };
    const reject = (m) => { errors.push(`${where}: ${m}`); e.bad = true; };
    if (it.kind === 'transitionitem') reject(`transitions are not supported (${NOT_AFTER})`);
    else if (it.kind === 'generatoritem') reject('generators and titles are not supported on V1 (use the original footage)');
    else if (it.nested) reject('nested sequences are not supported (flatten the nesting to the original clips)');
    else {
      const implied = it.start >= 0 && it.end >= 0 && Math.abs((it.out - it.in) / it.rate.fps - (it.end - it.start) / x.rate.fps) > 1 / x.rate.fps + 1e-6;
      if (it.retimed || implied) reject(SPEED);
      for (const f of it.filters) if (!KNOWN_EFFECTS.includes(f.name) && !/time ?remap/i.test(f.name + f.id)) reject(`effect "${f.name}" is not supported (only ${KNOWN_EFFECTS.join(' and ')} are read)`);
      if (!e.ref) reject('has no media to match');
    }
    return e;
  });
  const scales = items.flatMap((it) => it.filters.filter((f) => f.name === 'Basic Motion' && f.params.scale).map((f) => Number(f.params.scale)));
  if (scales.length && Math.max(...scales) - Math.min(...scales) > 0.01) warnings.push('Basic Motion scale differs between V1 clips; punch-ins are recomputed by the build, so the scale is ignored');
  if (useV) {
    const picture = items.filter((it) => it.kind === 'clipitem'), tol = 1 / x.rate.fps + 1e-6;
    for (const a of (x.audio[0] || []).filter((it) => it.kind === 'clipitem')) {
      const aligned = picture.some((p) => Math.abs(p.start - a.start) <= 1 && Math.abs(p.end - a.end) <= 1 && Math.abs(p.in / p.rate.fps - a.in / a.rate.fps) <= tol);
      if (!aligned) warnings.push(`A1 clip "${a.name}" at ${tc(a.start)} does not line up with V1; audio follows picture (split edits are ignored)`);
    }
  }
  return { rate: x.rate, df: false, label, origin: 0, events, errors, warnings };
}

// ---- PARSE: EDL -> events
function parseEdlCut(text, fps) {
  const e = parseEDL(text), errors = [], warnings = [];
  const df = /^DROP/.test(e.fcm), rate = rateOf(fps), opt = df ? { df: true } : {};
  const f = (s) => tcToFrames(s, rate, opt);
  const isPicture = (v) => /[VB]/.test(v.track.toUpperCase());
  const picture = e.events.filter(isPicture);
  const used = picture.length ? picture : e.events;
  const events = used.map((v) => {
    const where = `event ${v.n} (reel ${v.reel})`;
    const ev = { where, start: f(v.recIn), end: f(v.recOut), srcIn: f(v.srcIn), srcOut: f(v.srcOut), srcRate: rate, edl: true, bad: false, timeline: true,
      ref: { name: v.clipName || (v.sourceFile && basename(v.sourceFile)) || v.reel, path: v.sourceFile } };
    const reject = (m) => { errors.push(`${where}: ${m}`); ev.bad = true; };
    if (v.reel.toUpperCase() === 'BL') reject('black (reel BL) is a gap or generator, not footage');
    if (v.trans !== 'C') reject(`transition ${v.trans} (dissolve, wipe or key) is not supported (${NOT_AFTER})`);
    if (v.speed) reject(SPEED);
    return ev;
  });
  if (picture.length) for (const a of e.events.filter((v) => !isPicture(v))) {
    if (!picture.some((p) => p.recIn === a.recIn && p.recOut === a.recOut && p.srcIn === a.srcIn && p.srcOut === a.srcOut)) warnings.push(`audio event ${a.n} at ${a.recIn} does not line up with picture; audio follows picture (split edits are ignored)`);
  }
  return { rate, df, label: 'The EDL', origin: events.length ? Math.min(...events.map((x) => x.start)) : 0, events, errors, warnings };
}

// ---- MATCH
export function matchClip(lib, ref) {
  const clips = Object.values(lib.clips);
  if (ref.path) {
    const hit = clips.find((c) => norm(c.file) === norm(ref.path));
    if (hit) return { id: hit.id, how: 'path' };
  }
  const name = ref.name || basename(ref.path || '');
  const near = clips.filter((c) => basename(c.file).toLowerCase() === name.toLowerCase() && (ref.duration == null || Math.abs(c.duration - ref.duration) <= 0.5));
  if (near.length === 1) return { id: near[0].id, how: 'name' };
  if (near.length) return { error: `"${name}" matches more than one library clip: ${near.map((c) => `${c.id} (${c.file})`).join(', ')}; relink the clip to the original file` };
  return { error: `no library clip matches "${name}"${ref.path ? ` (${ref.path})` : ''}; index the original file (node longform.mjs index) or relink to it` };
}

function matchEvents(events, lib, probe) {
  const errors = [], ranges = [], offsets = new Map();
  const offsetOf = (file, fallback) => {
    if (!offsets.has(file)) {
      const p = probe(file), r = rateOf(p.fps || fallback);
      offsets.set(file, p.tc ? tcToFrames(p.tc, r) / r.fps : 0);
    }
    return offsets.get(file);
  };
  for (const e of events.filter((x) => !x.bad)) {
    const m = matchClip(lib, e.ref);
    if (m.error) { errors.push(`${e.where}: ${m.error}`); continue; }
    const shift = e.edl ? offsetOf(lib.clips[m.id].file, e.srcRate.fps) : 0;
    ranges.push({ clip: m.id, from: +(e.srcIn / e.srcRate.fps - shift).toFixed(3), to: +(e.srcOut / e.srcRate.fps - shift).toFixed(3), tighten: false });
  }
  return { errors, ranges };
}

// ---- VALIDATE: the picture track must run back to back from the start
function validateTimeline({ events, rate, df, label, origin }) {
  const errors = [], line = events.filter((e) => e.timeline).sort((a, b) => a.start - b.start);
  const tc = (f) => framesToTC(f, rate, { df });
  let at = origin;
  for (const e of line) {
    if (e.start > at) errors.push(`${label} has a gap of ${e.start - at} frames at ${tc(at)} (close it in the editor, or the cut will not match)`);
    else if (e.start < at) errors.push(`${label} has an overlap of ${at - e.start} frames at ${tc(e.start)} (trim it in the editor, or the cut will not match)`);
    at = e.end;
  }
  return errors;
}

export function importCut(text, kind, lib, { fps = 30, probe = realProbe } = {}) {
  try {
    const parsed = kind === 'edl' ? parseEdlCut(text, fps) : parseXmeml(text);
    if (!parsed.events.length) return { a_roll: [], errors: ['the cut has no V1 or A1 clips to import'], warnings: parsed.warnings };
    const matched = matchEvents(parsed.events, lib, probe);
    const errors = [...parsed.errors, ...matched.errors, ...validateTimeline(parsed)];
    return { a_roll: errors.length ? [] : matched.ranges, errors, warnings: parsed.warnings };
  } catch (e) {
    return { a_roll: [], errors: [e.message], warnings: [] };
  }
}

export function importPlan(planFile, cutFile, { lib = loadLibrary(), probe = realProbe } = {}) {
  const kind = /\.xml$/i.test(cutFile) ? 'xmeml' : /\.edl$/i.test(cutFile) ? 'edl' : null;
  if (!kind) return { ok: false, file: null, a_roll: [], errors: [`can't tell the format of "${basename(cutFile)}" (use .xml for xmeml or .edl)`], warnings: [], check: null };
  const plan = loadPlan(planFile), raw = readJSON(planFile);
  const res = importCut(readFileSync(cutFile, 'utf8'), kind, lib, { fps: plan.fps, probe });
  if (res.errors.length) return { ok: false, file: null, ...res, check: null };
  const file = join(dirname(resolve(planFile)), basename(planFile).replace(/\.json$/i, '') + '.imported.json');
  writeJSON(file, { ...raw, a_roll: res.a_roll });
  const warnings = [...res.warnings];
  (raw.inserts || []).forEach((ins, i) => {
    if (typeof ins.at === 'number') warnings.push(`inserts[${i}]${ins.id ? ` (${ins.id})` : ''} is placed at ${ins.at}s of output time; the new cut can differ, so it will not move with the speech (anchor it to a word with clip#sentence instead)`);
  });
  const R = resolvePlan(loadPlan(file), lib, { autoBroll: false });
  return { ok: !R.errors.length, file, a_roll: res.a_roll, errors: [], warnings, check: { errors: R.errors, warnings: R.warnings } };
}
