// tools/clips/pick.mjs: the decisions behind outside clips, with no network or files, so they are easy to test.
//
// - rankVideos: which search result to take (popular, on topic, a real horizontal video, not a Short or a stream).
// - pickWindow: which seconds of it to take. Default is YouTube's "most replayed" peak, the moment viewers
//   rewatch; with `say` words it finds where those words are spoken in the video's captions instead.
// - clipMoments: from the talk itself, the people and events worth showing (names), merged per sentence into
//   one search with a few words of context.
import { bare } from '../longform/common.mjs';
import { findMoments } from '../broll/find.mjs';

export const CLIP = {
  every: 40,     // at most one outside clip per this many seconds of video, on average
  min: 3,        // shortest clip on screen (s)
  max: 8,        // longest automatic clip (s); explicit cues can ask for up to 10
  tail: 3.5,     // runs this long past the name
  lead: 0.2,     // starts this much before the name
  hook: 3,       // nothing in the first seconds
  end: 8,        // nothing in the last seconds (the call to action)
  gap: 0.5,      // clear space around other visuals
  spacing: 15,   // minimum seconds between two outside clips
};
export const HARD_MAX = 10;   // the report flags borrowed clips longer than this

const STOPQ = new Set('the a an of and or to in on at for with from by is are was were be been this that these those it its his her their our your my we you they he she i so but then than just very really about into over under after before when where what which who whom how why all any some more most other such only own same too can will would could should may might must not no nor here there now also even still yet well like said says say'.split(' '));
const OPENERS = new Set('later then today yesterday tomorrow first second third next finally meanwhile anyway honestly basically actually literally obviously suddenly eventually remember imagine look listen think picture consider everyone everybody nobody somebody someone people because since although though while once after before during back right okay yeah wow'.split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9$' ]+/g, ' ').split(/\s+/).filter((w) => w && !STOPQ.has(w));

/**
 * rankVideos(entries, query, { exclude, need }) -> entries sorted best first, each with `score` and `why`.
 * entries: yt-dlp flat search results ({ id, title, duration, view_count, channel, live_status, url }).
 */
export function rankVideos(entries, query, { exclude = [], need = 4 } = {}) {
  const q = new Set(words(query));
  const ex = exclude.map((x) => String(x).toLowerCase());
  const out = [];
  for (const e of entries || []) {
    if (!e || !e.id) continue;
    const title = String(e.title || ''), ch = String(e.channel || e.uploader || '');
    const skip = (why) => out.push({ ...e, score: -1, why });
    if (e.live_status === 'is_live' || e.live_status === 'is_upcoming') { skip('live or upcoming'); continue; }
    if (/#shorts?\b/i.test(title) || (e.duration && e.duration < 45)) { skip('a Short (vertical)'); continue; }
    if (e.duration && e.duration < need + 6) { skip('too short to cut from'); continue; }
    if (e.duration && e.duration > 4 * 3600) { skip('over 4 hours'); continue; }
    if (ex.some((x) => ch.toLowerCase().includes(x) || title.toLowerCase().includes(x))) { skip('excluded channel'); continue; }
    const t = new Set(words(title + ' ' + ch));
    const hit = [...q].filter((w) => t.has(w)).length / Math.max(1, q.size);
    const views = Math.log10((e.view_count || 0) + 10);
    // Match first (a popular video about the wrong thing is worse than a smaller one about the right thing).
    const score = +(hit * 6 + views).toFixed(3);
    out.push({ ...e, score, why: `${Math.round(hit * 100)}% of the search in the title, ${e.view_count ?? '?'} views` });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * pickWindow(video, dur, { heatmap, captions, say }) -> { from, to, how }
 * heatmap: [{ start_time, end_time, value }] (yt-dlp); captions: [{ start, end, text }] (deduped VTT cues).
 */
export function pickWindow(video, dur, { heatmap = video?.heatmap, captions = null, say = '' } = {}) {
  const D = video?.duration || 0;
  const fit = (from, how) => {
    const f = Math.max(0, Math.min(from, Math.max(0, D - dur - 0.5)));
    return { from: +f.toFixed(2), to: +(f + dur).toFixed(2), how };
  };
  // 1. The words asked for, where the video's captions say them.
  if (say && captions?.length) {
    const want = words(say);
    // One cue that says it all beats a run of three that only covers it together (and starts too early).
    const score = (cs) => { const text = words(cs.map((c) => c.text).join(' ')); return want.filter((w) => text.includes(w)).length / Math.max(1, want.length); };
    let best = null;
    for (let i = 0; i < captions.length; i++) {
      const hit = Math.max(score([captions[i]]), 0.9 * score(captions.slice(i, i + 3)));
      if (hit > (best?.hit ?? 0.45)) best = { hit, at: captions[i].start };
    }
    if (best) return fit(best.at - 0.4, `captions say "${say}" at ${Math.round(best.at)} s`);
  }
  // 2. The most-replayed moment (smoothed so one spike next to a dip loses to a broad peak), skipping intros/outros.
  const H = (heatmap || []).filter((h) => h.end_time > h.start_time);
  if (H.length >= 10 && D) {
    const lo = Math.max(D * 0.04, 8), hi = D * 0.97;
    let best = null;
    H.forEach((h, i) => {
      const mid = (h.start_time + h.end_time) / 2;
      if (mid < lo || mid > hi) return;
      const v = h.value + 0.5 * ((H[i - 1]?.value ?? 0) + (H[i + 1]?.value ?? 0));
      if (!best || v > best.v) best = { v, mid };
    });
    // Start a little before the peak's middle: the rewatched moment lands inside the clip, not at its edge.
    if (best) return fit(best.mid - dur * 0.4, `most replayed moment, around ${Math.round(best.mid)} s`);
  }
  // 3. No data: a third of the way in (past the intro, usually into the action).
  return fit(D ? D / 3 : 0, 'no replay data: a third of the way in');
}

/**
 * clipMoments(words, { context, skip, repeat }) -> [{ at, end, said, key, query, names[], sentence, score }]
 * The names spoken in the talk (people, events, shows), one moment per sentence, searched with context.
 */
export function clipMoments(timed, { context = '', skip = [], repeat = 90 } = {}) {
  const found = findMoments(timed, { types: ['proper', 'person'], repeat });
  // The finder can't tell a name from an ordinary capitalised first word, so "Phil" in "Phil Ivey made..." is
  // dropped. Put it back when it sits right before the name and isn't a common sentence opener.
  const idx = new Map(timed.map((w, i) => [w.s, i]));
  for (const m of found) {
    const i = idx.get(m.at), prev = i > 0 ? timed[i - 1] : null;
    const pw = prev && prev.w.replace(/[^A-Za-z'-]/g, '');
    if (pw && /^[A-Z][a-z]+$/.test(pw) && !OPENERS.has(pw.toLowerCase()) && !STOPQ.has(pw.toLowerCase()) && m.at - prev.e < 0.4
      && (i < 2 || /[.?!]["')\]]*$/.test(timed[i - 2].w))) { m.said = `${pw} ${m.said}`; m.at = prev.s; }
  }
  const skipSet = new Set(skip.map((s) => bare(s)));
  const bySentence = new Map();
  for (const m of found) {
    // Names only: the finder also returns things to picture ("cards", "a casino"), which stock B-roll covers.
    if (m.type !== 'proper' && m.type !== 'person') continue;
    if (skipSet.has(bare(m.said))) continue;
    const key = m.sentence || String(m.at);
    const cur = bySentence.get(key);
    if (cur) { if (!cur.names.includes(m.said)) cur.names.push(m.said); cur.end = Math.max(cur.end, m.end); }
    else bySentence.set(key, { at: m.at, end: m.end, sentence: m.sentence, names: [m.said] });
  }
  const ctx = words(context);
  return [...bySentence.values()].map((m) => {
    // With context ("poker") the names and the context are enough; without it, two longer words from the sentence.
    const named = new Set(m.names.flatMap((n) => words(n)));
    const extra = ctx.length ? [] : words(m.sentence).filter((w) => w.length >= 5 && !named.has(w) && !OPENERS.has(w)).slice(0, 2);
    const query = [...m.names, ...ctx, ...extra].join(' ').trim();
    return { ...m, said: m.names.join(', '), key: bare(m.names[0]), query, score: m.names.length + (m.names.some((n) => n.includes(' ')) ? 1 : 0) };
  });
}

/** Description credit and the short on-screen label. */
export const creditLine = (v, from, to) => `"${v.title}" by ${v.channel || 'unknown'}, YouTube: https://youtu.be/${v.id}?t=${Math.floor(from)} (${mmss(from)}-${mmss(to)}), shown briefly with commentary (fair use)`;
export const sourceLabel = (v) => `${v.channel || 'YouTube'}`;
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Dedupe rolling YouTube auto-caption VTT into cues. */
export function parseVtt(vtt) {
  const T = /(\d+:\d\d:\d\d\.\d+|\d+:\d\d\.\d+) --> (\d+:\d\d:\d\d\.\d+|\d+:\d\d\.\d+)/;
  const sec = (s) => s.split(':').reverse().reduce((a, v, i) => a + Number(v) * 60 ** i, 0);
  const out = [];
  let cur = null, last = '';
  for (const line of String(vtt).split(/\r?\n/)) {
    const m = line.trim().match(T);
    if (m) { cur = [sec(m[1]), sec(m[2])]; continue; }
    if (!cur || !line.trim()) continue;
    const t = line.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    if (t && t !== last) { out.push({ start: cur[0], end: cur[1], text: t }); last = t; }
  }
  return out;
}
