// tools/reframe.mjs: turn any clip into a 1080x1920 crop, following the face when footage.mjs found one.
//
// Order of precedence for where to crop: the plan's focus/focusY (manual) > the face track from
// tools/faces.py (automatic) > the centre. A face that stays put gets one fixed crop per piece (what an
// editor would do); one that moves more than ~12% of the frame gets a smooth pan that follows it.
export const W = 1080, H = 1920, FPS = 30;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// One face per sample. 'largest' sticks with the person it already follows unless someone else is much
// bigger (so it doesn't flip between host and guest); 'left' | 'right' | 'center' pick by position.
export function pickTrack(samples = [], pick = 'largest') {
  const out = [];
  let prev = null;
  for (const [t, faces] of samples) {
    if (!faces || !faces.length) continue;
    let f;
    if (pick === 'left') f = faces.reduce((a, b) => (b[0] < a[0] ? b : a));
    else if (pick === 'right') f = faces.reduce((a, b) => (b[0] > a[0] ? b : a));
    else if (pick === 'center') f = faces.reduce((a, b) => (Math.abs(b[0] - 0.5) < Math.abs(a[0] - 0.5) ? b : a));
    else {
      f = faces[0];
      if (prev) {
        const near = faces.reduce((a, b) => (Math.abs(b[0] - prev[0]) < Math.abs(a[0] - prev[0]) ? b : a));
        if (Math.abs(near[0] - prev[0]) < 0.12 && near[2] >= faces[0][2] * 0.6) f = near;
      }
    }
    prev = f;
    out.push({ t, cx: f[0], cy: f[1], h: f[2] });
  }
  return smooth(out);
}

// Median of 5 neighbours: removes single-frame false detections without lagging real movement much.
export function smooth(track, k = 2) {
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  return track.map((p, i) => {
    const r = Math.min(k, i, track.length - 1 - i);     // symmetric, shrinking at the ends (no lag)
    const win = track.slice(i - r, i + r + 1);
    return { ...p, cx: med(win.map((q) => q.cx)), cy: med(win.map((q) => q.cy)) };
  });
}

export function geometry(srcW, srcH, zoom = 1) {
  const s = Math.max(W / srcW, H / srcH) * zoom;
  return { sw: Math.ceil((srcW * s) / 2) * 2, sh: Math.ceil((srcH * s) / 2) * 2 };
}
// Crop offsets that put a face at (cx, cy) in the frame: centred across, a little above the middle.
export const cropX = (cx, sw) => Math.round(clamp(cx * sw - W / 2, 0, sw - W));
export const cropY = (cy, sh) => Math.round(clamp(cy * sh - H * 0.38, 0, sh - H));

// Where the crop sits for a piece [a, b] of a clip. Returns { mode: 'manual' | 'face' | 'follow' | 'centre', x, y, keys? }.
export function placement(clip, { zoom = 1, focus, focusY, track = null, a = 0, b = Infinity } = {}) {
  const { sw, sh } = geometry(clip.width, clip.height, zoom);
  const manualX = focus != null, manualY = focusY != null;
  const yOf = (f) => Math.round((sh - H) * clamp(f, 0, 1));
  const xOf = (f) => Math.round((sw - W) * clamp(f, 0, 1));
  const pts = (track || []).filter((p) => p.t >= a - 0.4 && p.t <= b + 0.4);
  if (manualX || !pts.length) {
    const y = manualY ? yOf(focusY) : pts.length ? cropY(median(pts.map((p) => p.cy)), sh) : yOf(0.42);
    return { mode: manualX ? 'manual' : pts.length ? 'face' : 'centre', x: xOf(manualX ? focus : 0.5), y, sw, sh };
  }
  const y = manualY ? yOf(focusY) : cropY(median(pts.map((p) => p.cy)), sh);
  const xs = pts.map((p) => cropX(p.cx, sw));
  if (Math.max(...xs) - Math.min(...xs) < W * 0.12) return { mode: 'face', x: Math.round(median(xs)), y, sw, sh };
  const keys = pts.map((p, i) => ({ t: +Math.max(0, p.t - a).toFixed(3), x: xs[i] }));
  return { mode: 'follow', x: keys[0].x, y, keys, sw, sh };
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// ffmpeg expression: piecewise-linear x over the piece's own time (t starts at 0 after -ss).
export function followExpr(keys) {
  let e = String(keys[keys.length - 1].x);
  for (let i = keys.length - 2; i >= 0; i--) {
    const k0 = keys[i], k1 = keys[i + 1], span = Math.max(0.001, k1.t - k0.t);
    e = `if(lt(t,${k1.t}),${k0.x}+(${k1.x - k0.x})*(t-${k0.t})/${span.toFixed(3)},${e})`;
  }
  return `if(lt(t,${keys[0].t}),${keys[0].x},${e})`;
}

export function cropFilter(clip, opts = {}) {
  const p = placement(clip, opts);
  const x = p.mode === 'follow' ? `'${followExpr(p.keys)}'` : p.x;
  return { filter: `scale=${p.sw}:${p.sh}:flags=lanczos,crop=${W}:${H}:${x}:${p.y},setsar=1,fps=${FPS}`, mode: p.mode };
}
