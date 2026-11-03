// Street-footage tools: reframing, audio clean-up, face finding, street-interview blocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { Canvas } from 'skia-canvas';
import { pickTrack, placement, followExpr, cropFilter } from '../tools/reframe.mjs';
import { audioOptions, cleanChain, levelGain, speakerGains, loudness } from '../tools/audio.mjs';

const ff = (args) => { const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
const wide = { id: 'C01', width: 1920, height: 1080 };

test('reframe: a still face gets one crop centred on it; manual focus wins', () => {
  const track = pickTrack([[0, [[0.7, 0.4, 0.2]]], [1, [[0.71, 0.4, 0.2]]], [2, [[0.7, 0.41, 0.2]]]]);
  const p = placement(wide, { track, a: 0, b: 2 });
  assert.equal(p.mode, 'face');
  assert.ok(Math.abs(p.x + 540 - 0.7 * p.sw) < 30, 'face is centred across');
  assert.equal(placement(wide, { track, focus: 0, a: 0, b: 2 }).x, 0);
  assert.equal(placement(wide, { a: 0, b: 2 }).mode, 'centre');
});

test('reframe: a moving face is followed with a pan that hits each keyframe', () => {
  const samples = [0, 1, 2, 3, 4].map((t) => [t, [[0.2 + t * 0.15, 0.4, 0.2]]]);
  const p = placement(wide, { track: pickTrack(samples), a: 1, b: 4 });
  assert.equal(p.mode, 'follow');
  const expr = followExpr(p.keys);
  const evalAt = (t) => Function('t', 'const lt=(a,b)=>a<b?1:0; const iff=(c,a,b)=>c?a:b; return ' + expr.replace(/if\(/g, 'iff(').replace(/lt\(/g, 'lt('))(t);
  for (const k of p.keys) assert.ok(Math.abs(evalAt(k.t) - k.x) < 1, `x at ${k.t}`);
  assert.match(cropFilter(wide, { track: pickTrack(samples), a: 1, b: 4 }).filter, /crop=1080:1920:'if\(/);
});

test('reframe: "largest" stays on the person it follows instead of flipping to a similar-size face', () => {
  const samples = [[0, [[0.3, 0.4, 0.2], [0.75, 0.4, 0.18]]], [1, [[0.75, 0.4, 0.21], [0.31, 0.4, 0.2]]], [2, [[0.3, 0.4, 0.2]]]];
  assert.ok(pickTrack(samples).every((p) => p.cx < 0.4));
  assert.ok(pickTrack(samples, 'right').slice(0, 2).every((p) => p.cx > 0.7));
});

test('audio: options merge plan and segment; false turns cleaning off', () => {
  assert.equal(audioOptions({ audio: false }), null);
  const o = audioOptions({ audio: { denoise: 'strong' } }, { audio: { wind: true } });
  assert.equal(o.denoise, 'strong'); assert.equal(o.wind, true);
  const chain = cleanChain(o);
  for (const f of ['highpass=f=120', 'afftdn=nr=24', 'deesser', 'acompressor']) assert.ok(chain.includes(f), f);
  assert.equal(levelGain(-70), 0);
  assert.equal(levelGain(-40, -16, 15), 15);
  const g = speakerGains([{ clip: 'C1', speaker: 'a', lufs: -12, dur: 2, target: -16, maxGain: 15 }, { clip: 'C1', speaker: 'a', lufs: -14, dur: 2, target: -16, maxGain: 15 }, { clip: 'C1', speaker: 'b', lufs: -30, dur: 1, target: -16, maxGain: 15 }]);
  assert.equal(g[0], g[1], 'one speaker, one gain');
  assert.equal(g[2], 14);
});

test('audio: cleaning lowers street noise and levelling evens a loud and a quiet speaker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfk-audio-'));
  try {
    const voice = (f, amp) => `sine=f=${f}:d=3,volume=${amp},volume='0.6+0.4*sin(2*PI*4*t)':eval=frame`;
    ff(['-f', 'lavfi', '-i', `${voice(140, 0.5)}`, '-f', 'lavfi', '-i', `${voice(210, 0.03)}`, '-f', 'lavfi', '-i', 'anoisesrc=d=6:c=brown:a=0.08',
      '-filter_complex', '[0][1]concat=n=2:v=0:a=1[v];[v][2]amix=inputs=2:normalize=0', '-ar', '44100', join(dir, 'x.wav')]);
    const f = join(dir, 'x.wav'), o = audioOptions({ audio: { wind: true } }), chain = cleanChain(o);
    const loud = loudness(f, { from: 0, dur: 3, chain }), quiet = loudness(f, { from: 3, dur: 3, chain });
    const g = speakerGains([{ clip: 'x', speaker: 'a', lufs: loud, dur: 3, target: -16, maxGain: 30 }, { clip: 'x', speaker: 'b', lufs: quiet, dur: 3, target: -16, maxGain: 30 }]);
    assert.ok(Math.abs((loud + g[0]) - (quiet + g[1])) < 0.5, 'levels meet');
    // the rumble below 120 Hz is mostly gone
    const low = (c) => loudness(f, { from: 3, dur: 3, chain: [c, 'lowpass=f=100'].filter(Boolean).join(',') });
    assert.ok(low(chain) < low('') - 6, 'low-frequency noise down by more than 6 dB');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const hasCv = spawnSync('python3', ['-c', 'import cv2, numpy']).status === 0;
test('faces.py follows a face moving across a horizontal clip', { skip: !hasCv && 'OpenCV not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfk-face-'));
  try {
    const face = new URL('./fixtures/face.jpg', import.meta.url).pathname, clip = join(dir, 'c.mp4');
    ff(['-f', 'lavfi', '-i', 'color=c=0x556070:s=1920x1080:d=3:r=15', '-loop', '1', '-i', face, '-filter_complex', "[1]scale=360:-1[f];[0][f]overlay=x='200+t*450':y=300:shortest=1", '-t', '3', '-pix_fmt', 'yuv420p', clip]);
    const r = spawnSync('python3', [new URL('../tools/faces.py', import.meta.url).pathname, ffmpegPath, clip, '2'], { encoding: 'utf8' });
    const { samples } = JSON.parse(r.stdout);
    const xs = pickTrack(samples).map((p) => p.cx);
    assert.ok(xs.length >= 4, 'found the face in most samples');
    assert.ok(xs[xs.length - 1] - xs[0] > 0.4, 'and followed it left to right');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('street-interview blocks draw, stay inside the frame and disappear when done', () => {
  const window = {};
  const ctx0 = { window, document: { fonts: { load: async () => [{}] } }, Image: class {}, setTimeout, console };
  vm.runInNewContext(readFileSync(new URL('../kit/motion.js', import.meta.url), 'utf8'), ctx0);
  vm.runInNewContext(readFileSync(new URL('../kit/blocks.js', import.meta.url), 'utf8'), ctx0);
  const { B } = window;
  const canvas = new Canvas(1080, 1920), ctx = canvas.getContext('2d');
  const q = B.questionCard(ctx, 1, { at: 0, text: 'What would you pay for this?', y: 250 });
  assert.ok(q.bottom > 300 && q.bottom < 700);
  B.lowerThird(ctx, 2, { at: 1, name: 'Sam', detail: 'Example' });
  B.counter(ctx, 2, { at: 1, n: 7, total: 50 });
  const tl = B.tally(ctx, 3, { at: 1, title: 'Switch?', options: [{ label: 'Yes', value: 3 }, { label: 'No', value: 1 }] });
  assert.ok(tl.bottom < 1440, 'tally stays above the caption zone');
  assert.ok(ctx.getImageData(540, 300, 1, 1).data[3] > 0, 'card painted');
  const empty = new Canvas(1080, 1920).getContext('2d');
  B.questionCard(empty, 5, { at: 0, until: 4, text: 'gone' });
  B.lowerThird(empty, 5, { at: 1, until: 3, name: 'gone' });
  assert.equal(empty.getImageData(540, 300, 1, 1).data[3], 0);
  // creator formats: the photo panel shows the newest item that has started; title pills and meme cards draw
  const seen = [];
  const items = [0, 1, 2].map((i) => ({ at: i, draw: () => seen.push(i) }));
  assert.equal(B.photoPanel(ctx, 1.5, { items }).index, 1);
  assert.deepEqual(seen, [1]);
  assert.equal(B.photoPanel(ctx, 9, { items, until: 5 }).index, undefined);
  B.nativeText(ctx, 0.5, { text: 'Mega ping pong for brands?', style: 'dark' });
  assert.ok(B.memeCard(ctx, 1, { text: 'Me pitching a stunt' }).bottom > 300);
  assert.ok(window.M.CAPTION_STYLES.includes('word'));
});
