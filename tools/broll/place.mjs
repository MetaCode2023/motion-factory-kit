// tools/broll/place.mjs: decide which moments get a cutaway and how long each runs. Pure (no files, no
// network), so the rules are easy to test: auto B-roll only fills gaps. It never covers an existing insert,
// the hook or the ending, keeps a minimum spacing, and stays under a density cap (best scores win).

export const PLACE = {
  every: 15,     // at most one cutaway per this many seconds of video, on average
  min: 1.5,      // shortest cutaway (s)
  max: 3,        // longest cutaway (s)
  tail: 1.2,     // how long it runs past the last spoken word of the thing named
  lead: 0.1,     // starts this much before the word
  hook: 3,       // nothing in the first seconds
  end: 8,        // nothing in the last seconds (the call to action)
  gap: 0.5,      // clear space around existing inserts
  spacing: 6,    // minimum seconds between two cutaways
};

/**
 * placeBroll(moments, inserts, total, opts) -> { placed: [{ ...moment, at, dur }], skipped: [{ ...moment, why }] }
 * moments: [{ at, end, score, ... }] on the output timeline; inserts: [{ at, dur }] already on the timeline.
 */
export function placeBroll(moments, inserts, total, opts = {}) {
  const o = { ...PLACE, ...opts };
  const busy = inserts.map((i) => [i.at - o.gap, i.at + i.dur + o.gap]).sort((a, b) => a[0] - b[0]);
  const budget = Math.max(0, Math.floor(total / o.every));
  const placed = [], skipped = [];
  const order = [...moments].sort((a, b) => (b.score - a.score) || (a.at - b.at));
  for (const m of order) {
    const at = +Math.max(0, m.at - o.lead).toFixed(3);
    let dur = Math.min(o.max, Math.max(o.min, (m.end ?? m.at) - m.at + o.tail));
    const skip = (why) => skipped.push({ ...m, why });
    if (placed.length >= budget) { skip(`over the density cap (one per ${o.every} s)`); continue; }
    if (at < o.hook) { skip('inside the hook'); continue; }
    if (at > total - o.end) { skip('inside the ending'); continue; }
    if (busy.some(([a, b]) => at >= a && at < b)) { skip('another visual is on screen'); continue; }
    // Run up to the next thing on screen (leaving the gap), but no shorter than min.
    const nextBusy = busy.find(([a]) => a >= at);
    if (nextBusy) dur = Math.min(dur, nextBusy[0] - at);
    if (dur < o.min) { skip('no room before the next visual'); continue; }
    if (placed.some((p) => Math.abs(p.at - at) < o.spacing)) { skip(`within ${o.spacing} s of another cutaway`); continue; }
    placed.push({ ...m, at, dur: +dur.toFixed(2) });
  }
  placed.sort((a, b) => a.at - b.at);
  return { placed, skipped };
}
