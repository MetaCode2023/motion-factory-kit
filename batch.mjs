#!/usr/bin/env node
// batch.mjs: render every scene in one or more folders, one at a time.
//   node batch.mjs scenes/examples scenes/mine [--gif] [--sheet]
// Extra flags are passed through to render.mjs. Output mirrors the folder: out/<folder>/<scene>.mp4
import { readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const dirs = args.filter((a) => !a.startsWith('--'));
const pass = args.filter((a) => a.startsWith('--'));
const scenes = dirs.flatMap((d) => statSync(d).isDirectory()
  ? readdirSync(d).filter((f) => f.endsWith('.html')).sort().map((f) => join(d, f))
  : [d]);

const failed = [];
const t0 = Date.now();
for (const s of scenes) {
  const out = join('out', basename(join(s, '..')), basename(s, '.html') + '.mp4');
  const r = spawnSync(process.execPath, ['render.mjs', s, '--out', out, ...pass], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(s);
}
console.log(`\n${scenes.length - failed.length}/${scenes.length} rendered in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
if (failed.length) { console.log('FAILED:\n  ' + failed.join('\n  ')); process.exit(1); }
