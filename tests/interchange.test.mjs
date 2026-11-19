// Interchange: the cut as xmeml and EDL, the timecode maths, the XML reader, and importing an edited cut back.
// Offline and fast: a fake probe and an in-memory library, no media on disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, parseProbe } from '../tools/longform/common.mjs';
import { cutList, resolvePlan } from '../tools/longform/plan.mjs';
import { premiereXML } from '../tools/longform/premiere.mjs';
import { framesToTC, rateOf, secondsToFrames, tcToFrames } from '../tools/longform/timecode.mjs';
import { all, kid, kids, parseXML, txt } from '../tools/longform/xml.mjs';
import { edlExport, parseEDL } from '../tools/longform/edl.mjs';
import { importCut, importPlan, matchClip } from '../tools/longform/interchange.mjs';
import { PLAN, equalRateR, fakeLib, fakeProbe } from './interchange-fixture.mjs';

const num = (n, name) => Number(txt(n, name));
const tracks = (xml) => {
  const media = kid(kid(parseXML(xml), 'sequence'), 'media');
  return { v: kids(kid(media, 'video'), 'track'), a: kids(kid(media, 'audio'), 'track') };
};

test('xml reader: elements, attributes, text, entities; skips the prolog, DOCTYPE, comments; keeps CDATA', () => {
  const root = parseXML(`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml [ <!ELEMENT a ANY> ]>\n<!-- hi -->\n<r a="1" b='x &amp; y'><n>A &lt;b&gt; &quot;q&quot; &#65;&#x42;</n><e/><c><![CDATA[<raw & text>]]></c><n>second</n></r>`);
  assert.equal(root.name, 'r');
  assert.deepEqual(root.attrs, { a: '1', b: 'x & y' });
  assert.equal(txt(root, 'n'), 'A <b> "q" AB');
  assert.equal(kids(root, 'n').length, 2);
  assert.equal(kids(root, 'e').length, 1);
  assert.equal(txt(root, 'c'), '<raw & text>');
  assert.equal(all(root, 'n').length, 2);
  assert.throws(() => parseXML('<a><b></a>'), /mismatched|expected/);
  assert.throws(() => parseXML('<a><b>'), /unclosed|not closed/);
});

test('xmeml export: V1/A1 linked, in/out in frames, markers for chapters and pulls', () => {
  const xml = premiereXML(equalRateR(), PLAN, { probe: fakeProbe() });
  const seq = kid(parseXML(xml), 'sequence');
  assert.equal(txt(kid(seq, 'rate'), 'timebase'), '30');
  assert.equal(num(seq, 'duration'), 135);
  const { v, a } = tracks(xml);
  const v1 = kids(v[0], 'clipitem'), a1 = kids(a[0], 'clipitem');
  assert.equal(v1.length, 3);
  assert.deepEqual(v1.slice(0, 2).map((c) => [num(c, 'start'), num(c, 'end'), num(c, 'in'), num(c, 'out')]), [[0, 30, 15, 45], [30, 75, 75, 120]]);
  assert.equal(a1.length, 3);
  const links = kids(v1[1], 'link');
  assert.deepEqual(links.map((l) => [txt(l, 'mediatype'), txt(l, 'trackindex'), txt(l, 'clipindex'), txt(l, 'linkclipref')]),
    [['video', '1', '2', v1[1].attrs.id], ['audio', '1', '2', a1[1].attrs.id]]);
  const file = kid(v1[0], 'file');
  assert.equal(num(file, 'duration'), 240, 'file length in frames comes from the (injected) probe');
  assert.equal(kid(kids(v1[1], 'file')[0], 'name'), undefined, 'a file already described is referred to by id');
  const v2 = kids(v[1], 'clipitem');
  assert.deepEqual(v2.map((c) => [num(c, 'start'), num(c, 'end')]), [[15, 45], [45, 75], [90, 150]]);
  assert.equal(num(v2[1], 'in'), 90, 'library B-roll starts 3 s into the original file');
  const markers = kids(seq, 'marker');
  assert.deepEqual(markers.map((m) => [txt(m, 'name'), txt(m, 'comment'), num(m, 'in'), num(m, 'out')]),
    [['Start', 'Chapter', 0, -1], ['Middle & more', 'Chapter', 75, -1], ['PULL: Famous hand', 'https://x.test/v 1:00-1:05', 15, 45]]);
});

test('xmeml export: equal-rate output is byte-identical to the exporter before this change', () => {
  // The hash was taken from the pre-change premiere.mjs on this same fixture (the absolute path in every
  // <pathurl> is reduced to the file name so the hash does not depend on where the repo is checked out).
  const xml = premiereXML(equalRateR(), PLAN, { probe: fakeProbe() }).replace(/<pathurl>[^<]*\/([^/<]+)<\/pathurl>/g, '<pathurl>$1</pathurl>');
  assert.equal(createHash('sha1').update(xml).digest('hex'), 'fd7d3a9eb5aa73e063df013514dd73def43bf483');
});

test('A1 clipindex is right when a clip has no audio', () => {
  const R = equalRateR();
  R.cuts = [
    { clip: 'a', s: 0.5, e: 1.5, d: 1, out: 0, zoom: 1, focus: [0.5, 0.5] },
    { clip: 'v', s: 0, e: 1, d: 1, out: 1, zoom: 1, focus: [0.5, 0.5] },
    { clip: 'a', s: 2.5, e: 3.5, d: 1, out: 2, zoom: 1, focus: [0.5, 0.5] },
  ];
  R.inserts = []; R.music = []; R.sfx = [];
  const { v, a } = tracks(premiereXML(R, PLAN, { probe: fakeProbe() }));
  const v1 = kids(v[0], 'clipitem'), a1 = kids(a[0], 'clipitem');
  assert.equal(a1.length, 2);
  const idx = (item, type) => txt(kids(item, 'link').find((l) => txt(l, 'mediatype') === type), 'clipindex');
  assert.equal(idx(v1[2], 'video'), '3', 'V1 position');
  assert.equal(idx(v1[2], 'audio'), '2', 'A1 position: the silent clip has no A1 item');
  assert.equal(kids(v1[1], 'link').length, 1, 'a silent clip links only to itself');
  assert.equal(kids(v1[2], 'link').find((l) => txt(l, 'mediatype') === 'audio').children.find((c) => c.name === 'linkclipref').text, a1[1].attrs.id);
});

test('mixed-rate clip in/out are in the clipitem rate', () => {
  const R = equalRateR();
  R.cuts = [{ clip: 'a', s: 2, e: 3, d: 1, out: 0, zoom: 1, focus: [0.5, 0.5] }];
  R.inserts = []; R.music = []; R.sfx = [];
  const { v } = tracks(premiereXML(R, PLAN, { probe: fakeProbe({ 'a.mp4': { fps: 25 } }) }));
  const item = kids(v[0], 'clipitem')[0];
  assert.equal(txt(kid(item, 'rate'), 'timebase'), '30');
  assert.deepEqual([num(item, 'in'), num(item, 'out')], [60, 90], '2 s in and 1 s long, counted in 30 fps frames, not the file\'s 25');
  assert.equal(num(item, 'duration'), 240);
  const file = kid(item, 'file');
  assert.equal(txt(kid(file, 'rate'), 'timebase'), '25', 'the file keeps its own rate');
  assert.equal(num(file, 'duration'), 200);
});

test('xmeml export skips an insert that has no media and says so', () => {
  const R = equalRateR();
  delete R.inserts[2].media;
  const { v } = tracks(premiereXML(R, PLAN, { probe: fakeProbe() }));
  assert.equal(kids(v[1], 'clipitem').length, 2);
  assert.ok(R.warnings.some((w) => /anim-3/.test(w) && /no media/.test(w)), R.warnings.join('|'));
});

test('probe reads the embedded timecode tag, and null when there is none', () => {
  const err = '  Metadata:\n    timecode        : 01:02:03:04\n  Duration: 00:00:08.00, start: 0.000000, bitrate: 900 kb/s\n  Stream #0:0: Video: h264, yuv420p, 1920x1080, 30 fps, 30 tbr\n  Stream #0:1: Audio: aac, 48000 Hz, stereo\n';
  const p = parseProbe(err);
  assert.equal(p.tc, '01:02:03:04');
  assert.deepEqual([p.duration, p.width, p.height, p.fps, p.hasAudio, p.sampleRate], [8, 1920, 1080, 30, true, 48000]);
  assert.equal(parseProbe(err.replace(/.*timecode.*\n/, '')).tc, null);
});

test('timecode round trips frame->tc->frame at 23.976/24/25/29.97/30/50/59.94/60, NDF and DF', () => {
  const frames = [0, 1, 23, 24, 29, 30, 59, 60, 1798, 1799, 1800, 1801, 3599, 3600, 17981, 17982, 17983, 35964, 107892, 107893, 215784, 1234567];
  for (const fps of [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]) {
    const rate = rateOf(fps);
    for (const n of frames) assert.equal(tcToFrames(framesToTC(n, rate), rate), n, `${fps} NDF frame ${n}`);
    if (fps === 29.97 || fps === 59.94) for (const n of frames) {
      const tc = framesToTC(n, rate, { df: true });
      assert.match(tc, /^\d\d:\d\d:\d\d;\d\d$/);
      assert.equal(tcToFrames(tc, rate, { df: true }), n, `${fps} DF frame ${n}`);
      assert.equal(tcToFrames(tc, rate), n, 'the semicolon alone says drop-frame');
    } else assert.throws(() => framesToTC(1800, rate, { df: true }), /drop-frame needs 29\.97 or 59\.94/);
  }
});

test('timecode known values: 29.97 drop-frame skips frame numbers, NDF does not', () => {
  const r = rateOf(29.97);
  assert.equal(framesToTC(1799, r, { df: true }), '00:00:59;29');
  assert.equal(framesToTC(1800, r, { df: true }), '00:01:00;02');
  assert.equal(framesToTC(17982, r, { df: true }), '00:10:00;00');
  assert.equal(tcToFrames('00:01:00;02', r), 1800);
  assert.equal(framesToTC(1800, r), '00:01:00:00');
  assert.equal(framesToTC(3600, rateOf(59.94), { df: true }), '00:01:00;04');
  assert.equal(framesToTC(90, rateOf(24)), '00:00:03:18');
  assert.equal(secondsToFrames(1, rateOf(29.97)), 30);
  assert.equal(secondsToFrames(2.5, rateOf(24)), 60);
  assert.equal(rateOf(23.976).timebase, 24);
  assert.equal(rateOf(25).ntsc, false);
  assert.throws(() => tcToFrames('00:01:00;00', r), /does not exist/);
});

test('EDL: reels, source/record TC, FROM CLIP NAME comments, FCM line', () => {
  const text = edlExport(equalRateR(), PLAN, { probe: fakeProbe() });
  assert.match(text, /^TITLE: T\nFCM: NON-DROP FRAME\n\n001 /);
  const e = parseEDL(text);
  assert.equal(e.fcm, 'NON-DROP FRAME');
  assert.equal(e.events.length, 3);
  assert.deepEqual(e.events.map((x) => [x.reel, x.track, x.trans, x.srcIn, x.srcOut, x.recIn, x.recOut]), [
    ['A', 'B', 'C', '00:00:00:15', '00:00:01:15', '01:00:00:00', '01:00:01:00'],
    ['A', 'B', 'C', '00:00:02:15', '00:00:04:00', '01:00:01:00', '01:00:02:15'],
    ['A', 'B', 'C', '00:00:05:00', '00:00:07:00', '01:00:02:15', '01:00:04:15'],
  ]);
  assert.equal(e.events[0].clipName, 'a.mp4');
  assert.match(e.events[0].sourceFile, /a\.mp4$/);
  assert.match(text, /\n\* FROM CLIP NAME: a\.mp4\n\* SOURCE FILE: .*a\.mp4\n/);
  assert.match(text.split('\n').find((l) => l.startsWith('001')), /^001 {2}A {8}B {5}C {8}00:00:00:15 00:00:01:15 01:00:00:00 01:00:01:00$/);
});

test('EDL: source TC is offset by the file\'s embedded timecode; reels are 8 upper alphanumerics, deduped; silent clips are V', () => {
  const lib = fakeLib();
  for (const id of ['long-clip-one', 'long-clip-two']) lib.clips[id] = { ...lib.clips.a, id, file: `/x/${id}.mp4` };
  const R = equalRateR(lib);
  R.cuts = [
    { clip: 'long-clip-one', s: 1, e: 2, d: 1, out: 0, zoom: 1, focus: [0.5, 0.5] },
    { clip: 'long-clip-two', s: 1, e: 2, d: 1, out: 1, zoom: 1, focus: [0.5, 0.5] },
    { clip: 'long-clip-one', s: 3, e: 4, d: 1, out: 2, zoom: 1, focus: [0.5, 0.5] },
    { clip: 'v', s: 0, e: 1, d: 1, out: 3, zoom: 1, focus: [0.5, 0.5] },
  ];
  const e = parseEDL(edlExport(R, PLAN, { probe: fakeProbe({ 'long-clip-one.mp4': { tc: '01:00:00:00' } }) }));
  assert.deepEqual(e.events.map((x) => x.reel), ['LONGCLIP', 'LONGCLI2', 'LONGCLIP', 'V']);
  assert.deepEqual(e.events.map((x) => x.track), ['B', 'B', 'B', 'V']);
  assert.equal(e.events[0].srcIn, '01:00:01:00', 'file TC 01:00:00:00 plus 1 s');
  assert.equal(e.events[1].srcIn, '00:00:01:00', 'no tag: the file starts at zero');
});

test('EDL: drop-frame only at 29.97/59.94 and only on request', () => {
  const plan = { ...PLAN, fps: 29.97 };
  const ndf = edlExport(equalRateR(), plan, { probe: fakeProbe({ 'a.mp4': { fps: 29.97 } }) });
  assert.match(ndf, /FCM: NON-DROP FRAME/);
  assert.ok(!/;/.test(ndf.split('\n').filter((l) => /^\d/.test(l)).join('\n')));
  const df = edlExport(equalRateR(), plan, { df: true, probe: fakeProbe({ 'a.mp4': { fps: 29.97 } }) });
  assert.match(df, /FCM: DROP FRAME/);
  assert.match(df, /01:00:00;00 01:00:01;00/);
  assert.throws(() => edlExport(equalRateR(), PLAN, { df: true, probe: fakeProbe() }), /drop-frame needs 29\.97 or 59\.94/);
});

// ---- import
const R30 = '<rate><timebase>30</timebase><ntsc>FALSE</ntsc></rate>';
const FILE_A = `<file id="file-1"><name>a.mp4</name><pathurl>file://localhost/x/a.mp4</pathurl>${R30}<duration>240</duration></file>`;
const ci = ({ start, end, inn = start, out = inn + end - start, extra = '', file = FILE_A, name = 'a' }) =>
  `<clipitem><name>${name}</name><duration>240</duration>${R30}<start>${start}</start><end>${end}</end><in>${inn}</in><out>${out}</out>${file}${extra}</clipitem>`;
const seq = (v1, { a1 = '', vextra = '' } = {}) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence><name>t</name><duration>300</duration>${R30}<media><video><track>${v1}</track>${vextra}</video><audio><track>${a1}</track></audio></media></sequence></xmeml>`;
const imp = (text, kind = 'xmeml', opts = {}, lib = fakeLib()) => importCut(text, kind, lib, { fps: 30, probe: fakeProbe(), ...opts });
const filter = (name, id = name.toLowerCase().replace(/ /g, '')) => `<filter><effect><name>${name}</name><effectid>${id}</effectid></effect></filter>`;

test('import accepts V1 cuts from library files: reorder and trim, in seconds, tighten off', () => {
  const r = imp(seq(ci({ start: 0, end: 30, inn: 90 }) + ci({ start: 30, end: 90, inn: 15, file: '<file id="file-1"/>' })));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.a_roll, [{ clip: 'a', from: 3, to: 4, tighten: false }, { clip: 'a', from: 0.5, to: 2.5, tighten: false }]);
});

test('import rejects speed, transitions, nested, effects, gaps, unknown media with clear messages', () => {
  const one = (extra, opts = {}) => imp(seq(ci({ start: 0, end: 30, extra, ...opts })));
  const speed = one(filter('Time Remap', 'timeremap'));
  assert.match(speed.errors[0], /^V1 clip 1 \("a"\): speed change or time remap is not supported/);
  assert.match(imp(seq(ci({ start: 0, end: 30, inn: 0, out: 60 }))).errors[0], /speed change or time remap/, 'source and timeline lengths differ');
  const trans = imp(seq(ci({ start: 0, end: 30 }) + '<transitionitem><start>20</start><end>40</end><effect><name>Cross Dissolve</name></effect></transitionitem>' + ci({ start: 30, end: 60 })));
  assert.ok(trans.errors.some((e) => /transitions are not supported/.test(e)), trans.errors.join('|'));
  assert.match(one('', { file: '', extra: '<sequence id="s2"><name>Nested</name></sequence>' }).errors[0], /nested sequences are not supported/);
  assert.match(imp(seq('<generatoritem><name>Title</name><start>0</start><end>30</end></generatoritem>')).errors[0], /generators and titles are not supported/);
  assert.match(one(filter('Gaussian Blur')).errors[0], /effect "Gaussian Blur" is not supported \(only Basic Motion and Audio Levels are read\)/);
  assert.deepEqual(one(filter('Basic Motion', 'basic') + filter('Audio Levels', 'audiolevels')).errors, []);
  const gap = imp(seq(ci({ start: 0, end: 30 }) + ci({ start: 40, end: 70, inn: 100, file: '<file id="file-1"/>' })));
  assert.deepEqual(gap.errors, ['V1 has a gap of 10 frames at 00:00:01:00 (close it in the editor, or the cut will not match)']);
  const lead = imp(seq(ci({ start: 15, end: 45 })));
  assert.match(lead.errors[0], /gap of 15 frames at 00:00:00:00/);
  const nofile = imp(seq(ci({ start: 0, end: 30, file: `<file id="f9"><name>zzz.mp4</name><pathurl>file://localhost/z/zzz.mp4</pathurl>${R30}<duration>240</duration></file>` })));
  assert.match(nofile.errors[0], /^V1 clip 1 \("a"\): no library clip matches "zzz\.mp4"/);
  assert.deepEqual(nofile.a_roll, [], 'nothing is returned when anything is wrong');
  assert.match(imp('<xmeml version="4"><project/></xmeml>').errors[0], /no sequence/);
  assert.match(imp('not xml at all <').errors[0], /can't read the XML/);
  assert.match(imp(seq('')).errors[0], /no V1 or A1 clips/);
});

test('import rejects EDL transitions, speed changes and black; reads the clip name', () => {
  const head = 'TITLE: t\nFCM: NON-DROP FRAME\n\n';
  const ev = (n, reel, trans, tcs, extra = '') => `${String(n).padStart(3, '0')}  ${reel.padEnd(8)} B     ${trans.padEnd(8)}${extra}${tcs}\n* FROM CLIP NAME: a.mp4\n`;
  const cut = (n, a, b, rec) => ev(n, 'A', 'C', `${a} ${b} ${rec[0]} ${rec[1]}`);
  const good = imp(head + cut(1, '00:00:03:00', '00:00:04:00', ['01:00:00:00', '01:00:01:00']) + cut(2, '00:00:00:15', '00:00:02:15', ['01:00:01:00', '01:00:03:00']), 'edl');
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.a_roll, [{ clip: 'a', from: 3, to: 4, tighten: false }, { clip: 'a', from: 0.5, to: 2.5, tighten: false }]);
  const dis = imp(head + cut(1, '00:00:00:00', '00:00:01:00', ['01:00:00:00', '01:00:01:00']) + ev(2, 'A', 'D', '00:00:01:00 00:00:02:00 01:00:01:00 01:00:02:00', '030 '), 'edl');
  assert.match(dis.errors[0], /^event 2 \(reel A\): transition D \(dissolve, wipe or key\) is not supported/);
  const m2 = imp(head + cut(1, '00:00:00:00', '00:00:01:00', ['01:00:00:00', '01:00:01:00']) + 'M2   A        060.0                01:00:00:00\n', 'edl');
  assert.match(m2.errors[0], /^event 1 \(reel A\): speed change or time remap is not supported/);
  const black = imp(head + ev(1, 'BL', 'C', '00:00:00:00 00:00:01:00 01:00:00:00 01:00:01:00'), 'edl');
  assert.match(black.errors[0], /black \(reel BL\)/);
  const unknown = imp(head + '001  Q        B     C        00:00:00:00 00:00:01:00 01:00:00:00 01:00:01:00\n* FROM CLIP NAME: nowhere.mov\n', 'edl');
  assert.match(unknown.errors[0], /no library clip matches "nowhere\.mov"/);
  const gap = imp(head + cut(1, '00:00:00:00', '00:00:01:00', ['01:00:00:00', '01:00:01:00']) + cut(2, '00:00:02:00', '00:00:03:00', ['01:00:02:00', '01:00:03:00']), 'edl');
  assert.match(gap.errors[0], /gap of 30 frames at 01:00:01:00/);
});

test('import warns on split audio and on varying Basic Motion scale; V1 empty falls back to A1', () => {
  const scale = (v) => `<filter><effect><name>Basic Motion</name><effectid>basic</effectid><parameter><parameterid>scale</parameterid><value>${v}</value></parameter></effect></filter>`;
  const w = imp(seq(ci({ start: 0, end: 30, extra: scale(100) }) + ci({ start: 30, end: 60, inn: 60, extra: scale(112) }),
    { a1: ci({ start: 0, end: 30 }) + ci({ start: 36, end: 60, inn: 66 }) }));
  assert.deepEqual(w.errors, []);
  assert.ok(w.warnings.some((x) => /A1 clip "a" at 00:00:01:06 does not line up with V1; audio follows picture/.test(x)), w.warnings.join('|'));
  assert.ok(w.warnings.some((x) => /Basic Motion scale differs between V1 clips; punch-ins are recomputed/.test(x)));
  assert.equal(w.a_roll.length, 2, 'A1 is only read when V1 is empty');
  const voice = imp(seq('', { a1: ci({ start: 0, end: 30, inn: 15 }) }));
  assert.deepEqual(voice.errors, []);
  assert.deepEqual(voice.a_roll, [{ clip: 'a', from: 0.5, to: 1.5, tighten: false }]);
});

test('matching: path, then name+duration, ambiguous is an error', () => {
  const lib = fakeLib();
  assert.deepEqual(matchClip(lib, { path: '/x/a.mp4', name: 'other.mp4', duration: 99 }), { id: 'a', how: 'path' });
  assert.deepEqual(matchClip(lib, { path: '/moved/a.mp4', name: 'a.mp4', duration: 8.3 }), { id: 'a', how: 'name' });
  assert.match(matchClip(lib, { path: '/moved/a.mp4', name: 'a.mp4', duration: 9 }).error, /no library clip matches "a\.mp4"/);
  assert.deepEqual(matchClip(lib, { name: 'a.mp4' }), { id: 'a', how: 'name' }, 'an EDL has no duration: the name alone');
  lib.clips['a-2'] = { ...lib.clips.a, id: 'a-2', file: '/y/a.mp4', duration: 8.2 };
  const amb = matchClip(lib, { path: '/z/a.mp4', name: 'a.mp4', duration: 8.1 });
  assert.match(amb.error, /"a\.mp4" matches more than one library clip: a \(\/x\/a\.mp4\), a-2 \(\/y\/a\.mp4\)/);
  assert.deepEqual(matchClip(lib, { path: '/y/a.mp4', name: 'a.mp4', duration: 8.1 }), { id: 'a-2', how: 'path' }, 'a path match is never ambiguous');
});

// plan -> cut file -> import must give the same cuts within one frame.
const sameCuts = (plan, lib, res) => {
  assert.deepEqual(res.errors, []);
  const before = cutList(plan, lib), after = cutList({ ...plan, a_roll: res.a_roll }, lib), fr = 1 / plan.fps + 1e-9;
  assert.equal(after.length, before.length);
  before.forEach((b, i) => {
    assert.equal(after[i].clip, b.clip);
    for (const k of ['s', 'd', 'out']) assert.ok(Math.abs(after[i][k] - b[k]) <= fr, `piece ${i} ${k}: ${b[k]} vs ${after[i][k]}`);
  });
};

test('round trip plan -> xmeml -> import and plan -> EDL -> import gives the same cuts within one frame', () => {
  const lib = fakeLib();
  const plan = { name: 'rt', fps: 30, a_roll: [{ clip: 'a' }], music: [], punch_in: { every: 1 } };
  const R = resolvePlan(plan, lib, { autoBroll: false });
  assert.deepEqual(R.errors, []);
  assert.ok(R.cuts.length >= 3);
  const probe = fakeProbe();
  sameCuts(plan, lib, importCut(premiereXML(R, plan, { probe }), 'xmeml', lib, { fps: 30, probe }));
  sameCuts(plan, lib, importCut(edlExport(R, plan, { probe }), 'edl', lib, { fps: 30, probe }));
  const tcProbe = fakeProbe({ 'a.mp4': { tc: '10:00:00:00' } });
  sameCuts(plan, lib, importCut(edlExport(R, plan, { probe: tcProbe }), 'edl', lib, { fps: 30, probe: tcProbe }));
});

test('round trip at 29.97 drop-frame, and with a 25 fps source in a 30 fps sequence', () => {
  const lib = fakeLib();
  const plan = { name: 'rt', fps: 29.97, a_roll: [{ clip: 'a' }], music: [] };
  const R = resolvePlan(plan, lib, { autoBroll: false });
  const probe = fakeProbe({ 'a.mp4': { fps: 29.97, tc: '01:00:00;00' } });
  const df = edlExport(R, plan, { df: true, probe });
  assert.match(df, /FCM: DROP FRAME/);
  sameCuts(plan, lib, importCut(df, 'edl', lib, { fps: 29.97, probe }));
  sameCuts(plan, lib, importCut(premiereXML(R, plan, { probe }), 'xmeml', lib, { fps: 29.97, probe }));
  const plan30 = { ...plan, fps: 30 }, R30x = resolvePlan(plan30, lib, { autoBroll: false }), p25 = fakeProbe({ 'a.mp4': { fps: 25 } });
  sameCuts(plan30, lib, importCut(premiereXML(R30x, plan30, { probe: p25 }), 'xmeml', lib, { fps: 30, probe: p25 }));
});

test('importPlan writes <plan>.imported.json beside the plan, never overwrites it, and warns about numeric "at"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfk-ix-'));
  try {
    const lib = fakeLib();
    const planFile = join(dir, 'p.json');
    const plan = { name: 'p', fps: 30, a_roll: [{ clip: 'a' }], music: [], title: 'Kept', inserts: [{ kind: 'pull', at: 1, dur: 1.5, search: 'x', id: 'pull-x' }] };
    writeFileSync(planFile, JSON.stringify(plan));
    const before = readFileSync(planFile, 'utf8');
    const probe = fakeProbe();
    const R = resolvePlan(plan, lib, { autoBroll: false });
    const xmlFile = join(dir, 'cut.xml');
    writeFileSync(xmlFile, premiereXML(R, plan, { probe }));
    const r = importPlan(planFile, xmlFile, { lib, probe });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.file, join(dir, 'p.imported.json'));
    assert.equal(readFileSync(planFile, 'utf8'), before, 'the original plan is untouched');
    const out = JSON.parse(readFileSync(r.file, 'utf8'));
    assert.equal(out.title, 'Kept');
    assert.equal(out.a_roll.length, R.cuts.length);
    assert.ok(out.a_roll.every((x) => x.tighten === false && x.clip === 'a'));
    assert.ok(r.warnings.some((w) => /inserts\[0\] \(pull-x\) is placed at 1s of output time/.test(w)), r.warnings.join('|'));
    assert.deepEqual(r.check.errors, []);
    const bad = importPlan(planFile, join(dir, 'cut.txt'), { lib, probe });
    assert.equal(bad.ok, false);
    assert.match(bad.errors[0], /can't tell the format of "cut\.txt" \(use \.xml for xmeml or \.edl\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI: export writes <name>.cut.xml and .cut.edl without touching the build\'s files; import writes the imported plan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfk-ix-cli-'));
  const name = `ixtest-${process.pid}`, outDir = join(ROOT, 'out', 'longform', name);
  const run = (...args) => {
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../longform.mjs', import.meta.url)), ...args, '--json'], { encoding: 'utf8', env: { ...process.env, LONGFORM_LIBRARY: dir } });
    return JSON.parse(r.stdout.trim().split('\n').pop());
  };
  try {
    const clip = { ...fakeLib().clips.a, file: join(dir, 'a.mp4') };
    mkdirSync(join(dir, '.index'), { recursive: true });
    writeFileSync(join(dir, '.index', 'library.json'), JSON.stringify({ clips: { a: clip } }));
    const planFile = join(dir, `${name}.json`);
    writeFileSync(planFile, JSON.stringify({ name, fps: 30, a_roll: [{ clip: 'a' }], music: [] }));
    const ex = run('export', planFile);
    assert.equal(ex.ok, true, JSON.stringify(ex));
    assert.deepEqual(ex.files.map((f) => f.replace(/^.*[\\/]/, '')).sort(), [`${name}.cut.edl`, `${name}.cut.xml`]);
    assert.ok(!existsSync(join(outDir, `${name}.premiere.xml`)), 'the build\'s own XML name is never used');
    const onlyEdl = run('export', planFile, '--edl');
    assert.deepEqual(onlyEdl.files.map((f) => f.replace(/^.*[\\/]/, '')), [`${name}.cut.edl`]);
    const im = run('import', planFile, join(outDir, `${name}.cut.edl`));
    assert.equal(im.ok, true, JSON.stringify(im));
    assert.ok(existsSync(join(dir, `${name}.imported.json`)));
    assert.equal(run('import', planFile).ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(outDir, { recursive: true, force: true }); }
});
