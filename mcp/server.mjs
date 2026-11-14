#!/usr/bin/env node
// mcp/server.mjs: the kit as MCP tools, so any agent (Claude Code, Claude Desktop, Cursor, ...) can call
// it directly instead of reading docs and shelling out. stdio transport.
//
//   claude mcp add motion-factory -- node /path/to/motion-factory-kit/mcp/server.mjs
//
// Every tool returns JSON (the same objects the CLIs print with --json); render_still and look_at
// also return the picture, so the agent can see what it made. Long builds block until done.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPlan, loadIndex } from '../tools/plans.mjs';
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const FOOT = () => (process.env.FOOTAGE_DIR ? resolve(process.env.FOOTAGE_DIR) : join(ROOT, 'footage'));

// Paths from the agent are relative to the repo; nothing outside it is written.
const inRepo = (p) => { const a = isAbsolute(p) ? p : join(ROOT, p); const r = relative(ROOT, a); if (r.startsWith('..') || isAbsolute(r)) throw new Error(`path outside the kit: ${p}`); return a; };

// Run one of the CLIs with --json; resolve with its last JSON line (logs are kept for errors).
function cli(script, args, { timeoutMs = 60 * 60 * 1000 } = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(ROOT, script), ...args, '--json'], { cwd: ROOT, env: process.env });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = out.trim().split('\n').reverse().find((l) => l.startsWith('{'));
      let json = null;
      try { json = line ? JSON.parse(line) : null; } catch {}
      done(json ? { ...json, exit: code } : { ok: false, exit: code, error: 'no result', log: (out + '\n' + err).trim().split('\n').slice(-25).join('\n') });
    });
  });
}
// Run a Python tool (tools/overlay.py, tools/hook_alert.py) with --json; same contract as cli().
const PY = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0);
function py(script, args, { timeoutMs = 60 * 60 * 1000 } = {}) {
  if (!PY) return Promise.resolve({ ok: false, error: 'Python 3 not found. Install it, then: pip install pillow numpy fonttools brotli faster-whisper' });
  return new Promise((done) => {
    const child = spawn(PY, [join(ROOT, script), ...args, '--json'], { cwd: ROOT, env: { ...process.env, FFMPEG: process.env.FFMPEG || ffmpegPath } });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = out.trim().split('\n').reverse().find((l) => l.startsWith('{'));
      let json = null;
      try { json = line ? JSON.parse(line) : null; } catch {}
      done(json ? { ...json, exit: code } : { ok: false, exit: code, error: 'no result', log: (out + '\n' + err).trim().split('\n').slice(-25).join('\n') });
    });
  });
}

// Overlay cue sanity checks (docs/OVERLAYS.md): known kinds, required fields, order, spacing.
const CARD_KINDS = { stat: ['value'], list: ['items'], compare: ['left', 'right'], term: ['title'], split: ['total'], curve: [], pricedrop: ['items'], map: ['highlight', 'value'] };
function checkCues(cues, duration) {
  const errors = [], warnings = [];
  const cards = [...(cues.cards || [])].sort((a, b) => a.at - b.at);
  cards.forEach((c, i) => {
    const tag = `card ${i + 1} (${c.kind} @ ${c.at}s)`;
    if (!(c.kind in CARD_KINDS)) errors.push(`${tag}: unknown kind; use ${Object.keys(CARD_KINDS).join(', ')}`);
    else for (const f of CARD_KINDS[c.kind]) if (c[f] == null) errors.push(`${tag}: missing "${f}"`);
    if (typeof c.at !== 'number') errors.push(`${tag}: "at" must be seconds`);
    const dur = c.dur ?? 4.5;
    if (dur < 2.5 || dur > 9) warnings.push(`${tag}: ${dur}s on screen; 3.5-6 s reads best`);
    if (duration && c.at + dur > duration) errors.push(`${tag}: ends after the clip (${duration}s)`);
    const next = cards[i + 1];
    if (next && c.at + dur > next.at) errors.push(`${tag}: overlaps the next card`);
    else if (next && next.at - (c.at + dur) < 1.0) warnings.push(`${tag}: under 1 s before the next card`);
    for (const k of ['kicker', 'title', 'value']) if (typeof c[k] === 'string' && c[k].split(/\s+/).length > 7) warnings.push(`${tag}: "${k}" has more than 7 words`);
  });
  const ch = cues.chapters || [];
  if (ch.length && ch[0].at !== 0) warnings.push('first chapter should start at 0');
  return { ok: errors.length === 0, errors, warnings, cards: cards.length, chapters: ch.length };
}

const text = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 1) }] });
const picture = (file, extra = {}) => {
  const ext = extname(file).toLowerCase();
  return { content: [
    { type: 'image', data: readFileSync(file).toString('base64'), mimeType: ext === '.png' ? 'image/png' : 'image/jpeg' },
    { type: 'text', text: JSON.stringify({ file: relative(ROOT, file), ...extra }) },
  ] };
};

// The header comment of each template: what it is and its data keys.
function templates() {
  const dir = join(ROOT, 'scenes', 'templates');
  return readdirSync(dir).filter((f) => f.endsWith('.html')).sort().map((f) => {
    const src = readFileSync(join(dir, f), 'utf8');
    const body = src.split('<script>\n').pop();
    const comment = body.split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
    return { name: f.replace('.html', ''), file: `scenes/templates/${f}`, about: comment.trim() };
  });
}

const server = new McpServer({ name: 'motion-factory', version: VERSION });

server.registerTool('kit_overview', {
  title: 'What the kit can do',
  description: 'Start here. Lists the templates (with their data keys), blocks, caption styles, the footage-editor workflow and the docs to read. Read CLAUDE.md in the repo for the full rules.',
  inputSchema: {},
}, async () => text({
  root: ROOT, version: VERSION,
  workflow: {
    footage: ['footage_index (clips -> sentences, speakers, faces)', 'footage_check_plan / footage_write_plan (one plan per ad)', 'footage_build (ads + DELIVERY.csv + review.html)', 'review_feedback (client decisions -> FEEDBACK.md, approved/)', 'footage_build with redo (re-cut only flagged ads)'],
    scene: ['write a scene HTML (draw(ctx, t)) or copy a template', 'render_still to look at frames', 'make_video (MP4 + report + cuts image)', 'look_at the cuts image, fix, rebuild'],
    longform: ['ask the subject; write the script with the creator (longform_script: [[cues]] every ~15 s)', 'they record it; longform_from_script (align, plan, build)', 'longform_stock / longform_pull (fill placeholders), rebuild', 'or from existing footage: longform_index (hours of talking footage -> numbered sentences, topics)', 'longform_search (find moments by topic)', 'longform_write_plan (A-roll ranges, inserts anchored to words, chapters, music)', 'longform_build (MP4 + Premiere XML + captions + chapters + report; returns the contact sheet)'],
    overlays: ['overlay_transcribe (one finished clip -> timestamped lines)', 'overlay_write_cues (chapters + explainer cards)', 'overlay_render (progress bar + cards + SFX; returns the contact sheet)', 'hook_alert (optional 3 s cold open)', 'overlay_join (hook + clip)'],
  },
  templates: templates(),
  blocks: { ugc: ['nativeText', 'commentReply', 'productCard', 'review', 'stars', 'ctaButton', 'tap', 'split', 'pip', 'sticker', 'emojiBurst', 'postCard', 'browser'],
    street: ['questionCard', 'lowerThird', 'counter', 'tally'], creator: ['photoPanel', 'memeCard'],
    explainer: ['notification', 'chat', 'checklist', 'stat', 'compare', 'steps', 'bars', 'phone', 'toast', 'endCard'] },
  captionStyles: ['pill', 'bold', 'box', 'minimal', 'karaoke', 'pop', 'word'],
  overlayCards: Object.keys(CARD_KINDS),
  docs: ['CLAUDE.md', 'docs/LONGFORM.md', 'docs/OVERLAYS.md', 'docs/MODULES.md', 'docs/EDITOR.md', 'docs/TEMPLATES.md', 'docs/BLOCKS.md', 'design/DESIGN.md'],
  rules: ['Never invent quotes, names or poll numbers: use what people said and what the shoot counted.', 'All on-screen text is drawn in code.', 'Client footage and plans stay out of git.'],
}));

server.registerTool('footage_index', {
  title: 'Index raw footage',
  description: 'Transcribe and thumbnail every clip in a folder (default footage/raw). Returns each clip with numbered sentences (start/end seconds, speaker A/B when known), whether a face was found for auto-reframing, and its thumbnail strip path (use look_at to see it). Transcripts come from a .words.json/.srt next to the clip, ELEVENLABS_API_KEY, or local faster-whisper.',
  inputSchema: { folder: z.string().optional().describe('Folder of clips, relative to the kit (default footage/raw)') },
}, async ({ folder }) => text(await cli('footage.mjs', ['index', ...(folder ? [inRepo(folder)] : [])])));

server.registerTool('footage_check_plan', {
  title: 'Check an edit plan',
  description: 'Validate an edit plan against the footage index without cutting anything: unknown clips, missing sentence numbers, overlaps, length outside 6-60 s, overlay fields. Returns problems and the estimated length.',
  inputSchema: { plan: z.record(z.string(), z.any()).describe('The edit plan object (format: docs/EDITOR.md)') },
}, async ({ plan }) => text(checkPlan(plan, loadIndex(FOOT()))));

server.registerTool('footage_write_plan', {
  title: 'Write an edit plan',
  description: 'Check an edit plan and save it as <dir>/<name>.json (default edits/, git-ignored). Refuses plans with errors; warnings are returned.',
  inputSchema: { plan: z.record(z.string(), z.any()), dir: z.string().optional().describe('Folder for plans (default edits)') },
}, async ({ plan, dir }) => {
  const res = checkPlan(plan, loadIndex(FOOT()));
  if (!res.ok) return text({ ...res, written: null });
  const folder = inRepo(dir || 'edits');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `${plan.name}.json`);
  writeFileSync(file, JSON.stringify(plan, null, 2) + '\n');
  return text({ ...res, written: relative(ROOT, file) });
});

server.registerTool('footage_build', {
  title: 'Build ads from edit plans',
  description: 'Cut and finish every plan in a folder: word-exact A-roll, street-audio cleanup, face-following reframe, overlays, captions, music, every requested size. Writes out/<batch>/ with the MP4s, DELIVERY.csv and review.html. Use only to rebuild named ads, or redo with a review.json path to re-cut just the ads the client flagged. Can take minutes.',
  inputSchema: {
    plans: z.string().optional().describe('Folder of plans or one plan file (default edits)'),
    batch: z.string().optional().describe('Output folder name under out/'),
    only: z.array(z.string()).optional(), redo: z.string().optional().describe('Path to an exported review.json'),
    variants: z.boolean().optional().describe('One video per hook (default true)'),
    formats: z.array(z.enum(['4:5', '1:1', '16:9'])).optional(), fast: z.boolean().optional().describe('Skip the picture score (drafts)'),
  },
}, async ({ plans, batch, only, redo, variants = true, formats, fast }) => text(await cli('footage.mjs', ['build', inRepo(plans || 'edits'),
  ...(batch ? ['--batch', batch] : []), ...(only?.length ? ['--only', only.join(',')] : []), ...(redo ? ['--redo', inRepo(redo)] : []),
  ...(variants ? ['--variants'] : []), ...(formats?.length ? ['--formats', formats.join(',')] : []), ...(fast ? ['--fast'] : [])])));

server.registerTool('review_feedback', {
  title: 'Apply client feedback',
  description: 'Take the decisions a client exported from review.html (review.json, or the same object pasted in) and write FEEDBACK.md (what to change per ad), copy approved files to out/<batch>/approved/, and mark DELIVERY.csv. Returns the ads to re-cut; edit only those plans, then footage_build with redo.',
  inputSchema: { batch: z.string(), feedback: z.record(z.string(), z.any()).optional().describe('The review.json object'), file: z.string().optional().describe('Or a path to review.json') },
}, async ({ batch, feedback, file }) => {
  let f = file ? inRepo(file) : null;
  if (!f) {
    if (!feedback) return text({ ok: false, error: 'give feedback or file' });
    f = join(ROOT, 'out', batch, 'review.json');
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify({ batch, ...feedback }, null, 1));
  }
  const res = await cli('footage.mjs', ['feedback', f]);
  const md = join(ROOT, 'out', batch, 'FEEDBACK.md');
  return text({ ...res, feedbackText: existsSync(md) ? readFileSync(md, 'utf8') : null });
});

server.registerTool('review_page', {
  title: 'Write the review page',
  description: 'Write or refresh out/<batch>/review.html: the client approval page for a batch (approve / needs changes / notes per ad and hook).',
  inputSchema: { batch: z.string() },
}, async ({ batch }) => text(await cli('footage.mjs', ['review', inRepo(join('out', batch))])));

server.registerTool('make_video', {
  title: 'Build a video from a scene',
  description: 'Render a scene or template to a finished MP4 with narration, captions, music, effects and the self-check. Returns the files and every PASS/FIX check; look_at the cuts image before handing over. Can take minutes.',
  inputSchema: {
    scene: z.string().describe('Scene HTML, e.g. scenes/templates/rapid-list.html or scenes/mine/x.html'),
    data: z.record(z.string(), z.any()).optional().describe('Content for M.data() (a template row)'),
    name: z.string().optional(), outdir: z.string().optional(),
    variants: z.boolean().optional(), formats: z.array(z.enum(['4:5', '1:1', '16:9'])).optional(), fast: z.boolean().optional(),
  },
}, async ({ scene, data, name, outdir, variants, formats, fast }) => {
  let dataFile = null;
  if (data) { mkdirSync(join(ROOT, 'out', '.mcp'), { recursive: true }); dataFile = join(ROOT, 'out', '.mcp', `${name || 'data'}-${process.pid}.json`); writeFileSync(dataFile, JSON.stringify(data)); }
  return text(await cli('make.mjs', [inRepo(scene), ...(dataFile ? ['--data', dataFile] : []), ...(name ? ['--name', name] : []), ...(outdir ? ['--outdir', inRepo(outdir)] : []),
    ...(variants ? ['--variants'] : []), ...(formats?.length ? ['--formats', formats.join(',')] : []), ...(fast ? ['--fast'] : [])]));
});

server.registerTool('render_still', {
  title: 'Look at one frame',
  description: 'Render one frame of a scene at time t (seconds) and return the picture. Quick, silent, no captions. Use it while writing a scene.',
  inputSchema: { scene: z.string(), t: z.number(), data: z.record(z.string(), z.any()).optional() },
}, async ({ scene, t, data }) => {
  mkdirSync(join(ROOT, 'out', '.mcp'), { recursive: true });
  const out = join(ROOT, 'out', '.mcp', `still-${process.pid}-${Date.now()}.png`);
  let dataFile = null;
  if (data) { dataFile = out.replace('.png', '.json'); writeFileSync(dataFile, JSON.stringify(data)); }
  const res = await new Promise((done) => {
    const c = spawn(process.execPath, [join(ROOT, 'render.mjs'), inRepo(scene), '--still', String(t), '--out', out, ...(dataFile ? ['--data', dataFile] : [])], { cwd: ROOT });
    let err = ''; c.stderr.on('data', (d) => (err += d)); c.on('close', (code) => done({ code, err }));
  });
  return existsSync(out) ? picture(out, { t }) : text({ ok: false, error: res.err.slice(-1500) });
});

server.registerTool('look_at', {
  title: 'See an image',
  description: 'Return a PNG/JPG from the kit as a picture: a build\'s cuts image (out/<name>.cuts.png), a clip\'s thumbnail strip (footage/thumbs/<ID>.jpg), a cover.',
  inputSchema: { file: z.string() },
}, async ({ file }) => {
  const f = inRepo(file);
  if (!existsSync(f) || !/\.(png|jpe?g)$/i.test(f)) return text({ ok: false, error: 'not an image in the kit: ' + file });
  return picture(f);
});

server.registerTool('overlay_transcribe', {
  title: 'Transcribe one clip (for overlays)',
  description: 'Transcribe a finished clip (talking head, podcast cut, lesson) with local faster-whisper. Writes <clip>.words.json and returns timestamped lines: read them, pick the moments a graphic would explain faster (a number said out loud, a sequence of steps, a contrast, a term most viewers would not know), then overlay_write_cues. If faster-whisper is missing, the clip has burned-in captions, or the words are on a whiteboard, read frames with look_at instead.',
  inputSchema: { clip: z.string().describe('Clip inside the kit, e.g. footage/clips/talk.mp4'), model: z.string().optional().describe('Whisper model: base | small (default) | medium') },
}, async ({ clip, model }) => text(await py('tools/overlay.py', ['transcribe', inRepo(clip), ...(model ? ['--model', model] : [])])));

server.registerTool('overlay_write_cues', {
  title: 'Check and save overlay cues',
  description: 'Check a cue object (chapters for the progress bar + explainer cards) and save it as <clip>.cues.json. Card kinds: stat, list, compare, term (static) and split, curve, pricedrop, map (animated); fields in docs/OVERLAYS.md. Rules: cards start ~0.3 s after the speaker starts that idea, 3.5-6 s each, never overlapping, at most 7 words a line, and only figures the speaker says or shows. Refuses cues with errors; returns warnings.',
  inputSchema: { clip: z.string(), cues: z.record(z.string(), z.any()), duration: z.number().optional().describe('Clip length in seconds, to catch cards that run past the end') },
}, async ({ clip, cues, duration }) => {
  const res = checkCues(cues, duration);
  if (!res.ok) return text({ ...res, written: null });
  const f = inRepo(clip).replace(/\.[^.]+$/, '.cues.json');
  writeFileSync(f, JSON.stringify(cues, null, 2) + '\n');
  return text({ ...res, written: relative(ROOT, f) });
});

server.registerTool('overlay_render', {
  title: 'Render overlays onto a clip',
  description: 'Burn a chaptered progress bar (chapter name, playhead, elapsed/total) and the explainer cards from <clip>.cues.json onto the clip, keeping its audio. sfx mixes a quiet whoosh/beat stem under the voice. bar_y lifts the bar off the bottom (fraction of height, e.g. 0.63 to sit under a framed video window, 0.78 to clear burned-in captions). start cuts a weak opener first. Returns the result and the contact sheet as a picture: look at it, fix cues, re-render.',
  inputSchema: {
    clip: z.string(), cues: z.string().optional().describe('Cue file (default <clip>.cues.json)'), out: z.string().optional(),
    bar_y: z.number().min(0.2).max(1).optional(), sfx: z.boolean().optional().describe('Default true'), start: z.number().optional(),
  },
}, async ({ clip, cues, out, bar_y, sfx = true, start }) => {
  const res = await py('tools/overlay.py', ['render', inRepo(clip), ...(cues ? ['--cues', inRepo(cues)] : []), ...(out ? ['--out', inRepo(out)] : []),
    ...(bar_y ? ['--bar-y', String(bar_y)] : []), ...(sfx ? ['--sfx'] : []), ...(start ? ['--start', String(start)] : []), '--sheet']);
  return res.sheet && existsSync(res.sheet) ? picture(res.sheet, res) : text(res);
});

server.registerTool('hook_alert', {
  title: 'Build a 3-second alert hook',
  description: 'A cold open that plays before the speaker: headline on screen at frame 0, a heart monitor that flatlines, an alert panel that slams in and counts up a total, a stamp, then a punchline bar. Every text field comes from spec (docs/OVERLAYS.md; example examples/overlays/hook.json). Writes out/hooks/<name>/hook.mp4 plus SFX and drone stems. Use figures from the clip only. Then overlay_join it in front of the overlaid clip.',
  inputSchema: { name: z.string(), spec: z.record(z.string(), z.any()), fps: z.number().optional() },
}, async ({ name, spec, fps }) => {
  const dir = join(ROOT, 'out', 'hooks', name.replace(/[^\w-]/g, '-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec, null, 1));
  return text(await py('tools/hook_alert.py', [join(dir, 'spec.json'), dir, ...(fps ? ['--fps', String(fps)] : [])]));
});

server.registerTool('overlay_join', {
  title: 'Put a hook in front of a clip',
  description: 'Join a hook (or any intro) and a clip into one MP4 at the clip\'s size and frame rate. hook_gain (dB, default -3) keeps the hook\'s effects from jumping out over the voice.',
  inputSchema: { hook: z.string(), clip: z.string(), out: z.string(), hook_gain: z.number().optional() },
}, async ({ hook, clip, out, hook_gain }) => text(await py('tools/overlay.py', ['join', inRepo(hook), inRepo(clip), inRepo(out), ...(hook_gain != null ? ['--hook-gain', String(hook_gain)] : [])])));

// ---- long-form YouTube editor (longform.mjs, docs/LONGFORM.md) -------------------------------------
server.registerTool('longform_index', {
  title: 'Index the long-form footage library',
  description: 'Transcribe and index every video in the library folder (default footage/library; only new or changed files are processed). Returns clip count and hours. Then read footage/library/.index/LIBRARY.md (one row per clip with its topics) and <clip>.md (every sentence numbered, with times), and look_at <clip>.sheet.jpg to see what is in a clip.',
  inputSchema: { folder: z.string().optional().describe('Library folder, relative to the kit (default footage/library)'), force: z.boolean().optional() },
}, async ({ folder, force }) => text(await cli('longform.mjs', ['index', ...(folder ? [inRepo(folder)] : []), ...(force ? ['--force'] : [])])));

server.registerTool('longform_search', {
  title: 'Search everything that was said',
  description: 'Rank moments across the whole footage library by topic ("bluffing", "wave function collapse"). Each hit has an anchor (clip#sentence) you can put straight into a plan: a_roll ranges, insert "at", chapters. Search several phrasings; people rarely use the exact words.',
  inputSchema: { query: z.string(), limit: z.number().optional() },
}, async ({ query, limit }) => text(await cli('longform.mjs', ['search', query, ...(limit ? ['--limit', String(limit)] : [])])));

server.registerTool('longform_words', {
  title: 'Word timings of a clip or sentence',
  description: 'Every word with its start time, for one sentence (sentence: 12) or a whole clip. Use it to write tighten.cut entries for false starts and repeats, and to anchor an insert on an exact word.',
  inputSchema: { clip: z.string(), sentence: z.number().optional() },
}, async ({ clip, sentence }) => text(await cli('longform.mjs', ['words', clip, ...(sentence ? ['#' + sentence] : [])])));

server.registerTool('longform_write_plan', {
  title: 'Check and save a long-form plan',
  description: 'Resolve a long-form edit plan against the library and save it as edits/longform/<name>.json (git-ignored). Returns every problem at once (unknown anchors, words not found, overlapping inserts, missing scenes/files, chapter rules) plus the resolved timeline. Refuses plans with errors. Format: docs/LONGFORM.md.',
  inputSchema: { plan: z.record(z.string(), z.any()) },
}, async ({ plan }) => {
  const dir = join(ROOT, 'edits', 'longform');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${String(plan.name || 'untitled').replace(/[^\w-]/g, '-')}.json`);
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : null;
  writeFileSync(file, JSON.stringify(plan, null, 2) + '\n');
  const res = await cli('longform.mjs', ['check', file]);
  if (!res.ok) { if (prev != null) writeFileSync(file, prev); else rmSync(file, { force: true }); return text({ ...res, written: null }); }
  return text({ ...res, written: relative(ROOT, file) });
});

server.registerTool('longform_script', {
  title: 'Check a video script',
  description: 'Save (optional) and check a long-form script: spoken text with visual cues in [[double brackets]] (grammar in docs/LONGFORM.md: [[stat value: .. | label: ..]], [[stock search]], [[clip title | url: .. | from: .. | to: ..]], [[face]], [[music drive 0.08]], [[sfx hit]], any scenes/longform/<name>.html). Returns runtime at speaking pace, visuals count, average/longest gap between visuals (target ~15 s), chapters, errors, and writes the reading copy (cues stripped) for the teleprompter.',
  inputSchema: { file: z.string().describe('Script path, e.g. scripts/physics-of-poker.script.md'), text: z.string().optional().describe('Script text to save at that path first') },
}, async ({ file, text: body }) => {
  const f = inRepo(file);
  if (body != null) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); }
  return text(await cli('longform.mjs', ['script', f]));
});

server.registerTool('longform_from_script', {
  title: 'Recording + script -> plan (-> video)',
  description: 'Transcribe the creator\'s recording of a script (video or audio-only), align it word by word to the script (re-read lines: the last take is kept, earlier takes cut; ad-libs kept and listed), and write edits/longform/<name>.json with every cue anchored to its spoken word. build: true also builds the video (minutes). Read the alignment report: lines not found in the recording need a decision.',
  inputSchema: { script: z.string(), recording: z.string(), name: z.string().optional(), build: z.boolean().optional() },
}, async ({ script, recording, name, build }) => {
  const res = await cli('longform.mjs', ['from-script', inRepo(script), inRepo(recording), ...(name ? ['--name', name] : []), ...(build ? ['--build'] : [])]);
  const sheet = res.build?.sheet;
  return sheet && existsSync(sheet) ? picture(sheet, res) : text(res);
});

server.registerTool('longform_pull', {
  title: 'Fetch clips to pull',
  description: 'For pull inserts that have a url (and from/to), download just that section with yt-dlp into assets/broll/<id>.mp4 (credited in assets/broll/CREDITS.md); the next build uses them. Only for clips the creator has chosen to use: keep them short and talked over.',
  inputSchema: { plan: z.string() },
}, async ({ plan }) => text(await cli('longform.mjs', ['pull', inRepo(plan)])));

server.registerTool('longform_stock', {
  title: 'Download stock B-roll',
  description: 'For every insert with "stock": "<search>" in a plan, download the best free landscape Pexels video to assets/broll/<id>.mp4 and add a credit line to assets/broll/CREDITS.md (needs PEXELS_API_KEY). Look at the result with a build; if a pick is wrong, delete the file and set "pick": 2 on the insert.',
  inputSchema: { plan: z.string() },
}, async ({ plan }) => text(await cli('longform.mjs', ['stock', inRepo(plan)])));

server.registerTool('longform_doctor', {
  title: 'Check the machine is set up',
  description: 'Lists everything the long-form editor needs on this machine (Node, packages, Python, transcription, Chrome for 3D, keys), what is missing and the one-line fix for each. Run it first on a new machine.',
  inputSchema: {},
}, async () => text(await cli('longform.mjs', ['doctor'])));

server.registerTool('longform_feedback', {
  title: 'Read review notes',
  description: 'Turns <name>.review.json (saved from out/longform/<name>/review.html, where the creator pauses and types notes) into FEEDBACK.md: each note with what was on screen, what was being said, and which insert in the plan it points at. Then change only what the notes ask for and rebuild.',
  inputSchema: { review: z.string(), plan: z.string().optional() },
}, async ({ review, plan }) => text(await cli('longform.mjs', ['feedback', inRepo(review), ...(plan ? [inRepo(plan)] : [])])));

server.registerTool('longform_thumbnail', {
  title: 'Make thumbnails',
  description: 'Three 1280x720 thumbnails for a plan, from its "thumbnail": { text (2-4 words), accent (the word to colour), prop (a name from scenes/longform/props.js), kicker }. Look at them and pick.',
  inputSchema: { plan: z.string() },
}, async ({ plan }) => text(await cli('longform.mjs', ['thumbnail', inRepo(plan)])));

server.registerTool('longform_shorts', {
  title: 'Cut vertical shorts',
  description: 'Vertical 9:16 shorts cut from the finished long video: the ones listed in the plan as "shorts": [{ from, to, title }] (times in the finished video), or one per chapter if none are listed.',
  inputSchema: { plan: z.string() },
}, async ({ plan }) => text(await cli('longform.mjs', ['shorts', inRepo(plan)])));

server.registerTool('longform_build', {
  title: 'Build a long-form video',
  description: 'Build a plan: word-exact A-roll (fillers and dead air out, punch-ins on jump cuts), animation/B-roll/pull inserts, music that ducks under the voice, effects, YouTube loudness. Writes out/longform/<name>/: the MP4, a Premiere/Resolve XML timeline that points at the original footage, .srt captions, CHAPTERS.txt, PULL-LIST.md, REPORT.md. Returns the result and the inserts contact sheet as a picture: look at it, fix the plan, rebuild (rendered inserts are cached). Takes minutes.',
  inputSchema: { plan: z.string().describe('Plan file, e.g. edits/longform/physics-of-poker.json') },
}, async ({ plan }) => {
  const res = await cli('longform.mjs', ['build', inRepo(plan)]);
  return res.sheet && existsSync(res.sheet) ? picture(res.sheet, res) : text(res);
});

await server.connect(new StdioServerTransport());
