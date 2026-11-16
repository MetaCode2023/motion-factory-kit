#!/usr/bin/env node
// content.mjs: the content engine. One folder per brand (brands/<name>/, git-ignored), one plan per week.
// The engine keeps the structure and the state; the agent does the judgment (which ideas, what hook, the
// script) and builds each video with the tools already in this repo.
//
//   node content.mjs init <brand>                 # start a brand from brands/example
//   node content.mjs idea <brand> "text" [--pillar p] [--source s]
//   node content.mjs plan <brand> [--week 2026-W47]   # this week's slots, filled from the idea inbox
//   node content.mjs check <brand>                # what is missing before review (PASS / FIX)
//   node content.mjs review <brand>               # one page to approve or reject the week's posts
//   node content.mjs apply <brand> <review.json>  # record the decisions and notes
//   node content.mjs queue <brand>                # approved posts waiting to be scheduled
//   node content.mjs mark <brand> <id> scheduled|posted [--url u]
//   node content.mjs report <brand>               # where every post of the week stands
//
// Add --json for a machine-readable last line. Details: docs/CONTENT.md.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BRANDS = process.env.CONTENT_BRANDS || join(ROOT, 'brands');
export const FORMATS = { short: 'a 15-45 s vertical motion explainer (make.mjs)', ad: 'an ad-style clip from a template or raw footage', long: 'a 5-20 min YouTube video (longform.mjs)', shorts: 'vertical cuts from a long video (longform.mjs shorts)', overlay: 'a finished clip with graphics and a hook added (overlays)' };
const STATES = ['planned', 'built', 'approved', 'rejected', 'scheduled', 'posted'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(), w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
const dirOf = (brand) => join(BRANDS, brand);
export function loadBrand(brand) {
  const f = join(dirOf(brand), 'brand.json');
  if (!existsSync(f)) throw new Error(`no brand "${brand}" (node content.mjs init ${brand}). Brands: ${existsSync(BRANDS) ? readdirSync(BRANDS).filter((x) => existsSync(join(BRANDS, x, 'brand.json'))).join(', ') : 'none'}`);
  return JSON.parse(readFileSync(f, 'utf8'));
}
const planFile = (brand, week) => join(dirOf(brand), 'weeks', week, 'plan.json');
export function loadPlan(brand, week) {
  const f = planFile(brand, week);
  if (!existsSync(f)) throw new Error(`no plan for ${brand} ${week} (node content.mjs plan ${brand})`);
  return JSON.parse(readFileSync(f, 'utf8'));
}
const savePlan = (brand, plan) => { const f = planFile(brand, plan.week); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(plan, null, 2) + '\n'); return f; };

export function readIdeas(brand) {
  const f = join(dirOf(brand), 'ideas.md');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').map((line, n) => {
    const m = line.match(/^- \[( |x)\] (.+)$/); if (!m) return null;
    const [text, ...rest] = m[2].split('|').map((s) => s.trim()), meta = Object.fromEntries(rest.map((r) => r.split(':').map((s) => s.trim())).filter((p) => p.length === 2));
    return { n, used: m[1] === 'x', text, pillar: meta.pillar || '', source: meta.source || '' };
  }).filter(Boolean);
}
function tickIdeas(brand, lines) {
  const f = join(dirOf(brand), 'ideas.md'), L = readFileSync(f, 'utf8').split('\n');
  lines.forEach((n) => { L[n] = L[n].replace('- [ ]', '- [x]'); });
  writeFileSync(f, L.join('\n'));
}

// The week's slots: one per channel post, pillars spread by their share, each filled with the first unused
// idea of that pillar (or left open for the agent to propose one).
export function makePlan(brand, week, B = loadBrand(brand), ideas = readIdeas(brand)) {
  const slots = [];
  for (const ch of B.channels || []) for (let k = 0; k < (ch.per_week || 0); k++) slots.push({ channel: ch.name, format: ch.format || 'short' });
  const pillars = B.pillars?.length ? B.pillars : [{ name: 'general', share: 1 }];
  const total = pillars.reduce((a, p) => a + (p.share || 0), 0) || 1;
  const counts = pillars.map(() => 0), free = ideas.filter((i) => !i.used), taken = [];
  const posts = slots.map((s, k) => {
    // the pillar furthest behind its share so far
    const pi = pillars.map((p, i) => ({ i, lag: ((p.share || 0) / total) * (k + 1) - counts[i] })).sort((a, b) => b.lag - a.lag)[0].i;
    counts[pi]++;
    const idea = free.find((i) => !taken.includes(i) && (i.pillar === pillars[pi].name || !i.pillar)) || null;
    if (idea) taken.push(idea);
    return { id: `${week.slice(5).toLowerCase()}-${String(k + 1).padStart(2, '0')}`, channel: s.channel, format: s.format, pillar: pillars[pi].name, idea: idea?.text || '', source: idea?.source || '', hook: '', caption: '', video: '', status: 'planned', notes: '' };
  });
  return { plan: { brand, week, posts }, used: taken.map((i) => i.n) };
}

export function checkPlan(brand, plan) {
  const out = [], fix = (id, t) => out.push(`FIX  ${id}: ${t}`);
  for (const p of plan.posts) {
    if (!p.idea) fix(p.id, 'no idea yet (propose one from the pillar, or add to the inbox)');
    if (!FORMATS[p.format]) fix(p.id, `format "${p.format}" is not one of ${Object.keys(FORMATS).join(', ')}`);
    if (!p.hook) fix(p.id, 'no hook (the first line on screen, 12 words or fewer)');
    else if (p.hook.trim().split(/\s+/).length > 12) fix(p.id, `hook is ${p.hook.trim().split(/\s+/).length} words (12 or fewer)`);
    if (p.status !== 'planned') {
      if (!p.video || !existsSync(resolve(ROOT, p.video))) fix(p.id, `video not found: ${p.video || '(none)'}`);
      if (!p.caption) fix(p.id, 'no caption (hook, one line of value, the call to action, 3-5 hashtags)');
    }
  }
  const hooks = plan.posts.map((p) => p.hook.toLowerCase().trim()).filter(Boolean);
  if (new Set(hooks).size < hooks.length) out.push('FIX  two posts share the same hook');
  return { ok: !out.length, fixes: out, built: plan.posts.filter((p) => p.status !== 'planned').length, total: plan.posts.length };
}

export function writeReview(brand, plan, B = loadBrand(brand)) {
  const dir = dirname(planFile(brand, plan.week));
  const posts = plan.posts.filter((p) => p.status !== 'planned').map((p) => ({ ...p, src: p.video ? relative(dir, resolve(ROOT, p.video)).replace(/\\/g, '/') : '' }));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(B.name)}: ${esc(plan.week)}</title>
<style>:root{--bg:#0d0f14;--card:#171a22;--ink:#eef0f5;--mut:#8b93a5;--acc:${esc(B.look?.accent || '#3ce0ff')};--line:#262b38}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:20px}h1{font-size:22px;margin:0 0 4px}.mut{color:var(--mut);font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-top:16px}.post{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}.post.yes{border-color:#38c96f}.post.no{border-color:#e95b5b}
video{width:100%;max-height:420px;border-radius:8px;background:#000}.tag{display:inline-block;font-size:12px;color:var(--mut);border:1px solid var(--line);border-radius:999px;padding:1px 8px;margin:6px 6px 0 0}.cap{white-space:pre-wrap;font-size:14px;margin:8px 0}
textarea{width:100%;min-height:54px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit;font-size:14px}.row{display:flex;gap:8px;margin-top:8px}
button{flex:1;background:transparent;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font:600 14px system-ui;cursor:pointer}button.on{background:var(--acc);color:#04222b;border-color:var(--acc)}#save{position:sticky;bottom:12px;margin-top:18px;width:100%;background:var(--acc);color:#04222b;border:0;padding:12px;font-size:16px}</style></head><body><main>
<h1>${esc(B.name)}: week ${esc(plan.week)}</h1><div class="mut">Watch each post, press Approve or Reject, add a note if something should change. Then press Save decisions and send the file back.</div>
<div class="grid" id="g"></div><button id="save">Save decisions</button></main>
<script>
const POSTS = ${JSON.stringify(posts)}, KEY = 'content:${brand}:${plan.week}';
let D = {}; try { D = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
const store = () => { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) {} };
const g = document.getElementById('g');
POSTS.forEach((p) => {
  D[p.id] = D[p.id] || { decision: '', note: '' };
  const el = document.createElement('div'); el.className = 'post';
  const h = document.createElement('div'); h.style.fontWeight = '600'; h.textContent = p.hook || p.idea;
  const v = document.createElement('video'); v.controls = true; v.playsInline = true; v.src = p.src;
  const tags = document.createElement('div'); [p.channel, p.format, p.pillar].forEach((t) => { const s = document.createElement('span'); s.className = 'tag'; s.textContent = t; tags.append(s); });
  const cap = document.createElement('div'); cap.className = 'cap'; cap.textContent = p.caption;
  const ta = document.createElement('textarea'); ta.placeholder = 'What should change?'; ta.value = D[p.id].note; ta.oninput = () => { D[p.id].note = ta.value; store(); };
  const row = document.createElement('div'); row.className = 'row';
  const mk = (label, val) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { D[p.id].decision = D[p.id].decision === val ? '' : val; store(); paint(); }; row.append(b); return b; };
  const yes = mk('Approve', 'approved'), no = mk('Reject', 'rejected');
  const paint = () => { yes.className = D[p.id].decision === 'approved' ? 'on' : ''; no.className = D[p.id].decision === 'rejected' ? 'on' : ''; el.className = 'post' + (D[p.id].decision === 'approved' ? ' yes' : D[p.id].decision === 'rejected' ? ' no' : ''); };
  el.append(h, v, tags, cap, ta, row); g.append(el); paint();
});
document.getElementById('save').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ brand: '${brand}', week: '${plan.week}', decisions: D }, null, 2)], { type: 'application/json' })); a.download = '${brand}-${plan.week}.review.json'; a.click(); };
</script></body></html>
`;
  const f = join(dir, 'review.html');
  writeFileSync(f, html);
  return f;
}

export function applyReview(brand, plan, review) {
  const changed = [];
  for (const p of plan.posts) {
    const d = review.decisions?.[p.id]; if (!d) continue;
    if (d.note) p.notes = d.note;
    if (d.decision === 'approved' && d.note) { p.status = 'built'; changed.push(`${p.id}: approve after this change: ${d.note}`); }   // a note means not final yet
    else if (d.decision === 'approved') { p.status = 'approved'; changed.push(`${p.id}: approved`); }
    else if (d.decision === 'rejected') { p.status = 'rejected'; changed.push(`${p.id}: rejected${d.note ? ` (${d.note})` : ''}`); }
  }
  return changed;
}

// ---- command line ---------------------------------------------------------------------------------------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, brand, ...rest] = process.argv.slice(2);
  const json = rest.includes('--json'), opt = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
  const args = rest.filter((a, i) => !a.startsWith('--') && !(rest[i - 1] || '').startsWith('--'));
  const emit = (o) => { if (json) console.log(JSON.stringify(o)); }, log = json ? () => {} : console.log;
  const week = opt('week', isoWeek());
  try {
    if (!cmd || !brand) { console.log('usage: node content.mjs init|idea|plan|check|review|apply|queue|mark|report <brand> …   (docs/CONTENT.md)'); process.exitCode = cmd ? 2 : 0; }
    else if (cmd === 'init') {
      if (existsSync(dirOf(brand))) throw new Error(`brands/${brand} already exists`);
      cpSync(join(ROOT, 'brands', 'example'), dirOf(brand), { recursive: true });
      const f = join(dirOf(brand), 'brand.json'), B = JSON.parse(readFileSync(f, 'utf8')); B.name = brand; writeFileSync(f, JSON.stringify(B, null, 2) + '\n');
      writeFileSync(join(dirOf(brand), 'ideas.md'), '# Idea inbox\n\n');
      log(`brands/${brand}/ created. Fill in brand.json (voice, audience, pillars, channels), then add ideas.`);
      emit({ ok: true, dir: dirOf(brand) });
    } else if (cmd === 'idea') {
      loadBrand(brand);
      const text = args.join(' ').trim(); if (!text) throw new Error('give the idea in quotes');
      const f = join(dirOf(brand), 'ideas.md'), line = `- [ ] ${text}${opt('pillar') ? ` | pillar: ${opt('pillar')}` : ''}${opt('source') ? ` | source: ${opt('source')}` : ''}`;
      writeFileSync(f, (existsSync(f) ? readFileSync(f, 'utf8').replace(/\n*$/, '\n') : '# Idea inbox\n\n') + line + '\n');
      log(`added. ${readIdeas(brand).filter((i) => !i.used).length} unused idea(s) in the inbox.`); emit({ ok: true });
    } else if (cmd === 'plan') {
      if (existsSync(planFile(brand, week)) && !rest.includes('--force')) throw new Error(`${week} is already planned (--force to start it over)`);
      const { plan, used } = makePlan(brand, week);
      if (!plan.posts.length) throw new Error('no posts to plan: set per_week on at least one channel in brand.json');
      const f = savePlan(brand, plan); tickIdeas(brand, used);
      log(`${brand} ${week}: ${plan.posts.length} post(s) -> ${relative(ROOT, f)}`);
      plan.posts.forEach((p) => log(`  ${p.id}  ${p.channel.padEnd(10)} ${p.format.padEnd(7)} ${p.pillar.padEnd(8)} ${p.idea || '(open: propose an idea)'}`));
      emit({ ok: true, file: f, plan });
    } else if (cmd === 'check') {
      const r = checkPlan(brand, loadPlan(brand, week));
      r.fixes.forEach((x) => log(x)); log(r.ok ? `PASS  ${r.built}/${r.total} built` : `${r.fixes.length} to fix; ${r.built}/${r.total} built`);
      emit(r); if (!r.ok) process.exitCode = 1;
    } else if (cmd === 'review') {
      const f = writeReview(brand, loadPlan(brand, week)); log(`review page -> ${relative(ROOT, f)}`); emit({ ok: true, file: f });
    } else if (cmd === 'apply') {
      const plan = loadPlan(brand, week), changed = applyReview(brand, plan, JSON.parse(readFileSync(args[0], 'utf8')));
      savePlan(brand, plan); changed.forEach((c) => log('  ' + c)); emit({ ok: true, changed, plan });
    } else if (cmd === 'queue') {
      const q = loadPlan(brand, week).posts.filter((p) => p.status === 'approved');
      q.forEach((p) => log(`  ${p.id}  ${p.channel}  ${p.video}\n      ${p.caption.split('\n')[0]}`)); log(q.length ? `${q.length} approved and waiting to be scheduled` : 'nothing waiting');
      emit({ ok: true, queue: q });
    } else if (cmd === 'mark') {
      const plan = loadPlan(brand, week), p = plan.posts.find((x) => x.id === args[0]), state = args[1];
      if (!p) throw new Error(`no post "${args[0]}" in ${week}`); if (!STATES.includes(state)) throw new Error(`state must be one of ${STATES.join(', ')}`);
      p.status = state; if (opt('url')) p.url = opt('url'); if (opt('video')) p.video = opt('video');
      savePlan(brand, plan); log(`${p.id} -> ${state}`); emit({ ok: true, post: p });
    } else if (cmd === 'report') {
      const plan = loadPlan(brand, week), by = {}; plan.posts.forEach((p) => { by[p.status] = (by[p.status] || 0) + 1; });
      log(`${brand} ${week}: ${Object.entries(by).map(([k, n]) => `${n} ${k}`).join(', ')}`);
      plan.posts.forEach((p) => log(`  ${p.id}  ${p.status.padEnd(9)} ${p.channel.padEnd(10)} ${p.hook || p.idea}${p.url ? `  ${p.url}` : ''}`));
      emit({ ok: true, by, plan });
    } else throw new Error(`unknown command "${cmd}"`);
  } catch (e) { if (json) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error('error: ' + e.message); process.exitCode = 1; }
}
