// skia engine: runs a scene's scripts in a Node vm context against skia-canvas.
// No browser of any kind.
//
// The scene HTML is never laid out. Only its <script> blocks run, its <canvas> tags become skia
// canvases, and everything else in the DOM is a do-nothing stub. That is enough for draw(t)
// scenes, which paint everything onto the canvas themselves.
import { Canvas, Image, FontLibrary, Path2D, DOMMatrix } from 'skia-canvas';
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts');
const CLIP_CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', '.cache', 'clips');
const FAMILY_WORDS = { jetbrains: 'JetBrains' };

// Register every fonts/<slug>-latin-<weight>-normal.woff2 under the family named by its slug.
// The alias matters: the Barlow Condensed files call themselves "Barlow" internally, so without
// it, "Barlow Condensed" silently falls back to a system font.
let fontsLoaded = false;
function loadFonts() {
  if (fontsLoaded) return;
  const groups = {};
  for (const f of readdirSync(FONT_DIR)) {
    const m = f.match(/^(.+)-latin-\d+-(normal|italic)\.(woff2?|ttf|otf)$/);
    if (!m) continue;
    const family = m[1].split('-').map((w) => FAMILY_WORDS[w] || w[0].toUpperCase() + w.slice(1)).join(' ');
    (groups[family] ||= []).push(join(FONT_DIR, f));
  }
  for (const [family, files] of Object.entries(groups)) FontLibrary.use(family, files);
  fontsLoaded = true;
}

// Family names a scene asks Google Fonts for, e.g. family=Barlow+Condensed:wght@700;800
function linkedFamilies(html) {
  const out = new Set();
  for (const [, href] of html.matchAll(/<link[^>]+href="([^"]*fonts\.googleapis\.com[^"]*)"/gi)) {
    for (const [, fam] of href.replace(/&amp;/g, '&').matchAll(/family=([^:&]+)/g)) out.add(decodeURIComponent(fam.replace(/\+/g, ' ')));
  }
  return [...out];
}

// "800 40px "Plus Jakarta Sans"" -> "Plus Jakarta Sans"
const familyOf = (spec) => spec.replace(/^.*?\d+(\.\d+)?px\s*/, '').split(',')[0].trim().replace(/^["']|["']$/g, '');

// A stand-in for any DOM node or API the scene touches but the render doesn't need.
// Every property read returns another stub, calls return stubs, and writes are kept.
function stub() {
  const store = { style: {}, dataset: {} };
  return new Proxy(function () {}, {
    get(_, k) {
      if (k in store) return store[k];
      if (k === 'then') return undefined; // don't look like a Promise
      if (k === Symbol.toPrimitive) return () => '';
      return (store[k] = stub());
    },
    set(_, k, v) { store[k] = v; return true; },
    apply() { return stub(); },
  });
}

// A 1x1 transparent PNG: what every picture becomes in layout mode.
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';

function makeCanvas(w, h, textOnly = false) {
  const c = new Canvas(w, h);
  c.style = {};
  if (textOnly) {
    const ctx = c.getContext('2d');
    for (const method of ['fill', 'stroke', 'fillRect', 'strokeRect']) ctx[method] = () => {};
    for (const method of ['fillText', 'strokeText']) {
      const native = ctx[method].bind(ctx);
      ctx[method] = (...args) => {
        ctx.save();
        ctx.fillStyle = ctx.strokeStyle = '#fff';
        ctx.shadowBlur = 0; ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
        ctx.globalCompositeOperation = 'source-over';
        native(...args); ctx.restore();
      };
    }
  }
  return c;
}

// layout: blank every image, so the frames show only code-drawn text and UI. score.py measures
// the TikTok safe zones on these, because photo texture would otherwise read as text.
export async function open(scenePath, { layout = false, textOnly = false, captions = null, variant = 0, data = null } = {}) {
  loadFonts();
  const file = resolve(scenePath);
  const html = readFileSync(file, 'utf8');

  const missing = linkedFamilies(html).filter((f) => !FontLibrary.has(f));
  if (missing.length) throw new Error(`fonts not in fonts/: ${missing.join(', ')}. Add the woff2 files (fontsource naming).`);

  const canvases = [];
  for (const [tag] of html.matchAll(/<canvas\b[^>]*>/gi)) {
    const attr = (n) => tag.match(new RegExp(`\\b${n}="?([\\w-]+)`))?.[1];
    const c = makeCanvas(Number(attr('width') || 300), Number(attr('height') || 150), textOnly);
    c.id = attr('id') || '';
    canvases.push(c);
  }
  const byId = (id) => canvases.find((c) => c.id === id);

  const document = {
    getElementById: (id) => byId(id) || stub(),
    querySelector: (sel) => (sel.startsWith('#') ? byId(sel.slice(1)) : sel === 'canvas' ? canvases[0] : null) || stub(),
    querySelectorAll: () => [],
    createElement: (tag) => {
      if (String(tag).toLowerCase() !== 'canvas') return stub();
      const c = makeCanvas(300, 150, textOnly);
      canvases.push(c);
      return c;
    },
    fonts: {
      ready: Promise.resolve(),
      load: async (spec) => (FontLibrary.has(familyOf(spec)) ? [{ family: familyOf(spec) }] : []),
      check: (spec) => FontLibrary.has(familyOf(spec)),
      [Symbol.iterator]: function* () {},
    },
    body: stub(), head: stub(), documentElement: stub(),
    addEventListener() {}, removeEventListener() {},
  };

  // Resolve relative image paths against the scene's folder, as a browser would, and add the
  // naturalWidth/naturalHeight skia lacks (scenes gate drawImage on them, so without these
  // images silently never draw).
  class SceneImage extends Image {
    get naturalWidth() { return this.complete ? this.width : 0; }
    get naturalHeight() { return this.complete ? this.height : 0; }
    get src() { return super.src; }
    set src(v) {
      if (layout || textOnly) { super.src = BLANK_PNG; return; }
      if (Buffer.isBuffer(v)) { super.src = v; return; }
      super.src = /^(data:|https?:|file:|[a-z]:[\\/]|\/)/i.test(v) ? v : resolve(dirname(file), v);
    }
  }

  const sandbox = {
    document, Image: SceneImage, Path2D, DOMMatrix, console, URLSearchParams, performance,
    setTimeout, clearTimeout, setInterval, clearInterval,
    location: { search: '?render', href: 'file:///' + file.replace(/\\/g, '/') + '?render' },
    navigator: { userAgent: 'motion-factory/skia' },
    devicePixelRatio: 1,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},   // nothing plays on its own
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener() {}, removeEventListener() {},
  };
  sandbox.window = sandbox.self = sandbox.globalThis = sandbox;

  // Video clips (M.video): decode once into a cached JPG sequence at the scene's frame rate, then
  // hand frames to the scene synchronously, one at a time, so long clips don't fill memory.
  const clips = [];
  sandbox.__loadVideo = (src, fps) => {
    const abs = /^([a-z]:[\\/]|\/)/i.test(src) ? src : resolve(dirname(file), src);
    if (!existsSync(abs)) return { missing: true, src };
    const st = statSync(abs);
    const dir = join(CLIP_CACHE, createHash('sha1').update([abs, st.size, st.mtimeMs, fps].join('|')).digest('hex').slice(0, 16));
    const probe = spawnSync(ffmpegPath, ['-hide_banner', '-i', abs], { encoding: 'utf8' }).stderr;
    const dur = probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
    const size = probe.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
    if (!existsSync(join(dir, '00001.jpg'))) {
      mkdirSync(dir, { recursive: true });
      const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', abs, '-vf', `fps=${fps}`, '-q:v', '3', join(dir, '%05d.jpg')], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`could not decode video ${src}: ${r.stderr}`);
    }
    const frames = readdirSync(dir).filter((f) => f.endsWith('.jpg')).length;
    clips.push(dir);
    return { id: clips.length - 1, frames, fps, duration: dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : frames / fps,
      width: size ? +size[1] : 0, height: size ? +size[2] : 0, hasAudio: /Audio:/.test(probe) };
  };
  sandbox.__videoFrame = (id, i) => {
    const img = new SceneImage();
    img.src = layout || textOnly ? BLANK_PNG : readFileSync(join(clips[id], String(i + 1).padStart(5, '0') + '.jpg'));
    return img;
  };
  if (captions) sandbox.CAPTIONS = captions;
  if (variant) sandbox.VARIANT = variant;
  if (data) sandbox.DATA = data;   // content for M.data() (batch rows, edit plans)   // word timings from make.mjs, read by the kit
  const context = vm.createContext(sandbox);

  // Run the scene's scripts in page order. Errors after draw() exists (usually the preview
  // transport poking at DOM it expects) are reported but don't stop the render.
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = attrs.match(/\bsrc="([^"]+)"/)?.[1];
    if (src && /^(https?:)?\/\//.test(src)) throw new Error(`remote script not supported in the skia engine: ${src}`);
    const code = src ? readFileSync(resolve(dirname(file), src), 'utf8') : body;
    const filename = src ? resolve(dirname(file), src) : file;
    try {
      new vm.Script(code, { filename }).runInContext(context);
    } catch (e) {
      if (vm.runInContext('typeof draw', context) !== 'function') throw e;
      console.warn(`[scene] ignored error after draw() was defined: ${e.message}`);
    }
  }

  let V, canvas;
  if (sandbox.VIDEO) {
    await vm.runInContext('window.__ready', context);
    V = { ...sandbox.VIDEO };
    canvas = byId('stage');
  } else if (vm.runInContext("typeof draw === 'function' && typeof DUR === 'number'", context)) {
    await vm.runInContext('window.FOOD_READY', context);
    canvas = byId('c');
    V = { width: canvas.width, height: canvas.height, fps: 30, duration: vm.runInContext('DUR', context) };
  } else {
    throw new Error('not a scene: expected window.VIDEO (kit/motion.js) or a global draw(t) with const DUR');
  }
  if (!canvas) throw new Error('scene canvas not found');

  const draw = vm.runInContext('draw', context);
  const ctx = canvas.getContext('2d');
  return {
    V,
    format: 'rgba',
    frame(t) {
      if (textOnly) { ctx.save(); ctx.resetTransform(); ctx.clearRect(0, 0, V.width, V.height); ctx.restore(); }
      draw(t);
      const { data } = ctx.getImageData(0, 0, V.width, V.height);
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    },
    async still(t) {
      draw(t);
      return canvas.toBuffer('png');
    },
    async close() {},
  };
}
