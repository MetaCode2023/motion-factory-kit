// refine/loop.mjs: the autonomous closed-loop visual refinement engine.
//
// One run refines one shot against its lookdev reference plates, still-first:
//
//   1 target-ingestion    contract validated, plates copied, hashed and measured
//   2 initial-render      render.mjs stills at every keyframe mapped to a plate
//   3 technical-check     render errors, size, decode, fallback textures, zero variance
//   4 visual-inspection   frames + render|reference comparisons packed for an isolated critic
//   5 rubric-evaluation   the critic's verdicts on the 7 criteria, cross-checked with measurements
//   6 delta-identification measured + observed gaps, as a delta log
//   7 code-adjustment     the next iteration's params/scene change, recorded with what was suggested
//   8 hash-reverification code + params + output re-hashed and chained to the previous state
//   9 approval-gate       an approval exists only for the exact state that passed
//
// then Phase 4 on the approved look: a low-res motion preview, temporal artifact checks, sampled
// keyframes for the critic, and loopback to stills when the look itself has to change.
//
// The engine never judges the picture itself and never calls a paid API. A saved PNG, a valid
// MP4 or a passing metric is never treated as visual approval: the gate needs an isolated
// critique bound to the output hash. Everything is written under out/refine/<shot>/ so a run can
// be resumed, audited, restored and exported as an evidence bundle.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';
import ffmpegPath from 'ffmpeg-static';
import {
  CONTRACT_VERSION, CRITERIA, STEPS, canonical, critiquePasses, framesHash, hashJson, normalizeContract,
  sha256, stateHash, validateContract, validateCritique, validateFrames,
} from './contract.mjs';
import { falseSuccess, loadPixels, measure } from './pixels.mjs';
import { checkTargets, compareToReference, deltaLog, distance, genericity, suggestAdjustments } from './delta.mjs';
import { analyzeSequence, decodeGray, keyframeTimes, probe } from './temporal.mjs';

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SPEC = JSON.parse(readFileSync(join(ROOT, 'refine', 'visual-refinement-contract.v1.json'), 'utf8'));
const STILL_LOOK = new Set(['composition', 'lighting', 'materials', 'spatial', 'color']);
const HARD_GAP = 2;          // a measured gap beyond 2x tolerance fails its criterion whatever the critic says
const TECH_BLOCKER = 3;      // consecutive technical failures before a human is asked

FontLibrary.use('Refine', [join(ROOT, 'fonts', 'plus-jakarta-sans-latin-600-normal.woff2')]);

// ---- small helpers ----------------------------------------------------------------------------
const pad = (n) => String(n).padStart(3, '0');
const now = () => new Date().toISOString();
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
function writeJson(p, v) { mkdirSync(dirname(p), { recursive: true }); const tmp = p + '.tmp'; writeFileSync(tmp, JSON.stringify(v, null, 2) + '\n'); renameSync(tmp, p); }
const fileSha = (p) => sha256(readFileSync(p));
function inside(root, p) {
  const a = isAbsolute(p) ? p : join(root, p);
  const r = relative(root, a);
  if (r.startsWith('..') || isAbsolute(r)) throw new Error(`path outside ${root}: ${p}`);
  return a;
}
const tname = (t) => t.toFixed(3).replace('.', '_');

export class RefineError extends Error {
  constructor(message, code = 'refused') { super(message); this.code = code; }
}

// ---- run state --------------------------------------------------------------------------------
export function runPaths(runDir) {
  return {
    contract: join(runDir, 'contract.json'), status: join(runDir, 'status.json'), chain: join(runDir, 'chain.json'),
    refs: join(runDir, 'references'), iterations: join(runDir, 'iterations'), temporal: join(runDir, 'temporal'),
    approval: join(runDir, 'approval-still.json'), approvalTemporal: join(runDir, 'approval-temporal.json'),
    escalations: join(runDir, 'escalations.json'), final: join(runDir, 'final.json'),
  };
}
export const defaultRunDir = (shotId, root = ROOT) => join(root, 'out', 'refine', shotId);

function load(runDir) {
  const P = runPaths(runDir);
  if (!existsSync(P.status)) throw new RefineError(`no refinement run at ${runDir}; call init first`, 'no-run');
  return { P, status: readJson(P.status), contract: readJson(P.contract), chain: existsSync(P.chain) ? readJson(P.chain) : [] };
}
function event(status, step, detail = {}) {
  status.log.push({ at: now(), step, ...detail });
}
function save(runDir, status, chain) {
  const P = runPaths(runDir);
  writeJson(P.status, status);
  if (chain) writeJson(P.chain, chain);
}
function escalate(runDir, status, reason, detail) {
  const P = runPaths(runDir);
  const list = existsSync(P.escalations) ? readJson(P.escalations) : [];
  const rec = { at: now(), reason, phase: status.phase, iteration: status.iteration, temporalIteration: status.temporalIteration, detail, needs: 'human' };
  list.push(rec);
  writeJson(P.escalations, list);
  status.state = 'escalated';
  status.escalation = rec;
  event(status, 'escalation', { reason, detail });
  save(runDir, status);
  return rec;
}

// The code identity of a scene: its own bytes plus every local script it loads (motion.js, blocks,
// brand), in load order.
export function codeHashOf(scenePath, root = ROOT) {
  const html = readFileSync(scenePath, 'utf8');
  const deps = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]).filter((s) => !/^[a-z]+:/i.test(s));
  const parts = [{ path: relative(root, scenePath).split('\\').join('/'), sha256: sha256(html) }];
  for (const d of deps) {
    const p = resolve(dirname(scenePath), d);
    if (existsSync(p)) parts.push({ path: relative(root, p).split('\\').join('/'), sha256: fileSha(p) });
    else parts.push({ path: d, sha256: null, missing: true });
  }
  return { codeHash: hashJson(parts), parts };
}

// What a contract author calls before writing a reference into the contract.
export async function ingestReference(path) {
  const px = await loadPixels(path);
  return { sha256: fileSha(path), width: px.sourceWidth, height: px.sourceHeight };
}

// ---- step 1: target ingestion -----------------------------------------------------------------
export async function init({ contract, runDir = null, root = ROOT }) {
  const v = validateContract(contract);
  if (!v.ok) throw new RefineError('invalid contract:\n- ' + v.errors.join('\n- '), 'invalid-contract');
  const C = normalizeContract(contract);
  runDir = runDir ? inside(root, runDir) : defaultRunDir(C.shot.id, root);
  const P = runPaths(runDir);
  const contractHash = hashJson(C);
  if (existsSync(P.status)) {
    const old = readJson(P.status);
    if (old.contractHash !== contractHash) throw new RefineError(`a different contract already owns ${relative(root, runDir)}; use a new shot id or directory`, 'contract-conflict');
    return { runDir, contractHash, resumed: true, status: old };
  }
  inside(root, C.shot.scene);
  if (!existsSync(join(root, C.shot.scene))) throw new RefineError(`scene not found: ${C.shot.scene}`, 'invalid-contract');
  mkdirSync(P.refs, { recursive: true });
  const references = [];
  for (const r of C.references) {
    const src = inside(root, r.path);
    if (!existsSync(src)) throw new RefineError(`reference plate missing: ${r.path}`, 'invalid-contract');
    const sha = fileSha(src);
    if (sha !== r.sha256) throw new RefineError(`reference ${r.id} changed since it was declared (sha256 ${sha.slice(0, 12)} != ${r.sha256.slice(0, 12)})`, 'reference-mismatch');
    const dest = join(P.refs, `${r.id}${extname(src).toLowerCase()}`);
    copyFileSync(src, dest);
    const px = await loadPixels(dest);
    if (px.sourceWidth !== r.width || px.sourceHeight !== r.height) throw new RefineError(`reference ${r.id} is ${px.sourceWidth}x${px.sourceHeight}, contract says ${r.width}x${r.height}`, 'reference-mismatch');
    const aspect = px.sourceWidth / px.sourceHeight, shotAspect = C.shot.width / C.shot.height;
    const m = measure(px);
    const bad = falseSuccess(m);
    if (bad.length) throw new RefineError(`reference ${r.id} is not a usable plate: ${bad.join('; ')}`, 'reference-mismatch');
    writeJson(join(P.refs, `${r.id}.metrics.json`), m);
    references.push({ id: r.id, role: r.role, source: r.source, file: relative(runDir, dest).split('\\').join('/'), sha256: sha, aspectMatches: Math.abs(aspect - shotAspect) < 0.02 });
  }
  if (C.design?.doc) {
    const d = inside(root, C.design.doc);
    if (!existsSync(d) || fileSha(d) !== C.design.sha256) throw new RefineError('design.doc is missing or changed since it was declared', 'reference-mismatch');
    copyFileSync(d, join(runDir, 'DESIGN.md'));
  }
  writeJson(P.contract, C);
  const status = {
    contract: 'visual-refinement-contract', version: CONTRACT_VERSION, shotId: C.shot.id, contractHash,
    state: 'ready', phase: 'still', iteration: 0, temporalIteration: 0, technicalFailures: 0,
    params: C.params, restoredFrom: null, distances: [], log: [],
  };
  event(status, STEPS[0], { references: references.map((r) => ({ id: r.id, role: r.role, source: r.source, sha256: r.sha256, aspectMatches: r.aspectMatches })) });
  save(runDir, status, []);
  return { runDir, contractHash, resumed: false, status, references };
}

// ---- rendering --------------------------------------------------------------------------------
function node(args, { timeoutMs = 10 * 60 * 1000, cwd = ROOT } = {}) {
  return new Promise((done) => {
    // Renders get no credentials: the same allowlist idea as daily.py's sandbox.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/KEY|TOKEN|SECRET|PASSWORD|ANTHROPIC|ELEVENLABS|BWS_|CLOUDFLARE/i.test(k)));
    const c = spawn(process.execPath, args, { cwd, env });
    let out = '', err = '';
    const timer = setTimeout(() => c.kill('SIGKILL'), timeoutMs);
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('close', (code) => { clearTimeout(timer); done({ code, out, err }); });
  });
}

async function renderStills(root, scene, times, params, dir) {
  mkdirSync(dir, { recursive: true });
  const dataFile = join(dir, 'params.json');
  writeJson(dataFile, params);
  const results = [];
  for (const t of times) {
    const out = join(dir, `frame-${tname(t)}.png`);
    rmSync(out, { force: true });
    const r = await node([join(root, 'render.mjs'), join(root, scene), '--still', String(t), '--out', out, '--data', dataFile]);
    results.push({ t, path: out, ok: r.code === 0 && existsSync(out), error: r.code === 0 ? null : (r.err || r.out).trim().split('\n').slice(-12).join('\n') });
  }
  return results;
}

// Render | reference, labelled, for the critic.
async function sideBySide(renderPath, refPath, out, label) {
  const [a, b] = await Promise.all([loadImage(readFileSync(renderPath)), loadImage(readFileSync(refPath))]);
  const W = 960, h = Math.round(W * a.height / a.width), hb = Math.round(W * b.height / b.width), H = Math.max(h, hb) + 44;
  const c = new Canvas(W * 2 + 12, H);
  const x = c.getContext('2d');
  x.fillStyle = '#202020'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(a, 0, 44, W, h); x.drawImage(b, W + 12, 44, W, hb);
  x.fillStyle = '#e8e8e8'; x.font = '600 22px Refine';
  x.fillText(`RENDER  ${label.render}`, 12, 30); x.fillText(`REFERENCE  ${label.reference}`, W + 24, 30);
  writeFileSync(out, await c.toBuffer('png'));
}

// ---- steps 2-4 + 6 (measured): one still iteration --------------------------------------------
export async function iterate(runDir, { params = null, note = '', root = ROOT } = {}) {
  const { P, status, contract: C, chain } = load(runDir);
  if (['escalated', 'approved', 'approved-still', 'final'].includes(status.state)) {
    throw new RefineError(`run is ${status.state}; ${status.state === 'escalated' ? 'a human must resolve the escalation first' : 'nothing to refine'}`, status.state);
  }
  if (status.state === 'awaiting-critique') throw new RefineError(`iteration ${status.iteration} is waiting for its isolated critique; record it before rendering again`, 'awaiting-critique');
  if (status.phase !== 'still') throw new RefineError('the run is in the temporal phase; use temporal()', 'wrong-phase');
  const n = status.iteration + 1;
  if (n > C.budget.maxIterations) {
    const rec = escalate(runDir, status, 'budget-exhausted', `${C.budget.maxIterations} still iterations used without approval`);
    throw new RefineError(`budget exhausted (${C.budget.maxIterations} iterations); escalated to a human`, rec.reason);
  }
  const scenePath = inside(root, C.shot.scene);
  const nextParams = params ?? status.params;
  const { codeHash, parts } = codeHashOf(scenePath, root);
  const paramsHash = hashJson(nextParams);
  const prev = chain.filter((c) => c.phase === 'still').at(-1);
  // Step 7 of the previous iteration: what changed, and what the delta log suggested.
  if (prev) {
    const prevRec = readJson(join(P.iterations, pad(prev.n), 'record.json'));
    const changed = prevRec.codeHash !== codeHash || prevRec.paramsHash !== paramsHash;
    if (!changed && !status.restoredFrom) throw new RefineError('nothing changed since the last iteration: adjust params or the scene first (an iteration must change something)', 'no-change');
    const diff = Object.keys({ ...prevRec.params, ...nextParams }).filter((k) => canonical(prevRec.params[k] ?? null) !== canonical(nextParams[k] ?? null))
      .map((k) => ({ param: k, from: prevRec.params[k] ?? null, to: nextParams[k] ?? null }));
    prevRec.adjustment = { at: now(), note: String(note).slice(0, 2000), sceneChanged: prevRec.codeHash !== codeHash, params: diff, suggested: prevRec.suggestions?.moves || [], restoredFrom: status.restoredFrom };
    prevRec.steps.push({ step: STEPS[6], at: now(), detail: `${diff.length} param change(s)${prevRec.codeHash !== codeHash ? ' + scene code change' : ''}` });
    writeJson(join(P.iterations, pad(prev.n), 'record.json'), prevRec);
  }
  status.iteration = n;
  status.params = nextParams;
  const dir = join(P.iterations, pad(n));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'frames'), { recursive: true });
  copyFileSync(scenePath, join(dir, 'scene.html'));
  writeJson(join(dir, 'params.json'), nextParams);
  const rec = { n, phase: 'still', parent: prev?.stateHash ?? null, contractHash: status.contractHash, codeHash, code: parts, paramsHash, params: nextParams, sceneSha256: fileSha(scenePath), steps: [] };

  // Step 2: render a still at every keyframe.
  const times = C.keyframes.map((k) => k.t);
  const renders = await renderStills(root, C.shot.scene, times, nextParams, join(dir, 'frames'));
  rec.steps.push({ step: STEPS[1], at: now(), detail: `${renders.filter((r) => r.ok).length}/${renders.length} stills rendered` });

  // Step 3: technical check. A file existing is not a pass; it has to decode, be the right size
  // and not be a blank, fallback or copied frame.
  const refHashes = C.references.map((r) => r.sha256);
  const checks = [], metrics = [];
  for (const [i, r] of renders.entries()) {
    const k = C.keyframes[i];
    if (!r.ok) { checks.push({ t: r.t, ok: false, check: 'render', error: r.error }); continue; }
    const size = statSync(r.path).size;
    let px;
    try { px = await loadPixels(r.path); } catch (e) { checks.push({ t: r.t, ok: false, check: 'decode', error: e.message }); continue; }
    if (size === 0) { checks.push({ t: r.t, ok: false, check: 'size', error: 'zero-byte file' }); continue; }
    if (px.sourceWidth !== C.shot.width || px.sourceHeight !== C.shot.height) { checks.push({ t: r.t, ok: false, check: 'resolution', error: `${px.sourceWidth}x${px.sourceHeight}, contract wants ${C.shot.width}x${C.shot.height}` }); continue; }
    const m = measure(px);
    const sha = fileSha(r.path);
    const bad = falseSuccess(m, { referenceHashes: refHashes, sha });
    if (bad.length) { checks.push({ t: r.t, ok: false, check: 'false-success', error: bad.join('; ') }); continue; }
    checks.push({ t: r.t, ok: true });
    metrics.push({ t: r.t, reference: k.reference, sha256: sha, metrics: m, path: r.path });
  }
  const techOk = checks.every((c) => c.ok);
  rec.technical = { ok: techOk, checks };
  rec.steps.push({ step: STEPS[2], at: now(), detail: techOk ? 'all stills decode at contract resolution with no blank/fallback frames' : checks.filter((c) => !c.ok).map((c) => `t=${c.t} ${c.check}: ${String(c.error).split('\n')[0]}`).join('; ') });

  if (!techOk) {
    status.technicalFailures += 1;
    rec.outputHash = hashJson({ technicalFailure: checks });
    rec.stateHash = stateHash({ contractHash: status.contractHash, codeHash, paramsHash, outputHash: rec.outputHash, parent: rec.parent });
    rec.decision = 'technical-fail';
    writeJson(join(dir, 'record.json'), rec);
    chain.push({ n, phase: 'still', stateHash: rec.stateHash, parent: rec.parent, decision: rec.decision });
    status.state = 'needs-adjustment';
    status.restoredFrom = null;
    event(status, STEPS[2], { iteration: n, ok: false });
    save(runDir, status, chain);
    if (status.technicalFailures >= TECH_BLOCKER) escalate(runDir, status, 'technical-blocker', `${status.technicalFailures} consecutive iterations failed technical checks: ${checks.find((c) => !c.ok)?.error}`);
    else if (n >= C.budget.maxIterations) escalate(runDir, status, 'budget-exhausted', `${n} iterations used; the last failed technical checks`);
    return summary(runDir);
  }
  status.technicalFailures = 0;

  // Step 4: visual inspection capture. The frames are hashed in order: that is the output identity.
  const frames = metrics.map((m) => ({ t: m.t, path: relative(runDir, m.path).split('\\').join('/'), sha256: m.sha256, width: C.shot.width, height: C.shot.height, reference: m.reference }));
  const frameRec = { kind: 'still', shotId: C.shot.id, iteration: n, frames, outputHash: framesHash(frames) };
  const fv = validateFrames(frameRec);
  if (!fv.ok) throw new RefineError('frame record invalid: ' + fv.errors.join('; '), 'internal');
  writeJson(join(dir, 'frames.json'), frameRec);
  rec.outputHash = frameRec.outputHash;
  rec.stateHash = stateHash({ contractHash: status.contractHash, codeHash, paramsHash, outputHash: rec.outputHash, parent: rec.parent });

  // Step 6 (measured half): every frame against its plate and the DESIGN.md targets.
  const items = [];
  const perFrame = [];
  for (const m of metrics) {
    const refM = readJson(join(P.refs, `${m.reference}.metrics.json`));
    const fi = [...compareToReference(m.metrics, refM), ...checkTargets(m.metrics, C.design?.targets), ...genericity(m.metrics)].map((x) => ({ ...x, t: m.t, reference_id: m.reference }));
    items.push(...fi);
    perFrame.push({ t: m.t, reference: m.reference, metrics: m.metrics, distance: distance(fi) });
  }
  const delta = { items, distance: distance(items), log: deltaLog(items), perFrame };
  writeJson(join(dir, 'delta.json'), delta);
  status.distances.push({ n, distance: delta.distance });

  const packet = await buildPacket(runDir, dir, { C, frames: metrics, delta, phase: 'still', outputHash: rec.outputHash, n });
  rec.packetHash = packet.packetHash;
  rec.steps.push({ step: STEPS[3], at: now(), detail: `critique packet ${relative(runDir, packet.dir)} (${packet.evidence.length} evidence items, no source code)` });
  writeJson(join(dir, 'record.json'), rec);
  chain.push({ n, phase: 'still', stateHash: rec.stateHash, parent: rec.parent, decision: 'awaiting-critique' });
  status.state = 'awaiting-critique';
  status.restoredFrom = null;
  status.loopback = false;
  event(status, STEPS[3], { iteration: n, outputHash: rec.outputHash, distance: delta.distance });
  save(runDir, status, chain);
  return summary(runDir);
}

// ---- step 4 output: the isolated critique packet ----------------------------------------------
// Pictures, plates, the brief, DESIGN.md and the measured delta log. Never the scene source or
// the params, so the critic judges what is on screen rather than what the code intended.
async function buildPacket(runDir, iterDir, { C, frames, delta, phase, outputHash, n, sequence = null, temporal = null }) {
  const P = runPaths(runDir);
  const dir = join(iterDir, 'packet');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const evidence = [];
  for (const f of frames) {
    const id = `frame:t=${f.t}`;
    copyFileSync(f.path, join(dir, `frame-${tname(f.t)}.png`));
    evidence.push({ id, file: `frame-${tname(f.t)}.png`, t: f.t, reference: f.reference ?? null });
    if (f.reference) {
      const ref = C.references.find((r) => r.id === f.reference);
      const refFile = join(P.refs, `${ref.id}${extname(ref.path).toLowerCase()}`);
      const cmp = `compare-${tname(f.t)}.png`;
      await sideBySide(f.path, refFile, join(dir, cmp), { render: `t=${f.t}s`, reference: `${ref.id} (${ref.role})` });
      evidence.push({ id: `compare:t=${f.t}`, file: cmp, t: f.t, reference: ref.id });
    }
  }
  for (const r of C.references) {
    const file = `reference-${r.id}${extname(r.path).toLowerCase()}`;
    copyFileSync(join(P.refs, `${r.id}${extname(r.path).toLowerCase()}`), join(dir, file));
    evidence.push({ id: `reference:${r.id}`, file, role: r.role, source: r.source });
  }
  if (sequence) {
    copyFileSync(sequence, join(dir, 'sequence.png'));
    evidence.push({ id: 'sequence', file: 'sequence.png', note: 'ordered keyframes, left to right, top to bottom' });
  }
  const design = existsSync(join(runDir, 'DESIGN.md')) ? readFileSync(join(runDir, 'DESIGN.md'), 'utf8') : null;
  const body = {
    contract: 'visual-refinement-contract', version: CONTRACT_VERSION, phase, iteration: n, shotId: C.shot.id,
    brief: C.shot.brief, design, outputHash,
    criteria: SPEC.criteria.filter((c) => C.criteria.includes(c.id)),
    evidence,
    measuredDeltas: delta.log,
    temporal: temporal ? { checks: temporal.checks, sampling: temporal.sampling } : null,
    limitations: temporal ? [temporal.sampling.note, `the critic sees ${frames.length} sampled frames of ${temporal.sampling.frames}; motion between samples is judged only through the measurements`] : ['stills only: motion, flicker and pacing are not visible in this packet'],
    files: Object.fromEntries(evidence.map((e) => [e.file, fileSha(join(dir, e.file))])),
  };
  const packetHash = hashJson(body);
  writeJson(join(dir, 'packet.json'), { ...body, packetHash });
  writeFileSync(join(dir, 'CRITIC.md'), criticBrief(body, packetHash));
  return { dir, packetHash, evidence };
}

function criticBrief(body, packetHash) {
  return `# Isolated visual critique (${body.phase}, iteration ${body.iteration})

You are the critic for one refinement iteration. You have NOT seen, and must not ask for, the
scene source code or its parameters. Judge only what is on screen, against the reference plates,
the brief and DESIGN.md. Look at every image listed in packet.json (Read them).

Brief: ${body.brief}

For each criterion in packet.json, decide **pass** or **fail** using its passWhen/failWhen text.
Write what you saw (observation), how it differs from the reference (delta), which evidence ids you
looked at, and for every fail a concrete visual correction ("shafts should fan from upper-left and
fade by mid-frame", not "make it better"). No numeric scores, ratings or superlatives: they are
rejected. Measured deltas are listed for you; they are evidence, not verdicts, and they can be wrong.
If the brief itself seems to need a different creative direction than the plates show, set
"directionShift": true and explain in "summary" (a human will decide).

Write critique.json in this folder:

{
  "critic": { "id": "<who you are>", "context": "isolated", "sawSourceCode": false },
  "outputHash": "${body.outputHash}",
  "packetHash": "${packetHash}",
  "criteria": {
${body.criteria.map((c) => `    "${c.id}": { "verdict": "pass|fail", "observation": "...", "delta": "...", "evidence": ["frame:t=..."], "correction": "..." }`).join(',\n')}
  },
  "summary": "one or two sentences",
  "directionShift": false
}
`;
}

// ---- steps 5, 6, 8, 9: record the critique and decide -----------------------------------------
export function recordCritique(runDir, critique) {
  const { P, status, contract: C, chain } = load(runDir);
  const temporalPhase = status.state === 'awaiting-temporal-critique';
  if (status.state !== 'awaiting-critique' && !temporalPhase) throw new RefineError(`no iteration is waiting for a critique (state ${status.state})`, 'not-awaiting');
  const dir = temporalPhase ? join(P.temporal, pad(status.temporalIteration)) : join(P.iterations, pad(status.iteration));
  const rec = readJson(join(dir, 'record.json'));
  const packet = readJson(join(dir, 'packet', 'packet.json'));
  const v = validateCritique(critique, { criteria: C.criteria, outputHash: rec.outputHash, packetHash: rec.packetHash, evidenceIds: packet.evidence.map((e) => e.id) });
  if (!v.ok) return { ok: false, errors: v.errors, state: status.state };
  writeJson(join(dir, 'critique.json'), critique);
  rec.critiqueHash = hashJson(critique);
  const delta = readJson(join(dir, 'delta.json'));

  // Step 5: rubric evaluation. Each criterion needs the critic's pass AND no measured gap far
  // beyond tolerance AND (originality) no generic-default tripwire.
  const rubric = {};
  for (const id of C.criteria) {
    const hard = delta.items.filter((i) => i.criterion === id && !i.pass && (i.kind === 'genericity' || i.gap > HARD_GAP));
    const watch = delta.items.filter((i) => i.criterion === id && !i.pass && i.kind !== 'genericity' && i.gap <= HARD_GAP);
    const verdict = critique.criteria[id].verdict === 'pass' && hard.length === 0 ? 'pass' : 'fail';
    rubric[id] = { verdict, critic: critique.criteria[id].verdict, measuredBlocks: hard.map((h) => `${h.metric}@t=${h.t} gap ${h.gap}`), measuredWatch: watch.map((h) => `${h.metric}@t=${h.t} gap ${h.gap}`), observation: critique.criteria[id].observation, correction: critique.criteria[id].correction ?? null };
  }
  const temporalChecks = temporalPhase ? readJson(join(dir, 'temporal.json')).checks : [];
  const temporalOk = temporalChecks.every((c) => c.pass);
  rec.rubric = rubric;
  rec.steps.push({ step: STEPS[4], at: now(), detail: Object.entries(rubric).map(([k, r]) => `${k}:${r.verdict}`).join(' ') });
  // Step 6: the delta log, observed + measured.
  rec.deltaLog = [
    ...C.criteria.filter((id) => rubric[id].verdict === 'fail').map((id) => `[${id}] critic: ${critique.criteria[id].delta || critique.criteria[id].observation} -> ${critique.criteria[id].correction || '(critic passed; measurement blocks)'}`),
    ...delta.log,
    ...temporalChecks.filter((c) => !c.pass).map((c) => `[temporal] ${c.id}: ${JSON.stringify(c.value)} exceeds ${JSON.stringify(c.limit)}`),
  ];
  rec.steps.push({ step: STEPS[5], at: now(), detail: `${rec.deltaLog.length} open delta(s)` });
  const passed = C.criteria.every((id) => rubric[id].verdict === 'pass') && critiquePasses(critique, C.criteria) && temporalOk;

  if (critique.directionShift === true) {
    rec.decision = 'escalated';
    writeJson(join(dir, 'record.json'), rec);
    updateChain(chain, rec, 'escalated');
    save(runDir, status, chain);
    escalate(runDir, status, 'creative-direction-shift', critique.summary || 'critic flagged a material creative-direction change');
    return { ok: true, decision: 'escalated', reason: 'creative-direction-shift', rubric };
  }

  if (passed) {
    // Step 8: re-verify that what was judged is still exactly what is on disk.
    const verify = verifyIteration(runDir, dir, rec, { requireCurrentCode: true });
    rec.steps.push({ step: STEPS[7], at: now(), detail: verify.ok ? `state ${rec.stateHash.slice(0, 16)} re-verified` : verify.errors.join('; ') });
    if (!verify.ok) {
      rec.decision = 'hash-mismatch';
      writeJson(join(dir, 'record.json'), rec);
      updateChain(chain, rec, rec.decision);
      status.state = temporalPhase ? 'needs-temporal-adjustment' : 'needs-adjustment';
      event(status, STEPS[7], { ok: false, errors: verify.errors });
      save(runDir, status, chain);
      return { ok: true, decision: 'hash-mismatch', errors: verify.errors };
    }
    // Step 9: the approval, bound to the exact state.
    const approval = {
      contract: 'visual-refinement-contract', version: CONTRACT_VERSION, phase: rec.phase, iteration: rec.n, shotId: C.shot.id,
      stateHash: rec.stateHash, contractHash: rec.contractHash, codeHash: rec.codeHash, paramsHash: rec.paramsHash,
      outputHash: rec.outputHash, packetHash: rec.packetHash, critiqueHash: rec.critiqueHash, parent: rec.parent,
      criteria: Object.fromEntries(Object.entries(rubric).map(([k, r]) => [k, r.verdict])), critic: critique.critic, at: now(),
    };
    writeJson(temporalPhase ? P.approvalTemporal : P.approval, approval);
    rec.decision = 'approved';
    rec.steps.push({ step: STEPS[8], at: now(), detail: `approved ${rec.phase} state ${rec.stateHash.slice(0, 16)}` });
    writeJson(join(dir, 'record.json'), rec);
    updateChain(chain, rec, 'approved');
    status.state = temporalPhase ? 'approved' : 'approved-still';
    status.loopback = false;
    event(status, STEPS[8], { phase: rec.phase, iteration: rec.n, stateHash: rec.stateHash });
    save(runDir, status, chain);
    return { ok: true, decision: 'approved', phase: rec.phase, stateHash: rec.stateHash, rubric };
  }

  // Not approved: suggest the next move, then check the stopping rules.
  const suggestions = suggestAdjustments(delta.items, rec.params, C.tuning || {});
  rec.suggestions = suggestions;
  rec.steps.push({ step: STEPS[8], at: now(), detail: 'gate closed: ' + C.criteria.filter((id) => rubric[id].verdict === 'fail').join(', ') + (temporalOk ? '' : ' + temporal checks') });
  let route = 'still';
  if (temporalPhase) {
    // Loopback: a look problem goes back to still tuning; a motion problem stays temporal.
    const lookFails = C.criteria.filter((id) => rubric[id].verdict === 'fail' && STILL_LOOK.has(id));
    route = lookFails.length ? 'still' : 'temporal';
    rec.route = { to: route, because: lookFails.length ? `look criteria failed in motion: ${lookFails.join(', ')}` : 'only motion/temporal issues' };
  }
  rec.decision = temporalPhase ? `loopback-${route}` : 'continue';
  writeJson(join(dir, 'record.json'), rec);
  updateChain(chain, rec, rec.decision);
  if (temporalPhase && route === 'still') {
    // The approved still look is no longer good enough: revoke it and refine stills again.
    if (existsSync(P.approval)) renameSync(P.approval, join(runDir, `approval-still.revoked-${pad(status.iteration)}.json`));
    status.phase = 'still';
    status.state = 'needs-adjustment';
    status.loopback = true;
  } else status.state = temporalPhase ? 'needs-temporal-adjustment' : 'needs-adjustment';
  event(status, 'decision', { phase: rec.phase, decision: rec.decision, failing: C.criteria.filter((id) => rubric[id].verdict === 'fail') });
  save(runDir, status, chain);

  // Stopping rules (still phase): budget, then convergence without approval.
  if (!temporalPhase || route === 'still') {
    const d = status.distances.map((x) => x.distance);
    const k = C.budget.patience;
    const stalled = d.length > k && d.slice(-k - 1).every((v, i, a) => i === 0 || a[i - 1] - v < C.budget.convergenceDelta);
    if (status.iteration >= C.budget.maxIterations) escalate(runDir, status, 'budget-exhausted', `${status.iteration}/${C.budget.maxIterations} still iterations without approval; open deltas: ${rec.deltaLog.slice(0, 4).join(' | ')}`);
    else if (stalled) escalate(runDir, status, 'converged-without-approval', `delta distance moved less than ${C.budget.convergenceDelta} for ${k} iterations (${d.slice(-k - 1).join(' -> ')}) without approval`);
  } else if (status.temporalIteration >= C.budget.maxTemporalIterations) {
    escalate(runDir, status, 'budget-exhausted', `${status.temporalIteration}/${C.budget.maxTemporalIterations} temporal iterations without approval`);
  }
  const after = readJson(P.status);
  return { ok: true, decision: after.state === 'escalated' ? 'escalated' : rec.decision, reason: after.escalation?.reason, rubric, deltaLog: rec.deltaLog, suggestions };
}

function updateChain(chain, rec, decision) {
  const i = chain.findIndex((c) => c.stateHash === rec.stateHash && c.phase === rec.phase && c.n === rec.n);
  if (i >= 0) chain[i].decision = decision;
}

// ---- hash re-verification ---------------------------------------------------------------------
// Recompute an iteration's state from what is on disk. requireCurrentCode also demands that the
// scene in the repo is still the code that was judged.
function verifyIteration(runDir, dir, rec, { requireCurrentCode = false, root = ROOT } = {}) {
  const errors = [];
  const C = readJson(runPaths(runDir).contract);
  const frames = readJson(join(dir, 'frames.json'));
  for (const f of frames.frames) {
    const p = join(runDir, f.path);
    if (!existsSync(p)) errors.push(`frame missing: ${f.path}`);
    else if (fileSha(p) !== f.sha256) errors.push(`frame changed since review: ${f.path}`);
  }
  let outputHash = framesHash(frames.frames);
  if (rec.phase === 'temporal') {
    const pv = join(dir, 'preview.mp4');
    outputHash = hashJson({ video: existsSync(pv) ? fileSha(pv) : null, frames: outputHash });
  }
  if (outputHash !== rec.outputHash) errors.push('output hash does not match the frames on disk');
  if (hashJson(readJson(join(dir, 'params.json'))) !== rec.paramsHash) errors.push('saved params changed');
  if (fileSha(join(dir, 'scene.html')) !== rec.sceneSha256) errors.push('saved scene snapshot changed');
  if (requireCurrentCode) {
    const { codeHash } = codeHashOf(inside(root, C.shot.scene), root);
    if (codeHash !== rec.codeHash) errors.push('the scene (or a script it loads) changed after this iteration was rendered');
  }
  if (hashJson(C) !== rec.contractHash) errors.push('contract changed');
  const s = stateHash({ contractHash: rec.contractHash, codeHash: rec.codeHash, paramsHash: rec.paramsHash, outputHash: rec.outputHash, parent: rec.parent, phase: rec.phase });
  if (s !== rec.stateHash) errors.push('state hash does not recompute');
  if (rec.critiqueHash && existsSync(join(dir, 'critique.json')) && hashJson(readJson(join(dir, 'critique.json'))) !== rec.critiqueHash) errors.push('critique changed after it was recorded');
  return { ok: errors.length === 0, errors };
}

export function verifyChain(runDir) {
  const { chain } = load(runDir);
  const errors = [];
  let lastStill = null, lastAny = null;
  for (const c of chain) {
    const expectParent = c.phase === 'still' ? lastStill : lastAny;
    if (c.parent !== expectParent) errors.push(`${c.phase} ${c.n}: parent ${String(c.parent).slice(0, 12)} breaks the chain (expected ${String(expectParent).slice(0, 12)})`);
    if (c.phase === 'still') lastStill = c.stateHash;
    lastAny = c.stateHash;
  }
  return { ok: errors.length === 0, errors, length: chain.length };
}

// The gate other tools call before using a result (make_video, daily.py ship(), bundle export).
export function verifyApproval(runDir, phase = 'still', { root = ROOT } = {}) {
  const P = runPaths(runDir);
  const file = phase === 'temporal' ? P.approvalTemporal : P.approval;
  if (!existsSync(file)) return { ok: false, errors: [`no ${phase} approval`] };
  const a = readJson(file);
  const dir = phase === 'temporal' ? join(P.temporal, pad(a.iteration)) : join(P.iterations, pad(a.iteration));
  if (!existsSync(join(dir, 'record.json'))) return { ok: false, errors: ['approved iteration record is missing'] };
  const rec = readJson(join(dir, 'record.json'));
  const errors = [];
  if (rec.stateHash !== a.stateHash) errors.push('approval is bound to a different state than its iteration record');
  if (rec.decision !== 'approved') errors.push('iteration record is not marked approved');
  if (a.critiqueHash !== rec.critiqueHash) errors.push('approval critique hash mismatch');
  if (!existsSync(join(dir, 'critique.json'))) errors.push('approval has no recorded critique: visual approval requires an isolated multimodal critique');
  else if (!critiquePasses(readJson(join(dir, 'critique.json')), readJson(P.contract).criteria)) errors.push('recorded critique does not pass every criterion');
  if (!rec.technical?.ok) errors.push('approved iteration did not pass technical checks');
  errors.push(...verifyIteration(runDir, dir, rec, { requireCurrentCode: true, root }).errors);
  const chain = verifyChain(runDir);
  errors.push(...chain.errors);
  if (phase === 'temporal') {
    const still = verifyApprovalStillAncestor(runDir, rec);
    errors.push(...still);
  }
  return { ok: errors.length === 0, errors, approval: a };
}

function verifyApprovalStillAncestor(runDir, rec) {
  const P = runPaths(runDir);
  if (!existsSync(P.approval)) return ['temporal approval needs a standing still approval'];
  const s = readJson(P.approval);
  const { chain } = load(runDir);
  let cur = rec.parent;
  for (let guard = 0; cur && guard < 200; guard++) {
    if (cur === s.stateHash) return [];
    cur = chain.find((c) => c.stateHash === cur)?.parent ?? null;
  }
  return ['temporal state does not descend from the approved still state'];
}

// ---- restore ----------------------------------------------------------------------------------
// Put a saved iteration's scene and params back, after proving the snapshot is intact. Any
// approval is revoked: the restored state has to be rendered and critiqued again.
export function restore(runDir, n, { root = ROOT } = {}) {
  const { P, status, contract: C } = load(runDir);
  if (!Number.isInteger(n) || n < 1) throw new RefineError('iteration must be a positive integer', 'bad-request');
  const dir = join(P.iterations, pad(n));
  if (!existsSync(join(dir, 'record.json'))) throw new RefineError(`no iteration ${n}`, 'bad-request');
  const rec = readJson(join(dir, 'record.json'));
  const errors = [];
  if (fileSha(join(dir, 'scene.html')) !== rec.sceneSha256) errors.push('scene snapshot changed');
  if (hashJson(readJson(join(dir, 'params.json'))) !== rec.paramsHash) errors.push('params snapshot changed');
  if (rec.technical?.ok) errors.push(...verifyIteration(runDir, dir, rec).errors.filter((e) => !e.startsWith('critique')));
  if (errors.length) throw new RefineError(`refusing restore of iteration ${n}: ${errors.join('; ')}`, 'tampered');
  copyFileSync(join(dir, 'scene.html'), inside(root, C.shot.scene));
  for (const f of [P.approval, P.approvalTemporal]) if (existsSync(f)) renameSync(f, f.replace(/\.json$/, `.revoked-restore-${pad(n)}.json`));
  status.params = readJson(join(dir, 'params.json'));
  status.restoredFrom = n;
  status.phase = 'still';
  if (status.state !== 'escalated') status.state = 'restored';
  event(status, 'restore', { iteration: n, stateHash: rec.stateHash });
  save(runDir, status);
  return { ok: true, restored: n, stateHash: rec.stateHash, note: 'scene and params restored; render and critique again before approval' };
}

// ---- Phase 4: temporal refinement -------------------------------------------------------------
export async function temporal(runDir, { params = null, note = '', root = ROOT } = {}) {
  const { P, status, contract: C, chain } = load(runDir);
  if (status.state === 'awaiting-temporal-critique') throw new RefineError('the temporal preview is waiting for its critique', 'awaiting-critique');
  if (!['approved-still', 'needs-temporal-adjustment'].includes(status.state) || status.loopback) throw new RefineError(`temporal refinement needs a locked still approval (state ${status.state})`, 'still-not-approved');
  const still = verifyApproval(runDir, 'still', { root });
  if (!still.ok) throw new RefineError('still approval does not verify: ' + still.errors.join('; '), 'still-not-approved');
  const m = status.temporalIteration + 1;
  if (m > C.budget.maxTemporalIterations) {
    escalate(runDir, status, 'budget-exhausted', `${C.budget.maxTemporalIterations} temporal iterations used`);
    throw new RefineError('temporal budget exhausted; escalated', 'budget-exhausted');
  }
  const approvedParams = readJson(join(P.iterations, pad(still.approval.iteration), 'params.json'));
  const nextParams = params ?? status.params;
  // Only declared motion parameters may change without going back to stills.
  const motionParams = new Set(C.temporal?.params || []);
  const lookChanges = Object.keys({ ...approvedParams, ...nextParams }).filter((k) => canonical(approvedParams[k] ?? null) !== canonical(nextParams[k] ?? null) && !motionParams.has(k));
  if (lookChanges.length) throw new RefineError(`these params change the approved look, so they need a still iteration first: ${lookChanges.join(', ')}`, 'look-change');
  const scenePath = inside(root, C.shot.scene);
  const { codeHash, parts } = codeHashOf(scenePath, root);
  if (codeHash !== still.approval.codeHash) throw new RefineError('scene code changed after still approval; changes to code go through a still iteration', 'look-change');
  const prev = chain.at(-1);
  const prevTemporal = chain.filter((c) => c.phase === 'temporal').at(-1);
  if (prevTemporal && prevTemporal.parent && status.state === 'needs-temporal-adjustment') {
    const pr = readJson(join(P.temporal, pad(prevTemporal.n), 'record.json'));
    if (pr.paramsHash === hashJson(nextParams)) throw new RefineError('nothing changed since the last temporal iteration', 'no-change');
    pr.adjustment = { at: now(), note: String(note).slice(0, 2000), params: Object.keys(nextParams).filter((k) => canonical(pr.params[k] ?? null) !== canonical(nextParams[k] ?? null)).map((k) => ({ param: k, from: pr.params[k] ?? null, to: nextParams[k] })) };
    pr.steps.push({ step: STEPS[6], at: now(), detail: `${pr.adjustment.params.length} motion param change(s)` });
    writeJson(join(P.temporal, pad(prevTemporal.n), 'record.json'), pr);
  }
  status.temporalIteration = m;
  status.phase = 'temporal';
  status.params = nextParams;
  const dir = join(P.temporal, pad(m));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'frames'), { recursive: true });
  copyFileSync(scenePath, join(dir, 'scene.html'));
  writeJson(join(dir, 'params.json'), nextParams);
  const T = { previewFps: Math.min(C.shot.fps, 15), previewData: { resolutionScale: 0.25 }, analysisWidth: 160, ...(C.temporal || {}) };
  const rec = { n: m, phase: 'temporal', parent: prev.stateHash, contractHash: status.contractHash, codeHash, code: parts, paramsHash: hashJson(nextParams), params: nextParams, sceneSha256: fileSha(scenePath), steps: [] };

  // Low-res motion preview, silent, no credentials.
  const dataFile = join(dir, 'preview-data.json');
  writeJson(dataFile, { ...nextParams, ...T.previewData });
  const preview = join(dir, 'preview.mp4');
  const r = await node([join(root, 'render.mjs'), join(root, C.shot.scene), '--out', preview, '--data', dataFile, '--fps', String(T.previewFps), '--jobs', '1']);
  const info = existsSync(preview) ? probe(preview) : {};
  const expectedFrames = Math.round(C.shot.durationS * T.previewFps);
  const tech = [];
  if (r.code !== 0 || !existsSync(preview)) tech.push({ ok: false, check: 'render', error: (r.err || r.out).trim().split('\n').slice(-12).join('\n') });
  else {
    if (statSync(preview).size === 0) tech.push({ ok: false, check: 'size', error: 'zero-byte preview' });
    if (!info.fps || Math.abs(info.fps - T.previewFps) > 0.01) tech.push({ ok: false, check: 'fps', error: `preview is ${info.fps} fps, expected ${T.previewFps}` });
    if (!info.duration || Math.abs(info.duration - C.shot.durationS) > 1.5 / T.previewFps) tech.push({ ok: false, check: 'duration', error: `preview is ${info.duration}s, expected ${C.shot.durationS}s` });
  }
  rec.steps.push({ step: STEPS[1], at: now(), detail: `low-res preview ${info.width}x${info.height} @ ${info.fps} fps` });
  let analysis = null, frames = [];
  if (!tech.length) {
    const aw = T.analysisWidth, ah = Math.max(8, Math.round(aw * info.height / info.width / 2) * 2);
    const gray = await decodeGray(preview, aw, ah);
    analysis = analyzeSequence(gray, { width: aw, height: ah, fps: T.previewFps, cuts: C.shot.cuts || [], expectedFrames, thresholds: T.thresholds || {} });
    writeJson(join(dir, 'temporal.json'), { checks: analysis.checks, sampling: analysis.sampling, series: analysis.series });
    // Ordered keyframes for the critic, extracted from the preview itself.
    const times = keyframeTimes({ duration: C.shot.durationS, fps: T.previewFps, keyframes: C.keyframes, cuts: C.shot.cuts || [], energy: analysis.series.energy });
    for (const t of times) {
      const out = join(dir, 'frames', `frame-${tname(t)}.png`);
      await new Promise((done) => spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', preview, '-frames:v', '1', out]).on('close', done));
      if (existsSync(out)) {
        const kf = C.keyframes.find((k) => Math.abs(k.t - t) < 0.5 / T.previewFps);
        const mm = measure(await loadPixels(out));
        const bad = falseSuccess(mm);
        if (bad.length) tech.push({ ok: false, check: 'false-success', error: `t=${t}: ${bad.join('; ')}` });
        frames.push({ t, path: out, sha256: fileSha(out), reference: kf?.reference ?? null, metrics: mm });
      } else tech.push({ ok: false, check: 'extract', error: `could not extract t=${t}` });
    }
    // Sequence sheet in order.
    if (frames.length) {
      const sheet = join(dir, 'sequence.png');
      const cols = 4, rows = Math.ceil(frames.length / cols);
      const imgs = await Promise.all(frames.map((f) => loadImage(readFileSync(f.path))));
      const cw = 480, ch = Math.round(cw * imgs[0].height / imgs[0].width);
      const c = new Canvas(cols * cw + (cols + 1) * 6, rows * (ch + 30) + 6);
      const x = c.getContext('2d');
      x.fillStyle = '#202020'; x.fillRect(0, 0, c.width, c.height);
      x.font = '600 18px Refine'; x.fillStyle = '#e8e8e8';
      imgs.forEach((im, i) => { const cx = 6 + (i % cols) * (cw + 6), cy = 6 + Math.floor(i / cols) * (ch + 30); x.drawImage(im, cx, cy + 24, cw, ch); x.fillText(`${i + 1}. t=${frames[i].t}s`, cx + 4, cy + 18); });
      writeFileSync(sheet, await c.toBuffer('png'));
    }
  }
  rec.technical = { ok: tech.length === 0, checks: tech.length ? tech : [{ ok: true, check: 'preview' }] };
  rec.steps.push({ step: STEPS[2], at: now(), detail: tech.length ? tech.map((t) => `${t.check}: ${t.error}`).join('; ') : 'preview decodes at the declared fps and duration' });
  const fr = frames.map((f) => ({ t: f.t, path: relative(runDir, f.path).split('\\').join('/'), sha256: f.sha256, width: info.width, height: info.height, reference: f.reference }));
  if (fr.length) writeJson(join(dir, 'frames.json'), { kind: 'sequence', shotId: C.shot.id, iteration: m, frames: fr, outputHash: framesHash(fr) });
  else writeJson(join(dir, 'frames.json'), { kind: 'sequence', shotId: C.shot.id, iteration: m, frames: [] });
  rec.outputHash = hashJson({ video: existsSync(preview) ? fileSha(preview) : null, frames: fr.length ? framesHash(fr) : framesHash([]) });
  rec.stateHash = stateHash({ contractHash: status.contractHash, codeHash, paramsHash: rec.paramsHash, outputHash: rec.outputHash, parent: rec.parent, phase: 'temporal' });
  if (tech.length) {
    rec.decision = 'technical-fail';
    writeJson(join(dir, 'record.json'), rec);
    chain.push({ n: m, phase: 'temporal', stateHash: rec.stateHash, parent: rec.parent, decision: rec.decision });
    status.state = 'needs-temporal-adjustment';
    event(status, STEPS[2], { phase: 'temporal', iteration: m, ok: false, errors: tech });
    save(runDir, status, chain);
    if (m >= C.budget.maxTemporalIterations) escalate(runDir, status, 'budget-exhausted', `temporal budget used; last preview failed technical checks: ${tech[0].error}`);
    return summary(runDir);
  }
  // Sampled keyframes against their plates (look drift in motion).
  const items = [];
  for (const f of frames.filter((x) => x.reference)) {
    const refM = readJson(join(P.refs, `${f.reference}.metrics.json`));
    items.push(...[...compareToReference(f.metrics, refM), ...genericity(f.metrics)].map((x) => ({ ...x, t: f.t, reference_id: f.reference })));
  }
  const delta = { items, distance: distance(items), log: deltaLog(items), perFrame: [] };
  writeJson(join(dir, 'delta.json'), delta);
  const packet = await buildPacket(runDir, dir, { C, frames, delta, phase: 'temporal', outputHash: rec.outputHash, n: m, sequence: join(dir, 'sequence.png'), temporal: analysis });
  rec.packetHash = packet.packetHash;
  rec.limitations = [analysis.sampling.note, `critic sees ${frames.length} of ${analysis.sampling.frames} preview frames`];
  rec.steps.push({ step: STEPS[3], at: now(), detail: `temporal packet: ${frames.length} sampled frames + sequence sheet; ${analysis.checks.filter((c) => !c.pass).length} temporal check(s) failing` });
  writeJson(join(dir, 'record.json'), rec);
  chain.push({ n: m, phase: 'temporal', stateHash: rec.stateHash, parent: rec.parent, decision: 'awaiting-critique' });
  status.state = 'awaiting-temporal-critique';
  event(status, STEPS[3], { phase: 'temporal', iteration: m, outputHash: rec.outputHash });
  save(runDir, status, chain);
  return summary(runDir);
}

// ---- final render + evidence bundle -----------------------------------------------------------
export async function finalRender(runDir, { out = null, root = ROOT } = {}) {
  const { P, status, contract: C } = load(runDir);
  const v = verifyApproval(runDir, 'temporal', { root });
  if (!v.ok) throw new RefineError('final render needs a verified temporal approval: ' + v.errors.join('; '), 'not-approved');
  const params = readJson(join(P.temporal, pad(v.approval.iteration), 'params.json'));
  const dataFile = join(runDir, 'final-params.json');
  writeJson(dataFile, params);
  const file = out ? inside(root, out) : join(runDir, `${C.shot.id}_final.mp4`);
  const r = await node([join(root, 'render.mjs'), join(root, C.shot.scene), '--out', file, '--data', dataFile], { timeoutMs: 60 * 60 * 1000 });
  if (r.code !== 0 || !existsSync(file)) throw new RefineError('final render failed: ' + (r.err || r.out).slice(-800), 'render-failed');
  const info = probe(file);
  if (info.width !== C.shot.width || info.height !== C.shot.height || Math.abs(info.fps - C.shot.fps) > 0.01) throw new RefineError(`final render is ${info.width}x${info.height}@${info.fps}, contract wants ${C.shot.width}x${C.shot.height}@${C.shot.fps}`, 'render-failed');
  const fin = { file: relative(root, file).split('\\').join('/'), sha256: fileSha(file), bytes: statSync(file).size, probe: info, temporalApproval: v.approval.stateHash, stillApproval: readJson(P.approval).stateHash, paramsHash: hashJson(params), at: now(), audio: 'none (silent picture render; narration needs a paid voice API and is not authorised)' };
  writeJson(P.final, fin);
  status.state = 'final';
  event(status, 'final-render', { file: fin.file, sha256: fin.sha256 });
  save(runDir, status);
  return fin;
}

function walk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

// A reproducible, self-verifying copy of everything the run produced.
export function exportBundle(runDir, { dest = null, root = ROOT } = {}) {
  const { status, contract: C, chain } = load(runDir);
  dest = dest ? inside(root, dest) : join(runDir, '..', `${C.shot.id}-bundle`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const files = walk(runDir).filter((f) => !f.endsWith('.tmp'));
  for (const f of files) { mkdirSync(dirname(join(dest, f)), { recursive: true }); copyFileSync(join(runDir, f), join(dest, f)); }
  const manifest = {
    contract: 'visual-refinement-contract', version: CONTRACT_VERSION, shotId: C.shot.id, state: status.state,
    contractHash: status.contractHash, chain, chainVerified: verifyChain(runDir).ok,
    stillApproval: verifyApproval(runDir, 'still', { root }).ok, temporalApproval: verifyApproval(runDir, 'temporal', { root }).ok,
    files: Object.fromEntries(files.sort().map((f) => [f, fileSha(join(dest, f))])),
  };
  manifest.manifestHash = hashJson({ ...manifest, manifestHash: null });
  writeJson(join(dest, 'manifest.json'), manifest);
  writeFileSync(join(dest, 'SUMMARY.md'), bundleSummary(runDir, manifest));
  return { dest, files: files.length, manifestHash: manifest.manifestHash };
}

export function verifyBundle(dest) {
  const m = readJson(join(dest, 'manifest.json'));
  const errors = [];
  if (hashJson({ ...m, manifestHash: null }) !== m.manifestHash) errors.push('manifest edited after export');
  for (const [f, h] of Object.entries(m.files)) {
    const p = join(dest, f);
    if (!existsSync(p)) errors.push(`missing ${f}`);
    else if (fileSha(p) !== h) errors.push(`changed ${f}`);
  }
  let last = { still: null, any: null };
  for (const c of m.chain) {
    const exp = c.phase === 'still' ? last.still : last.any;
    if (c.parent !== exp) errors.push(`chain broken at ${c.phase} ${c.n}`);
    if (c.phase === 'still') last.still = c.stateHash;
    last.any = c.stateHash;
  }
  return { ok: errors.length === 0, errors, files: Object.keys(m.files).length };
}

function bundleSummary(runDir, manifest) {
  const P = runPaths(runDir);
  const C = readJson(P.contract);
  const lines = [`# Visual refinement evidence: ${C.shot.id}`, '', `Brief: ${C.shot.brief}`, '', `Final state: **${manifest.state}**. Chain verified: ${manifest.chainVerified}. Still approval verifies: ${manifest.stillApproval}. Temporal approval verifies: ${manifest.temporalApproval}.`, '', '## References', ''];
  for (const r of C.references) lines.push(`- ${r.id} (${r.role}, ${r.source}) sha256 ${r.sha256.slice(0, 16)}`);
  const section = (title, base) => {
    if (!existsSync(base)) return;
    lines.push('', `## ${title}`, '');
    for (const d of readdirSync(base).sort()) {
      const rp = join(base, d, 'record.json');
      if (!existsSync(rp)) continue;
      const rec = readJson(rp);
      lines.push(`### ${rec.phase} ${rec.n}: ${rec.decision}`, '', `state ${rec.stateHash?.slice(0, 16)} parent ${String(rec.parent).slice(0, 16)}`);
      if (rec.rubric) lines.push('', Object.entries(rec.rubric).map(([k, v]) => `- ${k}: **${v.verdict}** (critic ${v.critic}${v.measuredBlocks.length ? '; measured blocks ' + v.measuredBlocks.join(', ') : ''}) ${v.observation}`).join('\n'));
      if (rec.deltaLog?.length) lines.push('', 'Open deltas:', '', rec.deltaLog.slice(0, 12).map((x) => `- ${x}`).join('\n'));
      if (rec.adjustment) lines.push('', `Adjustment: ${rec.adjustment.note || ''} ${rec.adjustment.params.map((p) => `${p.param} ${p.from} -> ${p.to}`).join(', ')}${rec.adjustment.sceneChanged ? ' (+ scene code)' : ''}`);
      if (rec.limitations) lines.push('', 'Limitations: ' + rec.limitations.join('; '));
      lines.push('');
    }
  };
  section('Still iterations', P.iterations);
  section('Temporal iterations', P.temporal);
  if (existsSync(P.escalations)) lines.push('## Escalations', '', ...readJson(P.escalations).map((e) => `- ${e.reason}: ${e.detail}`), '');
  if (existsSync(P.final)) { const f = readJson(P.final); lines.push('## Final', '', `${f.file} sha256 ${f.sha256} (${f.probe.width}x${f.probe.height} @ ${f.probe.fps} fps, ${f.probe.duration}s). Audio: ${f.audio}.`, ''); }
  return lines.join('\n') + '\n';
}

// ---- status -----------------------------------------------------------------------------------
export function summary(runDir) {
  const { P, status, contract: C } = load(runDir);
  const cur = status.phase === 'temporal' ? join(P.temporal, pad(status.temporalIteration)) : join(P.iterations, pad(status.iteration));
  const rec = existsSync(join(cur, 'record.json')) ? readJson(join(cur, 'record.json')) : null;
  return {
    runDir, shotId: C.shot.id, state: status.state, phase: status.phase,
    iteration: status.iteration, temporalIteration: status.temporalIteration,
    budget: { still: `${status.iteration}/${C.budget.maxIterations}`, temporal: `${status.temporalIteration}/${C.budget.maxTemporalIterations}` },
    distances: status.distances, escalation: status.escalation ?? null,
    current: rec && {
      n: rec.n, phase: rec.phase, decision: rec.decision ?? null, stateHash: rec.stateHash, technical: rec.technical,
      packet: existsSync(join(cur, 'packet', 'packet.json')) ? relative(ROOT, join(cur, 'packet')).split('\\').join('/') : null,
      deltaLog: rec.deltaLog ?? (existsSync(join(cur, 'delta.json')) ? readJson(join(cur, 'delta.json')).log : []),
      suggestions: rec.suggestions ?? null,
    },
  };
}

export const criteriaSpec = () => SPEC.criteria;
export { CRITERIA };
