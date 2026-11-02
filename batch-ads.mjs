#!/usr/bin/env node
// batch-ads.mjs: one template + a spreadsheet = a folder of finished ads.
//
//   node batch-ads.mjs scenes/templates/three-reasons.html data/ads.csv [--variants] [--formats 4:5,16:9] [--batch oct-drop] [--fast]
//
// Each row becomes M.data() in the template. Column names are the template's data keys:
//   name, product.name, product.price (dots make nested values), hook1, hook2, hook3 (become `hooks`),
//   any list as "a | b | c". Export the sheet as CSV from Google Sheets or Excel, or pass a .json array
//   or a folder of .json files. Output: out/<batch>/ with every MP4, report and DELIVERY.csv.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDelivery } from './tools/delivery.mjs';
import { parseCSV, toData } from './tools/csv.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const VALUED = ['batch', 'formats', 'look', 'only'];
const [template, source] = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]?.slice(2)));
if (!template || !source || !existsSync(template) || !existsSync(source)) {
  console.error('usage: node batch-ads.mjs <template.html> <rows.csv | rows.json | folder> [--variants] [--formats 4:5,1:1,16:9] [--batch name] [--only 3,7] [--fast]');
  process.exit(2);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
let rows;
if (statSync(source).isDirectory()) rows = readdirSync(source).filter((f) => f.endsWith('.json')).sort().map((f) => ({ name: basename(f, '.json'), ...JSON.parse(readFileSync(join(source, f), 'utf8')) }));
else if (extname(source) === '.json') rows = JSON.parse(readFileSync(source, 'utf8'));
else rows = parseCSV(readFileSync(source, 'utf8')).map(toData);
const only = opt('only') ? new Set(String(opt('only')).split(',').map(Number)) : null;

const batch = opt('batch', basename(source, extname(source)));
const outdir = join(ROOT, 'out', batch), datadir = join(outdir, '.data');
mkdirSync(datadir, { recursive: true });
const pass = [...(flag('variants') ? ['--variants'] : []), ...(opt('formats') ? ['--formats', opt('formats')] : []), ...(flag('fast') ? ['--fast'] : []), ...(opt('look') ? ['--look', opt('look')] : [])];
const results = [];
for (const [i, row] of rows.entries()) {
  if (only && !only.has(i + 1)) continue;
  const name = slug(row.name || `${basename(template, '.html')}-${String(i + 1).padStart(2, '0')}`);
  const file = join(datadir, name + '.json');
  writeFileSync(file, JSON.stringify({ ...row, name }, null, 1));
  console.log(`\n=== ${i + 1}/${rows.length}: ${name} ===`);
  const r = spawnSync(process.execPath, [join(ROOT, 'make.mjs'), template, '--data', file, '--name', name, '--outdir', outdir, ...pass], { stdio: 'inherit' });
  results.push({ name, angle: row.angle || '', hooks: row.hooks || [], duration: row.duration || '', ok: r.status === 0 });
}
const sheet = writeDelivery(outdir, results);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} ads built -> ${relative(ROOT, outdir)}  (sheet: ${relative(ROOT, sheet)})`);
