#!/usr/bin/env node
// stream.mjs: the sandboxed half of a render, for scenes nobody has reviewed
// (e.g. written by an unattended agent).
//
//   node stream.mjs <scene.html> --info      -> one JSON line: {width,height,fps,duration}
//   node stream.mjs <scene.html> --frames    -> raw RGBA frames on stdout, nothing else
//   node stream.mjs <scene.html> --layout    -> the same frames with every image blank (safe-zone scoring)
//
// It never spawns a process, writes a file or touches the network, so it can run under Node's
// permission model with read access to the repo and the scene's folder only. The caller pipes
// --frames into ffmpeg itself.
import { open } from './engines/skia.mjs';

const LIMITS = { maxPixels: 1920 * 1920, maxFps: 60, maxDuration: 90 };

const [scene, mode] = process.argv.slice(2);
if (!scene || !['--info', '--frames', '--layout', '--text'].includes(mode)) {
  console.error('usage: node stream.mjs <scene.html> --info|--frames|--layout');
  process.exit(2);
}

try {
  const engine = await open(scene, { layout: mode === '--layout', textOnly: mode === '--text' });
  const { width, height, fps, duration } = engine.V;
  if (!(width > 0 && height > 0 && width * height <= LIMITS.maxPixels)) throw new Error(`bad size ${width}x${height}`);
  if (!(fps > 0 && fps <= LIMITS.maxFps)) throw new Error(`bad fps ${fps}`);
  if (!(duration > 0 && duration <= LIMITS.maxDuration)) throw new Error(`bad duration ${duration}`);

  if (mode === '--info') {
    process.stdout.write(JSON.stringify({ width, height, fps, duration, cuts: engine.V.cuts || [] }) + '\n');
  } else {
    const frames = Math.round(duration * fps);
    for (let i = 0; i < frames; i++) {
      const buf = engine.frame(i / fps);
      if (!process.stdout.write(buf)) await new Promise((r) => process.stdout.once('drain', r));
    }
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
