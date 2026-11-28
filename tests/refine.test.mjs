// The visual refinement loop: contract + hashing, critique validation, anti-false-success, the
// still-first loop with hash-bound approval, temporal checks, and the mandatory regression suite:
//   1 shader compilation failure   2 reference mismatch   3 budget exhaustion
//   4 state restoration            5 frame-rate drop       6 snapshot persistence
// Critiques here are scripted test doubles; real runs use an isolated critic (docs/VISUAL-REFINEMENT.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas } from 'skia-canvas';
import * as C from '../refine/contract.mjs';
import * as L from '../refine/loop.mjs';
import { falseSuccess, measure } from '../refine/pixels.mjs';
import { analyzeSequence, keyframeTimes } from '../refine/temporal.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BASE = join(ROOT, 'out', 'refine-tests', String(process.pid));
const SPEC = JSON.parse(readFileSync(join(ROOT, 'refine', 'visual-refinement-contract.v1.json'), 'utf8'));
const rel = (p) => relative(ROOT, p).split('\\').join('/');
const sha = (p) => C.sha256(readFileSync(p));

function still(scene, t, out, data) {
  const df = out + '.json';
  writeFileSync(df, JSON.stringify(data));
  const r = spawnSync(process.execPath, [join(ROOT, 'render.mjs'), scene, '--still', String(t), '--out', out, '--data', df], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return out;
}

// A run folder with its own copy of the scene (tests edit it) and plates rendered from it.
function setup(name, { plateData = { hue: 214, light: 0.52 }, budget = {}, temporalParams = ['shake', 'flicker', 'freezeFrom'] } = {}) {
  const dir = join(BASE, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'plates'), { recursive: true });
  mkdirSync(join(dir, 'scene'), { recursive: true });
  const scene = join(dir, 'scene', 'shot.html');
  writeFileSync(scene, readFileSync(join(ROOT, 'tests/fixtures/refine-scene.html'), 'utf8').replace('../../kit/motion.js', relative(join(dir, 'scene'), join(ROOT, 'kit/motion.js')).split('\\').join('/')));
  const p1 = still(scene, 0.5, join(dir, 'plates', 'a.png'), plateData);
  const p2 = still(scene, 1.5, join(dir, 'plates', 'b.png'), plateData);
  const contract = {
    contract: C.CONTRACT_NAME, version: C.CONTRACT_VERSION,
    shot: { id: name, scene: rel(scene), durationS: 2, fps: 12, width: 320, height: 180, brief: 'A calm test shot: a warm subject drifts right through cool water with specks.' },
    references: [
      { id: 'plate-a', role: 'establishing', source: 'procedural-lookdev', path: rel(p1), sha256: sha(p1), width: 320, height: 180 },
      { id: 'plate-b', role: 'hero', source: 'google-stitch', path: rel(p2), sha256: sha(p2), width: 320, height: 180 },
    ],
    keyframes: [{ t: 0.5, reference: 'plate-a' }, { t: 1.5, reference: 'plate-b' }],
    params: { hue: 210, light: 0.5 },
    tuning: { lumaMean: [{ param: 'light', gain: 0.05, min: 0.1, max: 1.5, default: 0.5 }] },
    temporal: { params: temporalParams, previewFps: 12, previewData: { resolutionScale: 0.5 }, analysisWidth: 160 },
    budget: { maxIterations: 4, ...budget },
  };
  return { dir, scene, contract, run: join(dir, 'run'), plates: [p1, p2] };
}

function critique(run, verdicts = {}, extra = {}) {
  const s = L.summary(run);
  const packet = JSON.parse(readFileSync(join(ROOT, s.current.packet, 'packet.json'), 'utf8'));
  const ev = packet.evidence.filter((e) => e.id.startsWith('compare') || e.id === 'sequence').map((e) => e.id);
  const criteria = {};
  for (const id of C.CRITERIA) {
    const v = verdicts[id] || 'pass';
    criteria[id] = { verdict: v, observation: `Looked at the ${id} of the frames against the plates.`, evidence: ev.length ? ev : [packet.evidence[0].id], delta: 'matches the plate closely', ...(v === 'fail' ? { correction: `adjust the ${id} toward the plate` } : {}) };
  }
  return { critic: { id: 'scripted-test-critic', context: 'isolated', sawSourceCode: false }, outputHash: packet.outputHash, packetHash: packet.packetHash, criteria, summary: 'test', ...extra };
}

test.after(() => rmSync(BASE, { recursive: true, force: true }));

// ---- contract ---------------------------------------------------------------------------------
test('canonical hashing is stable, order-insensitive for keys, order-sensitive for frames', () => {
  assert.equal(C.canonical({ b: 1, a: [1.5, -0, 'x', null, true], c: { z: 2, y: 1e21 } }), '{"a":[1.5,0,"x",null,true],"b":1,"c":{"y":1e+21,"z":2}}');
  assert.equal(C.hashJson({ a: 1, b: 2 }), C.hashJson({ b: 2, a: 1 }));
  assert.throws(() => C.canonical({ a: NaN }), /non-finite/);
  assert.throws(() => C.canonical({ a: undefined }), /undefined/);
  const f = [{ t: 0.5, sha256: 'a'.repeat(64) }, { t: 1, sha256: 'b'.repeat(64) }];
  assert.notEqual(C.framesHash(f), C.framesHash([...f].reverse()));
  // Fixture shared with motion-factory's Python port (tests/test_visual_contract.py) and studio-engine.
  const fixture = { n: [0, 1, -2, 0.1, 1.5e-7, 123456789.125, 1e21], s: 'ü"\\', o: {} };
  assert.equal(C.canonical(fixture), '{"n":[0,1,-2,0.1,1.5e-7,123456789.125,1e+21],"o":{},"s":"ü\\"\\\\"}');
  assert.equal(C.hashJson(fixture), 'd07b41ad87e881688eed34b530c069d2db6e9716fc88fbd79a955801d6d07ed6');
});

test('the shared JSON spec and the code agree on criteria, steps and budget', () => {
  assert.deepEqual(SPEC.criteria.map((c) => c.id), [...C.CRITERIA]);
  assert.deepEqual(SPEC.steps, [...C.STEPS]);
  assert.deepEqual(SPEC.budget, { ...C.DEFAULT_BUDGET });
  for (const c of SPEC.criteria) for (const k of ['title', 'question', 'passWhen', 'failWhen']) assert.ok(c[k].length > (k === 'title' ? 5 : 20), `${c.id}.${k}`);
});

test('contract validation names what is missing', () => {
  const v = C.validateContract({ contract: C.CONTRACT_NAME, version: C.CONTRACT_VERSION, shot: { id: 'Bad Id', scene: '/abs.html', durationS: 0, fps: 30, width: 10, height: 10 }, references: [], keyframes: [] });
  assert.equal(v.ok, false);
  for (const m of [/shot.id/, /shot.scene/, /durationS/, /width\/height/, /brief/, /lookdev reference/, /keyframes/]) assert.ok(v.errors.some((e) => m.test(e)), String(m));
  const ok = setup('contract-ok').contract;
  assert.deepEqual(C.validateContract(ok), { ok: true, errors: [] });
  const unmapped = { ...ok, keyframes: [ok.keyframes[0]] };
  assert.ok(C.validateContract(unmapped).errors.some((e) => /not mapped/.test(e)));
});

test('critiques must be isolated, evidenced, bound to the output, and free of numeric scores', () => {
  const h = 'c'.repeat(64);
  const good = { critic: { id: 'x', context: 'isolated', sawSourceCode: false }, outputHash: h, packetHash: h, criteria: Object.fromEntries(C.CRITERIA.map((id) => [id, { verdict: 'pass', observation: 'The frame matches the plate in this respect.', evidence: ['frame:t=1'] }])) };
  assert.ok(C.validateCritique(good, { outputHash: h, packetHash: h, evidenceIds: ['frame:t=1'] }).ok);
  const bad = structuredClone(good);
  bad.critic.context = 'shared'; bad.critic.sawSourceCode = true;
  bad.criteria.lighting.score = 8.7;
  bad.criteria.color.verdict = 'fail';
  bad.criteria.composition.observation = 'Cinematic excellence throughout the frame.';
  bad.criteria.materials.evidence = ['frame:t=9'];
  const errs = C.validateCritique(bad, { outputHash: 'd'.repeat(64), packetHash: h, evidenceIds: ['frame:t=1'] }).errors.join('\n');
  for (const m of [/isolated/, /sawSourceCode/, /numeric quality scores/, /needs a proposed correction/, /superlative/, /not in the critique packet/, /different output/]) assert.match(errs, m);
});

test('anti-false-success: blank, flat, magenta, checkerboard and copied frames never pass', async () => {
  const img = (fn) => { const c = new Canvas(64, 36), x = c.getContext('2d'); fn(x); return { width: 64, height: 36, data: x.getImageData(0, 0, 64, 36).data }; };
  const reasons = (fn, o) => falseSuccess(measure(img(fn)), o).join(' ');
  assert.match(reasons((x) => { x.fillStyle = '#000'; x.fillRect(0, 0, 64, 36); }), /zero-variance|black/);
  assert.match(reasons((x) => { x.fillStyle = '#ff00ff'; x.fillRect(0, 0, 64, 36); }), /magenta/);
  assert.match(reasons((x) => { for (let i = 0; i < 64; i++) for (let j = 0; j < 36; j++) { x.fillStyle = (i + j) % 2 ? '#fff' : '#000'; x.fillRect(i, j, 1, 1); } }), /checkerboard/);
  assert.match(reasons((x) => { const g = x.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, '#123'); g.addColorStop(1, '#4af'); x.fillStyle = g; x.fillRect(0, 0, 64, 36); }, { referenceHashes: ['a'.repeat(64)], sha: 'a'.repeat(64) }), /byte-identical/);
  assert.equal(reasons((x) => { const g = x.createLinearGradient(0, 0, 64, 36); g.addColorStop(0, '#0b4f8a'); g.addColorStop(1, '#02121e'); x.fillStyle = g; x.fillRect(0, 0, 64, 36); x.fillStyle = '#c84'; x.beginPath(); x.arc(40, 18, 8, 0, 6.3); x.fill(); }), '');
});

// ---- the loop ---------------------------------------------------------------------------------
test('still loop: packet without code, critique, hash-bound approval that breaks when code changes', async () => {
  const S = setup('approve');
  await L.init({ contract: S.contract, runDir: S.run });
  const r1 = await L.iterate(S.run);
  assert.equal(r1.state, 'awaiting-critique');
  const packetDir = join(ROOT, r1.current.packet);
  const packet = JSON.parse(readFileSync(join(packetDir, 'packet.json'), 'utf8'));
  assert.ok(!JSON.stringify(packet).includes('M.setup') && !JSON.stringify(packet).includes('"hue"'), 'packet carries no scene code or params');
  assert.ok(existsSync(join(packetDir, 'CRITIC.md')) && packet.evidence.some((e) => e.id === 'compare:t=0.5'));
  await assert.rejects(L.iterate(S.run), /waiting for its isolated critique/);
  // A critique for some other render is refused.
  const wrong = critique(S.run); wrong.outputHash = 'e'.repeat(64);
  assert.equal(L.recordCritique(S.run, wrong).ok, false);
  // Saving the files and passing metrics is not approval: a failing critique keeps the gate shut.
  const r2 = L.recordCritique(S.run, critique(S.run, { narrative: 'fail' }));
  assert.equal(r2.decision, 'continue');
  assert.equal(L.verifyApproval(S.run).ok, false);
  await assert.rejects(L.iterate(S.run), /nothing changed/);
  const r3 = await L.iterate(S.run, { params: { hue: 213, light: 0.52 }, note: 'matched plate hue and light' });
  assert.equal(r3.iteration, 2);
  const rec1 = JSON.parse(readFileSync(join(S.run, 'iterations/001/record.json'), 'utf8'));
  assert.deepEqual(rec1.adjustment.params.map((p) => p.param).sort(), ['hue', 'light']);
  const done = L.recordCritique(S.run, critique(S.run));
  assert.equal(done.decision, 'approved', JSON.stringify(done));
  const v = L.verifyApproval(S.run);
  assert.ok(v.ok, v.errors.join('; '));
  assert.ok(L.verifyChain(S.run).ok);
  // Change one byte of scene code: the approval no longer verifies.
  writeFileSync(S.scene, readFileSync(S.scene, 'utf8').replace('#c08040', '#c08041'));
  assert.match(L.verifyApproval(S.run).errors.join(' '), /scene .* changed/);
});

test('regression 1: a shader/scene compilation failure is a technical fail, never approved; repeats escalate', async () => {
  const S = setup('compile-fail');
  await L.init({ contract: S.contract, runDir: S.run });
  const good = readFileSync(S.scene, 'utf8');
  for (let i = 1; i <= 3; i++) {
    writeFileSync(S.scene, good.replace('M.setup({', `const broken${i} = ;\nM.setup({`));   // syntax error, different each time
    const r = await L.iterate(S.run, { note: `attempt ${i}` });
    assert.equal(r.current.technical.ok, false);
    assert.equal(r.current.packet, null, 'no critique packet for a failed render');
    assert.match(JSON.stringify(r.current.technical.checks), /render/);
  }
  const s = L.summary(S.run);
  assert.equal(s.state, 'escalated');
  assert.equal(s.escalation.reason, 'technical-blocker');
  assert.equal(L.verifyApproval(S.run).ok, false);
  assert.equal(L.recordCritique.bind(null, S.run, {}) && (() => { try { L.recordCritique(S.run, {}); return 'recorded'; } catch (e) { return e.code; } })(), 'not-awaiting');
});

test('regression 2: reference mismatch is detected (changed plate refused, wrong plate blocks approval)', async () => {
  const S = setup('ref-mismatch');
  // A plate edited after the contract was written.
  writeFileSync(S.plates[1], Buffer.concat([readFileSync(S.plates[1]), Buffer.from([0])]));
  await assert.rejects(L.init({ contract: S.contract, runDir: S.run }), (e) => e.code === 'reference-mismatch');
  // The right file, but the wrong look: a warm, bright plate against a cool render.
  const W = setup('ref-wrong', { plateData: { hue: 20, light: 1.3, speck: 0.2 } });
  await L.init({ contract: W.contract, runDir: W.run });
  const r = await L.iterate(W.run);
  assert.ok(r.current.deltaLog.some((l) => /colour temperature|hue/.test(l)), r.current.deltaLog.join('\n'));
  const d = L.recordCritique(W.run, critique(W.run));   // even a critic who passes everything
  assert.notEqual(d.decision, 'approved');
  assert.ok(d.rubric.color.measuredBlocks.length > 0);
});

test('regression 3: budget exhaustion escalates to a human and stops the loop', async () => {
  const S = setup('budget', { budget: { maxIterations: 2, patience: 5 } });
  await L.init({ contract: S.contract, runDir: S.run });
  await L.iterate(S.run);
  assert.equal(L.recordCritique(S.run, critique(S.run, { lighting: 'fail' })).decision, 'continue');
  await L.iterate(S.run, { params: { hue: 211, light: 0.5 } });
  const last = L.recordCritique(S.run, critique(S.run, { lighting: 'fail' }));
  assert.equal(last.decision, 'escalated');
  assert.equal(last.reason, 'budget-exhausted');
  await assert.rejects(L.iterate(S.run, { params: { hue: 212, light: 0.5 } }), /escalat/);
  const esc = JSON.parse(readFileSync(join(S.run, 'escalations.json'), 'utf8'));
  assert.equal(esc[0].needs, 'human');
});

test('early stopping: a loop that stops converging without approval escalates', async () => {
  const S = setup('converge', { budget: { maxIterations: 6, patience: 2, convergenceDelta: 0.5 } });
  await L.init({ contract: S.contract, runDir: S.run });
  await L.iterate(S.run);
  L.recordCritique(S.run, critique(S.run, { narrative: 'fail' }));
  await L.iterate(S.run, { params: { hue: 210.5, light: 0.5 } });
  L.recordCritique(S.run, critique(S.run, { narrative: 'fail' }));
  await L.iterate(S.run, { params: { hue: 211, light: 0.5 } });
  const r = L.recordCritique(S.run, critique(S.run, { narrative: 'fail' }));
  assert.equal(r.reason, 'converged-without-approval');
});

test('regression 4: state restoration verifies the snapshot and revokes approvals', async () => {
  const S = setup('restore');
  await L.init({ contract: S.contract, runDir: S.run });
  await L.iterate(S.run);
  L.recordCritique(S.run, critique(S.run, { color: 'fail' }));
  const original = readFileSync(S.scene, 'utf8');
  writeFileSync(S.scene, original.replace("'#c08040'", "'#b07030'"));
  await L.iterate(S.run, { params: { hue: 213, light: 0.52 } });
  assert.equal(L.recordCritique(S.run, critique(S.run)).decision, 'approved');
  // Restore iteration 1: scene and params come back, the approval is revoked.
  const r = L.restore(S.run, 1);
  assert.equal(r.restored, 1);
  assert.equal(readFileSync(S.scene, 'utf8'), original);
  assert.equal(L.verifyApproval(S.run).ok, false);
  assert.ok(existsSync(join(S.run, 'approval-still.revoked-restore-001.json')));
  assert.equal(L.summary(S.run).state, 'restored');
  // A restored state may be re-rendered unchanged, and needs a new critique.
  const again = await L.iterate(S.run);
  assert.equal(again.state, 'awaiting-critique');
  // A tampered snapshot is refused.
  writeFileSync(join(S.run, 'iterations/002/scene.html'), 'tampered');
  assert.throws(() => L.restore(S.run, 2), (e) => e.code === 'tampered');
});

test('regression 5: frame-rate drops (held/duplicated frames, short sequences) are detected', () => {
  const w = 64, h = 36, fps = 12;
  const frame = (k) => { const f = new Uint8Array(w * h); for (let i = 0; i < f.length; i++) f[i] = (((i % w) + k * 2) * 7 + Math.floor(i / w) * 3) % 200 + 20; return f; };
  const smooth = Array.from({ length: 24 }, (_, k) => frame(k));
  const ok = analyzeSequence(smooth, { width: w, height: h, fps, expectedFrames: 24 });
  assert.ok(ok.checks.find((c) => c.id === 'frame-rate').pass, JSON.stringify(ok.checks));
  const held = Array.from({ length: 24 }, (_, k) => frame(Math.floor(k / 3) * 3));   // every frame shown 3 times = 4 fps
  const r = analyzeSequence(held, { width: w, height: h, fps, expectedFrames: 24 });
  assert.equal(r.checks.find((c) => c.id === 'frame-rate').pass, false);
  const short = analyzeSequence(smooth.slice(0, 18), { width: w, height: h, fps, expectedFrames: 24 });
  assert.equal(short.checks.find((c) => c.id === 'frame-rate').pass, false);
  assert.match(r.sampling.note, /not measured/);
});

test('temporal analysis flags flicker, camera jitter and texture boil', () => {
  const w = 64, h = 36, fps = 12;
  const base = (k, dx = 0, gain = 1) => { const f = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = Math.max(0, Math.min(255, (128 + 60 * Math.sin((x + k * 0.5 + dx) * 0.4) * Math.cos(y * 0.3)) * gain)); return f; };
  const flick = analyzeSequence(Array.from({ length: 24 }, (_, k) => base(k, 0, k % 2 ? 1.15 : 0.85)), { width: w, height: h, fps });
  assert.equal(flick.checks.find((c) => c.id === 'flicker').pass, false);
  const jitter = analyzeSequence(Array.from({ length: 24 }, (_, k) => base(k, k % 2 ? 1.6 : -1.6)), { width: w, height: h, fps });
  assert.equal(jitter.checks.find((c) => c.id === 'jitter').pass, false);
  let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const boil = analyzeSequence(Array.from({ length: 24 }, () => Uint8Array.from({ length: w * h }, () => 100 + rnd() * 40)), { width: w, height: h, fps });
  assert.equal(boil.checks.find((c) => c.id === 'swimming').pass, false, 'per-pixel boiling texture is flagged');
  const calm = analyzeSequence(Array.from({ length: 24 }, (_, k) => base(k)), { width: w, height: h, fps });
  assert.ok(['flicker', 'jitter', 'swimming'].every((id) => calm.checks.find((c) => c.id === id).pass), JSON.stringify(calm.checks));
  assert.deepEqual(keyframeTimes({ duration: 2, fps: 12, keyframes: [{ t: 0.5 }], cuts: [1], energy: [] }), [0, 0.5, 0.833, 1.167, 1.917].map((t) => Math.round(t * 12) / 12));
});

test('temporal phase: preview checks, look failures loop back to stills and revoke the still approval', async () => {
  const S = setup('temporal');
  await L.init({ contract: S.contract, runDir: S.run });
  await L.iterate(S.run, { params: { hue: 213, light: 0.52 } });
  assert.equal(L.recordCritique(S.run, critique(S.run)).decision, 'approved');
  await assert.rejects(L.temporal(S.run, { params: { hue: 300, light: 0.52 } }), (e) => e.code === 'look-change');
  const t1 = await L.temporal(S.run, { params: { hue: 213, light: 0.52, shake: 1, flicker: 1 } });
  assert.equal(t1.state, 'awaiting-temporal-critique');
  const tj = JSON.parse(readFileSync(join(S.run, 'temporal/001/temporal.json'), 'utf8'));
  assert.equal(tj.checks.find((c) => c.id === 'flicker').pass, false);
  // A critic who passes everything still can't approve a flickering preview.
  const motion = L.recordCritique(S.run, critique(S.run));
  assert.equal(motion.decision, 'loopback-temporal');
  const t2 = await L.temporal(S.run, { params: { hue: 213, light: 0.52, shake: 0, flicker: 0 } });
  assert.equal(t2.state, 'awaiting-temporal-critique');
  const look = L.recordCritique(S.run, critique(S.run, { lighting: 'fail' }));
  assert.equal(look.decision, 'loopback-still');
  assert.equal(L.summary(S.run).phase, 'still');
  assert.equal(L.verifyApproval(S.run, 'still').ok, false);
  assert.ok(L.verifyChain(S.run).ok);
});

test('regression 6: snapshot persistence: the evidence bundle reloads, verifies and detects tampering', async () => {
  const S = setup('bundle');
  await L.init({ contract: S.contract, runDir: S.run });
  await L.iterate(S.run);
  L.recordCritique(S.run, critique(S.run, { color: 'fail' }));
  await L.iterate(S.run, { params: { hue: 213, light: 0.52 } });
  L.recordCritique(S.run, critique(S.run));
  await L.temporal(S.run, { params: { hue: 213, light: 0.52 } });
  assert.equal(L.recordCritique(S.run, critique(S.run)).decision, 'approved');
  // A fresh process sees the same state from disk.
  const r = spawnSync(process.execPath, [join(ROOT, 'refine.mjs'), 'verify', S.run, '--phase', 'temporal', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
  const b = L.exportBundle(S.run, { dest: join(S.dir, 'bundle') });
  assert.ok(b.files > 20);
  const v = L.verifyBundle(b.dest);
  assert.ok(v.ok, v.errors.join('; '));
  const m = JSON.parse(readFileSync(join(b.dest, 'manifest.json'), 'utf8'));
  assert.equal(m.stillApproval && m.temporalApproval && m.chainVerified, true);
  assert.ok(Object.keys(m.files).some((f) => f.endsWith('critique.json')) && Object.keys(m.files).some((f) => f.endsWith('scene.html')));
  assert.match(readFileSync(join(b.dest, 'SUMMARY.md'), 'utf8'), /temporal 1: approved/);
  writeFileSync(join(b.dest, 'iterations/002/critique.json'), '{}');
  assert.match(L.verifyBundle(b.dest).errors.join(' '), /changed iterations\/002\/critique.json/);
});
