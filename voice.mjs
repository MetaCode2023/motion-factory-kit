#!/usr/bin/env node
// voice.mjs: turn a script into a narration MP3 with ElevenLabs (optional; everything else works without it).
//
//   ELEVENLABS_API_KEY=... node voice.mjs "Most viewers leave in two seconds." --out out/voice.mp3
//   ELEVENLABS_API_KEY=... node voice.mjs --file script.txt --voice <voice_id> --out out/voice.mp3
//
// Then add it to a render:  node render.mjs scenes/mine/my-video.html --audio out/voice.mp3
//
// The key is read from the environment only. Never paste it into a scene or commit it.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; };
const VALUED = ['out', 'voice', 'file', 'model'];
const text = opt('file') ? readFileSync(opt('file'), 'utf8')
  : args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]?.slice(2)));

const key = process.env.ELEVENLABS_API_KEY;
if (!key) { console.error('Set ELEVENLABS_API_KEY in your environment first (elevenlabs.io → Profile → API keys).'); process.exit(2); }
if (!text) { console.error('usage: node voice.mjs "text to say" [--voice id] [--out file.mp3]   or   --file script.txt'); process.exit(2); }

// Default: "Adam", one of ElevenLabs' stock voices. Use your own voice id with --voice.
const voice = opt('voice', process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB');
const out = resolve(opt('out', 'out/voice.mp3'));

const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
  method: 'POST',
  headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text, model_id: opt('model', 'eleven_multilingual_v2') }),
});
if (!res.ok) { console.error(`ElevenLabs ${res.status}: ${await res.text()}`); process.exit(1); }
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(await res.arrayBuffer()));
console.log('voice -> ' + out);
