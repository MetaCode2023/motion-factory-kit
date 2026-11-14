#!/usr/bin/env node
// longform.mjs: the long-form YouTube editor (16:9, 5-20 minutes, a person talking).
//
//   Script first (new recordings):
//   node longform.mjs script x.script.md          # check the script (runtime, a visual every ~15 s) + teleprompter copy
//   node longform.mjs from-script x.script.md rec.mp4 [--build]   # align the recording, write the plan, build
//
//   From existing footage:
//   node longform.mjs index [footage/library]     # transcribe + index every video once (new files only)
//   node longform.mjs search "bluffing"           # moments across the whole archive, ranked
//   node longform.mjs clip <id>                   # one clip's numbered sentences (path to its .md)
//   node longform.mjs words <id> [#n]             # word timings (for exact anchors and cutting false starts)
//   node longform.mjs check edits/longform/x.json # resolve the plan, list every problem, show the timeline
//   node longform.mjs stock edits/longform/x.json # download free stock B-roll for "stock" inserts (PEXELS_API_KEY)
//   node longform.mjs build edits/longform/x.json # preview MP4 + Premiere XML + captions + chapters + report
//   node longform.mjs demo [podcast]              # the whole thing on bundled stand-in footage, no keys
//   node longform.mjs pull <plan>                 # fetch pulls that have a url + from/to (needs yt-dlp)
//
// Add --json for a machine-readable last line. Details: docs/LONGFORM.md.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { ROOT, fmt } from './tools/longform/common.mjs';
import { IDX, index, libDir, loadLibrary, search } from './tools/longform/library.mjs';
import { build, check } from './tools/longform/build.mjs';
import { pull, stock } from './tools/longform/stock.mjs';
import { lintScript, planFromScript, readingCopy, tryScenes } from './tools/longform/script.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const json = rest.includes('--json');
const args = rest.filter((a) => !a.startsWith('--'));
const opt = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
const emit = (o) => { if (json) console.log(JSON.stringify(o)); };
const log = json ? () => {} : console.log;

try {
  if (cmd === 'index') {
    emit(await index(args[0] || libDir(), { force: rest.includes('--force'), log }));
  } else if (cmd === 'search') {
    const q = args.filter((a) => a !== opt('limit')).join(' ');
    const hits = search(q, { limit: Number(opt('limit', 12)) });
    if (!json) {
      if (!hits.length) console.log('no matches (is the library indexed? node longform.mjs index)');
      for (const h of hits) console.log(`${h.anchor.padEnd(22)} ${fmt(h.start)}–${fmt(h.end)}  (${h.score})\n    ${h.text}\n`);
    }
    emit({ ok: true, query: q, hits });
  } else if (cmd === 'clip') {
    const lib = loadLibrary(), c = lib.clips[args[0]];
    if (!c) throw new Error(`unknown clip "${args[0]}". Clips: ${Object.keys(lib.clips).join(', ')}`);
    if (!json) { console.log(`${c.id}: ${fmt(c.duration)}, ${c.sentences.length} sentences -> ${relative(ROOT, join(IDX(), c.id + '.md'))}`); for (const s of c.sentences) console.log(`#${s.n} [${fmt(s.s)}] ${s.text}`); }
    emit({ ok: true, id: c.id, md: join(IDX(), c.id + '.md'), sheet: join(IDX(), c.id + '.sheet.jpg'), sentences: c.sentences.map(({ n, s, e, text }) => ({ n, s, e, text })) });
  } else if (cmd === 'words') {
    // node longform.mjs words <clip> [#n]: every word with its time (for tighten.cut and exact anchors)
    const lib = loadLibrary(), c = lib.clips[args[0]];
    if (!c) throw new Error(`unknown clip "${args[0]}"`);
    const s = args[1] ? c.sentences.find((x) => '#' + x.n === args[1] || String(x.n) === args[1]) : null;
    const words = s ? c.words.slice(s.from, s.to + 1) : c.words;
    if (!json) console.log(words.map((w) => `${w.s.toFixed(2)}  ${w.w}`).join('\n'));
    emit({ ok: true, words });
  } else if (cmd === 'check') {
    const r = check(args[0]);
    if (!json) {
      r.errors.forEach((e) => console.log('ERROR  ' + e));
      r.warnings.forEach((w) => console.log('warn   ' + w));
      if (r.ok) { console.log(`OK: ${fmt(r.duration)} (from ${fmt(r.source)} of talking, ${r.pieces} pieces)`); r.timeline.forEach((l) => console.log('  ' + l)); r.chapters.forEach((l) => console.log('  ' + l)); }
    }
    emit(r);
    if (!r.ok) process.exitCode = 1;
  } else if (cmd === 'script') {
    // Check a script and write the reading copy (cues stripped) for the teleprompter.
    const file = args[0], text = readFileSync(file, 'utf8');
    const r = lintScript(text, { wpm: opt('wpm') ? Number(opt('wpm')) : undefined });
    if (r.ok && !rest.includes('--fast')) { const errs = await tryScenes(text); r.errors.push(...errs); r.ok = !errs.length; }
    const read = file.replace(/\.script\.md$|\.md$/, '') + '.read.txt';
    writeFileSync(read, readingCopy(text));
    r.readingCopy = read;
    if (!json) {
      r.errors.forEach((e) => console.log('ERROR  ' + e));
      r.warnings.forEach((w) => console.log('warn   ' + w));
      console.log(`${r.title}: ${r.words} words, ~${fmt(r.runtime)} at ${r.pace} wpm, ${r.visuals} visuals (one every ~${r.every}s, longest gap ${r.longestGap}s)`);
      console.log('  cues: ' + Object.entries(r.cues).map(([k, n]) => `${k} ${n}`).join(', '));
      r.chapters.forEach((c) => console.log('  ' + c));
      console.log(`reading copy -> ${read}`);
    }
    emit(r);
    if (!r.ok) process.exitCode = 1;
  } else if (cmd === 'from-script') {
    // Script + its recording -> transcribe, align, write the plan (and build it with --build).
    const [scriptFile, rec] = args;
    if (!scriptFile || !rec) throw new Error('usage: node longform.mjs from-script <script.md> <recording> [--build]');
    const ix = await index(resolve(rec), { log });
    const lib = loadLibrary(), clip = Object.values(lib.clips).find((c) => c.file === resolve(rec));
    if (!clip?.words.length) throw new Error(`no transcript for ${rec} (pip install faster-whisper, or put ${basename(rec).replace(/\.[^.]+$/, '')}.srt next to it)`);
    const { plan, report } = planFromScript(readFileSync(scriptFile, 'utf8'), clip, { name: opt('name') });
    const out = resolve(opt('out', join(ROOT, 'edits', 'longform', `${plan.name}.json`)));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(plan, null, 2) + '\n');
    const chk = check(out);
    if (!json) {
      console.log(`aligned ${report.matched}/${report.scriptWords} script words (${Math.round(report.coverage * 100)}%)`);
      report.retakesCut.forEach((t) => console.log(`  retake cut: "${t}"`));
      report.adlibsKept.forEach((t) => console.log(`  ad-lib kept: ${t}`));
      report.missing.forEach((t) => console.log(`  not in the recording: "${t}"`));
      [...report.warnings, ...chk.warnings].forEach((w) => console.log('warn   ' + w));
      chk.errors.forEach((e) => console.log('ERROR  ' + e));
      if (chk.ok) { console.log(`plan -> ${relative(ROOT, out)}: ${fmt(chk.duration)}, ${chk.timeline.length} visuals`); chk.timeline.forEach((l) => console.log('  ' + l)); }
    }
    let built = null;
    if (chk.ok && rest.includes('--build')) built = await build(out, { log });
    emit({ ok: chk.ok && (!built || built.ok), plan: out, clip: clip.id, align: report, check: chk, build: built });
    if (!chk.ok) process.exitCode = 1;
  } else if (cmd === 'stock' || cmd === 'pull') {
    const r = await (cmd === 'stock' ? stock : pull)(args[0], { log });
    if (!json) (r.skipped || []).forEach((f) => console.log('skipped ' + f));
    if (!json) { if (r.error) console.log('error: ' + r.error); (r.failed || []).forEach((f) => console.log('failed ' + f)); }
    emit(r);
    if (!r.ok) process.exitCode = 1;
  } else if (cmd === 'build') {
    const r = await build(args[0], { log, previewOnly: rest.includes('--preview') });
    if (!r.ok && !json) r.errors.forEach((e) => console.log('ERROR  ' + e));
    emit(r);
    if (!r.ok) process.exitCode = 1;
  } else if (cmd === 'demo' && args[0] !== 'podcast') {
    // Script first: the example script + a stand-in voice-only take -> aligned plan -> finished video.
    process.env.LONGFORM_LIBRARY ||= join(ROOT, 'out', 'longform-demo-library');
    const script = join(ROOT, 'examples', 'longform', 'physics-of-poker.script.md');
    const take = join(ROOT, 'examples', 'longform', 'footage', 'poker-take1.m4a');
    await index(take, { log });
    const clip = Object.values(loadLibrary().clips).find((c) => c.file === take);
    const { plan, report } = planFromScript(readFileSync(script, 'utf8'), clip, { name: 'poker-script-demo' });
    const out = join(ROOT, 'out', 'longform-demo-plan.json');
    writeFileSync(out, JSON.stringify(plan, null, 2));
    log(`aligned ${report.matched}/${report.scriptWords} script words; retakes cut: ${report.retakesCut.length}`);
    const r = await build(out, { log });
    if (!r.ok) r.errors.forEach((e) => console.log('ERROR  ' + e));
    emit(r);
  } else if (cmd === 'demo') {
    // Existing podcast footage -> library -> the example plan -> finished outputs.
    const src = join(ROOT, 'examples', 'longform', 'footage');
    process.env.LONGFORM_LIBRARY ||= join(ROOT, 'out', 'longform-demo-library');
    const lib = process.env.LONGFORM_LIBRARY;
    mkdirSync(lib, { recursive: true });
    for (const f of readdirSync(src)) if (!existsSync(join(lib, f))) cpSync(join(src, f), join(lib, f));
    await index(lib, { log });
    const r = await build(join(ROOT, 'examples', 'longform', 'physics-of-poker.json'), { log });
    if (!r.ok) r.errors.forEach((e) => console.log('ERROR  ' + e));
    emit(r);
  } else {
    console.log(readmeUsage());
    process.exitCode = cmd ? 2 : 0;
  }
} catch (e) {
  if (json) console.log(JSON.stringify({ ok: false, error: e.message }));
  else console.error('error: ' + e.message);
  process.exitCode = 1;
}

function readmeUsage() {
  return `usage:
  node longform.mjs script <x.script.md>            check a script, write its reading copy
  node longform.mjs from-script <script> <recording> [--build]   recording -> plan (-> video)
  node longform.mjs index [dir]        index footage (default footage/library)
  node longform.mjs search "<topic>"   find moments across the archive
  node longform.mjs clip <id>          one clip's numbered sentences
  node longform.mjs words <id> [#n]    word timings of a clip or one sentence
  node longform.mjs check <plan.json>  validate a plan and show its timeline
  node longform.mjs stock <plan.json>  download stock B-roll for "stock" inserts (PEXELS_API_KEY)
  node longform.mjs build <plan.json>  build the video, Premiere XML, captions, chapters, report
  node longform.mjs pull <plan.json>   fetch pulls with a url + from/to (yt-dlp)
  node longform.mjs demo [podcast]     run it all on bundled stand-in footage`;
}
