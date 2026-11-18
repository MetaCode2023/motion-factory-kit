// tools/longform/vertical.mjs: a native 9:16 Short from a long-form plan built with captions off.
// Title on top, the 16:9 visuals full width, the speaker in a big circle under them, big word captions
// (key words pop) in the lower third. Usage:
//   node tools/longform/vertical.mjs edits/longform/<short-plan>.json "Title text" [--accent #hex] [--emphasis a,b,c]
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, ROOT, bare } from './common.mjs';
import { loadPlan, resolvePlan } from './plan.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const accent = opt('--accent', '#FFB547');
const EMPH = new Set(opt('--emphasis', '').split(',').filter(Boolean).map(bare));
const [planFile, title = ''] = args;
const plan = loadPlan(planFile), R = resolvePlan(plan);
const dir = join(ROOT, 'out', 'longform', plan.name);
const src = join(dir, `${plan.name}.mp4`), face = join(dir, 'media', 'a-roll.mp4');
for (const f of [src, face]) if (!existsSync(f)) { console.error(`missing ${f}: build the plan first`); process.exit(1); }

const bgr = (hex) => { const h = hex.replace('#', ''); return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase(); };
const ts = (s) => { const cs = Math.round(Math.max(0, s) * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const esc = (t) => t.replace(/[{}\\]/g, '');
// Captions: 1-3 words at a time, the word being said in the accent colour, key words pop.
const groups = []; let cur = [];
R.words.forEach((w, i) => {
  cur.push(w); const next = R.words[i + 1];
  if (cur.length >= 3 || /[.?!,]$/.test(w.w) || cur.map((x) => x.w).join(' ').length > 16 || (next && next.s - w.e > 0.35)) { groups.push(cur); cur = []; }
});
if (cur.length) groups.push(cur);
const ev = [];
groups.forEach((g, gi) => {
  const end = Math.min(g[g.length - 1].e + 0.2, groups[gi + 1]?.[0].s ?? Infinity);
  g.forEach((w, k) => {
    const a = w.s, b = k + 1 < g.length ? g[k + 1].s : end;
    const text = g.map((x, j) => {
      const t = esc(x.w.toUpperCase());
      if (j !== k) return t;
      return EMPH.has(bare(x.w)) ? `{\\c${bgr(accent)}\\fscx100\\fscy100\\t(0,110,\\fscx135\\fscy135)\\t(110,240,\\fscx122\\fscy122)}${t}{\\c&HFFFFFF&\\fscx100\\fscy100}` : `{\\c${bgr(accent)}}${t}{\\c&HFFFFFF&}`;
    }).join(' ');
    ev.push(`Dialogue: 1,${ts(a)},${ts(b)},C,,0,0,0,,${text}`);
  });
});
// Title, wrapped to two lines, with the accent word(s) after a "|" in the title string coloured.
const [tMain, tAcc = ''] = title.split('|').map((s) => s.trim());
const titleText = esc([tMain, tAcc].filter(Boolean).join(' ')).replace(tAcc ? new RegExp(tAcc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : /$^/, (m) => `{\\c${bgr(accent)}}${m}{\\c&HFFFFFF&}`);
ev.unshift(`Dialogue: 0,${ts(0)},${ts(R.total + 1)},T,,0,0,0,,${titleText}`);
const ass = join(dir, `${plan.name}.vertical.ass`);
writeFileSync(ass, ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', 'WrapStyle: 0', '', '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: C,Plus Jakarta Sans,96,&H00FFFFFF,&H00FFFFFF,&H00101010,&H90000000,-1,0,0,0,100,100,0,0,1,6,2,5,70,70,0,1',
  'Style: T,Plus Jakarta Sans,74,&H00FFFFFF,&H00FFFFFF,&H00101010,&H00000000,-1,0,0,0,100,100,0,0,1,5,0,8,80,80,200,1',
  '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ...ev.map((e) => e.startsWith('Dialogue: 1') ? e.replace(',C,,0,0,0,,', ',C,,0,0,0,,{\\pos(540,1580)}') : e)].join('\n') + '\n');

const D = 420;   // face circle
const fontsDir = join(ROOT, 'fonts');
const fc = [
  `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:2,eq=brightness=-0.32:saturation=0.8[bg]`,
  `[0:v]scale=1080:608[top]`,
  `[1:v]crop=ih:ih:(iw-ih)/2:0,scale=${D}:${D},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-${D / 2},Y-${D / 2}),${D / 2 - 2}),255,0)'[face]`,
  `color=c=${accent}:s=${D + 16}x${D + 16},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-${(D + 16) / 2},Y-${(D + 16) / 2}),${(D + 16) / 2 - 1}),255,0)'[ring]`,
  `[bg][top]overlay=0:420[a]`, `[a][ring]overlay=(W-w)/2:1052:shortest=1[b]`, `[b][face]overlay=(W-w)/2:1060[c]`,
  `[c]ass=${ass}:fontsdir=${fontsDir}[v]`,
];
const out = join(dir, `${plan.name}.vertical.mp4`);
const r = spawnSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-i', face, '-filter_complex', fc.join(';'), '-map', '[v]', '-map', '0:a',
  '-t', String(R.total), '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { stdio: 'inherit' });
if (r.status) process.exit(r.status);
console.log(out);
