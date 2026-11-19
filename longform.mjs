#!/usr/bin/env node
// longform.mjs: the long-form YouTube editor (16:9, 5-20 minutes, a person talking).
//
//   Script first (new recordings):
//   node longform.mjs script x.script.md          # check the script (runtime, a visual every ~15 s) + teleprompter copy
//   node longform.mjs from-script x.script.md rec.mp4 [--build]   # align the recording, write the plan, build
//
//   From existing footage (raw recordings are raw material: map them, decide, then plan):
//   node longform.mjs index [footage/library]     # transcribe + index every video once (new files only)
//   node longform.mjs analyze <id|file> [--name x] # edit map (sections, repeats, fluff, hooks, Shorts, terms) + brief to fill in
//   node longform.mjs takes                       # points made in several recordings, best take first (TAKES.md)
//   node longform.mjs search "bluffing"           # moments across the whole archive, ranked
//   node longform.mjs clip <id>                   # one clip's numbered sentences (path to its .md)
//   node longform.mjs words <id> [#n]             # word timings (for exact anchors and cutting false starts)
//   node longform.mjs check edits/longform/x.json # resolve the plan, list every problem, show the timeline
//   node longform.mjs broll edits/longform/x.json # automatic B-roll: validated video (then photos) of the things named, reusable sources only
//   node longform.mjs stock edits/longform/x.json # download free stock B-roll for "stock" inserts (PEXELS_API_KEY)
//   node longform.mjs package edits/longform/x.json # build + vertical Shorts + thumbnails + PACKAGE.md (every format)
//   node longform.mjs build edits/longform/x.json # preview MP4 + Premiere XML + captions + chapters + report
//   node longform.mjs demo [podcast]              # the whole thing on bundled stand-in footage, no keys
//   node longform.mjs pull <plan>                 # fetch pulls that have a url + from/to (needs yt-dlp)
//   node longform.mjs export <plan> [--edl] [--xml] [--df]   # the cut as <name>.cut.xml (xmeml) and <name>.cut.edl for another editor
//   node longform.mjs import <plan> <cut.xml|cut.edl>        # a cut trimmed elsewhere -> <plan>.imported.json (docs/INTERCHANGE.md)
//
//   Around the video:
//   node longform.mjs doctor                      # is this machine set up? what's missing and how to fix it
//   node longform.mjs feedback x.review.json      # notes from out/longform/<name>/review.html -> FEEDBACK.md
//   node longform.mjs thumbnail <plan>            # three 1280x720 thumbnails
//   node longform.mjs shorts <plan>               # vertical shorts cut from the finished video
//
// Add --json for a machine-readable last line. Details: docs/LONGFORM.md.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { ROOT, fmt } from './tools/longform/common.mjs';
import { IDX, index, libDir, loadLibrary, search } from './tools/longform/library.mjs';
import { build, check, remix } from './tools/longform/build.mjs';
import { pull, stock } from './tools/longform/stock.mjs';
import { autoBroll } from './tools/broll/index.mjs';
import { loadPlan, resolveAt, resolvePlan } from './tools/longform/plan.mjs';
import { doctor, feedback, shorts, thumbnails, voicePace, voiceProfile } from './tools/longform/extras.mjs';
import { analyze, briefTemplate, crossTakes, editmapMarkdown, takesMarkdown } from './tools/longform/editmap.mjs';
import { depthMarkdown, depthWorklist } from './tools/longform/critique.mjs';
import { auto } from './tools/longform/auto.mjs';
import { packageAll } from './tools/longform/package.mjs';
import { edlExport } from './tools/longform/edl.mjs';
import { importPlan } from './tools/longform/interchange.mjs';
import { premiereXML } from './tools/longform/premiere.mjs';
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
  } else if (cmd === 'analyze') {
    // node longform.mjs analyze <clip id | recording> [--name x]: read raw footage like an editor before planning.
    // Writes <id>.EDITMAP.md (+ .editmap.json) next to the index and edits/longform/<name>.brief.md (never overwritten).
    if (!args[0]) throw new Error('usage: node longform.mjs analyze <clip id | recording file> [--name <video name>]');
    let lib = loadLibrary(), c = lib.clips[args[0]];
    if (!c && existsSync(args[0])) { await index(resolve(args[0]), { log }); lib = loadLibrary(); c = Object.values(lib.clips).find((x) => x.file === resolve(args[0])); }
    if (!c) throw new Error(`unknown clip "${args[0]}" (index it first, or pass the file). Clips: ${Object.keys(lib.clips).join(', ') || 'none'}`);
    if (!c.sentences.length) throw new Error(`${c.id} has no transcript (pip install faster-whisper, or put a .srt / .words.json next to it)`);
    const m = analyze(c), name = opt('name', c.id);
    const md = join(IDX(), `${c.id}.EDITMAP.md`);
    writeFileSync(md, editmapMarkdown(m));
    writeFileSync(join(IDX(), `${c.id}.editmap.json`), JSON.stringify(m, null, 2) + '\n');
    const bdir = join(ROOT, 'edits', 'longform'), brief = join(bdir, `${name}.brief.md`);
    mkdirSync(bdir, { recursive: true });
    const fresh = !existsSync(brief);
    if (fresh) writeFileSync(brief, briefTemplate(m, name));
    if (!json) {
      console.log(`${c.id}: raw ${fmt(m.duration)}, ${m.sections.length} sections, ${m.repeats.length} repeated points, ${m.falseStarts.length} false starts, ${m.fluff.length} fluff lines, ${m.hooks.length} hook candidates, ${m.shorts.length} Short candidates`);
      console.log(`  ~${fmt(m.stats.keepable)} survives a clean tighten (the ceiling, not the target)`);
      m.hooks.slice(0, 3).forEach((h) => console.log(`  hook  ${c.id}#${h.n}  "${h.text.slice(0, 90)}"`));
      const undefinedTerms = m.terms.filter((t) => !t.defined).map((t) => t.term);
      if (undefinedTerms.length) console.log(`  never defined: ${undefinedTerms.join(', ')}`);
      console.log(`edit map -> ${relative(ROOT, md)}`);
      console.log(`brief    -> ${relative(ROOT, brief)}${fresh ? ' (new: fill it in before writing the plan, docs/EDITORIAL.md)' : ' (kept: already exists)'}`);
    }
    emit({ ok: true, clip: c.id, editmap: md, brief, ...m });
  } else if (cmd === 'takes') {
    // node longform.mjs takes: points made in more than one recording, best take first -> .index/TAKES.md
    const groups = crossTakes(loadLibrary());
    const file = join(IDX(), 'TAKES.md');
    mkdirSync(IDX(), { recursive: true });
    writeFileSync(file, takesMarkdown(groups));
    if (!json) { console.log(`${groups.length} point(s) made in more than one recording -> ${relative(ROOT, file)}`); groups.slice(0, 8).forEach((g) => console.log(`  ${g.idea}: best ${g.best} (of ${g.takes.length})`)); }
    emit({ ok: true, file, groups });
  } else if (cmd === 'depth') {
    // node longform.mjs depth <plan>: terms to explain, figures to source, pickups -> edits/longform/<name>.DEPTH.md
    const plan = loadPlan(args[0]), R = resolvePlan(plan);
    if (R.errors.length) throw new Error(R.errors.join('\n'));
    const d = depthWorklist(plan, R), file = resolve(args[0]).replace(/\.json$/, '.DEPTH.md');
    writeFileSync(file, depthMarkdown(plan.name, d));
    if (!json) console.log(`${d.terms.length} term(s) to explain, ${d.figures.length} figure(s) to source -> ${relative(ROOT, file)}`);
    emit({ ok: true, file, ...d });
  } else if (cmd === 'auto') {
    // node longform.mjs auto [--no-build]: drop folder -> index, map, brief template; ready plans -> package; QUEUE.md
    emit(await auto({ log, build: !rest.includes('--no-build') }));
  } else if (cmd === 'package') {
    // node longform.mjs package <plan> [--no-build]: the long video, vertical Shorts, thumbnails and PACKAGE.md in one run.
    const r = await packageAll(args[0], { log, skipBuild: rest.includes('--no-build') });
    if (!r.ok) { (r.errors || []).forEach((e) => console.log('ERROR  ' + e)); process.exitCode = 1; }
    else if (!json) r.missing.forEach((m) => console.log('  still to do: ' + m));
    emit(r);
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
      if (r.editor?.notes.length) { console.log(`editor ${r.editor.score}/100 (docs/EDITORIAL.md):`); r.editor.notes.forEach((n) => console.log(`  ${n.kind.padEnd(8)} ${n.t != null ? fmt(n.t) + '  ' : ''}${n.text}\n           -> ${n.fix}`)); }
      if (r.ok) { console.log(`OK: ${fmt(r.duration)} (from ${fmt(r.source)} of talking, ${r.pieces} pieces)`); r.timeline.forEach((l) => console.log('  ' + l)); r.chapters.forEach((l) => console.log('  ' + l)); }
    }
    emit(r);
    if (!r.ok) process.exitCode = 1;
  } else if (cmd === 'script') {
    // Check a script and write the reading copy (cues stripped) for the teleprompter.
    const file = args[0], text = readFileSync(file, 'utf8');
    const r = lintScript(text, { wpm: opt('wpm') ? Number(opt('wpm')) : voicePace(file) });
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
      console.log(`retention ${r.retention.score}/100${r.retention.notes.length ? ':' : ' (nothing flagged)'}`);
      r.retention.notes.forEach((n) => console.log('  keep  ' + n));
      console.log(`depth ${r.depth.score}/100${r.depth.notes.length ? ':' : ' (nothing flagged)'}`);
      r.depth.notes.forEach((n) => console.log('  deep  ' + n));
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
  } else if (cmd === 'doctor') {
    // Is this machine ready? Every piece the editor needs, and the one-line fix for what's missing.
    const r = doctor();
    if (!json) {
      for (const x of r.rows) console.log(`${x.ok ? 'OK     ' : x.need ? 'MISSING' : 'optional'}  ${x.name.padEnd(18)} ${x.detail}${x.fix ? `\n           -> ${x.fix}` : ''}`);
      console.log(r.ready ? '\nReady: you can write a script, record it and build the video.' : '\nNot ready yet: fix the MISSING lines above.');
    }
    emit(r);
    if (!r.ready) process.exitCode = 1;
  } else if (cmd === 'feedback') {
    // node longform.mjs feedback <name>.review.json [plan.json]: the reviewer's notes -> FEEDBACK.md
    const r = feedback(args[0], args[1]);
    if (!json) { console.log(`${r.notes.length} note(s), ${r.approved ? 'approved once done' : 'not approved yet'} -> ${relative(ROOT, r.file)}`); r.notes.forEach((n) => console.log(`  ${fmt(n.t)}  ${n.insert ? n.insert.id : '(speaker)'}  ${n.text.split('\n')[0].slice(0, 80)}`)); }
    emit(r);
  } else if (cmd === 'voice') {
    // node longform.mjs voice [clip ids…]: how the creator actually talks, measured from their own recordings
    const r = voiceProfile(args.filter((a) => a !== opt('out')), { out: opt('out') });
    if (!json) console.log(`${r.clips.length} recording(s), ${r.words} words: ${r.wpm} words a minute, sentences ~${r.sentence} words -> ${relative(ROOT, r.file)}`);
    emit(r);
  } else if (cmd === 'thumbnail') {
    emit(thumbnails(args[0], { log }));
  } else if (cmd === 'shorts') {
    const r = await shorts(args[0], { log });
    if (!r.ok && !json) r.errors.forEach((e) => console.log('ERROR  ' + e));
    emit(r);
    if (!r.ok) process.exitCode = 1;
  } else if (cmd === 'remix') {
    // node longform.mjs remix <plan> --no-voice : the built video with music + effects only
    const r = await remix(args[0], { voice: !rest.includes('--no-voice'), log });
    if (!r.ok && !json) r.errors.forEach((e) => console.log('ERROR  ' + e));
    emit(r);
  } else if (cmd === 'broll') {
    // Automatic B-roll: find the things named, place them in the gaps, fetch free-license media, lock the picks.
    const plan = loadPlan(args[0]);
    const R = resolvePlan(plan, undefined, { autoBroll: false });
    if (R.errors.length) throw new Error(`fix the plan first:\n  ${R.errors.join('\n  ')}`);
    R.resolveAt = (f) => { try { return resolveAt(f, R.cuts, R.lib, 'auto_broll.force'); } catch { return null; } };
    const r = await autoBroll(plan, R, { dry: rest.includes('--dry'), offline: rest.includes('--offline'), log });
    if (!json) {
      if (r.off) console.log(r.note);
      else {
        console.log(`${r.moments} moments, ${r.placed} placed, ${r.ready} with media: ${r.videos} video, ${r.photos} photo (${r.fetched} new) from ${r.sources.join(', ') || 'no source'}\n-> ${relative(ROOT, r.report)}\n-> ${relative(ROOT, r.lock)}`);
        if (r.hint) console.log('  note: ' + r.hint);
        if (r.toCheck.length) console.log(`  look at ${r.toCheck.length} check sheet(s) in ${relative(ROOT, join(dirname(r.report), 'broll-check'))} and set "seen": true on the right ones`);
      }
      (r.problems || []).slice(0, 12).forEach((p) => console.log('  ! ' + p));
    }
    emit(r);
  } else if (cmd === 'stock' || cmd === 'pull') {
    const r = await (cmd === 'stock' ? stock : pull)(args[0], { log });
    if (!json) (r.skipped || []).forEach((f) => console.log('skipped ' + f));
    if (!json) { if (r.error) console.log('error: ' + r.error); (r.failed || []).forEach((f) => console.log('failed ' + f)); }
    emit(r);
    if (!r.ok) process.exitCode = 1;
  } else if (cmd === 'export') {
    // node longform.mjs export <plan> [--edl] [--xml] [--df]: the A-roll cut for another editor. Never touches the build's own files.
    if (!args[0]) throw new Error('usage: node longform.mjs export <plan.json> [--edl] [--xml] [--df]');
    const plan = loadPlan(args[0]), R = resolvePlan(plan);
    if (R.errors.length) throw new Error(`fix the plan first:\n  ${R.errors.join('\n  ')}`);
    const dir = join(ROOT, 'out', 'longform', plan.name), files = [];
    mkdirSync(dir, { recursive: true });
    const wantEdl = rest.includes('--edl') || !rest.includes('--xml'), wantXml = rest.includes('--xml') || !rest.includes('--edl');
    if (wantXml) { files.push(join(dir, `${plan.name}.cut.xml`)); writeFileSync(files[files.length - 1], premiereXML(R, plan)); }
    if (wantEdl) { files.push(join(dir, `${plan.name}.cut.edl`)); writeFileSync(files[files.length - 1], edlExport(R, plan, { df: rest.includes('--df') })); }
    if (!json) { files.forEach((f) => console.log('wrote ' + relative(ROOT, f))); R.warnings.forEach((w) => console.log('warn   ' + w)); }
    emit({ ok: true, files, warnings: R.warnings });
  } else if (cmd === 'import') {
    // node longform.mjs import <plan> <cut.xml|cut.edl>: read a cut trimmed in another editor into <plan>.imported.json.
    if (!args[0] || !args[1]) throw new Error('usage: node longform.mjs import <plan.json> <cut.xml|cut.edl>');
    const r = importPlan(args[0], args[1]);
    if (!json) {
      [...r.errors, ...(r.check?.errors || [])].forEach((e) => console.log('ERROR  ' + e));
      [...r.warnings, ...(r.check?.warnings || [])].forEach((w) => console.log('warn   ' + w));
      if (r.file) console.log(`${r.a_roll.length} pieces -> ${relative(ROOT, r.file)} (the plan itself is unchanged; check it, then build it)`);
    }
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
  node longform.mjs analyze <id|file>  edit map of raw footage + a brief to fill in (before any plan)
  node longform.mjs takes              the same point in several recordings, best take first
  node longform.mjs search "<topic>"   find moments across the archive
  node longform.mjs clip <id>          one clip's numbered sentences
  node longform.mjs words <id> [#n]    word timings of a clip or one sentence
  node longform.mjs check <plan.json>  validate a plan and show its timeline
  node longform.mjs broll <plan.json>  automatic B-roll: validated video (then photos) of the things named
  node longform.mjs stock <plan.json>  download stock B-roll for "stock" inserts (PEXELS_API_KEY)
  node longform.mjs depth <plan>       terms to explain, figures to source, pickup lines (DEPTH.md)
  node longform.mjs auto               drop folder (footage/inbox): map new recordings, package ready plans, QUEUE.md
  node longform.mjs package <plan>     every format in one run: video, Shorts, thumbnails, PACKAGE.md
  node longform.mjs build <plan.json>  build the video, Premiere XML, captions, chapters, report
  node longform.mjs pull <plan.json>   fetch pulls with a url + from/to (yt-dlp)
  node longform.mjs export <plan> [--edl] [--xml] [--df]   the cut for another editor (<name>.cut.xml, <name>.cut.edl)
  node longform.mjs import <plan> <cut.xml|cut.edl>        a cut trimmed elsewhere -> <plan>.imported.json
  node longform.mjs demo [podcast]     run it all on bundled stand-in footage
  node longform.mjs voice [clip ids]   measure how the creator talks -> scripts/VOICE.md
  node longform.mjs doctor             check this machine is set up
  node longform.mjs feedback <review.json>   reviewer's notes -> FEEDBACK.md
  node longform.mjs thumbnail <plan>   three thumbnails
  node longform.mjs shorts <plan>      vertical shorts from the finished video`;
}
