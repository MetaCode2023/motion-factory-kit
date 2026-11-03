#!/usr/bin/env node
// tools/demo.mjs (npm run demo): the footage editor end to end on examples/demo, no API keys.
// index the demo clips -> build the three demo plans -> out/demo/ with ads, DELIVERY.csv, review.html.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const env = { ...process.env, FOOTAGE_DIR: join(ROOT, 'out', 'demo-footage') };
delete env.ELEVENLABS_API_KEY;                      // the demo shows the no-key path
const run = (args) => {
  const r = spawnSync(process.execPath, [join(ROOT, 'footage.mjs'), ...args], { cwd: ROOT, env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
};
rmSync(env.FOOTAGE_DIR, { recursive: true, force: true });
run(['index', join(ROOT, 'examples', 'demo', 'footage')]);
run(['build', join(ROOT, 'examples', 'demo', 'edits'), '--batch', 'demo', '--variants', ...(process.argv.includes('--full') ? [] : ['--fast'])]);
console.log('\nOpen out/demo/review.html to see the review page, or out/demo/*.mp4 for the ads.');
