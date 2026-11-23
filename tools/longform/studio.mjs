// tools/longform/studio.mjs: talk to the creator's Studio Engine (their private archive behind Cloudflare Access).
//
// Set STUDIO_URL (in the shell or in the git-ignored .env: STUDIO_URL=https://...). Sign-in is Cloudflare Access:
// either STUDIO_ACCESS_TOKEN, or `cloudflared` signed in once with `cloudflared access login <STUDIO_URL>` (it opens
// the browser for the same Google sign-in as the website); the kit then asks cloudflared for a fresh token.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './common.mjs';

function fromDotEnv(key) {
  const f = join(ROOT, '.env');
  if (!existsSync(f)) return '';
  const line = readFileSync(f, 'utf8').split(/\r?\n/).find((l) => l.trim().startsWith(key + '='));
  return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : '';
}

export function studioUrl() {
  const url = process.env.STUDIO_URL || fromDotEnv('STUDIO_URL');
  if (!url) throw new Error('set STUDIO_URL (the Studio Engine address) in your shell or in .env');
  return new URL(url).origin;
}

export function studioToken(url) {
  const t = process.env.STUDIO_ACCESS_TOKEN || fromDotEnv('STUDIO_ACCESS_TOKEN');
  if (t) return t;
  const r = spawnSync('cloudflared', ['access', 'token', `-app=${url}`], { encoding: 'utf8' });
  const token = (r.stdout || '').trim();
  if (r.error) throw new Error(`Studio sign-in needs cloudflared: \`brew install cloudflared\`, then \`cloudflared access login ${url}\` once`);
  if (r.status !== 0 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new Error(`not signed in to the Studio: run \`cloudflared access login ${url}\` once (it opens your browser)`);
  return token;
}

/** POST JSON to a Studio API path, signed in. */
export async function studioPost(path, body, { fetcher = fetch, url = studioUrl(), token = studioToken(url) } = {}) {
  const res = await fetcher(url + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url, 'x-studio-request': '1', 'cf-access-token': token },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) throw new Error(`the Studio sent us to sign in: run \`cloudflared access login ${url}\``);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`Studio ${path}: ${res.status} ${data?.error || text.slice(0, 120)}`);
  return data;
}

/** Ask the Studio where these sentences were said before (meaning search over the archive). */
export async function studioEchoes(sentences, { before, min = 0.5, top = 5, ...o } = {}) {
  const r = await studioPost('/api/writer/echoes', { sentences, before, min, top }, o);
  return r?.matches || [];
}
