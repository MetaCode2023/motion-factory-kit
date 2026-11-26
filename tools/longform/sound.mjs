// tools/longform/sound.mjs: automatic sound design for a long-form plan. The plan's own effects ([[sfx]],
// "sfx" on an insert, each animation's declared effects) always win; this fills in the small editing sounds
// a viewer expects around them, so no cut, chapter or question lands in silence.
//
//   "sound": "lively"  (default)  cutaways swipe/shutter/click, a page turn on each chapter with a riser into
//                                 it, a bop after a question, a hit under the first line
//   "sound": "calm"               page turns on chapters and soft cutaway sounds only
//   "sound": "off"  (or false)    nothing automatic
//
// Rules: one sound per moment, nothing automatic within `gap` seconds of another effect, quieter than the
// effects the script asked for. Everything here is a name in sounds/sfx/, so a missing file is simply skipped.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './common.mjs';

export const SOUND_STYLES = ['lively', 'calm', 'off'];
export const soundStyle = (plan) => (plan.sound === false || plan.sound === 'off' ? 'off' : SOUND_STYLES.includes(plan.sound) ? plan.sound : 'lively');

const CUTAWAY = { image: ['shutter', 'click'], broll: ['swipe', 'click'], pull: ['swipe'] };
const has = (name) => existsSync(join(ROOT, 'sounds', 'sfx', `${name}.mp3`));
const endsQuestion = (w) => /\?["')\]]*$/.test(w);

/**
 * Choose the cutaway sounds (mutates ins.sfx / ins.sfxVolume where the plan left it open) and return the extra
 * effects to add: [{ at, name, volume, auto: 'chapter' | 'riser' | 'question' | 'hook' }].
 * `taken` = effect times already decided (plan sfx + insert sfx), so automatic ones keep their distance.
 */
export function designSound({ inserts = [], chapters = [], words = [], total = 0 }, plan, taken = []) {
  const style = soundStyle(plan);
  if (style === 'off') return [];
  const gap = plan.sound_gap ?? 0.9;
  // 1. Cutaways: photos and clips arrive with a small mechanical sound instead of the same whoosh every time.
  const turn = {};
  for (const ins of inserts) {
    const open = ins.autoBroll ? ins.sfx == null : ins.src?.sfx === undefined;
    if (!open || !CUTAWAY[ins.kind] || ins.layout === 'side') continue;
    if (ins.autoBroll && style === 'calm') continue;
    const names = CUTAWAY[ins.kind].filter(has);
    if (!names.length) continue;
    ins.sfx = names[(turn[ins.kind] = (turn[ins.kind] ?? -1) + 1) % names.length];
    ins.sfxVolume = ins.autoBroll ? 0.26 : 0.34;
  }
  const busy = [...taken, ...inserts.filter((i) => i.sfx && i.kind !== 'face').map((i) => i.at)];
  const out = [];
  const add = (at, name, volume, auto, reach = gap) => {
    if (at < 0 || at > total - 0.2 || !has(name) || busy.some((t) => Math.abs(t - at) < reach)) return false;
    out.push({ at: +at.toFixed(3), name, volume, auto });
    busy.push(at);
    return true;
  };
  // 2. Chapters turn like pages; in the lively style a riser leads into each one.
  chapters.forEach((c, k) => {
    if (!k || c.at < 1) return;
    if (add(c.at, 'pageturn', 0.4, 'chapter') && style === 'lively') add(c.at - 1.6, 'riser', 0.2, 'riser', 0.4);
  });
  if (style !== 'lively') return out.sort((a, b) => a.at - b.at);
  // 3. The first line gets weight.
  if (words.length) add(Math.max(0, words[0].s - 0.05), 'hit', 0.3, 'hook');
  // 4. A question hangs for a beat: a bop as it ends (at most one every 20 s).
  let lastQ = -99;
  for (const w of words) {
    if (!endsQuestion(w.w) || w.e - lastQ < 20) continue;
    if (add(w.e + 0.04, 'bop', 0.26, 'question')) lastQ = w.e;
  }
  return out.sort((a, b) => a.at - b.at);
}
