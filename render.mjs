#!/usr/bin/env node
// render.mjs: turn a scene (HTML + draw(t)) into an MP4, plus an optional GIF and a QA
// contact sheet.
//
//   node render.mjs scenes/examples/showcase.html [--out out/name.mp4] [--gif] [--sheet]
//                   [--audio music.mp3] [--fps 30] [--from 0 --to 5]
//   node render.mjs <scene.html> --still 12        # one PNG at t=12s, for checking a frame
//
// Engines:
//   --engine skia    (default) runs the scene's scripts in Node on skia-canvas. No browser at all.
//                    Fonts come from fonts/.
//   --engine chrome  attaches to a Chrome already running with --remote-debugging-port
//                    (--cdp <url>, default http://localhost:9222).
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { resolve, basename, extname, dirname, join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const VALUED = ['out', 'audio', 'fps', 'from', 'to', 'cdp', 'still', 'engine'];
const scene = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]?.slice(2)));

if (!scene || !existsSync(scene)) {
  console.error('usage: node render.mjs <scene.html> [--engine skia|chrome] [--out file.mp4] [--gif] [--sheet] [--still t] [--audio file] [--fps n] [--from s --to s]');
  process.exit(2);
}

const engineName = opt('engine', 'skia');
if (!['skia', 'chrome'].includes(engineName)) { console.error(`unknown engine: ${engineName}`); process.exit(2); }


const name = basename(scene, extname(scene));
const out = resolve(opt('out', join('out', name + '.mp4')));
mkdirSync(dirname(out), { recursive: true });

function run(argv, { input } = {}) {
  return new Promise((res, rej) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
    p.on('error', rej);
    p.on('close', (code) => (code === 0 ? res() : rej(new Error('ffmpeg exited ' + code))));
    if (input) input(p.stdin).catch((e) => { p.kill(); rej(e); });
  });
}

const { open } = await import(`./engines/${engineName}.mjs`);
let engine;
let exitCode = 0;
try {
  engine = await open(scene, { cdp: opt('cdp', process.env.CDP_URL || 'http://localhost:9222') });
  const { V } = engine;

  if (opt('still') !== undefined) {
    const t = Number(opt('still'));
    const png = out.replace(/\.mp4$/i, `_t${t}.png`);
    writeFileSync(png, await engine.still(t));
    console.log(`${name}: still at ${t}s -> ${png}`);
  } else {
    const fps = Number(opt('fps', V.fps));
    const from = Number(opt('from', 0));
    const to = Math.min(Number(opt('to', V.duration)), V.duration);
    const frames = Math.round((to - from) * fps);
    console.log(`${name} [${engineName}]: ${V.width}x${V.height} @ ${fps}fps, ${from}-${to}s = ${frames} frames -> ${out}`);

    const input = engine.format === 'rgba'
      ? ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${V.width}x${V.height}`, '-framerate', String(fps), '-i', '-']
      : ['-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
    const audio = opt('audio');
    const enc = [
      ...input,
      ...(audio ? ['-ss', String(from), '-i', resolve(audio), '-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
    ];

    const started = Date.now();
    await run(enc, {
      input: async (stdin) => {
        for (let i = 0; i < frames; i++) {
          const buf = await engine.frame(from + i / fps);
          if (!stdin.write(buf)) await new Promise((r) => stdin.once('drain', r));
          if (i % fps === 0) process.stdout.write(`\r  frame ${i}/${frames}`);
        }
        stdin.end();
      },
    });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\r  ${frames} frames in ${secs}s, ${(statSync(out).size / 1e6).toFixed(2)} MB`);

    if (flag('gif')) {
      const gif = out.replace(/\.mp4$/i, '.gif');
      await run(['-i', out, '-filter_complex',
        'fps=15,scale=540:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', gif]);
      console.log('  gif   ' + gif);
    }
    if (flag('sheet')) {
      // Six evenly spaced stills in one image: the QA check for clipped text and overlaps.
      const sheet = out.replace(/\.mp4$/i, '.sheet.png');
      const n = 6, span = to - from;
      await run(['-i', out, '-vf', `fps=${n}/${span},scale=360:-1,tile=${n}x1:padding=8:color=gray`, '-frames:v', '1', sheet]);
      console.log('  sheet ' + sheet);
    }
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  exitCode = 1;
} finally {
  await engine?.close();
}
process.exit(exitCode);
