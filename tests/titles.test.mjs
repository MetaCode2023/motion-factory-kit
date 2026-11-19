// Title templates (opening, chapter, end card) and the lower third width cap. Offline: the skia engine in
// text-only mode draws just the glyphs, so a frame's alpha is exactly where text is.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { Canvas } from 'skia-canvas';
import { open } from '../engines/skia.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const scene = (name) => new URL(`../scenes/longform/${name}.html`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LONG = 'The quick brown fox jumps over the lazy dog while the long and winding river of words keeps on flowing past every margin you could ever set for it, and then some more words to be sure';
const SAMPLES = {
  title: { dur: 6, kicker: 'Part one of three', title: 'Why money works the way it does', sub: 'A first look at the machine' },
  chapter: { dur: 6, n: 2, title: 'How a loan creates a deposit' },
  endcard: { dur: 6, title: 'Thanks for watching', cta: 'Subscribe for the next one', url: 'example.com/next' },
};
const LONGS = {
  title: { dur: 6, kicker: LONG, title: LONG, sub: LONG },
  chapter: { dur: 6, n: 12, title: LONG },
  endcard: { dur: 6, title: LONG, cta: LONG, url: 'https://example.com/' + 'very/long/path/'.repeat(8) },
};
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1000 };

async function bbox(name, data, t) {
  const eng = await open(scene(name), { textOnly: true, data });
  const { width, height } = eng.V, px = eng.frame(t);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (px[(y * width + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  await eng.close();
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

test('each title scene draws non-empty text at t=0.5, 1.5, 3', async () => {
  for (const name of Object.keys(SAMPLES)) for (const t of [0.5, 1.5, 3]) {
    assert.ok(await bbox(name, SAMPLES[name], t), `${name} draws nothing at t=${t}`);
  }
});

test('title text stays inside the youtube safe zone with long strings', async () => {
  for (const name of Object.keys(LONGS)) for (const t of [0.5, 1.5, 3, 5.9]) {
    const b = await bbox(name, LONGS[name], t);
    assert.ok(b, `${name} draws nothing at t=${t}`);
    assert.ok(b.x0 >= SAFE.left && b.x1 <= SAFE.right && b.y0 >= SAFE.top && b.y1 <= SAFE.bottom,
      `${name} t=${t}: ${JSON.stringify(b)} outside ${JSON.stringify(SAFE)}`);
  }
});

test('the end card keeps the right side clear for YouTube end-screen elements', async () => {
  for (const data of [SAMPLES.endcard, LONGS.endcard]) for (const t of [3, 5.9]) {
    const b = await bbox('endcard', data, t);
    assert.ok(b.x1 <= 960, `end card text reaches x=${b.x1}`);
  }
});

function loadKit() {
  const window = {};
  const ctx = vm.createContext({ window, Image: class { set src(v) { setTimeout(() => this.onload && this.onload(), 0); } }, document: { fonts: { load: async () => [1], ready: Promise.resolve() } }, console });
  for (const f of ['motion.js', 'blocks.js']) vm.runInContext(read(`../kit/${f}`), ctx);
  return window;
}

function lowerThirdBox(opts) {
  const { B } = loadKit(), canvas = new Canvas(1080, 1920), ctx = canvas.getContext('2d');
  B.lowerThird(ctx, 3, { at: 0, until: 9, name: 'A very long name that does not fit a narrow box at all', detail: 'and an equally long detail line', ...opts });
  const { data } = ctx.getImageData(0, 0, 1080, 1920);
  let x1 = -1;
  for (let y = 0; y < 1920; y++) for (let x = 0; x < 1080; x++) if (data[(y * 1080 + x) * 4 + 3] > 200 && x > x1) x1 = x;
  return x1;
}

test('B.lowerThird respects maxW', () => {
  const capped = lowerThirdBox({ maxW: 400 });
  assert.ok(capped <= 70 + 14 + 400 + 1, `drew to x=${capped}`);
  assert.ok(lowerThirdBox({}) > 70 + 14 + 400 + 40, 'default width is still 940');
  assert.equal(lowerThirdBox({ name: 'Ann', detail: '' , maxW: 940 }), lowerThirdBox({ name: 'Ann', detail: '' }));
});

test('script cues reach the title scenes: title and endcard by name, chapter through anim', async () => {
  const { parseCue } = await import('../tools/longform/script.mjs');
  const a = parseCue('title kicker: Part one | title: Why money works | sub: A first look');
  assert.equal(a.scene, 'scenes/longform/title.html');
  assert.deepEqual(a.data, { kicker: 'Part one', title: 'Why money works', sub: 'A first look' });
  const b = parseCue('endcard title: Thanks | cta: Subscribe | url: example.com');
  assert.equal(b.scene, 'scenes/longform/endcard.html');
  assert.equal(b.data.cta, 'Subscribe');
  const c = parseCue('anim scenes/longform/chapter.html | n: 2 | title: How a loan works');
  assert.equal(c.scene, 'scenes/longform/chapter.html');
  assert.deepEqual(c.data, { n: 2, title: 'How a loan works' });
});
