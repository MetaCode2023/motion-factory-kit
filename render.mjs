#!/usr/bin/env node
// render.mjs: turn a scene (HTML + draw(t)) into an MP4, plus an optional GIF and a QA
// contact sheet.
//
//   node render.mjs scenes/examples/showcase.html [--out out/name.mp4] [--gif] [--sheet]
//                   [--audio music.mp3] [--fps 30] [--from 0 --to 5]
//   node render.mjs <scene.html> --still 12        # one PNG at t=12s, for checking a frame
//   node render.mjs <scene.html> --captions out/x.captions.json   # word timings (make.mjs writes these)
//
// For narration, music, effects and captions in one step, use make.mjs instead.
//
// Engines:
//   --engine skia    (default) runs the scene's scripts in Node on skia-canvas. No browser at all.
//                    Fonts come from fonts/.
//   --engine chrome  attaches to a Chrome already running with --remote-debugging-port
//                    (--cdp <url>, default http://localhost:9222).
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, existsSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, basename, extname, dirname, join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const VALUED = ['out', 'audio', 'fps', 'from', 'to', 'cdp', 'still', 'engine', 'captions', 'crf', 'variant', 'motion-blur', 'jobs', 'data'];
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
  const captions = opt('captions') ? JSON.parse(readFileSync(opt('captions'), 'utf8')) : null;
  engine = await open(scene, { cdp: opt('cdp', process.env.CDP_URL || 'http://localhost:9222'), captions, variant: Number(opt('variant', 0)), textOnly: flag('text-only'), data: opt('data') ? JSON.parse(readFileSync(opt('data'), 'utf8')) : null });
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
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(opt('crf', 18)), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
    ];

    // Motion blur: average several sub-frame samples per frame (a real camera's shutter).
    // motionBlur: 4 (every frame) or { samples: 6, around: [cut times], window: 0.4 } (only near the
    // cuts, where transitions move fast: almost the same look for a fraction of the render time).
    const MB = V.motionBlur && typeof V.motionBlur === 'object' ? V.motionBlur : { samples: V.motionBlur || 1 };
    const mb = flag('text-only') || flag('draft') ? 1 : Math.max(1, Math.round(Number(opt('motion-blur', MB.samples || 1))));
    const around = MB.around === true ? (V.cuts || []) : MB.around || null, win = MB.window ?? 0.4;
    const shutter = V.shutter ?? 0.5;
    const frameAt = async (t) => {
      if (mb <= 1 || engine.format !== 'rgba' || (around && !around.some((c) => Math.abs(t - c) < win))) return engine.frame(t);
      let acc = null;
      for (let s = 0; s < mb; s++) {
        const b = await engine.frame(Math.max(0, t + ((s + 0.5) / mb - 0.5) * shutter / fps));
        if (!acc) acc = new Uint16Array(b.length);
        for (let i = 0; i < b.length; i++) acc[i] += b[i];
      }
      const outBuf = Buffer.allocUnsafe(acc.length);
      for (let i = 0; i < acc.length; i++) outBuf[i] = (acc[i] + (mb >> 1)) / mb;
      return outBuf;
    };
    if (mb > 1) console.log(`  motion blur: ${mb} samples per frame`);
    const started = Date.now();

    // Parallel: split the frames across CPU cores (one render process each), then join the parts.
    // --jobs N to choose (default: cores - 1); --jobs 1 renders in this process.
    const jobs = engine.format === 'rgba' && !process.env.MF_WORKER
      ? Math.max(1, Math.min(Number(opt('jobs', Math.max(1, cpus().length - 1))), Math.floor(frames / 45))) : 1;
    if (jobs > 1) {
      console.log(`  rendering on ${jobs} cores`);
      const skip = new Set(['--out', '--from', '--to', '--audio', '--jobs']);
      const passArgs = args.filter((a, i) => !skip.has(a) && !skip.has(args[i - 1]) && a !== '--gif' && a !== '--sheet' && a !== scene);
      const partDir = join(dirname(out), '.parts-' + name);
      mkdirSync(partDir, { recursive: true });
      const parts = [];
      const runPart = (k) => new Promise((res, rej) => {
        const a = Math.round((frames * k) / jobs), b = Math.round((frames * (k + 1)) / jobs);
        const file = join(partDir, `part${k}.mp4`);
        parts[k] = file;
        const child = spawn(process.execPath, [process.argv[1], scene, ...passArgs, '--from', String(from + a / fps), '--to', String(from + b / fps), '--out', file],
          { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, MF_WORKER: '1' } });
        child.on('close', (code) => (code === 0 ? res() : rej(new Error(`render part ${k} failed`))));
      });
      await Promise.all(Array.from({ length: jobs }, (_, k) => runPart(k)));
      const list = join(partDir, 'parts.txt');
      writeFileSync(list, parts.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
      await run(['-f', 'concat', '-safe', '0', '-i', list,
        ...(audio ? ['-ss', String(from), '-i', resolve(audio), '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
        '-c:v', 'copy', '-movflags', '+faststart', out]);
    } else await run(enc, {
      input: async (stdin) => {
        for (let i = 0; i < frames; i++) {
          const buf = await frameAt(from + i / fps);
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
