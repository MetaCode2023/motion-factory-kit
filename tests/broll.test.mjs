// Automatic B-roll: finding moments, placing them in gaps, free-license sources, the lockfile, and the plan merge.
// No network: sources run against a stubbed fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sentencesOf } from '../tools/longform/common.mjs';
import { resolveAt, resolvePlan } from '../tools/longform/plan.mjs';
import { findMoments } from '../tools/broll/find.mjs';
import { placeBroll } from '../tools/broll/place.mjs';
import { commonsLicenseOk, rank, search, tryOrder } from '../tools/broll/sources.mjs';
import { autoBroll, lockPath } from '../tools/broll/index.mjs';
import { metadataRelevance } from '../tools/broll/relevance.mjs';

// Timed words from a sentence list, 0.3 s per word, 0.6 s between sentences.
function words(text, start = 0) {
  const out = [];
  let t = start;
  for (const sent of text.split(/(?<=[.?!])\s+/)) {
    for (const w of sent.split(/\s+/)) { out.push({ w, s: +t.toFixed(2), e: +(t + 0.25).toFixed(2) }); t += 0.3; }
    t += 0.6;
  }
  return out;
}

const TALK = 'So here is the thing. Most of the chips we use are made in China. My grandmother had fine china in a cabinet. ' +
  'Then I flew to Las Vegas to watch the casino floor at night. Austin said the odds were rigged. ' +
  'Later we talked about Feynman and Zorblax and the rules. China again, a second time. ' +
  'And that is where it ends. Thanks for watching this one. See you in the next video soon.';

test('finder picks places and settings with their times, and skips the dishware, repeats and lowercase', () => {
  const ws = words(TALK);
  const m = findMoments(ws);
  const auto = m.filter((x) => x.status === 'auto').map((x) => x.key);
  assert.ok(auto.includes('china'), 'China, the country');
  assert.ok(auto.includes('las vegas'), 'Las Vegas as one phrase');
  assert.ok(auto.includes('casino floor') || auto.includes('casino'), 'the casino');
  assert.ok(!m.some((x) => x.key === 'vegas'), 'no separate "Vegas"');
  const china = m.filter((x) => x.key === 'china');
  assert.equal(china.filter((x) => x.status === 'auto').length, 1, 'China once: fine china skipped, the repeat dropped');
  assert.ok(china.some((x) => x.status === 'skip' && /lowercase|fine/.test(x.why)), 'lowercase "fine china" skipped');
  assert.ok(china.some((x) => x.status === 'skip' && /again/.test(x.why)), 'repeat within 60 s skipped');
  const first = china.find((x) => x.status === 'auto');
  const at = ws.find((w) => w.w === 'China.');
  assert.equal(first.at, at.s, 'time of the spoken word');
  assert.match(first.sentence, /made in China/);
  assert.equal(m.find((x) => x.key === 'austin')?.status, 'review', 'Austin could be a person: listed for review, not placed');
  assert.equal(m.find((x) => x.key === 'feynman')?.type, 'person', 'a historic scientist from the lexicon');
  assert.equal(m.find((x) => x.key === 'zorblax')?.status, 'review', 'an unknown name is only listed');
});

test('placement fills gaps only: not over visuals, the hook or the ending, spaced, capped', () => {
  const moments = [
    { at: 1, end: 1.4, score: 9 },     // in the hook
    { at: 10, end: 10.5, score: 3 },   // inside an animation (8-14)
    { at: 20, end: 20.6, score: 3 },   // fine
    { at: 23, end: 23.4, score: 2 },   // too close to 20
    { at: 31.5, end: 31.8, score: 4 }, // 1.1 s before the gap around an insert at 33: no room
    { at: 40, end: 41, score: 3 },     // fine, 3 s max
    { at: 56, end: 56.3, score: 5 },   // in the ending (total 60, end 8)
  ];
  const { placed, skipped } = placeBroll(moments, [{ at: 8, dur: 6 }, { at: 33, dur: 4 }], 60, { every: 15 });
  assert.deepEqual(placed.map((p) => p.at), [19.9, 39.9]);
  for (const p of placed) assert.ok(p.dur >= 1.5 && p.dur <= 3);
  const why = Object.fromEntries(skipped.map((s) => [s.at, s.why]));
  assert.match(why[1], /hook/); assert.match(why[10], /visual/); assert.match(why[23], /within/); assert.match(why[31.5], /room/); assert.match(why[56], /ending/);
  // density: 30 s of video allows 2
  const many = Array.from({ length: 6 }, (_, k) => ({ at: 4 + k * 6.5, end: 4.5 + k * 6.5, score: 1 }));
  assert.equal(placeBroll(many, [], 30, { every: 15, end: 0 }).placed.length, 2);
});

test('commons licences: only ones that allow commercial use and changes', () => {
  for (const ok of ['CC BY-SA 4.0', 'CC BY 2.0', 'CC0', 'Public domain', 'PD-USGov', 'CC BY-SA 3.0 IGO']) assert.ok(commonsLicenseOk(ok), ok);
  for (const no of ['CC BY-NC 2.0', 'CC BY-ND 4.0', 'CC BY-NC-SA 3.0', 'Fair use', 'All rights reserved']) assert.ok(!commonsLicenseOk(no), no);
});

test('ranking keeps the right shape and size, prefers matching tags and bigger files, skips used ones', () => {
  const rs = [
    { source: 'openverse', id: 'a', kind: 'photo', w: 800, h: 600, tags: 'china shanghai skyline' },     // too small
    { source: 'openverse', id: 'b', kind: 'photo', w: 1024, h: 1400, tags: 'shanghai skyline' },     // portrait
    { source: 'openverse', id: 'c', kind: 'photo', w: 1024, h: 683, tags: 'city' },
    { source: 'commons', id: 'd', kind: 'photo', w: 1920, h: 1280, tags: 'Shanghai skyline at night' },
    { source: 'commons', id: 'e', kind: 'photo', w: 1920, h: 1080, tags: 'Shanghai skyline' },
  ];
  const r = rank(rs, { query: 'Shanghai skyline', used: new Set(['commons-e']) }).map((x) => x.id);
  assert.deepEqual(r, ['d', 'c']);
  assert.deepEqual(tryOrder(['openverse', 'commons'], 'place'), [['openverse', 'photo'], ['commons', 'photo']]);
  assert.deepEqual(tryOrder(['openverse', 'commons'], 'landmark')[0], ['commons', 'photo'], 'Commons first for named landmarks');
});

test('relevance scoring explains matches and can rank against the full narration line', () => {
  const strong = metadataRelevance('The casino floor in Las Vegas was empty', { title: 'Las Vegas casino floor', tags: 'night interior' });
  const weak = metadataRelevance('The casino floor in Las Vegas was empty', { title: 'generic office', tags: 'people working' });
  assert.ok(strong.score > weak.score);
  assert.match(strong.reason, /casino|vegas/);
  const ranked = rank([
    { source: 'x', id: 'weak', kind: 'photo', w: 1920, h: 1080, tags: 'office desk' },
    { source: 'x', id: 'strong', kind: 'photo', w: 1920, h: 1080, tags: 'casino floor las vegas' },
  ], { query: 'casino', narration: 'Walking across a Las Vegas casino floor' });
  assert.equal(ranked[0].id, 'strong');
  assert.ok(Number.isFinite(ranked[0].relevance_score));
});

// A stub of Openverse + Commons + file downloads.
function stubFetch(calls = []) {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  return async (url) => {
    calls.push(url);
    const u = new URL(url);
    const json = (o) => ({ ok: true, status: 200, json: async () => o, headers: { get: () => null } });
    if (u.host === 'api.openverse.org') {
      const q = u.searchParams.get('q');
      return json({ results: [{ id: `ov-${q.length}`, title: `${q} photo`, url: `https://live.staticflickr.com/1/${q.length}_b.jpg`, width: 1600, height: 1000, creator: 'Jane Doe', license: 'by-sa', license_version: '2.0', foreign_landing_url: `https://www.flickr.com/photos/jane/${q.length}`, source: 'flickr', tags: q.split(' ').map((name) => ({ name })) }] });
    }
    if (u.host === 'commons.wikimedia.org') return json({ query: { pages: {} } });
    return { ok: true, status: 200, arrayBuffer: async () => jpeg, headers: { get: () => null } };
  };
}

test('search results are cached: the second search makes no request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'broll-'));
  const calls = [];
  const f = stubFetch(calls);
  const a = await search('openverse', 'photo', 'Las Vegas strip night', { cacheDir: dir, fetchImpl: f });
  const b = await search('openverse', 'photo', 'Las Vegas strip night', { cacheDir: dir, fetchImpl: f });
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
  assert.equal(a[0].license, 'CC BY-SA 2.0');
  assert.equal(a[0].via, 'flickr');
});

// A one-clip library whose talk names Las Vegas and a casino, with one animation in the plan.
function fakeLib() {
  const ws = words('Welcome back to the channel everyone. Today we are flying to Las Vegas for the weekend. ' +
    'Nobody knows what happens next in this story. We walked right onto the casino floor and looked around. ' +
    'The rest of this is just talking for a while longer. And more talking to fill the time here. Thanks for watching and see you soon.');
  const duration = ws[ws.length - 1].e + 1;
  return { clips: { rec: { id: 'rec', file: '/x/rec.mp4', key: 'k', duration, width: 1920, height: 1080, words: ws, sentences: sentencesOf(ws), hasAudio: true } } };
}

test('broll fetches, locks the picks, and the plan places them in gaps with credits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'broll-plan-'));
  const lib = fakeLib();
  const planFile = join(dir, 'vegas.json');
  const plan = { name: 'vegas', fps: 30, _file: planFile, tighten: false, a_roll: [{ clip: 'rec' }], inserts: [], auto_broll: { every: 8, end: 3 } };
  writeFileSync(planFile, JSON.stringify(plan));
  const R = resolvePlan(plan, lib, { autoBroll: false });
  assert.deepEqual(R.errors, []);
  R.resolveAt = (f) => resolveAt(f, R.cuts, lib, 'force');
  const calls = [];
  const r = await autoBroll(plan, R, { fetchImpl: stubFetch(calls), log: () => {}, stockDir: join(dir, 'stock'), cacheDir: join(dir, 'cache'), outDir: join(dir, 'out'), pause: 0 });
  assert.ok(r.ok);
  assert.ok(r.ready >= 2, `two moments with media (got ${r.ready})`);
  const lock = JSON.parse(readFileSync(lockPath(plan), 'utf8'));
  const vegas = lock.entries.find((e) => e.key === 'las vegas');
  assert.match(vegas.anchor, /^rec@\d/);
  assert.equal(vegas.media.source, 'openverse');
  assert.ok(existsSync(join(dir, 'stock', `openverse-${vegas.media.id}.jpg`)));
  assert.match(readFileSync(join(dir, 'out', 'BROLL.md'), 'utf8'), /Las Vegas/);
  assert.match(readFileSync(join(dir, 'out', 'BROLL.md'), 'utf8'), /Relevance|metadata matches/);

  // A second run reuses the lock: no requests at all.
  const again = [];
  await autoBroll(plan, R, { fetchImpl: stubFetch(again), log: () => {}, stockDir: join(dir, 'stock'), cacheDir: join(dir, 'cache'), outDir: join(dir, 'out'), pause: 0 });
  assert.equal(again.length, 0);

  // The plan now carries the cutaways: photos as image inserts, hard cuts, credits, in gaps.
  const R2 = resolvePlan(plan, lib);
  assert.deepEqual(R2.errors, []);
  const auto = R2.inserts.filter((i) => i.autoBroll);
  assert.ok(auto.length >= 2);
  for (const i of auto) {
    assert.equal(i.kind, 'image');
    assert.equal(i.src.transition, 'cut');
    assert.ok(i.dur >= 1.5 && i.dur <= 3);
    assert.match(i.credit, /Jane Doe, CC BY-SA 2.0, via Flickr/);
  }
  // Dropping one in the lockfile removes it.
  lock.entries.find((e) => e.key === 'las vegas').status = 'drop';
  writeFileSync(lockPath(plan), JSON.stringify(lock));
  assert.ok(!resolvePlan(plan, lib).inserts.some((i) => i.autoBroll && /Vegas/.test(i.src.said)));
  // auto_broll: false turns it off without deleting anything.
  assert.ok(!resolvePlan({ ...plan, auto_broll: false }, lib).inserts.some((i) => i.autoBroll));
});
