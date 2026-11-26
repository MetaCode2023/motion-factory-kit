// tools/longform/package.mjs: one plan in, every format out. Builds the long-form video, then the vertical Shorts
// (the plan's own "shorts", else the stand-alone stretches the edit map found, mapped onto the finished video),
// the thumbnails, and PACKAGE.md: every file, the titles and description to paste, chapters, credits, the editor's
// critique score, and what is still missing before it can be posted.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, fmt } from './common.mjs';
import { build, briefStatus, check } from './build.mjs';
import { analyze } from './editmap.mjs';
import { shorts, thumbnails } from './extras.mjs';
import { loadPlan, mapTime, resolvePlan } from './plan.mjs';

// Short candidates from the edit map, on the finished timeline. Each must survive the cut as one piece of 20-60 s.
export function shortsFromMap(plan, R) {
  const out = [];
  for (const id of [...new Set(R.cuts.map((c) => c.clip))]) {
    const clip = R.lib.clips[id];
    if (!clip?.sentences?.length) continue;
    for (const s of analyze(clip).shorts) {
      const from = mapTime(R.cuts, id, s.s), to = mapTime(R.cuts, id, s.e);
      if (from == null || to == null || to - from < 20 || to - from > 60) continue;
      const words = s.opens.split(/\s+/).filter((w) => !/^(um+|uh+|erm|uhm)[,.]?$/i.test(w)).join(' ').replace(/^((so|okay|ok|alright|well|now)[,.]?\s+)+/i, '').replace(/^./, (c) => c.toUpperCase()).split(/\s+/);
      out.push({ from: Math.max(0, from - 0.1), to: Math.min(R.total, to + 0.25), title: words.slice(0, 7).join(' ').replace(/[,.;:]$/, '') + (words.length > 7 ? '...' : ''), source: `${id}#${s.from}-#${s.to}` });
    }
  }
  return out.sort((a, b) => a.from - b.from).filter((x, i, a) => !a.slice(0, i).some((y) => x.from < y.to && y.from < x.to)).slice(0, 5);
}

export async function packageAll(planFile, { log = console.log, skipBuild = false } = {}) {
  const chk = check(planFile);
  if (!chk.ok) return { ok: false, errors: chk.errors };
  const plan = loadPlan(planFile);
  const built = skipBuild ? { ok: true, dir: join(ROOT, 'out', 'longform', plan.name), video: join(ROOT, 'out', 'longform', plan.name, `${plan.name}.mp4`) } : await build(planFile, { log });
  if (!built.ok) return built;
  const R = resolvePlan(plan);
  const planned = (plan.shorts || []).length ? null : shortsFromMap(plan, R);
  if (planned) log(`  shorts from the edit map: ${planned.map((s) => `${fmt(s.from)}-${fmt(s.to)} (${s.source})`).join(', ') || 'none found; one per chapter instead'}`);
  const sh = await shorts(planFile, { log, list: planned && planned.length ? planned : null });
  let th = { files: [] };
  try { th = thumbnails(planFile, { log }); } catch (e) { log(`  thumbnails skipped: ${e.message.split('\n')[0]}`); }
  const dir = built.dir, rel = (f) => relative(dir, f);
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').trim() : '');
  const crit = read('CRITIQUE.md').match(/Editor score (\d+)/)?.[1];
  const brief = briefStatus(planFile, plan);
  const missing = [];
  if (read('PULL-LIST.md')) missing.push('outside clips still to pull (PULL-LIST.md)');
  if (!plan.thumbnail && !plan.thumbnails) missing.push('thumbnail text: the thumbnails use the title; set "thumbnail": { text, accent, prop } (2-4 words)');
  if (brief.warning) missing.push(brief.warning);
  if (chk.warnings.length) missing.push(`${chk.warnings.length} check warning(s): node longform.mjs check ${relative(ROOT, planFile)}`);
  const L = [`# Package: ${plan.title || plan.name}`, '',
    `Long-form 16:9: \`${rel(built.video)}\` (${fmt(R.total)})${crit ? `, editor score ${crit}/100 (CRITIQUE.md)` : ''}`, '',
    '## Vertical Shorts', '', ...(sh.ok ? sh.files.map((f) => `- \`${rel(f.file)}\` ${fmt(f.from)}-${fmt(f.to)}: ${f.title}`) : [`- not made: ${(sh.errors || []).join('; ')}`]), '',
    '## Thumbnails', '', ...(th.files.length ? th.files.map((f) => `- \`${rel(f)}\``) : ['- none']), '',
    '## For the upload', '', `Title: ${plan.title || plan.name}`, '', 'Chapters (paste into the description):', '', '```', read('CHAPTERS.txt') || '(no chapters)', '```', '',
    ...(read('CREDITS.md') ? ['Credits:', '', read('CREDITS.md').split('\n').filter((l) => l.startsWith('- ')).join('\n'), ''] : []),
    'Captions: upload the `.srt`.', '',
    '## Before it can be posted', '', ...(missing.length ? missing.map((m) => `- ${m}`) : ['- nothing flagged']), '',
    'Posting is the owner\'s call: nothing here is uploaded or scheduled.'];
  const file = join(dir, 'PACKAGE.md');
  writeFileSync(file, L.join('\n') + '\n');
  log(`package -> ${relative(ROOT, file)}`);
  return { ok: true, package: file, video: built.video, shorts: sh.ok ? sh.files : [], thumbnails: th.files, missing };
}
