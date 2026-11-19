// tools/longform/board.mjs: is this a whiteboard recording, and when is the board the thing to watch?
//
// Whiteboard explainers (the speaker drawing and pointing) have their best visual in the frame already. Covering
// the board with a full-screen insert while it's being drawn on hides the explanation. This scan reads small gray
// frames (2 per second) and finds:
//   white   most of the frame is bright and colourless (a board, paper, a light wall)
//   active  stretches where a small part of the frame keeps changing (writing, drawing, pointing), as opposed to
//           nothing moving (a still) or the whole frame changing (a cut, the camera moving)
// The critique uses it to say "he's drawing here: use split, pip or a punch-in, not a full-screen cutaway".
import { spawnSync } from 'node:child_process';
import { FF } from './common.mjs';

const W = 64, H = 36;

export function scanFrames(file, { fps = 2 } = {}) {
  const r = spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-i', file, '-an', '-vf', `fps=${fps},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0 || !r.stdout?.length) return [];
  const n = Math.floor(r.stdout.length / (W * H));
  return Array.from({ length: n }, (_, i) => r.stdout.subarray(i * W * H, (i + 1) * W * H));
}

// frames: arrays of W*H gray bytes at `fps`. Pure, so it can be tested without video.
export function boardFromFrames(frames, { fps = 2, bright = 170, changed = 18, minActive = 0.0015, maxActive = 0.25, minLen = 2 } = {}) {
  if (!frames.length) return { white: false, whiteShare: 0, active: [] };
  const share = frames.map((f) => { let b = 0; for (const v of f) if (v >= bright) b++; return b / f.length; });
  const whiteShare = share.reduce((a, x) => a + x, 0) / share.length;
  const motion = frames.map((f, i) => { if (!i) return 0; const p = frames[i - 1]; let c = 0; for (let k = 0; k < f.length; k++) if (Math.abs(f[k] - p[k]) > changed) c++; return c / f.length; });
  const active = [];
  let start = null;
  motion.forEach((m, i) => {
    const on = m >= minActive && m <= maxActive;
    if (on && start == null) start = i;
    if ((!on || i === motion.length - 1) && start != null) {
      const end = on ? i + 1 : i;
      if ((end - start) / fps >= minLen) active.push([+(start / fps).toFixed(1), +(end / fps).toFixed(1)]);
      start = null;
    }
  });
  // merge stretches less than a second apart
  const merged = [];
  for (const a of active) { const l = merged[merged.length - 1]; if (l && a[0] - l[1] < 1) l[1] = a[1]; else merged.push([...a]); }
  return { white: whiteShare > 0.45, whiteShare: +whiteShare.toFixed(2), active: merged };
}

export const scanBoard = (file) => boardFromFrames(scanFrames(file));
