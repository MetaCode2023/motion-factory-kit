// tools/broll/index.mjs: automatic B-roll for a long-form plan. When the speaker names something you can
// picture ("China", "a casino", "Wall Street"), cut to a 1.5-3 s stock clip or photo of it while the voice
// carries on.
//
//   node longform.mjs broll edits/longform/x.json [--dry] [--offline]
//
// 1. Reads the plan's words on the finished timeline and finds the moments (find.mjs).
// 2. Places them in the gaps between the plan's own visuals (place.mjs).
// 3. Searches sources whose media may be reused (sources.mjs), video before photos: Pixabay/Pexels if a key is
//    set, Wikimedia Commons video, YouTube videos under its Creative Commons licence (needs yt-dlp), then photos.
// 4. Checks each result really is the thing named (validate.mjs): the name must be in its title, tags or
//    description; compilations, reactions, gameplay and the like are refused.
// 5. Downloads each pick once into assets/broll/stock/ and records it in edits/longform/<name>.broll.lock.json.
// 6. Saves a check sheet (three frames of the seconds used) per pick in out/longform/<name>/broll-check/ and
//    writes BROLL.md: every moment, what was picked, why, and what still has to be looked at.
//
// The lockfile is the edit surface. Per entry: "status": "drop" (never use) or "keep" (use even if the finder
// was unsure), a new "query" (searched again on the next run), "pick": 2 (the second-best result),
// "seen": true once the editor has looked at its check sheet and it shows the right thing. Rebuilds
// use the locked pick, so the video doesn't change when the stock sites reorder their results.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { FF, ROOT, bare, fmt, frameAt, sheet } from '../longform/common.mjs';
import { checkSheet, validate } from './validate.mjs';
import { findMoments } from './find.mjs';
import { MODES, PLACE, placeBroll } from './place.mjs';
import { DEFAULT_SOURCES, available, download, findYtdlp, rank, search, tryOrder } from './sources.mjs';

export const STOCK_DIR = () => join(ROOT, 'assets', 'broll', 'stock');
export const CACHE_DIR = () => join(ROOT, 'assets', 'broll', '.cache', 'search');
export const lockPath = (plan) => plan._file.replace(/\.json$/, '') + '.broll.lock.json';

export function readLock(plan) {
  const f = lockPath(plan);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { throw new Error(`can't read ${relative(ROOT, f)}: ${e.message}`); }
}

// Plan settings, with defaults. "auto_broll": false turns the feature off.
export function settings(plan) {
  if (plan.auto_broll === false) return null;
  const a = plan.auto_broll || {};
  const mode = a.mode || 'throughout';
  if (!MODES[mode]) throw new Error(`auto_broll.mode "${mode}" (try: ${Object.keys(MODES).join(', ')})`);
  return {
    ...PLACE, ...MODES[mode], ...pickKeys(a, Object.keys(PLACE)), mode,
    sfx: a.sfx ?? null,   // null: the sound design picks (swipe/click on each cut; none with sound: off)
    sources: a.sources || DEFAULT_SOURCES,
    types: a.types, skip: a.skip || [], force: a.force || [],
    layout: a.layout || 'full', repeat: a.repeat ?? 60, portrait: !!a.portrait,
    photos: a.photos !== false,          // false = moving pictures only, no photo fallback
    channels: a.channels || [],          // YouTube channels whose videos may be used without the CC label (yours, or cleared)
    validate: a.validate !== false,      // false = take the top result without the subject check
  };
}
const pickKeys = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, o[k]]));

// Output time -> a source anchor ("clip@12.345") that survives re-cuts of the plan.
function toAnchor(cuts, t) {
  const c = cuts.find((x) => t >= x.out - 1e-3 && t < x.out + x.d + 1e-3) || cuts[cuts.length - 1];
  return `${c.clip}@${(c.s + Math.max(0, t - c.out)).toFixed(3)}`;
}

/**
 * Locked picks -> inserts, for resolvePlan. Each entry's time is resolved again from its anchor (so plan edits
 * move it with the words), then placed against the plan's own inserts with the same rules as when it was picked.
 */
export function lockedInserts(plan, { inserts, total, resolveAt, cuts, lib }) {
  const opts = settings(plan);
  const lock = opts && readLock(plan);
  if (!lock) return { inserts: [], warnings: [] };
  const warnings = [], moments = [];
  for (const e of lock.entries || []) {
    if (!e.media || e.status === 'drop' || e.status === 'skip' || e.status === 'review') continue;
    const file = resolve(ROOT, e.media.file);
    if (!existsSync(file)) { warnings.push(`B-roll "${e.said}": ${e.media.file} is missing (run node longform.mjs broll again)`); continue; }
    let at;
    try { at = resolveAt({ at: e.anchor, word: e.word }, cuts, lib, `B-roll "${e.said}"`); } catch { continue; }   // that part of the talk was cut out
    moments.push({ ...e, at, end: at + (e.spoken || 0.5), score: e.status === 'keep' ? 99 : e.score, file });
  }
  const unseen = moments.filter((m) => m.media.kind === 'video' && !m.seen);
  if (unseen.length) warnings.push(`${unseen.length} video cutaway(s) not looked at yet (${unseen.slice(0, 4).map((m) => `"${m.said}"`).join(', ')}${unseen.length > 4 ? ', …' : ''}): open their check sheets in out/longform/${plan.name}/broll-check/ and set "seen": true, or drop them`);
  const { placed } = placeBroll(moments, inserts, total, opts);
  return {
    warnings,
    inserts: placed.map((m, k) => {
      const kind = m.media.kind === 'video' ? 'broll' : 'image';
      const from = kind === 'broll' ? Math.max(0, Math.min(m.media.from ?? 0.5, (m.media.dur || 0) - m.dur - 0.1)) : 0;
      return {
        i: 1000 + k, where: `auto B-roll "${m.said}"`, auto: false, id: `broll-${String(k + 1).padStart(2, '0')}-${bare(m.key).slice(0, 16) || 'shot'}`,
        kind, at: +m.at.toFixed(3), dur: m.dur, layout: opts.layout, sfx: opts.sfx || null, note: `${m.said}: ${m.media.query}`,
        file: m.file, from, audio: 0, autoBroll: true, credit: credit(m.media),
        src: { transition: 'cut', said: m.said, query: m.media.query },
      };
    }),
  };
}

const NAMES = { pixabay: 'Pixabay', pexels: 'Pexels', commons: 'Wikimedia Commons', openverse: 'Openverse', flickr: 'Flickr', wikimedia: 'Wikimedia Commons' };
export const credit = (m) => `"${m.title || (m.kind === 'video' ? 'Video' : 'Photo')}" by ${m.author || 'unknown'}, ${m.license}, via ${NAMES[m.via] || NAMES[m.source] || m.source}: ${m.page}`;

/**
 * Find moments, place them, fetch media, write the lockfile and BROLL.md.
 * resolve: (plan) -> resolvePlan result without auto B-roll (passed in to avoid an import cycle).
 */
export async function autoBroll(plan, R, { dry = false, offline = false, env = process.env, fetchImpl = fetch, log = console.log, stockDir = STOCK_DIR(), cacheDir = CACHE_DIR(), outDir = join(ROOT, 'out', 'longform', plan.name), pause = 1500, ytdlp = findYtdlp(), run, sheets = true } = {}) {
  const opts = settings(plan);
  if (!opts) return { ok: true, off: true, note: 'auto_broll is false in this plan' };
  const sources = available(opts.sources, env, { ytdlp });
  const lock = readLock(plan) || { version: 1, entries: [] };
  const byKey = new Map(lock.entries.map((e) => [e.anchor + '|' + bare(e.word), e]));

  // 1. moments on the finished timeline, merged with what the lockfile already decided
  const found = findMoments(R.words, { skip: opts.skip, types: opts.types, repeat: opts.repeat });
  for (const f of opts.force) {
    const at = R.resolveAt ? R.resolveAt(f) : null;
    if (at == null) continue;
    const w = R.words.find((x) => x.s >= at - 0.05) || R.words[R.words.length - 1];
    found.push({ at: w.s, end: w.e, said: f.word || w.w, key: bare(f.word || w.w), sentence: '', type: 'forced', queries: [f.query], query: f.query, score: 99, status: 'keep', why: 'forced in the plan' });
  }
  const entries = found.map((m) => {
    const anchor = toAnchor(R.cuts, m.at), word = m.said.split(' ')[0];
    const old = byKey.get(anchor + '|' + bare(word));
    const e = old ? { ...old } : { anchor, word, said: m.said, key: m.key, type: m.type, query: m.query, alternatives: m.queries.slice(1), score: m.score, status: m.status, why: m.why, sentence: m.sentence, spoken: +(m.end - m.at).toFixed(3) };
    e.at_out = +m.at.toFixed(2);   // for reading only; the anchor is what counts
    return e;
  });
  // Entries a person added or kept by hand that the finder no longer produces stay in the file.
  for (const old of lock.entries) if (!entries.some((e) => e.anchor === old.anchor && bare(e.word) === bare(old.word)) && (old.status === 'keep' || old.status === 'drop')) entries.push(old);

  // 2. placement against the plan's own visuals
  const candidates = entries.filter((e) => e.status === 'auto' || e.status === 'keep').map((e) => ({ ...e, at: e.at_out ?? 0, end: (e.at_out ?? 0) + (e.spoken || 0.5), score: e.status === 'keep' ? 99 : e.score, ref: e }));
  const { placed, skipped } = placeBroll(candidates, R.inserts, R.total, opts);
  for (const s of skipped) { s.ref.placed = false; s.ref.why = s.why; }

  // 3. search and download for each placed moment
  const used = new Set(entries.filter((e) => e.media).map((e) => `${e.media.source}-${e.media.id}`));
  const problems = [];
  let fetched = 0;
  for (const p of placed) {
    const e = p.ref;
    e.placed = true; e.why = '';
    const want = { query: e.query, pick: e.pick || 1 };
    if (e.media && e.media.query === want.query && (e.media.pick || 1) === want.pick && existsSync(resolve(ROOT, e.media.file))) continue;
    if (dry) { e.why = e.media ? 'search changed: run without --dry to fetch' : 'not fetched yet (--dry)'; continue; }
    if (!sources.length) { e.why = 'no source available'; continue; }
    if (e.media) used.delete(`${e.media.source}-${e.media.id}`);
    let got = null;
    // The search Claude chose first, then the lexicon's alternatives if nothing usable comes back.
    const queries = [want.query, ...(e.query === want.query && want.pick === 1 ? e.alternatives || [] : [])];
    const refused = [];
    for (const [src, kind, query] of queries.flatMap((q) => tryOrder(sources, e.type, { photos: opts.photos }).map(([a, b]) => [a, b, q]))) {
      if (got) break;
      try {
        const found = rank(await search(src, kind, query, { portrait: opts.portrait, channels: opts.channels, cacheDir, env, fetchImpl, offline, run, ytdlp }), { query, need: p.dur, portrait: opts.portrait, used });
        // Only results that are about the thing named; best match first (the rank order breaks ties).
        const results = found.map((r, k) => ({ r, k, v: opts.validate ? validate(r, e) : { ok: true, score: 0.5, why: 'not checked (validate: false)' } }))
          .filter((x) => { if (!x.v.ok && refused.length < 4) refused.push(`${x.r.source} "${String(x.r.title || x.r.id).slice(0, 40)}": ${x.v.why}`); return x.v.ok; })
          .sort((a, b) => b.v.score - a.v.score || a.k - b.k);
        const hit = results[want.pick - 1];
        if (!hit) continue;
        const r = hit.r;
        // Long videos open on titles and talking: start a fifth of the way in. Stock clips start near the top.
        const from = r.kind !== 'video' ? 0 : r.dur > 30 ? Math.min(r.dur - p.dur - 2, Math.max(3, r.dur * 0.2)) : Math.min(0.5, Math.max(0, r.dur - p.dur - 0.1));
        const take = +(p.dur + 2).toFixed(1);
        const file = offline ? join(stockDir, `${r.source}-${r.id}.${r.ext}`) : await download({ ...r, from, take }, stockDir, { fetchImpl, run, ytdlp, ffmpeg: FF });
        if (!existsSync(file)) continue;
        if (r.source === 'commons' && !offline && pause) await new Promise((ok) => setTimeout(ok, pause));   // Commons rate-limits quickly
        const cut = r.fetch === 'ytdlp';   // only those seconds were downloaded, so the file starts at 0
        got = { source: r.source, via: r.via, title: r.title || '', id: r.id, kind: r.kind, file: relative(ROOT, file).replace(/\\/g, '/'), w: r.w, h: r.h, dur: cut ? take : r.dur, from: cut ? 0 : +from.toFixed(2), ...(cut ? { source_from: +from.toFixed(1) } : {}),
          page: r.page, author: r.author, license: r.license, query: want.query, found_with: query, pick: want.pick, match: hit.v.score, match_why: hit.v.why };
      } catch (err) { problems.push(`${e.said}: ${src} ${kind}: ${err.message}`); }
    }
    if (got) {
      e.media = got; e.seen = false; used.add(`${got.source}-${got.id}`); fetched++;
      if (sheets && !offline) {
        try {
          const out = join(outDir, 'broll-check', `${String(Math.round((e.at_out ?? 0) * 10)).padStart(5, '0')}-${bare(e.key).slice(0, 20) || 'shot'}.jpg`);
          const made = await checkSheet(resolve(ROOT, got.file), { from: got.from, dur: p.dur, kind: got.kind, label: `"${e.said}" at ${fmt(p.at)}  ·  ${got.source}: ${String(got.title).slice(0, 50)}` }, out, { frameAt, sheet });
          if (made) e.check = relative(ROOT, made).replace(/\\/g, '/');
        } catch (err) { problems.push(`${e.said}: check sheet: ${err.message}`); }
      }
      log(`  ${fmt(p.at)}  "${e.said}" -> ${got.source} ${got.kind} ${got.id} (${want.query}; ${got.match_why})`);
    }
    else { e.why = `nothing usable for "${want.query}"${refused.length ? ` (refused: ${refused.join('; ')})` : ''}`; log(`  ${fmt(p.at)}  "${e.said}": ${e.why}`); }
  }

  const out = { version: 1, plan: relative(ROOT, plan._file).replace(/\\/g, '/'), sources, entries: entries.map(({ ref, ...e }) => e).sort((a, b) => (a.at_out ?? 0) - (b.at_out ?? 0)) };
  writeFileSync(lockPath(plan), JSON.stringify(out, null, 2));
  const dir = outDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'BROLL.md'), brollReport(plan, out, sources, dry));
  const used2 = out.entries.filter((e) => e.placed && e.media);
  const ready = used2.length, videos = used2.filter((e) => e.media.kind === 'video').length;
  const toCheck = used2.filter((e) => !e.seen).map((e) => ({ said: e.said, at: e.at_out, kind: e.media.kind, sheet: e.check ? resolve(ROOT, e.check) : null }));
  return { ok: true, moments: out.entries.length, placed: placed.length, ready, videos, photos: ready - videos, fetched, sources, problems, toCheck, lock: lockPath(plan), report: join(dir, 'BROLL.md'),
    ...(sources.includes('youtube') ? {} : { hint: 'yt-dlp is not installed, so YouTube was not searched (pip install yt-dlp)' }) };
}

function brollReport(plan, lock, sources, dry) {
  const rows = lock.entries.map((e, k) => {
    const pick = e.media ? `${e.media.source} ${e.media.kind} ${e.media.id}${e.media.dur ? `, ${e.media.dur} s` : ''}, ${e.media.w}x${e.media.h}` : '';
    const st = e.placed && e.media ? 'used' : e.placed ? 'placed, no media' : e.status === 'auto' || e.status === 'keep' ? 'not placed' : e.status;
    const looked = !(e.placed && e.media) ? '' : e.seen ? 'seen' : e.check ? `LOOK: ${e.check.split('/').pop()}` : 'LOOK';
    return `| ${k + 1} | ${fmt(e.at_out ?? 0)} | ${e.said.replace(/\|/g, '/')} | ${e.type} | ${(e.media?.query || e.query).replace(/\|/g, '/')} | ${pick} | ${st} | ${looked} | ${(e.media?.match_why || e.why || '').replace(/\|/g, '/')} |`;
  });
  return [`# Automatic B-roll: ${plan.title || plan.name}`, '',
    `Sources: ${sources.length ? sources.join(', ') : 'none'}${dry ? ' · dry run, nothing downloaded' : ''}.`,
    `Edit \`${relative(ROOT, lockPath(plan)).replace(/\\/g, '/')}\` to change a moment: \`"status": "drop"\` or \`"keep"\`, a new \`"query"\`, or \`"pick": 2\`; then run \`node longform.mjs broll\` again and rebuild.`, '',
    'Every pick passed the subject check (the name said is in its title, tags or description). **Look at each check sheet** in `broll-check/` (three frames of the seconds used): if it shows the right thing set `"seen": true` on that entry, if not `"pick": 2`, a new `"query"`, or `"status": "drop"`.', '',
    '| # | At | Said | Type | Search | Pick | Status | Checked | Why |', '|---|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n');
}
