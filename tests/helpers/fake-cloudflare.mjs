// Preloaded into a `sim` child process (node --import): replaces fetch so D1 is a local SQLite file and Clef is a canned answer.
// No other URL is reachable. Env: FAKE_D1_FILE, FAKE_CLEF_FILE, FAKE_CLEF_FAIL, FAKE_LOG.
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, readFileSync } from 'node:fs';

const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (/\/d1\/database\/[^/]+\/query$/.test(u)) {
    const { sql, params } = JSON.parse(init.body);
    const db = new DatabaseSync(process.env.FAKE_D1_FILE);
    db.exec('PRAGMA foreign_keys = ON');
    try {
      const st = db.prepare(sql);
      if (st.columns().length) return reply({ success: true, result: [{ results: st.all(...params).map((r) => ({ ...r })), meta: { changes: 0 } }] });
      const r = st.run(...params);
      return reply({ success: true, result: [{ results: [], meta: { changes: Number(r.changes) } }] });
    } catch (e) {
      return reply({ success: false, errors: [{ message: e.message }] });
    } finally { db.close(); }
  }
  if (u.endsWith('/ai/run/@cf/cloudflare/clef-omni')) {
    const body = JSON.parse(init.body);
    appendFileSync(process.env.FAKE_LOG, JSON.stringify({
      questions: Object.keys(body.questions), videos: body.videos.length, base64_lengths: body.videos.map((v) => v.base64.length),
      content_types: body.videos.map((v) => v.content_type), auth_ok: init.headers?.Authorization === 'Bearer tok-SECRET-123',
    }) + '\n');
    if (process.env.FAKE_CLEF_FAIL === '1') return reply({ success: false, errors: [{ message: 'boom' }] });
    return reply(JSON.parse(readFileSync(process.env.FAKE_CLEF_FILE, 'utf8')));
  }
  throw new Error('unexpected network call: ' + u.split('?')[0]);
};
