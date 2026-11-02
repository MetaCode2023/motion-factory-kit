// tools/csv.mjs: spreadsheet rows -> template data (used by batch-ads.mjs).

// RFC 4180-ish CSV: quoted fields, commas and newlines inside quotes, "" escapes.
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// Flat columns -> the nested data a template reads.
export function toData(row) {
  const out = {}, hooks = [];
  for (const [k, raw] of Object.entries(row)) {
    if (raw === '' || raw == null) continue;
    let v = raw;
    if (typeof v === 'string' && v.includes(' | ')) v = v.split(' | ').map((s) => s.trim());
    else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v)) v = Number(v);
    if (/^hook\d+$/i.test(k)) { hooks[Number(k.slice(4)) - 1] = String(v); continue; }
    const path = k.split('.');
    let o = out;
    path.slice(0, -1).forEach((p) => { o = o[p] = o[p] && typeof o[p] === 'object' ? o[p] : {}; });
    o[path[path.length - 1]] = v;
  }
  if (hooks.filter(Boolean).length) out.hooks = hooks.filter(Boolean);
  if (typeof out.hooks === 'string') out.hooks = [out.hooks];
  return out;
}

