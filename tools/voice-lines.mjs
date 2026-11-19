#!/usr/bin/env node
// tools/voice-lines.mjs: time each line of a narration recorded (or generated) in one take, so cuts can land
// on the words without a per-line TTS call or a transcriber.
//
//   node tools/voice-lines.mjs <narration.mp3> <script.txt> [--json]
//
// The script is split into lines on . ? ! (one line per shot). Pauses are found with ffmpeg's silencedetect;
// each line break is matched to the pause nearest where it should fall (by the share of characters before it),
// in order. Prints start/end per line, or JSON ([{ start, end, text }]) to paste into a scene's TIMES.
// Check the result by ear on one or two lines: a long comma pause can win over a short full stop.
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function splitLines(text) {
  return String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.?!]["')\]]?)\s+(?=\S)/).filter(Boolean);
}

// silences: [{ start, end }], speech: [first sound, last sound] -> [{ start, end, text }]
export function alignLines(lines, silences, total) {
  const firstSound = silences[0] && silences[0].start < 0.05 ? silences[0].end : 0;
  const lastSound = silences.length && silences[silences.length - 1].end >= total - 0.05 ? silences[silences.length - 1].start : total;
  const chars = lines.map((l) => l.length), all = chars.reduce((a, b) => a + b, 0);
  const inner = silences.filter((s) => s.start > firstSound + 0.05 && s.end < lastSound - 0.05);
  const cuts = [];
  let from = 0, acc = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    acc += chars[i];
    const want = firstSound + (lastSound - firstSound) * (acc / all);
    let best = -1;
    for (let k = from; k < inner.length - (lines.length - 2 - i); k++) {
      if (best < 0 || Math.abs((inner[k].start + inner[k].end) / 2 - want) < Math.abs((inner[best].start + inner[best].end) / 2 - want)) best = k;
    }
    if (best < 0) { cuts.push({ start: want, end: want }); continue; }
    cuts.push(inner[best]); from = best + 1;
  }
  return lines.map((text, i) => ({
    start: +(i ? cuts[i - 1].end : firstSound).toFixed(2),
    end: +(i < lines.length - 1 ? cuts[i].start : lastSound).toFixed(2),
    text,
  }));
}

function detect(file, noise = -38, min = 0.18) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file, '-af', `silencedetect=noise=${noise}dB:d=${min}`, '-f', 'null', '-'], { encoding: 'utf8' });
  const log = r.stderr || '';
  const total = +(log.match(/Duration: (\d+):(\d+):([\d.]+)/) || []).slice(1).reduce((a, v, i) => a + v * [3600, 60, 1][i], 0);
  const silences = [];
  for (const m of log.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)) silences.push({ start: +m[1], end: +m[2] });
  return { total, silences };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, script] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!file || !script) { console.error('usage: node tools/voice-lines.mjs <narration.mp3> <script.txt> [--json]'); process.exit(1); }
  const { total, silences } = detect(file);
  const out = alignLines(splitLines(readFileSync(script, 'utf8')), silences, total);
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
  else out.forEach((l, i) => console.log(`${String(i + 1).padStart(3)}  ${l.start.toFixed(2).padStart(6)}  ${l.end.toFixed(2).padStart(6)}  ${l.text}`));
}
