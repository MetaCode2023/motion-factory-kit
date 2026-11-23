// tools/clips/index.mjs: outside clips, found and pulled automatically (fair use: short, talked over, credited).
//
//   node longform.mjs clips edits/longform/x.json [--dry] [--no-auto]
//
// 1. Every `[[clip ...]]` cue (a "pull" insert) without a url gets one: its `search` (or title) is searched on
//    YouTube, the best match is taken (on topic first, then popular; no Shorts, streams or excluded channels),
//    and the seconds are chosen: where the cue's `say:` words are spoken, else the video's most-replayed moment.
// 2. Automatic clips: the people and events named in the talk ("Phil Ivey", "the Apollo 11 landing") get one too,
//    in the gaps between the plan's own visuals, at most one per `every` seconds. Shown in a box beside the
//    speaker (layout "side") with their sound off unless `audio` is set.
// 3. Each clip is cut out with yt-dlp into assets/broll/<id>.mp4; the next build uses it. The source is credited
//    on screen (a small channel label) and in CREDITS.md for the description.
// 4. Everything chosen is in edits/longform/<name>.clips.lock.json, the edit surface: per entry "status": "drop"
//    (never use) or "keep", a new "query" or "say", "pick": 2 (the next video), or your own "url"/"from"/"to".
//    out/longform/<name>/CLIPS.md lists each one with a link to the exact moment, to watch before posting.
//
// Plan settings ("auto_clips"): false turns the automatic ones off (cues are still filled). Otherwise
// { context: "poker", exclude: ["SimulationSeries"], skip: ["Tom"], every, max, layout, audio, force: [{ at, word, query }] }.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { FF, ROOT, bare, fmt, probe } from '../longform/common.mjs';
import { placeBroll } from '../broll/place.mjs';
import { CLIP, HARD_MAX, clipMoments, creditLine, mmss, parseVtt, pickWindow, rankVideos, sourceLabel, syntheticWhy } from './pick.mjs';

export const clipsLockPath = (plan) => plan._file.replace(/\.json$/, '') + '.clips.lock.json';
const CACHE = () => join(ROOT, 'assets', 'broll', '.cache', 'clips');
const BROLL = () => join(ROOT, 'assets', 'broll');

export function clipSettings(plan) {
  const a = plan.auto_clips === false ? { off: true } : plan.auto_clips || {};
  const pick = (k) => (a[k] != null ? { [k]: a[k] } : {});
  return {
    ...CLIP, ...['every', 'min', 'max', 'tail', 'lead', 'hook', 'end', 'gap', 'spacing'].reduce((o, k) => ({ ...o, ...pick(k) }), {}),
    auto: !a.off, context: a.context || '', exclude: a.exclude || [], skip: a.skip || [], force: a.force || [],
    layout: a.layout || 'side', audio: a.audio ?? 0, max: Math.min(HARD_MAX, a.max ?? CLIP.max),
  };
}

export function readClipsLock(plan) {
  const f = plan._file && clipsLockPath(plan);
  if (!f || !existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { throw new Error(`can't read ${relative(ROOT, f)}: ${e.message}`); }
}

// ---- yt-dlp ----------------------------------------------------------------------------------------------
let YT = null;
export function ytdlp() {
  if (YT) return YT;
  for (const c of [['yt-dlp'], ['yt-dlp.exe'], ['python3', '-m', 'yt_dlp'], ['python', '-m', 'yt_dlp']]) {
    if (spawnSync(c[0], [...c.slice(1), '--version'], { encoding: 'utf8' }).status === 0) return (YT = c);
  }
  return null;
}
function yt(args, what) {
  const c = ytdlp();
  if (!c) throw new Error('yt-dlp not installed (pip install yt-dlp)');
  // Node as yt-dlp's JavaScript runtime: without one, YouTube hides formats and sections can come back picture-less.
  const r = spawnSync(c[0], [...c.slice(1), '--no-warnings', '--js-runtimes', `node:${process.execPath}`, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`${what}: ${(r.stderr || '').trim().split('\n').pop()}`);
  return r.stdout;
}
const cached = (name, make) => {
  const f = join(CACHE(), name);
  if (existsSync(f) && Date.now() - statSync(f).mtimeMs < 14 * 864e5) return JSON.parse(readFileSync(f, 'utf8'));
  const v = make();
  mkdirSync(CACHE(), { recursive: true });
  writeFileSync(f, JSON.stringify(v));
  return v;
};
const h8 = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

export function searchVideos(query, n = 12) {
  return cached(`search-${h8(query + n)}.json`, () => JSON.parse(yt(['--flat-playlist', '-J', `ytsearch${n}:${query}`], `search "${query}"`)).entries || []);
}
export function videoInfo(id) {
  return cached(`info-${id}.json`, () => {
    const d = JSON.parse(yt(['-j', '--skip-download', `https://www.youtube.com/watch?v=${id}`], `info ${id}`));
    return { id: d.id, title: d.title, channel: d.channel || d.uploader, duration: d.duration, view_count: d.view_count, width: d.width, height: d.height,
      age_limit: d.age_limit, live_status: d.live_status, heatmap: d.heatmap || [], chapters: d.chapters || [], upload_date: d.upload_date,
      channel_is_verified: !!d.channel_is_verified, description: (d.description || '').slice(0, 3000), tags: (d.tags || []).slice(0, 40), has_captions: !!Object.keys(d.automatic_captions || {}).some((k) => k.startsWith('en')) || !!Object.keys(d.subtitles || {}).some((k) => k.startsWith('en')) };
  });
}
export function captionsFor(id) {
  return cached(`captions-${id}.json`, () => {
    const dir = join(CACHE(), `subs-${id}`);
    mkdirSync(dir, { recursive: true });
    try { yt(['--skip-download', '--write-auto-subs', '--write-subs', '--sub-langs', 'en.*,en', '--sub-format', 'vtt', '-o', join(dir, '%(id)s.%(ext)s'), `https://www.youtube.com/watch?v=${id}`], `captions ${id}`); } catch { /* none */ }
    const f = readdirSync(dir).find((x) => x.endsWith('.vtt'));
    const cues = f ? parseVtt(readFileSync(join(dir, f), 'utf8')) : [];
    rmSync(dir, { recursive: true, force: true });
    return cues;
  });
}
export function downloadSection(id, from, to, out) {
  const tmp = out.replace(/\.mp4$/, '.part.mp4');
  rmSync(tmp, { force: true });
  // H.264 first: other codecs (VP9/AV1 in mp4) can lose their picture when cut to a section.
  yt(['-f', 'bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*[height<=1080]+ba/b', '--merge-output-format', 'mp4', '--ffmpeg-location', FF,
    '--download-sections', `*${from.toFixed(2)}-${to.toFixed(2)}`, '--force-keyframes-at-cuts', '--no-playlist', '-o', tmp, `https://www.youtube.com/watch?v=${id}`], `download ${id}`);
  if (!existsSync(tmp)) throw new Error(`download ${id}: no file`);
  const p = probe(tmp);
  if (!p.width) { rmSync(tmp, { force: true }); throw new Error(`download ${id}: came back with no picture`); }
  rmSync(out, { force: true });
  writeFileSync(out, readFileSync(tmp)); rmSync(tmp, { force: true });
}

// Output time -> a source anchor that survives re-cuts of the plan (same as automatic B-roll).
function toAnchor(cuts, t) {
  const real = cuts.filter((x) => !x.bridge);
  const c = real.find((x) => t >= x.out - 1e-3 && t < x.out + x.d + 1e-3) || real.find((x) => x.out >= t) || real[real.length - 1];
  return `${c.clip}@${(c.s + Math.max(0, t - c.out)).toFixed(3)}`;
}

/** url/from/to/credit for the script's own clip cues, by insert id (read before the plan's inserts resolve). */
export function clipFills(plan) {
  const lock = readClipsLock(plan), byId = {};
  for (const e of lock?.entries || []) if (e.source === 'plan' && e.status !== 'drop' && e.url) byId[e.id] = { url: e.url, from: e.from, to: e.to, credit: e.credit, label: e.label, title: e.video?.title };
  return byId;
}

/**
 * Locked clips -> what resolvePlan needs: `byId` fills explicit pull cues; `inserts` are the automatic ones,
 * re-placed in the gaps against the plan's current visuals (so plan edits move them with the words).
 */
export function lockedClips(plan, { inserts, total, resolveAt, cuts, lib }) {
  const lock = readClipsLock(plan);
  if (!lock) return { byId: {}, inserts: [], warnings: [] };
  const o = clipSettings(plan), byId = {}, warnings = [], moments = [];
  for (const e of lock.entries || []) {
    if (e.status === 'drop' || !e.url) continue;
    const info = { url: e.url, from: e.from, to: e.to, credit: e.credit, label: e.label, title: e.video?.title };
    if (e.source === 'plan') { byId[e.id] = info; continue; }
    if (!o.auto) continue;
    let at;
    try { at = resolveAt({ at: e.anchor, word: e.word }, cuts, lib, `clip "${e.said}"`); } catch { continue; }
    moments.push({ ...e, ...info, at, end: at + (e.spoken || 0.5), score: e.status === 'keep' ? 99 : e.score || 1 });
  }
  const { placed } = placeBroll(moments, inserts, total, { ...o, min: o.min, max: Math.min(o.max, HARD_MAX) });
  const out = placed.map((m, k) => {
    const file = join(BROLL(), `${m.id}.mp4`), have = existsSync(file);
    const dur = Math.min(m.dur, (m.to - m.from) || m.dur);
    const base = { i: 2000 + k, where: `outside clip "${m.said}"`, auto: false, id: m.id, at: +m.at.toFixed(3), dur: +dur.toFixed(2), layout: o.layout, sfx: null,
      note: `${m.said}: ${m.title || m.query}`, title: m.title || m.said, credit: m.credit, label: m.label, outsideClip: true, src: { transition: 'cut', said: m.said, search: m.query, title: m.title } };
    if (!have) warnings.push(`outside clip "${m.said}": not downloaded yet (node longform.mjs clips)`);
    return have ? { ...base, kind: 'broll', pulled: true, file, from: 0, audio: o.audio }
      : { ...base, kind: 'pull', url: m.url, search: m.query, from: m.from, to: m.to };
  });
  return { byId, inserts: out, warnings };
}

/**
 * Find, pick and pull. R: resolvePlan(plan, lib, { autoBroll: false, clips: false }) with R.resolveAt
 * (without the lockfile applied, so every cue and name is considered afresh and merged with the old picks).
 */
export async function findClips(plan, R, { dry = false, log = console.log, outDir = join(ROOT, 'out', 'longform', plan.name) } = {}) {
  const o = clipSettings(plan);
  const lock = readClipsLock(plan) || { version: 1, entries: [] };
  const old = new Map(lock.entries.map((e) => [e.id, e]));
  const entries = [];

  // 1. cues in the script that still need a source
  for (const ins of R.inserts) {
    if (!ins.outsideClip || ins.autoBroll || ins.stock || ins.src?.url) continue;   // a cue with its own url is left alone
    const prev = old.get(ins.id) || {};
    entries.push({ ...prev, id: ins.id, source: 'plan', said: ins.title, query: prev.query_set_by_hand ? prev.query : (ins.search || ins.title), say: prev.say ?? ins.src?.say ?? '',
      dur: +Math.min(HARD_MAX, ins.dur).toFixed(2), status: prev.status || 'auto', at_out: +ins.at.toFixed(2) });
  }
  // 2. names in the talk
  if (o.auto) {
    const ms = clipMoments(R.words, { context: o.context, skip: o.skip });
    for (const f of o.force) {
      const at = R.resolveAt ? R.resolveAt(f) : null;
      if (at == null) continue;
      const w = R.words.find((x) => x.s >= at - 0.05) || R.words[R.words.length - 1];
      ms.push({ at: w.s, end: w.e + 1, said: f.word || w.w, key: bare(f.word || w.w), query: f.query, names: [f.word || w.w], sentence: '', score: 99, forced: true });
    }
    const cands = ms.map((m) => ({ ...m, score: m.forced ? 99 : m.score }));
    const { placed, skipped } = placeBroll(cands, R.inserts, R.total, o);
    for (const p of placed) {
      const anchor = toAnchor(R.cuts, p.at), word = p.said.split(/[ ,]/)[0];
      const id = `clip-${bare(p.names[0]).slice(0, 16) || 'x'}-${h8(anchor).slice(0, 4)}`;
      const prev = old.get(id) || {};
      entries.push({ ...prev, id, source: 'auto', anchor, word, said: p.said, query: prev.query_set_by_hand ? prev.query : prev.query || p.query, say: prev.say || '',
        dur: +Math.min(o.max, p.dur).toFixed(2), spoken: +(p.end - p.at).toFixed(2), score: p.score, status: prev.status || (p.forced ? 'keep' : 'auto'), at_out: +p.at.toFixed(2), sentence: p.sentence });
    }
    for (const s of skipped) log(`  skipped "${s.said}": ${s.why}`);
  }
  // Hand-kept or hand-dropped entries the finder no longer produces stay in the file.
  for (const e of lock.entries) if (!entries.some((x) => x.id === e.id) && (e.status === 'keep' || e.status === 'drop')) entries.push(e);

  // 3. search, choose the seconds, download
  const used = new Set(), problems = [];
  let pulled = 0;
  for (const e of entries.sort((a, b) => (a.at_out ?? 0) - (b.at_out ?? 0))) {
    if (e.status === 'drop') continue;
    const out = join(BROLL(), `${e.id}.mp4`);
    if (existsSync(out) && !e.pulled) { e.why = 'your own file is saved there; delete it to let this pick one'; continue; }
    try {
      let v = null, alts = [];
      if (e.url && e.url_set_by_hand) {
        const id = (e.url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/) || [])[1];
        if (!id) throw new Error(`can't read a YouTube id from ${e.url}`);
        v = videoInfo(id);
      } else {
        const ranked = rankVideos(searchVideos(e.query), e.query, { exclude: o.exclude, need: e.dur }).filter((x) => x.score >= 0 && !used.has(x.id));
        const pick = ranked[Math.max(0, (e.pick || 1) - 1)];
        if (!pick) { e.why = `no usable video for "${e.query}"`; problems.push(`${e.said}: ${e.why}`); continue; }
        // The full page can still give it away (description, tags): generated, age-gated or vertical -> the next one.
        v = null;
        for (const cand of ranked.slice(Math.max(0, (e.pick || 1) - 1), Math.max(0, (e.pick || 1) - 1) + 4)) {
          const info = videoInfo(cand.id);
          const no = syntheticWhy(info, e.query) || (info.age_limit >= 18 && 'age-gated') || (info.width && info.height && info.width < info.height && 'vertical');
          if (no) { log(`  passed over "${info.title}": ${no}`); continue; }
          v = info; break;
        }
        if (!v) { e.why = `no real, usable video for "${e.query}"`; problems.push(`${e.said}: ${e.why}`); continue; }
        alts = ranked.filter((x) => x.id !== v.id).slice(0, 3).map((x) => ({ id: x.id, title: x.title, channel: x.channel, views: x.view_count }));
      }
      used.add(v.id);
      const win = e.from != null && e.to != null && e.window_set_by_hand ? { from: e.from, to: e.to, how: 'set by hand' }
        : pickWindow(v, e.dur, { captions: e.say || e.source === 'plan' ? captionsFor(v.id) : null, say: e.say, want: e.source === 'plan' ? e.said : '' });
      const key = `${v.id}@${win.from}-${win.to}`;
      Object.assign(e, { url: `https://www.youtube.com/watch?v=${v.id}`, from: win.from, to: win.to, how: win.how,
        video: { id: v.id, title: v.title, channel: v.channel, views: v.view_count, duration: v.duration }, alternatives: alts.length ? alts : e.alternatives,
        credit: creditLine(v, win.from, win.to), label: sourceLabel(v), why: '' });
      if (dry) { e.why = existsSync(out) && e.pulled === key ? '' : 'not downloaded (--dry)'; continue; }
      if (!(existsSync(out) && e.pulled === key)) {
        downloadSection(v.id, win.from, win.to, out);
        e.pulled = key; pulled++;
        log(`  ${fmt(e.at_out ?? 0)}  ${e.said}: ${v.channel}, "${v.title}" ${mmss(win.from)}-${mmss(win.to)} (${win.how})`);
      }
    } catch (err) { e.why = err.message; problems.push(`${e.said}: ${err.message}`); }
  }

  const doc = { version: 1, plan: relative(ROOT, plan._file).replace(/\\/g, '/'), entries };
  writeFileSync(clipsLockPath(plan), JSON.stringify(doc, null, 2));
  mkdirSync(outDir, { recursive: true });
  const report = join(outDir, 'CLIPS.md');
  writeFileSync(report, clipsReport(plan, doc, dry));
  const ready = entries.filter((e) => e.status !== 'drop' && existsSync(join(BROLL(), `${e.id}.mp4`))).length;
  return { ok: !problems.length, clips: entries.filter((e) => e.status !== 'drop').length, ready, pulled, problems, lock: clipsLockPath(plan), report };
}

function clipsReport(plan, lock, dry) {
  const rows = lock.entries.map((e, k) => {
    const link = e.video ? `[${(e.video.title || '').replace(/[|\]]/g, '/')}](https://youtu.be/${e.video.id}?t=${Math.floor(e.from)}) (${e.video.channel})` : '';
    return `| ${k + 1} | ${fmt(e.at_out ?? 0)} | ${(e.said || '').replace(/\|/g, '/')} | ${e.source === 'plan' ? 'script cue' : 'named in the talk'} | ${(e.query || '').replace(/\|/g, '/')} | ${link} | ${e.video ? `${mmss(e.from)}-${mmss(e.to)}` : ''} | ${(e.how || '').replace(/\|/g, '/')} | ${e.status}${e.why ? `: ${e.why.replace(/\|/g, '/')}` : ''} |`;
  });
  return [`# Outside clips: ${plan.title || plan.name}`, '',
    dry ? 'Dry run: chosen but not downloaded.' : 'Each clip is cut into assets/broll/<id>.mp4 and used by the next build.',
    'Fair use: each is a few seconds, talked over, and credited (a channel label on screen; the lines in CREDITS.md go in the description). Watch each link before posting.',
    `To change one, edit \`${relative(ROOT, clipsLockPath(plan)).replace(/\\/g, '/')}\`: \`"status": "drop"\` or \`"keep"\`, \`"pick": 2\` for the next video, a new \`"query"\` (with \`"query_set_by_hand": true\`), \`"say"\` (words to find in its captions), or your own \`"url"\` + \`"url_set_by_hand": true\` / \`"from"\` + \`"to"\` + \`"window_set_by_hand": true\`. Then run \`node longform.mjs clips\` again and rebuild.`, '',
    '| # | At | For | From | Search | Video | Seconds | How | Status |', '|---|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n');
}
