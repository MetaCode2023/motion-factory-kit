// `sim propose` and `sim rate` end to end in a child process. D1 is a local SQLite file and Clef is a canned answer
// (tests/helpers/fake-cloudflare.mjs replaces fetch), so nothing here touches the network or R2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { fileSha256 } from '../tools/sim/rate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'infra', 'cloudflare', 'migrations');
const FAKE = pathToFileURL(join(ROOT, 'tests', 'helpers', 'fake-cloudflare.mjs')).href;
const TOKEN = 'tok-SECRET-123';
const LEVELS = ['very weak', 'weak', 'average', 'strong', 'very strong'];
const SCORES = ['hook', 'visuals', 'pacing', 'overall'];
const CHECKS = ['opens_on_speech', 'stands_alone', 'clear_payoff', 'dead_air', 'screen_changes', 'captions'];

function clefResult(float = 2.73) {
  const answers = {};
  for (const d of SCORES) answers[d] = { type: 'score', score: float, legend: Object.fromEntries(LEVELS.map((l, i) => [String(i), l])), probabilities: Object.fromEntries(LEVELS.map((l, i) => [String(i), i === 3 ? 0.6 : 0.1])) };
  for (const c of CHECKS) answers[c] = { type: 'noul', noul: 0.5 };
  return { success: true, result: { answers, usage: { input_tokens: 321 } } };
}

function world({ upTo = '9999' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mfk-ratecli-'));
  const dbFile = join(dir, 'd1.sqlite'), clefFile = join(dir, 'clef.json'), logFile = join(dir, 'fake.log');
  const db = new DatabaseSync(dbFile);
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql') && n.slice(0, 4) <= upTo).sort()) db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  db.close();
  writeFileSync(clefFile, JSON.stringify(clefResult()));
  writeFileSync(logFile, '');
  const job = `test-rate-${Math.random().toString(36).slice(2, 10)}`;
  const q = (sql, ...p) => { const d = new DatabaseSync(dbFile); try { const st = d.prepare(sql); return st.columns().length ? st.all(...p).map((r) => ({ ...r })) : (st.run(...p), []); } finally { d.close(); } };
  const calls = () => readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const cleanup = () => { rmSync(dir, { recursive: true, force: true }); rmSync(join(ROOT, 'out', 'sim', job), { recursive: true, force: true }); };
  return { dir, dbFile, clefFile, logFile, job, q, calls, cleanup };
}

function sim(w, args, extraEnv = {}) {
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: TOKEN, D1_DATABASE_ID: 'test', SIM_AGENT: 'test',
    FAKE_D1_FILE: w.dbFile, FAKE_CLEF_FILE: w.clefFile, FAKE_LOG: w.logFile,
    ...(w.r2 ? { R2_ENDPOINT: w.r2.url, R2_ACCESS_KEY_ID: 'x', R2_SECRET_ACCESS_KEY: 'x' } : {}), ...extraEnv };
  return new Promise((res) => {
    const p = spawn(process.execPath, ['--import', FAKE, join(ROOT, 'tools', 'sim', 'sim.mjs'), ...args], { cwd: ROOT, env });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('close', (status) => res({ status, stdout, stderr, json: (() => { try { return JSON.parse(stdout.trim().split('\n').pop()); } catch { return null; } })() }));
  });
}

// A loopback stand-in for R2. `objects` maps a key to a Buffer, or to { body, cut: true } to send half the bytes and drop the connection.
// Every other method (PUT, HEAD) answers 200 and nothing is stored. `hits` lists each request as "GET key".
function loopbackR2(objects = {}) {
  const hits = [];
  return new Promise((res) => {
    const srv = createServer((req, rsp) => {
      const key = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/(simulation-videos\/)?/, '');
      req.resume();
      req.on('end', () => {
        hits.push(`${req.method} ${key}`);
        if (req.method !== 'GET') { rsp.writeHead(200, { ETag: '"x"' }); return rsp.end(); }
        const o = objects[key];
        if (o === undefined) { rsp.writeHead(404, { 'Content-Type': 'application/xml' }); return rsp.end('<Error><Code>NoSuchKey</Code><Message>no</Message></Error>'); }
        const body = Buffer.isBuffer(o) ? o : o.body;
        rsp.writeHead(200, { 'Content-Length': body.length, 'Content-Type': 'application/octet-stream' });
        if (Buffer.isBuffer(o)) return rsp.end(body);
        rsp.write(body.subarray(0, body.length >> 1));
        setTimeout(() => rsp.destroy(), 50);
      });
    });
    srv.listen(0, '127.0.0.1', () => res({ url: `http://127.0.0.1:${srv.address().port}`, objects, hits, close: () => srv.close() }));
  });
}

test('re-proposing a rejected output clears its build_id and leaves its ratings in place', async () => {
  const w = world(), r2 = await loopbackR2();
  try {
    const id = `${w.job}/short/a`;
    w.q(`INSERT INTO jobs (id, title, source_filename, source_bytes, duration_s, status) VALUES (?, 't', 'a.mp4', 1, 600, 'built')`, w.job);
    w.q(`INSERT INTO outputs (id, job_id, kind, start_s, end_s, slug, title, status, r2_prefix, build_id) VALUES (?, ?, 'short', 10, 40, 'a', 'T', 'rejected', 'p/', 'A')`, id, w.job);
    for (const d of SCORES) w.q(`INSERT INTO ratings (output_id, dimension, rater, rubric_version, pass, score, rated_at, build_id) VALUES (?, ?, 'clef-omni', 1, 1, 3, 'x', 'A')`, id, d);
    const plan = join(w.dir, 'plan.json');
    writeFileSync(plan, JSON.stringify({ shorts: [{ slug: 'a', title: 'T2', start: 100, end: 130, hook: 'h', why: 'w' }] }));
    const r = await sim(w, ['propose', w.job, '--from', plan, '--json'], { R2_ENDPOINT: r2.url, R2_ACCESS_KEY_ID: 'x', R2_SECRET_ACCESS_KEY: 'x' });
    const o = w.q('SELECT start_s, end_s, status, build_id FROM outputs WHERE id = ?', id)[0];
    assert.deepEqual(o, { start_s: 100, end_s: 130, status: 'proposed', build_id: null }, r.stdout + r.stderr);
    const rs = w.q('SELECT score, build_id FROM ratings WHERE output_id = ?', id);
    assert.equal(rs.length, 4);
    assert.ok(rs.every((x) => x.score === 3 && x.build_id === 'A'));
    assert.equal(w.q('SELECT COUNT(*) AS n FROM ratings r JOIN outputs o ON o.id = r.output_id WHERE r.build_id IS NOT o.build_id')[0].n, 4);
  } finally { r2.close(); w.cleanup(); }
});

// ---------- sim rate ----------
function mkClip(file, freq, { seconds = 2, size = '320x568', rate = 15 } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=${rate}:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=f=${freq}:d=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}
const rateDir = (w) => join(ROOT, 'out', 'sim', w.job, 'rate');

// A job with two built shorts (a, b; clips cached locally under their hashes), one proposed short and one built long.
async function seedRate(w, { status = 'built' } = {}) {
  w.q(`INSERT INTO jobs (id, title, source_filename, source_bytes, duration_s, status) VALUES (?, 't', 'a.mp4', 1, 600, ?)`, w.job, status);
  const ids = {};
  for (const [slug, start, freq] of [['a', 0, 220], ['b', 100, 330]]) {
    const id = `${w.job}/short/${slug}`, tmp = join(w.dir, `${slug}.mp4`);
    mkClip(tmp, freq);
    const hash = await fileSha256(tmp);
    mkdirSync(rateDir(w), { recursive: true });
    copyFileSync(tmp, join(rateDir(w), `short-${slug}.${hash}.mp4`));
    w.q(`INSERT INTO outputs (id, job_id, kind, start_s, end_s, slug, title, status, r2_prefix, build_id) VALUES (?, ?, 'short', ?, ?, ?, ?, ?, ?, ?)`,
      id, w.job, start, start + 30, slug, slug, slug === 'a' ? 'built' : 'approved', `out/${w.job}/shorts/${slug}/`, hash);
    const prefix = `out/${w.job}/shorts/${slug}/`;
    w.r2.objects[`${prefix}video.mp4`] = readFileSync(tmp);
    w.r2.objects[`${prefix}metadata.json`] = Buffer.from(JSON.stringify({ build_id: hash }));
    ids[slug] = { id, hash, tmp, prefix };
  }
  w.q(`INSERT INTO outputs (id, job_id, kind, start_s, end_s, slug, status) VALUES (?, ?, 'short', 200, 230, 'p', 'proposed')`, `${w.job}/short/p`, w.job);
  w.q(`INSERT INTO outputs (id, job_id, kind, start_s, end_s, slug, status, r2_prefix, build_id) VALUES (?, ?, 'long', 0, 400, 'l', 'built', 'x/', 'LONGHASH')`, `${w.job}/long/l`, w.job);
  return ids;
}
const ratings = (w) => w.q('SELECT output_id, dimension, score, build_id, rater, pass, model, rubric_version, probs, stop_reason FROM ratings ORDER BY output_id, dimension');
const events = (w, action) => w.q('SELECT output_id, detail FROM events WHERE action = ? ORDER BY id', action).map((e) => ({ ...e, detail: JSON.parse(e.detail) }));

async function withRate(fn) {
  const w = world();
  w.r2 = await loopbackR2();
  try { await fn(w, await seedRate(w)); } finally { w.r2.close(); w.cleanup(); }
}
const MISMATCH = /the downloaded video does not match the recorded build; run sim rate again, and rebuild the output if this repeats/;
const cachePath = (w, slug, build) => join(rateDir(w), `short-${slug}.${build}.mp4`);
const metaKey = (ids, slug) => `${ids[slug].prefix}metadata.json`, videoKey = (ids, slug) => `${ids[slug].prefix}video.mp4`;

test('rate scores every built short and writes four rows plus a rated event', () => withRate(async (w, ids) => {
  const r = await sim(w, ['rate', w.job, '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.rated.length, 2);
  assert.deepEqual(r.json.failed, []);
  const rows = ratings(w);
  assert.equal(rows.length, 8);
  assert.ok(rows.every((x) => x.score === 4 && x.rater === 'clef-omni' && x.pass === 1 && x.model === '@cf/cloudflare/clef-omni' && x.rubric_version === 1));
  assert.ok(rows.filter((x) => x.output_id === ids.a.id).every((x) => x.build_id === ids.a.hash));
  const overall = JSON.parse(rows.find((x) => x.output_id === ids.a.id && x.dimension === 'overall').probs);
  assert.deepEqual(Object.keys(overall.checks), CHECKS);
  const ev = events(w, 'rated');
  assert.equal(ev.length, 2);
  assert.deepEqual(ev[0].detail.scores, { hook: 4, visuals: 4, pacing: 4, overall: 4 });
  assert.equal(ev[0].detail.input_tokens, 321);
  assert.equal(ev[0].detail.parts, 1);
  const calls = w.calls();
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.videos === 1 && c.content_types[0] === 'video/mp4' && c.auth_ok && c.questions.length === 10));
  assert.equal(w.q('SELECT status FROM jobs WHERE id = ?', w.job)[0].status, 'built');
}));

test('running rate again makes no calls and no duplicate rows', () => withRate(async (w) => {
  await sim(w, ['rate', w.job, '--json']);
  const r = await sim(w, ['rate', w.job, '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.skipped.length, 2);
  assert.equal(r.json.rated.length, 0);
  assert.equal(w.calls().length, 2);
  assert.equal(ratings(w).length, 8);
  assert.equal(events(w, 'rated').length, 2);
}));

test('an already rated short is skipped when R2 metadata has the same build_id', () => withRate(async (w, ids) => {
  await sim(w, ['rate', w.job, 'a', '--json']);
  w.r2.hits.length = 0;
  const r = await sim(w, ['rate', w.job, 'a', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.json.skipped, [ids.a.id]);
  assert.deepEqual(w.r2.hits.filter((h) => h.startsWith('GET')), [`GET ${metaKey(ids, 'a')}`], 'one small GET, no video download');
  assert.equal(w.calls().length, 1);
  assert.equal(ratings(w).length, 4);
}));

test('an already rated short is rated again when R2 metadata has a different build_id', () => withRate(async (w, ids) => {
  await sim(w, ['rate', w.job, 'a', '--json']);
  // R2 now holds another video than the one that was rated, and its metadata says so.
  mkClip(join(w.dir, 'other.mp4'), 550);
  w.r2.objects[videoKey(ids, 'a')] = readFileSync(join(w.dir, 'other.mp4'));
  w.r2.objects[metaKey(ids, 'a')] = Buffer.from(JSON.stringify({ build_id: 'something-else' }));
  w.r2.hits.length = 0;
  const r = await sim(w, ['rate', w.job, 'a', '--json']);
  assert.equal(r.status, 1);
  assert.deepEqual(r.json.skipped, []);
  assert.ok(w.r2.hits.includes(`GET ${videoKey(ids, 'a')}`), 'the video was fetched again, not trusted from the cache');
  assert.match(r.json.failed[0].error, MISMATCH);
  assert.ok(!existsSync(cachePath(w, 'a', ids.a.hash)));
  assert.equal(events(w, 'rate_failed').length, 1);
  assert.equal(ratings(w).length, 4);
}));

test('an already rated short with no R2 metadata is not skipped on trust', () => withRate(async (w, ids) => {
  await sim(w, ['rate', w.job, 'a', '--json']);
  delete w.r2.objects[metaKey(ids, 'a')];
  w.r2.hits.length = 0;
  const r = await sim(w, ['rate', w.job, 'a', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(w.r2.hits.includes(`GET ${videoKey(ids, 'a')}`), 'the video was fetched to check it');
  assert.equal(w.calls().length, 1);
}));

test('a rebuilt short is re-rated and the old scores go into the event', () => withRate(async (w, ids) => {
  await sim(w, ['rate', w.job, 'a', '--json']);
  mkClip(join(w.dir, 'a2.mp4'), 440);
  const hash2 = await fileSha256(join(w.dir, 'a2.mp4'));
  copyFileSync(join(w.dir, 'a2.mp4'), join(rateDir(w), `short-a.${hash2}.mp4`));
  w.q('UPDATE outputs SET build_id = ? WHERE id = ?', hash2, ids.a.id);
  w.r2.objects[videoKey(ids, 'a')] = readFileSync(join(w.dir, 'a2.mp4'));
  w.r2.objects[metaKey(ids, 'a')] = Buffer.from(JSON.stringify({ build_id: hash2 }));
  writeFileSync(w.clefFile, JSON.stringify(clefResult(0.2)));
  const r = await sim(w, ['rate', w.job, 'a', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const rows = ratings(w);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((x) => x.build_id === hash2 && x.score === 1));
  const ev = events(w, 'rated');
  assert.equal(ev.length, 2);
  assert.equal(ev[1].detail.replaced_build_id, ids.a.hash);
  assert.equal(ev[1].detail.previous.length, 4);
  assert.ok(ev[1].detail.previous.every((p) => p.score === 4 && p.build_id === ids.a.hash));
}));

test('a failed Clef call writes no ratings, logs rate_failed, exits 1', () => withRate(async (w) => {
  const r = await sim(w, ['rate', w.job, '--json'], { FAKE_CLEF_FAIL: '1' });
  assert.equal(r.status, 1);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.failed.length, 2);
  assert.match(r.json.failed[0].error, /boom/);
  assert.equal(ratings(w).length, 0);
  assert.equal(events(w, 'rate_failed').length, 2);
  const retry = await sim(w, ['rate', w.job, '--json']);
  assert.equal(retry.json.rated.length, 2);
}));

test('rate <job> <slug> rates only that short', () => withRate(async (w, ids) => {
  const r = await sim(w, ['rate', w.job, 'b', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.json.rated.map((x) => x.output), [ids.b.id]);
  assert.equal(ratings(w).length, 4);
  assert.equal(w.calls().length, 1);
}));

test('rate refuses a job claimed by someone else', () => withRate(async (w) => {
  w.q(`UPDATE jobs SET claimed_by = 'other@elsewhere', lease_expires_at = '2999-01-01T00:00:00.000Z' WHERE id = ?`, w.job);
  const r = await sim(w, ['rate', w.job, '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json.error, /claimed by other@elsewhere/);
  assert.equal(w.calls().length, 0);
  assert.equal(ratings(w).length, 0);
}));

test('rate backfills build_id for a short built before 0004', () => withRate(async (w, ids) => {
  w.q('UPDATE outputs SET build_id = NULL WHERE id = ?', ids.a.id);
  rmSync(join(rateDir(w), `short-a.${ids.a.hash}.mp4`));
  const r = await sim(w, ['rate', w.job, 'a', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(w.q('SELECT build_id FROM outputs WHERE id = ?', ids.a.id)[0].build_id, ids.a.hash);
  assert.ok(ratings(w).every((x) => x.build_id === ids.a.hash));
  const ev = events(w, 'build_id_backfilled');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].detail.build_id, ids.a.hash);
}));

test('a cached video that does not match the recorded build is deleted and rate fails for that output', () => withRate(async (w, ids) => {
  w.q(`UPDATE outputs SET build_id = 'stale' WHERE id = ?`, ids.a.id);
  copyFileSync(ids.a.tmp, cachePath(w, 'a', 'stale'));
  const r = await sim(w, ['rate', w.job, 'a', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json.failed[0].error, MISMATCH);
  assert.ok(!existsSync(cachePath(w, 'a', 'stale')), 'the bad file is gone');
  assert.equal(ratings(w).length, 0);
  assert.equal(events(w, 'rate_failed').length, 1);
  assert.equal(w.calls().length, 0);
}));

test('a leftover .part file is never used as the video', () => withRate(async (w, ids) => {
  const final = cachePath(w, 'a', ids.a.hash);
  rmSync(final);
  const good = w.r2.objects[videoKey(ids, 'a')];
  w.r2.objects[videoKey(ids, 'a')] = { body: good, cut: true };
  const cut = await sim(w, ['rate', w.job, 'a', '--json']);
  assert.equal(cut.status, 1);
  assert.ok(!existsSync(final), 'a cut-off download is not left at the cache path');
  assert.equal(ratings(w).length, 0);
  w.r2.objects[videoKey(ids, 'a')] = good;
  writeFileSync(final + '.part', 'garbage left by an earlier run');
  const r = await sim(w, ['rate', w.job, 'a', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(ratings(w).every((x) => x.build_id === ids.a.hash && x.score === 4));
  assert.ok(!existsSync(final + '.part'));
}));

test('a short with no recorded build is downloaded again, never trusted from the cache', () => withRate(async (w, ids) => {
  w.q('UPDATE outputs SET build_id = NULL WHERE id = ?', ids.a.id);
  rmSync(cachePath(w, 'a', ids.a.hash));
  writeFileSync(cachePath(w, 'a', 'unknown'), 'a partial video from an earlier run');
  const r = await sim(w, ['rate', w.job, 'a', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(w.r2.hits.includes(`GET ${videoKey(ids, 'a')}`));
  assert.equal(w.q('SELECT build_id FROM outputs WHERE id = ?', ids.a.id)[0].build_id, ids.a.hash);
  assert.ok(ratings(w).every((x) => x.build_id === ids.a.hash));
  assert.ok(!existsSync(cachePath(w, 'a', 'unknown')));
}));

test('a retry after a missing answer replaces all four rows and records the earlier ones', () => withRate(async (w, ids) => {
  const first = clefResult(2.73);
  delete first.result.answers.visuals;
  writeFileSync(w.clefFile, JSON.stringify(first));
  const one = await sim(w, ['rate', w.job, 'a', '--json']);
  assert.equal(one.status, 0, one.stderr);
  assert.equal(ratings(w).find((x) => x.dimension === 'visuals').score, null);
  const second = clefResult(0.2);
  for (const c of CHECKS) second.result.answers[c].noul = 0.9;
  writeFileSync(w.clefFile, JSON.stringify(second));
  const two = await sim(w, ['rate', w.job, 'a', '--json']);
  assert.equal(two.status, 0, two.stderr);
  const rows = ratings(w);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((x) => x.score === 1 && x.build_id === ids.a.hash && x.stop_reason === null), JSON.stringify(rows));
  assert.deepEqual(JSON.parse(rows.find((x) => x.dimension === 'overall').probs).checks, Object.fromEntries(CHECKS.map((c) => [c, 0.9])));
  const ev = events(w, 'rated');
  assert.equal(ev.length, 2);
  assert.equal(ev[1].detail.replaced_build_id, undefined);
  assert.equal(ev[1].detail.previous.length, 4);
  const prev = Object.fromEntries(ev[1].detail.previous.map((p) => [p.dimension, p]));
  assert.equal(prev.visuals.score, null);
  assert.equal(prev.visuals.stop_reason, 'missing_answer');
  assert.equal(prev.hook.score, 4);
  assert.equal(prev.overall.probs.checks.captions, 0.5);
}));

test('a 62 second short goes to the rater as two videos', () => withRate(async (w, ids) => {
  const long = join(w.dir, 'long.mp4');
  mkClip(long, 260, { seconds: 62, size: '64x112', rate: 5 });
  const hash = await fileSha256(long);
  copyFileSync(long, cachePath(w, 'a', hash));
  w.q('UPDATE outputs SET build_id = ? WHERE id = ?', hash, ids.a.id);
  const r = await sim(w, ['rate', w.job, 'a', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(w.calls().length, 1);
  assert.equal(w.calls()[0].videos, 2);
  assert.equal(events(w, 'rated')[0].detail.parts, 2);
}));

test('propose, build and rate stop early with the init message when 0004 is missing', async () => {
  const w = world({ upTo: '0003' });
  w.r2 = await loopbackR2();
  try {
    w.q(`INSERT INTO jobs (id, title, source_filename, source_bytes, duration_s, status) VALUES (?, 't', 'a.mp4', 1, 600, 'planned')`, w.job);
    w.q(`INSERT INTO outputs (id, job_id, kind, start_s, end_s, slug, status, r2_prefix) VALUES (?, ?, 'short', 0, 30, 'a', 'built', 'p/')`, `${w.job}/short/a`, w.job);
    const plan = join(w.dir, 'plan.json');
    writeFileSync(plan, JSON.stringify({ shorts: [{ slug: 'c', title: 'T2', start: 100, end: 130, hook: 'h', why: 'w' }] }));
    const snap = () => JSON.stringify([w.q('SELECT * FROM jobs'), w.q('SELECT * FROM outputs'), w.q('SELECT * FROM events')]);
    const before = snap();
    for (const args of [['propose', w.job, '--from', plan], ['build', w.job], ['rate', w.job]]) {
      const r = await sim(w, [...args, '--json']);
      assert.equal(r.status, 1, args[0] + r.stdout + r.stderr);
      assert.equal(r.json.error, 'the database is missing migration 0004; run "node sim.mjs init" first', args[0]);
    }
    assert.equal(snap(), before, 'no row was written');
    assert.equal(w.calls().length, 0);
    assert.deepEqual(w.r2.hits, []);
  } finally { w.r2.close(); w.cleanup(); }
});

test('--rater unknown is an error listing clef-omni', () => withRate(async (w) => {
  const r = await sim(w, ['rate', w.job, '--rater', 'nope', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.json.error, /clef-omni/);
  assert.equal(w.calls().length, 0);
}));

test('the API token never appears in output', () => withRate(async (w) => {
  const bad = await sim(w, ['rate', w.job, '--json'], { FAKE_CLEF_FAIL: '1' });
  const ok = await sim(w, ['rate', w.job]);
  for (const r of [ok, bad]) { assert.ok(!r.stdout.includes(TOKEN)); assert.ok(!r.stderr.includes(TOKEN)); }
  assert.ok(w.calls().length > 0 && w.calls().every((c) => c.auth_ok), 'the Bearer header was sent');
}));

test('help lists sim rate', async () => {
  const w = world();
  try {
    const r = await sim(w, ['help']);
    assert.match(r.stdout, /sim rate <job> \[output\] \[--rater clef-omni\]/);
    assert.match(r.stdout, /Global flags/);
    assert.match(r.stdout, /sim mark-posted/);
  } finally { w.cleanup(); }
});
