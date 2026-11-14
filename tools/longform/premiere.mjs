// tools/longform/premiere.mjs: the edit as a Final Cut Pro 7 XML (xmeml v4) timeline, which Premiere Pro
// (File > Import), DaVinci Resolve and Final Cut import. The A-roll points at the ORIGINAL footage, so
// nothing is re-encoded and every cut can be slipped, trimmed or undone in the editor.
//
//   V1  A-roll pieces (punch-ins as Basic Motion scale)      A1  A-roll sound (linked to V1)
//   V2  inserts: animations, B-roll, images, pull placeholders (side layout = scaled box)
//   A2  music (level per section; turn on auto-ducking in Essential Sound: voice = Dialogue, music = Music)
//   A3  sound effects                                         A4  the preview mix (muted, for reference)
//   Sequence markers: chapters (green) and clips to pull (red).
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { H, ROOT, W, probe } from './common.mjs';
import { sideBox } from './plan.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = (f) => 'file://localhost' + pathToFileURL(resolve(f)).pathname;
function rateOf(fps) {
  const ntsc = [23.976, 29.97, 59.94, 47.952, 119.88].find((r) => Math.abs(fps - r) < 0.01);
  return ntsc ? { timebase: Math.round(ntsc), ntsc: true, fps: Math.round(ntsc) * 1000 / 1001 } : { timebase: Math.round(fps) || 30, ntsc: false, fps: Math.round(fps) || 30 };
}
const rateXML = (r) => `<rate><timebase>${r.timebase}</timebase><ntsc>${r.ntsc ? 'TRUE' : 'FALSE'}</ntsc></rate>`;

export function premiereXML(R, plan, { accent } = {}) {
  const seq = rateOf(plan.fps);
  const F = (s) => Math.round(s * seq.fps);
  const files = new Map();
  let fileN = 0, itemN = 0;
  const emitted = new Set();
  const fileRef = (path) => {
    const key = resolve(path);
    let info = files.get(key);
    if (!info) {
      const p = probe(key);
      const r = rateOf(p.fps || plan.fps);
      info = { id: `file-${++fileN}`, rate: r, width: p.width || W, height: p.height || H, hasVideo: p.hasVideo, hasAudio: p.hasAudio, sr: p.sampleRate, frames: Math.round(p.duration * r.fps), duration: p.duration, key };
      files.set(key, info);
    }
    if (emitted.has(key)) return { id: info.id, info, xml: `<file id="${info.id}"/>` };
    // The full description goes in the first clip that uses the file; later clips refer to it by id.
    const media = [
      info.hasVideo && `<video><samplecharacteristics>${rateXML(info.rate)}<width>${info.width}</width><height>${info.height}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></video>`,
      info.hasAudio && `<audio><samplecharacteristics><depth>16</depth><samplerate>${info.sr}</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>`,
    ].filter(Boolean).join('');
    return { id: info.id, info, emit: () => emitted.add(key), xml: `<file id="${info.id}"><name>${esc(basename(key))}</name><pathurl>${esc(url(key))}</pathurl>${rateXML(info.rate)}<duration>${info.frames}</duration><media>${media}</media></file>` };
  };
  const infoOf = (path) => { const r = fileRef(path); return r.info; };
  const motion = (scale, cx = 0, cy = 0) => `<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>` +
    `<parameter authoringApp="PremierePro"><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>1000</valuemax><value>${scale.toFixed(2)}</value></parameter>` +
    `<parameter authoringApp="PremierePro"><parameterid>center</parameterid><name>Center</name><value><horiz>${cx.toFixed(4)}</horiz><vert>${cy.toFixed(4)}</vert></value></parameter></effect></filter>`;
  const level = (v) => `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype>` +
    `<parameter authoringApp="PremierePro"><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${v.toFixed(4)}</value></parameter></effect></filter>`;
  const coverScale = (info, zoom = 1) => Math.max(W / info.width, H / info.height) * zoom * 100;

  const item = ({ name, path, start, end, srcIn, kind = 'video', filters = '', links = '', enabled = true, track = 1 }) => {
    const ref = fileRef(path);
    ref.emit?.();
    const r = ref.info.rate;
    const inF = Math.round(srcIn * r.fps), len = end - start;
    const id = `clipitem-${++itemN}`;
    const xml = `<clipitem id="${id}"><name>${esc(name)}</name><enabled>${enabled ? 'TRUE' : 'FALSE'}</enabled><duration>${Math.max(ref.info.frames, inF + len)}</duration>${rateXML(seq)}` +
      `<start>${start}</start><end>${end}</end><in>${inF}</in><out>${inF + Math.round(len * r.fps / seq.fps)}</out>${ref.xml}` +
      (kind === 'audio' ? `<sourcetrack><mediatype>audio</mediatype><trackindex>${track}</trackindex></sourcetrack>` : '') + filters + links + '</clipitem>';
    return { id, xml };
  };

  // V1 + A1: the A-roll from the original files.
  const v1 = [], a1 = [];
  R.cuts.forEach((c, k) => {
    const clip = R.lib.clips[c.clip];
    const start = F(c.out), end = F(c.out + c.d);
    const info = infoOf(clip.file);
    const sc = coverScale(info, c.zoom);
    const ow = info.width * sc / 100 - W, oh = info.height * sc / 100 - H;
    const cx = ((0.5 - c.focus[0]) * ow) / W, cy = ((0.5 - c.focus[1]) * oh) / H;
    const vid = `clipitem-${itemN + 1}`, aid = `clipitem-${itemN + 2}`;
    const links = `<link><linkclipref>${vid}</linkclipref><mediatype>video</mediatype><trackindex>1</trackindex><clipindex>${k + 1}</clipindex></link>` +
      (clip.hasAudio ? `<link><linkclipref>${aid}</linkclipref><mediatype>audio</mediatype><trackindex>1</trackindex><clipindex>${k + 1}</clipindex><groupindex>1</groupindex></link>` : '');
    v1.push(item({ name: `${c.clip} ${c.s.toFixed(1)}s`, path: clip.file, start, end, srcIn: c.s, filters: motion(sc, c.zoom > 1 ? cx : 0, c.zoom > 1 ? cy : 0), links }).xml);
    if (clip.hasAudio) a1.push(item({ name: `${c.clip} ${c.s.toFixed(1)}s`, path: clip.file, start, end, srcIn: c.s, kind: 'audio', links }).xml);
  });

  // V2: inserts. Library B-roll points at the original file; everything else at its rendered clip in media/.
  const v2 = R.inserts.map((ins) => {
    const start = F(ins.at), end = F(ins.at + ins.dur);
    const fromLibrary = ins.kind === 'broll';
    const path = fromLibrary ? ins.file : ins.media;
    const info = infoOf(path);
    let filters;
    if (ins.layout === 'side') {
      const b = sideBox(plan);
      filters = motion(coverScale(info) * b.w / W, (b.x + b.w / 2 - W / 2) / W, (b.y + b.h / 2 - H / 2) / H);
    } else filters = motion(coverScale(info));
    return item({ name: ins.kind === 'pull' ? `PULL: ${ins.title}` : ins.id, path, start, end, srcIn: fromLibrary ? ins.from : 0, filters }).xml;
  });

  // A2 music (looped clip by clip), A3 effects, A4 the preview mix.
  const a2 = [];
  for (const m of R.music) {
    if (!m.file) continue;
    const info = infoOf(m.file);
    let t = m.at;
    while (t < m.end - 0.5) {
      const len = Math.min(info.duration, m.end - t);
      a2.push(item({ name: basename(m.file), path: m.file, start: F(t), end: F(t + len), srcIn: 0, kind: 'audio', filters: level(m.volume) }).xml);
      t += len;
    }
  }
  const a3 = R.sfx.map((s) => {
    const path = resolve(ROOT, 'sounds', 'sfx', `${s.name}.mp3`);
    const info = infoOf(path);
    return item({ name: s.name, path, start: F(s.at), end: F(s.at + Math.max(0.2, info.duration)), srcIn: 0, kind: 'audio', filters: level(s.volume) }).xml;
  });
  const mix = resolve(ROOT, 'out', 'longform', plan.name, 'stems', 'mix.wav');
  const a4 = [item({ name: 'preview mix (reference)', path: mix, start: 0, end: F(R.total), srcIn: 0, kind: 'audio', enabled: false }).xml];

  const markers = [
    ...R.chapters.map((c) => `<marker><name>${esc(c.title)}</name><comment>Chapter</comment><in>${F(c.at)}</in><out>-1</out></marker>`),
    ...R.inserts.filter((i) => i.kind === 'pull').map((i) => `<marker><name>${esc('PULL: ' + i.title)}</name><comment>${esc([i.url || i.search, i.from && `${i.from}-${i.to}`].filter(Boolean).join(' '))}</comment><in>${F(i.at)}</in><out>${F(i.at + i.dur)}</out></marker>`),
  ].join('');

  const track = (items, extra = '') => `<track>${items.join('')}${extra}</track>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="sequence-1"><name>${esc(plan.title || plan.name)}</name><duration>${F(R.total)}</duration>${rateXML(seq)}` +
    `<timecode>${rateXML(seq)}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>` +
    `<media><video><format><samplecharacteristics>${rateXML(seq)}<width>${W}</width><height>${H}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>` +
    track(v1) + track(v2) + '</video>' +
    `<audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>` +
    track(a1) + track(a2) + track(a3) + track(a4) + '</audio></media>' + markers + '</sequence></xmeml>\n';
}
