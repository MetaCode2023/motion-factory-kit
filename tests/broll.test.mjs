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
import { available, commonsLicenseOk, download, rank, search, tryOrder } from '../tools/broll/sources.mjs';
import { checkSheet, validate } from '../tools/broll/validate.mjs';
import { FF, frameAt, sheet } from '../tools/longform/common.mjs';
import { spawnSync } from 'node:child_process';
import { autoBroll, lockPath } from '../tools/broll/index.mjs';

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
  assert.deepEqual(tryOrder(['openverse', 'commons'], 'place'), [['commons', 'video'], ['openverse', 'photo'], ['commons', 'photo']], 'real footage first');
  assert.deepEqual(tryOrder(['openverse', 'commons'], 'landmark')[1], ['commons', 'photo'], 'Commons is the first photo source for named landmarks');
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
  const plan = { name: 'vegas', fps: 30, _file: planFile, tighten: false, a_roll: [{ clip: 'rec' }], inserts: [], auto_broll: { mode: 'accent', every: 8, end: 3 } };
  writeFileSync(planFile, JSON.stringify(plan));
  const R = resolvePlan(plan, lib, { autoBroll: false });
  assert.deepEqual(R.errors, []);
  R.resolveAt = (f) => resolveAt(f, R.cuts, lib, 'force');
  const calls = [];
  const r = await autoBroll(plan, R, { fetchImpl: stubFetch(calls), log: () => {}, stockDir: join(dir, 'stock'), cacheDir: join(dir, 'cache'), outDir: join(dir, 'out'), pause: 0, ytdlp: null });
  assert.ok(r.ok);
  assert.ok(r.ready >= 2, `two moments with media (got ${r.ready})`);
  const lock = JSON.parse(readFileSync(lockPath(plan), 'utf8'));
  const vegas = lock.entries.find((e) => e.key === 'las vegas');
  assert.match(vegas.anchor, /^rec@\d/);
  assert.equal(vegas.media.source, 'openverse');
  assert.ok(existsSync(join(dir, 'stock', `openverse-${vegas.media.id}.jpg`)));
  assert.match(readFileSync(join(dir, 'out', 'BROLL.md'), 'utf8'), /Las Vegas/);

  // A second run reuses the lock: no requests at all.
  const again = [];
  await autoBroll(plan, R, { fetchImpl: stubFetch(again), log: () => {}, stockDir: join(dir, 'stock'), cacheDir: join(dir, 'cache'), outDir: join(dir, 'out'), pause: 0, ytdlp: null });
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

test('fill mode (auto_broll "throughout") holds each shot until the next, without overlapping visuals', () => {
  const moments = [{ at: 1, end: 1.4, score: 3 }, { at: 5, end: 5.5, score: 3 }, { at: 30, end: 30.5, score: 3 }];
  const { placed } = placeBroll(moments, [{ at: 12, dur: 5 }], 40, { every: 2, min: 1.2, max: 8, hook: 0, end: 0, spacing: 1.5, fill: true, hold: 8 });
  assert.equal(placed.length, 3);
  assert.equal(placed[0].dur, +(placed[1].at - placed[0].at).toFixed(2), 'runs up to the next shot');
  assert.ok(placed[1].at + placed[1].dur <= 12 - 0.5 + 1e-6, 'stops before the next visual');
  assert.equal(placed[2].dur, 8, 'never held longer than hold');
});

test('Commons video: keeps free licences and real-length clips, picks the 1080p transcode', async () => {
  const page = (id, lic, dur, ders) => ({ pageid: id, index: id, title: `File:Clip ${id}.webm`, videoinfo: [{ mime: 'video/webm', duration: dur, descriptionurl: `https://commons.wikimedia.org/wiki/File:Clip_${id}.webm`, extmetadata: { LicenseShortName: { value: lic }, Artist: { value: '<a href="x">NASA</a>' } }, derivatives: ders }] });
  const d = (h) => ({ src: `https://upload.wikimedia.org/wikipedia/commons/transcoded/a/ab/Clip.webm/Clip.webm.${h}p.vp9.webm`, width: Math.round(h * 16 / 9), height: h, type: 'video/webm; codecs="vp9, opus"' });
  const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ query: { pages: {
    1: page(1, 'Public domain', 20, [d(360), d(720), d(1080)]),
    2: page(2, 'CC BY-NC 4.0', 20, [d(1080)]),          // not commercial
    3: page(3, 'CC BY 3.0', 3600, [d(1080)]),           // an hour-long lecture
  } } }) });
  const rs = await search('commons', 'video', 'double slit', { fetchImpl });
  assert.deepEqual(rs.map((r) => r.id), ['1']);
  assert.equal(rs[0].kind, 'video');
  assert.equal(rs[0].h, 1080);
  assert.equal(rs[0].author, 'NASA');
  assert.equal(rs[0].ext, 'webm');
});

test('a rate-limited Openverse origin falls back to the Openverse image proxy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'broll-dl-'));
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('staticflickr')) return { ok: false, status: 429, headers: { get: (h) => (h === 'retry-after' ? '600' : null) }, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).buffer };
  };
  const file = await download({ source: 'openverse', id: 'abc', ext: 'jpg', url: 'https://live.staticflickr.com/1/1_b.jpg' }, dir, { fetchImpl });
  assert.ok(existsSync(file));
  assert.equal(calls.length, 2, 'no retry loop against a 10-minute block');
  assert.match(calls[1], /api\.openverse\.org\/v1\/images\/abc\/thumb\/\?full_size=true/);
  // Other sources don't have a proxy: the block is reported so the next source is tried.
  await assert.rejects(download({ source: 'commons', id: 'x', ext: 'jpg', url: 'https://live.staticflickr.com/2/2_b.jpg' }, dir, { fetchImpl }), /rate-limited/);
});

// ---- video B-roll: reusable sources, the subject check, the check sheet ---------------------------------

test('subject check: the name said must be in the result, and non-footage is refused', () => {
  const yellowstone = { said: 'Yellowstone National Park', key: 'yellowstone national park', type: 'landmark', query: 'Yellowstone National Park geyser' };
  assert.ok(validate({ kind: 'video', title: 'Old Faithful erupting, Yellowstone National Park', tags: 'geyser wyoming' }, yellowstone).ok);
  const generic = validate({ kind: 'video', title: 'Beautiful national park drone footage', tags: 'nature mountains' }, yellowstone);
  assert.ok(!generic.ok, 'a generic national park is not Yellowstone');
  assert.match(generic.why, /yellowstone/);
  assert.ok(validate({ kind: 'video', title: 'Grand Prismatic Spring', tags: 'hot spring', description: 'Filmed in Yellowstone National Park in 2019.' }, yellowstone).ok, 'the description counts');
  assert.ok(!validate({ kind: 'video', title: 'Yellowstone National Park REACTION', tags: '' }, yellowstone).ok, 'reactions are refused');
  assert.ok(!validate({ kind: 'video', title: 'Yellowstone National Park in Minecraft', tags: '' }, yellowstone).ok);
  // A setting only needs the thing itself; plurals match.
  const casino = { said: 'casino floor', key: 'casino floor', type: 'setting', query: 'casino floor slot machines' };
  assert.ok(validate({ kind: 'video', title: 'Slot machines in a casino', tags: 'gambling' }, casino).ok);
  assert.ok(!validate({ kind: 'video', title: 'City street at night', tags: 'cars lights' }, casino).ok);
  // In the title scores above only in the tags.
  const a = validate({ kind: 'video', title: 'Yellowstone National Park', tags: '' }, yellowstone), b = validate({ kind: 'video', title: 'Geysers', tags: 'yellowstone national park' }, yellowstone);
  assert.ok(a.score > b.score);
});

// yt-dlp stand-in: search prints one JSON line per video; a download writes the output file.
function stubYtdlp(calls, videos) {
  return (bin, args) => {
    calls.push(args);
    if (args.includes('--dump-json')) return { status: 0, stdout: videos.map((v) => JSON.stringify(v)).join('\n'), stderr: '' };
    writeFileSync(args[args.indexOf('-o') + 1], 'mp4');
    return { status: 0, stdout: '', stderr: '' };
  };
}
const YT = [
  { id: 'cc1', title: 'Yellowstone National Park in 4K', description: 'Old Faithful and bison.', duration: 300, width: 1920, height: 1080, channel: 'Park Films', license: 'Creative Commons Attribution license (reuse allowed)', tags: ['yellowstone'] },
  { id: 'std', title: 'Yellowstone National Park travel guide', duration: 600, width: 1920, height: 1080, channel: 'Some Vlogger', license: null },
  { id: 'own', title: 'Our trip to Yellowstone National Park', duration: 240, width: 1920, height: 1080, channel: 'My Channel', uploader_id: '@mychannel', license: null },
];

test('YouTube: only Creative Commons videos or channels the plan lists; needs yt-dlp; downloads only the seconds used', async () => {
  assert.ok(!available(undefined, {}, { ytdlp: null }).includes('youtube'), 'no yt-dlp, no YouTube');
  assert.ok(available(undefined, {}, { ytdlp: 'yt-dlp' }).includes('youtube'));
  const calls = [];
  const cc = await search('youtube', 'video', 'Yellowstone National Park', { run: stubYtdlp(calls, YT), ytdlp: 'yt-dlp' });
  assert.deepEqual(cc.map((r) => r.id), ['cc1'], 'the standard-licence videos are left out');
  assert.match(cc[0].license, /Creative Commons/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].at(-1), /sp=EgIwAQ/, 'searched with the Creative Commons filter');
  const listed = await search('youtube', 'video', 'Yellowstone National Park', { run: stubYtdlp([], YT), ytdlp: 'yt-dlp', channels: ['@MyChannel'] });
  assert.deepEqual(listed.map((r) => r.id).sort(), ['cc1', 'own']);
  // Videos come before photos, and photos can be turned off.
  const order = tryOrder(['openverse', 'commons', 'youtube'], 'landmark');
  assert.deepEqual(order, [['commons', 'video'], ['youtube', 'video'], ['commons', 'photo'], ['openverse', 'photo']]);
  assert.ok(tryOrder(['openverse', 'commons', 'youtube'], 'place', { photos: false }).every(([, k]) => k === 'video'));
  const dir = mkdtempSync(join(tmpdir(), 'broll-yt-'));
  const dl = [];
  const file = await download({ ...cc[0], from: 60, take: 5 }, dir, { run: stubYtdlp(dl, YT), ytdlp: 'yt-dlp' });
  assert.ok(existsSync(file));
  assert.equal(dl[0][dl[0].indexOf('--download-sections') + 1], '*60.0-65.0');
});

test('broll prefers a validated video, skips a wrong one, and the build warns until it has been looked at', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'broll-vid-'));
  const lib = fakeLib();
  const planFile = join(dir, 'vegas.json');
  const plan = { name: 'vegas', fps: 30, _file: planFile, tighten: false, a_roll: [{ clip: 'rec' }], inserts: [], auto_broll: { every: 8, end: 3, sources: ['youtube', 'openverse'] } };
  writeFileSync(planFile, JSON.stringify(plan));
  const R = resolvePlan(plan, lib, { autoBroll: false });
  R.resolveAt = (f) => resolveAt(f, R.cuts, lib, 'force');
  const vids = [
    { id: 'wrong', title: 'Top 10 casinos compilation', duration: 500, width: 1920, height: 1080, channel: 'x', license: 'Creative Commons Attribution license (reuse allowed)' },
    { id: 'vegas', title: 'Las Vegas Strip at night, aerial', duration: 200, width: 1920, height: 1080, channel: 'City Films', license: 'Creative Commons Attribution license (reuse allowed)' },
  ];
  const r = await autoBroll(plan, R, { fetchImpl: stubFetch([]), run: stubYtdlp([], vids), ytdlp: 'yt-dlp', sheets: false, log: () => {}, stockDir: join(dir, 'stock'), cacheDir: join(dir, 'cache'), outDir: join(dir, 'out'), pause: 0 });
  const lock = JSON.parse(readFileSync(lockPath(plan), 'utf8'));
  const vegas = lock.entries.find((e) => e.key === 'las vegas');
  assert.equal(vegas.media.source, 'youtube');
  assert.equal(vegas.media.id, 'vegas');
  assert.equal(vegas.media.kind, 'video');
  assert.equal(vegas.media.source_from, 40, 'a fifth of the way into a long video');
  assert.equal(vegas.seen, false);
  assert.ok(r.videos >= 1 && r.toCheck.length >= 1);
  // The casino moment had no matching video (the compilation is refused), so it falls back to a photo.
  const casino = lock.entries.find((e) => /casino/.test(e.key) && e.media);
  assert.equal(casino.media.kind, 'photo');
  const R2 = resolvePlan(plan, lib);
  assert.ok(R2.inserts.some((i) => i.autoBroll && i.kind === 'broll'), 'the video is a clip insert');
  assert.ok(R2.warnings.some((w) => /not looked at yet/.test(w)));
  vegas.seen = true;
  writeFileSync(lockPath(plan), JSON.stringify(lock));
  assert.ok(!resolvePlan(plan, lib).warnings.some((w) => /not looked at yet/.test(w)));
});

test('check sheet: three frames of the seconds that will be used', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'broll-sheet-'));
  const clip = join(dir, 'clip.mp4');
  spawnSync(FF, ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=d=4:s=640x360:r=15', '-pix_fmt', 'yuv420p', clip]);
  const out = await checkSheet(clip, { from: 1, dur: 2, kind: 'video', label: '"Las Vegas" at 0:12' }, join(dir, 'check', 'a.jpg'), { frameAt, sheet });
  assert.ok(out && existsSync(out));
});
