// tools/longform/build.mjs: a long-form edit plan -> preview MP4, Premiere timeline, captions,
// chapters, pull list and a self-check report, in out/longform/<name>/.
import { spawn, spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { FF, H, PY, ROOT, W, ff, fmt, fmtChapter, frameAt, probe, sheet } from './common.mjs';
import { loadPlan, resolvePlan, sideBox } from './plan.mjs';
import { premiereXML } from './premiere.mjs';
import { writeReview } from './extras.mjs';
import { harshReview, readabilityChecks } from './critic.mjs';
import { aroundCuts } from '../stills.mjs';

const CACHE = join(ROOT, 'out', '.cache', 'longform');
const hash = (...xs) => createHash('sha1').update(JSON.stringify(xs)).digest('hex').slice(0, 16);
const cover = (z = 1, fx = 0.5, fy = 0.5) => `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}` +
  (z > 1.001 ? `,scale=${Math.round(W * z / 2) * 2}:${Math.round(H * z / 2) * 2},crop=${W}:${H}:(iw-${W})*${fx}:(ih-${H})*${fy}` : '') + ',setsar=1';
const VENC = (fps, crf = 18) => ['-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-g', String(fps * 2)];
const cached = (key, ext, make) => { mkdirSync(CACHE, { recursive: true }); const f = join(CACHE, key + ext); if (!existsSync(f)) make(f); return f; };

function brandAccent() {
  try { const m = readFileSync(join(ROOT, 'brand.js'), 'utf8').match(/accent\s*:\s*['"](#[0-9a-fA-F]{6})/); return m ? m[1] : '#FC5C2B'; } catch { return '#FC5C2B'; }
}

// ---- A-roll: every kept piece encoded once (cached), then joined -----------------------------------
function buildARoll(R, plan, dir, log) {
  const vlist = [], alist = [];
  const LOOP = 12;
  let loop = null;
  R.cuts.forEach((c, i) => {
    const clip = R.lib.clips[c.clip];
    const frames = Math.round(c.d * plan.fps);
    if (R.voiceOnly || !clip.height) {
      // No picture (or base: "backdrop"): the animated backdrop, continuous across cuts.
      loop ??= renderScene(join(ROOT, 'scenes', 'longform', 'backdrop.html'), { ...(plan.theme || {}), dur: LOOP }, plan.fps, 'backdrop', log);
      const off = (c.out % LOOP).toFixed(3);
      vlist.push(cached(hash('bg', loop, off, frames), '.mp4', (f) => ff(['-stream_loop', '-1', '-ss', off, '-i', loop, '-frames:v', String(frames), '-vf', `fps=${plan.fps}`, '-an', ...VENC(plan.fps), f], 'backdrop piece')));
    } else {
      const key = hash('v', clip.key, c.s, frames, c.zoom, c.focus, plan.fps);
      vlist.push(cached(key, '.mp4', (f) => ff(['-ss', c.s.toFixed(3), '-i', clip.file, '-frames:v', String(frames), '-vf', `${cover(c.zoom, ...c.focus)},fps=${plan.fps}`, '-an', ...VENC(plan.fps), f], `A-roll piece ${i + 1}`)));
    }
    const akey = hash('a', clip.key, c.s, c.d);
    alist.push(cached(akey, '.wav', (f) => clip.hasAudio
      ? ff(['-ss', c.s.toFixed(3), '-i', clip.file, '-t', c.d.toFixed(4), '-vn', '-ac', '2', '-ar', '48000', '-af', `afade=t=in:d=0.012,afade=t=out:st=${Math.max(0, c.d - 0.02).toFixed(4)}:d=0.02`, '-c:a', 'pcm_s16le', f], 'A-roll audio')
      : ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', c.d.toFixed(4), '-c:a', 'pcm_s16le', f], 'silence')));
    if ((i + 1) % 25 === 0) log(`  A-roll ${i + 1}/${R.cuts.length} pieces`);
  });
  const vtxt = join(dir, '.aroll-v.txt'), atxt = join(dir, '.aroll-a.txt');
  const esc = (f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
  writeFileSync(vtxt, vlist.map(esc).join('\n'));
  writeFileSync(atxt, alist.map(esc).join('\n'));
  const video = join(dir, '.aroll.mp4'), audio = join(dir, '.aroll.wav');
  ff(['-f', 'concat', '-safe', '0', '-i', vtxt, '-c', 'copy', video], 'join A-roll');
  ff(['-f', 'concat', '-safe', '0', '-i', atxt, '-c', 'copy', audio], 'join A-roll audio');
  rmSync(vtxt); rmSync(atxt);
  return { video, audio };
}

// ---- inserts: each becomes a 1920x1080 clip of exactly its length -----------------------------------
async function pullCard(ins, accent, out) {
  const { Canvas, FontLibrary } = await import('skia-canvas');
  const f = (n) => join(ROOT, 'fonts', n);
  if (!FontLibrary.has('LF Display')) FontLibrary.use('LF Display', [f('plus-jakarta-sans-latin-800-normal.woff2')]);
  if (!FontLibrary.has('LF Body')) FontLibrary.use('LF Body', [f('plus-jakarta-sans-latin-600-normal.woff2')]);
  if (!FontLibrary.has('LF Mono')) FontLibrary.use('LF Mono', [f('jetbrains-mono-latin-600-normal.woff2')]);
  const cv = new Canvas(W, H), c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#15161d'); g.addColorStop(1, '#0a0b0f');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.strokeStyle = accent; c.lineWidth = 6; c.setLineDash([28, 18]); c.strokeRect(70, 70, W - 140, H - 140); c.setLineDash([]);
  c.fillStyle = accent; c.font = '600 34px "LF Mono"'; c.fillText('CLIP TO PULL  ·  replace this in the editor', 140, 200);
  c.fillStyle = '#fff'; c.font = '800 84px "LF Display"';
  const words = String(ins.title).split(' '); let line = '', y = 340;
  for (const w of words) { if (c.measureText(line + w).width > W - 280) { c.fillText(line, 140, y); y += 100; line = ''; } line += w + ' '; }
  c.fillText(line, 140, y);
  c.font = '600 38px "LF Mono"'; c.fillStyle = '#c9cad3';
  const rows = [ins.url && `URL   ${ins.url}`, !ins.url && ins.search && `FIND  ${ins.search}`, (ins.from !== '' || ins.to !== '') && `TIME  ${ins.from || '?'} → ${ins.to || '?'}`, `LEN   ${ins.dur.toFixed(1)} s on the timeline`].filter(Boolean);
  rows.forEach((r, k) => c.fillText(r.length > 78 ? r.slice(0, 77) + '…' : r, 140, y + 130 + k * 64));
  if (ins.note && ins.note !== ins.title) { c.font = '600 36px "LF Body"'; c.fillStyle = '#8f90a0'; c.fillText(ins.note.slice(0, 90), 140, H - 150); }
  await cv.toFile(out);
  return out;
}

// The corner circle for layout "pip": a round mask for the speaker and an accent ring behind it.
// plan.pip = { size: 300, margin: 56 } to change it.
async function pipAssets(media, accent, plan) {
  const { Canvas } = await import('skia-canvas');
  const d = Math.round((plan.pip?.size ?? 300) / 2) * 2, ring = 6, margin = plan.pip?.margin ?? 56;
  mkdirSync(media, { recursive: true });
  const mask = join(media, 'pip-mask.png'), ringFile = join(media, 'pip-ring.png');
  let cv = new Canvas(d, d), c = cv.getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, d, d); c.fillStyle = '#fff'; c.beginPath(); c.arc(d / 2, d / 2, d / 2 - 1, 0, Math.PI * 2); c.fill();
  await cv.toFile(mask);
  const D = d + 2 * ring;
  cv = new Canvas(D, D); c = cv.getContext('2d');
  c.fillStyle = accent; c.beginPath(); c.arc(D / 2, D / 2, D / 2 - 1, 0, Math.PI * 2); c.fill();
  await cv.toFile(ringFile);
  return { d, ring, margin, mask, ringFile };
}

// What an animation scene gets: its data, its length, and every word spoken while it is on screen
// ({ w, t } with t in seconds from the insert's start), so its beats can land on the words.
export function animData(ins, R) {
  const words = R.words.filter((w) => w.s >= ins.at - 0.05 && w.s < ins.at + ins.dur).map((w) => ({ w: w.w, t: +(w.s - ins.at).toFixed(3) }));
  return { ...ins.data, dur: ins.dur, words, ...carryFor(ins, R) };
}
// The figure a visual inherits from the one right before it (see LF.carry): only when the two are back to back,
// both full-frame, and the earlier one ends on a single big number.
function carryFor(ins, R) {
  const i = R.inserts.indexOf(ins), prev = R.inserts[i - 1];
  ins.carried = false;
  if (!prev || prev.kind !== 'animation' || !prev.data || ins.layout === 'side' || prev.layout === 'side' || ins.data?.carry === false) return {};
  if (Math.abs(prev.at + prev.dur - ins.at) > 0.08) return {};
  const name = (prev.scene || '').replace(/^.*[\\/]/, '').replace('.html', '');
  const d = prev.data;
  const c = name === 'stat' ? { value: d.value, label: d.label }
    : name === 'count' ? { value: d.value, label: d.label, x: 1220, y: 480, size: String(d.value).length > 8 ? 96 : 120, align: 'left' }
    : name === 'share' && d.center ? { value: d.center, label: d.headline } : null;
  if (!c || c.value == null || String(c.value).length > 12 || is3d(ins.scene)) return {};
  ins.carried = true;
  return { carry: { ...c, value: String(c.value), label: c.label ? String(c.label).slice(0, 34) : '' } };
}

async function buildInsert(ins, plan, dir, accent, log, R) {
  const media = join(dir, 'media');
  mkdirSync(media, { recursive: true });
  const out = join(media, `${ins.id}.mp4`);
  const frames = Math.round(ins.dur * plan.fps);
  const fit = (f) => ff(['-i', f, '-vf', `${cover()},fps=${plan.fps},tpad=stop_mode=clone:stop_duration=${ins.dur}`, '-frames:v', String(frames), '-an', ...VENC(plan.fps), out], `fit ${ins.id}`);
  if (ins.kind === 'animation') {
    const data = animData(ins, R);
    const f = renderScene(ins.scene, data, plan.fps, ins.id, log);
    if (plan.scene_sfx !== false) ins.sceneSfx = (await sceneSfx(ins.scene, data, plan.fps)).filter((x) => x.at < ins.dur - 0.1);
    const p = probe(f);
    if (p.width !== W || p.height !== H) log(`  ! ${ins.id}: scene is ${p.width}x${p.height}; use M.setup({ preset: 'youtube' }) for 16:9`);
    fit(f);
  } else if (ins.kind === 'broll') {
    ff(['-ss', ins.from.toFixed(3), '-i', ins.file, '-frames:v', String(frames), '-vf', `${cover()},fps=${plan.fps}`, '-an', ...VENC(plan.fps), out], `B-roll ${ins.id}`);
  } else if (ins.kind === 'image') {
    const z = `zoompan=z='min(1.0+0.0007*on,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${plan.fps}`;
    ff(['-loop', '1', '-i', ins.file, '-vf', `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},${z}`, '-frames:v', String(frames), ...VENC(plan.fps), out], `image ${ins.id}`);
  } else if (ins.kind === 'pull') {
    const png = await pullCard(ins, accent, join(media, `${ins.id}.png`));
    ff(['-loop', '1', '-i', png, '-frames:v', String(frames), '-vf', `fps=${plan.fps},format=yuv420p`, ...VENC(plan.fps), out], `pull ${ins.id}`);
  }
  ins.media = out;
  return out;
}
// The sound effects a scene declares in M.setup({ sfx }) (each template times its own: pops, ticks, the hit
// on the reveal), so animations arrive with their sound design. Cached like the render.
async function sceneSfx(scene, data, fps = 30) {
  if (is3d(scene)) {   // written next to the render by render3d.mjs
    const f = join(CACHE, sceneKey(scene, data, fps) + '.mp4.sfx.json');
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).map((x) => ({ at: +x.at, name: x.name, volume: x.volume ?? 0.6 })) : [];
  }
  const key = hash('sfx', readFileSync(scene, 'utf8'), readSceneLibs(scene), data);
  const f = join(CACHE, key + '.sfx.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  let sfx = [];
  try {
    const { open } = await import('../../engines/skia.mjs');
    const e = await open(scene, { data });
    sfx = (e.V.sfx || []).filter((x) => x.name && Number.isFinite(+x.at)).map((x) => ({ at: +x.at, name: x.name, volume: x.volume ?? 0.6 }));
    await e.close?.();
  } catch {}
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(f, JSON.stringify(sfx));
  return sfx;
}

// 3D scenes (scenes/longform/3d/*.html, three.js) render through headless Chrome instead of skia.
const is3d = (scene) => /[\\/]3d[\\/]/.test(scene);
const sceneKey = (scene, data, fps) => hash('anim', readFileSync(scene, 'utf8'), readSceneLibs(scene), data, fps, kitStamp());

// A scene rendered once per (code, data, fps) and cached; returns the silent MP4.
function renderScene(scene, data, fps, label, log) {
  const key = sceneKey(scene, data, fps);
  return cached(key, '.mp4', (file) => {
    const dj = join(CACHE, key + '.data.json'), part = join(CACHE, key + '.part.mp4');
    writeFileSync(dj, JSON.stringify(data));
    log(`  rendering ${label} (${relative(ROOT, scene)}, ${data.dur}s${is3d(scene) ? ', 3D' : ''})`);
    const args = is3d(scene)
      ? [join(ROOT, 'tools', 'longform', 'render3d.mjs'), scene, '--out', part, '--data', dj, '--dur', String(data.dur), '--fps', String(fps)]
      : [join(ROOT, 'render.mjs'), scene, '--out', part, '--data', dj, '--to', String(data.dur), '--fps', String(fps)];
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
    // A failed render never stays in the cache as a broken file.
    if (r.status !== 0 || !existsSync(part)) { rmSync(part, { force: true }); throw new Error(`${is3d(scene) ? '3D render' : 'render'} failed for ${label}: ${(r.stderr || r.stdout).slice(-800)}`); }
    if (existsSync(part + '.sfx.json')) renameSync(part + '.sfx.json', file + '.sfx.json');
    renameSync(part, file);
  });
}
// Shared scripts next to a scene (lf.js, poker.js) are part of its cache key.
const readSceneLibs = (scene) => [...readFileSync(scene, 'utf8').matchAll(/<script src="([^"]+)"|from '(\.\/[^']+)'/g)].map((m) => join(scene, '..', m[1] || m[2])).filter((f) => !f.includes('/kit/') && existsSync(f)).map((f) => readFileSync(f, 'utf8').length + ':' + statSync(f).mtimeMs).join('|');

let _stamp;
const kitStamp = () => (_stamp ??= ['kit/motion.js', 'kit/fx.js', 'kit/blocks.js', 'brand.js'].map((f) => existsSync(join(ROOT, f)) ? statSync(join(ROOT, f)).mtimeMs : 0).join('|'));


// Every animation the build is about to need and hasn't cached, rendered several at a time (the build
// itself then finds them in the cache). LONGFORM_JOBS sets how many at once; default half the cores, max 4.
async function prerender(R, plan, log) {
  const todo = [], seen = new Set();
  const want = (scene, data, label) => {
    if (!scene || !existsSync(scene)) return;
    const key = sceneKey(scene, data, plan.fps);
    if (seen.has(key) || existsSync(join(CACHE, key + '.mp4'))) return;
    seen.add(key); todo.push({ scene, data, label, key });
  };
  if (R.voiceOnly) want(join(ROOT, 'scenes', 'longform', 'backdrop.html'), { ...(plan.theme || {}), dur: 12 }, 'backdrop');
  for (const ins of R.inserts) if (ins.kind === 'animation') want(ins.scene, animData(ins, R), ins.id);
  const cores = cpus().length, P = Math.max(1, Math.min(4, Number(process.env.LONGFORM_JOBS) || Math.floor(cores / 2)));
  if (todo.length < 2 || P < 2) return;
  mkdirSync(CACHE, { recursive: true });
  log(`  rendering ${todo.length} animations, ${P} at a time`);
  const inner = String(Math.max(1, Math.floor((cores - 1) / P)));
  const one = (j) => new Promise((done) => {
    const dj = join(CACHE, j.key + '.data.json'), part = join(CACHE, j.key + '.part.mp4'), file = join(CACHE, j.key + '.mp4');
    writeFileSync(dj, JSON.stringify(j.data));
    const args = is3d(j.scene)
      ? [join(ROOT, 'tools', 'longform', 'render3d.mjs'), j.scene, '--out', part, '--data', dj, '--dur', String(j.data.dur), '--fps', String(plan.fps)]
      : [join(ROOT, 'render.mjs'), j.scene, '--out', part, '--data', dj, '--to', String(j.data.dur), '--fps', String(plan.fps), '--jobs', inner];
    const ch = spawn(process.execPath, args, { cwd: ROOT, stdio: 'ignore' });
    ch.on('error', () => done());
    ch.on('close', (code) => {
      if (code === 0 && existsSync(part)) {
        if (existsSync(part + '.sfx.json')) renameSync(part + '.sfx.json', file + '.sfx.json');
        renameSync(part, file);
      } else rmSync(part, { force: true });   // the build renders it again in order and reports the error
      done();
    });
  });
  // 3D scenes each start a browser: two at a time at most.
  const run = async (list, n) => { let k = 0; await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (k < list.length) await one(list[k++]); })); };
  await run(todo.filter((j) => !is3d(j.scene)), P);
  await run(todo.filter((j) => is3d(j.scene)), Math.min(P, 2));
}

// How visuals arrive and leave. plan.transitions: 'fade' for plain fades everywhere, or your own list to cycle
// through; "transition" on one insert overrides it. Names are ffmpeg xfade transitions.
const TRANSITION = 0.4;
const TRANSITIONS = ['smoothleft', 'slideup', 'circleopen', 'hblur', 'smoothup', 'slideleft'];
const XFADE = new Set(['fade', 'dissolve', 'fadeblack', 'smoothleft', 'smoothright', 'smoothup', 'smoothdown', 'slideleft', 'slideright', 'slideup', 'slidedown', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'circleopen', 'circleclose', 'zoomin', 'radial', 'hblur', 'pixelize', 'circlecrop', 'rectcrop', 'diagtl', 'diagbr', 'squeezeh', 'squeezev']);

// ---- picture: inserts over the A-roll ------------------------------------------------------------
// The picture is built in chunks: plain stretches of the A-roll, and one chunk per insert (the insert over
// its slice of the A-roll). Each ffmpeg run holds two streams at most, so a 20-minute video with 60 inserts
// uses no more memory than a 1-minute one. Captions are drawn per chunk at the right times; the chunks are
// joined without re-encoding and the mix is laid under them.
function composite(R, plan, aroll, mix, out, accent, assFile = null, log = () => {}, pip = null) {
  const SIDE = sideBox(plan), fps = plan.fps;
  const N = Math.round(R.total * fps);
  const parts = [];
  let f = 0;
  for (const ins of R.inserts) {
    const a = Math.max(f, Math.round(ins.at * fps));
    let z = Math.min(N, Math.round((ins.at + ins.dur) * fps));
    const nextA = R.inserts[R.inserts.indexOf(ins) + 1] ? Math.round(R.inserts[R.inserts.indexOf(ins) + 1].at * fps) : null;
    if (nextA != null && nextA - z > 0 && nextA - z <= 2) z = nextA;   // a frame or two of rounding is not a gap
    if (z <= a) continue;
    if (a > f) parts.push({ from: f, to: a });
    parts.push({ from: a, to: z, ins });
    f = z;
  }
  if (f < N) parts.push({ from: f, to: N });
  // Which transition each full-frame visual uses, and whether it follows another one directly.
  const cycle = Array.isArray(plan.transitions) && plan.transitions.length ? plan.transitions : plan.transitions === 'fade' ? ['fade'] : TRANSITIONS;
  let nth = 0;
  parts.forEach((p, i) => {
    if (!p.ins || p.ins.layout === 'side') return;
    const t = p.ins.src?.transition;
    p.transition = t === 'cut' ? 'cut' : XFADE.has(t) ? t : p.ins.carried ? 'dissolve' : cycle[nth++ % cycle.length];   // a carried figure stays put while the rest changes
    const before = parts[i - 1], after = parts[i + 1];
    if (before?.ins && before.ins.layout !== 'side' && before.to === p.from && before.ins.media) p.prev = before.ins;
    if (after?.ins && after.ins.layout !== 'side' && after.from === p.to) p.next = true;
  });
  const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const caps = (start) => (assFile ? `,setpts=PTS+${(start / fps).toFixed(4)}/TB,ass='${esc(assFile)}':fontsdir='${esc(join(ROOT, 'fonts'))}',setpts=PTS-STARTPTS` : '');
  const tmp = join(dirname(out), '.chunks');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const files = parts.map((p, k) => {
    const file = join(tmp, `${String(k).padStart(4, '0')}.mp4`), n = p.to - p.from, ss = (p.from / fps).toFixed(4);
    if (!p.ins) {
      ff(['-ss', ss, '-i', aroll.video, '-frames:v', String(n), '-vf', `setpts=PTS-STARTPTS${caps(p.from)},format=yuv420p`, '-an', ...VENC(fps, 19), file], `chunk ${k}`);
    } else {
      const ins = p.ins, D = n / fps;
      const b = SIDE.border, col = accent.replace('#', '0x');
      if (ins.layout === 'side') {
        // A box beside the speaker: it fades in and out over them.
        const fade = Math.min(0.18, D / 4), fades = `fade=t=in:st=0:d=${fade}:alpha=1,fade=t=out:st=${(D - fade).toFixed(3)}:d=${fade}:alpha=1`;
        const fg = `[1:v]scale=${SIDE.w - 2 * b}:${SIDE.h - 2 * b},pad=${SIDE.w}:${SIDE.h}:${b}:${b}:color=${col},format=yuva420p,${fades},setpts=PTS-STARTPTS[i];[0:v]setpts=PTS-STARTPTS[bg];[bg][i]overlay=${SIDE.x}:${SIDE.y}:eof_action=pass`;
        ff(['-ss', ss, '-i', aroll.video, '-i', ins.media, '-filter_complex', `${fg}${caps(p.from)},format=yuv420p[v]`, '-map', '[v]', '-frames:v', String(n), '-an', ...VENC(fps, 19), file], `chunk ${k} (${ins.id})`);
      } else {
        // A full-frame visual (full, pip, split) arrives and leaves with a real transition. Straight after
        // another visual it transitions from that one's last frame, not from the speaker in between.
        const NORM = `fps=${fps},format=yuv420p,settb=AVTB,setsar=1`;
        const fx = Math.min(1, Math.max(0, plan.face?.x ?? 0.5));
        const d = Math.min(TRANSITION, D / 4), name = p.transition, cut = name === 'cut';   // cut: straight in and out (short cutaways)
        const inputs = ['-ss', ss, '-i', aroll.video, '-i', ins.media], g = [];
        let nIn = 2;
        const needs = { in: !p.prev && !cut, out: !p.next && !cut, face: ins.layout === 'pip' || ins.layout === 'split' };
        const outs = [needs.in && 'bgA', needs.out && 'bgB', needs.face && 'bgF'].filter(Boolean);
        g.push(outs.length ? `[0:v]setpts=PTS-STARTPTS,${NORM}${outs.length > 1 ? `,split=${outs.length}` : ''}${outs.map((o) => `[${o}]`).join('')}` : '[0:v]nullsink');
        if (ins.layout === 'pip' && pip) {
          const Dp = pip.d, rx = W - Dp - 2 * pip.ring - pip.margin, ry = H - Dp - 2 * pip.ring - pip.margin;
          inputs.push('-loop', '1', '-i', pip.mask, '-loop', '1', '-i', pip.ringFile);
          g.push(`[bgF]crop=${H}:${H}:(iw-${H})*${fx}:0,scale=${Dp}:${Dp},format=rgba[f1];[${nIn}:v]format=gray[m];[f1][m]alphamerge[face]`,
            `[1:v]setpts=PTS-STARTPTS[an];[an][${nIn + 1}:v]overlay=${rx}:${ry}[a1];[a1][face]overlay=${rx + pip.ring}:${ry + pip.ring}:shortest=1,${NORM},tpad=stop_mode=clone:stop_duration=1[vis]`);
          nIn += 2;
        } else if (ins.layout === 'split') {
          const hw = W / 2, vh = Math.round(hw * 9 / 32) * 2;
          g.push(`[bgF]crop=${hw}:${H}:(iw-${hw})*${fx}:0[L]`,
            `[1:v]setpts=PTS-STARTPTS,split[p0][p1];[p0]crop=${hw}:${H}:${hw / 2}:0,boxblur=20:2,eq=brightness=-0.15[pb];[p1]scale=${hw}:${vh}[ps];[pb][ps]overlay=0:${(H - vh) / 2}[Rr]`,
            `[L][Rr]hstack,drawbox=x=${hw - 3}:y=0:w=6:h=${H}:color=${col}:t=fill,${NORM},tpad=stop_mode=clone:stop_duration=1[vis]`);
        } else {
          if (needs.face) g.push('[bgF]nullsink');
          g.push(`[1:v]setpts=PTS-STARTPTS,${NORM},tpad=stop_mode=clone:stop_duration=1[vis]`);
        }
        if (p.prev && !cut) {
          // the last frame of the visual before this one, held for the length of the transition
          const still = join(tmp, `${String(k).padStart(4, '0')}-prev.png`);
          ff(['-ss', Math.max(0, p.prev.dur - 2 / fps).toFixed(3), '-i', p.prev.media, '-frames:v', '1', still], `last frame of ${p.prev.id}`);
          inputs.push('-loop', '1', '-t', (d + 1).toFixed(2), '-i', still);
          g.push(`[${nIn}:v]${NORM}[from]`); nIn++;
        }
        if (!cut) g.push(`[${p.prev ? 'from' : 'bgA'}][vis]xfade=transition=${name}:duration=${d.toFixed(3)}:offset=0[x1]`);
        if (needs.out) g.push(`[bgB]trim=start=${(D - d).toFixed(3)},setpts=PTS-STARTPTS,${NORM}[tail]`, `[x1][tail]xfade=transition=${name}:duration=${d.toFixed(3)}:offset=${(D - d).toFixed(3)}[x2]`);
        ff([...inputs, '-filter_complex', `${g.join(';')};[${cut ? 'vis' : needs.out ? 'x2' : 'x1'}]setpts=PTS-STARTPTS${caps(p.from)},format=yuv420p[v]`, '-map', '[v]', '-frames:v', String(n), '-an', ...VENC(fps, 19), file], `chunk ${k} (${ins.id})`);
      }
    }
    if ((k + 1) % 20 === 0) log(`  picture ${k + 1}/${parts.length}`);
    return file;
  });
  const list = join(tmp, 'list.txt');
  writeFileSync(list, files.map((x) => `file '${x.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', list, '-i', mix, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', out], 'join picture and sound');
  rmSync(tmp, { recursive: true, force: true });
}

// ---- sound: voice + music that ducks under it + effects, loudness for YouTube --------------------
function mixAudio(R, plan, voice, out, stemsDir) {
  const inputs = ['-i', voice], f = [];
  let n = 1;
  const beds = [];
  for (const m of R.music) {
    if (!m.file) continue;
    const len = m.end - m.at;
    if (len < 1) continue;
    inputs.push('-stream_loop', '-1', '-i', m.file);
    f.push(`[${n}:a]atrim=0:${len.toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume=${m.volume},afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, len - 1.8).toFixed(3)}:d=1.8,adelay=${Math.round(m.at * 1000)}:all=1[m${n}]`);
    beds.push(`[m${n}]`); n++;
  }
  const fx = [];
  // Effects from the plan, plus each animation's own (quieter: they sit under the voice).
  const level = plan.scene_sfx_volume ?? 0.55;
  const all = [...R.sfx, ...R.inserts.flatMap((ins) => (ins.sceneSfx || []).map((x) => ({ at: ins.at + x.at, name: x.name, volume: x.volume * level })))]
    .filter((x) => existsSync(join(ROOT, 'sounds', 'sfx', `${x.name}.mp3`)));
  R.allSfx = all;
  for (const s of all) {
    inputs.push('-i', join(ROOT, 'sounds', 'sfx', `${s.name}.mp3`));
    f.push(`[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${s.volume},adelay=${Math.round(s.at * 1000)}:all=1[s${n}]`);
    fx.push(`[s${n}]`); n++;
  }
  // Clips that keep their own sound ("audio": 0-1 on a broll/pull): that piece of their audio, under the voice.
  for (const ins of R.inserts) {
    if (!(ins.audio > 0) || !ins.file || !probe(ins.file).hasAudio) continue;
    inputs.push('-ss', (ins.from || 0).toFixed(3), '-t', ins.dur.toFixed(3), '-i', ins.file);
    f.push(`[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${ins.audio},afade=t=in:d=0.15,afade=t=out:st=${Math.max(0, ins.dur - 0.3).toFixed(3)}:d=0.3,adelay=${Math.round(ins.at * 1000)}:all=1[s${n}]`);
    fx.push(`[s${n}]`); n++;
  }
  f.push('[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[voice][key]');
  const parts = ['[voice]'];
  const noVoice = plan.voice === false;   // a version without the voice: music up, no ducking
  if (noVoice) parts[0] = '[vmute]', f.push('[voice]volume=0[vmute]');
  if (beds.length) {
    f.push(`${beds.join('')}amix=inputs=${beds.length}:normalize=0:duration=longest,apad${noVoice ? ',volume=2.4' : ''}[bed]`);
    if (noVoice) { f.push('[key]anullsink'); parts.push('[bed]'); }
    else { f.push('[bed][key]sidechaincompress=threshold=0.025:ratio=10:attack=15:release=450:makeup=1[ducked]'); parts.push('[ducked]'); }
  } else f.push('[key]anullsink');
  if (fx.length) { f.push(`${fx.join('')}amix=inputs=${fx.length}:normalize=0,apad[fx]`); parts.push('[fx]'); }
  f.push(`${parts.join('')}amix=inputs=${parts.length}:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[out]`);
  ff([...inputs, '-filter_complex', f.join(';'), '-map', '[out]', '-t', R.total.toFixed(3), '-c:a', 'pcm_s16le', out], 'mix');
  if (plan.voice !== false && !stemsDir.endsWith('.tmp')) copyFileSync(voice, join(stemsDir, 'voice.wav'));
}

// ---- burned-in captions (ASS, karaoke: the word being said lights up) ------------------------------
export function captionGroups(words, { min = 3, max = 5, pause = 0.15, maxChars = 42 } = {}) {
  const lines = []; let cur = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const width = cur.reduce((n, x) => n + String(x.w).length * (x.emphasis ? 1.15 : 1) + 1, 0);
    const natural = /[.?!,;:]$/.test(w.w) || (next && next.s - w.e >= pause);
    if (!next || cur.length >= max || width >= maxChars || (cur.length >= min && natural)) { lines.push(cur); cur = []; }
  });
  return lines;
}

export function assCaptions(R, accent, file) {
  const gapsOnly = R.captions.burn === 'gaps';
  const full = R.inserts.filter((i) => (i.layout === 'full' || i.layout === 'pip') && !i.autoBroll).map((i) => [i.at, i.at + i.dur]);
  const covered = (a, b) => full.some(([s, e]) => a < e - 0.05 && b > s + 0.05);
  const center = R.voiceOnly;
  const bgr = (hex) => { const h = hex.replace('#', ''); return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase(); };
  const ts = (s) => { const cs = Math.round(Math.max(0, s) * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
  const esc = (t) => t.replace(/[{}\\]/g, '');
  const lines = captionGroups(R.words, { maxChars: center ? 26 : 38 });
  const ev = [];
  for (const ln of lines) {
    const end = ln[ln.length - 1].e + 0.15;
    ln.forEach((w, k) => {
      const a = w.s, b = k + 1 < ln.length ? ln[k + 1].s : end;
      if (gapsOnly && covered(a, b)) return;
      const pop = Math.round(100 * (R.captions.pop ?? 1.12));
      const active = (x) => `{\\c${bgr(accent)}${x.emphasis ? `\\fscx${pop}\\fscy${pop}` : ''}${R.captions.underline && x.emphasis ? '\\u1' : ''}${R.captions.highlight && x.emphasis ? `\\bord8\\3c${bgr(accent)}` : ''}}${esc(x.w)}{\\rC}`;
      const text = ln.map((x, j) => (j === k ? active(x) : esc(x.w))).join(' ');
      ev.push(`Dialogue: 0,${ts(a)},${ts(b)},C,,0,0,0,,${text}`);
    });
  }
  const top = R.captions.position === 'top' || (R.captions.avoid_face !== false && (R.captions.face_area === 'bottom' || R.inserts.some((i) => i.layout === 'pip')));
  const align = center ? 5 : top ? 8 : 2, margin = center ? 0 : 70;
  const box = R.captions.box === false ? 1 : 3;
  const style = `Style: C,Plus Jakarta Sans,${center ? 92 : 58},&H00FFFFFF,&H00FFFFFF,&H00101010,&H${R.captions.box === false ? '00000000' : '90000000'},-1,0,0,0,100,100,0,0,${box},${center ? 4 : 3},0,${align},160,160,${margin},1`;
  writeFileSync(file, ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1920', 'PlayResY: 1080', 'WrapStyle: 0', '', '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style, '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text', ...ev].join('\n') + '\n');
  return file;
}

// ---- text outputs --------------------------------------------------------------------------------
function srt(words) {
  const cues = [];
  let cur = [];
  const flush = () => { if (cur.length) cues.push(cur); cur = []; };
  words.forEach((w, i) => {
    cur.push(w);
    const text = cur.map((x) => x.w).join(' ');
    const next = words[i + 1];
    if (/[.?!]$/.test(w.w) || text.length > 38 || (next && next.s - w.e > 0.6)) flush();
  });
  flush();
  const t = (s) => { const ms = Math.round(s * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  return cues.map((c, i) => `${i + 1}\n${t(c[0].s)} --> ${t(Math.max(c[c.length - 1].e, c[0].s + 0.8))}\n${c.map((x) => x.w).join(' ')}\n`).join('\n');
}

function pullList(R, plan) {
  const pulls = R.inserts.filter((i) => i.kind === 'pull' || i.pulled);
  if (!pulls.length) return null;
  const lines = [`# Clips to pull: ${plan.title || plan.name}`, '', 'Each one has a labelled placeholder on the timeline (track V2) at the time below. Download the clip,',
    'drop it on top of the placeholder in Premiere (or save it as the file named and rebuild).', '',
    '| # | On timeline | Length | What | Source | Source time | Save as |', '|---|---|---|---|---|---|---|'];
  pulls.forEach((p, k) => lines.push(`| ${k + 1}${p.pulled ? ' ✓' : ''} | ${fmt(p.at)} | ${p.dur.toFixed(1)} s | ${p.title || p.src.title || p.id} | ${p.pulled ? 'saved' : p.url || `search: ${p.src.search}`} | ${p.pulled ? '' : `${p.from || '?'} → ${p.to || '?'}`} | assets/broll/${p.id}.mp4 |`));
  lines.push('', 'Rule of thumb: keep borrowed clips short and talk over them (commentary), credit the source in the description.');
  return lines.join('\n') + '\n';
}

function report(R, plan, files) {
  const removed = R.source - R.total;
  const lines = [`# ${plan.title || plan.name}: build report`, '',
    `Length **${fmt(R.total)}** from ${fmt(R.source)} of talking (${fmt(removed)} of pauses and fillers removed, ${R.cuts.length} pieces).`,
    `Inserts: ${R.inserts.length} (${['animation', 'broll', 'image', 'pull'].map((k) => `${R.inserts.filter((i) => i.kind === k).length} ${k}`).join(', ')}${R.inserts.some((i) => i.autoBroll) ? `; ${R.inserts.filter((i) => i.autoBroll).length} of them automatic B-roll, credited in CREDITS.md` : ''}).`, ''];
  const checks = [];
  const pass = (ok, text) => checks.push(`- ${ok ? 'PASS' : 'FIX '} ${text}`);
  pass(!R.warnings.length, R.warnings.length ? `warnings:\n${R.warnings.map((w) => `  - ${w}`).join('\n')}` : 'no plan warnings');
  const gaps = []; let lastEnd = 0;
  for (const i of R.inserts) { if (i.at - lastEnd > 90) gaps.push(`${fmt(lastEnd)}–${fmt(i.at)}`); lastEnd = i.at + i.dur; }
  if (R.total - lastEnd > 90) gaps.push(`${fmt(lastEnd)}–${fmt(R.total)}`);
  pass(!gaps.length, gaps.length ? `long stretches with only the talking head (add B-roll or an animation): ${gaps.join(', ')}` : 'something new on screen at least every 90 s');
  const early = R.inserts[0]?.at ?? Infinity;
  pass(early <= 20, early <= 20 ? `first visual at ${fmt(early)}` : 'nothing but the talking head for the first 20 s (open with a visual)');
  const pulls = R.inserts.filter((i) => i.kind === 'pull').length;
  pass(!pulls, pulls ? `${pulls} clip(s) still to pull: see PULL-LIST.md` : 'no placeholders left');
  const longPull = R.inserts.filter((i) => (i.kind === 'pull' || i.pulled) && !i.stock && i.dur > 10);   // stock is licensed; outside clips stay short
  if (longPull.length) pass(false, `borrowed clips over 10 s (${longPull.map((i) => i.id).join(', ')}): trim them and talk over them`);
  if (R.burnedSubtitles?.length) pass(false, `pulled clips may already contain subtitles (${R.burnedSubtitles.map((x) => `${x.id}: ${x.reason}`).join('; ')}): replace, crop, or keep longform captions off that area`);
  else if (R.inserts.some((i) => i.pulled)) pass(true, 'no likely burned-in subtitles detected in pulled clips');
  if (R.frozen) R.frozen = R.frozen.filter(([a, d]) => !R.inserts.some((i) => i.kind === 'pull' && a >= i.at - 0.5 && a + d <= i.at + i.dur + 0.5));   // placeholders are still on purpose
  if (R.frozen) pass(!R.frozen.length, R.frozen.length ? `picture frozen for 3 s+ at ${R.frozen.map(([a, d]) => `${fmt(a)} (${d.toFixed(1)} s)`).join(', ')}: add motion or a visual there` : 'nothing on screen sits frozen for 3 s+');
  pass(!R.emptyFirstFrame, R.emptyFirstFrame ? 'first frame is effectively empty/black: put the hook on frame zero' : 'first frame contains visible picture');
  pass(!R.readability?.length, R.readability?.length ? `readability warnings:\n${R.readability.map((w) => `  - ${w}`).join('\n')}` : 'on-screen text has enough time and is at least 2.6% of frame height');
  pass(R.chapters.length >= 3, R.chapters.length >= 3 ? `${R.chapters.length} chapters` : 'add 3+ chapters for YouTube');
  lines.push('## Checks', '', ...checks, '', '## Timeline', '', '| Time | Insert | Kind | Layout | Length | Note |', '|---|---|---|---|---|---|');
  for (const i of R.inserts) lines.push(`| ${fmt(i.at)} | ${i.id} | ${i.kind} | ${i.layout} | ${i.dur.toFixed(1)} s | ${(i.note || i.title || '').replace(/\|/g, '/')} |`);
  if (R.chapters.length) lines.push('', '## Chapters', '', ...R.chapters.map((c) => `- ${fmtChapter(c.at)} ${c.title}`));
  lines.push('', '## Files', '', ...files.map((f) => `- ${f}`), '');
  return { text: lines.join('\n'), fixes: checks.filter((c) => c.includes('FIX')).length };
}

// ---- main ----------------------------------------------------------------------------------------
export async function build(planFile, { log = console.log, previewOnly = false } = {}) {
  const plan = loadPlan(planFile);
  const R = resolvePlan(plan);
  if (R.errors.length) return { ok: false, errors: R.errors, warnings: R.warnings };
  const dir = join(ROOT, 'out', 'longform', plan.name);
  mkdirSync(join(dir, 'stems'), { recursive: true });
  const accent = plan.accent || plan.theme?.color || brandAccent();
  log(`${plan.name}: ${fmt(R.total)} from ${fmt(R.source)} of talking, ${R.cuts.length} pieces, ${R.inserts.length} inserts`);
  const started = Date.now();
  await prerender(R, plan, log);
  const aroll = buildARoll(R, plan, dir, log);
  for (const ins of R.inserts) await buildInsert(ins, plan, dir, accent, log, R);
  R.burnedSubtitles = R.inserts.filter((i) => i.pulled && i.file).flatMap((i) => {
    if (!PY) return [];
    const r = spawnSync(PY, [join(ROOT, 'tools', 'detect_burned_subtitles.py'), i.file], { encoding: 'utf8' });
    try { const x = JSON.parse((r.stdout || '').trim()); return x.detected ? [{ id: i.id, reason: x.reason }] : []; } catch { return []; }
  });
  const mix = join(dir, 'stems', 'mix.wav');
  mixAudio(R, plan, aroll.audio, mix, join(dir, 'stems'));
  const video = join(dir, `${plan.name}.mp4`);
  log('  compositing');
  const ass = R.captions.burn ? assCaptions(R, accent, join(dir, `${plan.name}.captions.ass`)) : null;
  composite(R, plan, aroll, mix, video, accent, ass, log, R.inserts.some((i) => i.layout === 'pip') ? await pipAssets(join(dir, 'media'), accent, plan) : null);

  const files = [relative(ROOT, video)];
  const write = (name, text) => { const f = join(dir, name); writeFileSync(f, text); files.push(relative(ROOT, f)); return f; };
  write(`${plan.name}.srt`, srt(R.words));
  if (R.chapters.length) write('CHAPTERS.txt', R.chapters.map((c) => `${fmtChapter(c.at)} ${c.title}`).join('\n') + '\n');
  const auto = R.inserts.filter((i) => i.autoBroll);
  if (auto.length) write('CREDITS.md', `# Credits: ${plan.title || plan.name}\n\nB-roll (paste into the video description):\n\n${[...new Set(auto.map((i) => `- ${i.credit}`))].join('\n')}\n`);
  const pl = pullList(R, plan);
  if (pl) write('PULL-LIST.md', pl);
  if (!previewOnly) {
    copyFileSync(aroll.video, join(dir, 'media', 'a-roll.mp4'));
    write(`${plan.name}.premiere.xml`, premiereXML(R, plan, { dir, accent }));
  }
  // Self-check: a still in the middle of every insert, plus the A-roll at a few points.
  const tmp = join(dir, '.frames');
  mkdirSync(tmp, { recursive: true });
  const shots = [...R.inserts.map((i) => ({ t: i.at + i.dur / 2, label: `${fmt(i.at)} ${i.id}` })),
    ...[0.02, 0.5, 0.97].map((k) => ({ t: R.total * k, label: `${fmt(R.total * k)} a-roll` }))].sort((a, b) => a.t - b.t);
  const items = shots.map((s, k) => ({ file: frameAt(video, s.t, join(tmp, `${k}.jpg`)), label: s.label }));
  const sheetFile = await sheet(items, join(dir, `${plan.name}.inserts.jpg`), { title: `${plan.name}  ·  ${fmt(R.total)}  ·  ${R.inserts.length} inserts` });
  rmSync(tmp, { recursive: true, force: true });
  files.push(relative(ROOT, sheetFile));
  // Critic: stretches where the picture barely changes for 3 s+ (a frozen animation, an empty frame).
  const fr = spawnSync(FF, ['-hide_banner', '-i', video, '-vf', 'scale=480:-2,freezedetect=n=0.002:d=3', '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  R.frozen = [...(fr.stderr || '').matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  const first = spawnSync(FF, ['-hide_banner', '-ss', '0', '-i', video, '-frames:v', '1', '-vf', 'blackframe=amount=98:threshold=24', '-an', '-f', 'null', '-'], { encoding: 'utf8' });
  R.emptyFirstFrame = /pblack:(?:9[89]|100)\b/.test(first.stderr || '');
  R.readability = readabilityChecks(R);
  const cutTimes = aroundCuts([
    ...R.cuts.slice(1).map((c) => c.out),
    ...R.inserts.flatMap((i) => [i.at, i.at + i.dur]),
  ], R.total);
  const cutDir = join(dir, '.cut-frames');
  mkdirSync(cutDir, { recursive: true });
  const cutItems = cutTimes.map((x, k) => ({
    file: frameAt(video, x.t, join(cutDir, `${String(k).padStart(5, '0')}.jpg`), 132, 74),
    label: `${fmt(x.cut)} ${x.offset >= 0 ? '+' : ''}${x.offset.toFixed(1)}`,
  }));
  if (cutItems.length) {
    const cutSheet = await sheet(cutItems, join(dir, `${plan.name}.cuts-phone.jpg`), { cols: 5, w: 66, h: 37, pad: 5, title: 'cuts: -0.2s to +0.2s' });
    files.push(relative(ROOT, cutSheet));
  }
  rmSync(cutDir, { recursive: true, force: true });
  write('REVIEW.md', harshReview(R, plan, shots));
  files.push(relative(ROOT, writeReview(plan, R, dir)));
  const rep = report(R, plan, files);
  writeFileSync(join(dir, 'REPORT.md'), rep.text);
  rmSync(aroll.video, { force: true }); rmSync(aroll.audio, { force: true });
  log(`  done in ${((Date.now() - started) / 1000).toFixed(0)}s -> ${relative(ROOT, video)} (${rep.fixes} FIX in REPORT.md)`);
  return { ok: true, video, dir, review: join(dir, 'review.html'), report: join(dir, 'REPORT.md'), sheet: sheetFile, duration: +R.total.toFixed(2), inserts: R.inserts.length, fixes: rep.fixes, warnings: R.warnings };
}

// Same picture, new sound (e.g. no voice): re-mix and lay it under the already-built video.
export async function remix(planFile, { voice = true, log = console.log } = {}) {
  const plan = loadPlan(planFile);
  plan.voice = voice;
  const R = resolvePlan(plan);
  if (R.errors.length) return { ok: false, errors: R.errors };
  const dir = join(ROOT, 'out', 'longform', plan.name), video = join(dir, `${plan.name}.mp4`);
  const voiceWav = join(dir, 'stems', 'voice.wav');
  if (!existsSync(video) || !existsSync(voiceWav)) return { ok: false, errors: ['build the plan first'] };
  for (const ins of R.inserts) if (ins.kind === 'animation' && plan.scene_sfx !== false) ins.sceneSfx = (await sceneSfx(ins.scene, animData(ins, R), plan.fps)).filter((x) => x.at < ins.dur - 0.1);
  const tag = voice ? 'remix' : 'novoice';
  const mix = join(dir, 'stems', `${tag}.wav`);
  mixAudio(R, plan, voiceWav, mix, join(dir, 'stems', '.tmp'));
  const out = join(dir, `${plan.name}.${tag}.mp4`);
  ff(['-i', video, '-i', mix, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', out], 'remix');
  log(`  -> ${relative(ROOT, out)}`);
  return { ok: true, video: out };
}

export function check(planFile) {
  const plan = loadPlan(planFile);
  const R = resolvePlan(plan);
  return { ok: !R.errors.length, errors: R.errors, warnings: R.warnings, duration: R.total && +R.total.toFixed(2), source: R.source && +R.source.toFixed(2),
    pieces: R.cuts?.length, timeline: (R.inserts || []).map((i) => `${fmt(i.at)}  ${i.id}  ${i.kind}/${i.layout}  ${i.dur}s`),
    chapters: (R.chapters || []).map((c) => `${fmtChapter(c.at)} ${c.title}`) };
}
