// Shared by tests/interchange.test.mjs: an in-memory library, a fake probe (no media on disk) and a resolved
// plan with equal source and sequence rates, so the xmeml writer can be tested and its output pinned.
import { basename } from 'node:path';
import { sentencesOf } from '../tools/longform/common.mjs';

export function fakeLib() {
  const words = [
    ['Hello', 0.5, 0.8], ['there.', 0.85, 1.2],
    ['Um', 1.6, 1.9], ['so', 2.3, 2.45], ['this', 2.5, 2.7], ['is', 2.75, 2.85], ['the', 2.9, 3.0], ['um', 3.4, 3.7], ['the', 4.1, 4.2], ['point.', 4.25, 4.7],
    ['Okay.', 7.0, 7.4],
  ].map(([w, s, e]) => ({ w, s, e }));
  const clip = (id, file, hasAudio, w = words) => ({ id, file, key: 'k', duration: 8, width: 1920, height: 1080, fps: 30, words: w, sentences: sentencesOf(w), hasAudio });
  return { clips: { a: clip('a', '/x/a.mp4', true), v: clip('v', '/x/v.mp4', false, []) } };
}

const VIDEO = { duration: 8, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true, sampleRate: 48000, tc: null };
const MEDIA = { 'a.mp4': VIDEO, 'v.mp4': { ...VIDEO, hasAudio: false }, 'pull.mp4': { ...VIDEO, duration: 4 } };
const SOUND = { duration: 5, width: 0, height: 0, fps: 0, hasVideo: false, hasAudio: true, sampleRate: 44100, tc: null };

// over: { 'a.mp4': { fps: 25, tc: '01:00:00:00' } } changes what the probe reports for one file name.
export const fakeProbe = (over = {}) => (file) => {
  const n = basename(file);
  return { ...(MEDIA[n] || (/\.(mp3|wav)$/.test(n) ? SOUND : MEDIA['pull.mp4'])), ...(over[n] || {}) };
};

export const PLAN = { name: 't', title: 'T', fps: 30 };

// Three A-roll pieces, three inserts (one of each kind that matters), music, an effect, two chapters.
export function equalRateR(lib = fakeLib()) {
  return {
    lib, total: 4.5, warnings: [],
    cuts: [
      { clip: 'a', s: 0.5, e: 1.5, d: 1, out: 0, zoom: 1, focus: [0.5, 0.5] },
      { clip: 'a', s: 2.5, e: 4, d: 1.5, out: 1, zoom: 1.12, focus: [0.5, 0.42] },
      { clip: 'a', s: 5, e: 7, d: 2, out: 2.5, zoom: 1, focus: [0.5, 0.42] },
    ],
    inserts: [
      { kind: 'pull', id: 'pull-1', title: 'Famous hand', url: 'https://x.test/v', from: '1:00', to: '1:05', at: 0.5, dur: 1, layout: 'full', media: '/m/pull.mp4' },
      { kind: 'broll', id: 'broll-2', file: '/x/a.mp4', from: 3, at: 1.5, dur: 1, layout: 'side', media: '/m/broll-2.mp4' },
      { kind: 'animation', id: 'anim-3', at: 3, dur: 2, layout: 'full', media: '/m/anim-3.mp4' },
    ],
    music: [{ at: 0, end: 4.5, file: '/m/calm.mp3', volume: 0.1 }],
    sfx: [{ at: 0.4, name: 'whoosh', volume: 0.4 }],
    chapters: [{ at: 0, title: 'Start' }, { at: 2.5, title: 'Middle & more' }],
  };
}
