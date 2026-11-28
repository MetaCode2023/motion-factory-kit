// refine/pixels.mjs: measurements taken from rendered frames and lookdev reference plates.
//
// These are evidence for the critic and for the delta log, never a verdict on their own: a frame
// can match every number here and still look wrong, which is why the approval gate also needs an
// isolated multimodal critique. What the numbers are good at is catching the failures a quick
// glance misses (a colour cast, a crushed histogram, a fallback texture, a blank frame) and saying
// in which direction a render differs from its reference.
import { Canvas, loadImage } from 'skia-canvas';
import { readFileSync } from 'node:fs';

export const ANALYSIS_WIDTH = 256;

// sRGB 0-255 -> CIE L*a*b* (D65).
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const LIN = Float64Array.from({ length: 256 }, (_, i) => lin(i));
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389 / 27 + 16) / 116);
export function lab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Decode a PNG/JPG (path or Buffer) into RGBA at analysis size, keeping the aspect ratio.
export async function loadPixels(src, width = ANALYSIS_WIDTH) {
  const img = await loadImage(Buffer.isBuffer(src) ? src : readFileSync(src));
  const w = Math.min(width, img.width), h = Math.max(1, Math.round(img.height * w / img.width));
  const c = new Canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data, sourceWidth: img.width, sourceHeight: img.height };
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// Every measurement of one image. L* is 0-100; a*/b* roughly -100..100.
export function measure({ width: w, height: h, data }) {
  const n = w * h;
  const L = new Float64Array(n), A = new Float64Array(n), Bv = new Float64Array(n);
  let sumL = 0, sumA = 0, sumB = 0, sumC = 0, sumSat = 0, hx = 0, hy = 0, magenta = 0, primaries = 0;
  const quant = new Set();
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const [l, a, bb] = lab(r, g, b);
    L[i] = l; A[i] = a; Bv[i] = bb;
    sumL += l; sumA += a; sumB += bb;
    const C = Math.hypot(a, bb);
    sumC += C;
    if (C > 4) { hx += a; hy += bb; }
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sumSat += mx === 0 ? 0 : (mx - mn) / mx;
    if (r > 200 && b > 200 && g < 60) magenta++;
    // Pure default primaries/secondaries (#f00, #0f0, #00f, #ff0, #0ff, #f0f), the "programmer-art" palette.
    if (mx > 235 && mn < 20 && [r, g, b].every((v) => v > 235 || v < 20)) primaries++;
    quant.add((r >> 3) << 10 | (g >> 3) << 5 | (b >> 3));
  }
  const meanL = sumL / n;
  let varL = 0;
  for (let i = 0; i < n; i++) varL += (L[i] - meanL) ** 2;
  const sorted = Float64Array.from(L).sort();

  // 32-bin L* histogram, normalised.
  const hist = new Array(32).fill(0);
  for (let i = 0; i < n; i++) hist[Math.min(31, Math.floor(L[i] / 100 * 32))]++;
  for (let i = 0; i < 32; i++) hist[i] = round(hist[i] / n, 5);

  // Vertical light profile in 8 bands (top = surface for an underwater plate).
  const bands = new Array(8).fill(0), bandN = new Array(8).fill(0);
  for (let y = 0; y < h; y++) {
    const k = Math.min(7, Math.floor(y / h * 8));
    for (let x = 0; x < w; x++) { bands[k] += L[y * w + x]; bandN[k]++; }
  }
  for (let k = 0; k < 8; k++) bands[k] = round(bands[k] / bandN[k], 2);

  // Detail: mean absolute Laplacian on L*; speckles: isolated local maxima well above their ring
  // (marine snow, sparkle, dust). The 4x4 grid of speckle counts says whether they are spread like
  // default uniform noise or clustered by light and depth.
  let lap = 0, edges = 0, speckles = 0;
  const speckGrid = new Array(16).fill(0);
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x, c = L[i];
    const v = Math.abs(4 * c - L[i - 1] - L[i + 1] - L[i - w] - L[i + w]);
    lap += v;
    if (v > 12) edges++;
    if (c > L[i - 1] && c > L[i + 1] && c > L[i - w] && c > L[i + w]) {
      const ring = (L[i - 2] + L[i + 2] + L[i - 2 * w] + L[i + 2 * w] + L[i - 2 * w - 2] + L[i + 2 * w + 2] + L[i - 2 * w + 2] + L[i + 2 * w - 2]) / 8;
      if (c - ring > 7) { speckles++; speckGrid[Math.min(3, Math.floor(y / h * 4)) * 4 + Math.min(3, Math.floor(x / w * 4))]++; }
    }
  }
  const inner = Math.max(1, (w - 4) * (h - 4));
  const sgMean = speckGrid.reduce((s, v) => s + v, 0) / 16;
  const sgStd = Math.sqrt(speckGrid.reduce((s, v) => s + (v - sgMean) ** 2, 0) / 16);

  // 4x4 grid of mean L*a*b*: coarse structure, for comparing layouts against the reference.
  const grid = Array.from({ length: 16 }, () => [0, 0, 0, 0]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const g = grid[Math.min(3, Math.floor(y / h * 4)) * 4 + Math.min(3, Math.floor(x / w * 4))], i = y * w + x;
    g[0] += L[i]; g[1] += A[i]; g[2] += Bv[i]; g[3]++;
  }
  const structure = grid.map(([l, a, b, c]) => [round(l / c, 2), round(a / c, 2), round(b / c, 2)]);

  // Focal point: centroid of the 2% of pixels that stand out most from the mean (luminance and
  // chroma together), and its distance to the nearest rule-of-thirds intersection (0 = on it,
  // in units of the frame diagonal).
  const sal = new Float64Array(n);
  const mA = sumA / n, mB = sumB / n;
  for (let i = 0; i < n; i++) sal[i] = Math.abs(L[i] - meanL) + 0.5 * Math.hypot(A[i] - mA, Bv[i] - mB);
  const cut = pct(Float64Array.from(sal).sort(), 0.98);
  let fx = 0, fy = 0, fw = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = sal[y * w + x]; if (s >= cut) { fx += x * s; fy += y * s; fw += s; } }
  const focal = fw > 0 ? [fx / fw / w, fy / fw / h] : [0.5, 0.5];
  const thirds = [[1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3]];
  const diag = Math.hypot(1, h / w);
  const thirdsDistance = Math.min(...thirds.map(([tx, ty]) => Math.hypot(focal[0] - tx, (focal[1] - ty) * h / w))) / diag;

  const hue = Math.hypot(hx, hy) > 0 ? (Math.atan2(hy, hx) * 180 / Math.PI + 360) % 360 : null;
  return {
    width: w, height: h,
    lumaMean: round(meanL, 2), lumaStd: round(Math.sqrt(varL / n), 2),
    p05: round(pct(sorted, 0.05), 2), p50: round(pct(sorted, 0.5), 2), p95: round(pct(sorted, 0.95), 2),
    contrast: round(pct(sorted, 0.95) - pct(sorted, 0.05), 2),
    aMean: round(mA, 2), bMean: round(mB, 2), chroma: round(sumC / n, 2), hue: hue === null ? null : round(hue, 1),
    saturation: round(sumSat / n, 3),
    falloff: round((bands[0] + 1) / (bands[7] + 1), 3),       // top vs bottom brightness (depth falloff from the surface)
    bands, hist, structure,
    detail: round(lap / inner, 3), edgeDensity: round(edges / inner, 4),
    speckleDensity: round(speckles / inner * 1000, 3),          // per 1000 px at analysis size
    speckleClustering: round(sgMean > 0 ? sgStd / sgMean : 0, 3), // 0 = perfectly uniform spread
    focal: [round(focal[0]), round(focal[1])], thirdsDistance: round(thirdsDistance, 4),
    distinctColors: quant.size, magentaFraction: round(magenta / n, 4), primaryFraction: round(primaries / n, 4),
  };
}

// Frames that must never count as a success, however the file looks on disk: blank or flat
// frames, the renderer's error/fallback textures, and frames identical to a reference (a copy,
// not a render).
export function falseSuccess(m, { referenceHashes = [], sha = null } = {}) {
  const reasons = [];
  if (m.lumaStd < 1.0) reasons.push(`zero-variance frame (L* std ${m.lumaStd})`);
  if (m.distinctColors < 6) reasons.push(`flat fill: only ${m.distinctColors} distinct colours`);
  if (m.magentaFraction > 0.15) reasons.push(`fallback/missing-texture magenta covers ${Math.round(m.magentaFraction * 100)}% of the frame`);
  if (m.lumaMean < 1.5 && m.p95 < 4) reasons.push('black frame');
  if (m.lumaMean > 98.5 && m.p05 > 96) reasons.push('white frame');
  // A two-colour high-frequency checkerboard is the classic missing-texture fallback.
  if (m.distinctColors <= 12 && m.edgeDensity > 0.25) reasons.push('checkerboard-like fallback texture');
  if (sha && referenceHashes.includes(sha)) reasons.push('frame is byte-identical to a reference plate (a copy, not a render)');
  return reasons;
}

// Earth mover's distance between two normalised 1-D histograms, in bin widths / bins.
export function histogramDistance(h1, h2) {
  let carry = 0, d = 0;
  for (let i = 0; i < h1.length; i++) { carry += h1[i] - h2[i]; d += Math.abs(carry); }
  return round(d / h1.length, 4);
}

export function structureDistance(s1, s2) {
  let d = 0;
  for (let i = 0; i < s1.length; i++) d += Math.hypot(s1[i][0] - s2[i][0], s1[i][1] - s2[i][1], s1[i][2] - s2[i][2]);
  return round(d / s1.length, 2);
}

export const hueDistance = (a, b) => (a === null || b === null ? 0 : Math.min(Math.abs(a - b), 360 - Math.abs(a - b)));
