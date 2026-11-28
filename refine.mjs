#!/usr/bin/env node
// refine.mjs: command line for the visual refinement loop (refine/loop.mjs, docs/VISUAL-REFINEMENT.md).
// Every command prints one JSON line with --json (the MCP server and daily.py read that).
//
//   node refine.mjs ingest <plate.png>                 sha256 + size, for writing a contract
//   node refine.mjs init <contract.json> [--run dir]   step 1: validate, copy + measure the plates
//   node refine.mjs still <run> [--params p.json | --set k=v ...] [--note "..."]
//                                                      steps 2-4 (+ measured deltas); writes the critique packet
//   node refine.mjs critique <run> <critique.json>     steps 5-9: rubric, delta log, hash re-verify, approval gate
//   node refine.mjs critic <run>                       run the isolated critic as a separate Claude Code
//                                                      session on your subscription (no API key passed)
//   node refine.mjs temporal <run> [--params ... | --set k=v]   phase 4: low-res preview + temporal checks
//   node refine.mjs restore <run> <n>                  restore iteration n (verified), revoking approvals
//   node refine.mjs verify <run> [--phase still|temporal]
//   node refine.mjs status <run>
//   node refine.mjs final <run> [--out file.mp4]       full-res render of the approved state
//   node refine.mjs bundle <run> [--dest dir]          evidence bundle (manifest + summary)
//   node refine.mjs verify-bundle <dir>
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import * as L from './refine/loop.mjs';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const args = argv.filter((a) => a !== '--json');
const opt = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : undefined; };
const sets = () => args.flatMap((a, i) => (args[i - 1] === '--set' ? [a] : []));
const pos = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const [cmd, a1, a2] = pos;
const runDir = (p) => resolve(p);

function params(base) {
  let p = null;
  const file = opt('params');
  if (file) p = JSON.parse(existsSync(file) ? readFileSync(file, 'utf8') : file);
  const kv = sets();
  if (kv.length) {
    p = { ...(p || base || {}) };
    for (const s of kv) { const [k, ...v] = s.split('='); const raw = v.join('='); p[k] = raw === '' || isNaN(Number(raw)) ? raw : Number(raw); }
  }
  return p;
}
function currentParams(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')).params; } catch { return {}; }
}

function out(obj, code = 0) {
  if (json) console.log(JSON.stringify(obj));
  else console.log(JSON.stringify(obj, null, 2));
  process.exitCode = code;
}

try {
  switch (cmd) {
    case 'ingest': out({ ok: true, path: a1, ...(await L.ingestReference(a1)) }); break;
    case 'init': {
      const r = await L.init({ contract: JSON.parse(readFileSync(a1, 'utf8')), runDir: opt('run') });
      out({ ok: true, runDir: r.runDir, contractHash: r.contractHash, resumed: r.resumed });
      break;
    }
    case 'still': out({ ok: true, ...(await L.iterate(runDir(a1), { params: params(currentParams(runDir(a1))), note: opt('note') || '' })) }); break;
    case 'critique': {
      const r = L.recordCritique(runDir(a1), JSON.parse(readFileSync(a2, 'utf8')));
      out({ ...r, status: L.summary(runDir(a1)) }, r.ok ? 0 : 1);
      break;
    }
    case 'critic': {
      // A separate, restricted Claude Code session that sees only the packet folder. It runs on the
      // logged-in subscription: ANTHROPIC_API_KEY and other credentials are removed from its env.
      const s = L.summary(runDir(a1));
      if (!s.current?.packet) throw new L.RefineError('no critique packet waiting', 'not-awaiting');
      const dir = join(L.ROOT, s.current.packet);
      const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/ANTHROPIC_|API_KEY|TOKEN|SECRET|PASSWORD|BWS_|CLOUDFLARE/i.test(k)));
      const claude = process.env.CLAUDE_BIN || 'claude';
      const r = spawnSync(claude, ['-p', 'Read CRITIC.md in this folder and do exactly what it says.', '--tools', 'Read,Write', '--allowedTools', 'Read', 'Write(critique.json)',
        '--permission-mode', 'dontAsk', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], { cwd: dir, env, encoding: 'utf8', timeout: 20 * 60 * 1000 });
      if (r.error) throw new L.RefineError(`could not start the critic session (${r.error.message}); run CRITIC.md in ${dir} with any isolated reviewer and pass critique.json to "refine critique"`, 'critic-unavailable');
      const file = join(dir, 'critique.json');
      if (!existsSync(file)) throw new L.RefineError('critic session ended without writing critique.json: ' + (r.stdout || r.stderr).slice(-500), 'critic-failed');
      const rec = L.recordCritique(runDir(a1), JSON.parse(readFileSync(file, 'utf8')));
      out({ ...rec, status: L.summary(runDir(a1)) }, rec.ok ? 0 : 1);
      break;
    }
    case 'temporal': out({ ok: true, ...(await L.temporal(runDir(a1), { params: params(currentParams(runDir(a1))), note: opt('note') || '' })) }); break;
    case 'restore': out(L.restore(runDir(a1), Number(a2))); break;
    case 'verify': { const r = L.verifyApproval(runDir(a1), opt('phase') || 'still'); out({ ...r, chain: L.verifyChain(runDir(a1)) }, r.ok ? 0 : 1); break; }
    case 'status': out(L.summary(runDir(a1))); break;
    case 'final': out({ ok: true, ...(await L.finalRender(runDir(a1), { out: opt('out') })) }); break;
    case 'bundle': out({ ok: true, ...L.exportBundle(runDir(a1), { dest: opt('dest') }) }); break;
    case 'verify-bundle': { const r = L.verifyBundle(resolve(a1)); out(r, r.ok ? 0 : 1); break; }
    default:
      console.error('usage: node refine.mjs <ingest|init|still|critique|critic|temporal|restore|verify|status|final|bundle|verify-bundle> ...  (see the header)');
      process.exitCode = 2;
  }
} catch (e) {
  out({ ok: false, error: e.message, code: e.code || 'error' }, 1);
}
