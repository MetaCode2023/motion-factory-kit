// tools/delivery.mjs: the hand-off sheet for a batch (what a media buyer opens first).
// writeDelivery(outdir, results) -> outdir/DELIVERY.csv and DELIVERY.md, one row per finished file.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const SIZE = { '': '9:16', '4x5': '4:5', '1x1': '1:1', '16x9': '16:9' };

export function writeDelivery(outdir, results) {
  const files = existsSync(outdir) ? readdirSync(outdir) : [];
  const rows = [];
  for (const r of results) {
    const mine = files.filter((f) => f.endsWith('.mp4') && (f === `${r.name}.mp4` || f.startsWith(`${r.name}-v`) || f.startsWith(`${r.name}.`))).sort();
    if (!mine.length) { rows.push({ ad: r.name, file: '', size: '', variant: '', hook: '', angle: r.angle || '', length: '', checks: r.error ? `FAILED: ${r.error}` : 'FAILED' }); continue; }
    for (const f of mine) {
      const m = f.match(/^(.*?)(-v(\d+))?(\.(4x5|1x1|16x9))?\.mp4$/);
      const variant = m[3] ? +m[3] : 1;
      const report = join(outdir, `${m[1]}${m[2] || ''}.report.md`);
      let checks = '', length = r.duration ? (+r.duration).toFixed(1) : '';
      if (existsSync(report)) {
        const text = readFileSync(report, 'utf8');
        if (!length) length = (text.match(/\*\*length\*\*: ([\d.]+)s/) || [])[1] || '';
        const fixes = (text.match(/^- FIX /gm) || []).length;
        checks = fixes ? `${fixes} to fix (see ${m[1]}${m[2] || ''}.report.md)` : 'all passed';
      }
      rows.push({ ad: r.name, file: f, size: SIZE[m[5] || ''], variant, hook: (r.hooks || [])[(variant - 1) % Math.max(1, (r.hooks || []).length)] || '', angle: r.angle || '', length, checks });
    }
  }
  const cols = ['ad', 'file', 'size', 'variant', 'hook', 'angle', 'length', 'checks'];
  writeFileSync(join(outdir, 'DELIVERY.csv'), [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n');
  const ok = rows.filter((r) => r.checks === 'all passed').length;
  writeFileSync(join(outdir, 'DELIVERY.md'), [
    `# Delivery`, '', `${rows.length} files from ${results.length} ads. ${ok} passed every check.`, '',
    '| file | size | hook | length | checks |', '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.file || r.ad} | ${r.size} | ${String(r.hook).replace(/\|/g, '/')} | ${r.length}s | ${r.checks} |`), '',
  ].join('\n'));
  return join(outdir, 'DELIVERY.csv');
}
