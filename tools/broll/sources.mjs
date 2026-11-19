// tools/broll/sources.mjs: free stock search behind one shape, so the picker doesn't care where media comes from.
//
//   Openverse  photos            no key   CC0 / PDM / CC BY / CC BY-SA (commercial use + changes allowed), mostly Flickr
//   Commons    videos + photos   no key   Wikimedia Commons; per file: CC0 / PD / CC BY / CC BY-SA only
//   YouTube    videos            no key, needs yt-dlp   only videos their uploader published under YouTube's
//                                         Creative Commons licence (CC BY, reuse allowed), or from channels the
//                                         plan lists in auto_broll.channels (your own, or ones you have cleared).
//                                         Only the few seconds used are downloaded.
//   Pixabay    videos + photos   PIXABAY_API_KEY (optional)   Pixabay Content License
//   Pexels     videos + photos   PEXELS_API_KEY  (optional; new keys are paused)   Pexels License
//
// Every result: { source, id, kind: 'video'|'photo', w, h, dur, url, ext, page, author, license, tags }.
// Searches are cached for 30 days (Pixabay asks for at least 24 h) in assets/broll/.cache/search/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const UA = 'motion-factory-kit/1.0 (automatic B-roll; https://github.com/metacode2023/motion-factory-kit)';
const DAY = 86400e3;

export const SOURCES = {
  openverse: { key: null, kinds: ['photo'] },
  pixabay: { key: 'PIXABAY_API_KEY', kinds: ['video', 'photo'] },
  pexels: { key: 'PEXELS_API_KEY', kinds: ['video', 'photo'] },
  commons: { key: null, kinds: ['video', 'photo'] },
  youtube: { key: null, tool: 'yt-dlp', kinds: ['video'] },
};
// Videos are tried in this order whatever the order of `sources`: clean stock first, then Commons, then YouTube.
const VIDEO_ORDER = ['pixabay', 'pexels', 'commons', 'youtube'];

// yt-dlp, if it is installed (pip install yt-dlp). Looked up once.
let YTDLP;
export function findYtdlp() {
  if (YTDLP === undefined) YTDLP = ['yt-dlp', 'yt-dlp.exe'].find((b) => { try { return spawnSync(b, ['--version'], { timeout: 15000 }).status === 0; } catch { return false; } }) || null;
  return YTDLP;
}
const runTool = (bin, args) => spawnSync(bin, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 256 * 1024 * 1024 });

// The sources that can run now (a key where one is needed), in the order asked for.
export const DEFAULT_SOURCES = ['openverse', 'commons', 'pixabay', 'pexels', 'youtube'];
export function available(order = DEFAULT_SOURCES, env = process.env, { ytdlp = findYtdlp() } = {}) {
  return order.filter((s) => SOURCES[s] && (!SOURCES[s].key || env[SOURCES[s].key]) && (!SOURCES[s].tool || ytdlp));
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
    async video(q, _o, { fetchImpl }) {
      const p = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${q} filetype:video`, gsrnamespace: '6', gsrlimit: '15', prop: 'videoinfo', viprop: 'url|size|mime|extmetadata|derivatives', origin: '*' });
      const j = await getJSON(`https://commons.wikimedia.org/w/api.php?${p}`, { fetchImpl });
      const pages = Object.values(j.query?.pages || {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return pages.map((pg) => {
        const vi = (pg.videoinfo || pg.imageinfo)?.[0];
        if (!vi || !/^(video|application\/ogg)/.test(vi.mime || '') || !(vi.duration > 0)) return null;
        const m = vi.extmetadata || {};
        const license = strip(m.LicenseShortName?.value || '');
        if (!commonsLicenseOk(license)) return null;
        // A ready-made 720p-1080p transcode if there is one (originals can be gigabytes), else the original up to 200 MB.
        const ders = (vi.derivatives || []).filter((d) => d.src && /^video\/(webm|mp4)/.test(d.type || '') && d.height >= 720 && d.height <= 1080).sort((a, b) => b.height - a.height);
        const pick = ders[0] ? { url: ders[0].src, w: ders[0].width, h: ders[0].height } : vi.size <= 200e6 ? { url: vi.url, w: vi.width, h: vi.height } : null;
        if (!pick) return null;
        const url = pick.url.startsWith('//') ? 'https:' + pick.url : pick.url;
        return { source: 'commons', id: String(pg.pageid), kind: 'video', w: pick.w, h: pick.h, dur: +Number(vi.duration).toFixed(1), url, ext: /\.mp4(\?|$)/i.test(url) ? 'mp4' : /\.ogv(\?|$)/i.test(url) ? 'ogv' : 'webm',
          title: String(pg.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''), page: vi.descriptionurl, author: strip(m.Artist?.value || 'unknown'), license,
          tags: `${pg.title || ''} ${strip(m.Categories?.value || '')}`, description: strip(m.ImageDescription?.value || '').slice(0, 400) };
      }).filter(Boolean);
    },
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

// YouTube through yt-dlp. Two searches: the site's own Creative Commons filter, and (if the plan lists channels)
// a plain search kept only where the uploader is one of them. Every result's licence is read from the video's
// own metadata; a video with the standard YouTube licence from an unlisted channel is never returned.
ADAPTERS.youtube = {
  async video(q, { channels = [] }, { run = runTool, ytdlp = findYtdlp() }) {
    if (!ytdlp) return [];
    const base = ['--dump-json', '--no-download', '--no-warnings', '--ignore-errors', '--no-playlist', '--playlist-end', '8', '--match-filter', '!is_live & duration>6 & duration<5400 & age_limit<18'];
    const listed = channels.map((c) => String(c).toLowerCase().replace(/^@/, ''));
    const urls = [`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIwAQ%253D%253D`, ...(listed.length ? [`ytsearch8:${q}`] : [])];
    const seen = new Set(), out = [];
    for (const u of urls) {
      const r = run(ytdlp, [...base, u]);
      for (const line of String(r.stdout || '').split('\n')) {
        let v;
        try { v = JSON.parse(line); } catch { continue; }
        if (!v?.id || seen.has(v.id)) continue;
        const cc = /creative commons/i.test(v.license || '');
        const who = [v.channel, v.uploader, v.uploader_id, v.channel_id].filter(Boolean).map((x) => String(x).toLowerCase().replace(/^@/, ''));
        const mine = listed.some((c) => who.includes(c));
        if (!cc && !mine) continue;
        seen.add(v.id);
        out.push({ source: 'youtube', id: v.id, kind: 'video', fetch: 'ytdlp', w: v.width || 1920, h: v.height || 1080, dur: v.duration, url: v.webpage_url || `https://www.youtube.com/watch?v=${v.id}`, ext: 'mp4',
          title: v.title || '', page: v.webpage_url || `https://www.youtube.com/watch?v=${v.id}`, author: v.channel || v.uploader || 'unknown',
          license: cc ? 'CC BY (YouTube Creative Commons Attribution licence)' : 'channel listed in the plan (auto_broll.channels)',
          tags: `${v.title || ''} ${(v.tags || []).join(' ')} ${(v.categories || []).join(' ')}`, description: String(v.description || '').slice(0, 600) });
      }
    }
    return out;
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
export async function search(source, kind, query, { portrait = false, channels = [], cacheDir, env = process.env, fetchImpl = fetch, offline = false, maxAge = 30 * DAY, run, ytdlp } = {}) {
  const ad = ADAPTERS[source]?.[kind];
  if (!ad) return [];
  const key = createHash('sha1').update(JSON.stringify([source, kind, query.toLowerCase().trim(), portrait, ...(source === 'youtube' && channels.length ? [channels] : [])])).digest('hex').slice(0, 20);
  const file = cacheDir && join(cacheDir, `${source}-${kind}-${key}.json`);
  if (file && existsSync(file) && (offline || Date.now() - statSync(file).mtimeMs < maxAge)) return JSON.parse(readFileSync(file, 'utf8'));
  if (offline) return [];
  const results = await ad(query, { portrait, channels }, { env, fetchImpl, ...(run ? { run } : {}), ...(ytdlp !== undefined ? { ytdlp } : {}) });
  if (file) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(file, JSON.stringify(results)); }
  return results;
}

// Rank results for a moment: right shape, long enough, not used yet, words in common with the search.
export function rank(results, { query, need = 2, portrait = false, used = new Set() }) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return results
    .map((r, k) => {
      const shapeOk = portrait ? r.h >= r.w * 0.9 || r.kind === 'photo' : r.w >= r.h;
      const sizeOk = Math.max(r.w, r.h) >= (r.kind === 'photo' ? 1000 : 1280);
      const lenOk = r.kind === 'photo' || r.dur >= need + 0.5;
      const tags = (r.tags || '').toLowerCase();
      const overlap = words.filter((w) => tags.includes(w)).length;
      const big = Math.min(1, Math.max(r.w, r.h) / 1920);
      return { r, ok: shapeOk && sizeOk && lenOk && !used.has(`${r.source}-${r.id}`), score: overlap * 2 + big * 2 - k * 0.1 };
    })
    .filter((x) => x.ok)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
}

// The order to try for one moment: videos first, then photos (Commons photos ahead of the other photo sources
// for names and landmarks; `photos: false` = moving pictures only).
export function tryOrder(sources, type, { photos = true } = {}) {
  const vids = sources.filter((s) => SOURCES[s].kinds.includes('video')).sort((a, b) => VIDEO_ORDER.indexOf(a) - VIDEO_ORDER.indexOf(b));
  const tries = [...vids.map((s) => [s, 'video']), ...(photos ? sources.filter((s) => SOURCES[s].kinds.includes('photo')).map((s) => [s, 'photo']) : [])];
  if ((type === 'landmark' || type === 'proper' || type === 'person') && sources.includes('commons')) {
    const i = tries.findIndex(([s, k]) => s === 'commons' && k === 'photo');
    if (i > vids.length) tries.splice(vids.length, 0, ...tries.splice(i, 1));
  }
  return tries;
}

// Download once per provider id into assets/broll/stock/.
// yt-dlp results: only the seconds that will be used (r.from .. r.from + r.take), picture only, up to 1080p.
export async function download(r, dir, { fetchImpl = fetch, run = runTool, ytdlp = findYtdlp(), ffmpeg } = {}) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${r.source}-${r.id}.${r.ext}`);
  if (existsSync(file) && statSync(file).size > 0) return file;
  if (r.fetch === 'ytdlp') {
    if (!ytdlp) throw new Error('yt-dlp is not installed (pip install yt-dlp)');
    const from = Math.max(0, r.from || 0), to = from + (r.take || 6);
    const res = run(ytdlp, ['-f', 'bv*[height<=1080][ext=mp4]/bv*[height<=1080]/b[height<=1080]', '--remux-video', 'mp4', '--download-sections', `*${from.toFixed(1)}-${to.toFixed(1)}`, '--force-keyframes-at-cuts',
      '--no-playlist', '--no-warnings', ...(ffmpeg ? ['--ffmpeg-location', ffmpeg] : []), '-o', file, r.url]);
    if (res.status !== 0 || !existsSync(file)) throw new Error(`yt-dlp: ${String(res.stderr || '').trim().split('\n').pop() || 'download failed'} (${r.id})`);
    return file;
  }
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
