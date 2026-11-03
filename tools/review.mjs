// tools/review.mjs: the approval loop for a batch of ads.
//
//   writeReview(outdir)        -> outdir/review.html: every ad with its player, hook variants, Approve /
//                                 Needs changes and a notes box. One self-contained page (videos are
//                                 linked next to it), so the folder can go to a client as is (zip, Drive).
//                                 Decisions save in the browser; "Export feedback" downloads review.json.
//   applyFeedback(outdir, fb)  -> FEEDBACK.md (what to change, per ad), approved/ (copies of approved
//                                 files for the media buyer) and the review column in DELIVERY.csv.
//                                 Returns the names of ads that need another cut.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const SIZES = { '': '9:16', '4x5': '4:5', '1x1': '1:1', '16x9': '16:9' };
const parseName = (f) => { const m = f.match(/^(.*?)(?:-v(\d+))?(?:\.(4x5|1x1|16x9))?\.mp4$/); return m && { ad: m[1], variant: m[2] ? +m[2] : 1, size: SIZES[m[3] || ''] }; };

// Ads in a batch folder, from its .mp4 files and DELIVERY.csv (for hooks and angles).
export function batchAds(outdir) {
  const files = readdirSync(outdir).filter((f) => f.endsWith('.mp4')).sort();
  const meta = {};
  const csv = join(outdir, 'DELIVERY.csv');
  if (existsSync(csv)) {
    const [head, ...rows] = parseCSV(readFileSync(csv, 'utf8'));
    for (const r of rows) { const o = Object.fromEntries(head.map((h, i) => [h, r[i]])); if (o.file) meta[o.file] = o; }
  }
  const ads = new Map();
  for (const f of files) {
    const p = parseName(f);
    if (!p) continue;
    if (!ads.has(p.ad)) ads.set(p.ad, { name: p.ad, angle: meta[f]?.angle || '', files: [] });
    const report = join(outdir, f.replace(/(\.(4x5|1x1|16x9))?\.mp4$/, '.report.md'));
    const fixes = existsSync(report) ? (readFileSync(report, 'utf8').match(/^- FIX /gm) || []).length : null;
    ads.get(p.ad).files.push({ file: f, variant: p.variant, size: p.size, hook: meta[f]?.hook || '', checks: fixes == null ? '' : fixes ? `${fixes} to fix` : 'all passed', cover: existsSync(join(outdir, f.replace(/\.mp4$/, '.cover.jpg'))) ? f.replace(/\.mp4$/, '.cover.jpg') : '', rev: Math.round(statSync(join(outdir, f)).mtimeMs) });
  }
  return [...ads.values()];
}

export function writeReview(outdir, { title } = {}) {
  const batch = basename(outdir);
  const ads = batchAds(outdir);
  const data = JSON.stringify({ batch, ads }).replace(/</g, '\\u003c');
  writeFileSync(join(outdir, 'review.html'), PAGE.replace('__TITLE__', esc(title || `${batch}: review`)).replace('__DATA__', data));
  return join(outdir, 'review.html');
}

// fb: the exported review.json ({ batch, reviewer, decisions: { file: { status, note } } }).
export function applyFeedback(outdir, fb) {
  const ads = batchAds(outdir);
  const dec = fb.decisions || {};
  const byAd = ads.map((a) => {
    const ds = a.files.map((f) => ({ ...f, ...(dec[f.file] || {}) }));
    const changes = ds.filter((d) => d.status === 'changes');
    const approved = ds.filter((d) => d.status === 'approved');
    const notes = [...new Set(ds.map((d) => (d.note || '').trim()).filter(Boolean))];
    return { ...a, ds, changes, approved, notes, status: changes.length ? 'changes' : approved.length ? 'approved' : 'pending' };
  });
  const appr = join(outdir, 'approved');
  for (const a of byAd) for (const d of a.approved) {
    mkdirSync(appr, { recursive: true });
    // approving a 9:16 file approves its other sizes too (same cut, same hook)
    for (const f of a.files.filter((f) => f.variant === d.variant)) copyFileSync(join(outdir, f.file), join(appr, f.file));
  }
  const redo = byAd.filter((a) => a.status === 'changes').map((a) => a.name);
  writeFileSync(join(outdir, 'FEEDBACK.md'), [
    `# Feedback on ${fb.batch || basename(outdir)}`, '',
    `${fb.reviewer ? `From ${fb.reviewer}${fb.at ? `, ${fb.at.slice(0, 10)}` : ''}. ` : ''}${byAd.filter((a) => a.status === 'approved').length} approved, ${redo.length} need changes, ${byAd.filter((a) => a.status === 'pending').length} not reviewed.`, '',
    ...(redo.length ? ['## Needs changes', '', 'Edit each plan (edits/<ad>.json) to address the notes, then rebuild only these:', '',
      '```', `node footage.mjs build edits/ --redo ${join('out', basename(outdir), 'review.json')} --batch ${basename(outdir)}`, '```', '',
      ...byAd.filter((a) => a.status === 'changes').flatMap((a) => [`### ${a.name}${a.angle ? ` (${a.angle})` : ''}`, '',
        ...a.changes.map((d) => `- **${d.file}**${d.hook ? ` · hook: "${d.hook}"` : ''}${d.note ? `\n  > ${d.note.replace(/\n/g, '\n  > ')}` : ' (no note)'}`),
        ...(a.approved.length ? [`- approved as is: ${a.approved.map((d) => d.file).join(', ')}`] : []), '']),
    ] : []),
    ...(byAd.some((a) => a.status === 'approved') ? ['## Approved (copied to approved/)', '', ...byAd.filter((a) => a.status === 'approved').map((a) => `- ${a.name}: ${a.approved.map((d) => d.file).join(', ')}${a.notes.length ? ` · notes: ${a.notes.join(' / ')}` : ''}`), ''] : []),
  ].join('\n'));
  // review column in the delivery sheet
  const csv = join(outdir, 'DELIVERY.csv');
  if (existsSync(csv)) {
    const [head, ...rows] = parseCSV(readFileSync(csv, 'utf8'));
    const hi = head.indexOf('review') >= 0 ? head.indexOf('review') : head.push('review') - 1;
    const fi = head.indexOf('file');
    const out = rows.map((r) => { const d = dec[r[fi]]; const ad = byAd.find((a) => a.files.some((f) => f.file === r[fi])); r[hi] = d?.status || (ad && ad.approved.some((x) => x.variant === parseName(r[fi])?.variant) ? 'approved' : ''); return r; });
    writeFileSync(csv, [head, ...out].map((r) => r.map(cell).join(',')).join('\n') + '\n');
  }
  return { redo, approved: byAd.filter((a) => a.status === 'approved').map((a) => a.name) };
}

const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
:root{--bg:#f6f4ef;--card:#fff;--ink:#141414;--muted:#6b6b6b;--line:#e3dfd6;--ok:#1f9d55;--bad:#d64545;--acc:#ff6a2b}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--card:#1c1c20;--ink:#f2f2f2;--muted:#9a9aa2;--line:#2c2c32}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
h1{font-size:18px;margin:0 12px 0 0}.count{color:var(--muted)}.sp{flex:1}
input,textarea,button,select{font:inherit;color:inherit}
input[type=text]{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:7px 10px}
button{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:8px 12px;cursor:pointer}
button.primary{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.filters button.on{border-color:var(--ink)}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;padding:16px;max-width:1500px;margin:0 auto}
.ad{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:8px}
.ad.approved{border-color:var(--ok)}.ad.changes{border-color:var(--bad)}
video{width:100%;aspect-ratio:9/16;background:#000;border-radius:10px;object-fit:contain}
.name{font-weight:700}.meta{color:var(--muted);font-size:13px}.hook{font-weight:600}
.tabs{display:flex;gap:6px;flex-wrap:wrap}.tabs button{padding:4px 10px;font-size:13px}.tabs button.on{background:var(--ink);color:var(--bg)}
.row{display:flex;gap:8px}.row button{flex:1}
button.ok.on{background:var(--ok);border-color:var(--ok);color:#fff}button.no.on{background:var(--bad);border-color:var(--bad);color:#fff}
textarea{width:100%;min-height:62px;border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:8px;resize:vertical}
.badge{font-size:12px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--muted)}
@media (max-width:640px){main{padding:10px;gap:10px}header{padding:10px}}
</style></head><body>
<header><h1 id="t"></h1><span class="count" id="count"></span><span class="sp"></span>
<span class="filters"><button data-f="all" class="on">All</button> <button data-f="pending">To review</button> <button data-f="changes">Changes</button> <button data-f="approved">Approved</button></span>
<input type="text" id="who" placeholder="Your name"><button id="copy">Copy notes</button><button class="primary" id="export">Export feedback</button></header>
<main id="grid"></main>
<script>
const DATA = __DATA__;
const KEY = 'review:' + DATA.batch;
let S = {}; try { S = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} render(); };
// A decision belongs to one version of a file: a re-cut file (new rev) comes back as "to review".
const dec = (f) => { const d = (S.d || {})[f.file]; return d && d.rev === f.rev ? d : null; };
const setDec = (f, patch) => { S.d = S.d || {}; S.d[f.file] = { ...(dec(f) || { status: '', note: '' }), ...patch, rev: f.rev }; save(); };
let filter = 'all';
document.getElementById('t').textContent = DATA.batch;
document.getElementById('who').value = S.who || '';
document.getElementById('who').oninput = (e) => { S.who = e.target.value; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (x) {} };
document.querySelectorAll('.filters button').forEach((b) => (b.onclick = () => { filter = b.dataset.f; document.querySelectorAll('.filters button').forEach((x) => x.classList.toggle('on', x === b)); render(); }));
const vert = (ad) => ad.files.filter((f) => f.size === '9:16');
const status = (ad) => { const ds = vert(ad).map(dec); return ds.some((d) => d && d.status === 'changes') ? 'changes' : ds.length && ds.every((d) => d && d.status === 'approved') ? 'approved' : ds.some((d) => d && d.status === 'approved') ? 'approved' : 'pending'; };
const pick = {};
function render() {
  const all = DATA.ads.filter((a) => vert(a).length);
  const n = (s) => all.filter((a) => status(a) === s).length;
  document.getElementById('count').textContent = all.length + ' ads · ' + n('approved') + ' approved · ' + n('changes') + ' changes · ' + n('pending') + ' to review';
  const grid = document.getElementById('grid'); grid.textContent = '';
  for (const ad of all) {
    const st = status(ad);
    if (filter !== 'all' && st !== filter) continue;
    const vs = vert(ad), f = vs.find((x) => x.variant === pick[ad.name]) || vs[0], d = dec(f) || {};
    const el = document.createElement('section'); el.className = 'ad ' + st;
    el.innerHTML = '<div class="name"></div><div class="meta"></div><video controls playsinline preload="metadata"></video><div class="tabs"></div><div class="hook"></div><div class="row"><button class="ok">Approve</button><button class="no">Needs changes</button></div><textarea placeholder="Notes: what to change (hook, a line to cut, music, a name spelled wrong...)"></textarea><div class="meta files"></div>';
    el.querySelector('.name').textContent = ad.name;
    el.querySelector('.meta').textContent = [ad.angle, f.checks && 'checks: ' + f.checks].filter(Boolean).join(' · ');
    el.querySelector('video').src = encodeURI(f.file);
    if (f.cover) el.querySelector('video').poster = encodeURI(f.cover);
    const tabs = el.querySelector('.tabs');
    if (vs.length > 1) vs.forEach((v) => { const b = document.createElement('button'); const dv = dec(v); b.textContent = 'Hook ' + v.variant + (dv && dv.status ? (dv.status === 'approved' ? ' ✓' : ' ✕') : ''); b.className = v === f ? 'on' : ''; b.onclick = () => { pick[ad.name] = v.variant; render(); }; tabs.appendChild(b); });
    el.querySelector('.hook').textContent = f.hook ? '“' + f.hook + '”' : '';
    const ok = el.querySelector('.ok'), no = el.querySelector('.no');
    ok.classList.toggle('on', d.status === 'approved'); no.classList.toggle('on', d.status === 'changes');
    ok.onclick = () => setDec(f, { status: d.status === 'approved' ? '' : 'approved' });
    no.onclick = () => setDec(f, { status: d.status === 'changes' ? '' : 'changes' });
    const ta = el.querySelector('textarea'); ta.value = d.note || '';
    ta.onchange = () => setDec(f, { note: ta.value, status: ta.value && !(dec(f) || {}).status ? 'changes' : (dec(f) || {}).status });
    const other = ad.files.filter((x) => x.variant === f.variant && x.size !== '9:16').map((x) => x.size);
    el.querySelector('.files').textContent = f.file + (other.length ? ' · also ' + other.join(', ') : '');
    grid.appendChild(el);
  }
}
function feedback() {
  const decisions = {};
  for (const ad of DATA.ads) for (const f of ad.files) { const d = dec(f); if (d && (d.status || d.note)) decisions[f.file] = { status: d.status, note: d.note || '' }; }
  return { batch: DATA.batch, reviewer: S.who || '', at: new Date().toISOString(), decisions };
}
document.getElementById('export').onclick = () => {
  const blob = new Blob([JSON.stringify(feedback(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'review.json'; a.click();
};
document.getElementById('copy').onclick = async () => {
  const fb = feedback(), lines = Object.entries(fb.decisions).map(([f, d]) => (d.status === 'approved' ? 'APPROVED ' : d.status === 'changes' ? 'CHANGES  ' : 'NOTE     ') + f + (d.note ? ': ' + d.note : ''));
  try { await navigator.clipboard.writeText('Review of ' + fb.batch + (fb.reviewer ? ' by ' + fb.reviewer : '') + '\\n' + lines.join('\\n')); document.getElementById('copy').textContent = 'Copied'; } catch (e) { alert(lines.join('\\n')); }
};
render();
</script></body></html>
`;
