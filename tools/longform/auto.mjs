// tools/longform/auto.mjs: the hands-off loop over a drop folder. Everything mechanical runs by itself; the two
// steps that need judgement (writing the brief, writing the plan) are queued for the editor, and nothing is posted.
//
//   footage/inbox/      drop raw recordings here (any video or audio file)
//   1. a file is picked up once its size has stopped changing between two runs (a copy in progress looks finished)
//   2. it is moved to footage/library/<yyyy-mm-dd>/ (the move is the lock), indexed, mapped (EDITMAP.md) and gets
//      a brief template in edits/longform/<clip>.brief.md
//   3. a plan whose brief is filled in and which changed since its last build is packaged (every format)
//   4. footage/QUEUE.md says what is waiting on whom
// Rules from docs/LESSONS.md ("Automating long recordings"). Run it on a schedule: node longform.mjs auto
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { ROOT, VIDEO_EXT, fmt } from './common.mjs';
import { IDX, index, libDir, loadLibrary } from './library.mjs';
import { analyze, briefTemplate, editmapMarkdown } from './editmap.mjs';
import { briefStatus } from './build.mjs';
import { packageAll } from './package.mjs';
import { loadPlan } from './plan.mjs';

const today = (d = new Date()) => d.toISOString().slice(0, 10);

export async function auto({ inbox = join(ROOT, 'footage', 'inbox'), plans = join(ROOT, 'edits', 'longform'), queueFile = join(ROOT, 'footage', 'QUEUE.md'), log = console.log, now = new Date(), build = true } = {}) {
  mkdirSync(inbox, { recursive: true });
  mkdirSync(plans, { recursive: true });
  const stateFile = join(inbox, '.sizes.json');
  const before = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
  const after = {}, taken = [], waiting = [];
  for (const name of readdirSync(inbox)) {
    if (name.startsWith('.') || !VIDEO_EXT.test(name)) continue;
    const size = statSync(join(inbox, name)).size;
    if (before[name] !== size || !size) { after[name] = size; waiting.push(name); continue; }   // still arriving, or first sighting
    const dest = join(libDir(), today(now));
    mkdirSync(dest, { recursive: true });
    renameSync(join(inbox, name), join(dest, name));
    taken.push(join(dest, name));
  }
  writeFileSync(stateFile, JSON.stringify(after));

  const mapped = [];
  for (const file of taken) {
    log(`new recording: ${relative(ROOT, file)}`);
    await index(file, { log });
    const clip = Object.values(loadLibrary().clips).find((c) => c.file === file);
    if (!clip?.sentences.length) { log(`  no transcript for ${basename(file)}: check faster-whisper (node longform.mjs doctor)`); continue; }
    const m = analyze(clip);
    writeFileSync(join(IDX(), `${clip.id}.EDITMAP.md`), editmapMarkdown(m));
    writeFileSync(join(IDX(), `${clip.id}.editmap.json`), JSON.stringify(m, null, 2) + '\n');
    const brief = join(plans, `${clip.id}.brief.md`);
    if (!existsSync(brief)) writeFileSync(brief, briefTemplate(m, clip.id));
    mapped.push({ clip: clip.id, raw: m.duration, keepable: m.stats.keepable, hooks: m.hooks.length, shorts: m.shorts.length });
  }

  // Plans: package the ones that are ready and changed since their last package.
  const needBrief = [], needPlan = [], packaged = [], failed = [];
  for (const f of readdirSync(plans).filter((x) => x.endsWith('.brief.md'))) {
    const name = f.replace(/\.brief\.md$/, ''), planFile = join(plans, `${name}.json`);
    const idea = (readFileSync(join(plans, f), 'utf8').split(/^## The one idea\s*$/m)[1] || '').split(/^## /m)[0].replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!idea) { needBrief.push(name); continue; }
    if (!existsSync(planFile)) { needPlan.push(name); continue; }
    let plan;
    try { plan = loadPlan(planFile); } catch (e) { failed.push({ name, errors: [`plan does not load: ${e.message}`] }); continue; }
    const pkg = join(ROOT, 'out', 'longform', plan.name, 'PACKAGE.md');
    const changed = !existsSync(pkg) || statSync(pkg).mtimeMs < Math.max(statSync(planFile).mtimeMs, statSync(join(plans, f)).mtimeMs);
    if (!changed || !build) continue;
    log(`packaging ${name}`);
    let r;
    try { r = await packageAll(planFile, { log }); } catch (e) { r = { ok: false, errors: [String(e.message || e).split('\n')[0]] }; }
    (r.ok ? packaged : failed).push(r.ok ? { name, package: r.package, missing: r.missing } : { name, errors: r.errors });
  }

  const L = ['# Queue', '', `Updated ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC by \`node longform.mjs auto\`. Nothing here is posted.`, ''];
  L.push('## Waiting for the editor: write the brief (docs/EDITORIAL.md)', '', ...(needBrief.length ? needBrief.map((n) => `- \`edits/longform/${n}.brief.md\` (edit map: \`${relative(ROOT, join(IDX(), n + '.EDITMAP.md'))}\`)`) : ['- nothing']), '');
  L.push('## Waiting for the editor: write the plan from the brief', '', ...(needPlan.length ? needPlan.map((n) => `- \`edits/longform/${n}.json\``) : ['- nothing']), '');
  L.push('## Ready for review', '', ...(packaged.length ? packaged.map((p) => `- ${p.name}: \`${relative(ROOT, p.package)}\`${p.missing.length ? ` (${p.missing.length} thing(s) before posting)` : ''}`) : ['- nothing new this run']), '');
  if (failed.length) L.push('## Failed', '', ...failed.map((f) => `- ${f.name}: ${(f.errors || []).join('; ')}`), '');
  if (waiting.length) L.push('## Still arriving (picked up next run once the size holds still)', '', ...waiting.map((w) => `- ${w}`), '');
  const queue = queueFile;
  writeFileSync(queue, L.join('\n'));
  log(`queue -> ${relative(ROOT, queue)}: ${mapped.length} new, ${needBrief.length} brief(s) to write, ${needPlan.length} plan(s) to write, ${packaged.length} packaged${failed.length ? `, ${failed.length} failed` : ''}`);
  return { ok: !failed.length, queue, mapped, needBrief, needPlan, packaged, failed, waiting };
}
