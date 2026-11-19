// tools/broll/find.mjs: find the moments in a transcript where a short cutaway would help, offline and
// without keys. Input is timed words ({ w, s, e } in seconds, as the long-form plan and footage.mjs produce);
// output is a list of candidates with the spoken words, their times, the sentence, and a draft search.
//
// The finder proposes; Claude (as editor) decides. It matches the lexicon (places, landmarks, settings,
// objects; tools/broll/lexicon.json), longest phrase first, plus capitalised names the lexicon doesn't know
// (listed for review, not placed on their own). Repeats inside `repeat` seconds are dropped.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let LEX = null;
export function lexicon() {
  if (!LEX) LEX = JSON.parse(readFileSync(join(HERE, 'lexicon.json'), 'utf8')).entries;
  return LEX;
}

export const TYPE_SCORE = { landmark: 3.5, place: 3, person: 2.5, setting: 2.5, object: 2, proper: 1 };
// person = the lexicon's short list of historic scientists (public-domain photos); unknown names are only listed.
export const DEFAULT_TYPES = ['landmark', 'place', 'person', 'setting', 'object'];
const norm = (w) => String(w).toLowerCase().replace(/[^a-z0-9'&-]/g, '').replace(/'s$/, '');
const ends = (w) => /[.?!]["')\]]*$/.test(w);
// Words before a lowercase match that make it something else ("fine china", "a cash flow").
const NOT_BEFORE = { china: ['fine', 'bone', 'the'], cards: ['credit', 'business', 'id', 'report'], chips: ['potato', 'blue', 'computer'], money: ['the'] };
// Capitalised words that are not names of things you can film.
const STOP = new Set(['i', "i'm", "i've", "i'll", "i'd", 'ok', 'okay', 'so', 'and', 'but', 'the', 'a', 'an', 'now', 'well', 'yes', 'no', 'oh', 'hey', 'hi', 'mr', 'mrs', 'dr',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'god', 'english', 'american', 'chinese', 'internet', 'tv', 'ai']);
// Ordinary words that turn up capitalised at the start of a caption line or after a missing full stop.
const COMMON = new Set(('the be to of and a in that have it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was were been being has had did does said such those ever every each very much many more less few both either neither one two three four five six seven eight nine ten hundred thousand million billion here where why while until since though although however therefore ultimately basically actually really maybe perhaps still again already always never often sometimes everything everyone something someone nothing nobody anything anyone thing things way ways let lets hold play bet win lose fold call raise check deal cards hand hands odds game games chance chances luck rule rules environment connects wagering constantly deciphering visible being will must might shall should may can could would that\'s it\'s you\'re we\'re they\'re i\'m don\'t can\'t won\'t').split(' '));

// Sentences of word indices (split on . ? ! and pauses over 1 s).
function sentences(words) {
  const out = [];
  let cur = [];
  words.forEach((w, i) => {
    cur.push(i);
    const next = words[i + 1];
    if (ends(w.w) || !next || next.s - w.e > 1) { out.push(cur); cur = []; }
  });
  return out;
}

/**
 * findMoments(words, opts) -> [{ at, end, i, n, said, key, sentence, type, query, queries, score, status, why }]
 *   opts.skip:   words/phrases never to use
 *   opts.types:  types placed automatically (others are listed with status 'review')
 *   opts.repeat: seconds within which a repeat of the same thing is dropped (default 60)
 */
export function findMoments(words, { skip = [], types = DEFAULT_TYPES, repeat = 60, lex = lexicon() } = {}) {
  const skipSet = new Set(skip.map((s) => s.toLowerCase().trim()));
  const cased = words.some((w) => /[A-Z]/.test(w.w)) && words.some((w) => /^[a-z]/.test(w.w));
  const maxLen = 4;
  const sents = sentences(words);
  const sentOf = new Map();
  sents.forEach((s, k) => s.forEach((i) => sentOf.set(i, k)));
  // A word that also appears in lower case somewhere is an ordinary word, not a name ("Will" / "will").
  const lowerSeen = new Set(words.filter((w) => /^[a-z]/.test(w.w)).map((w) => norm(w.w)));
  const found = [];
  for (let i = 0; i < words.length; i++) {
    let hit = null;
    for (let n = Math.min(maxLen, words.length - i); n >= 1 && !hit; n--) {
      const parts = words.slice(i, i + n).map((w) => norm(w.w));
      if (parts.some((p) => !p)) continue;
      // A phrase can't run across a sentence end ("...in China. Then...").
      if (words.slice(i, i + n - 1).some((w) => ends(w.w))) continue;
      const phrase = parts.join(' ');
      const e = lex[phrase] || lex['the ' + phrase];
      if (e) hit = { n, phrase, e };
    }
    const sentIdx = sentOf.get(i);
    const first = sents[sentIdx][0] === i;
    if (hit) {
      const { n, phrase, e } = hit;
      const raw = words[i].w.replace(/^["'(]/, '');
      const capital = /^[A-Z]/.test(raw);
      const prev = norm(words[i - 1]?.w || '');
      let status = 'auto', why = '';
      if (skipSet.has(phrase)) { status = 'skip'; why = 'in skip list'; }
      else if ((e.type === 'place' || e.type === 'landmark') && cased && !capital && !first) { status = 'skip'; why = 'lowercase: not the place'; }
      else if ((NOT_BEFORE[phrase] || []).includes(prev) && !capital) { status = 'skip'; why = `"${prev} ${phrase}"`; }
      else if (e.ambiguous) { status = 'review'; why = 'could be a name or another meaning'; }
      else if (!types.includes(e.type)) { status = 'review'; why = `type ${e.type} is not placed automatically`; }
      found.push(cand(words, sents[sentIdx], i, n, phrase, e.type, e.q, status, why));
      i += n - 1;
      continue;
    }
    // A capitalised name mid-sentence that the lexicon doesn't know ("Feynman", "Monte Carlo" if missing).
    if (cased && !first) {
      let n = 0;
      const isName = (w) => /^[A-Z][a-z]/.test(w.w) && !STOP.has(norm(w.w)) && !COMMON.has(norm(w.w)) && !lowerSeen.has(norm(w.w));
      while (n < 3 && i + n < words.length && isName(words[i + n]) && !(n && /[.,;:!?]$/.test(words[i + n - 1].w))) n++;
      if (n) {
        const phrase = words.slice(i, i + n).map((w) => norm(w.w)).join(' ');
        if (!skipSet.has(phrase) && phrase.length > 2) found.push(cand(words, sents[sentIdx], i, n, phrase, 'proper', [words.slice(i, i + n).map((w) => w.w.replace(/[^A-Za-z0-9' -]/g, '')).join(' ')], 'review', 'a name the lexicon does not know'));
        i += Math.max(0, n - 1);
      }
    }
  }
  // First mention scores higher; a repeat inside `repeat` seconds is dropped.
  const last = new Map();
  for (const c of found) {
    const prev = last.get(c.key);
    if (prev != null && c.at - prev < repeat) { if (c.status === 'auto' || c.status === 'review') { c.status = 'skip'; c.why = `said again within ${repeat} s`; } }
    else if (prev == null) c.score += 1;
    if (c.status !== 'skip') last.set(c.key, c.at);
  }
  return found;
}

function cand(words, sent, i, n, phrase, type, queries, status, why) {
  const ws = words.slice(i, i + n);
  return {
    at: ws[0].s, end: ws[ws.length - 1].e, i, n,
    said: ws.map((w) => w.w).join(' ').replace(/[.,;:!?"]+$/, ''),
    key: phrase.replace(/^the /, ''),
    sentence: sent.map((k) => words[k].w).join(' '),
    type, queries: queries || [phrase], query: (queries || [phrase])[0],
    score: TYPE_SCORE[type] ?? 1, status, why,
  };
}
