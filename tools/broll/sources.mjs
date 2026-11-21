// tools/broll/sources.mjs: free stock search behind one shape, so the picker doesn't care where media comes from.
//
//   Openverse  photos            no key   CC0 / PDM / CC BY / CC BY-SA (commercial use + changes allowed), mostly Flickr
//   Commons    photos            no key   Wikimedia Commons; per file: CC0 / PD / CC BY / CC BY-SA only
//   Pixabay    videos + photos   PIXABAY_API_KEY (optional)   Pixabay Content License
//   Pexels     videos + photos   PEXELS_API_KEY  (optional; new keys are paused)   Pexels License
//
// Every result: { source, id, kind: 'video'|'photo', w, h, dur, url, ext, page, author, license, tags }.
// Searches are cached for 30 days (Pixabay asks for at least 24 h) in assets/broll/.cache/search/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localRelevance } from './relevance.mjs';

const UA = 'motion-factory-kit/1.0 (automatic B-roll; https://github.com/metacode2023/motion-factory-kit)';
const DAY = 86400e3;

export const SOURCES = {
  openverse: { key: null, kinds: ['photo'] },
  pixabay: { key: 'PIXABAY_API_KEY', kinds: ['video', 'photo'] },
  pexels: { key: 'PEXELS_API_KEY', kinds: ['video', 'photo'] },
  commons: { key: null, kinds: ['photo'] },
};

// The sources that can run now (a key where one is needed), in the order asked for.
export const DEFAULT_SOURCES = ['openverse', 'commons', 'pixabay', 'pexels'];
export function available(order = DEFAULT_SOURCES, env = process.env) {
  return order.filter((s) => SOURCES[s] && (!SOURCES[s].key || env[SOURCES[s].key]));
}

const pickFile = (files, want = 1920) => {
  const ok = files.filter((f) => f && f.url && f.w >= 1280);
  ok.sort((a, b) => Math.abs(a.w - want) - Math.abs(b.w - want));
  return ok[0] || null;
};

async function getJSON(url, { headers = {}, fetchImpl = fetch } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA, ...headers } });
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {   // rate limit, or Openverse's frequent 504s
      const wait = Math.min(60, Number(res.headers?.get?.('x-ratelimit-reset')) || (res.status === 429 ? 10 : 2) * (attempt + 1));
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
    return res.json();
  }
  throw new Error(`${new URL(url).host} rate limit`);
}

const ADAPTERS = {
  openverse: {
    async photo(q, { portrait }, { fetchImpl }) {
      const p = new URLSearchParams({ q, license_type: 'commercial,modification', page_size: '20', mature: 'false', aspect_ratio: portrait ? 'tall' : 'wide' });
      const j = await getJSON(`https://api.openverse.org/v1/images/?${p}`, { fetchImpl });
      return (j.results || []).filter((r) => r.url && r.width && r.height).map((r) => ({
        source: 'openverse', id: r.id, kind: 'photo', w: r.width, h: r.height, dur: 0, url: r.url, ext: /\.png$/i.test(r.url) ? 'png' : 'jpg',
        title: r.title || '', page: r.foreign_landing_url || r.detail_url, author: r.creator || 'unknown', via: r.source,
        license: openverseLicense(r), tags: `${r.title || ''} ${(r.tags || []).map((t) => t.name).join(' ')}`,
      }));
    },
  },
  pixabay: {
    async video(q, { portrait }, { env, fetchImpl }) {
      const p = new URLSearchParams({ key: env.PIXABAY_API_KEY, q: q.slice(0, 100), per_page: '20', safesearch: 'true' });
      const j = await getJSON(`https://pixabay.com/api/videos/?${p}`, { fetchImpl });
      return (j.hits || []).map((h) => {
        const f = pickFile(['large', 'medium', 'small'].map((k) => h.videos?.[k] && { url: h.videos[k].url, w: h.videos[k].width, h: h.videos[k].height }), portrait ? 1080 : 1920);
        return f && { source: 'pixabay', id: String(h.id), kind: 'video', w: f.w, h: f.h, dur: h.duration, url: f.url, ext: 'mp4', page: h.pageURL, author: h.user, license: 'Pixabay Content License', tags: h.tags || '' };
      }).filter(Boolean);
    },
    async photo(q, { portrait }, { env, fetchImpl }) {
      const p = new URLSearchParams({ key: env.PIXABAY_API_KEY, q: q.slice(0, 100), image_type: 'photo', orientation: portrait ? 'vertical' : 'horizontal', min_width: '1280', per_page: '20', safesearch: 'true' });
      const j = await getJSON(`https://pixabay.com/api/?${p}`, { fetchImpl });
      return (j.hits || []).map((h) => {
        const scale = Math.min(1, 1280 / Math.max(h.imageWidth, h.imageHeight));   // largeImageURL is at most 1280 px on its long side
        return { source: 'pixabay', id: String(h.id), kind: 'photo', w: Math.round(h.imageWidth * scale), h: Math.round(h.imageHeight * scale), dur: 0, url: h.largeImageURL, ext: 'jpg', page: h.pageURL, author: h.user, license: 'Pixabay Content License', tags: h.tags || '' };
      });
    },
  },
  pexels: {
    async video(q, { portrait }, { env, fetchImpl }) {
      const p = new URLSearchParams({ query: q, orientation: portrait ? 'portrait' : 'landscape', size: 'medium', per_page: '15' });
      const j = await getJSON(`https://api.pexels.com/videos/search?${p}`, { headers: { Authorization: env.PEXELS_API_KEY }, fetchImpl });
      return (j.videos || []).map((v) => {
        const f = pickFile((v.video_files || []).filter((x) => x.file_type === 'video/mp4').map((x) => ({ url: x.link, w: x.width, h: x.height })), portrait ? 1080 : 1920);
        return f && { source: 'pexels', id: String(v.id), kind: 'video', w: f.w, h: f.h, dur: v.duration, url: f.url, ext: 'mp4', page: v.url, author: v.user?.name || '', license: 'Pexels License', tags: slugWords(v.url) };
      }).filter(Boolean);
    },
    async photo(q, { portrait }, { env, fetchImpl }) {
      const p = new URLSearchParams({ query: q, orientation: portrait ? 'portrait' : 'landscape', per_page: '15' });
      const j = await getJSON(`https://api.pexels.com/v1/search?${p}`, { headers: { Authorization: env.PEXELS_API_KEY }, fetchImpl });
      return (j.photos || []).map((ph) => {
        const scale = Math.min(1, 1920 / Math.max(ph.width, ph.height));
        return { source: 'pexels', id: String(ph.id), kind: 'photo', w: Math.round(ph.width * scale), h: Math.round(ph.height * scale), dur: 0, url: `${ph.src?.original}?auto=compress&cs=tinysrgb&w=1920`, ext: 'jpg', page: ph.url, author: ph.photographer || '', license: 'Pexels License', tags: `${ph.alt || ''} ${slugWords(ph.url)}` };
      });
    },
  },
  commons: {
    async photo(q, _o, { fetchImpl }) {
      const p = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${q} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '15', prop: 'imageinfo', iiprop: 'url|size|extmetadata|mime', iiurlwidth: '1920', origin: '*' });
      const j = await getJSON(`https://commons.wikimedia.org/w/api.php?${p}`, { fetchImpl });
      const pages = Object.values(j.query?.pages || {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return pages.map((pg) => {
        const ii = pg.imageinfo?.[0];
        if (!ii || !/^image\/(jpeg|png)$/.test(ii.mime || '')) return null;
        const m = ii.extmetadata || {};
        const license = strip(m.LicenseShortName?.value || '');
        if (!commonsLicenseOk(license)) return null;
        const scale = Math.min(1, 1920 / Math.max(ii.width, ii.height));
        return { source: 'commons', id: String(pg.pageid), kind: 'photo', w: Math.round(ii.width * scale), h: Math.round(ii.height * scale), dur: 0, url: (ii.thumburl || ii.url).replace('//thumb.wikimedia.org/', '//upload.wikimedia.org/').replace(/\?.*$/, ''), ext: /png$/.test(ii.mime) ? 'png' : 'jpg', title: String(pg.title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, ''), page: ii.descriptionurl, author: strip(m.Artist?.value || 'unknown'), license, tags: `${pg.title || ''} ${strip(m.ImageDescription?.value || '').slice(0, 200)}` };
      }).filter(Boolean);
    },
  },
};

const openverseLicense = (r) => (r.license === 'cc0' ? 'CC0' : r.license === 'pdm' ? 'Public domain' : `CC ${String(r.license).toUpperCase()} ${r.license_version || ''}`.trim());

// Only licences that allow commercial use without asking: public domain, CC0, CC BY, CC BY-SA.
export function commonsLicenseOk(l) {
  const s = l.toLowerCase();
  if (/\bnc\b|non-?commercial|\bnd\b|no-?deriv|fair use/.test(s)) return false;
  return /public domain|^pd\b|cc0|cc[- ]by(-sa)?[- ]\d|cc[- ]by(-sa)?$/.test(s);
}
const strip = (h) => String(h).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const slugWords = (u = '') => (String(u).match(/\/(?:video|photo)\/([^/]+)/)?.[1] || '').replace(/-\d+$/, '').replace(/-/g, ' ');

// Search one source for one kind, through the cache.
export async function search(source, kind, query, { portrait = false, cacheDir, env = process.env, fetchImpl = fetch, offline = false, maxAge = 30 * DAY } = {}) {
  const ad = ADAPTERS[source]?.[kind];
  if (!ad) return [];
  const key = createHash('sha1').update(JSON.stringify([source, kind, query.toLowerCase().trim(), portrait])).digest('hex').slice(0, 20);
  const file = cacheDir && join(cacheDir, `${source}-${kind}-${key}.json`);
  if (file && existsSync(file) && (offline || Date.now() - statSync(file).mtimeMs < maxAge)) return JSON.parse(readFileSync(file, 'utf8'));
  if (offline) return [];
  const results = await ad(query, { portrait }, { env, fetchImpl });
  if (file) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(file, JSON.stringify(results)); }
  return results;
}

// Rank results for a moment: right shape, long enough, not used yet, words in common with the search.
export function rank(results, { query, narration = query, need = 2, portrait = false, used = new Set(), relevance = localRelevance }) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return results
    .map((r, k) => {
      const shapeOk = portrait ? r.h >= r.w * 0.9 || r.kind === 'photo' : r.w >= r.h;
      const sizeOk = Math.max(r.w, r.h) >= (r.kind === 'photo' ? 1000 : 1280);
      const lenOk = r.kind === 'photo' || r.dur >= need + 0.5;
      const tags = (r.tags || '').toLowerCase();
      const overlap = words.filter((w) => tags.includes(w)).length;
      const big = Math.min(1, Math.max(r.w, r.h) / 1920);
      const rel = relevance(narration, r);
      return { r: { ...r, relevance_score: rel.score, relevance_reason: rel.reason }, ok: shapeOk && sizeOk && lenOk && !used.has(`${r.source}-${r.id}`), score: rel.score * 8 + overlap * 2 + big * 2 - k * 0.1 };
    })
    .filter((x) => x.ok)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
}

// The order to try for one moment: videos first, then photos; Commons first for names and landmarks.
export function tryOrder(sources, type) {
  const tries = [...sources.filter((s) => SOURCES[s].kinds.includes('video')).map((s) => [s, 'video']), ...sources.filter((s) => SOURCES[s].kinds.includes('photo')).map((s) => [s, 'photo'])];
  if ((type === 'landmark' || type === 'proper' || type === 'person') && sources.includes('commons')) {
    const i = tries.findIndex(([s]) => s === 'commons');
    if (i > 0) tries.unshift(...tries.splice(i, 1));
  }
  return tries;
}

// Download once per provider id into assets/broll/stock/.
export async function download(r, dir, { fetchImpl = fetch } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${r.source}-${r.id}.${r.ext}`);
  if (existsSync(file) && statSync(file).size > 0) return file;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(r.url, { headers: { 'User-Agent': UA } });
    if (res.status === 429 && attempt < 2) { await new Promise((ok) => setTimeout(ok, (attempt + 1) * 20e3)); continue; }
    if (!res.ok) throw new Error(`download ${res.status} (${r.source} ${r.id})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (/^\s*</.test(buf.subarray(0, 64).toString('latin1'))) throw new Error(`download returned a web page, not media (${r.source} ${r.id})`);
    writeFileSync(file, buf);
    return file;
  }
}
