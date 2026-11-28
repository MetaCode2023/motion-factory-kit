#!/usr/bin/env node
// refine/compare-paths.mjs: Phase 7 demonstration. Compares finished renders of the same shot made
// by different pipelines against the contract's lookdev plates at every keyframe:
//
//   node refine/compare-paths.mjs <contract.json> <label>=<video.mp4> ... [--out dir]
//
// Writes <out>/COMPARISON.md (measured gaps per keyframe and criterion, open delta counts) and
// <out>/comparison.png (each path's keyframes next to the plates). The numbers are measurements
// against the plates, not quality scores; the visual verdicts live in each run's critiques.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';
import ffmpegPath from 'ffmpeg-static';
import { ROOT } from './loop.mjs';
import { loadPixels, measure, falseSuccess } from './pixels.mjs';
import { checkTargets, compareToReference, distance, genericity } from './delta.mjs';
import { CRITERIA, sha256 } from './contract.mjs';

FontLibrary.use('Refine', [join(ROOT, 'fonts', 'plus-jakarta-sans-latin-600-normal.woff2')]);
const args = process.argv.slice(2);
const outDir = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : join(ROOT, 'out', 'refine', 'demo'));
const [contractFile, ...rest] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
const C = JSON.parse(readFileSync(contractFile, 'utf8'));
const paths = rest.map((p) => { const [label, file] = p.split('='); return { label, file: resolve(file) }; });
mkdirSync(join(outDir, 'frames'), { recursive: true });

const rows = [];
for (const p of paths) {
  const r = { ...p, sha256: sha256(readFileSync(p.file)), frames: [] };
  for (const k of C.keyframes) {
    const png = join(outDir, 'frames', `${p.label}-${k.t}.png`);
    spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(k.t), '-i', p.file, '-frames:v', '1', png]);
    const m = measure(await loadPixels(png));
    const ref = C.references.find((x) => x.id === k.reference);
    const rm = measure(await loadPixels(join(ROOT, ref.path)));
    const items = [...compareToReference(m, rm), ...checkTargets(m, C.design?.targets), ...genericity(m)];
    r.frames.push({ t: k.t, reference: ref.id, png, items, distance: distance(items), falseSuccess: falseSuccess(m) });
  }
  r.distance = Math.round(r.frames.reduce((s, f) => s + f.distance, 0) / r.frames.length * 1000) / 1000;
  r.byCriterion = Object.fromEntries(CRITERIA.map((c) => [c, r.frames.flatMap((f) => f.items).filter((i) => i.criterion === c && !i.pass && (i.kind === 'genericity' || i.gap > 2)).length]));
  r.open = r.frames.flatMap((f) => f.items).filter((i) => !i.pass).length;
  rows.push(r);
}

// Sheet: one row per path plus the plates.
const tw = 480, th = 270, pad = 8, lab = 34;
const c = new Canvas(pad + C.keyframes.length * (tw + pad), (rows.length + 1) * (th + lab + pad) + pad);
const x = c.getContext('2d');
x.fillStyle = '#1c1c1c'; x.fillRect(0, 0, c.width, c.height);
x.font = '600 20px Refine'; x.fillStyle = '#eee';
const plates = await Promise.all(C.keyframes.map((k) => loadImage(readFileSync(join(ROOT, C.references.find((r) => r.id === k.reference).path)))));
for (const [ri, row] of [...rows.map((r) => ({ label: r.label, imgs: r.frames.map((f) => f.png) })), { label: 'REFERENCE PLATES', imgs: null }].entries()) {
  const y0 = pad + ri * (th + lab + pad);
  x.fillStyle = '#eee'; x.fillText(row.label, pad, y0 + 24);
  for (let i = 0; i < C.keyframes.length; i++) {
    const img = row.imgs ? await loadImage(readFileSync(row.imgs[i])) : plates[i];
    x.drawImage(img, pad + i * (tw + pad), y0 + lab, tw, th);
    x.fillStyle = 'rgba(0,0,0,0.55)'; x.fillRect(pad + i * (tw + pad), y0 + lab, 92, 26);
    x.fillStyle = '#eee'; x.fillText(`t=${C.keyframes[i].t}s`, pad + i * (tw + pad) + 6, y0 + lab + 20);
  }
}
writeFileSync(join(outDir, 'comparison.png'), await c.toBuffer('png'));

const md = [`# Three-path comparison: ${C.shot.id}`, '',
  'Measured against the contract\'s lookdev plates at each keyframe. "Distance" is the mean capped gap used for early stopping, not a quality score; "hard blocks" are measured gaps beyond 2x tolerance (or generic-default tripwires) per criterion. Visual verdicts come from the isolated critiques in each run.', '',
  `| Path | Video sha256 | Distance | Open measured deltas | ${CRITERIA.map((c) => `${c} blocks`).join(' | ')} |`,
  `|---|---|---|---|${CRITERIA.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.label} | \`${r.sha256.slice(0, 12)}\` | ${r.distance} | ${r.open} | ${CRITERIA.map((c) => r.byCriterion[c]).join(' | ')} |`), '',
  ...rows.flatMap((r) => [`## ${r.label}`, '', ...r.frames.map((f) => `- t=${f.t}s vs ${f.reference}: distance ${f.distance}; failing ${f.items.filter((i) => !i.pass).map((i) => `${i.metric} (${i.gap}x)`).join(', ') || 'none'}${f.falseSuccess.length ? '; FALSE-SUCCESS: ' + f.falseSuccess.join('; ') : ''}`), '']),
  '![comparison](comparison.png)', ''];
writeFileSync(join(outDir, 'COMPARISON.md'), md.join('\n'));
console.log(JSON.stringify(rows.map((r) => ({ label: r.label, distance: r.distance, open: r.open, byCriterion: r.byCriterion }))));
