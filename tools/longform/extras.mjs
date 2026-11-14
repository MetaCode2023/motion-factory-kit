// tools/longform/extras.mjs: what goes around a finished long video: the setup check, the review page and
// its feedback, thumbnails, and vertical shorts cut from the long video.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { FF, PY, ROOT, ff, fmt, fmtChapter, probe, seconds } from './common.mjs';
import { loadPlan, resolvePlan } from './plan.mjs';

const outDir = (plan) => join(ROOT, 'out', 'longform', plan.name);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- doctor: is this machine ready? ------------------------------------------------------------------
export function doctor() {
  const rows = [];
  const add = (name, ok, detail, fix = '', need = true) => rows.push({ name, ok, need, detail, fix: ok ? '' : fix });
  const run = (cmd, args) => { try { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000 }); return r.status === 0 ? (r.stdout || r.stderr || '').trim().split('\n')[0] : null; } catch { return null; } };
  const req = createRequire(join(ROOT, 'package.json'));
  const has = (m) => { try { req.resolve(m); return true; } catch { return false; } };

  const major = +process.versions.node.split('.')[0];
  add('Node 18+', major >= 18, `v${process.versions.node}`, 'install Node 20 LTS from nodejs.org');
  add('npm packages', has('skia-canvas') && has('ffmpeg-static'), has('skia-canvas') ? 'installed' : 'missing', 'run: npm install');
  add('ffmpeg', !!FF && existsSync(FF), FF ? 'bundled' : 'missing', 'run: npm install');
  add('Python 3', !!PY, PY ? run(PY, ['--version']) : 'not found', 'install Python 3.10+ from python.org (needed to transcribe recordings)');
  const fw = PY && run(PY, ['-c', 'import faster_whisper; print(faster_whisper.__version__)']);
  const key11 = !!process.env.ELEVENLABS_API_KEY;
  add('Transcription', !!fw || key11, fw ? `faster-whisper ${fw}` : key11 ? 'ElevenLabs key' : 'none', 'run: pip install faster-whisper  (or put a .srt next to the recording)');
  let chrome = null;
  try { const src = readFileSync(join(ROOT, 'tools', 'longform', 'render3d.mjs'), 'utf8'); chrome = [process.env.CHROME_PATH, ...[...src.matchAll(/'((?:\/|[A-Z]:)[^']*(?:hrome|hromium|msedge|Edge)[^']*)'/g)].map((m) => m[1])].filter(Boolean).find((p) => existsSync(p)); } catch {}
  const pw = has('playwright-core'), three = has('three');
  add('3D scenes', pw && three, pw && three ? (chrome ? `Chrome at ${chrome}` : 'playwright-core + three (Chrome: Playwright\'s own or set CHROME_PATH)') : 'missing ' + [!pw && 'playwright-core', !three && 'three'].filter(Boolean).join(', '), 'run: npm install  (then: npx playwright install chromium if Chrome is not installed)', false);
  add('Stock footage', !!process.env.PEXELS_API_KEY, process.env.PEXELS_API_KEY ? 'PEXELS_API_KEY set' : 'no key', 'free key at pexels.com/api, then set PEXELS_API_KEY', false);
  const yt = run('yt-dlp', ['--version']);
  add('Outside clips', !!yt, yt ? `yt-dlp ${yt}` : 'yt-dlp not found', 'install yt-dlp (pip install yt-dlp)', false);
  add('Fonts and sounds', existsSync(join(ROOT, 'fonts')) && existsSync(join(ROOT, 'sounds', 'sfx')), 'bundled', 'the repo is incomplete: clone it again');
  const ready = rows.filter((r) => r.need).every((r) => r.ok);
  return { ok: ready, ready, rows };
}

// ---- review page: watch it, pause, type a note at that second ------------------------------------------
export function writeReview(plan, R, dir = outDir(plan)) {
  const data = {
    name: plan.name, title: plan.title || plan.name, plan: relative(ROOT, plan._file || ''), duration: +R.total.toFixed(2),
    chapters: R.chapters.map((c) => ({ at: +c.at.toFixed(2), title: c.title })),
    inserts: R.inserts.map((i) => ({ id: i.id, at: i.at, dur: i.dur, kind: i.kind, what: i.note || i.title || i.src?.search || (i.scene ? basename(i.scene, '.html') : i.kind) })),
  };
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review: ${esc(data.title)}</title>
<style>
:root{--bg:#0d0f14;--card:#171a22;--ink:#eef0f5;--mut:#8b93a5;--acc:#3ce0ff;--line:#262b38}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:20px}h1{font-size:22px;margin:0 0 4px}.mut{color:var(--mut);font-size:14px}
video{width:100%;border-radius:10px;background:#000;margin:14px 0 8px}
.now{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:14px;color:var(--mut);min-height:26px}
.pill{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:2px 10px;color:var(--ink)}
.add{display:flex;gap:8px;margin:12px 0}textarea{flex:1;min-height:64px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit}
button{background:var(--acc);color:#04222b;border:0;border-radius:10px;padding:10px 16px;font:600 15px system-ui;cursor:pointer}
button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}button.sm{padding:4px 10px;font-size:13px}
.note{display:flex;gap:12px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0}
.note a{color:var(--acc);font:600 14px ui-monospace,monospace;text-decoration:none;white-space:nowrap;cursor:pointer}.note div{flex:1;white-space:pre-wrap}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}
label{display:flex;gap:6px;align-items:center}
</style></head><body><main>
<h1>${esc(data.title)}</h1>
<div class="mut">Watch it. When something is off, pause, type what to change, and press Add. When you're done, press Save notes and send the file back.</div>
<video id="v" src="${esc(plan.name)}.mp4" controls playsinline></video>
<div class="now"><span class="pill" id="tc">0:00</span><span id="ch"></span><span id="on"></span></div>
<div class="add"><textarea id="tx" placeholder="What should change here? (e.g. 'this chart is confusing, show the two numbers side by side')"></textarea><button id="add">Add note</button></div>
<div id="list"></div>
<div class="bar"><label><input type="checkbox" id="ok"> Approved as is (or once these notes are done)</label><span style="flex:1"></span><button class="ghost" id="clear">Clear</button><button id="save">Save notes</button></div>
</main>
<script>
const DATA = ${JSON.stringify(data)};
const $ = (id) => document.getElementById(id), v = $('v');
const KEY = 'review:' + DATA.name;
let notes = [], approved = false;
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) { notes = s.notes || []; approved = !!s.approved; } } catch (e) {}
const tc = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const at = (t) => DATA.inserts.find((i) => t >= i.at && t < i.at + i.dur);
const chap = (t) => DATA.chapters.filter((c) => c.at <= t).pop();
const store = () => { try { localStorage.setItem(KEY, JSON.stringify({ notes, approved })); } catch (e) {} };
function draw() {
  $('ok').checked = approved;
  const list = $('list'); list.textContent = '';
  notes.sort((a, b) => a.t - b.t).forEach((n, k) => {
    const row = document.createElement('div'); row.className = 'note';
    const a = document.createElement('a'); a.textContent = tc(n.t); a.onclick = () => { v.currentTime = n.t; v.play(); };
    const d = document.createElement('div'); d.textContent = n.text;
    const x = document.createElement('button'); x.className = 'ghost sm'; x.textContent = 'Remove'; x.onclick = () => { notes.splice(k, 1); store(); draw(); };
    row.append(a, d, x); list.append(row);
  });
}
v.ontimeupdate = () => { const t = v.currentTime, i = at(t), c = chap(t); $('tc').textContent = tc(t); $('ch').textContent = c ? c.title : ''; $('on').textContent = i ? 'on screen: ' + i.what : ''; };
$('add').onclick = () => { const text = $('tx').value.trim(); if (!text) return; const t = +v.currentTime.toFixed(1), i = at(t); notes.push({ t, text, insert: i ? i.id : null }); $('tx').value = ''; store(); draw(); };
$('ok').onchange = (e) => { approved = e.target.checked; store(); };
$('clear').onclick = () => { notes = []; approved = false; store(); draw(); };
$('save').onclick = () => {
  const blob = new Blob([JSON.stringify({ name: DATA.name, plan: DATA.plan, duration: DATA.duration, approved, notes }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = DATA.name + '.review.json'; a.click();
};
draw();
</script></body></html>
`;
  const file = join(dir, 'review.html');
  writeFileSync(file, html);
  return file;
}

// review.json (from the page) -> FEEDBACK.md: every note with what was on screen and being said there,
// and where in the plan to change it.
export function feedback(reviewFile, planFile) {
  const rv = JSON.parse(readFileSync(reviewFile, 'utf8'));
  const pf = planFile || (rv.plan && existsSync(join(ROOT, rv.plan)) ? join(ROOT, rv.plan) : join(ROOT, 'edits', 'longform', `${rv.name}.json`));
  if (!existsSync(pf)) throw new Error(`plan not found for "${rv.name}" (pass it: node longform.mjs feedback <review.json> <plan.json>)`);
  const plan = loadPlan(pf), R = resolvePlan(plan);
  if (R.errors.length) throw new Error('the plan no longer resolves: ' + R.errors[0]);
  const notes = (rv.notes || []).slice().sort((a, b) => a.t - b.t).map((n) => {
    const ins = R.inserts.find((i) => n.t >= i.at - 0.3 && n.t < i.at + i.dur + 0.3);
    const near = ins ? null : R.inserts.filter((i) => i.at > n.t).sort((a, b) => a.at - b.at)[0];
    const said = R.words.filter((w) => w.s >= n.t - 4 && w.s <= n.t + 4).map((w) => w.w).join(' ');
    const ch = R.chapters.filter((c) => c.at <= n.t).pop();
    return { t: n.t, text: n.text, chapter: ch?.title || '', said,
      insert: ins && { id: ins.id, kind: ins.kind, index: ins.i, scene: ins.scene ? relative(ROOT, ins.scene) : null, from: +ins.at.toFixed(1), to: +(ins.at + ins.dur).toFixed(1) },
      next: near && { id: near.id, at: +near.at.toFixed(1) } };
  });
  const lines = [`# Feedback: ${plan.title || plan.name}`, '', rv.approved ? '**Approved** once the notes below are done.' : '**Not approved yet.**', '',
    `${notes.length} note(s). Plan: \`${relative(ROOT, pf)}\`. Change only what a note asks for, then rebuild (unchanged visuals are cached).`, ''];
  notes.forEach((n, k) => {
    lines.push(`## ${k + 1}. ${fmtChapter(n.t)}${n.chapter ? `  ·  ${n.chapter}` : ''}`, '', `> ${n.text.replace(/\n/g, '\n> ')}`, '');
    lines.push(n.insert ? `- On screen: \`${n.insert.id}\` (${n.insert.kind}${n.insert.scene ? `, ${n.insert.scene}` : ''}), ${fmtChapter(n.insert.from)}–${fmtChapter(n.insert.to)}; it is \`inserts[${n.insert.index}]\` in the plan`
      : `- On screen: the speaker / backdrop (no visual)${n.next ? `; next visual \`${n.next.id}\` at ${fmtChapter(n.next.at)}` : ''}`);
    if (n.said) lines.push(`- Being said: "…${n.said}…"`);
    lines.push('');
  });
  if (!notes.length) lines.push('No notes.', '');
  const out = join(dirname(resolve(reviewFile)), 'FEEDBACK.md');
  writeFileSync(out, lines.join('\n'));
  return { ok: true, file: out, approved: !!rv.approved, notes, plan: pf };
}

// ---- thumbnails ------------------------------------------------------------------------------------------
// plan.thumbnail = { text: "Poker is physics", accent: "physics", prop: "card", kicker }; three layouts each.
export function thumbnails(planFile, { log = console.log } = {}) {
  const plan = loadPlan(planFile), dir = outDir(plan);
  mkdirSync(dir, { recursive: true });
  const base = { ...(plan.theme || {}), text: plan.title || plan.name, ...(plan.thumbnail || {}) };
  const variants = Array.isArray(plan.thumbnails) && plan.thumbnails.length ? plan.thumbnails.map((t, k) => ({ ...base, layout: k % 3, ...t })) : [0, 1, 2].map((layout) => ({ ...base, layout }));
  const files = [];
  variants.forEach((d, k) => {
    const dj = join(dir, `.thumb-${k}.json`), png = join(dir, `.thumb-${k}.png`), jpg = join(dir, `thumbnail-${k + 1}.jpg`);
    writeFileSync(dj, JSON.stringify(d));
    const r = spawnSync(process.execPath, [join(ROOT, 'render.mjs'), join(ROOT, 'scenes', 'longform', 'thumbnail.html'), '--data', dj, '--still', '0.5', '--out', png], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`thumbnail render failed: ${(r.stderr || r.stdout).slice(-400)}`);
    ff(['-i', png, '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '2', jpg], 'thumbnail');
    rmSync(dj, { force: true }); rmSync(png, { force: true });
    files.push(jpg); log(`  -> ${relative(ROOT, jpg)}`);
  });
  return { ok: true, files };
}

// ---- shorts: vertical cuts of the finished long video --------------------------------------------------
// plan.shorts = [{ from: "1:02", to: "1:48", title: "Why bluffing is math" }] (times in the finished video).
// With none in the plan, one is proposed per chapter: from its first line to the sentence that ends
// nearest 45 s later. The 16:9 picture sits in a 9:16 frame over a blurred copy of itself: title above,
// big word-by-word captions below (for the words the long video doesn't already caption), all inside the safe area.
export async function shorts(planFile, { log = console.log, max = 6 } = {}) {
  const plan = loadPlan(planFile), R = resolvePlan(plan);
  if (R.errors.length) return { ok: false, errors: R.errors };
  const dir = outDir(plan), src = [join(dir, `${plan.name}.mp4`)].find(existsSync);
  if (!src) return { ok: false, errors: ['build the plan first (node longform.mjs build <plan>)'] };
  const total = probe(src).duration || R.total;
  let list = (plan.shorts || []).map((s) => ({ from: seconds(s.from), to: seconds(s.to), title: s.title || '' }));
  if (!list.length) {
    const ends = R.words.filter((w) => /[.?!]$/.test(w.w)).map((w) => w.e + 0.25);
    list = R.chapters.slice(0, max).map((c) => {
      const from = Math.max(0, c.at - 0.1), want = from + 45;
      const to = ends.filter((e) => e > from + 20 && e < from + 58).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0] ?? Math.min(total, from + 45);
      return { from, to, title: c.title };
    });
  }
  list = list.filter((s) => s.to > s.from + 3 && s.from < total).map((s) => ({ ...s, to: Math.min(s.to, total) }));
  if (!list.length) return { ok: false, errors: ['nothing to cut: add "shorts": [{ from, to, title }] to the plan, or chapters'] };
  const { Canvas, FontLibrary } = await import('skia-canvas');
  const font = (n) => join(ROOT, 'fonts', n);
  if (!FontLibrary.has('LF Display')) FontLibrary.use('LF Display', [font('plus-jakarta-sans-latin-800-normal.woff2')]);
  if (!FontLibrary.has('LF Body')) FontLibrary.use('LF Body', [font('plus-jakarta-sans-latin-600-normal.woff2')]);
  const accent = plan.accent || plan.theme?.color || '#3CE0FF';
  const sdir = join(dir, 'shorts');
  mkdirSync(sdir, { recursive: true });
  const files = [];
  // Words the long video doesn't already show as captions in this stretch get big captions under the picture
  // (burn: true = it shows them all, 'gaps' = only between full-screen visuals, off = none).
  const burn = R.captions?.burn;
  const full = R.inserts.filter((i) => i.layout === 'full').map((i) => [i.at, i.at + i.dur]);
  const shown = (w) => burn === true || (burn === 'gaps' && !full.some(([a, b]) => w.s < b - 0.05 && w.e > a + 0.05));
  const bgr = (hex) => { const h = hex.replace('#', ''); return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase(); };
  const ts = (x) => { const cs = Math.round(Math.max(0, x) * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
  const PY = 540, PH = 608;   // the 16:9 picture inside the 9:16 frame
  for (const [k, s] of list.entries()) {
    const d = s.to - s.from;
    // Title above the picture (below the app's top bar), source line at the bottom of the safe area.
    const cv = new Canvas(1080, 1920), c = cv.getContext('2d');
    c.textAlign = 'center'; c.fillStyle = '#fff'; c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 18;
    let size = 96, lines = [];
    for (; size >= 54; size -= 6) {
      c.font = `800 ${size}px "LF Display"`; lines = []; let cur = '';
      for (const w of String(s.title).split(/\s+/)) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width > 940 && cur) { lines.push(cur); cur = w; } else cur = t; }
      lines.push(cur);
      if (lines.length <= 2) break;
    }
    const top = PY - 78 - (lines.length - 1) * size * 1.1;
    lines.forEach((l, i) => c.fillText(l, 540, Math.max(290, top) + i * size * 1.1));
    c.fillStyle = accent; c.fillRect(490, PY - 36, 100, 8);
    c.font = '600 34px "LF Body"'; c.fillStyle = 'rgba(255,255,255,0.7)';
    c.fillText(`From: ${plan.title || plan.name}`.slice(0, 48), 540, 1425);
    const png = join(sdir, `.title-${k}.png`);
    await cv.toFile(png);
    // Captions: three or four words at a time, the spoken one in the accent colour.
    const words = R.words.filter((w) => w.s >= s.from && w.e <= s.to + 0.2 && !shown(w));
    const ev = []; let cur = [];
    const flush = () => {
      cur.forEach((w, j) => {
        const a = w.s - s.from, b = (j + 1 < cur.length ? cur[j + 1].s : w.e + 0.2) - s.from;
        ev.push(`Dialogue: 0,${ts(a)},${ts(b)},C,,0,0,0,,${cur.map((x, i) => (i === j ? `{\\c${bgr(accent)}}${x.w.replace(/[{}\\]/g, '')}{\\c&HFFFFFF&}` : x.w.replace(/[{}\\]/g, ''))).join(' ')}`);
      });
      cur = [];
    };
    words.forEach((w, i) => {
      cur.push(w);
      const next = words[i + 1], text = cur.map((x) => x.w).join(' ');
      if (/[.?!,;:]$/.test(w.w) || text.length > 16 || cur.length >= 4 || !next || next.s - w.e > 0.45) flush();
    });
    const ass = join(sdir, `.caps-${k}.ass`);
    writeFileSync(ass, ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 0', '', '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      `Style: C,Plus Jakarta Sans,88,&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,5,0,8,60,60,${PY + PH + 70},1`, '', '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...ev].join('\n') + '\n');
    const fe = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    const caps = ev.length ? `,ass='${fe(ass)}':fontsdir='${fe(join(ROOT, 'fonts'))}'` : '';
    const out = join(sdir, `${plan.name}-short-${k + 1}.mp4`);
    ff(['-ss', s.from.toFixed(3), '-t', d.toFixed(3), '-i', src, '-loop', '1', '-i', png, '-filter_complex',
      `[0:v]split[a][b];[a]scale=-2:480,crop=270:480,boxblur=6:2,scale=1080:1920,eq=brightness=-0.22:saturation=0.8[bg];[b]scale=1080:${PH}[fg];[bg][fg]overlay=0:${PY}[v0];[v0][1:v]overlay=0:0:shortest=1,setpts=PTS-STARTPTS${caps},fade=t=in:d=0.2,fade=t=out:st=${(d - 0.3).toFixed(3)}:d=0.3,format=yuv420p[v]`,
      '-map', '[v]', '-map', '0:a?', '-af', `afade=t=in:d=0.1,afade=t=out:st=${(d - 0.3).toFixed(3)}:d=0.3`, '-t', d.toFixed(3),
      '-r', String(plan.fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], `short ${k + 1}`);
    rmSync(png, { force: true }); rmSync(ass, { force: true });
    files.push({ file: out, from: +s.from.toFixed(1), to: +s.to.toFixed(1), title: s.title });
    log(`  -> ${relative(ROOT, out)}  ${fmt(s.from)}–${fmt(s.to)}  "${s.title}"`);
  }
  writeFileSync(join(sdir, 'SHORTS.md'), [`# Shorts from ${plan.title || plan.name}`, '', '| File | From | To | Title |', '|---|---|---|---|', ...files.map((f) => `| ${basename(f.file)} | ${fmtChapter(f.from)} | ${fmtChapter(f.to)} | ${f.title} |`), '', 'To change one, set "shorts": [{ "from": "1:02", "to": "1:48", "title": "…" }] in the plan and run this again.', ''].join('\n'));
  return { ok: true, files };
}
