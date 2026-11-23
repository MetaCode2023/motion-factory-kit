// Flashbacks (an older clip of the speaker, cut in with a rewind and a date), echoes (finding where they said it
// before), and the real-footage rule for outside clips. No network, no rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sentencesOf } from '../tools/longform/common.mjs';
import { FLASH, clipDate, cutList, dateLabel, mapTime, resolvePlan } from '../tools/longform/plan.mjs';
import { archiveChunks, terms, tfidf } from '../tools/longform/echoes.mjs';
import { rankVideos, syntheticWhy } from '../tools/clips/pick.mjs';

function words(text, start = 0) {
  const out = [];
  let t = start;
  for (const sent of text.split(/(?<=[.?!])\s+/)) {
    for (const w of sent.split(/\s+/)) { out.push({ w, s: +t.toFixed(2), e: +(t + 0.25).toFixed(2) }); t += 0.3; }
    t += 0.6;
  }
  return out;
}
const clip = (id, file, text) => { const ws = words(text); return { id, file, key: id, duration: ws[ws.length - 1].e + 1, width: 1920, height: 1080, words: ws, sentences: sentencesOf(ws), hasAudio: true }; };
const LIB = { clips: {
  now: clip('now', '/x/talk.mp4', 'Today I want to talk about awareness. Awareness is not a thing at all. It is what every thing appears in. That is the whole point.'),
  old: clip('old', '/x/20251018_lecture.mp4', 'Back then I said it like this. You are not an object in awareness, you are awareness itself.'),
} };

test('dates: from the file name, shown camcorder-style', () => {
  assert.equal(clipDate(LIB.clips.old), '2025-10-18');
  assert.equal(clipDate(LIB.clips.now), null);
  assert.equal(dateLabel('2025-10-18'), 'OCT 18, 2025');
  assert.equal(dateLabel('2025-10'), 'OCT 2025');
  assert.equal(dateLabel('Summer 2019'), 'SUMMER 2019');
});

test('a flashback gets a silent rewind before and a flash back to now after; words and anchors skip them', () => {
  const plan = { name: 'fb', fps: 30, tighten: false, a_roll: [{ clip: 'now', to: '#2' }, { clip: 'old', from: '#2', flashback: true }, { clip: 'now', from: '#3' }], inserts: [], auto_clips: false, auto_broll: false };
  const cuts = cutList(plan, LIB);
  const kinds = cuts.map((c) => c.bridge || (c.fb ? 'old' : 'now'));
  assert.deepEqual(kinds, ['now', 'rewind', 'old', 'return', 'now']);
  const rw = cuts[1], back = cuts[3];
  assert.ok(Math.abs(rw.d - FLASH.rewind) < 0.04 && Math.abs(back.d - FLASH.back) < 0.04);
  assert.equal(rw.fb.date, 'OCT 18, 2025', 'date from the old file name');
  assert.equal(back.clip, 'now', 'the flash back shows the present');
  // The bridge after the flashback starts where "now" resumes, but anchors land on the real piece, not the bridge.
  assert.equal(mapTime(cuts, 'now', cuts[4].s), cuts[4].out);
  const R = resolvePlan(plan, LIB);
  assert.deepEqual(R.errors, []);
  assert.equal(R.flashbacks.length, 1);
  assert.equal(R.flashbacks[0].at, rw.out);
  assert.ok(R.flashbacks[0].end > R.flashbacks[0].rewindEnd);
  assert.deepEqual(R.sfx.filter((s) => s.from === 'flashback').map((s) => s.name), ['rewind', 'whoosh']);
  // No word is said during a bridge: the transition sounds sit in silence.
  for (const c of cuts.filter((x) => x.bridge)) assert.ok(!R.words.some((w) => w.s < c.out + c.d - 0.01 && w.e > c.out + 0.01), `no words in the ${c.bridge} bridge`);
  assert.ok(R.words.some((w) => w.w === 'itself.'), 'the old clip is heard');
});

test('echoes: the same idea said before ranks first; common words alone do not count', () => {
  const idx = tfidf();
  idx.add({ text: 'You are not an object appearing in awareness, you are the awareness itself in which objects appear.', date: '2024-05-01' });
  idx.add({ text: 'We went to the store and talked about the thing for a while, it was a whole thing.', date: '2024-05-02' });
  idx.add({ text: 'Bitcoin hit a new high today and the miners are moving to cheap solar power.', date: '2024-05-03' });
  const r = idx.score('Awareness is not an object; every object appears in awareness.', { min: 0.2, shared: 2 });
  assert.equal(r[0].chunk.date, '2024-05-01');
  assert.equal(idx.score('the thing that we talked about', { min: 0.2, shared: 2 }).length, 0, 'filler words do not make an echo');
  assert.ok(terms('Awarenesses appearing').includes('awarenesse') || terms('Awarenesses appearing').length === 2);
});

test('archive transcripts become sentence-sized passages with their video, date and time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'echo-arch-'));
  writeFileSync(join(dir, '20231110_abc123def45.info.json'), JSON.stringify({ id: 'abc123def45', title: 'Old stream', upload_date: '20231110', webpage_url: 'https://www.youtube.com/watch?v=abc123def45' }));
  writeFileSync(join(dir, '20231110_abc123def45.transcript.json'), JSON.stringify([
    { start: 1, end: 3, text: '[Music]' }, { start: 3, end: 6, text: 'so the vacuum is the infinite identity' }, { start: 6, end: 9, text: 'and the rendering is what changes &gt;&gt; right.' },
    { start: 30, end: 33, text: 'a totally separate point about money and freedom and how it works' }, { start: 33, end: 35, text: 'in the new earth economy.' }]));
  const ch = archiveChunks(dir);
  assert.equal(ch.length, 2, 'split at the long pause');
  assert.equal(ch[0].date, '2023-11-10');
  assert.equal(ch[0].video, 'abc123def45');
  assert.equal(ch[0].start, 3);
  assert.ok(!ch[0].text.includes('&gt;') && !ch[0].text.includes('>>'), 'caption markers cleaned');
});

test('real footage only: generated, deepfaked, staged or "AI" videos are never pulled as evidence', () => {
  for (const title of ['JFK speech but AI generated', 'Obama deepfake goes viral', 'Moon landing recreation 4K', 'City of the future (Sora)', 'MLK speech reimagined',
    'JFK reads copypasta (speech synthesis)', 'Key & Peele - Obama meet and greet', 'Future City Utopia 4K | Sci-Fi Ambient', 'Mars colony CGI animation', 'This AI made a movie'])
    assert.ok(syntheticWhy({ title }), title);
  assert.ok(syntheticWhy({ title: 'How AI is changing Hollywood' }), 'AI in the title is out by default');
  assert.equal(syntheticWhy({ title: 'How AI is changing Hollywood' }, 'AI Hollywood news'), '', 'fine when the search is about AI');
  for (const title of ['JFK at Rice University, Sept. 12, 1962 - "We choose to go to the Moon"', 'Martin Luther King Jr. I Have A Dream Speech', 'Tom Dwan vs Phil Ivey CRAZY BLUFF! | High Stakes Poker'])
    assert.equal(syntheticWhy({ title }), '', title);
  const r = rankVideos([
    { id: 'fan', title: 'We choose to go to the moon JFK speech', channel: 'Random Uploads', duration: 900, view_count: 900000 },
    { id: 'lib', title: 'We choose to go to the moon JFK speech', channel: 'JFK Library', channel_is_verified: true, duration: 1060, view_count: 150000, timestamp: 1400000000 },
  ], 'JFK we choose to go to the moon speech');
  assert.equal(r[0].id, 'lib', 'the verified, official, older upload wins over a bigger re-upload');
});
