// tools/longform/edl.mjs: the cut as a CMX3600 EDL (cuts only: one event per A-roll piece), and the reader for one.
// Details, and what is dropped: docs/INTERCHANGE.md. Untested in external editors.
//
//   edlExport(R, plan, { df, probe }) -> text.  Record time starts at 01:00:00:00 (the convention). Source time is
//     the file's embedded start timecode (probe().tc, 00:00:00:00 when there is none) plus the position in the file.
//     Reel = the clip id as 8 upper-case letters/digits, made unique. Comments: "* FROM CLIP NAME: <file name>" and
//     "* SOURCE FILE: <full path>". Track B = picture and sound, V = picture only, A = sound only (voice-only clips).
//     Non-drop-frame unless df is true (29.97 and 59.94 only; elsewhere it throws).
//   parseEDL(text) -> { title, fcm, events: [{ n, reel, track, trans, transDur, srcIn, srcOut, recIn, recOut,
//     clipName, sourceFile, speed }] }, timecodes left as strings. speed is true when an M2 line follows the event.
import { basename, resolve } from 'node:path';
import { probe as realProbe } from './common.mjs';
import { framesToTC, rateOf, tcToFrames } from './timecode.mjs';

const REC_START = '01:00:00:00';
const TC = /^\d\d:\d\d:\d\d[:;]\d\d$/;

export function edlExport(R, plan, { df = false, probe = realProbe } = {}) {
  const rate = rateOf(plan.fps);
  const F = (s) => Math.round(s * rate.fps);
  const base = tcToFrames(REC_START, rate, { df });
  const tc = (n) => framesToTC(n, rate, { df });
  const reels = new Map(), used = new Set(), offsets = new Map();
  const reelOf = (id) => {
    if (!reels.has(id)) {
      const name = id.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'CLIP';
      let r = name;
      for (let n = 2; used.has(r); n++) r = name.slice(0, 8 - String(n).length) + n;
      used.add(r);
      reels.set(id, r);
    }
    return reels.get(id);
  };
  const offsetOf = (file) => {
    if (!offsets.has(file)) {
      const p = probe(file), r = rateOf(p.fps || plan.fps);
      offsets.set(file, p.tc ? tcToFrames(p.tc, r) / r.fps : 0);
    }
    return offsets.get(file);
  };
  const lines = [`TITLE: ${plan.title || plan.name}`, `FCM: ${df ? 'DROP FRAME' : 'NON-DROP FRAME'}`, ''];
  R.cuts.forEach((c, k) => {
    const clip = R.lib.clips[c.clip];
    const start = F(c.out), end = F(c.out + c.d), srcIn = F(offsetOf(clip.file) + c.s);
    const track = clip.height ? (clip.hasAudio ? 'B' : 'V') : 'A';
    lines.push(`${String(k + 1).padStart(3, '0')}  ${reelOf(c.clip).padEnd(8)} ${track.padEnd(5)} ${'C'.padEnd(8)} ${tc(srcIn)} ${tc(srcIn + end - start)} ${tc(base + start)} ${tc(base + end)}`,
      `* FROM CLIP NAME: ${basename(clip.file)}`, `* SOURCE FILE: ${resolve(clip.file)}`);
  });
  return lines.join('\n') + '\n';
}

export function parseEDL(text) {
  const out = { title: '', fcm: 'NON-DROP FRAME', events: [] };
  let last = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^TITLE:\s*(.*)$/i))) out.title = m[1];
    else if ((m = line.match(/^FCM:\s*(.*)$/i))) out.fcm = m[1].trim().toUpperCase();
    else if (line.startsWith('*')) {
      if ((m = line.match(/^\*\s*(FROM CLIP NAME|SOURCE FILE):\s*(.*)$/i)) && last) last[/^FROM/i.test(m[1]) ? 'clipName' : 'sourceFile'] = m[2].trim();
    } else if (/^M2\s/i.test(line)) { if (last) last.speed = true; }
    else if (/^\d+\s/.test(line)) {
      const t = line.split(/\s+/), tcs = t.slice(-4);
      if (t.length < 8 || !tcs.every((x) => TC.test(x))) continue;
      out.events.push(last = { n: +t[0], reel: t[1], track: t[2], trans: t[3], transDur: t.slice(4, -4).join(' '), srcIn: tcs[0], srcOut: tcs[1], recIn: tcs[2], recOut: tcs[3], clipName: '', sourceFile: '', speed: false });
    }
  }
  return out;
}
