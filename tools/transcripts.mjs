// tools/transcripts.mjs: transcripts you already have, so no speech-to-text key is needed.
//
// Put a file next to the clip with the same name:
//   clip.words.json   [{ "w": "Hello", "s": 0.42, "e": 0.71, "sp": "A" }, ...]  (or { "words": [...] };
//                     "text"/"word", "start", "end", "speaker" are accepted too). Exact word timing.
//   clip.srt / .vtt   subtitles from a camera app, CapCut, Premiere, Descript, YouTube... Word timing is
//                     estimated inside each cue (by word length), which is close enough to cut on.
// readSidecar(clipPath) -> { via, words } or null.
import { existsSync, readFileSync } from 'node:fs';

export function readSidecar(file) {
  const base = file.replace(/\.[^./\\]+$/, '');
  if (existsSync(base + '.words.json')) return { via: 'sidecar', words: normalizeWords(JSON.parse(readFileSync(base + '.words.json', 'utf8'))) };
  for (const ext of ['.srt', '.vtt']) if (existsSync(base + ext)) return { via: 'subtitles', words: wordsFromCues(parseCues(readFileSync(base + ext, 'utf8'))) };
  return null;
}

export function normalizeWords(data) {
  const list = Array.isArray(data) ? data : data.words || [];
  return list
    .map((w) => ({ w: String(w.w ?? w.text ?? w.word ?? '').trim(), s: +(w.s ?? w.start), e: +(w.e ?? w.end), sp: w.sp ?? w.speaker ?? w.speaker_id }))
    .filter((w) => w.w && Number.isFinite(w.s) && Number.isFinite(w.e))
    .map((w) => (w.sp == null ? { w: w.w, s: w.s, e: w.e } : { w: w.w, s: w.s, e: w.e, sp: String(w.sp) }));
}

const stamp = (s) => { const m = s.trim().replace(',', '.').match(/(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)/); return m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] : NaN; };

// SRT and WebVTT cues: [{ s, e, text, sp? }]. "- " dialogue dashes and "<v Name>" voice tags become speakers.
export function parseCues(text) {
  const cues = [];
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim() && !/^WEBVTT|^NOTE\b|^\d+$/.test(l.trim()));
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->');
    let body = lines.slice(ti + 1).join(' ');
    const voice = body.match(/<v\s+([^>]+)>/);
    body = body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (body) cues.push({ s: stamp(a), e: stamp(b.split(/\s/).filter(Boolean)[0] || ''), text: body, ...(voice ? { sp: voice[1].trim() } : {}) });
  }
  return cues.filter((c) => Number.isFinite(c.s) && Number.isFinite(c.e) && c.e > c.s);
}

export function wordsFromCues(cues) {
  const out = [];
  for (const c of cues) {
    const ws = c.text.split(' ').filter(Boolean);
    const weight = ws.map((w) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length) + 1);
    const total = weight.reduce((a, b) => a + b, 0), span = c.e - c.s;
    let t = c.s;
    ws.forEach((w, i) => {
      const d = (span * weight[i]) / total;
      out.push({ w, s: +t.toFixed(3), e: +(t + d * 0.9).toFixed(3), ...(c.sp ? { sp: c.sp } : {}) });
      t += d;
    });
  }
  return out;
}
