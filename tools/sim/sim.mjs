#!/usr/bin/env node
// tools/sim/sim.mjs: the Simulation production pipeline. Every bit of state lives in Cloudflare
// (D1 database "simulation", R2 bucket "simulation-videos"), so any agent on any machine can pick up a job.
// Read AGENTS.md first. Run from the repo root:  node sim.mjs <command>   (or: npm run sim -- <command>)
//
//   sim init                               check this machine + Cloudflare, create anything missing
//   sim ingest <file-or-folder>            new recordings -> job, raw upload, 1080p proxy, 16 kHz audio
//   sim watch <folder> [--every 5m]        ingest whatever lands in a folder (e.g. the Drive "Inbox")
//   sim status [job]                       jobs, outputs, who is working on what, what waits for review
//   sim claim <job> / sim release <job>    take / give back a job (30-minute lease, renewed while working)
//   sim note <job> "..."                   leave a handoff note for the next agent
//   sim transcribe <job>                   Parakeet word transcript -> work/<job>/words.json + transcript.txt
//   sim propose <job> --from plan.json     record the proposed long videos and shorts (docs/SIM.md)
//   sim build <job> [output]               cut, build with the kit, upload to out/, record FIX lines
//   sim review <job>                       review summary with links; job -> in_review
//   sim approve <output> / sim reject <output> --note "..."     HUMANS ONLY
//   sim mark-posted <output> --platform youtube --url <url>
//
// Global flags: --json (one JSON object on stdout, progress on stderr), --agent <name> (or SIM_AGENT).
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, renameSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEASE_MIN = 30;
const VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi|mts)$/i;
const MODEL = 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8';
const MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL}.tar.bz2`;
const CACHE = join(homedir(), '.cache', 'sim');
const JOB_STATUS = ['new', 'ingested', 'transcribed', 'planned', 'built', 'in_review', 'approved', 'posted', 'failed'];

// ---------- arguments, output ----------
const argv = process.argv.slice(2);
const FLAGS_WITH_VALUE = new Set(['--every', '--from', '--note', '--platform', '--url', '--agent', '--minutes', '--title']);
const flags = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (FLAGS_WITH_VALUE.has(a)) flags[a.slice(2)] = argv[++i];
  else if (a.startsWith('--')) flags[a.slice(2)] = true;
  else pos.push(a);
}
const [cmd, ...args] = pos;
const JSON_OUT = !!flags.json;
const say = (...m) => (JSON_OUT ? console.error : console.log)(...m);      // human output; stderr in --json mode
const fail = (msg) => { throw Object.assign(new Error(msg), { user: true }); };

// ---------- environment (.env never overrides what is already set) ----------
function loadEnv() {
  const f = join(ROOT, '.env');
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]] && m[2] !== '') process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();
const env = (k) => process.env[k] || '';
const ACCOUNT = () => env('CLOUDFLARE_ACCOUNT_ID') || fail('CLOUDFLARE_ACCOUNT_ID is not set (env var or .env)');
const TOKEN = () => env('CLOUDFLARE_API_TOKEN') || fail('CLOUDFLARE_API_TOKEN is not set (env var or .env)');
const BUCKET = () => env('R2_BUCKET') || 'simulation-videos';
const DB_NAME = () => env('D1_DATABASE') || 'simulation';
function DB_ID() {
  if (env('D1_DATABASE_ID')) return env('D1_DATABASE_ID');
  const cfg = readFileSync(join(ROOT, 'infra', 'cloudflare', 'wrangler.jsonc'), 'utf8');
  return cfg.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1] || fail('no D1 database id: run node sim.mjs init');
}
const ACTOR = () => `${flags.agent || env('SIM_AGENT') || 'unnamed-agent'}@${hostname()}`;
const HUMAN = () => `human:${userInfo().username}@${hostname()}`;
const now = () => new Date().toISOString();
const later = (min) => new Date(Date.now() + min * 60000).toISOString();

// ---------- tools ----------
let FFMPEG = env('SIM_FFMPEG');
async function ffmpegPath() {
  if (FFMPEG) return FFMPEG;
  try { FFMPEG = (await import('ffmpeg-static')).default; } catch {}
  if (!FFMPEG || !existsSync(FFMPEG)) FFMPEG = 'ffmpeg';
  return FFMPEG;
}
const PYTHON = () => env('SIM_PYTHON') || ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0) || 'python';
async function ff(argsList, what) {
  const r = spawnSync(await ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...argsList], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) fail(`ffmpeg failed (${what}): ${(r.stderr || '').slice(-800)}`);
}
async function probe(file) {
  const err = spawnSync(await ffmpegPath(), ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr || '';
  const d = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return { duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0, hasAudio: /Stream.*Audio:/.test(err), hasVideo: /Stream.*Video:/.test(err) };
}
const slugify = (s) => String(s).toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'video';
const hms = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const secs = (v) => {
  if (typeof v === 'number') return v;
  const m = String(v ?? '').trim().match(/^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return NaN;
  return [m[1], m[2], m[3]].filter((x) => x != null).map(Number).reduce((a, b) => a * 60 + b, 0);
};
const mb = (n) => (n / 1048576).toFixed(n > 1e9 ? 0 : 1) + ' MB';
const workDir = (job) => { const d = join(ROOT, 'out', 'sim', job); mkdirSync(d, { recursive: true }); return d; };

// ---------- D1 (REST API; one statement per call, so every call is atomic) ----------
async function cf(path, init = {}) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT()}${path}`, {
    ...init, headers: { Authorization: `Bearer ${TOKEN()}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!j.success) fail(`Cloudflare API ${path.split('?')[0]}: ${(j.errors || []).map((e) => e.message).join('; ') || r.status}`);
  return j.result;
}
async function sql(statement, params = []) {
  const res = await cf(`/d1/database/${DB_ID()}/query`, { method: 'POST', body: JSON.stringify({ sql: statement, params }) });
  const r = res[0];
  return { rows: r.results || [], changes: r.meta?.changes ?? 0 };
}
const one = async (s, p) => (await sql(s, p)).rows[0];
async function event(job, output, action, detail = {}, actor = ACTOR()) {
  await sql('INSERT INTO events (job_id, output_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [job, output, actor, action, JSON.stringify(detail), now()]);
}
async function getJob(id) {
  return (await one('SELECT * FROM jobs WHERE id = ?', [id])) || fail(`no job "${id}" (node sim.mjs status lists them)`);
}
async function setJobStatus(id, status, detail = {}, extra = {}) {
  const sets = ['status = ?', 'updated_at = ?'], vals = [status, now()];
  for (const [k, v] of Object.entries(extra)) { sets.push(`${k} = ?`); vals.push(v); }
  await sql(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  await event(id, null, `status:${status}`, detail);
}
async function getOutput(ref) {
  let o = await one('SELECT * FROM outputs WHERE id = ?', [ref]);
  if (o) return o;
  const { rows } = await sql("SELECT * FROM outputs WHERE slug = ? OR id LIKE '%/' || ?", [ref, ref]);
  if (rows.length === 1) return rows[0];
  fail(rows.length ? `"${ref}" matches ${rows.length} outputs; use the full id:\n  ${rows.map((r) => r.id).join('\n  ')}` : `no output "${ref}"`);
}

// ---------- claims (atomic: one conditional UPDATE) ----------
async function claim(job, { minutes = LEASE_MIN, quiet = false } = {}) {
  const me = ACTOR(), t = now();
  const r = await sql(`UPDATE jobs SET claimed_by = ?1, lease_expires_at = ?2, updated_at = ?3
    WHERE id = ?4 AND (claimed_by IS NULL OR claimed_by = ?1 OR lease_expires_at IS NULL OR lease_expires_at < ?3)`,
  [me, later(minutes), t, job]);
  if (!r.changes) {
    const j = await getJob(job);
    fail(`job ${job} is claimed by ${j.claimed_by} until ${j.lease_expires_at}. Pick another job, or wait for the lease to run out.`);
  }
  if (!quiet) await event(job, null, 'claim', { lease_min: minutes });
  return me;
}
async function release(job) {
  const r = await sql('UPDATE jobs SET claimed_by = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND claimed_by = ?', [now(), job, ACTOR()]);
  if (r.changes) await event(job, null, 'release');
  return r.changes > 0;
}
// Hold the claim for the length of a command: claim (or renew our own), renew every 10 minutes.
async function holding(job, fn) {
  await claim(job, { quiet: true });
  const timer = setInterval(() => claim(job, { quiet: true }).catch((e) => console.error('lease renewal failed: ' + e.message)), 10 * 60000);
  try { return await fn(); } finally { clearInterval(timer); }
}

// ---------- R2 (S3 API: multipart uploads for 1-2 GB originals) ----------
let _s3;
async function s3() {
  if (_s3) return _s3;
  if (!env('R2_ACCESS_KEY_ID') || !env('R2_SECRET_ACCESS_KEY')) fail('R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not set. See AGENTS.md "R2 keys" to create them, then put them in .env');
  const { S3Client } = await import('@aws-sdk/client-s3');
  _s3 = new S3Client({ region: 'auto', endpoint: env('R2_ENDPOINT') || `https://${ACCOUNT()}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') } });
  return _s3;
}
const CT = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.srt': 'application/x-subrip', '.jpg': 'image/jpeg', '.png': 'image/png', '.xml': 'application/xml' };
async function put(file, key) {
  const { Upload } = await import('@aws-sdk/lib-storage');
  const size = statSync(file).size;
  const up = new Upload({ client: await s3(), queueSize: 4, partSize: 32 * 1048576, leavePartsOnError: false,
    params: { Bucket: BUCKET(), Key: key, Body: createReadStream(file), ContentType: CT[extname(file).toLowerCase()] || 'application/octet-stream' } });
  let last = 0;
  if (size > 64 * 1048576) up.on('httpUploadProgress', (p) => {
    const pct = Math.floor((p.loaded / size) * 100);
    if (pct >= last + 10) { last = pct - (pct % 10); say(`    ${pct}% of ${mb(size)}`); }
  });
  await up.done();
  return { key, bytes: size };
}
async function head(key) {
  const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
  try { return await (await s3()).send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key })); } catch (e) { if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return null; throw e; }
}
async function get(key, file) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const r = await (await s3()).send(new GetObjectCommand({ Bucket: BUCKET(), Key: key }));
  mkdirSync(dirname(file), { recursive: true });
  await pipeline(r.Body, createWriteStream(file));
  return file;
}
async function list(prefix) {
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const out = []; let token;
  do {
    const r = await (await s3()).send(new ListObjectsV2Command({ Bucket: BUCKET(), Prefix: prefix, ContinuationToken: token }));
    out.push(...(r.Contents || []).map((o) => ({ key: o.Key, bytes: o.Size })));
    token = r.IsTruncated ? r.NextContinuationToken : null;
  } while (token);
  return out;
}
async function link(key, days = 7) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  return getSignedUrl(await s3(), new GetObjectCommand({ Bucket: BUCKET(), Key: key }), { expiresIn: days * 86400 });
}
// A local copy of an R2 object (downloaded once per machine).
async function local(job, name) {
  const f = join(workDir(job), name);
  if (!existsSync(f)) { say(`  downloading work/${job}/${name}`); await get(`work/${job}/${name}`, f); }
  return f;
}

// ---------- commands ----------
async function cmdInit() {
  const rows = [];
  const row = (ok, name, detail, fix) => rows.push({ ok, name, detail, fix });
  const node = process.versions.node.split('.').map(Number);
  row(node[0] >= 20, 'node', process.versions.node, node[0] >= 20 ? '' : 'install Node 20+');
  const ffv = spawnSync(await ffmpegPath(), ['-version'], { encoding: 'utf8' });
  row(ffv.status === 0 && /libx264/.test(ffv.stdout), 'ffmpeg', ffv.status === 0 ? (ffv.stdout.split('\n')[0] || '').slice(0, 60) : 'not found', 'npm install (ffmpeg-static) or install ffmpeg');
  const py = spawnSync(PYTHON(), ['-c', 'import sherpa_onnx, numpy; print(sherpa_onnx.__version__)'], { encoding: 'utf8' });
  if (py.status !== 0) {
    say('installing sherpa-onnx (pip)...');
    spawnSync(PYTHON(), ['-m', 'pip', 'install', '--quiet', 'sherpa-onnx', 'numpy'], { stdio: JSON_OUT ? 'ignore' : 'inherit' });
  }
  const py2 = spawnSync(PYTHON(), ['-c', 'import sherpa_onnx; print(sherpa_onnx.__version__)'], { encoding: 'utf8' });
  row(py2.status === 0, 'python+sherpa-onnx', py2.status === 0 ? `${PYTHON()} / sherpa-onnx ${py2.stdout.trim()}` : 'missing', 'python -m pip install sherpa-onnx numpy');
  const wr = spawnSync('npx --no-install wrangler --version', { encoding: 'utf8', shell: true, cwd: ROOT });
  row(wr.status === 0, 'wrangler', wr.status === 0 ? wr.stdout.trim().split('\n').pop() : 'missing', 'npm install');
  for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'])
    row(!!env(k), k, env(k) ? 'set' : 'missing', k.startsWith('R2_') ? 'create an R2 API token (AGENTS.md "R2 keys") and put it in .env' : 'put it in .env (see .env.example)');
  row(!!(flags.agent || env('SIM_AGENT')), 'SIM_AGENT', flags.agent || env('SIM_AGENT') || 'not set', 'set SIM_AGENT=<your agent name> (e.g. claude-code) so the log says who did what');

  if (env('CLOUDFLARE_API_TOKEN') && env('CLOUDFLARE_ACCOUNT_ID')) {
    // D1: find or create the database, then apply migrations (idempotent).
    let dbId = '';
    try {
      const dbs = await cf(`/d1/database?name=${DB_NAME()}`);
      dbId = (dbs || []).find((d) => d.name === DB_NAME())?.uuid || '';
      if (!dbId) { say(`creating D1 database ${DB_NAME()}...`); dbId = (await cf('/d1/database', { method: 'POST', body: JSON.stringify({ name: DB_NAME() }) })).uuid; }
      if (dbId !== DB_ID()) say(`note: D1 id ${dbId} differs from infra/cloudflare/wrangler.jsonc; update database_id there`);
      const mig = spawnSync(`npx wrangler d1 migrations apply ${DB_NAME()} --remote`, { encoding: 'utf8', shell: true, cwd: join(ROOT, 'infra', 'cloudflare'), env: { ...process.env, CI: '1' } });
      const applied = mig.status === 0;
      row(applied, 'D1 database', applied ? `${DB_NAME()} (${dbId}), migrations up to date` : 'migrations failed', (mig.stderr || mig.stdout || '').split('\n').filter(Boolean).slice(-3).join(' | '));
    } catch (e) { row(false, 'D1 database', e.message, 'check the API token has D1 Edit'); }
    // R2: find or create the bucket.
    try {
      let b = await cf(`/r2/buckets/${BUCKET()}`).catch(() => null);
      if (!b) { say(`creating R2 bucket ${BUCKET()}...`); b = await cf('/r2/buckets', { method: 'POST', body: JSON.stringify({ name: BUCKET() }) }); }
      row(true, 'R2 bucket', BUCKET(), '');
    } catch (e) { row(false, 'R2 bucket', e.message, 'check the API token has R2 Edit'); }
    if (env('R2_ACCESS_KEY_ID')) {
      try { await list('raw/'); row(true, 'R2 S3 keys', 'can list the bucket', ''); } catch (e) { row(false, 'R2 S3 keys', e.message, 'recreate the R2 API token (AGENTS.md "R2 keys")'); }
    }
  }
  const model = join(CACHE, MODEL);
  row(true, 'transcription model', existsSync(join(model, 'tokens.txt')) ? `cached in ${model}` : 'downloads on first `sim transcribe` (~480 MB)', '');
  const ready = rows.every((r) => r.ok);
  for (const r of rows) say(`${r.ok ? 'OK     ' : 'MISSING'}  ${r.name.padEnd(22)} ${r.detail}${!r.ok && r.fix ? `\n           -> ${r.fix}` : ''}`);
  say(ready ? '\nReady.' : '\nNot ready: fix the MISSING lines above.');
  return { ok: ready, rows };
}

async function ingestFile(file) {
  const name = basename(file), size = statSync(file).size;
  const dup = await one('SELECT id, status FROM jobs WHERE source_filename = ? AND source_bytes = ?', [name, size]);
  if (dup) { say(`skip ${name}: already job ${dup.id} (${dup.status})`); return { file, skipped: true, job: dup.id }; }
  const date = new Date().toLocaleDateString('en-CA');   // local YYYY-MM-DD
  let id = `${date}-${slugify(name)}`;
  for (let n = 2; await one('SELECT id FROM jobs WHERE id = ?', [id]); n++) id = `${date}-${slugify(name)}-${n}`;
  const title = flags.title || basename(name, extname(name)).replace(/[-_]+/g, ' ').trim();
  const t = now();
  try {
    await sql(`INSERT INTO jobs (id, title, source_filename, source_bytes, status, claimed_by, lease_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?)`, [id, title, name, size, ACTOR(), later(LEASE_MIN), t, t]);
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) { say(`skip ${name}: another machine just ingested it`); return { file, skipped: true }; }
    throw e;
  }
  await event(id, null, 'created', { source: name, bytes: size });
  say(`job ${id}  (${name}, ${mb(size)})`);
  try {
    return await holding(id, async () => {
      const raw = `raw/${id}/${name}`;
      say(`  uploading original -> ${raw}`);
      await put(file, raw);
      await event(id, null, 'upload', { key: raw, bytes: size });
      const dir = workDir(id), proxy = join(dir, 'proxy.mp4'), wav = join(dir, 'audio16k.wav');
      const p = await probe(file);
      say(`  proxy: 1080p 30 fps x264 CRF 22 (${hms(p.duration)} of video)`);
      const vf = 'scale=-2:min(1080\\,ih):flags=bicubic,fps=30,format=yuv420p';
      try { await ff(['-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'copy', '-movflags', '+faststart', proxy], 'proxy'); }
      catch { say('  audio could not be copied into mp4; re-encoding it to AAC'); await ff(['-i', file, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', proxy], 'proxy'); }
      say('  audio: 16 kHz mono wav');
      await ff(['-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], 'audio');
      for (const f of [proxy, wav]) { say(`  uploading ${basename(f)} (${mb(statSync(f).size)})`); await put(f, `work/${id}/${basename(f)}`); }
      await setJobStatus(id, 'ingested', { proxy: `work/${id}/proxy.mp4`, audio: `work/${id}/audio16k.wav` }, { duration_s: +p.duration.toFixed(2), r2_raw_key: raw });
      say(`  ingested.`);
      return { file, job: id, raw, duration_s: +p.duration.toFixed(2) };
    });
  } catch (e) {
    await setJobStatus(id, 'failed', { step: 'ingest', error: e.message });
    throw e;
  } finally { await release(id); }
}
const videosIn = (p) => (statSync(p).isFile() ? [p] : readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.name.startsWith('.') ? [] : e.isDirectory() ? videosIn(join(p, e.name)) : VIDEO.test(e.name) ? [join(p, e.name)] : [])));
async function cmdIngest(path) {
  if (!path || !existsSync(path)) fail('usage: sim ingest <video-or-folder>');
  const files = videosIn(resolve(path));
  if (!files.length) say(`no videos in ${path}`);
  const results = [];
  for (const f of files) results.push(await ingestFile(f));
  return { ok: true, results };
}
async function cmdWatch(folder) {
  if (!folder || !existsSync(folder)) fail('usage: sim watch <folder> [--every 5m]');
  const every = String(flags.every || '5m').match(/^(\d+(?:\.\d+)?)(s|m|h)?$/) || fail('--every like 30s, 5m, 1h');
  const ms = +every[1] * { s: 1000, m: 60000, h: 3600000 }[every[2] || 'm'];
  say(`watching ${folder} every ${flags.every || '5m'} (Ctrl+C to stop)`);
  const seen = new Map();
  for (;;) {
    try {
      for (const f of videosIn(resolve(folder))) {
        const st = statSync(f), prev = seen.get(f);
        seen.set(f, st.size);
        // Google Drive writes big files gradually: wait until the size holds still for one round and 2 minutes have passed.
        if (prev !== st.size || Date.now() - st.mtimeMs < 120000) continue;
        const r = await ingestFile(f).catch((e) => { say(`ingest failed for ${basename(f)}: ${e.message}`); return null; });
        if (r && !r.skipped) say(`new job ${r.job}`);
      }
    } catch (e) { say('watch error: ' + e.message); }
    await new Promise((r) => setTimeout(r, ms));
  }
}

function table(rows, cols) {
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (r) => cols.map((c, i) => String(r[c] ?? '').padEnd(w[i])).join('  ').trimEnd();
  return [line(Object.fromEntries(cols.map((c) => [c, c.toUpperCase()]))), line(Object.fromEntries(cols.map((c, i) => [c, '-'.repeat(w[i])]))), ...rows.map(line)].join('\n');
}
async function cmdStatus(jobId) {
  const t = now();
  const holder = (j) => (j.claimed_by && j.lease_expires_at > t ? `${j.claimed_by} (until ${j.lease_expires_at.slice(11, 16)}Z)` : '');
  if (jobId) {
    const j = await getJob(jobId);
    const { rows: outs } = await sql('SELECT * FROM outputs WHERE job_id = ? ORDER BY kind, start_s', [jobId]);
    const { rows: ev } = await sql('SELECT * FROM events WHERE job_id = ? ORDER BY id DESC LIMIT 12', [jobId]);
    say(`${j.id}  "${j.title}"\n  status ${j.status}${holder(j) ? `, claimed by ${holder(j)}` : ', unclaimed'}\n  source ${j.source_filename} (${mb(j.source_bytes)}, ${hms(j.duration_s || 0)})  -> ${j.r2_raw_key || '-'}`);
    if (j.notes) say(`  notes: ${j.notes}`);
    if (outs.length) say('\n' + table(outs.map((o) => ({ output: `${o.kind}/${o.slug}`, status: o.status, span: `${hms(o.start_s)}-${hms(o.end_s)}`, length: hms(o.end_s - o.start_s), title: (o.title || '').slice(0, 50) })), ['output', 'status', 'span', 'length', 'title']));
    if (ev.length) say('\nrecent events:\n' + ev.map((e) => `  ${e.created_at.slice(0, 19).replace('T', ' ')}  ${e.actor.padEnd(28)} ${e.action}${e.output_id ? ' ' + e.output_id.split('/').slice(1).join('/') : ''}`).join('\n'));
    return { ok: true, job: j, outputs: outs, events: ev };
  }
  const { rows: jobs } = await sql('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100');
  const { rows: counts } = await sql('SELECT job_id, status, COUNT(*) AS n FROM outputs GROUP BY job_id, status');
  const by = {};
  for (const c of counts) (by[c.job_id] ||= {})[c.status] = c.n;
  if (!jobs.length) say('no jobs yet: node sim.mjs ingest <video>');
  else say(table(jobs.map((j) => ({ job: j.id, status: j.status, length: hms(j.duration_s || 0), outputs: Object.entries(by[j.id] || {}).map(([s, n]) => `${n} ${s}`).join(', ') || '-', 'working on it': holder(j) || '-' })), ['job', 'status', 'length', 'outputs', 'working on it']));
  const review = jobs.filter((j) => j.status === 'in_review');
  const waiting = Object.entries(by).filter(([, s]) => s.built).map(([id, s]) => `${id} (${s.built} built)`);
  if (review.length || waiting.length) say(`\nwaiting for a human: ${[...review.map((j) => j.id + ' (in review)'), ...waiting.filter((w) => !review.some((j) => w.startsWith(j.id)))].join(', ')}`);
  return { ok: true, jobs: jobs.map((j) => ({ ...j, outputs: by[j.id] || {}, active_claim: !!holder(j) })) };
}

async function ensureModel() {
  const dir = join(CACHE, MODEL);
  if (existsSync(join(dir, 'tokens.txt'))) return dir;
  mkdirSync(CACHE, { recursive: true });
  const tar = join(CACHE, `${MODEL}.tar.bz2`);
  if (!existsSync(tar) || statSync(tar).size < 1e8) {
    say(`  downloading ${MODEL} from the k2-fsa/sherpa-onnx GitHub releases (one time)...`);
    const r = await fetch(MODEL_URL);
    if (!r.ok) fail(`model download failed: HTTP ${r.status} ${MODEL_URL}`);
    await pipeline(r.body, createWriteStream(tar + '.part'));
    rmSync(tar, { force: true });
    renameSync(tar + '.part', tar);
  }
  say('  unpacking the model...');
  // Python's tarfile, not `tar`: Git Bash's GNU tar reads "C:\..." as a remote host on Windows.
  const x = spawnSync(PYTHON(), ['-c', 'import sys, tarfile; tarfile.open(sys.argv[1], "r:bz2").extractall(sys.argv[2])', tar, CACHE], { encoding: 'utf8' });
  if (x.status !== 0 || !existsSync(join(dir, 'tokens.txt'))) fail(`could not unpack ${tar}: ${x.stderr}`);
  rmSync(tar, { force: true });
  return dir;
}
async function cmdTranscribe(job) {
  if (!job) fail('usage: sim transcribe <job>');
  const j = await getJob(job);
  return holding(job, async () => {
    const model = await ensureModel();
    const wav = await local(job, 'audio16k.wav');
    const prefix = join(workDir(job), 'transcript');
    say(`  transcribing ${hms(j.duration_s || 0)} of audio with Parakeet (sherpa-onnx)...`);
    const ffBin = await ffmpegPath();
    const r = await new Promise((res) => {
      const p = spawn(PYTHON(), [join(ROOT, 'tools', 'sim', 'parakeet.py'), wav, model, prefix, '--ffmpeg', ffBin], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => { const s = String(d).trim(); if (s && !JSON_OUT) process.stdout.write(`    ${s.split('\n').pop()}\r`); });
      p.on('close', (code) => res({ code, out }));
    });
    if (!JSON_OUT) process.stdout.write('\n');
    const summary = (() => { try { return JSON.parse(r.out.trim().split('\n').pop()); } catch { return null; } })();
    if (r.code !== 0 || !summary?.ok) fail(`transcription failed: ${r.out.slice(-500)}`);
    const txt = join(workDir(job), 'transcript.txt');
    writeFileSync(txt, `# ${j.title} (${j.id})\n# ${summary.words} words, ${hms(summary.duration_s)}. [m:ss] = time in the original recording.\n\n` + readFileSync(prefix + '.txt', 'utf8'));
    renameSync(prefix + '.words.json', join(workDir(job), 'words.json'));
    await put(join(workDir(job), 'words.json'), `work/${job}/words.json`);
    await put(txt, `work/${job}/transcript.txt`);
    if (JOB_STATUS.indexOf(j.status) < JOB_STATUS.indexOf('transcribed') || j.status === 'failed') await setJobStatus(job, 'transcribed', summary);
    else await event(job, null, 'transcribed', summary);
    say(`  ${summary.words} words in ${summary.seconds}s -> work/${job}/words.json, work/${job}/transcript.txt\n  local copy: ${relative(ROOT, txt)}`);
    return { ok: true, job, ...summary, words_key: `work/${job}/words.json`, transcript_key: `work/${job}/transcript.txt`, transcript_file: txt };
  });
}

function checkPlan(plan, duration) {
  const errors = [], items = [];
  for (const kind of ['long', 'shorts']) {
    for (const [i, it] of (plan[kind] || []).entries()) {
      const where = `${kind}[${i}]`, s = secs(it.start), e = secs(it.end), d = e - s;
      if (!it.title) errors.push(`${where}: title is required`);
      if (Number.isNaN(s) || Number.isNaN(e) || e <= s) errors.push(`${where}: start/end must be times (seconds or m:ss) with end after start`);
      if (duration && e > duration + 0.5) errors.push(`${where}: ends at ${hms(e)} but the recording is ${hms(duration)}`);
      if (kind === 'long' && (d < 240 || d > 900)) errors.push(`${where}: a long video should be 5-10 min of source (got ${hms(d)}; allowed 4-15 min)`);
      if (kind === 'shorts' && (d < 12 || d > 65)) errors.push(`${where}: a short should be 15-60 s (got ${Math.round(d)} s)`);
      if (!it.hook) errors.push(`${where}: hook (the line that opens it) is required`);
      if (!it.why) errors.push(`${where}: why (one sentence) is required`);
      for (const [k, c] of (it.chapters || []).entries()) { const at = secs(c.at); if (Number.isNaN(at) || at < s || at >= e || !c.title) errors.push(`${where}.chapters[${k}]: needs at (inside start-end, source time) and title`); }
      items.push({ ...it, kind: kind === 'long' ? 'long' : 'short', slug: slugify(it.slug || it.title), start_s: s, end_s: e });
    }
  }
  const seen = new Set();
  for (const it of items) { const k = `${it.kind}/${it.slug}`; if (seen.has(k)) errors.push(`duplicate slug ${k}`); seen.add(k); }
  if (!items.length) errors.push('no outputs: add "long" and/or "shorts" lists');
  return { errors, items };
}
async function cmdPropose(job) {
  if (!job || !flags.from) fail('usage: sim propose <job> --from plan.json');
  const j = await getJob(job);
  const plan = JSON.parse(readFileSync(flags.from, 'utf8'));
  if (plan.job && plan.job !== job) fail(`plan.json is for job ${plan.job}, not ${job}`);
  const { errors, items } = checkPlan(plan, j.duration_s);
  if (errors.length && !(flags.force && errors.every((e) => /should be/.test(e)))) fail(`plan has problems:\n  ${errors.join('\n  ')}${errors.every((e) => /should be/.test(e)) ? '\n(only length warnings: --force accepts them)' : ''}`);
  return holding(job, async () => {
    const saved = [];
    for (const it of items) {
      const id = `${job}/${it.kind}/${it.slug}`;
      const ex = await one('SELECT status FROM outputs WHERE id = ?', [id]);
      if (ex && !['proposed', 'rejected'].includes(ex.status)) { say(`  keep ${it.kind}/${it.slug}: already ${ex.status}`); continue; }
      const desc = it.description || it.hook;
      await sql(`INSERT INTO outputs (id, job_id, kind, start_s, end_s, slug, title, description, status, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'proposed', ?9, ?9)
        ON CONFLICT(id) DO UPDATE SET start_s = ?4, end_s = ?5, title = ?7, description = ?8, status = 'proposed', updated_at = ?9`,
      [id, job, it.kind, it.start_s, it.end_s, it.slug, it.title, desc, now()]);
      await event(job, id, 'proposed', { start_s: it.start_s, end_s: it.end_s, title: it.title, hook: it.hook, why: it.why });
      saved.push(id);
      say(`  ${it.kind.padEnd(5)} ${it.slug.padEnd(30)} ${hms(it.start_s)}-${hms(it.end_s)}  ${it.title}`);
    }
    const f = join(workDir(job), 'plan.json');
    writeFileSync(f, JSON.stringify({ ...plan, job }, null, 2));
    await put(f, `work/${job}/plan.json`);
    if (JOB_STATUS.indexOf(j.status) < JOB_STATUS.indexOf('planned')) await setJobStatus(job, 'planned', { outputs: saved.length });
    say(`  ${saved.length} output(s) proposed; plan saved to work/${job}/plan.json`);
    return { ok: true, job, outputs: saved };
  });
}

// Run the kit's long-form editor in a child process (its library location comes from the environment).
function kit(cmdArgs, lib) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [join(ROOT, 'longform.mjs'), ...cmdArgs, '--json'], { cwd: ROOT, env: { ...process.env, LONGFORM_LIBRARY: lib }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      let last = null;
      try { last = JSON.parse(out.trim().split('\n').pop()); } catch {}
      res({ code, result: last, err: err.slice(-1500) });
    });
  });
}
async function buildOne(job, o, planItem, words, proxy, fromTitle) {
  const name = `sim-${job}-${o.kind}-${o.slug}`.slice(0, 100);
  const lib = join(workDir(job), 'library', `${o.kind}-${o.slug}`);
  rmSync(lib, { recursive: true, force: true });
  mkdirSync(lib, { recursive: true });
  const clip = 'segment';
  const seg = join(lib, `${clip}.mp4`), dur = o.end_s - o.start_s;
  say(`  ${o.kind}/${o.slug}: cutting ${hms(o.start_s)}-${hms(o.end_s)} from the proxy`);
  await ff(['-ss', o.start_s.toFixed(3), '-i', proxy, '-t', dur.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', seg], 'segment');
  const segWords = words.filter((w) => w.s >= o.start_s - 0.05 && w.e <= o.end_s + 0.05).map((w) => ({ w: w.w, s: +(w.s - o.start_s).toFixed(2), e: +(w.e - o.start_s).toFixed(2) }));
  writeFileSync(join(lib, `${clip}.words.json`), JSON.stringify({ words: segWords }));
  const chapters = (planItem?.chapters || []).map((c) => ({ at: `${clip}@${Math.max(0, secs(c.at) - o.start_s).toFixed(2)}`, title: c.title }));
  const plan = {
    name, title: o.title,
    a_roll: [{ clip }],
    tighten: { fillers: true, max_pause: 0.6, pad: 0.08 },
    chapters: o.kind === 'long' ? chapters : [],
    inserts: [], auto_broll: false,
    music: [{ at: 0, track: 'calm', volume: 0.07 }],
    ...(planItem?.kit || {}),
  };
  if (o.kind === 'short') { plan.shorts = [{ from: 0, to: 9999, title: o.title }]; plan.title = fromTitle || o.title; }   // the short says "From: <title>"
  const planFile = join(workDir(job), `${o.kind}-${o.slug}.plan.json`);
  writeFileSync(planFile, JSON.stringify(plan, null, 2));
  say('    indexing the segment');
  const ix = await kit(['index', lib], lib);
  if (ix.code !== 0) fail(`kit index failed: ${ix.err}`);
  say('    building with the long-form editor (longform.mjs build)');
  const b = await kit(['build', planFile], lib);
  if (b.code !== 0 || !b.result?.ok) fail(`kit build failed: ${(b.result?.errors || []).join('; ') || b.err}`);
  const dir = join(ROOT, 'out', 'longform', name);
  const files = {};   // published name -> local path
  if (o.kind === 'long') {
    files['video.mp4'] = join(dir, `${name}.mp4`);
    files['captions.srt'] = join(dir, `${name}.srt`);
    for (const f of ['CHAPTERS.txt', 'REPORT.md']) files[f] = join(dir, f);
    files['inserts.jpg'] = join(dir, `${name}.inserts.jpg`);
    if (planItem?.kit?.thumbnail || planItem?.kit?.thumbnails) { say('    thumbnails'); await kit(['thumbnail', planFile], lib); for (let k = 1; k <= 3; k++) files[`thumbnail-${k}.jpg`] = join(dir, `thumbnail-${k}.jpg`); }
  } else {
    say('    vertical short (longform.mjs shorts)');
    const s = await kit(['shorts', planFile], lib);
    if (s.code !== 0 || !s.result?.ok) fail(`kit shorts failed: ${(s.result?.errors || []).join('; ') || s.err}`);
    files['video.mp4'] = join(dir, 'shorts', `${name}-short-1.mp4`);
    files['captions.srt'] = join(dir, `${name}.srt`);
    files['REPORT.md'] = join(dir, 'REPORT.md');
  }
  const mp4 = files['video.mp4'];
  if (!existsSync(mp4)) fail(`build finished but ${relative(ROOT, mp4)} is missing`);
  const length = (await probe(mp4)).duration;
  // Stills to check before calling it built: 6 frames across the video, and a thumbnail frame.
  const stills = join(dir, `${o.kind}-stills.jpg`), thumb = join(dir, `${o.kind}-thumbnail.jpg`);
  await ff(['-i', mp4, '-vf', `fps=6/${Math.max(1, length).toFixed(2)},scale=${o.kind === 'long' ? 480 : 270}:-2,tile=3x2`, '-frames:v', '1', '-q:v', '3', stills], 'stills');
  await ff(['-ss', Math.min(1.5, length / 2).toFixed(2), '-i', mp4, '-frames:v', '1', '-q:v', '2', thumb], 'thumbnail');
  files['stills.jpg'] = stills; files['thumbnail.jpg'] = thumb;
  const report = existsSync(files['REPORT.md']) ? readFileSync(files['REPORT.md'], 'utf8') : '';
  const fixes = report.split('\n').filter((l) => /\bFIX\b/.test(l)).map((l) => l.replace(/^[\s|*-]+/, '').trim()).filter(Boolean)
    .filter((l) => o.kind === 'long' || !/chapters/i.test(l));   // shorts have no chapters
  if (o.kind === 'long' && !(planItem?.chapters || []).length) fixes.push('FIX no chapters in plan.json: every long video needs chapters (3+, each 10 s+)');
  const prefix = `out/${job}/${o.kind === 'long' ? 'long' : 'shorts'}/${o.slug}/`;
  const meta = {
    job, output_id: o.id, kind: o.kind, slug: o.slug, title: o.title, description: o.description,
    hook: planItem?.hook, why: planItem?.why, source: { start_s: o.start_s, end_s: o.end_s }, duration_s: +length.toFixed(2),
    chapters: existsSync(join(dir, 'CHAPTERS.txt')) && o.kind === 'long' ? readFileSync(join(dir, 'CHAPTERS.txt'), 'utf8').trim() : null,
    fixes, built_at: now(), built_by: ACTOR(), kit_plan: plan,
  };
  const metaFile = join(dir, `${o.kind}-metadata.json`);
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  files['metadata.json'] = metaFile;
  const uploaded = [];
  for (const [nm, f] of Object.entries(files)) if (existsSync(f)) { await put(f, prefix + nm); uploaded.push(prefix + nm); }
  await sql("UPDATE outputs SET status = 'built', r2_prefix = ?, updated_at = ? WHERE id = ?", [prefix, now(), o.id]);
  await event(job, o.id, 'built', { r2_prefix: prefix, duration_s: meta.duration_s, files: uploaded.length });
  if (fixes.length) await event(job, o.id, 'fix', { lines: fixes });
  say(`    built ${hms(length)} -> ${prefix} (${uploaded.length} files)${fixes.length ? `\n    FIX notes:\n      ${fixes.join('\n      ')}` : ''}\n    check the stills: ${relative(ROOT, stills)}`);
  return { output: o.id, r2_prefix: prefix, files: uploaded, duration_s: meta.duration_s, fixes, stills, local_video: mp4 };
}
async function cmdBuild(job, only) {
  if (!job) fail('usage: sim build <job> [output]');
  const j = await getJob(job);
  return holding(job, async () => {
    const { rows: all } = await sql('SELECT * FROM outputs WHERE job_id = ? ORDER BY kind, start_s', [job]);
    let outs = all.filter((o) => ['proposed', 'built', 'rejected'].includes(o.status));
    if (only) { const o = await getOutput(only.includes('/') && !only.startsWith(job) ? `${job}/${only}` : only); outs = outs.filter((x) => x.id === o.id); if (!outs.length) fail(`${o.id} is ${o.status}; only proposed/built/rejected outputs are built`); }
    else outs = outs.filter((o) => o.status === 'proposed');
    if (!outs.length) fail('nothing to build (sim propose first, or name an output to rebuild)');
    const proxy = await local(job, 'proxy.mp4');
    const words = JSON.parse(readFileSync(await local(job, 'words.json'), 'utf8')).words;
    let plan = {};
    try { plan = JSON.parse(readFileSync(await local(job, 'plan.json'), 'utf8')); } catch {}
    const item = (o) => [...(plan.long || []), ...(plan.shorts || [])].find((it) => slugify(it.slug || it.title) === o.slug && (o.kind === 'long') === (plan.long || []).includes(it));
    const results = [], failed = [];
    for (const o of outs) {
      try { const parent = o.kind === 'short' && all.find((x) => x.kind === 'long' && x.start_s <= o.start_s && x.end_s >= o.end_s);
        results.push(await buildOne(job, o, item(o), words, proxy, parent?.title || j.title)); }
      catch (e) { failed.push({ output: o.id, error: e.message }); await event(job, o.id, 'build_failed', { error: e.message }); say(`    FAILED: ${e.message}`); }
    }
    const { rows: left } = await sql("SELECT COUNT(*) AS n FROM outputs WHERE job_id = ? AND status = 'proposed'", [job]);
    if (!left[0].n && !failed.length && JOB_STATUS.indexOf(j.status) < JOB_STATUS.indexOf('built')) await setJobStatus(job, 'built', { outputs: results.length });
    return { ok: !failed.length, job, built: results, failed };
  });
}

async function cmdReview(job) {
  if (!job) fail('usage: sim review <job>');
  const j = await getJob(job);
  return holding(job, async () => {
    const { rows: outs } = await sql('SELECT * FROM outputs WHERE job_id = ? ORDER BY kind, start_s', [job]);
    const { rows: fixes } = await sql("SELECT output_id, detail FROM events WHERE job_id = ? AND action = 'fix' ORDER BY id", [job]);
    const fixBy = {};
    for (const f of fixes) fixBy[f.output_id] = JSON.parse(f.detail).lines;   // latest build wins
    const L = [`# Review: ${j.title}`, '', `Job \`${j.id}\` from \`${j.source_filename}\` (${hms(j.duration_s || 0)}). Links work for 7 days.`, '',
      'Approve or reject each one yourself (agents never do this):', '', '```', 'node sim.mjs approve <output>', 'node sim.mjs reject <output> --note "what to change"', '```', ''];
    const summary = [];
    for (const o of outs) {
      L.push(`## ${o.kind === 'long' ? 'Long' : 'Short'}: ${o.title}`, '', `- output: \`${o.kind}/${o.slug}\` (${o.status})`, `- source: ${hms(o.start_s)} to ${hms(o.end_s)} (${hms(o.end_s - o.start_s)})`);
      if (o.description) L.push(`- description: ${o.description}`);
      if (o.reviewer_notes) L.push(`- reviewer notes: ${o.reviewer_notes}`);
      const links = {};
      if (o.r2_prefix) {
        for (const f of await list(o.r2_prefix)) links[basename(f.key)] = await link(f.key);
        if (links['metadata.json']) { try { const m = JSON.parse(readFileSync(await get(o.r2_prefix + 'metadata.json', join(workDir(job), 'review', o.kind + '-' + o.slug + '.json')), 'utf8')); if (m.chapters) L.push('- chapters:', '', '```', m.chapters, '```'); } catch {} }
        L.push('- files: ' + Object.entries(links).map(([n, u]) => `[${n}](${u})`).join(' · '));
      } else L.push('- not built yet');
      const fx = fixBy[o.id] || [];
      L.push(fx.length ? `- FIX notes:\n${fx.map((x) => '  - ' + x).join('\n')}` : '- FIX notes: none');
      L.push('');
      summary.push({ output: o.id, status: o.status, title: o.title, video: links['video.mp4'] || null, fixes: fx });
    }
    const f = join(workDir(job), 'REVIEW.md');
    writeFileSync(f, L.join('\n'));
    await put(f, `out/${job}/REVIEW.md`);
    const reviewUrl = await link(`out/${job}/REVIEW.md`);
    if (outs.some((o) => o.status === 'built') && JOB_STATUS.indexOf(j.status) < JOB_STATUS.indexOf('in_review')) await setJobStatus(job, 'in_review', { outputs: outs.length });
    say(L.filter((l) => !l.startsWith('- files:')).join('\n'));
    say(`\nreview page: out/${job}/REVIEW.md (local: ${relative(ROOT, f)})\nlink (7 days): ${reviewUrl}`);
    return { ok: true, job, review_key: `out/${job}/REVIEW.md`, review_url: reviewUrl, local: f, outputs: summary };
  });
}

async function humanConfirm(word, what) {
  if (flags.yes) return true;
  if (!process.stdin.isTTY) fail(`${what} needs a person at the keyboard (type "${word}"). Agents never approve, reject or pass --yes.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${what}\nType "${word}" to confirm: `)).trim();
  rl.close();
  if (a !== word) fail('not confirmed; nothing changed');
  return true;
}
async function rollJob(job) {
  const { rows } = await sql('SELECT status FROM outputs WHERE job_id = ?', [job]);
  const st = rows.map((r) => r.status), j = await getJob(job);
  if (st.length && st.every((s) => s === 'posted' || s === 'rejected') && st.includes('posted')) { if (j.status !== 'posted') await setJobStatus(job, 'posted', {}, {}); }
  else if (st.length && st.every((s) => ['approved', 'posted', 'rejected'].includes(s)) && st.some((s) => s !== 'rejected')) { if (j.status !== 'approved') await setJobStatus(job, 'approved'); }
}
async function cmdApprove(ref) {
  if (!ref) fail('usage: sim approve <output>');
  const o = await getOutput(ref);
  if (o.status !== 'built') fail(`${o.id} is ${o.status}; only built outputs can be approved`);
  await humanConfirm('approve', `Approve ${o.kind} "${o.title}" (${o.id}) for posting?`);
  await sql("UPDATE outputs SET status = 'approved', updated_at = ? WHERE id = ?", [now(), o.id]);
  await event(o.job_id, o.id, 'approved', {}, HUMAN());
  await rollJob(o.job_id);
  say(`approved ${o.id}`);
  return { ok: true, output: o.id, status: 'approved' };
}
async function cmdReject(ref) {
  if (!ref || !flags.note) fail('usage: sim reject <output> --note "what is wrong / what to change"');
  const o = await getOutput(ref);
  if (['posted'].includes(o.status)) fail(`${o.id} is already posted`);
  await humanConfirm('reject', `Reject ${o.kind} "${o.title}" (${o.id})? Note: ${flags.note}`);
  await sql("UPDATE outputs SET status = 'rejected', reviewer_notes = ?, updated_at = ? WHERE id = ?", [flags.note, now(), o.id]);
  await event(o.job_id, o.id, 'rejected', { note: flags.note }, HUMAN());
  await rollJob(o.job_id);
  say(`rejected ${o.id}: ${flags.note}`);
  return { ok: true, output: o.id, status: 'rejected' };
}
async function cmdMarkPosted(ref) {
  if (!ref || !flags.platform || !flags.url) fail('usage: sim mark-posted <output> --platform youtube --url <url>');
  const o = await getOutput(ref);
  if (!['approved', 'posted'].includes(o.status)) fail(`${o.id} is ${o.status}; only approved outputs can be posted`);
  const platforms = [...new Set([...JSON.parse(o.platforms || '[]'), flags.platform])];
  const urls = { ...JSON.parse(o.posted_urls || '{}'), [flags.platform]: flags.url };
  await sql("UPDATE outputs SET status = 'posted', platforms = ?, posted_urls = ?, updated_at = ? WHERE id = ?", [JSON.stringify(platforms), JSON.stringify(urls), now(), o.id]);
  await event(o.job_id, o.id, 'posted', { platform: flags.platform, url: flags.url });
  await rollJob(o.job_id);
  say(`recorded ${o.id} on ${flags.platform}: ${flags.url}`);
  return { ok: true, output: o.id, platforms, posted_urls: urls };
}

const HELP = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 19).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
const COMMANDS = {
  init: cmdInit, ingest: cmdIngest, watch: cmdWatch, status: cmdStatus,
  claim: async (job) => { if (!job) fail('usage: sim claim <job>'); await getJob(job); const by = await claim(job, { minutes: +(flags.minutes || LEASE_MIN) }); say(`${job} is yours (${by}) for ${flags.minutes || LEASE_MIN} min; commands renew it while they run. Release it when you stop: node sim.mjs release ${job}`); return { ok: true, job, claimed_by: by }; },
  note: async (job, ...words) => {
    const text = words.join(' ').trim();
    if (!job || !text) fail('usage: sim note <job> "what the next agent should know"');
    await getJob(job);
    await sql('UPDATE jobs SET notes = ?, updated_at = ? WHERE id = ?', [`${now().slice(0, 16)}Z ${ACTOR()}: ${text}`, now(), job]);
    await event(job, null, 'note', { text });
    say(`noted on ${job}`);
    return { ok: true, job, note: text };
  },
  release: async (job) => { if (!job) fail('usage: sim release <job>'); const ok = await release(job); say(ok ? `released ${job}` : `${job} was not claimed by ${ACTOR()}`); return { ok: true, job, released: ok }; },
  transcribe: cmdTranscribe, propose: cmdPropose, build: cmdBuild, review: cmdReview,
  approve: cmdApprove, reject: cmdReject, 'mark-posted': cmdMarkPosted,
};

try {
  if (!cmd || cmd === 'help' || flags.help || !COMMANDS[cmd]) { console.log(HELP); if (cmd && cmd !== 'help' && !COMMANDS[cmd]) process.exitCode = 1; }
  else {
    if (!['init', 'status', 'approve', 'reject', 'help'].includes(cmd) && !flags.agent && !env('SIM_AGENT')) say('note: SIM_AGENT is not set; the log will say "unnamed-agent". Set SIM_AGENT=<your agent name>.');
    const r = await COMMANDS[cmd](...args);
    if (JSON_OUT) console.log(JSON.stringify(r));
    if (r && r.ok === false) process.exitCode = 1;
  }
} catch (e) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: e.message }));
  else console.error(`error: ${e.user ? e.message : e.stack || e.message}`);
  process.exitCode = 1;
}
