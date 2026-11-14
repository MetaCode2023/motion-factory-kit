// tools/longform/stock.mjs: download free stock B-roll for every `"stock": "<search>"` insert in a plan.
//
//   PEXELS_API_KEY=... node longform.mjs stock edits/longform/x.json
//
// Pexels videos are free to use (credit appreciated; https://www.pexels.com/license/). The best landscape
// match of at least 1280 px wide is saved to assets/broll/<insert id>.mp4 and credited in
// assets/broll/CREDITS.md (paste those lines into the video description). Get a free key at
// https://www.pexels.com/api/. Existing files are kept; delete one to fetch again, or set "pick": 2 on
// the insert to take the second result.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './common.mjs';
import { loadPlan } from './plan.mjs';

export async function stock(planFile, { log = console.log } = {}) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return { ok: false, error: 'set PEXELS_API_KEY (free: https://www.pexels.com/api/)' };
  const plan = loadPlan(planFile);
  const dir = join(ROOT, 'assets', 'broll');
  mkdirSync(dir, { recursive: true });
  const done = [], failed = [];
  for (const [i, ins] of (plan.inserts || []).entries()) {
    if (!ins.stock) continue;
    const id = ins.id || `${ins.kind}-${i + 1}`;
    const out = join(dir, `${id}.mp4`);
    if (existsSync(out)) { log(`  ${id}: already saved`); continue; }
    const q = new URLSearchParams({ query: ins.stock, orientation: 'landscape', size: 'medium', per_page: '10' });
    const res = await fetch(`https://api.pexels.com/videos/search?${q}`, { headers: { Authorization: key } });
    if (!res.ok) { failed.push(`${id}: Pexels ${res.status}`); continue; }
    const vids = ((await res.json()).videos || []).filter((v) => v.duration >= (ins.dur || 4) && v.width >= v.height);
    const v = vids[Math.max(0, (ins.pick || 1) - 1)];
    if (!v) { failed.push(`${id}: no landscape results for "${ins.stock}"`); continue; }
    const files = (v.video_files || []).filter((f) => f.file_type === 'video/mp4' && f.width >= 1280).sort((a, b) => Math.abs(a.width - 1920) - Math.abs(b.width - 1920));
    const f = files[0] || v.video_files?.[0];
    if (!f) { failed.push(`${id}: no mp4 file`); continue; }
    const dl = await fetch(f.link);
    if (!dl.ok) { failed.push(`${id}: download ${dl.status}`); continue; }
    writeFileSync(out, Buffer.from(await dl.arrayBuffer()));
    appendFileSync(join(dir, 'CREDITS.md'), `- ${id}: video by ${v.user?.name || 'unknown'} on Pexels, ${v.url}\n`);
    log(`  ${id}: "${ins.stock}" -> ${f.width}x${f.height}, ${v.duration}s by ${v.user?.name}`);
    done.push(id);
  }
  return { ok: !failed.length, saved: done, failed, credits: join(dir, 'CREDITS.md') };
}

// Pulls with a url (and from/to) can be fetched with yt-dlp when it's installed, cutting only that
// section. Whether a clip is fine to use is the creator's call: keep borrowed clips short, talk over
// them, credit the source. Saved as assets/broll/<id>.mp4, which the next build uses automatically.
export async function pull(planFile, { log = console.log } = {}) {
  const { spawnSync } = await import('node:child_process');
  const ytdlp = ['yt-dlp', 'yt-dlp.exe'].find((b) => spawnSync(b, ['--version']).status === 0);
  if (!ytdlp) return { ok: false, error: 'yt-dlp not installed (pip install yt-dlp); or download the clips by hand into assets/broll/' };
  const plan = loadPlan(planFile);
  const dir = join(ROOT, 'assets', 'broll');
  mkdirSync(dir, { recursive: true });
  const saved = [], skipped = [], failed = [];
  for (const [i, ins] of (plan.inserts || []).entries()) {
    if (ins.kind !== 'pull') continue;
    const id = ins.id || `${ins.kind}-${i + 1}`, out = join(dir, `${id}.mp4`);
    if (existsSync(out)) continue;
    if (!ins.url) { skipped.push(`${id}: no url yet (search: ${ins.search || '?'})`); continue; }
    const from = ins.from || '0', to = ins.to || null;
    const args = ['-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b', '--merge-output-format', 'mp4', '-o', out, '--no-playlist'];
    if (to) args.push('--download-sections', `*${from}-${to}`, '--force-keyframes-at-cuts');
    const r = spawnSync(ytdlp, [...args, ins.url], { encoding: 'utf8' });
    if (r.status === 0 && existsSync(out)) { saved.push(id); appendFileSync(join(dir, 'CREDITS.md'), `- ${id}: ${ins.title || ''} ${ins.url} (${from}-${to || 'end'})\n`); log(`  ${id}: saved ${from}-${to || 'end'} of ${ins.url}`); }
    else failed.push(`${id}: ${(r.stderr || '').trim().split('\n').pop()}`);
  }
  return { ok: !failed.length, saved, skipped, failed };
}
