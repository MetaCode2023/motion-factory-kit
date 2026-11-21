// tools/broll/index.mjs: automatic B-roll for a long-form plan. When the speaker names something you can
// picture ("China", "a casino", "Wall Street"), cut to a 1.5-3 s stock clip or photo of it while the voice
// carries on.
//
//   node longform.mjs broll edits/longform/x.json [--dry] [--offline]
//
// 1. Reads the plan's words on the finished timeline and finds the moments (find.mjs).
// 2. Places them in the gaps between the plan's own visuals (place.mjs).
// 3. Searches free-license sources with no key (Openverse, Wikimedia Commons), plus Pixabay/Pexels if a key is set (sources.mjs).
// 4. Downloads each pick once into assets/broll/stock/ and records it in edits/longform/<name>.broll.lock.json.
// 5. Writes out/longform/<name>/BROLL.md: every moment, what was picked, and why others were skipped.
//
// The lockfile is the edit surface. Per entry: "status": "drop" (never use) or "keep" (use even if the finder
// was unsure), a new "query" (searched again on the next run), "pick": 2 (the second-best result). Rebuilds
// use the locked pick, so the video doesn't change when the stock sites reorder their results.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ROOT, bare, fmt } from '../longform/common.mjs';
import { findMoments } from './find.mjs';
import { PLACE, placeBroll } from './place.mjs';
import { DEFAULT_SOURCES, available, download, rank, search, tryOrder } from './sources.mjs';

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
  return {
    ...PLACE, ...pickKeys(a, Object.keys(PLACE)),
    sources: a.sources || DEFAULT_SOURCES,
    types: a.types, skip: a.skip || [], force: a.force || [],
    layout: a.layout || 'full', repeat: a.repeat ?? 60, portrait: !!a.portrait,
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
  const { placed } = placeBroll(moments, inserts, total, opts);
  return {
    warnings,
    inserts: placed.map((m, k) => {
      const kind = m.media.kind === 'video' ? 'broll' : 'image';
      const from = kind === 'broll' ? Math.max(0, Math.min(m.media.from ?? 0.5, (m.media.dur || 0) - m.dur - 0.1)) : 0;
      return {
        i: 1000 + k, where: `auto B-roll "${m.said}"`, auto: false, id: `broll-${String(k + 1).padStart(2, '0')}-${bare(m.key).slice(0, 16) || 'shot'}`,
        kind, at: +m.at.toFixed(3), dur: m.dur, layout: opts.layout, sfx: null, note: `${m.said}: ${m.media.query}`,
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
export async function autoBroll(plan, R, { dry = false, offline = false, env = process.env, fetchImpl = fetch, log = console.log, stockDir = STOCK_DIR(), cacheDir = CACHE_DIR(), outDir = join(ROOT, 'out', 'longform', plan.name), pause = 1500 } = {}) {
  const opts = settings(plan);
  if (!opts) return { ok: true, off: true, note: 'auto_broll is false in this plan' };
  const sources = available(opts.sources, env);
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
    for (const [src, kind, query] of queries.flatMap((q) => tryOrder(sources, e.type).map(([a, b]) => [a, b, q]))) {
      if (got) break;
      try {
        const results = rank(await search(src, kind, query, { portrait: opts.portrait, cacheDir, env, fetchImpl, offline }), { query, narration: e.sentence || e.said, need: p.dur, portrait: opts.portrait, used });
        const r = results[want.pick - 1];
        if (!r) continue;
        const file = offline ? join(stockDir, `${r.source}-${r.id}.${r.ext}`) : await download(r, stockDir, { fetchImpl });
        if (!existsSync(file)) continue;
        if (r.source === 'commons' && !offline && pause) await new Promise((ok) => setTimeout(ok, pause));   // Commons rate-limits quickly
        got = { source: r.source, via: r.via, title: r.title || '', id: r.id, kind: r.kind, file: relative(ROOT, file).replace(/\\/g, '/'), w: r.w, h: r.h, dur: r.dur, from: r.kind === 'video' ? Math.min(0.5, Math.max(0, r.dur - p.dur - 0.1)) : 0, page: r.page, author: r.author, license: r.license, query: want.query, found_with: query, pick: want.pick, relevance_score: r.relevance_score, relevance_reason: r.relevance_reason };
      } catch (err) { problems.push(`${e.said}: ${src} ${kind}: ${err.message}`); }
    }
    if (got) { e.media = got; used.add(`${got.source}-${got.id}`); fetched++; log(`  ${fmt(p.at)}  "${e.said}" -> ${got.source} ${got.kind} ${got.id} (${want.query})`); }
    else { e.why = `nothing usable for "${want.query}"`; log(`  ${fmt(p.at)}  "${e.said}": nothing usable for "${want.query}"`); }
  }

  const out = { version: 1, plan: relative(ROOT, plan._file).replace(/\\/g, '/'), sources, entries: entries.map(({ ref, ...e }) => e).sort((a, b) => (a.at_out ?? 0) - (b.at_out ?? 0)) };
  writeFileSync(lockPath(plan), JSON.stringify(out, null, 2));
  const dir = outDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'BROLL.md'), brollReport(plan, out, sources, dry));
  const ready = out.entries.filter((e) => e.placed && e.media).length;
  return { ok: true, moments: out.entries.length, placed: placed.length, ready, fetched, sources, problems, lock: lockPath(plan), report: join(dir, 'BROLL.md'),
  };
}

function brollReport(plan, lock, sources, dry) {
  const rows = lock.entries.map((e, k) => {
    const pick = e.media ? `${e.media.source} ${e.media.kind} ${e.media.id}${e.media.dur ? `, ${e.media.dur} s` : ''}, ${e.media.w}x${e.media.h}` : '';
    const st = e.placed && e.media ? 'used' : e.placed ? 'placed, no media' : e.status === 'auto' || e.status === 'keep' ? 'not placed' : e.status;
    const relevance = e.media ? `${Math.round((e.media.relevance_score || 0) * 100)}% — ${e.media.relevance_reason || 'not scored'}` : '';
    return `| ${k + 1} | ${fmt(e.at_out ?? 0)} | ${e.said.replace(/\|/g, '/')} | ${e.type} | ${(e.media?.query || e.query).replace(/\|/g, '/')} | ${pick} | ${relevance.replace(/\|/g, '/')} | ${st} | ${(e.why || '').replace(/\|/g, '/')} |`;
  });
  return [`# Automatic B-roll: ${plan.title || plan.name}`, '',
    `Sources: ${sources.length ? sources.join(', ') : 'none'}${dry ? ' · dry run, nothing downloaded' : ''}.`,
    `Edit \`${relative(ROOT, lockPath(plan)).replace(/\\/g, '/')}\` to change a moment: \`"status": "drop"\` or \`"keep"\`, a new \`"query"\`, or \`"pick": 2\`; then run \`node longform.mjs broll\` again and rebuild.`, '',
    'Rows stay in narration order. Picks are ranked by relevance before size/source tie-breakers.',
    process.env.BROLL_RELEVANCE_CMD ? `Local scorer: \`${process.env.BROLL_RELEVANCE_CMD}\`.` : 'Relevance uses the transparent metadata fallback. Set `BROLL_RELEVANCE_CMD` to a local OpenCLIP/SigLIP JSON-lines scorer for image-text scores.', '',
    '| # | At | Said | Type | Search | Pick | Relevance | Status | Why |', '|---|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n');
}
