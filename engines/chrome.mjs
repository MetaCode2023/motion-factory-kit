// chrome engine: attaches to a Chrome already running with --remote-debugging-port and renders
// in a fresh, isolated browser context (its own window, none of your cookies). It never launches
// or downloads a browser, and closes only the context it created.
//
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function open(scenePath, { cdp = 'http://localhost:9222', mime = 'image/png', captions = null, variant = 0, data = null } = {}) {
  const browser = await chromium.connectOverCDP(cdp).catch((e) => {
    throw new Error(`Could not attach to Chrome at ${cdp}. Is it running with --remote-debugging-port?\n${e.message}`);
  });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('[scene error]', e.message));
    if (captions) await page.addInitScript((c) => { window.CAPTIONS = c; }, captions);
    if (variant) await page.addInitScript((v) => { window.VARIANT = v; }, variant);
    if (data) await page.addInitScript((d) => { window.DATA = d; }, data);
    await page.goto(pathToFileURL(resolve(scenePath)).href + '?render');
    // Two scene contracts: kit/motion.js scenes (window.VIDEO, #stage), and the legacy
    // starter-kit pages (top-level `const DUR`, global draw(t), <canvas id="c">, optional FOOD_READY).
    await page.waitForFunction(() => (window.VIDEO && window.__ready) || (typeof draw === 'function' && typeof DUR === 'number'), null, { timeout: 15000 });
    const V = await page.evaluate(async () => {
      // Canvas text doesn't trigger web-font loads, so load every declared face up front.
      await Promise.all([...document.fonts].map((f) => f.load().catch(() => {})));
      await document.fonts.ready;
      // A failed face (offline, blocked Google Fonts) would silently fall back to a system font.
      const bad = [...document.fonts].filter((f) => f.status === 'error').map((f) => `${f.weight} ${f.family}`);
      if (bad.length) throw new Error('fonts failed to load: ' + [...new Set(bad)].join(', '));
      if (window.VIDEO) { await window.__ready; return { ...window.VIDEO, canvas: 'stage' }; }
      if (window.FOOD_READY) await window.FOOD_READY;
      const c = document.getElementById('c');
      return { width: c.width, height: c.height, fps: 30, duration: DUR, canvas: 'c' }; // eslint-disable-line no-undef
    });

    const grab = async (t, type) => {
      const dataUrl = await page.evaluate(({ t, type, canvas }) => {
        draw(t); // eslint-disable-line no-undef
        return document.getElementById(canvas).toDataURL(type, 0.95);
      }, { t, type, canvas: V.canvas });
      return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    };
    return {
      V: { width: V.width, height: V.height, fps: V.fps, duration: V.duration },
      format: 'png',
      frame: (t) => grab(t, mime),
      still: (t) => grab(t, 'image/png'),
      close: () => context.close(),
    };
  } catch (e) {
    await context.close();
    throw e;
  }
}
