// Street-footage tools: reframing, audio clean-up, face finding, street-interview blocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { chmodSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { Canvas } from 'skia-canvas';
import { pickTrack, placement, followExpr, cropFilter } from '../tools/reframe.mjs';
import { audioOptions, cleanChain, levelGain, speakerGains, loudness, speechCut, speechEnvelope } from '../tools/audio.mjs';
import { wordsForPiece } from '../tools/caption-timing.mjs';

const ff = (args) => { const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
const wide = { id: 'C01', width: 1920, height: 1080 };

function wav(file, seconds, sample) {
  const rate = 16000, n = Math.round(seconds * rate), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample(i / rate) * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([h, data]));
}

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

test('audio: speech cuts keep a phrase through its real release and room tone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfk-speech-'));
  try {
    const file = join(dir, 'pause.wav');
    wav(file, 2, (t) => ((t >= 0.2 && t < 0.72) || (t >= 1.2 && t < 1.7)) ? 0.3 * Math.sin(2 * Math.PI * 220 * t) : 0);
    const first = { w: 'first', s: 0.22, e: 0.55 }, next = { w: 'next', s: 1.2, e: 1.55 };
    const [a, b] = speechCut(speechEnvelope(file), first, first, null, next);
    assert.ok(a >= 0 && a < first.s, `lead starts before word: ${a}`);
    assert.ok(b >= 0.84 && b <= 0.92, `cut follows the 0.72s release plus room: ${b}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('audio: run-together words cut in the energy dip, not after a fake pause', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfk-speech-'));
  try {
    const file = join(dir, 'joined.wav');
    wav(file, 1.6, (t) => {
      if (t < 0.2 || t >= 1.5) return 0;
      const amp = t >= 0.78 && t < 0.84 ? 0.015 : 0.3;
      return amp * Math.sin(2 * Math.PI * 220 * t);
    });
    const first = { w: 'one', s: 0.2, e: 0.7 }, next = { w: 'two', s: 0.86, e: 1.3 };
    const [, b] = speechCut(speechEnvelope(file), first, first, null, next);
    assert.ok(b >= 0.77 && b <= 0.86, `cut lands in dip: ${b}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('audio: first and final word cuts stay inside the decoded clip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfk-speech-'));
  try {
    const file = join(dir, 'edge.wav');
    wav(file, 1, (t) => t >= 0.02 ? 0.2 * Math.sin(2 * Math.PI * 180 * t) : 0);
    const only = { w: 'edge', s: 0.02, e: 0.95 };
    const [a, b] = speechCut(speechEnvelope(file), only, only, null, null);
    assert.ok(a >= 0, `start is non-negative: ${a}`);
    assert.ok(b >= 0.99, `continuous speech is preserved through the decoded end: ${b}`);
    assert.ok(b <= 1, `end is clamped to decoded duration: ${b}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('audio: percentile normalization keeps quiet and noisy speech cut timing stable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfk-speech-'));
  try {
    const variants = [{ amp: 0.3, noise: 0 }, { amp: 0.006, noise: 0 }, { amp: 0.12, noise: 0.008 }];
    const cuts = variants.map(({ amp, noise }, i) => {
      const file = join(dir, `level-${i}.wav`);
      wav(file, 1.5, (t) => (t >= 0.2 && t < 0.72 ? amp * Math.sin(2 * Math.PI * 240 * t) : 0)
        + noise * (Math.sin(2 * Math.PI * 977 * t) + Math.sin(2 * Math.PI * 1231 * t)) / 2);
      const word = { w: 'quiet', s: 0.22, e: 0.55 };
      return speechCut(speechEnvelope(file), word, word, null, null)[1];
    });
    assert.ok(cuts.every((cut) => Math.abs(cut - cuts[0]) <= 0.03), `cuts differ: ${cuts.join(', ')}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('audio: failed envelope decode is reported and retried instead of cached', () => {
  const missing = join(tmpdir(), `missing-audio-${process.pid}.wav`);
  const warnings = [], old = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    assert.equal(speechEnvelope(missing).env.length, 0);
    assert.equal(speechEnvelope(missing).env.length, 0);
  } finally { console.warn = old; }
  assert.equal(warnings.length, 2, `one warning per failed attempt: ${warnings.join(' | ')}`);
  assert.ok(warnings.every((w) => w.includes('audio envelope') && w.includes(missing)));
});

test('footage captions hold the final word until the audio-aware cut ends', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfk-caption-'));
  const name = `caption-timing-${process.pid}`, out = fileURLToPath(new URL(`../out/edits/${name}`, import.meta.url));
  try {
    const words = JSON.parse(readFileSync(new URL('../examples/demo/footage/street-02.words.json', import.meta.url)));
    const clip = fileURLToPath(new URL('../examples/demo/footage/street-02.mp4', import.meta.url));
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ clips: [{
      id: 'C01', path: clip, duration: 8, width: 1280, height: 720, fps: 30, hasAudio: true, words,
      sentences: [{ n: 0, s: words[0].s, e: words[6].e, from: 0, to: 6 }], speech: [], thumb: '',
    }] }));
    const plan = join(dir, 'plan.json');
    writeFileSync(plan, JSON.stringify({ name, audio: false, segments: [{ clip: 'C01', sentence: 0 }] }));
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../footage.mjs', import.meta.url)), 'cut', plan], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, FOOTAGE_DIR: dir }, encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const captions = JSON.parse(readFileSync(join(out, 'aroll.words.json'), 'utf8'));
    const data = JSON.parse(readFileSync(join(out, 'data.json'), 'utf8'));
    assert.ok(captions.length);
    assert.equal(captions.at(-1).e, data.segments[0].end, 'last caption reaches the piece/cut boundary');

    writeFileSync(plan, JSON.stringify({ name, audio: false, segments: [{ clip: 'C01', from: 0, to: 6, tight: false }] }));
    const loose = spawnSync(process.execPath, [fileURLToPath(new URL('../footage.mjs', import.meta.url)), 'cut', plan], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, FOOTAGE_DIR: dir }, encoding: 'utf8',
    });
    assert.equal(loose.status, 0, loose.stderr || loose.stdout);
    const looseCaptions = JSON.parse(readFileSync(join(out, 'aroll.words.json'), 'utf8'));
    const looseData = JSON.parse(readFileSync(join(out, 'data.json'), 'utf8'));
    assert.ok(looseCaptions.at(-1).e < looseData.segments[0].end - 0.2, 'untightened trailing silence does not hold the caption');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('mid-piece captions reach the next onset but do not hang over long pauses', () => {
  const timed = wordsForPiece([
    { w: 'first', s: 1, e: 1.1 },
    { w: 'second', s: 1.24, e: 1.35 },
    { w: 'pause', s: 2.2, e: 2.35 },
  ], { sourceIn: 1, sourceOut: 2.8, timelineIn: 10, tightened: true, hasAudio: true });
  assert.equal(timed[0].e, 10.24, 'early mid-word end reaches the next real onset');
  assert.equal(timed[1].e, 10.7, 'long silence is capped at a short caption hold');
  assert.equal(timed[2].e, 11.8, 'tightened final word reaches the actual piece boundary');

  const loose = wordsForPiece([{ w: 'last', s: 1, e: 1.2 }], { sourceIn: 1, sourceOut: 3, timelineIn: 0, tightened: false, hasAudio: true });
  assert.equal(loose[0].e, 0.2, 'untightened trailing room tone does not hold the final caption');
});

test('verify_words reports tool failures clearly and normalizes numeric words', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfk-verify-'));
  try {
    const verify = fileURLToPath(new URL('../tools/verify_words.py', import.meta.url));
    const mp4 = join(dir, 'cut.mp4'), caps = join(dir, 'cut.words.json'), record = join(dir, 'wav-path.txt');
    writeFileSync(mp4, '');
    writeFileSync(caps, JSON.stringify([{ w: 'Eight,', s: 0, e: 0.5 }]));
    const fakeFfmpeg = join(dir, 'ffmpeg');
    writeFileSync(fakeFfmpeg, `#!/bin/sh\nfor last do :; done\nprintf wav > "$last"\nprintf '%s' "$last" > "${record}"\n`);
    chmodSync(fakeFfmpeg, 0o755);
    const okTranscribe = join(dir, 'ok.py');
    writeFileSync(okTranscribe, 'import json\nprint(json.dumps({"words":[{"w":"8","s":0,"e":0.5}]}))\n');
    let r = spawnSync('python3', [verify, fakeFfmpeg, mp4, okTranscribe], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /0 differences/);
    assert.notEqual(readFileSync(record, 'utf8'), join(tmpdir(), 'verify_cut.wav'), 'uses an isolated temporary file');

    writeFileSync(caps, JSON.stringify([{ w: '105', s: 0, e: 0.5 }, { w: "don't", s: 0.5, e: 1 }]));
    const expandedTranscribe = join(dir, 'expanded.py');
    writeFileSync(expandedTranscribe, 'import json\nprint(json.dumps({"words":[{"w":"one","s":0,"e":0.1},{"w":"hundred","s":0.1,"e":0.2},{"w":"five","s":0.2,"e":0.5},{"w":"dont","s":0.5,"e":1}]}))\n');
    r = spawnSync('python3', [verify, fakeFfmpeg, mp4, expandedTranscribe], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /0 differences/);

    writeFileSync(caps, JSON.stringify([{ w: '21', s: 0, e: 0.5 }]));
    const hyphenTranscribe = join(dir, 'hyphen.py');
    writeFileSync(hyphenTranscribe, 'import json\nprint(json.dumps({"words":[{"w":"twenty-one","s":0,"e":0.5}]}))\n');
    r = spawnSync('python3', [verify, fakeFfmpeg, mp4, hyphenTranscribe], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /0 differences/);
    const multiTokenTranscribe = join(dir, 'multi-token.py');
    writeFileSync(multiTokenTranscribe, 'import json\nprint(json.dumps({"words":[{"w":"twenty","s":0,"e":0.2},{"w":"one","s":0.2,"e":0.5}]}))\n');
    r = spawnSync('python3', [verify, fakeFfmpeg, mp4, multiTokenTranscribe], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /0 differences/);

    writeFileSync(caps, JSON.stringify([{ w: 'Eight,', s: 0, e: 0.5 }]));
    const mismatchTranscribe = join(dir, 'mismatch.py');
    writeFileSync(mismatchTranscribe, 'import json\nprint(json.dumps({"words":[{"w":"nine","s":0,"e":0.5}]}))\n');
    r = spawnSync('python3', [verify, fakeFfmpeg, mp4, mismatchTranscribe], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /1 differences/);

    const errorTranscribe = join(dir, 'error.py');
    writeFileSync(errorTranscribe, 'import json\nprint(json.dumps({"error":"faster-whisper unavailable"}))\n');
    r = spawnSync('python3', [verify, fakeFfmpeg, mp4, errorTranscribe], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /faster-whisper unavailable/);

    const failedTranscribe = join(dir, 'failed.py');
    writeFileSync(failedTranscribe, 'import sys\nprint("model failed", file=sys.stderr)\nraise SystemExit(9)\n');
    r = spawnSync('python3', [verify, fakeFfmpeg, mp4, failedTranscribe], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /transcription failed.*model failed/i);

    const malformedTranscribe = join(dir, 'malformed.py');
    writeFileSync(malformedTranscribe, 'import json\nprint(json.dumps({"words":[7]}))\n');
    r = spawnSync('python3', [verify, fakeFfmpeg, mp4, malformedTranscribe], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /transcribed word 0.*containing 'w'/i);

    const failedFfmpeg = join(dir, 'bad-ffmpeg');
    writeFileSync(failedFfmpeg, '#!/bin/sh\necho decode-broke >&2\nexit 7\n');
    chmodSync(failedFfmpeg, 0o755);
    r = spawnSync('python3', [verify, failedFfmpeg, mp4, okTranscribe], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ffmpeg.*decode-broke/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const hasCv = spawnSync('python3', ['-c', 'import cv2, numpy']).status === 0;
test('faces.py follows a face moving across a horizontal clip', { skip: !hasCv && 'OpenCV not installed' }, () => {
  // the demo pack's walking interview: a drawn person crossing a 1280x720 frame
  const clip = fileURLToPath(new URL('../examples/demo/footage/street-02.mp4', import.meta.url));
  const r = spawnSync('python3', [fileURLToPath(new URL('../tools/faces.py', import.meta.url)), ffmpegPath, clip, '2'], { encoding: 'utf8' });
  const { samples } = JSON.parse(r.stdout);
  const xs = pickTrack(samples).map((p) => p.cx);
  assert.ok(xs.length >= samples.length * 0.8, 'found the face in most samples');
  assert.ok(xs[xs.length - 1] - xs[0] > 0.4, 'and followed it left to right');
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
  B.nativeText(ctx, 0.5, { text: 'The 2-minute rule', style: 'dark' });
  assert.ok(B.memeCard(ctx, 1, { text: 'Me opening the fridge' }).bottom > 300);
  assert.ok(window.M.CAPTION_STYLES.includes('word'));
});
