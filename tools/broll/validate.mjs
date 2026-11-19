// tools/broll/validate.mjs: is this result really the thing the speaker named? A cutaway that shows the wrong
// place is worse than no cutaway, so every result passes two checks before it is used:
//
//   1. Metadata (here, automatic): the name that was said must be in the result's own title, tags or
//      description. For a place, landmark or person every word of the name must be there ("Yellowstone
//      National Park" is not satisfied by a video tagged "national park"); for a setting or an object, the
//      thing itself. Compilations, reactions, gameplay, trailers, AI-generated footage and the like are refused.
//   2. Eyes (the editor): after download, three frames of the exact seconds that will be used are saved as a
//      check sheet. Claude looks at each one and sets "seen": true in the lockfile, or drops / re-picks it.
//      The build warns about video cutaways nobody has looked at.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const STOP = new Set(('the a an of in on at to for and or with by from is are was this that these those my your our their its it as into over under near new old big small ' +
  'video footage clip photo picture image view scene shot aerial drone 4k hd uhd stock background night day wide close up').split(' '));
const REFUSE = /\b(reaction|reacts?|gameplay|walkthrough|let'?s play|trailer|teaser|lyrics?|karaoke|podcast|full (movie|episode|album)|compilation|slideshow|ai[- ]generated|made with ai|midjourney|sora|minecraft|fortnite|roblox|gta|unboxing|asmr|meme|prank|tier list|top \d+|livestream|live stream|#shorts)\b/i;
const NAME_TYPES = new Set(['place', 'landmark', 'person', 'proper', 'forced']);

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const terms = (s) => norm(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
// "parks" matches "park", "canyons" matches "canyon".
const hasWord = (text, w) => new RegExp(`(^| )${w}(s|es)?( |$)`).test(text) || (w.endsWith('s') && new RegExp(`(^| )${w.slice(0, -1)}( |$)`).test(text));

/**
 * validate(result, moment) -> { ok, score 0-1, why }
 *   result: { title, tags, description?, kind, dur }      moment: { said, key, type, query }
 */
export function validate(r, m) {
  const title = norm(r.title), body = norm(`${r.tags || ''} ${r.description || ''}`), all = `${title} ${body}`;
  const bad = `${r.title || ''} ${r.tags || ''}`.match(REFUSE);
  if (r.kind === 'video' && bad) return { ok: false, score: 0, why: `refused: looks like "${bad[0].toLowerCase()}", not footage of the subject` };
  const name = terms(m.key || m.said), ask = terms(m.query);
  const subject = name.length ? name : ask;
  if (!subject.length) return { ok: true, score: 0.5, why: 'nothing to check against' };
  const inAll = subject.filter((w) => hasWord(all, w)), inTitle = subject.filter((w) => hasWord(title, w));
  const strict = NAME_TYPES.has(m.type);
  if (strict && inAll.length < subject.length) return { ok: false, score: inAll.length / subject.length, why: `"${subject.filter((w) => !inAll.includes(w)).join(' ')}" is not in its title, tags or description` };
  if (!strict && !inAll.length && !ask.some((w) => hasWord(all, w))) return { ok: false, score: 0, why: `nothing about "${subject.join(' ')}" in its title, tags or description` };
  const score = Math.min(1, 0.5 * (inAll.length / subject.length) + 0.35 * (inTitle.length / subject.length) + 0.15 * (ask.length ? ask.filter((w) => hasWord(all, w)).length / ask.length : 1));
  return { ok: true, score: +score.toFixed(2), why: inTitle.length === subject.length ? `"${subject.join(' ')}" is in the title` : `"${subject.join(' ')}" is in the tags or description` };
}

/**
 * checkSheet(file, { from, dur, kind }, out, tools) -> out: three frames (start, middle, end) of the seconds
 * that will be on screen, side by side, for the editor to look at. tools = { frameAt, sheet } from longform/common.
 */
export async function checkSheet(file, { from = 0, dur = 2, kind = 'video', label = '' }, out, { frameAt, sheet }) {
  mkdirSync(dirname(out), { recursive: true });
  const tmp = join(tmpdir(), `broll-check-${process.pid}-${Math.random().toString(36).slice(2)}`);
  const times = kind === 'video' ? [from + 0.1, from + dur / 2, from + Math.max(0.2, dur - 0.15)] : [0];
  const items = [];
  times.forEach((t, k) => {
    const f = `${tmp}-${k}.jpg`;
    try { frameAt(file, t, f); if (existsSync(f)) items.push({ file: f, label: kind === 'video' ? `${t.toFixed(1)} s` : 'photo' }); } catch {}
  });
  if (!items.length) return null;
  return sheet(items, out, { cols: items.length, title: label });
}
