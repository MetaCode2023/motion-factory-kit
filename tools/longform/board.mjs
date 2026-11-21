// A cheap approval gate: one representative, finished-looking frame per planned visual.
// It deliberately does not cut A-roll, mix sound, or render full animation clips.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { Canvas, FontLibrary } from 'skia-canvas';
import { ROOT, ff, fmt, frameAt } from './common.mjs';
import { loadPlan, resolvePlan } from './plan.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function boardModel(plan, R) {
  return {
    name: plan.name, title: plan.title || plan.name, plan: relative(ROOT, plan._file || ''),
    duration: +R.total.toFixed(2),
    cues: R.inserts.map((i) => ({
      id: i.id, at: +i.at.toFixed(2), dur: +i.dur.toFixed(2), kind: i.kind, layout: i.layout,
      what: i.note || i.title || i.src?.search || (i.scene ? basename(i.scene, '.html') : i.kind),
    })),
  };
}

async function labelFrame(text, out, accent) {
  const cv = new Canvas(1920, 1080), c = cv.getContext('2d');
  const font = join(ROOT, 'fonts', 'plus-jakarta-sans-latin-800-normal.woff2');
  if (!FontLibrary.has('LF Display')) FontLibrary.use('LF Display', [font]);
  const g = c.createLinearGradient(0, 0, 1920, 1080); g.addColorStop(0, '#171a22'); g.addColorStop(1, '#090b10');
  c.fillStyle = g; c.fillRect(0, 0, 1920, 1080);
  c.fillStyle = accent; c.fillRect(120, 160, 12, 730);
  c.fillStyle = '#fff'; c.font = '800 78px "LF Display"';
  const words = String(text).split(/\s+/); let line = '', y = 390;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width > 1500 && line) { c.fillText(line, 190, y); y += 96; line = word; } else line = next;
  }
  c.fillText(line, 190, y);
  await cv.toFile(out);
}

async function cueFrame(ins, R, plan, out, accent) {
  if (ins.kind === 'animation' && existsSync(ins.scene)) {
    const words = R.words.filter((w) => w.s >= ins.at && w.s < ins.at + ins.dur).map((w) => ({ w: w.w, t: +(w.s - ins.at).toFixed(3) }));
    const data = join(out, '..', `.${ins.id}.json`);
    writeFileSync(data, JSON.stringify({ ...ins.data, dur: ins.dur, words }));
    const at = String(Math.min(ins.dur * 0.62, Math.max(0.6, ins.dur - 0.2)));
    const renderer = /[\\/]3d[\\/]/.test(ins.scene)
      ? [join(ROOT, 'tools', 'longform', 'render3d.mjs'), ins.scene, '--data', data, '--still', at, '--out', out]
      : [join(ROOT, 'render.mjs'), ins.scene, '--data', data, '--still', at, '--out', out];
    const r = spawnSync(process.execPath, renderer, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
    rmSync(data, { force: true });
    if (r.status === 0 && existsSync(out)) return;
  }
  if ((ins.kind === 'broll' || ins.kind === 'image') && ins.file && existsSync(ins.file)) {
    if (ins.kind === 'image') ff(['-i', ins.file, '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080', '-frames:v', '1', out], `board ${ins.id}`);
    else frameAt(ins.file, (ins.from || 0) + Math.min(ins.dur / 2, 1.5), out);
    return;
  }
  await labelFrame(ins.title || ins.note || ins.src?.search || `${ins.kind}: ${ins.id}`, out, accent);
}

export async function board(planFile, { log = console.log } = {}) {
  const plan = loadPlan(planFile), R = resolvePlan(plan);
  if (R.errors.length) return { ok: false, errors: R.errors, warnings: R.warnings };
  const dir = join(ROOT, 'out', 'longform', plan.name), frames = join(dir, 'board');
  mkdirSync(frames, { recursive: true });
  const accent = plan.accent || plan.theme?.color || '#3CE0FF';
  const model = boardModel(plan, R);
  for (const [k, ins] of R.inserts.entries()) {
    const file = join(frames, `${String(k + 1).padStart(3, '0')}-${ins.id}.jpg`);
    await cueFrame(ins, R, plan, file, accent);
    model.cues[k].frame = `board/${basename(file)}`;
    log(`  ${fmt(ins.at)}  ${ins.id}`);
  }
  const html = boardHTML(model);
  const file = join(dir, 'board.html');
  writeFileSync(file, html);
  return { ok: true, file, frames, cues: model.cues.length, review: `${plan.name}.review.json` };
}

export function boardHTML(data) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Storyboard: ${esc(data.title)}</title>
<style>*{box-sizing:border-box}body{margin:0;background:#0d0f14;color:#eef0f5;font:15px/1.45 system-ui}main{max-width:1200px;margin:auto;padding:24px}h1{margin:0}.mut{color:#939bad}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:18px;margin:22px 0}.card{background:#171a22;border:1px solid #2b3040;border-radius:12px;overflow:hidden}.card img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}.meta{padding:12px}.tc{color:#3ce0ff;font:700 13px ui-monospace,monospace}textarea{width:100%;min-height:64px;background:#0d0f14;color:#fff;border:1px solid #343a4b;border-radius:8px;padding:8px;margin-top:8px}button{background:#3ce0ff;border:0;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer}.bar{position:sticky;bottom:0;background:#171a22;padding:12px;border-radius:10px;display:flex;gap:14px;align-items:center}</style></head><body><main>
<h1>${esc(data.title)} — storyboard</h1><p class="mut">Approve the visual flow before the expensive full build. Leave a note on any cue that should change.</p><div class="grid">
${data.cues.map((c, k) => `<section class="card"><img src="${esc(c.frame)}" alt=""><div class="meta"><span class="tc">${esc(fmt(c.at))}</span> · ${esc(c.kind)}/${esc(c.layout)}<br><strong>${esc(c.what)}</strong><textarea data-k="${k}" placeholder="Exact change for this cue"></textarea></div></section>`).join('')}
</div><div class="bar"><label><input id="ok" type="checkbox"> Visual flow approved — go to full build</label><span style="flex:1"></span><button id="save">Save notes</button></div></main>
<script>const DATA=${JSON.stringify(data)};document.getElementById('save').onclick=()=>{const notes=[...document.querySelectorAll('textarea')].map(el=>({k:+el.dataset.k,text:el.value.trim()})).filter(x=>x.text).map(x=>({t:DATA.cues[x.k].at,insert:DATA.cues[x.k].id,text:x.text}));const out={name:DATA.name,plan:DATA.plan,duration:DATA.duration,approved:document.getElementById('ok').checked,stage:'board',notes};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}));a.download=DATA.name+'.review.json';a.click()}</script></body></html>`;
}
