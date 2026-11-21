import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
try {
  for (const [name, lateTime] of [['whiteboard-simulation', 4.2], ['whiteboard-one-take', 6.2]]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const scene = new URL(`../scenes/examples/${name}.html`, import.meta.url);
    await page.goto(scene.href);
    await page.waitForFunction(() => Number(document.querySelector('#sc')?.value) > 0);

    await page.locator('#pp').click();
    async function seek(seconds) {
      return page.locator('#sc').evaluate((slider, time) => {
        slider.value = String(time);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        return document.querySelector('#stage').toDataURL();
      }, seconds);
    }
    const early = await seek(0.4);
    const late = await seek(lateTime);
    assert.notEqual(late, early);
    assert.equal(await seek(0.4), early);
    assert.equal(await seek(lateTime), late);

    await page.goto(scene.href + '?render');
    await page.waitForFunction(() => typeof window.draw === 'function');
    const renderFrame = await page.evaluate(async (time) => {
      await window.__ready;
      window.draw(time);
      return document.querySelector('#stage').toDataURL();
    }, lateTime);
    assert.equal(renderFrame, late);
    assert.deepEqual(errors, []);
    console.log(`${name}: browser playback, seeking, and render-mode frame parity passed`);
    await page.close();
  }
} finally {
  await browser.close();
}
