// Wipe transitions: reveal maps, soft masks, the transition grammar, plan checks and one real render.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FF, ff, sentencesOf } from '../tools/longform/common.mjs';
import { FAMILIES, maskFrame, revealMap, wipeFrames } from '../tools/longform/wipes.mjs';
import { TRANSITIONS, XFADE, cycleOf, parseTransition, wipeGraph } from '../tools/longform/transitions.mjs';
import { resolvePlan } from '../tools/longform/plan.mjs';
import { parseCue, planFromScript } from '../tools/longform/script.mjs';
import { composite } from '../tools/longform/build.mjs';

const names = Object.keys(FAMILIES);
const sha = (b) => createHash('sha1').update(b).digest('hex');
const mask = (family, p, softness = 0.1, params = {}, w = 32, h = 18) => maskFrame(revealMap(family, params, w, h), p, softness);

test('there are twenty families and each has a one-line shape in the docs', () => {
  assert.equal(names.length, 20);
  const doc = readFileSync(new URL('../docs/TRANSITIONS.md', import.meta.url), 'utf8');
  for (const n of names) assert.ok(doc.includes('`' + n + '`'), `docs/TRANSITIONS.md lists ${n}`);
});

test('every family: p=0 all black, p=1 all white, monotonic in p', () => {
  assert.equal(names.length, 20);
  for (const n of names) for (const softness of [0, 0.1, 0.5]) {
    const map = revealMap(n, {}, 32, 18);
    assert.equal(map.length, 32 * 18);
    const ps = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((p) => maskFrame(map, p, softness));
    assert.ok(ps[0].every((v) => v === 0), `${n} softness ${softness}: p=0 is black`);
    assert.ok(ps[6].every((v) => v === 255), `${n} softness ${softness}: p=1 is white`);
    for (let k = 1; k < ps.length; k++) for (let i = 0; i < ps[k].length; i++) assert.ok(ps[k][i] >= ps[k - 1][i], `${n} softness ${softness}: pixel ${i} never darkens`);
    const mid = ps[3];
    assert.ok(mid.some((v) => v > 0) && mid.some((v) => v < 255), `${n}: the middle frame is a real wipe, not all one colour`);
  }
});

test('a hand-worked linear wipe: four pixels, softness 0.5, p=0.5', () => {
  const m = maskFrame(revealMap('linear', {}, 4, 1), 0.5, 0.5);
  assert.deepEqual([...m], [255, 236, 19, 0]);
});

test('masks are deterministic', () => {
  for (const n of names) assert.equal(sha(mask(n, 0.4)), sha(mask(n, 0.4)), n);
  // golden pins for the families that are pure arithmetic (no trigonometry, so the same on every V8). Pinned from the implementation after the hand-worked test below passed;
  // a change to a family's maths should change its hash AND bump WIPES_VERSION in wipes.mjs
  const golden = {
    'linear': 'e31ead4b91643222d490f34773d80e66d56a23cf',
    'box': '9f35dd90216e53de9af85d8365e7ec31ce7f8f4e',
    'diamond': 'e03486048505e18cd43dff2d242c8fda41adb591',
    'cross': '63944d902d8d988b6982b1722d342cc8e061152c',
    'barn-h': '7bf00faf48bd8e956bf574bbeee82de171b3e565',
    'barn-v': '17636042b125e3704eb060c32b628962791d02fc',
    'blinds-h': '902db8f8025bba583d02c21bc2f5d0684ee62edb',
    'blinds-v': '53dce9b939a9a4dda87eaeca6e990d6d982a8eee',
    'checker': '8f6675178a3dc74f17dee8bc69f3ea9a6dd63c26',
    'noise': '12ff7a558a074e09cab90a62bf7e3bd3308391c4',
  };
  for (const [n, want] of Object.entries(golden)) assert.equal(sha(mask(n, 0.5)), want, `${n} golden`);
});

test('noise is seeded', () => {
  const a = mask('noise', 0.5, 0.1, { seed: 7 }), b = mask('noise', 0.5, 0.1, { seed: 7 }), c = mask('noise', 0.5, 0.1, { seed: 8 });
  assert.equal(sha(a), sha(b));
  assert.notEqual(sha(a), sha(c));
  assert.equal(sha(mask('noise', 0.5)), sha(mask('noise', 0.5, 0.1, { seed: 1 })), 'the default seed is 1');
});

test('parseTransition accepts legacy names, wipe strings and objects; rejects bad family/softness/dur', () => {
  assert.equal(parseTransition(undefined), null);
  assert.deepEqual(parseTransition('smoothleft'), { type: 'xfade', name: 'smoothleft' });
  assert.deepEqual(parseTransition('cut'), { type: 'cut' });
  assert.deepEqual(parseTransition('no-such-name'), { type: 'unknown', name: 'no-such-name' });
  const plain = parseTransition('wipe:iris');
  assert.equal(plain.type, 'wipe'); assert.equal(plain.family, 'iris'); assert.equal(plain.softness, 0.1); assert.equal(plain.dur, null);
  const s = parseTransition('wipe:linear(softness=0.15 dur=0.6 angle=30)');
  assert.equal(s.softness, 0.15); assert.equal(s.dur, 0.6); assert.equal(s.params.angle, 30);
  const o = parseTransition({ wipe: 'linear', softness: 0.15, angle: 30 });
  assert.deepEqual(o, { ...s, dur: null });
  assert.equal(parseTransition('wipe:blinds-h').params.count, 8, 'family defaults fill in');
  for (const bad of ['wipe:nope', 'wipe:', 'wipe:iris(softness=2)', 'wipe:iris(softness=-0.1)', 'wipe:iris(softness=abc)', 'wipe:iris(dur=0)', 'wipe:iris(dur=99)',
    'wipe:iris(speed=3)', 'wipe:iris(softness=0.2', 'wipe:iris(softness)', 'wipe:iris(softness=0.2,dur=0.5)', 'wipe:blinds-h(count=0)',
    { wipe: 'nope' }, { wipe: 'iris', softness: 5 }, { wipe: 'iris', bogus: 1 }, { softness: 0.1 }, 42]) {
    assert.throws(() => parseTransition(bad), /transition|wipe/i, JSON.stringify(bad));
  }
});

test('the legacy table moved out of build.mjs unchanged, and cycleOf keeps today\'s defaults', () => {
  assert.deepEqual(TRANSITIONS, ['smoothleft', 'slideup', 'circleopen', 'hblur', 'smoothup', 'slideleft']);
  assert.ok(XFADE.size === 27 && XFADE.has('fade') && XFADE.has('squeezev'));
  assert.deepEqual(cycleOf(undefined), TRANSITIONS);
  assert.deepEqual(cycleOf('fade'), ['fade']);
  assert.deepEqual(cycleOf(['dissolve', 'wipeleft']), ['dissolve', 'wipeleft']);
  assert.deepEqual(cycleOf([]), TRANSITIONS);
  assert.deepEqual(cycleOf(['dissolve', 'bogus', 'wipe:iris']), ['dissolve', 'wipe:iris'], 'an unknown name would have made ffmpeg fail, so it is dropped');
  assert.deepEqual(cycleOf('wipe:iris(softness=0.2)'), ['wipe:iris(softness=0.2)']);
});

function fakeLib() {
  const words = [['Hello', 0.5, 0.8], ['there.', 0.85, 1.2], ['So', 2.3, 2.45], ['this', 2.5, 2.7], ['is', 2.75, 2.85], ['the', 2.9, 3.0], ['point.', 4.25, 4.7], ['Okay.', 7.0, 7.4]].map(([w, s, e]) => ({ w, s, e }));
  return { clips: { a: { id: 'a', file: '/x/a.mp4', key: 'k', duration: 8, words, sentences: sentencesOf(words), hasAudio: true } } };
}
const planWith = (extra, ins = {}) => ({ name: 't', fps: 30, a_roll: [{ clip: 'a' }], music: [], inserts: [{ kind: 'image', file: 'LICENSE', at: 0.2, dur: 2, ...ins }], ...extra });

test('resolvePlan errors on a bad wipe, warns on an unknown name', () => {
  const lib = fakeLib();
  const ok = resolvePlan(planWith({}, { transition: 'wipe:iris(softness=0.2)' }), lib);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.inserts[0].transition.family, 'iris');
  const bad = resolvePlan(planWith({}, { transition: 'wipe:nope' }), lib);
  assert.ok(bad.errors.some((e) => /inserts\[0\].*wipe/i.test(e)), bad.errors.join('|'));
  assert.ok(resolvePlan(planWith({}, { transition: 'wipe:iris(softness=9)' }), lib).errors.length);
  const unknown = resolvePlan(planWith({}, { transition: 'swirly' }), lib);
  assert.deepEqual(unknown.errors, []);
  assert.ok(unknown.warnings.some((w) => /swirly/.test(w)), unknown.warnings.join('|'));
  assert.deepEqual(resolvePlan(planWith({}, { transition: 'cut' }), lib).warnings.filter((w) => /transition/.test(w)), []);
  assert.deepEqual(resolvePlan(planWith({ transitions: ['smoothleft', 'wipe:clock(dur=0.5)', { wipe: 'linear' }, 'fade'] }), lib).errors, []);
  assert.ok(resolvePlan(planWith({ transitions: ['wipe:clock(dur=0)'] }), lib).errors.some((e) => /transitions\[0\]/.test(e)));
  assert.ok(resolvePlan(planWith({ transitions: ['smoothleft', 'swirly'] }), lib).warnings.some((w) => /transitions\[1\].*swirly/.test(w)));
  assert.deepEqual(resolvePlan(planWith({ transitions: 'fade' }), lib).warnings.filter((w) => /transition/.test(w)), []);
});

test('script cue keeps "transition: wipe:iris(softness=0.2)"', () => {
  const c = parseCue('stat value: 5 | transition: wipe:iris(softness=0.2 dur=0.6)');
  assert.equal(c.opts.transition, 'wipe:iris(softness=0.2 dur=0.6)');
  const lib = fakeLib();
  const script = '---\ntitle: T\ntransitions: wipe:iris(softness=0.2), smoothleft, wipe:blinds-h(count=6 dur=0.5)\n---\nHello there. So this is the point. [[stat value: 5 | transition: wipe:clock(softness=0.2)]] Okay.\n';
  const { plan } = planFromScript(script, lib.clips.a);
  assert.deepEqual(plan.transitions, ['wipe:iris(softness=0.2)', 'smoothleft', 'wipe:blinds-h(count=6 dur=0.5)']);
  assert.equal(plan.inserts[0].transition, 'wipe:clock(softness=0.2)');
  assert.equal(parseTransition(plan.inserts[0].transition).family, 'clock');
});

test('wipeFrames writes cached PNG masks and reuses them', () => {
  const cache = mkdtempSync(join(tmpdir(), 'wipes-'));
  try {
    const spec = parseTransition('wipe:iris(softness=0.2)');
    const dir = wipeFrames(spec, { w: 32, h: 18, fps: 30, dur: 0.3, cache });
    const files = readdirSync(dir).sort();
    assert.deepEqual(files, Array.from({ length: 9 }, (_, i) => `${String(i).padStart(4, '0')}.png`));
    const png = readFileSync(join(dir, files[0]));
    assert.equal(png.readUInt32BE(0), 0x89504e47, 'a PNG');
    assert.equal(png.readUInt32BE(16), 32); assert.equal(png.readUInt32BE(20), 18);
    const t = statSync(join(dir, files[0])).mtimeMs;
    assert.equal(wipeFrames(spec, { w: 32, h: 18, fps: 30, dur: 0.3, cache }), dir, 'same inputs, same folder');
    assert.equal(statSync(join(dir, files[0])).mtimeMs, t, 'and nothing is rewritten');
    assert.notEqual(wipeFrames(spec, { w: 32, h: 18, fps: 30, dur: 0.4, cache }), dir, 'a different length is a different folder');
    assert.notEqual(wipeFrames(parseTransition('wipe:iris(softness=0.3)'), { w: 32, h: 18, fps: 30, dur: 0.3, cache }), dir, 'so is a different softness');
    assert.notEqual(wipeFrames(parseTransition('wipe:clock(softness=0.2)'), { w: 32, h: 18, fps: 30, dur: 0.3, cache }), dir, 'or family');
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

test('wipeGraph builds an alphamerge + overlay graph, shifted for an outgoing wipe', () => {
  const inn = wipeGraph('bgA', 'vis', 2, 0.3, 0, 'x1');
  assert.match(inn, /\[2:v\]/); assert.match(inn, /alphamerge/); assert.match(inn, /\[bgA\]\[[^\]]+\]overlay/); assert.match(inn, /\[x1\]$/);
  assert.ok(!/xfade|setpts=PTS\+/.test(inn), 'no shift when it starts at 0');
  const out = wipeGraph('x1', 'tail', 3, 0.3, 0.9, 'x2');
  assert.match(out, /setpts=PTS\+0\.900\/TB/); assert.match(out, /\[x2\]$/);
});

test('rendered wipe: first frame = A, last = B within tolerance, middle differs from both', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wipe-render-'));
  try {
    const clip = (name, color, d) => { const f = join(dir, name); ff(['-f', 'lavfi', '-i', `color=c=${color}:s=64x36:r=30:d=${d}`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-g', '30', f], name); return f; };
    const aroll = clip('a.mp4', 'red', 3), blue = clip('b.mp4', 'blue', 2), mix = join(dir, 'mix.wav'), out = join(dir, 'out', 'o.mp4');
    ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '3', mix], 'mix');
    const R = { total: 3, inserts: [{ id: 'b', at: 1, dur: 1.2, layout: 'full', media: blue, src: { transition: 'wipe:linear(softness=0.1 dur=0.5)' } }] };
    composite(R, { fps: 30 }, { video: aroll }, mix, out, '#FC5C2B');
    assert.ok(existsSync(out));
    const raw = spawnSync(FF, ['-v', 'error', '-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 }).stdout;
    const size = 64 * 36 * 3, n = raw.length / size;
    assert.equal(n, 90, 'every frame came out');
    const frame = (i) => raw.subarray(i * size, (i + 1) * size);
    const flat = (r, g, b) => Buffer.from(Array.from({ length: size }, (_, k) => [r, g, b][k % 3]));
    const RED = flat(255, 0, 0), BLUE = flat(0, 0, 255);
    const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
    assert.ok(mad(frame(10), RED) < 12, 'the A-roll before is red');
    // incoming: the insert starts at frame 30; the wipe lasts 0.3 s (a quarter of 1.2 s) = 9 frames
    assert.ok(mad(frame(30), RED) < 12, `first frame is A (${mad(frame(30), RED).toFixed(1)})`);
    assert.ok(mad(frame(38), BLUE) < 12, `last frame is B (${mad(frame(38), BLUE).toFixed(1)})`);
    assert.ok(mad(frame(34), RED) > 30 && mad(frame(34), BLUE) > 30, `middle differs from both (${mad(frame(34), RED).toFixed(1)}, ${mad(frame(34), BLUE).toFixed(1)})`);
    const px = (i, x) => frame(i).subarray((18 * 64 + x) * 3, (18 * 64 + x) * 3 + 3);
    assert.ok(px(34, 2)[2] > 200 && px(34, 61)[0] > 200, 'linear angle 0 reveals B from the left (a legacy xfade would not)');
    assert.ok(mad(frame(48), BLUE) < 12, 'the insert holds blue');
    // outgoing: the last 9 frames of the insert (57-65) wipe back to the A-roll
    assert.ok(mad(frame(57), BLUE) < 12, 'out: first frame is B');
    assert.ok(mad(frame(65), RED) < 12, 'out: last frame is A');
    assert.ok(mad(frame(61), RED) > 30 && mad(frame(61), BLUE) > 30, 'out: middle differs from both');
    assert.ok(px(61, 2)[0] > 200 && px(61, 61)[2] > 200, 'out: A comes back from the left');
    assert.ok(mad(frame(80), RED) < 12, 'the A-roll after is red');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a wipe between two touching visuals starts from the last frame of the first, not the speaker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wipe-render-'));
  try {
    const clip = (name, color, d) => { const f = join(dir, name); ff(['-f', 'lavfi', '-i', `color=c=${color}:s=64x36:r=30:d=${d}`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-g', '30', f], name); return f; };
    const aroll = clip('a.mp4', 'red', 4), green = clip('g.mp4', 'green', 2), blue = clip('b.mp4', 'blue', 2), mix = join(dir, 'mix.wav'), out = join(dir, 'out', 'o.mp4');
    ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '4', mix], 'mix');
    const R = { total: 4, inserts: [
      { id: 'g', at: 1, dur: 1.2, layout: 'full', media: green, src: { transition: 'cut' } },
      { id: 'b', at: 2.2, dur: 1.2, layout: 'full', media: blue, src: { transition: { wipe: 'iris', softness: 0.1, dur: 0.3 } } }] };
    composite(R, { fps: 30 }, { video: aroll }, mix, out, '#FC5C2B');
    const raw = spawnSync(FF, ['-v', 'error', '-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 }).stdout;
    const size = 64 * 36 * 3, frame = (i) => raw.subarray(i * size, (i + 1) * size);
    const flat = (r, g, b) => Buffer.from(Array.from({ length: size }, (_, k) => [r, g, b][k % 3]));
    const GREEN = flat(0, 128, 0), BLUE = flat(0, 0, 255);
    const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
    assert.equal(raw.length / size, 120);
    assert.ok(mad(frame(60), GREEN) < 12, 'the first visual holds');
    assert.ok(mad(frame(66), GREEN) < 12, `the wipe starts from green, not red (${mad(frame(66), GREEN).toFixed(1)})`);
    assert.ok(mad(frame(70), GREEN) > 20 && mad(frame(70), BLUE) > 20, 'middle differs from both');
    assert.ok(mad(frame(74), BLUE) < 12, 'and ends on blue');
    const c = (i) => frame(i).subarray((18 * 64 + 32) * 3, (18 * 64 + 32) * 3 + 3);
    assert.ok(c(70)[2] > 200, 'an iris opens from the centre');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
