// Run the optional, pinned browser renderer through npm on any supported OS.
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, [
  process.env.npm_execpath, 'exec', '--yes', '--package=hyperframes@0.9.80', '--',
  'hyperframes', ...process.argv.slice(2),
], {
  stdio: 'inherit',
  env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' },
});

if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
