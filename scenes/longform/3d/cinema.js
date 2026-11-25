// scenes/longform/3d/cinema.js: a camera-and-lab layer for kit3d scenes, so a drawn 3D shot reads like film.
//
//   const S = await stage({...}); const C = cinema(S, { aperture: 22, bloom: { strength: 0.6 } });
//   C.fx.add(mesh)            // light shafts, dust, holograms: additive, drawn after depth of field, still hidden
//                             // behind solid objects (a depth pre-pass), never blurred twice
//   C.run({ update(t) { ...; C.focus = 2.6; }, hud(c, t) { C.letterbox(c); C.title(c, 'TEXT', 960, 820, {...}) } })
//
// What it does to each frame, in order (all pure functions of t):
//   1. the scene in linear HDR (half float), with a depth texture
//   2. lens depth of field: a golden-angle bokeh gather sized by each pixel's circle of confusion, so bright
//      points far from focus open into round discs (the look a still from a real lens has; flat Gaussian blur does not)
//   3. the fx layer (additive), depth-tested against the solid scene
//   4. bloom on highlights above 1.0 only (so it glows where light is, not on every white card)
//   5. one finishing pass: exposure, ACES film curve, split-tone grade (cool shadows, warm highlights), a soft
//      highlight roll-off, lens vignette, a touch of chromatic aberration at the edges, and film grain that
//      changes every frame but is seeded by the frame number
//   6. optional shutter: several sub-frames averaged across a 180-degree shutter (true motion blur on fast moves)
// The HUD (titles, letterbox) is drawn on top in 2D, so type stays sharp.
import { THREE, W, H, clamp } from './kit3d.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const DOF = `
#include <packing>
varying vec2 vUv;
uniform sampler2D tColor, tDepth;
uniform vec2 uPx; uniform float uNear, uFar, uFocus, uAperture, uMax, uStep;
float viewZ(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
float coc(float z){ return min(uMax, uAperture * abs(1.0 - uFocus / max(z, 1e-3))); }
void main(){
  vec3 c = texture2D(tColor, vUv).rgb; float cz = viewZ(vUv), cs = coc(cz);
  float tot = 1.0, r = uStep, ang = 0.0;
  for (int i = 0; i < 160; i++) {
    if (r >= uMax) break;
    vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uPx * r;
    vec3 s = texture2D(tColor, tc).rgb; float sz = viewZ(tc), ss = coc(sz);
    if (sz > cz) ss = clamp(ss, 0.0, cs * 2.0);          // a sharp thing in front is not smeared by blur behind it
    float m = smoothstep(r - 0.5, r + 0.5, ss);
    c += mix(c / tot, s, m); tot += 1.0; r += uStep / r; ang += 2.39996323;
  }
  gl_FragColor = vec4(c / tot, 1.0);
}`;

const FINISH = `
varying vec2 vUv;
uniform sampler2D tColor;
uniform vec2 uPx; uniform float uExposure, uSeed, uGrain, uCA, uVig, uLift, uWarm, uCool, uFade;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main(){
  vec2 d = vUv - 0.5; float e = dot(d, d);
  vec3 c;                                                  // chromatic aberration grows toward the frame edge
  c.r = texture2D(tColor, vUv - d * uCA * e * 4.0).r;
  c.g = texture2D(tColor, vUv).g;
  c.b = texture2D(tColor, vUv + d * uCA * e * 4.0).b;
  c = aces(c * uExposure);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, c * vec3(0.86, 1.0, 1.10), uCool * (1.0 - smoothstep(0.0, 0.55, l)));   // cool shadows
  c = mix(c, c * vec3(1.08, 1.0, 0.86), uWarm * smoothstep(0.35, 1.0, l));          // warm highlights
  c = c * (1.0 - uLift) + uLift * vec3(0.55, 0.62, 0.66);                            // lifted, tinted blacks
  c *= 1.0 - uVig * smoothstep(0.08, 0.62, e * 2.2);
  c = srgb(clamp(c, 0.0, 1.0));
  float g = hash(vUv / uPx + uSeed * 91.7) + hash(vUv / uPx * 1.7 - uSeed * 37.3) - 1.0;
  c += g * uGrain * (0.35 + 0.65 * (1.0 - abs(l * 2.0 - 1.0)));                    // grain lives in the mids
  gl_FragColor = vec4(c * (1.0 - uFade), 1.0);
}`;

export function cinema(S, opt = {}) {
  const { renderer, scene, camera } = S;
  const o = { aperture: 18, maxBlur: 26, step: 1.6, exposure: 1.0, grain: 0.045, ca: 0.004, vignette: 0.42, lift: 0.025,
    warm: 0.55, cool: 0.6, bloom: {}, fps: 24, shutter: 0.5, ...opt };
  const bl = { strength: 0.55, radius: 0.55, threshold: 1.0, ...o.bloom };
  const res = window.__RES__ || 1, w = Math.round(W * res), h = Math.round(H * res);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.autoUpdate = false;
  const hf = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const rtScene = new THREE.WebGLRenderTarget(w, h, { ...hf, depthTexture: new THREE.DepthTexture(w, h) });
  const rtLens = new THREE.WebGLRenderTarget(w, h, { ...hf, depthBuffer: true });
  const px = new THREE.Vector2(1 / w, 1 / h);
  const dofQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DOF, depthTest: false, depthWrite: false,
    uniforms: { tColor: { value: rtScene.texture }, tDepth: { value: rtScene.depthTexture }, uPx: { value: px }, uNear: { value: 0.1 }, uFar: { value: 200 },
      uFocus: { value: 3 }, uAperture: { value: o.aperture }, uMax: { value: o.maxBlur * res }, uStep: { value: o.step * res } } }));
  const finU = { tColor: { value: rtLens.texture }, uPx: { value: px }, uExposure: { value: o.exposure }, uSeed: { value: 0 }, uGrain: { value: o.grain },
    uCA: { value: o.ca }, uVig: { value: o.vignette }, uLift: { value: o.lift }, uWarm: { value: o.warm }, uCool: { value: o.cool }, uFade: { value: 0 } };
  const finQ = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FINISH, uniforms: finU, depthTest: false, depthWrite: false }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), bl.strength, bl.radius, bl.threshold);
  const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  const fx = new THREE.Scene();

  const C = {
    fx, focus: 3, aperture: o.aperture, exposure: o.exposure, fade: 0, bloom,
    // One finished frame into the WebGL canvas (frame = whole frame number, seeds the grain).
    render(frame) {
      const u = dofQ.material.uniforms; u.uFocus.value = C.focus; u.uAperture.value = C.aperture * res; u.uNear.value = camera.near; u.uFar.value = camera.far;
      renderer.shadowMap.needsUpdate = true;
      renderer.setRenderTarget(rtScene); renderer.clear(); renderer.render(scene, camera);
      renderer.setRenderTarget(rtLens); renderer.clear(); dofQ.render(renderer);
      if (fx.children.length) {                      // depth pre-pass so the fx layer hides behind solid things
        const ac = renderer.autoClear; renderer.autoClear = false;
        renderer.clearDepth(); scene.overrideMaterial = depthOnly; const bg = scene.background; scene.background = null;
        renderer.render(scene, camera); scene.overrideMaterial = null; scene.background = bg;
        renderer.render(fx, camera); renderer.autoClear = ac;
      }
      if (bloom.strength > 0) bloom.render(renderer, null, rtLens, 0, false);
      finU.uExposure.value = C.exposure; finU.uSeed.value = (frame % 997) / 997; finU.uFade.value = clamp(C.fade);
      renderer.setRenderTarget(null); finQ.render(renderer);
    },
    // Letterbox bars for a wider picture inside 16:9 (2.39:1 by default). k: 0 = no bars, 1 = full bars.
    letterbox(c, k = 1, aspect = 2.39) {
      const bar = Math.round(((H - W / aspect) / 2) * clamp(k));
      if (bar <= 0) return; c.fillStyle = '#000'; c.fillRect(0, 0, W, bar); c.fillRect(0, H - bar, W, bar);
    },
    // Film-title type: condensed, widely tracked, fades and un-blurs in, drifts a few pixels while on screen.
    title(c, str, x, y, { t = 0, at = 0, dur = 3, size = 54, track = 0.32, color = '#EDE6DA', weight = 700, family = '"Barlow Condensed"', fadeIn = 0.9, fadeOut = 0.7, drift = 6, align = 'center' } = {}) {
      const a = clamp((t - at) / fadeIn) * clamp((at + dur - t) / fadeOut);
      if (a <= 0) return;
      const ein = clamp((t - at) / fadeIn);
      c.save(); c.globalAlpha = a; c.font = `${weight} ${size}px ${family}`; c.letterSpacing = `${Math.round(size * track)}px`;
      c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = color;
      const blur = (1 - ein) * 8; if (blur > 0.3) c.filter = `blur(${blur.toFixed(1)}px)`;
      c.shadowColor = 'rgba(0,0,0,0.55)'; c.shadowBlur = 24;
      // letterSpacing adds space after the last glyph too; shift centred text back by half of it
      const dx = align === 'center' ? (size * track) / 2 : 0;
      c.fillText(str, x + dx, y - drift * ((t - at) / Math.max(0.1, dur)));
      c.restore();
    },
    // Replaces S.run: same window.SIM contract, plus a shutter. samples(t) -> sub-frames for that frame (1 = none).
    run({ update, hud = null, sfx = [], samples = () => 1 }) {
      const comp = document.createElement('canvas'); comp.width = W; comp.height = H;
      const c2 = comp.getContext('2d');
      const renderAt = (t) => {
        const n = Math.max(1, Math.round(samples(t))), frame = Math.round(t * o.fps);
        c2.globalAlpha = 1; c2.clearRect(0, 0, W, H);
        for (let i = 0; i < n; i++) {
          const ts = n === 1 ? t : t + ((i / (n - 1)) - 0.5) * (o.shutter / o.fps);
          update(ts); C.render(frame);
          c2.globalAlpha = 1 / (i + 1); c2.drawImage(renderer.domElement, 0, 0, W, H);
        }
        c2.globalAlpha = 1; update(t);
        if (hud) { c2.save(); hud(c2, t); c2.restore(); }
      };
      const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
      window.SIM = { duration: S.D.dur, sfx, gl: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'webgl', ready: Promise.resolve(), renderAt,
        capture: (t) => { renderAt(t); return comp.toDataURL('image/jpeg', 0.94); } };
      if (!window.__FILM__) {
        document.body.style.cssText = 'margin:0;background:#000;display:grid;place-items:center;height:100vh';
        comp.style.cssText = 'max-width:100vw;max-height:100vh'; document.body.appendChild(comp);
        const t0 = performance.now(); const loop = () => { renderAt(((performance.now() - t0) / 1000) % S.D.dur); requestAnimationFrame(loop); }; loop();
      }
    },
  };
  return C;
}

// Load extra font faces from /fonts (kit3d loads Plus Jakarta Sans and JetBrains Mono only).
export async function fonts(list = [['Barlow Condensed', '700', 'barlow-condensed-latin-700-normal.woff2'], ['Barlow', '500', 'barlow-latin-500-normal.woff2']]) {
  await Promise.all(list.map(async ([fam, weight, file]) => { try { const f = new FontFace(fam, `url(/fonts/${file})`, { weight }); await f.load(); document.fonts.add(f); } catch {} }));
}

// A soft round sprite (for dust motes and practical lights).
export function softDot(size = 64) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d'), g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, size, size); return new THREE.CanvasTexture(cv);
}

// A visible light shaft: an open cone, brightest along its axis and near the lamp, fading to nothing at its edges.
export function lightShaft({ apex = [0, 6, 0], height = 6, radius = 3, color = '#FFD9A8', strength = 0.08 } = {}) {
  const geo = new THREE.ConeGeometry(radius, height, 96, 24, true);
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vN, vV; varying float vH; uniform float uTime;
      void main(){ vH = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vN, vV; varying float vH; uniform vec3 uColor; uniform float uStrength, uTime;
      void main(){ float f = pow(abs(dot(vN, vV)), 2.2); float h = pow(vH, 1.6);
        float n = 0.85 + 0.15 * sin(vH * 23.0 + uTime * 0.7) * sin(atan(vN.x, vN.z) * 9.0 - uTime * 0.4);
        gl_FragColor = vec4(uColor * f * h * n * uStrength, 1.0); }` });
  const m = new THREE.Mesh(geo, mat); m.position.set(apex[0], apex[1] - height / 2, apex[2]);
  return m;
}

// Dust in the air, lit only inside a light cone, each mote defocused by hand (it lives in the fx layer).
// update(t, C) drifts them and sizes their bokeh from C.focus.
export function dust({ count = 900, box = [[-3, 0.05, -3], [3, 4.5, 3]], apex = [0, 6, 0], angle = 0.5, color = '#FFE2B8', seed = 3, size = 5 } = {}) {
  let s = seed; const R = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const pos = new Float32Array(count * 3), ph = new Float32Array(count);
  for (let i = 0; i < count; i++) { for (let k = 0; k < 3; k++) pos[i * 3 + k] = box[0][k] + R() * (box[1][k] - box[0][k]); ph[i] = R() * 100; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uFocus: { value: 3 }, uAperture: { value: 18 }, uSize: { value: size }, uColor: { value: new THREE.Color(color) },
      uApex: { value: new THREE.Vector3(...apex) }, uCos: { value: Math.cos(angle) }, uMap: { value: softDot(64) }, uLo: { value: new THREE.Vector3(...box[0]) }, uHi: { value: new THREE.Vector3(...box[1]) } },
    vertexShader: `attribute float phase; uniform float uTime, uFocus, uAperture, uSize, uCos; uniform vec3 uApex, uLo, uHi; varying float vA;
      void main(){
        vec3 p = position + vec3(sin(uTime * 0.13 + phase) * 0.25, uTime * 0.035 + sin(uTime * 0.21 + phase * 1.7) * 0.08, cos(uTime * 0.11 + phase * 0.7) * 0.25);
        p = uLo + mod(p - uLo, uHi - uLo);
        vec3 dir = normalize(p - uApex); float inCone = smoothstep(uCos - 0.04, uCos + 0.08, dot(dir, vec3(0.0, -1.0, 0.0)));
        vec4 mv = modelViewMatrix * vec4(p, 1.0); float z = -mv.z;
        float coc = min(40.0, uAperture * abs(1.0 - uFocus / max(z, 0.05)));
        float sz = uSize * (2.5 / z) + coc;
        gl_PointSize = sz;
        float tw = 0.6 + 0.4 * sin(uTime * 1.3 + phase * 3.0);
        vA = inCone * tw * clamp(uSize * uSize / (sz * sz), 0.02, 1.0) * 2.2;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform sampler2D uMap; varying float vA;
      void main(){ vec2 q = gl_PointCoord - 0.5; float r = length(q) * 2.0; float disc = smoothstep(1.0, 0.82, r) * (0.75 + 0.25 * smoothstep(0.5, 0.95, r));
        gl_FragColor = vec4(uColor * disc * vA, 1.0); }` });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.update = (t, C) => { const u = mat.uniforms; u.uTime.value = t; u.uFocus.value = C.focus; u.uAperture.value = C.aperture; };
  return pts;
}
