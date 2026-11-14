// scenes/longform/3d/kit3d.js: the 3D stage for long-form inserts (three.js, ES module).
//
// A 3D scene is one HTML page that imports this file, builds its objects, and calls run({ update, hud, sfx }).
// It gets the same things a 2D scene gets: its data (window.DATA / defaults), the theme colours, and every
// word spoken while it is on screen (D.words = [{ w, t }]) so beats land on the words (when / schedule).
// update(t) must be a pure function of t. The picture is the WebGL frame with an optional 2D HUD (titles,
// labels pinned to 3D points) drawn over it. Rendered by tools/longform/render3d.mjs; open the page through
// any local web server to preview it live.
import * as THREE from 'three';
export { THREE };

export const W = 1920, H = 1080, TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const ease = {
  outCubic: (p) => 1 - Math.pow(1 - p, 3),
  inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  outBack: (p) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
  outBounce: (p) => { const n = 7.5625, d = 2.75; if (p < 1 / d) return n * p * p; if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75; if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375; return n * (p -= 2.625 / d) * p + 0.984375; },
};
export const prog = (t, at, dur, e = ease.outCubic) => e(clamp((t - at) / dur));
export const rng = (seed = 1) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let r = Math.imul(seed ^ (seed >>> 15), 1 | seed); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };

// ---- word timing (same rules as scenes/longform/lf.js) ------------------------------------------------
const STOP = new Set('the a an and or but so to of in on at for with is it its this that these those be was were are you your they their we our he she his her i my me not no do does did just like then than as from by into out up about there here what when how why who all any some one very really can will would'.split(' '));
const bare = (w) => String(w).toLowerCase().replace(/[^a-z0-9$%]/g, '');
const keys = (text) => String(text).toLowerCase().split(/[^a-z0-9$%]+/).filter((w) => w.length > 2 && !STOP.has(w));
const hit = (spoken, key) => { const a = bare(spoken); return a && (a === key || (key.length > 4 && a.startsWith(key.slice(0, Math.max(5, key.length - 2)))) || (a.length > 4 && key.startsWith(a.slice(0, Math.max(5, a.length - 2))))); };
export function when(D, text, after = 0) {
  const ks = Array.isArray(text) ? text.flatMap(keys) : keys(text);
  for (const w of D.words || []) if (w.t >= after - 0.01 && ks.some((k) => hit(w.w, k))) return w.t;
  return null;
}
export function schedule(D, items, { start = 0.6, end = null, gap = 0.35, lead = 0.1, openFirst = true } = {}) {
  const n = items.length, hi = end ?? Math.max(start + 0.5, (D.dur || 6) - 1.2);
  let found = items.map((it) => { const t = it == null ? null : when(D, it, start - lead); return t == null ? null : Math.max(start, t - lead); });
  let last = -Infinity;
  found = found.map((t) => { if (t == null || t <= last) return null; last = t; return t; });
  if (openFirst && (found[0] == null || found[0] > start + 0.8)) found[0] = start;
  const out = found.slice();
  for (let i = 0; i < n; i++) if (out[i] == null) {
    let a = i - 1; while (a >= 0 && out[a] == null) a--;
    let b = i + 1; while (b < n && found[b] == null) b++;
    const ta = a >= 0 ? out[a] : start - (hi - start) / Math.max(1, n), tb = b < n ? found[b] : hi + (hi - start) / Math.max(1, n);
    out[i] = ta + ((tb - ta) * (i - a)) / (b - a);
  }
  for (let i = 0; i < n; i++) out[i] = Math.min(hi, Math.max(start + i * 0.05, out[i], i ? out[i - 1] + gap : start));
  return out.map((t) => +t.toFixed(3));
}

export const theme = (D) => ({ color: D.color || '#3CE0FF', tint: D.tint || '#0C1B2A', ink: '#F5F7FA', muted: '#8A93A6', warm: D.warm || '#FFC23D', good: '#3DDC97', bad: '#FF4D5E' });
export const FONT = { display: '"Plus Jakarta Sans"', mono: '"JetBrains Mono"' };

async function loadFonts() {
  const faces = [['Plus Jakarta Sans', '800', 'plus-jakarta-sans-latin-800-normal.woff2'], ['Plus Jakarta Sans', '600', 'plus-jakarta-sans-latin-600-normal.woff2'], ['JetBrains Mono', '600', 'jetbrains-mono-latin-600-normal.woff2']];
  await Promise.all(faces.map(async ([fam, weight, file]) => { try { const f = new FontFace(fam, `url(/fonts/${file})`, { weight }); await f.load(); document.fonts.add(f); } catch {} }));
}

// ---- the stage ----------------------------------------------------------------------------------------
export async function stage(defaults = {}, { fov = 35, shadows = true } = {}) {
  await loadFonts();
  const D = { ...defaults, ...(window.DATA || {}) };
  const th = theme(D), res = window.__RES__ || 1;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(W * res, H * res, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  // Backdrop: the theme tint falling off to near-black, like the 2D templates.
  const bg = document.createElement('canvas'); bg.width = 512; bg.height = 288;
  const b = bg.getContext('2d'), g = b.createRadialGradient(256, 170, 10, 256, 170, 380);
  g.addColorStop(0, th.tint); g.addColorStop(1, '#05060A'); b.fillStyle = g; b.fillRect(0, 0, 512, 288);
  scene.background = new THREE.CanvasTexture(bg); scene.background.colorSpace = THREE.SRGBColorSpace;
  scene.fog = new THREE.Fog('#05060A', 14, 34);
  const camera = new THREE.PerspectiveCamera(fov, W / H, 0.1, 200);
  scene.add(new THREE.HemisphereLight('#ffffff', '#0a0d18', 0.55));
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.position.set(4, 9, 5); key.castShadow = shadows; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 30 }); key.shadow.bias = -0.0004; key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.PointLight(th.color, 60, 30); rim.position.set(-5, 3.5, -6); scene.add(rim);

  const comp = document.createElement('canvas'); comp.width = W; comp.height = H;
  const c2 = comp.getContext('2d');
  const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const ctx = { D, th, THREE, scene, camera, renderer, key, rim, W, H,
    // A 3D point on screen (for HUD labels that follow objects). z < 1 means in front of the camera.
    project(v) { const p = (v.isVector3 ? v.clone() : new THREE.Vector3(...v)).project(camera); return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H, z: p.z }; },
    run({ update, hud = null, sfx = [] }) {
      const renderAt = (t) => { update(t); renderer.render(scene, camera); c2.drawImage(renderer.domElement, 0, 0, W, H); if (hud) { c2.save(); hud(c2, t); c2.restore(); } };
      window.SIM = { duration: D.dur, sfx, gl: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'webgl', ready: Promise.resolve(), renderAt, capture: (t) => { renderAt(t); return comp.toDataURL('image/jpeg', 0.93); } };
      if (!window.__FILM__) {   // live preview: fit the window, loop
        document.body.style.cssText = 'margin:0;background:#05060A;display:grid;place-items:center;height:100vh';
        comp.style.cssText = 'max-width:100vw;max-height:100vh'; document.body.appendChild(comp);
        const t0 = performance.now(); const loop = () => { renderAt(((performance.now() - t0) / 1000) % D.dur); requestAnimationFrame(loop); }; loop();
      }
    },
  };
  return ctx;
}

// ---- camera -------------------------------------------------------------------------------------------
// keys: [{ t, pos: [x,y,z], look: [x,y,z], fov? }] -> (camera, t) eased between keys.
export function camPath(keys) {
  const v = (a) => new THREE.Vector3(...a);
  return (camera, t) => {
    let i = 0; while (i < keys.length - 2 && t > keys[i + 1].t) i++;
    const a = keys[i], b = keys[Math.min(keys.length - 1, i + 1)], k = ease.inOutCubic(clamp((t - a.t) / Math.max(1e-6, b.t - a.t)));
    camera.position.lerpVectors(v(a.pos), v(b.pos), k);
    camera.lookAt(new THREE.Vector3().lerpVectors(v(a.look), v(b.look), k));
    if (a.fov || b.fov) { camera.fov = lerp(a.fov || camera.fov, b.fov || camera.fov, k); camera.updateProjectionMatrix(); }
  };
}

// ---- playing cards, chips, table (all drawn in code) -------------------------------------------------
const RED = '#D63A3F', INK = '#15161C';
function suit(c, s, x, y, size, color) {
  const k = size / 100; c.save(); c.translate(x, y); c.scale(k, k); c.fillStyle = color; c.beginPath();
  if (s === 'h') { c.moveTo(0, 38); c.bezierCurveTo(-60, -5, -48, -55, 0, -28); c.bezierCurveTo(48, -55, 60, -5, 0, 38); }
  else if (s === 'd') { c.moveTo(0, -45); c.lineTo(34, 0); c.lineTo(0, 45); c.lineTo(-34, 0); c.closePath(); }
  else if (s === 's') { c.moveTo(0, -42); c.bezierCurveTo(-60, 2, -48, 48, 0, 20); c.bezierCurveTo(48, 48, 60, 2, 0, -42); c.fill(); c.beginPath(); c.moveTo(0, 12); c.lineTo(16, 46); c.lineTo(-16, 46); c.closePath(); }
  else { for (const [cx, cy] of [[0, -22], [-22, 10], [22, 10]]) { c.moveTo(cx + 19, cy); c.arc(cx, cy, 19, 0, TAU); } c.fill(); c.beginPath(); c.moveTo(0, 2); c.lineTo(15, 46); c.lineTo(-15, 46); c.closePath(); }
  c.fill(); c.restore();
}
function tex(w, h, paint) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; paint(cv.getContext('2d'), w, h); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
export const parseCard = (s) => ({ rank: String(s).slice(0, -1).replace('T', '10'), suit: String(s).slice(-1).toLowerCase() });

const CW = 0.64, CH = 0.9;
function cardFace({ rank, suit: s }) {
  return tex(512, 720, (c, w, h) => {
    c.clearRect(0, 0, w, h); rr(c, 0, 0, w, h, 42); c.fillStyle = '#F8F6F0'; c.fill();
    const col = s === 'h' || s === 'd' ? RED : INK;
    c.fillStyle = col; c.font = `800 120px ${FONT.display}`; c.textBaseline = 'alphabetic'; c.fillText(rank, 34, 132);
    suit(c, s, 78, 196, 78, col); suit(c, s, w / 2, h / 2 + 30, 300, col);
    c.save(); c.translate(w, h); c.rotate(Math.PI); c.fillText(rank, 34, 132); suit(c, s, 78, 196, 78, col); c.restore();
  });
}
function cardBack(color) {
  return tex(512, 720, (c, w, h) => {
    rr(c, 0, 0, w, h, 42); c.fillStyle = color; c.fill();
    c.save(); rr(c, 34, 34, w - 68, h - 68, 26); c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 10; c.stroke(); c.clip();
    c.strokeStyle = 'rgba(255,255,255,0.16)'; c.lineWidth = 8;
    for (let i = -20; i < 20; i++) { c.beginPath(); c.moveTo(i * 60, -h); c.lineTo(i * 60 + h, h); c.stroke(); c.beginPath(); c.moveTo(i * 60, h); c.lineTo(i * 60 + h, -h); c.stroke(); }
    c.restore();
  });
}
// A card: a thin rounded body with a printed face (+z) and back (-z). Lay it with poseCard().
export function card(spec, { back = '#1E3A8A' } = {}) {
  const g = new THREE.Group();
  const sh = new THREE.Shape(), w = CW, h = CH, r = 0.05;
  sh.moveTo(-w / 2 + r, -h / 2); sh.lineTo(w / 2 - r, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); sh.lineTo(w / 2, h / 2 - r); sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  sh.lineTo(-w / 2 + r, h / 2); sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); sh.lineTo(-w / 2, -h / 2 + r); sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: '#EDEAE2', roughness: 0.6 }));
  body.position.z = -0.006; body.castShadow = true; body.receiveShadow = true; g.add(body);
  const mat = (map) => new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.5, roughness: 0.55 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(cardFace(typeof spec === 'string' ? parseCard(spec) : spec))); face.position.z = 0.0066; g.add(face);
  const bk = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(cardBack(back))); bk.position.z = -0.0066; bk.rotation.y = Math.PI; g.add(bk);
  return g;
}
// Lie a card on the table at (x, z). flip: 0 = face down, 1 = face up (it lifts and turns over in between).
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
export function poseCard(c, { x = 0, z = 0, y = 0.02, flip = 1, yaw = 0, lift = 0.45, tilt = 0 }) {
  c.position.set(x, y + lift * Math.sin(Math.PI * clamp(flip)), z);
  _q.setFromEuler(_e.set(-Math.PI / 2 + tilt, 0, yaw, 'YXZ'));
  _q2.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * (1 - clamp(flip)));
  c.quaternion.copy(_q).multiply(_q2);
}

export function chip(color = '#E5484D', { r = 0.2, h = 0.034 } = {}) {
  const side = tex(512, 32, (c, w, hh) => { c.fillStyle = color; c.fillRect(0, 0, w, hh); c.fillStyle = '#fff'; for (let i = 0; i < 8; i++) c.fillRect(i * 64 + 8, 0, 22, hh); });
  const top = tex(256, 256, (c) => { c.fillStyle = color; c.beginPath(); c.arc(128, 128, 128, 0, TAU); c.fill(); c.fillStyle = '#fff'; for (let i = 0; i < 8; i++) { c.save(); c.translate(128, 128); c.rotate((i * TAU) / 8); c.fillRect(-14, -128, 28, 30); c.restore(); } c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 7; c.beginPath(); c.arc(128, 128, 76, 0, TAU); c.stroke(); });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), [new THREE.MeshStandardMaterial({ map: side, roughness: 0.45 }), new THREE.MeshStandardMaterial({ map: top, roughness: 0.45 }), new THREE.MeshStandardMaterial({ map: top, roughness: 0.45 })]);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export function coin({ r = 0.2, h = 0.03, color = '#F2B93B' } = {}) {
  const top = tex(256, 256, (c) => { c.fillStyle = color; c.beginPath(); c.arc(128, 128, 128, 0, TAU); c.fill(); c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 10; c.beginPath(); c.arc(128, 128, 98, 0, TAU); c.stroke(); c.fillStyle = 'rgba(255,255,255,0.9)'; c.font = `800 150px ${FONT.display}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('$', 128, 136); });
  const mm = (map) => new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : color, roughness: 0.3, metalness: 0.75 });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), [mm(null), mm(top), mm(top)]);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
// An oval felt table with a padded rail, top surface at y = 0.
export function table({ felt = '#0F5C41', rail = '#1B1410', rx = 6.2, rz = 3.5 } = {}) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.2, 96), new THREE.MeshStandardMaterial({ color: felt, roughness: 0.95 }));
  top.scale.set(rx, 1, rz); top.position.y = -0.1; top.receiveShadow = true; g.add(top);
  const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045, 20, 120), new THREE.MeshStandardMaterial({ color: rail, roughness: 0.5 }));
  r.rotation.x = Math.PI / 2; r.scale.set(rx, rz, 3.2); r.position.y = 0.02; r.castShadow = true; g.add(r);
  const line = new THREE.Mesh(new THREE.TorusGeometry(1, 0.004, 8, 120), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18 }));
  line.rotation.x = Math.PI / 2; line.scale.set(rx * 0.78, rz * 0.72, 1); line.position.y = 0.004; g.add(line);
  return g;
}
// A dark studio floor that catches shadows and a little light.
// A floor that fades out with distance, so there is no hard horizon line against the backdrop.
export function floor(color = '#0A0E16', { size = 80, solid = 0.1, fade = 0.34 } = {}) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const c = cv.getContext('2d'), g = c.createRadialGradient(256, 256, 256 * solid * 2, 256, 256, 256 * fade * 2);
  g.addColorStop(0, '#fff'); g.addColorStop(1, '#000');
  c.fillStyle = g; c.fillRect(0, 0, 512, 512);
  const alpha = new THREE.CanvasTexture(cv);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, alphaMap: alpha, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true; m.renderOrder = -1; return m;
}

// ---- HUD (2D over the 3D frame) -----------------------------------------------------------------------
export function hudText(c, str, x, y, { font = `800 48px ${FONT.display}`, color = '#F5F7FA', align = 'left', alpha = 1, shadow = true } = {}) {
  if (alpha <= 0) return;
  c.save(); c.globalAlpha = alpha; c.font = font; c.textAlign = align; c.textBaseline = 'alphabetic';
  if (shadow) { c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 16; c.shadowOffsetY = 3; }
  c.fillStyle = color; c.fillText(str, x, y); c.restore();
}
// Kicker + headline, top-left, with the accent words coloured (same look as the 2D templates).
export function hudTitle(c, t, { kicker, headline, accent }, th, { x = 120, y = 150 } = {}) {
  if (kicker) hudText(c, String(kicker).toUpperCase(), x, y, { font: `600 30px ${FONT.mono}`, color: th.color, alpha: prog(t, 0.05, 0.4) });
  if (!headline) return;
  const acc = new Set(String(accent || '').toLowerCase().split(/\s+/).filter(Boolean));
  c.save(); c.font = `800 76px ${FONT.display}`; c.textBaseline = 'alphabetic'; c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 18;
  let cx = x; const sp = c.measureText(' ').width;
  String(headline).split(' ').forEach((w, i) => {
    const k = prog(t, 0.25 + i * 0.06, 0.5);
    c.globalAlpha = k; c.fillStyle = acc.has(w.toLowerCase().replace(/[^a-z0-9']/g, '')) ? th.color : th.ink;
    c.fillText(w, cx, y + 86 + (1 - k) * 24); cx += c.measureText(w).width + sp;
  });
  c.restore();
}
export function vignette(c, strength = 0.5) {
  const g = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`); c.fillStyle = g; c.fillRect(0, 0, W, H);
}
