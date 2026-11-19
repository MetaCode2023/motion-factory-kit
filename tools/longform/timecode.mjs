// tools/longform/timecode.mjs: frame rates and SMPTE timecode, for the xmeml and EDL writers and readers.
//
//   rateOf(fps)                      -> { timebase, ntsc, fps }  (29.97 -> { 30, true, 30000/1001 })
//   secondsToFrames(s, rate)         -> whole frames at the real rate
//   framesToTC(n, rate, { df })      -> "hh:mm:ss:ff" ("hh:mm:ss;ff" in drop-frame)
//   tcToFrames(tc, rate, { df })     -> frames; a ";" before the frames says drop-frame without the option
//
// Timecode counts frames at the integer timebase (30 for 29.97). Drop-frame renumbers, it never drops a frame
// of picture: it skips the numbers :00 and :01 (:00-:03 at 59.94) at the start of every minute except each tenth.
// Only 29.97 and 59.94 have a drop-frame form; asking for it at any other rate throws.
export function rateOf(fps) {
  const ntsc = [23.976, 29.97, 59.94, 47.952, 119.88].find((r) => Math.abs(fps - r) < 0.01);
  return ntsc ? { timebase: Math.round(ntsc), ntsc: true, fps: Math.round(ntsc) * 1000 / 1001 } : { timebase: Math.round(fps) || 30, ntsc: false, fps: Math.round(fps) || 30 };
}

export const secondsToFrames = (s, rate) => Math.round(s * rate.fps);

const dropOf = (rate) => {
  if (!rate.ntsc || (rate.timebase !== 30 && rate.timebase !== 60)) throw new Error(`drop-frame needs 29.97 or 59.94 (got ${rate.ntsc ? rate.fps.toFixed(3) : rate.fps})`);
  return rate.timebase / 15;
};

const pad = (n) => String(n).padStart(2, '0');

export function framesToTC(n, rate, { df = false } = {}) {
  const tb = rate.timebase;
  if (df) {
    const drop = dropOf(rate), per10 = tb * 600 - drop * 9, perMin = tb * 60 - drop;
    const d = Math.floor(n / per10), m = n % per10;
    n += drop * 9 * d + (m >= drop ? drop * Math.floor((m - drop) / perMin) : 0);
  }
  const f = n % tb, s = Math.floor(n / tb) % 60, mi = Math.floor(n / (tb * 60)) % 60, h = Math.floor(n / (tb * 3600));
  return `${pad(h)}:${pad(mi)}:${pad(s)}${df ? ';' : ':'}${pad(f)}`;
}

export function tcToFrames(tc, rate, { df } = {}) {
  const m = String(tc).trim().match(/^(\d+):(\d\d):(\d\d)([:;])(\d\d)$/);
  if (!m) throw new Error(`bad timecode "${tc}" (use hh:mm:ss:ff)`);
  const [h, mi, s, f] = [m[1], m[2], m[3], m[5]].map(Number);
  const drop = df ?? m[4] === ';';
  const n = ((h * 60 + mi) * 60 + s) * rate.timebase + f;
  if (!drop) return n;
  const d = dropOf(rate);
  if (f < d && s === 0 && mi % 10 !== 0) throw new Error(`timecode ${tc} does not exist in drop-frame`);
  const minutes = h * 60 + mi;
  return n - d * (minutes - Math.floor(minutes / 10));
}
