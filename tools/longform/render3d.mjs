#!/usr/bin/env node
// tools/longform/render3d.mjs: render a three.js scene (scenes/longform/3d/*.html) to a silent MP4.
//
//   node tools/longform/render3d.mjs <scene.html> --out x.mp4 [--data data.json] [--dur 7] [--fps 30]
//                                    [--still 3.2] [--res 1]
//
// The page contract is the same as the exploded-view films: window.SIM = { renderAt(t), duration, ready,
// sfx? }, and renderAt is a pure function of t. The page is served from the repo over a local port (so its
// import map can load three from node_modules), opened in headless Chrome, and each frame is read back
// from the canvas. Software GL works everywhere; a GPU is much faster (the GL line says which you have).
// Chrome: $CHROME_PATH, an installed Chrome/Edge/Chromium, or Playwright's own (npx playwright install chromium).
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };

function chromePath() {
  const c = [process.env.CHROME_PATH,
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    `${process.env['PROGRAMFILES'] || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`];
  return c.find((p) => p && existsSync(p)) || null;
}

function serve() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
    if (path === 'favicon.ico') { res.writeHead(204); res.end(); return; }
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

export async function render3d(scene, { out, data = {}, dur = null, fps = 30, still = null, res = 1, width = 1920, height = 1080, log = console.log } = {}) {
  const { chromium } = await import('playwright-core');
  const exe = chromePath();
  const { server, port } = await serve();
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), headless: true,
    args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', ...(process.env.MF_GPU ? [] : ['--use-gl=angle', '--use-angle=swiftshader'])] })
    .catch((e) => { server.close(); throw new Error(`could not start Chrome for 3D (${e.message.split('\n')[0]}). Install Chrome, or: npx playwright install chromium`); });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    await page.addInitScript(({ d, r }) => { window.DATA = d; window.__FILM__ = true; window.__RES__ = r; }, { d: { ...data, ...(dur ? { dur } : {}) }, r: res });
    await page.goto(`http://127.0.0.1:${port}/${relative(ROOT, resolve(scene)).split(sep).join('/')}?render`);
    await page.waitForFunction(() => window.SIM && window.SIM.renderAt, null, { timeout: 30000 }).catch(() => { throw new Error(`3D scene did not start: ${errors.slice(0, 3).join(' | ') || 'no window.SIM'}`); });
    const info = await page.evaluate(async () => { await window.SIM.ready; return { duration: window.SIM.duration, sfx: window.SIM.sfx || [], gl: window.SIM.gl || '' }; });
    if (errors.length) throw new Error(`3D scene error: ${errors[0]}`);
    const D = dur || info.duration;
    const grab = (t) => page.evaluate((tt) => window.SIM.capture(tt), t);
    if (still != null) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from((await grab(still)).split(',')[1], 'base64'));
      return { ok: true, still: out, gl: info.gl, sfx: info.sfx };
    }
    const frames = Math.round(D * fps);
    mkdirSync(dirname(out), { recursive: true });
    const ff = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(fps), '-g', String(fps * 2), '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((ok, no) => ff.on('close', (c) => (c === 0 ? ok() : no(new Error('ffmpeg exited ' + c)))));
    const t0 = Date.now();
    for (let i = 0; i < frames; i++) {
      const buf = Buffer.from((await grab(i / fps)).split(',')[1], 'base64');
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i && i % 60 === 0) log(`    3D frame ${i}/${frames} (${((Date.now() - t0) / i / 1000).toFixed(2)} s/frame, ${info.gl.includes('SwiftShader') ? 'software GL' : 'GPU'})`);
    }
    ff.stdin.end();
    await done;
    writeFileSync(out + '.sfx.json', JSON.stringify(info.sfx));
    return { ok: true, video: out, frames, gl: info.gl, sfx: info.sfx, secondsPerFrame: +(((Date.now() - t0) / frames) / 1000).toFixed(2) };
  } finally {
    await browser.close();
    server.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2), opt = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
  const scene = a.find((x, i) => !x.startsWith('--') && !(a[i - 1] || '').startsWith('--'));
  if (!scene) { console.error('usage: node tools/longform/render3d.mjs <scene.html> --out x.mp4 [--data d.json] [--dur 7] [--fps 30] [--still t]'); process.exit(2); }
  const still = opt('still') != null ? Number(opt('still')) : null;
  const name = scene.replace(/^.*[\\/]/, '').replace(/\.html$/, '');
  render3d(scene, { out: resolve(opt('out', join(ROOT, 'out', still != null ? `${name}_t${still}.jpg` : `${name}.mp4`))), data: opt('data') ? JSON.parse(readFileSync(opt('data'), 'utf8')) : {},
    dur: opt('dur') ? Number(opt('dur')) : null, fps: Number(opt('fps', 30)), still, res: Number(opt('res', 1)) })
    .then((r) => { console.log(still != null ? `${name}: still at ${still}s -> ${r.still}  [${r.gl}]` : `${name}: ${r.frames} frames, ${r.secondsPerFrame} s/frame -> ${r.video}`); })
    .catch((e) => { console.error('error: ' + e.message); process.exit(1); });
}
