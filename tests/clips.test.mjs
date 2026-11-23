// Outside clips (fair use): choosing the video, choosing the seconds, finding names in the talk, and the
// lockfile feeding the plan. No network: the lockfile is written by hand, as `node longform.mjs clips` would.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sentencesOf } from '../tools/longform/common.mjs';
import { resolvePlan } from '../tools/longform/plan.mjs';
import { clipMoments, creditLine, parseVtt, pickWindow, rankVideos } from '../tools/clips/pick.mjs';
import { clipsLockPath } from '../tools/clips/index.mjs';

function words(text, start = 0) {
  const out = [];
  let t = start;
  for (const sent of text.split(/(?<=[.?!])\s+/)) {
    for (const w of sent.split(/\s+/)) { out.push({ w, s: +t.toFixed(2), e: +(t + 0.25).toFixed(2) }); t += 0.3; }
    t += 0.6;
  }
  return out;
}

test('rankVideos: on-topic beats popular; Shorts, streams and excluded channels are out', () => {
  const r = rankVideos([
    { id: 'a', title: 'Cat compilation', channel: 'Cats', duration: 600, view_count: 90e6 },
    { id: 'b', title: 'Phil Ivey vs Tom Dwan bluff', channel: 'PokerGO', duration: 640, view_count: 600e3 },
    { id: 'c', title: 'Ivey bluff #shorts', channel: 'X', duration: 30, view_count: 5e6 },
    { id: 'd', title: 'Phil Ivey live now', channel: 'Y', duration: 0, view_count: 1, live_status: 'is_live' },
    { id: 'e', title: 'Phil Ivey Tom Dwan bluff reaction', channel: 'Simulation Series', duration: 900, view_count: 1e6 },
  ], 'Phil Ivey Tom Dwan bluff', { exclude: ['Simulation Series'] });
  assert.equal(r[0].id, 'b');
  for (const id of ['c', 'd', 'e']) assert.equal(r.find((x) => x.id === id).score, -1, id);
  assert.ok(r.find((x) => x.id === 'a').score < r[0].score);
});

test('pickWindow: the most-replayed peak, else the words asked for, else a third of the way in', () => {
  const heatmap = Array.from({ length: 100 }, (_, i) => ({ start_time: i * 6, end_time: (i + 1) * 6, value: i === 89 ? 1 : i === 2 ? 0.95 : 0.1 }));
  const v = { duration: 600, heatmap };
  const w = pickWindow(v, 5);
  assert.ok(w.from < 537 && w.to > 537, `peak at 537 s inside ${w.from}-${w.to}`);
  assert.equal(+(w.to - w.from).toFixed(2), 5);
  assert.match(w.how, /most replayed/);
  // The intro spike at 15 s is skipped (first 4%).
  assert.ok(w.from > 100);
  const caps = parseVtt('WEBVTT\n\n00:01:40.000 --> 00:01:42.000\nhe shoves all in\n\n00:01:42.000 --> 00:01:44.000\nand Ivey folds the best hand\n');
  const s = pickWindow(v, 4, { captions: caps, say: 'Ivey folds' });
  assert.equal(s.from, 101.6);
  assert.match(s.how, /captions/);
  assert.equal(pickWindow({ duration: 300 }, 4).from, 100);
  assert.equal(pickWindow({ duration: 8 }, 6).from, 1.5, 'clamped inside a short video');
});

test('parseVtt drops the rolling duplicates of YouTube auto captions', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello<00:00:01.500><c> world</c>\n\n00:00:02.000 --> 00:00:02.010\nhello world\n\n00:00:02.010 --> 00:00:03.000\nhello world\nnext line\n';
  assert.deepEqual(parseVtt(vtt).map((c) => c.text), ['hello world', 'next line']);
});

test('clipMoments: names in the talk, one search per sentence with context; things are left to stock B-roll', () => {
  const ws = words('So here is the thing about the cards. Phil Ivey made the call against Tom Dwan that night. ' +
    'Nobody plays like that anymore. Later Negreanu read the hand perfectly.');
  const m = clipMoments(ws, { context: 'poker' });
  const ivey = m.find((x) => x.said.includes('Phil Ivey'));
  assert.ok(ivey && ivey.said.includes('Tom Dwan'), 'two names in one sentence: one clip');
  assert.match(ivey.query, /^Phil Ivey Tom Dwan poker/);
  assert.ok(m.some((x) => x.said === 'Negreanu'));
  assert.ok(!m.some((x) => /cards/i.test(x.said)), 'objects are not clips');
  assert.equal(clipMoments(ws, { skip: ['Negreanu'] }).some((x) => x.said === 'Negreanu'), false);
});

test('creditLine links the exact moment and says how it is used', () => {
  assert.equal(creditLine({ id: 'abc123def45', title: 'Big Bluff', channel: 'PokerGO' }, 536.6, 541.5),
    '"Big Bluff" by PokerGO, YouTube: https://youtu.be/abc123def45?t=536 (8:56-9:01), shown briefly with commentary (fair use)');
});

function fakeLib() {
  const ws = words('Welcome back to the channel everyone today. We are talking about poker and nothing else. ' +
    'Phil Ivey made the call against Tom Dwan that night on television. Nobody knows what happens next in this story. ' +
    'The rest of this is just talking for a while longer. And more talking to fill the time here. ' +
    'Even more talking so the video runs long enough. Thanks for watching and see you soon.');
  const duration = ws[ws.length - 1].e + 1;
  return { clips: { rec: { id: 'rec', file: '/x/rec.mp4', key: 'k', duration, width: 1920, height: 1080, words: ws, sentences: sentencesOf(ws), hasAudio: true } } };
}

test('the clips lockfile fills script cues and adds named clips in a box beside the speaker, credited', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clips-plan-'));
  const lib = fakeLib();
  const planFile = join(dir, 'poker.json');
  const plan = { name: 'poker', fps: 30, _file: planFile, tighten: false, a_roll: [{ clip: 'rec' }], auto_broll: false, auto_clips: { every: 10, end: 3 },
    inserts: [{ id: 'pull-bluff', kind: 'pull', at: 'rec#6', dur: 4, title: 'A televised bluff', search: 'famous poker bluff' }] };
  writeFileSync(planFile, JSON.stringify(plan));
  const ivey = lib.clips.rec.words.find((w) => w.w === 'Ivey');
  const lock = { version: 1, entries: [
    { id: 'pull-bluff', source: 'plan', status: 'auto', url: 'https://www.youtube.com/watch?v=dS_uv88YuPs', from: 261.77, to: 265.77, credit: 'credit A', label: 'PokerGO', video: { id: 'dS_uv88YuPs', title: 'Every Tom Dwan Bluff' } },
    { id: 'clip-phil-ivey-ab12', source: 'auto', status: 'auto', anchor: `rec@${(ivey.s - 0.3).toFixed(3)}`, word: 'Phil', said: 'Phil Ivey, Tom Dwan', query: 'Phil Ivey Tom Dwan poker',
      url: 'https://www.youtube.com/watch?v=Sp4QlXkDEU4', from: 536.63, to: 541.49, spoken: 0.6, score: 3, credit: 'credit B', label: 'PokerGO', video: { id: 'Sp4QlXkDEU4', title: 'Tom Dwan vs Phil Ivey' } },
  ] };
  writeFileSync(clipsLockPath(plan), JSON.stringify(lock));

  const R = resolvePlan(plan, lib);
  assert.deepEqual(R.errors, []);
  const cue = R.inserts.find((i) => i.id === 'pull-bluff');
  assert.equal(cue.url, lock.entries[0].url);
  assert.equal(cue.from, 261.77);
  assert.equal(cue.credit, 'credit A');
  const named = R.inserts.find((i) => i.id === 'clip-phil-ivey-ab12');
  assert.ok(named, 'the named clip is placed');
  assert.equal(named.layout, 'side', 'a box beside the speaker by default');
  assert.ok(named.dur >= 3 && named.dur <= 8, `${named.dur} s`);
  assert.ok(Math.abs(named.at - (ivey.s - 0.3 - 0.2)) < 0.6, 'lands on the name');
  assert.equal(named.outsideClip, true);

  // Dropped in the lockfile: gone. auto_clips: false: the named one is gone, the cue keeps its source.
  lock.entries[1].status = 'drop';
  writeFileSync(clipsLockPath(plan), JSON.stringify(lock));
  assert.ok(!resolvePlan(plan, lib).inserts.some((i) => i.id === 'clip-phil-ivey-ab12'));
  lock.entries[1].status = 'auto';
  writeFileSync(clipsLockPath(plan), JSON.stringify(lock));
  const off = resolvePlan({ ...plan, auto_clips: false }, lib);
  assert.ok(!off.inserts.some((i) => i.id === 'clip-phil-ivey-ab12'));
  assert.equal(off.inserts.find((i) => i.id === 'pull-bluff').url, lock.entries[0].url);
});
