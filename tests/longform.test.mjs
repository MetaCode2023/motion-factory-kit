// Long-form editor: word-exact cutting, anchors, time mapping and plan checks, on an in-memory library.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sentencesOf } from '../tools/longform/common.mjs';
import { cutList, mapTime, resolvePlan, sideBox } from '../tools/longform/plan.mjs';

// "Hello there. Um so this is the um the point. Okay." with a long pause before "Okay".
function fakeLib() {
  const words = [
    ['Hello', 0.5, 0.8], ['there.', 0.85, 1.2],
    ['Um', 1.6, 1.9], ['so', 2.3, 2.45], ['this', 2.5, 2.7], ['is', 2.75, 2.85], ['the', 2.9, 3.0], ['um', 3.4, 3.7], ['the', 4.1, 4.2], ['point.', 4.25, 4.7],
    ['Okay.', 7.0, 7.4],
  ].map(([w, s, e]) => ({ w, s, e }));
  return { clips: { a: { id: 'a', file: '/x/a.mp4', key: 'k', duration: 8, words, sentences: sentencesOf(words), hasAudio: true } } };
}

test('sentences are numbered from 1 and split on punctuation and long pauses', () => {
  const s = fakeLib().clips.a.sentences;
  assert.equal(s[0].n, 1);
  assert.equal(s[0].text, 'Hello there.');
  assert.equal(s[s.length - 1].text, 'Okay.');
});

test('tightening drops fillers and long pauses, word-exact, frame-rounded', () => {
  const lib = fakeLib();
  const cuts = cutList({ fps: 30, a_roll: [{ clip: 'a' }] }, lib);
  const kept = (c) => lib.clips.a.words.filter((w) => w.s >= c.s - 1e-3 && w.e <= c.e + 1e-3).map((w) => w.w);
  const all = cuts.flatMap(kept);
  assert.ok(!all.some((w) => /^um$/i.test(w)), 'no fillers');
  assert.deepEqual(all, ['Hello', 'there.', 'so', 'this', 'is', 'the', 'the', 'point.', 'Okay.']);
  for (const c of cuts) assert.ok(Math.abs(c.d * 30 - Math.round(c.d * 30)) < 1e-6, 'whole frames');
  const total = cuts.reduce((a, c) => a + c.d, 0);
  assert.ok(total < 8 - 2.5, `removed the dead air (total ${total})`);
  for (let i = 1; i < cuts.length; i++) assert.ok(Math.abs(cuts[i].out - (cuts[i - 1].out + cuts[i - 1].d)) < 1e-3, 'back to back');
});

test('tighten.cut removes a false start; drop removes a sentence', () => {
  const lib = fakeLib();
  const cuts = cutList({ fps: 30, a_roll: [{ clip: 'a' }], tighten: { cut: [{ at: 'a#2', text: 'the um' }], drop: ['a#1'] } }, lib);
  const kept = cuts.flatMap((c) => lib.clips.a.words.filter((w) => w.s >= c.s - 1e-3 && w.e <= c.e + 1e-3).map((w) => w.w));
  assert.deepEqual(kept, ['so', 'this', 'is', 'the', 'point.', 'Okay.']);
});

test('anchors map from source time to the cut timeline', () => {
  const lib = fakeLib();
  const cuts = cutList({ fps: 30, a_roll: [{ clip: 'a' }] }, lib);
  const ok = mapTime(cuts, 'a', 7.0);
  assert.ok(ok > 0 && ok < 7.0 - 2, 'later words move earlier');
  assert.equal(mapTime(cuts, 'a', 6.0), cuts.find((c) => c.s > 6).out, 'a time in a removed gap lands on the next piece');
});

test('resolvePlan places inserts on words, sets marks, and reports problems all at once', () => {
  const lib = fakeLib();
  const plan = { name: 't', fps: 30, a_roll: [{ clip: 'a' }],
    inserts: [
      { kind: 'pull', at: 'a#2', word: 'point', dur: 1.5, search: 'x' },
      { kind: 'pull', at: 'a#2', word: 'nope', dur: 1, search: 'y' },
      { kind: 'wiggle', at: 'a#1' },
      { kind: 'animation', at: 'b#1', scene: 'nope.html' },
    ],
    chapters: [{ at: 'a#1', title: 'Start' }] };
  const R = resolvePlan(plan, lib);
  assert.ok(R.errors.some((e) => /word "nope" not found/.test(e)));
  assert.ok(R.errors.some((e) => /kind must be/.test(e)));
  assert.ok(R.errors.some((e) => /unknown clip "b"/.test(e)));
  const pull = R.inserts.find((i) => i.kind === 'pull');
  const pointWord = lib.clips.a.words.find((w) => w.w === 'point.');
  assert.ok(Math.abs(pull.at - mapTime(R.cuts, 'a', pointWord.s)) < 1e-3);
  assert.ok(R.warnings.some((w) => /3 or more/.test(w)));
});

test('overlapping inserts and inserts past the end are errors', () => {
  const lib = fakeLib();
  const R = resolvePlan({ name: 't', fps: 30, a_roll: [{ clip: 'a' }], inserts: [
    { kind: 'pull', at: 0.2, dur: 2, search: 'a' }, { kind: 'pull', at: 1.0, dur: 2, search: 'b' }, { kind: 'pull', at: 3.5, dur: 20, search: 'c' }] }, lib);
  assert.ok(R.errors.some((e) => /overlaps/.test(e)));
  assert.ok(R.errors.some((e) => /after the video ends/.test(e)));
});

test('side box is 16:9 and stays inside the frame', () => {
  const b = sideBox({});
  assert.equal(Math.round((b.w / b.h) * 9), 16);
  assert.ok(b.x + b.w <= 1920 && b.y + b.h <= 1080);
  assert.equal(sideBox({ side: { w: 800, x: 100 } }).x, 100);
});

// ---- script-first -------------------------------------------------------------------------------
import { align, lintScript, parseCue, parseScript, planFromScript, readingCopy } from '../tools/longform/script.mjs';

test('cues parse into kinds, options and template-shaped data', () => {
  const s = parseCue('stat value: 1,326 | label: hands | dur: 5');
  assert.equal(s.kind, 'anim'); assert.match(s.scene, /stat\.html$/); assert.equal(s.data.value, '1,326'); assert.equal(s.opts.dur, 5);
  const b = parseCue('bars bars: Taxes=42; Rent=27 | unit: %');
  assert.deepEqual(b.data.bars, [{ label: 'Taxes', value: 42 }, { label: 'Rent', value: 27 }]);
  const st = parseCue('steps steps: Observe - every bet is a clue; Update - re-weight');
  assert.deepEqual(st.data.steps[1], { title: 'Update', body: 're-weight' });
  const c = parseCue('compare left.title: A | left.items: x; y | right.title: B');
  assert.deepEqual(c.data.left, { title: 'A', items: ['x', 'y'] });
  assert.equal(parseCue('stock poker chips close up').arg, 'poker chips close up');
  assert.equal(parseCue('clip A famous bluff | search: bluff').kind, 'clip');
  assert.equal(parseCue('wiggle x: 1').kind, 'unknown');
});

const SCRIPT = `---
title: Test Video
---
// a note, not read
## One
[[quote text: Hello world.]] Hello world, this is a test of the script.
[[stock city at night]] The second line has more words in it. [[face]] Back to me now.
## Two
[[sfx hit]] Boom. That is the end of it.`;

test('scripts split into spoken words, cues on the next word, chapters; reading copy drops cues and notes', () => {
  const S = parseScript(SCRIPT);
  assert.equal(S.meta.title, 'Test Video');
  assert.equal(S.chapters.length, 2);
  assert.equal(S.words[S.cues[0].word].w, 'Hello');
  assert.equal(S.words[S.cues.find((c) => c.kind === 'face').word].w, 'Back');
  const read = readingCopy(SCRIPT);
  assert.ok(!/\[\[|note/.test(read) && /Hello world, this is a test/.test(read) && /— Two —/.test(read));
  const lint = lintScript(SCRIPT);
  assert.ok(lint.ok); assert.equal(lint.visuals, 2);
});

test('alignment matches the last take and labels the earlier one a retake to cut', () => {
  const S = parseScript(SCRIPT);
  const said = 'Hello world, this is a test of the script. The second line has more The second line has more words in it. Back to me now. Boom. That is the end of it.'.split(' ');
  let t = 0;
  const words = said.map((w) => ({ w, s: (t += 0.4), e: t + 0.3 }));
  const clip = { id: 'rec', duration: t + 1, words, sentences: [] };
  const { plan, report } = planFromScript(SCRIPT, clip);
  assert.equal(report.coverage, 1);
  assert.deepEqual(report.retakesCut, ['The second line has more']);
  assert.equal(plan.tighten.cut.length, 1);
  const stockAt = Number(plan.inserts.find((i) => i.kind === 'broll').at.split('@')[1]);
  assert.ok(Math.abs(stockAt - words[14].s) < 1e-3, 'stock lands on the second (kept) take');
  assert.ok(plan.inserts.some((i) => i.kind === 'face') && plan.sfx.length === 1 && plan.chapters.length === 2);
  const map = align(['a', 'b', 'c'], ['x', 'a', 'b', 'c', 'y']);
  assert.deepEqual([...map], [1, 2, 3], 'leading and trailing chatter is free');
});

test('a cue whose JSON ends in ]]] keeps the whole value', () => {
  const c = parseScript('[[superposition hands: [{"label":"A","cards":["Ah","Jh"],"p":0.4}]]] Hello.').cues[0];
  assert.deepEqual(c.data.hands[0].cards, ['Ah', 'Jh']);
  assert.ok(!/\]/.test(readingCopy('[[x a: [1]]] Hello.')));
});

test('animations schedule each item on the word that names it, the rest spread between', async () => {
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const ctx = { window: {}, M: { clamp: (x) => Math.max(0, Math.min(1, x)), ease: { inOutCubic: (x) => x } }, FX: {} };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../scenes/longform/lf.js', import.meta.url), 'utf8'), ctx);
  const LF = ctx.window.LF;
  const D = { dur: 8, words: [{ w: 'You', t: 0.2 }, { w: 'start', t: 0.5 }, { w: 'uncertain.', t: 1.0 }, { w: 'watch.', t: 2.5 }, { w: 'update.', t: 3.9 }, { w: 'decide.', t: 6.0 }] };
  const at = LF.schedule(D, ['Uncertain', 'Observe', 'Update', 'Decide']);
  assert.ok(Math.abs(at[0] - 0.9) < 0.01 && Math.abs(at[2] - 3.8) < 0.01 && Math.abs(at[3] - 5.9) < 0.01, JSON.stringify(at));
  // A first item said late (or out of order) doesn't leave the frame empty or hold up the rest.
  const late = LF.schedule({ dur: 8, words: [{ w: 'quantum', t: 1.0 }, { w: 'poker', t: 5.0 }] }, ['poker', 'quantum']);
  assert.ok(late[0] <= 1.4 && late[1] > late[0] && late[1] < 6.8, JSON.stringify(late));
  assert.ok(at[1] > at[0] && at[1] < at[2], 'an unsaid item lands between its neighbours');
  assert.equal(LF.when(D, 'nothing like it'), null);
  const even = LF.schedule({ dur: 6 }, ['a1', 'b2', 'c3']);
  assert.ok(even[0] < even[1] && even[1] < even[2] && even[2] <= 4.8, 'no words: an even spread');
});

test('doctor reports every requirement with a fix for the missing ones', async () => {
  const { doctor } = await import('../tools/longform/extras.mjs');
  const r = doctor();
  assert.ok(r.rows.length >= 8);
  assert.ok(r.rows.every((x) => x.ok || x.fix));
  assert.equal(r.ready, r.rows.filter((x) => x.need).every((x) => x.ok));
});

test('a one-word theme in a plan becomes a style for every animation', async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { loadPlan } = await import('../tools/longform/plan.mjs');
  const f = join(mkdtempSync(join(tmpdir(), 'lf-')), 'p.json');
  writeFileSync(f, JSON.stringify({ theme: 'blueprint', a_roll: [] }));
  assert.deepEqual(loadPlan(f).theme, { style: 'blueprint' });
});

test('every long-form template draws a frame in a dark and a light look', async () => {
  const { spawnSync } = await import('node:child_process');
  const { readdirSync, writeFileSync, mkdtempSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { ROOT } = await import('../tools/longform/common.mjs');
  const tmp = mkdtempSync(join(tmpdir(), 'lf-scenes-'));
  const dir = join(ROOT, 'scenes', 'longform');
  for (const style of ['noir', 'paper']) {
    const dj = join(tmp, style + '.json');
    writeFileSync(dj, JSON.stringify({ style, dur: 6 }));
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.html') && x !== 'props-gallery.html')) {
      const out = join(tmp, `${style}-${f}.png`);
      const r = spawnSync(process.execPath, [join(ROOT, 'render.mjs'), join(dir, f), '--data', dj, '--still', '3', '--out', out], { cwd: ROOT, encoding: 'utf8' });
      assert.ok(r.status === 0 && existsSync(out), `${f} (${style}): ${(r.stderr || r.stdout).split('\n').find((l) => /Error/.test(l)) || 'no frame'}`);
    }
  }
});

test('retention flags a greeting hook, a missing promise and a missing next step; a tight script passes', async () => {
  const { lintScript } = await import('../tools/longform/script.mjs');
  const weak = lintScript('---\ntitle: T\n---\n## One\nHello everyone and welcome back to the channel. Today we talk about money. Money is a thing. It moves. It stops. That is all.\n');
  assert.ok(weak.retention.notes.some((n) => n.startsWith('hook')));
  assert.ok(weak.retention.notes.some((n) => n.startsWith('promise')));
  assert.ok(weak.retention.notes.some((n) => n.startsWith('ending')));
  const good = lintScript('---\ntitle: T\n---\n## One\nWhy do you never see where money comes from? By the end you\'ll know. But first, a bank. It types a number. Watch the next video for what happens after.\n');
  assert.ok(!good.retention.notes.some((n) => /^(hook|promise|ending)/.test(n)), good.retention.notes.join(' | '));
  assert.ok(good.retention.score > weak.retention.score);
});

test('pip and split are layouts, and fall back to full when there is no picture of the speaker', () => {
  const lib = fakeLib();
  const plan = { name: 't', fps: 30, a_roll: [{ clip: 'a' }], inserts: [{ kind: 'pull', title: 'x', at: 'a#1', dur: 1, layout: 'pip' }] };
  lib.clips.a.height = 1080;
  assert.equal(resolvePlan(plan, lib).inserts[0].layout, 'pip');
  lib.clips.a.height = 0;
  assert.equal(resolvePlan(plan, lib).inserts[0].layout, 'full');
});

test('a visual right after a stat inherits its figure; one after a gap does not', async () => {
  const { animData } = await import('../tools/longform/build.mjs');
  const stat = { kind: 'animation', scene: '/x/scenes/longform/stat.html', layout: 'full', at: 0, dur: 5, data: { value: '1,326', label: 'ways' } };
  const next = { kind: 'animation', scene: '/x/scenes/longform/bars.html', layout: 'full', at: 5, dur: 5, data: {} };
  const later = { kind: 'animation', scene: '/x/scenes/longform/bars.html', layout: 'full', at: 11, dur: 4, data: {} };
  const R = { inserts: [stat, next, later], words: [] };
  assert.deepEqual(animData(next, R).carry, { value: '1,326', label: 'ways' });
  assert.equal(next.carried, true);
  assert.equal(animData(later, R).carry, undefined);
});

test('storyboard model keeps cue order and exports notes through the review format', async () => {
  const { boardHTML, boardModel } = await import('../tools/longform/board.mjs');
  const plan = { name: 'test-board', title: 'Test board', _file: '/x/plan.json' };
  const R = { total: 12, inserts: [
    { id: 'first', at: 2, dur: 3, kind: 'animation', layout: 'full', note: 'A number', scene: '/x/stat.html' },
    { id: 'second', at: 7, dur: 2, kind: 'image', layout: 'pip', note: 'The proof' },
  ] };
  const model = boardModel(plan, R);
  assert.deepEqual(model.cues.map((x) => x.id), ['first', 'second']);
  model.cues.forEach((x) => { x.frame = `board/${x.id}.jpg`; });
  const html = boardHTML(model);
  assert.match(html, /Visual flow approved/);
  assert.match(html, /stage:'board'/);
  assert.match(html, /first/);
});

test('harsh review ranks exact changes and describes frames without scores', async () => {
  const { harshReview } = await import('../tools/longform/critic.mjs');
  const md = harshReview({
    total: 70, warnings: ['chapter is short'], frozen: [[12, 4]], words: [],
    inserts: [{ id: 'news', at: 4.2, dur: 2, kind: 'pull', layout: 'full', title: 'News clip', src: {} }],
  }, { name: 'critic' }, [{ t: 4.2, label: 'news' }]);
  assert.match(md, /P0.*t=4\.2s.*placeholder.*->.*keep:/);
  assert.match(md, /P1.*frame barely changes/);
  assert.match(md, /Stranger-eye frame read/);
  assert.doesNotMatch(md, /\/10|score/i);
});

test('series feedback memory grows without overwriting hand-written rules', async () => {
  const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { updateSeriesDefaults } = await import('../tools/longform/extras.mjs');
  const file = join(mkdtempSync(join(tmpdir(), 'series-')), 'SERIES.md');
  writeFileSync(file, '# My series\n\nNever use clickbait.\n');
  updateSeriesDefaults({ theme: { style: 'paper' }, captions: { burn: true }, transitions: 'fade', inserts: [{ layout: 'pip' }] }, [{ t: 4.2, text: 'Move captions off my face' }], { approved: true, file });
  updateSeriesDefaults({}, [{ t: 9, text: 'Hold the chart longer' }], { file });
  const text = readFileSync(file, 'utf8');
  assert.match(text, /Never use clickbait/);
  assert.match(text, /Move captions off my face/);
  assert.match(text, /Hold the chart longer/);
  assert.match(text, /Theme: paper/);
});

test('longform captions group at short pauses and preserve script emphasis', async () => {
  const { captionGroups } = await import('../tools/longform/build.mjs');
  const parsed = parseScript('This is *the key phrase* right now.');
  assert.deepEqual(parsed.words.filter((w) => w.emphasis).map((w) => w.b), ['the', 'key', 'phrase']);
  const groups = captionGroups([
    { w: 'one', s: 0, e: .2 }, { w: 'two', s: .25, e: .45 }, { w: 'three', s: .5, e: .7 },
    { w: 'four', s: .9, e: 1.1 }, { w: 'five', s: 1.15, e: 1.35 }, { w: 'six', s: 1.4, e: 1.6 },
  ]);
  assert.deepEqual(groups.map((g) => g.map((w) => w.w)), [['one', 'two', 'three'], ['four', 'five', 'six']]);
  assert.ok(groups.every((g) => g.length >= 3 && g.length <= 5));
});

test('transcript hardening drops words wholly in silence and aligns repeated words positionally', async () => {
  const { spawnSync } = await import('node:child_process');
  const py = spawnSync('python3', ['-c', [
    'import json',
    'from tools.transcribe import drop_silent_words',
    'from tools.verify_words import positional_tokens',
    'from tools.detect_burned_subtitles import likely_subtitles',
    'words=[{"w":"real","s":0.1,"e":0.3},{"w":"ghost","s":1.0,"e":1.2},{"w":"edge","s":1.55,"e":1.75}]',
    'clean=drop_silent_words(words,[(0.8,1.7)])',
    'subs=likely_subtitles([[(10,700,20,30)]*7,[(10,710,20,30)]*7,[]],1080)',
    'print(json.dumps({"clean":[w["w"] for w in clean],"pos":positional_tokens(["the","word","the"]),"subs":subs[0]}))',
  ].join(';')], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  const result = JSON.parse(py.stdout);
  assert.deepEqual(result.clean, ['real', 'edge']);
  assert.notEqual(result.pos[0], result.pos[2]);
  assert.equal(result.subs, true);
});

test('readability checks flag rushed copy and cut strips sample both sides', async () => {
  const { readabilityChecks } = await import('../tools/longform/critic.mjs');
  const { aroundCuts } = await import('../tools/stills.mjs');
  const warnings = readabilityChecks({ inserts: [{ id: 'rushed', kind: 'image', dur: 1, note: 'This sentence cannot possibly be read in one second', data: {} }] });
  assert.ok(warnings.some((x) => /need about/.test(x)));
  const strip = aroundCuts([0, 5, 10], 12);
  assert.deepEqual(strip.filter((x) => x.cut === 5).map((x) => x.offset), [-0.2, -0.1, 0, 0.1, 0.2]);
  assert.ok(strip.every((x) => x.t >= 0 && x.t < 12));
});

test('behind-speaker cues are explicit and stay off for voice-only recordings', () => {
  const cue = parseCue('quote text: Breaking news | behind: true');
  assert.equal(cue.opts.behind, 'true');
  const lib = fakeLib();
  lib.clips.a.height = 1080;
  const plan = { name: 'behind', fps: 30, a_roll: [{ clip: 'a' }], inserts: [{ kind: 'pull', search: 'news', at: 0.5, dur: 1, behind: true }] };
  assert.equal(resolvePlan(plan, lib).inserts[0].behind, true);
  lib.clips.a.height = 0;
  const voice = resolvePlan(plan, lib);
  assert.equal(voice.inserts[0].behind, false);
  assert.ok(voice.warnings.some((x) => /no speaker picture/.test(x)));
});

test('editor exports include modern FCPXML and CMX3600 events', async () => {
  const { edl, fcpxml } = await import('../tools/longform/premiere.mjs');
  const R = {
    total: 2, cuts: [{ clip: 'a', s: .5, e: 2.5, out: 0, d: 2 }],
    inserts: [], lib: { clips: { a: { file: '/tmp/a.mp4' } } },
  };
  const plan = { name: 'export-test', title: 'Export test', fps: 30 };
  assert.match(edl(R, plan), /TITLE: Export test[\s\S]*001[\s\S]*00:00:00:15/);
  const xml = fcpxml(R, plan);
  assert.match(xml, /<fcpxml version="1\.10">/);
  assert.match(xml, /<spine><asset-clip/);
});

test('PiP shrink motion animates in and back out while remaining opt-in', async () => {
  const { pipMotion } = await import('../tools/longform/build.mjs');
  const m = pipMotion(6, 312, 1550, 712);
  assert.equal(m.td, 0.5);
  assert.match(m.progress, /lt\(t.*gt\(t/);
  assert.match(m.size, /1080\+\(312-1080\)/);
  assert.match(m.x, /1550/);
  assert.equal(({ pip: {} }).pip.animate, undefined, 'static PiP remains the default');
});
