// refine/contract.mjs: the Visual Refinement Contract v1, shared byte-for-byte by
// motion-factory-kit (refine/contract.mjs) and studio-engine (src/visual-refinement-contract.mjs),
// with a Python port in motion-factory (visual_contract.py) that produces identical hashes.
//
// Dependency-free on purpose (node:crypto only) so the same file can be copied between repos.
// The JSON description of the same shapes is refine/visual-refinement-contract.v1.json.
//
// What it defines:
//   - the contract a refinement run is bound to (shot, lookdev references, design targets, budget)
//   - the frame exchange record (stills and ordered sequences) passed between daily.py,
//     mcp/server.mjs and studio-engine
//   - canonical JSON + sha256 hashing, and the state hash that chains iterations together
//   - the critique record an isolated critic returns, and its validation (qualitative verdicts,
//     evidence required, numeric "quality scores" refused)
//
// It never decides that something looks good. It only checks that the evidence a decision needs
// exists, is complete, and is bound to the exact code + output it talks about.
import { createHash } from 'node:crypto';

export const CONTRACT_NAME = 'visual-refinement-contract';
export const CONTRACT_VERSION = '1.0.0';

// The seven creative criteria. studio-engine's creative-judgment.mjs owns their wording and pass
// rules (VISUAL_CRITERIA); this list is the id set every repo must agree on.
export const CRITERIA = Object.freeze([
  'composition',      // composition & visual hierarchy
  'lighting',         // lighting, contrast & atmospheric depth
  'materials',        // material believability
  'spatial',          // scale, perspective & spatial coherence
  'color',            // colour harmony
  'narrative',        // narrative purpose
  'originality',      // originality & avoidance of generic "programmer-art" defaults
]);

export const REFERENCE_SOURCES = Object.freeze(['google-stitch', 'moodboard', 'concept-art', 'photograph', 'procedural-lookdev', 'paintover']);
export const REFERENCE_ROLES = Object.freeze(['establishing', 'hero', 'macro', 'mood', 'palette', 'detail', 'other']);
export const STEPS = Object.freeze([
  'target-ingestion', 'initial-render', 'technical-check', 'visual-inspection', 'rubric-evaluation',
  'delta-identification', 'code-adjustment', 'hash-reverification', 'approval-gate',
]);
export const DEFAULT_BUDGET = Object.freeze({ maxIterations: 6, maxTemporalIterations: 3, convergenceDelta: 0.015, patience: 2 });
export const HASH_RE = /^[0-9a-f]{64}$/;

// ---- canonical JSON + hashing -----------------------------------------------------------------
// Sorted keys, no whitespace, numbers in JavaScript's shortest round-trip form. Non-finite numbers,
// undefined, functions and symbols are refused rather than silently dropped, so two runtimes can't
// disagree about what was hashed.
export function canonical(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'string': return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonical JSON refuses non-finite numbers');
      return Object.is(value, -0) ? '0' : String(value);
    case 'object': {
      if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
      const keys = Object.keys(value).sort();
      return '{' + keys.map((k) => {
        if (value[k] === undefined) throw new TypeError(`canonical JSON refuses undefined at "${k}"`);
        return JSON.stringify(k) + ':' + canonical(value[k]);
      }).join(',') + '}';
    }
    default: throw new TypeError(`canonical JSON refuses ${typeof value}`);
  }
}

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const hashJson = (value) => sha256(canonical(value));

// The identity of one iteration: what it was bound to, what code made it, what it produced, and
// which state it came from. Changing any of them changes the hash, so an approval can't be moved
// onto different code or a different render.
export function stateHash({ contractHash, codeHash, paramsHash, outputHash, parent = null, phase = 'still' }) {
  for (const [k, v] of Object.entries({ contractHash, codeHash, paramsHash, outputHash })) {
    if (!HASH_RE.test(String(v))) throw new TypeError(`stateHash needs a sha256 ${k}`);
  }
  if (parent !== null && !HASH_RE.test(parent)) throw new TypeError('stateHash parent must be a sha256 or null');
  if (!['still', 'temporal'].includes(phase)) throw new TypeError('phase must be still or temporal');
  return hashJson({ v: CONTRACT_VERSION, contractHash, codeHash, paramsHash, outputHash, parent, phase });
}

// The output hash of a frame set: the ordered (t, sha256) pairs, so reordering frames changes it.
export function framesHash(frames) {
  return hashJson(frames.map((f) => ({ t: f.t, sha256: f.sha256 })));
}

// ---- validation helpers -----------------------------------------------------------------------
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v, max = 4000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const safeRel = (p) => str(p, 500) && !p.startsWith('/') && !/^[a-zA-Z]:/.test(p) && !p.split(/[\\/]/).includes('..');

// ---- the contract -----------------------------------------------------------------------------
export function validateContract(c) {
  const errors = [];
  const e = (m) => errors.push(m);
  if (!isObj(c)) return { ok: false, errors: ['contract must be an object'] };
  if (c.contract !== CONTRACT_NAME) e(`contract must be "${CONTRACT_NAME}"`);
  if (c.version !== CONTRACT_VERSION) e(`version must be ${CONTRACT_VERSION}`);
  const s = c.shot;
  if (!isObj(s)) e('shot is required');
  else {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(s.id))) e('shot.id must be a lowercase slug');
    if (!safeRel(s.scene)) e('shot.scene must be a relative path inside the repo');
    if (!num(s.durationS) || s.durationS <= 0 || s.durationS > 600) e('shot.durationS must be in (0, 600]');
    if (!Number.isInteger(s.fps) || s.fps < 1 || s.fps > 120) e('shot.fps must be an integer 1-120');
    if (!Number.isInteger(s.width) || !Number.isInteger(s.height) || s.width < 16 || s.height < 16) e('shot.width/height must be integers >= 16');
    if (!str(s.brief, 4000)) e('shot.brief (the creative intent, in words) is required');
  }
  const refs = c.references;
  if (!Array.isArray(refs) || refs.length === 0) e('at least one lookdev reference plate is required');
  else {
    const ids = new Set();
    refs.forEach((r, i) => {
      const tag = `references[${i}]`;
      if (!isObj(r)) return e(`${tag} must be an object`);
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(r.id))) e(`${tag}.id must be a slug`);
      if (ids.has(r.id)) e(`${tag}.id "${r.id}" is duplicated`);
      ids.add(r.id);
      if (!REFERENCE_ROLES.includes(r.role)) e(`${tag}.role must be one of ${REFERENCE_ROLES.join(', ')}`);
      if (!REFERENCE_SOURCES.includes(r.source)) e(`${tag}.source must be one of ${REFERENCE_SOURCES.join(', ')}`);
      if (!safeRel(r.path) || !/\.(png|jpe?g)$/i.test(r.path)) e(`${tag}.path must be a relative .png/.jpg path`);
      if (!HASH_RE.test(String(r.sha256))) e(`${tag}.sha256 must be the plate's sha256 (ingest it first)`);
      if (!Number.isInteger(r.width) || !Number.isInteger(r.height)) e(`${tag}.width/height are required`);
    });
  }
  const kf = c.keyframes;
  if (!Array.isArray(kf) || kf.length === 0) e('keyframes: map each reference to at least one shot time');
  else {
    const refIds = new Set((refs || []).map((r) => r && r.id));
    kf.forEach((k, i) => {
      if (!isObj(k)) return e(`keyframes[${i}] must be an object`);
      if (!num(k.t) || k.t < 0 || (isObj(s) && num(s.durationS) && k.t >= s.durationS)) e(`keyframes[${i}].t must be inside the shot`);
      if (!refIds.has(k.reference)) e(`keyframes[${i}].reference "${k.reference}" is not a declared reference`);
    });
    for (const id of refIds) if (!kf.some((k) => k && k.reference === id)) e(`reference "${id}" is not mapped to any keyframe`);
  }
  if (c.design !== undefined) {
    if (!isObj(c.design)) e('design must be an object');
    else {
      if (c.design.doc !== undefined && !safeRel(c.design.doc)) e('design.doc must be a relative path');
      if (c.design.doc !== undefined && !HASH_RE.test(String(c.design.sha256))) e('design.sha256 is required with design.doc');
      if (c.design.targets !== undefined && !isObj(c.design.targets)) e('design.targets must be an object of metric targets');
      for (const [k, t] of Object.entries(c.design.targets || {})) {
        if (!isObj(t) || !(num(t.min) || num(t.max) || num(t.value))) e(`design.targets.${k} needs min, max or value`);
      }
    }
  }
  if (c.params !== undefined && !isObj(c.params)) e('params must be an object (the scene\'s M.data values)');
  const b = { ...DEFAULT_BUDGET, ...(c.budget || {}) };
  if (!Number.isInteger(b.maxIterations) || b.maxIterations < 1 || b.maxIterations > 50) e('budget.maxIterations must be 1-50');
  if (!Number.isInteger(b.maxTemporalIterations) || b.maxTemporalIterations < 0 || b.maxTemporalIterations > 20) e('budget.maxTemporalIterations must be 0-20');
  if (!num(b.convergenceDelta) || b.convergenceDelta < 0 || b.convergenceDelta > 1) e('budget.convergenceDelta must be in [0, 1]');
  if (!Number.isInteger(b.patience) || b.patience < 1) e('budget.patience must be >= 1');
  const crit = c.criteria ?? CRITERIA;
  if (!Array.isArray(crit) || crit.some((x) => !CRITERIA.includes(x)) || new Set(crit).size !== crit.length) e(`criteria must be a subset of ${CRITERIA.join(', ')}`);
  const auth = c.authorization || {};
  for (const k of ['paidApi', 'publish', 'deploy', 'merge']) {
    if (auth[k] !== undefined && typeof auth[k] !== 'boolean') e(`authorization.${k} must be boolean`);
  }
  return { ok: errors.length === 0, errors };
}

// Fill defaults so the hashed form is explicit about every value that governs the run.
export function normalizeContract(c) {
  return {
    ...c,
    budget: { ...DEFAULT_BUDGET, ...(c.budget || {}) },
    criteria: [...(c.criteria ?? CRITERIA)],
    params: c.params || {},
    authorization: { paidApi: false, publish: false, deploy: false, merge: false, ...(c.authorization || {}) },
  };
}

// ---- frame exchange ---------------------------------------------------------------------------
// One record shape for a still set or an ordered sequence, whichever process produced it.
export function validateFrames(rec) {
  const errors = [];
  if (!isObj(rec)) return { ok: false, errors: ['frames record must be an object'] };
  if (!['still', 'sequence'].includes(rec.kind)) errors.push('kind must be still or sequence');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(rec.shotId))) errors.push('shotId must be a slug');
  if (!Number.isInteger(rec.iteration) || rec.iteration < 1) errors.push('iteration must be >= 1');
  if (!Array.isArray(rec.frames) || rec.frames.length === 0) errors.push('frames must be a non-empty array');
  else {
    let last = -Infinity;
    rec.frames.forEach((f, i) => {
      if (!isObj(f)) return errors.push(`frames[${i}] must be an object`);
      if (!num(f.t) || f.t < 0) errors.push(`frames[${i}].t must be seconds >= 0`);
      if (rec.kind === 'sequence' && !(f.t > last)) errors.push(`frames[${i}] is out of order: sequences must be strictly increasing in t`);
      last = f.t;
      if (!safeRel(f.path)) errors.push(`frames[${i}].path must be relative`);
      if (!HASH_RE.test(String(f.sha256))) errors.push(`frames[${i}].sha256 is required`);
      if (!Number.isInteger(f.width) || !Number.isInteger(f.height)) errors.push(`frames[${i}].width/height are required`);
      if (f.reference !== null && f.reference !== undefined && typeof f.reference !== 'string') errors.push(`frames[${i}].reference must be a reference id or null`);
    });
  }
  if (rec.outputHash !== undefined && Array.isArray(rec.frames) && rec.outputHash !== framesHash(rec.frames)) errors.push('outputHash does not match the frames');
  return { ok: errors.length === 0, errors };
}

// ---- critique records -------------------------------------------------------------------------
// The isolated critic answers each criterion with a verdict and the evidence it looked at. Numbers
// that pretend to measure quality ("8.7/10 cinematic") are refused: the record is a delta log.
const BANNED_CLAIMS = /cinematic excellence|award[- ]winning|perfect(ly)? (cinematic|lit|composed)|10\/10|masterpiece/i;
const SCORE_KEYS = /^(score|rating|grade|stars|points|percent|quality)$/i;

function findNumbers(v, path = '', out = []) {
  if (typeof v === 'number') out.push(path || '(root)');
  else if (Array.isArray(v)) v.forEach((x, i) => findNumbers(x, `${path}[${i}]`, out));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) {
    if (SCORE_KEYS.test(k)) out.push(`${path ? path + '.' : ''}${k}`);
    findNumbers(x, path ? `${path}.${k}` : k, out);
  }
  return out;
}

export function validateCritique(rec, { criteria = CRITERIA, outputHash = null, packetHash = null, evidenceIds = null } = {}) {
  const errors = [];
  const e = (m) => errors.push(m);
  if (!isObj(rec)) return { ok: false, errors: ['critique must be an object'] };
  const critic = rec.critic;
  if (!isObj(critic) || !str(critic.id, 200)) e('critic.id is required');
  else {
    if (critic.context !== 'isolated') e('critic.context must be "isolated": critiques run in a separate context from the code');
    if (critic.sawSourceCode !== false) e('critic.sawSourceCode must be false');
  }
  if (outputHash && rec.outputHash !== outputHash) e('critique is bound to a different output (outputHash mismatch)');
  if (!HASH_RE.test(String(rec.outputHash))) e('critique.outputHash is required');
  if (packetHash && rec.packetHash !== packetHash) e('critique is bound to a different packet (packetHash mismatch)');
  const numbers = findNumbers(rec.criteria);
  if (numbers.length) e(`numeric quality scores are not accepted (found at ${numbers.slice(0, 5).join(', ')}); use verdicts and observations`);
  if (!isObj(rec.criteria)) e('criteria must be an object keyed by criterion id');
  else {
    for (const id of criteria) {
      const c = rec.criteria[id];
      const tag = `criteria.${id}`;
      if (!isObj(c)) { e(`${tag} is missing`); continue; }
      if (!['pass', 'fail'].includes(c.verdict)) e(`${tag}.verdict must be "pass" or "fail"`);
      if (!str(c.observation, 2000) || c.observation.trim().length < 20) e(`${tag}.observation must describe what was seen (20+ chars)`);
      if (!Array.isArray(c.evidence) || c.evidence.length === 0 || c.evidence.some((x) => !str(x, 200))) e(`${tag}.evidence must list the frames/references looked at`);
      else if (evidenceIds) for (const x of c.evidence) if (!evidenceIds.includes(x)) e(`${tag}.evidence "${x}" is not in the critique packet`);
      if (c.verdict === 'fail' && !str(c.correction, 1000)) e(`${tag}: a fail needs a proposed correction`);
      if ([c.observation, c.delta, c.correction].some((x) => typeof x === 'string' && BANNED_CLAIMS.test(x))) e(`${tag}: unsupported superlative quality claim; describe the visual delta instead`);
    }
    for (const id of Object.keys(rec.criteria)) if (!CRITERIA.includes(id)) e(`criteria.${id} is not a known criterion`);
  }
  if (typeof rec.summary === 'string' && BANNED_CLAIMS.test(rec.summary)) e('summary: unsupported superlative quality claim');
  return { ok: errors.length === 0, errors };
}

export function critiquePasses(rec, criteria = CRITERIA) {
  return criteria.every((id) => rec?.criteria?.[id]?.verdict === 'pass');
}
