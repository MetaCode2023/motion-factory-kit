#!/usr/bin/env node
// tools/stills.mjs: a contact sheet of stills at chosen times, for checking a scene quickly.
//   node tools/stills.mjs <scene.html> <out.png> 1.2 4.5 9 [--cols 6] [--width 360]
import { open } from '../engines/skia.mjs';
import { Canvas, loadImage } from 'skia-canvas';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? +args[i + 1] : d; };
const [scene, out, ...rest] = args.filter((a, i) => !a.startsWith('--') && !['--cols', '--width'].includes(args[i - 1]));
const times = rest.map(Number);
const eng = await open(scene);
const tw = opt('width', 360), cols = opt('cols', Math.min(6, times.length)), th = Math.round(tw * eng.V.height / eng.V.width);
const rows = Math.ceil(times.length / cols), pad = 8;
const sheet = new Canvas(cols * (tw + pad) + pad, rows * (th + pad) + pad), c = sheet.getContext('2d');
c.fillStyle = '#777'; c.fillRect(0, 0, sheet.width, sheet.height);
for (const [i, t] of times.entries()) {
  const img = await loadImage(await eng.still(t));
  c.drawImage(img, pad + (i % cols) * (tw + pad), pad + Math.floor(i / cols) * (th + pad), tw, th);
}
writeFileSync(out, await sheet.toBuffer('png'));
console.log(out);
