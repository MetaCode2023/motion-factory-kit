// fx.js: the "looks expensive" layer. Backgrounds with depth, glow, glass, gradient and kinetic
// type, camera moves, and cinematic transitions. Load after motion.js (and brand.js if you use it):
//   <script src="../../kit/fx.js"></script>
//
// Everything is deterministic (seeded, a function of t), so every render is identical.
// Pair it with M.setup({ look: 'cinematic', motionBlur: 4 }) for grading, grain and motion blur.
(function () {
  const M = window.M;
  if (!M) throw new Error('load kit/motion.js before kit/fx.js');
  const { clamp, lerp, ease } = M;
  const FX = {};
  const brand = () => (window.B && window.B.brand) || (window.BRAND ? { colors: window.BRAND.colors || {}, fonts: window.BRAND.fonts || {} } : { colors: {}, fonts: {} });
  const col = (k, d) => (brand().colors && brand().colors[k]) || d;

  // ---- deterministic randomness ----------------------------------------------------------------
  FX.rng = (seed = 1) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let r = Math.imul(seed ^ (seed >>> 15), 1 | seed); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  // Smooth 1-D noise in -1..1 (sum of sines with fixed, seeded phases): for drifts and camera shake.
  FX.wobble = (t, seed = 1, speed = 1) => {
    const r = FX.rng(seed); const a = r() * 6.28, b = r() * 6.28, c = r() * 6.28;
    return (Math.sin(t * 1.3 * speed + a) * 0.5 + Math.sin(t * 2.7 * speed + b) * 0.3 + Math.sin(t * 5.1 * speed + c) * 0.2);
  };
  const hexA = (hex, a) => {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  FX.alpha = hexA;

  // Offscreen layers (cached by name) for transitions, glass and blur.
  const layers = {};
  FX.layer = (name, w, h) => {
    let c = layers[name];
    if (!c) { c = layers[name] = document.createElement('canvas'); }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none';
    x.clearRect(0, 0, w, h);
    return { canvas: c, ctx: x };
  };
  const dims = (ctx) => ({ w: ctx.canvas.width, h: ctx.canvas.height });

  // ===================================================================================== backgrounds

  // Aurora: big soft colour fields drifting over a dark base. The single biggest "wow" upgrade
  // over a flat fill. colors: 2-4 colours (defaults: brand accent + cool complements).
  FX.aurora = (ctx, t, { colors, base = col('bg', '#07080C'), intensity = 0.55, speed = 0.12, seed = 7, x = 0, y = 0, w, h } = {}) => {
    const d = dims(ctx); w = w || d.w; h = h || d.h;
    colors = colors || [col('accent', '#FC5C2B'), '#6D5BFF', '#18C8FF', '#FF3D9A'];
    // Painted at quarter resolution and scaled up: it's all soft gradients, so it looks the same
    // and costs ~1/16th as much.
    const q = 4, lw = Math.max(1, Math.ceil(w / q)), lh = Math.max(1, Math.ceil(h / q));
    const L = FX.layer('aurora', lw, lh), a = L.ctx;
    a.fillStyle = base; a.fillRect(0, 0, lw, lh);
    a.globalCompositeOperation = 'screen';
    colors.forEach((c, i) => {
      const r = FX.rng(seed + i * 17);
      const px = lw * (0.5 + 0.38 * Math.sin(t * speed * (0.7 + r()) + r() * 6.28));
      const py = lh * (0.45 + 0.4 * Math.sin(t * speed * (0.5 + r()) * 1.3 + r() * 6.28));
      const rad = Math.max(lw, lh) * (0.45 + 0.25 * r());
      const g = a.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, hexA(c, intensity)); g.addColorStop(0.45, hexA(c, intensity * 0.35)); g.addColorStop(1, hexA(c, 0));
      a.fillStyle = g; a.fillRect(0, 0, lw, lh);
    });
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(L.canvas, 0, 0, lw, lh, x, y, w, h);
    ctx.restore();
  };

  // Floating bokeh / dust in three depth layers (far = small, slow, faint).
  FX.particles = (ctx, t, { count = 60, color = '#FFFFFF', seed = 3, speed = 1, size = 1, opacity = 0.5, rise = true } = {}) => {
    const { w, h } = dims(ctx);
    const r = FX.rng(seed);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < count; i++) {
      const depth = r(), x0 = r() * w, y0 = r() * h, ph = r() * 6.28, s = (2 + depth * 10) * size;
      const vy = (rise ? -1 : 1) * (10 + depth * 50) * speed;
      const px = (x0 + Math.sin(t * 0.4 + ph) * 30 * depth + w) % w;
      const py = (((y0 + vy * t) % h) + h) % h;
      const a = opacity * (0.25 + 0.75 * depth) * (0.6 + 0.4 * Math.sin(t * 1.5 + ph));
      const g = ctx.createRadialGradient(px, py, 0, px, py, s * 2.2);
      g.addColorStop(0, hexA(color, a)); g.addColorStop(0.35, hexA(color, a * 0.5)); g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g; ctx.fillRect(px - s * 2.2, py - s * 2.2, s * 4.4, s * 4.4);
    }
    ctx.restore();
  };

  // Perspective grid floor (retro/tech) or a flat dot grid that drifts.
  FX.grid = (ctx, t, { color = '#FFFFFF', opacity = 0.12, mode = 'floor', speed = 1, horizon = 0.62, spacing = 90 } = {}) => {
    const { w, h } = dims(ctx);
    ctx.save();
    ctx.strokeStyle = hexA(color, opacity); ctx.fillStyle = hexA(color, opacity);
    if (mode === 'dots') {
      const off = (t * 20 * speed) % spacing;
      for (let y = -spacing; y < h + spacing; y += spacing) for (let x = -spacing; x < w + spacing; x += spacing) {
        ctx.beginPath(); ctx.arc(x + off, y + off * 0.5, 3, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      const hy = h * horizon;
      ctx.lineWidth = 2;
      for (let i = -20; i <= 20; i++) { ctx.beginPath(); ctx.moveTo(w / 2 + i * 40, hy); ctx.lineTo(w / 2 + i * 260, h); ctx.stroke(); }
      const ph = (t * speed * 0.6) % 1;
      for (let k = 0; k < 16; k++) {
        const z = Math.pow((k + ph) / 16, 2.2), y = hy + (h - hy) * z;
        ctx.globalAlpha = clamp(z * 2); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      const fade = ctx.createLinearGradient(0, hy - 40, 0, hy + 200);
      fade.addColorStop(0, hexA(col('bg', '#07080C'), 1)); fade.addColorStop(1, hexA(col('bg', '#07080C'), 0));
      ctx.globalAlpha = 1; ctx.fillStyle = fade; ctx.fillRect(0, hy - 40, w, 240);
    }
    ctx.restore();
  };

  // A warm light leak sweeping across, e.g. on a cut or a reveal.
  FX.lightLeak = (ctx, t, { at = 0, dur = 1.2, color = '#FF8A3D', strength = 0.55, angle = -0.4 } = {}) => {
    const p = (t - at) / dur;
    if (p <= 0 || p >= 1) return;
    const { w, h } = dims(ctx);
    const a = Math.sin(Math.PI * p) * strength;
    const cx = lerp(-w * 0.3, w * 1.3, ease.inOutCubic(p)), cy = h * 0.4;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.translate(cx, cy); ctx.rotate(angle);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.9);
    g.addColorStop(0, hexA(color, a)); g.addColorStop(0.3, hexA('#FFD27A', a * 0.5)); g.addColorStop(1, hexA(color, 0));
    ctx.scale(1, 2.4);
    ctx.fillStyle = g; ctx.fillRect(-w, -w, w * 2, w * 2);
    ctx.restore();
  };

  // Darkened edges: pulls the eye to the centre.
  FX.vignette = (ctx, { strength = 0.55, color = '#000000' } = {}) => {
    const { w, h } = dims(ctx);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    g.addColorStop(0, hexA(color, 0)); g.addColorStop(1, hexA(color, strength));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.restore();
  };

  // ===================================================================================== materials

  // Neon glow around whatever `draw()` paints (text, shapes). Two passes: wide halo + tight core.
  FX.glow = (ctx, draw, { color = col('accent', '#FC5C2B'), blur = 40, strength = 1 } = {}) => {
    ctx.save();
    ctx.shadowColor = hexA(color, 0.9 * strength); ctx.shadowBlur = blur; draw();
    ctx.shadowBlur = blur * 0.35; draw();
    ctx.restore();
  };

  // Frosted glass card: blurs what's already drawn behind it, tints it, adds a light edge.
  // Call it after the background, before the card's contents.
  FX.glass = (ctx, x, y, w, h, { radius = 36, blur = 28, tint = 'rgba(255,255,255,0.08)', border = 'rgba(255,255,255,0.22)', shadow = true } = {}) => {
    const m = ctx.getTransform();
    const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]);
    const dx0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])) - blur * 2)), dy0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])) - blur * 2));
    const dx1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...pts.map((p) => p[0])) + blur * 2)), dy1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...pts.map((p) => p[1])) + blur * 2));
    if (shadow) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 24; M.roundRect(ctx, x, y, w, h, radius); ctx.fillStyle = 'rgba(0,0,0,0.01)'; ctx.fill(); ctx.restore(); }
    if (dx1 > dx0 && dy1 > dy0) {
      // Blur a quarter-size copy and scale it back up: same look, a fraction of the cost.
      const q = 4, rw = Math.max(1, Math.ceil((dx1 - dx0) / q)), rh = Math.max(1, Math.ceil((dy1 - dy0) / q));
      const L = FX.layer('glass', rw, rh);
      L.ctx.drawImage(ctx.canvas, dx0, dy0, dx1 - dx0, dy1 - dy0, 0, 0, rw, rh);
      ctx.save();
      M.roundRect(ctx, x, y, w, h, radius); ctx.clip();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = `blur(${(blur / q).toFixed(1)}px) saturate(140%)`;
      ctx.drawImage(L.canvas, 0, 0, rw, rh, dx0, dy0, dx1 - dx0, dy1 - dy0);
      ctx.filter = 'none';
      ctx.restore();
    }
    ctx.save();
    M.roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = tint; ctx.fill();
    const edge = ctx.createLinearGradient(x, y, x + w, y + h);
    edge.addColorStop(0, border); edge.addColorStop(0.5, 'rgba(255,255,255,0.04)'); edge.addColorStop(1, border);
    ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke();
    const sheen = ctx.createLinearGradient(x, y, x, y + h * 0.5);
    sheen.addColorStop(0, 'rgba(255,255,255,0.10)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen; ctx.fill();
    ctx.restore();
  };

  // Text filled with a gradient; shimmer: a highlight that sweeps across (pass t).
  FX.gradientText = (ctx, str, x, y, { font, colors = [col('accent', '#FC5C2B'), '#FFC23D'], align = 'left', t = null, glow = 0 } = {}) => {
    ctx.save();
    if (font) ctx.font = font;
    ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
    const w = ctx.measureText(str).width, x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    const g = ctx.createLinearGradient(x0, y - 100, x0 + w, y);
    colors.forEach((c, i) => g.addColorStop(i / Math.max(1, colors.length - 1), c));
    ctx.fillStyle = g;
    if (glow) { ctx.shadowColor = hexA(colors[0], 0.8); ctx.shadowBlur = glow; }
    ctx.fillText(str, x, y);
    if (t != null) {
      const p = ((t * 0.45) % 1.6) - 0.3;
      const s = ctx.createLinearGradient(x0 + w * (p - 0.15), 0, x0 + w * (p + 0.15), 0);
      s.addColorStop(0, 'rgba(255,255,255,0)'); s.addColorStop(0.5, 'rgba(255,255,255,0.75)'); s.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.shadowBlur = 0; ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = s; ctx.fillText(str, x, y);
    }
    ctx.restore();
    return w;
  };

  // ===================================================================================== kinetic type

  // Animated text reveal. mode:
  //   'rise'     words rise and un-blur, staggered (default; feels premium)
  //   'mask'     each line slides up from behind a mask (editorial)
  //   'chars'    letters pop in one by one
  //   'scramble' letters resolve from random glyphs (tech)
  //   'pop'      words punch in with overshoot (energetic)
  // Returns { bottom, lines }. x is the left edge (or centre with align: 'center').
  FX.text = (ctx, t, str, x, y, { at = 0, mode = 'rise', font = `800 96px ${(brand().fonts && brand().fonts.display) || '"Plus Jakarta Sans"'}`,
    color = col('ink', '#F5F7FA'), accent = '', accentColor = col('accent', '#FC5C2B'), align = 'left', maxWidth = 860, lineHeight = 1.12,
    stagger = 0.06, dur = 0.55, until = Infinity, seed = 5, balance = true } = {}) => {
    ctx.save();
    ctx.font = font;
    const size = parseFloat(font.match(/([\d.]+)px/)[1]), lh = size * lineHeight;
    let lines = M.wrap(ctx, str, maxWidth);
    if (balance && lines.length > 1) {          // same number of lines, as even as possible
      let lo = maxWidth * 0.4, hi = maxWidth;
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (M.wrap(ctx, str, mid).length > lines.length) lo = mid; else hi = mid; }
      lines = M.wrap(ctx, str, hi);
    }
    const outA = clamp((until - t) / 0.25);
    const accWords = new Set(String(accent).split(/\s+/).filter(Boolean));
    let wi = 0;
    ctx.textBaseline = 'alphabetic';
    lines.forEach((line, li) => {
      const words = line.split(' '), space = ctx.measureText(' ').width;
      const lw = ctx.measureText(line).width;
      let cx = align === 'center' ? x - lw / 2 : align === 'right' ? x - lw : x;
      const by = y + size * 0.9 + li * lh;
      if (mode === 'mask') {
        const k = ease.outExpo(clamp((t - at - li * stagger * 2) / dur));
        ctx.save();
        ctx.beginPath(); ctx.rect(cx - 20, by - size * 1.05, lw + 40, lh + size * 0.2); ctx.clip();
        ctx.globalAlpha *= outA;
        ctx.translate(0, (1 - k) * lh * 1.1);
        words.forEach((w) => { ctx.fillStyle = accWords.has(w) ? accentColor : color; ctx.fillText(w, cx, by); cx += ctx.measureText(w).width + space; });
        ctx.restore();
        wi += words.length;
        return;
      }
      words.forEach((w) => {
        const ww = ctx.measureText(w).width, fill = accWords.has(w) ? accentColor : color;
        const start = at + wi * stagger;
        if (mode === 'chars' || mode === 'scramble') {
          let ccx = cx;
          [...w].forEach((ch, ci) => {
            const cs = start + ci * stagger * 0.4, k = clamp((t - cs) / (dur * 0.6));
            const cw = ctx.measureText(ch).width;
            if (k > 0) {
              ctx.save(); ctx.globalAlpha *= Math.min(1, k * 2) * outA; ctx.fillStyle = fill;
              if (mode === 'scramble' && k < 1) {
                const r = FX.rng(seed + Math.floor(t * 30) * 31 + ci + wi * 7);
                const glyphs = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789#%&*';
                ctx.fillStyle = hexA(accentColor, 0.9); ctx.fillText(glyphs[Math.floor(r() * glyphs.length)], ccx, by);
              } else {
                const s = mode === 'chars' ? 0.6 + 0.4 * ease.outBack(k) : 1;
                ctx.translate(ccx + cw / 2, by); ctx.scale(s, s); ctx.fillText(ch, -cw / 2, 0);
              }
              ctx.restore();
            }
            ccx += cw;
          });
        } else {
          const k = clamp((t - start) / dur);
          if (k > 0) {
            ctx.save();
            ctx.globalAlpha *= Math.min(1, k * 1.8) * outA;
            ctx.fillStyle = fill;
            if (mode === 'pop') {
              const s = 0.4 + 0.6 * ease.outBack(k);
              ctx.translate(cx + ww / 2, by - size * 0.35); ctx.scale(s, s); ctx.fillText(w, -ww / 2, size * 0.35);
            } else {
              const e = ease.outExpo(k), b = (1 - e) * 14;
              if (b > 0.5) ctx.filter = `blur(${b.toFixed(1)}px)`;
              ctx.fillText(w, cx, by + (1 - e) * size * 0.45);
            }
            ctx.restore();
          }
        }
        cx += ww + space;
        wi++;
      });
    });
    ctx.restore();
    return { bottom: y + lines.length * lh, lines, size };
  };

  // ===================================================================================== camera

  // Wrap a frame in a camera move. Call FX.camera(...) at the start of draw(); it returns a function
  // to call at the end (or use FX.withCamera). punch: times of beat "punches" (quick zoom bumps).
  //   const end = FX.camera(ctx, t, { zoom: 1 + 0.04 * t / 20, shake: 0.3, punch: [0, 4.5, 9] }); ...; end();
  FX.camera = (ctx, t, { zoom = 1, x = 0, y = 0, rotate = 0, shake = 0, punch = [], punchAmount = 0.06, seed = 11 } = {}) => {
    const { w, h } = dims(ctx);
    let z = zoom;
    for (const p of punch) { const d = t - p; if (d >= 0 && d < 0.6) z *= 1 + punchAmount * Math.exp(-d * 9) * Math.sin(Math.min(Math.PI / 2, d * 30)); }
    const sx = shake ? FX.wobble(t, seed, 2.2) * 14 * shake : 0, sy = shake ? FX.wobble(t, seed + 1, 2.0) * 14 * shake : 0;
    const rot = rotate + (shake ? FX.wobble(t, seed + 2, 1.6) * 0.004 * shake : 0);
    ctx.save();
    ctx.translate(w / 2 + x + sx, h / 2 + y + sy); ctx.rotate(rot); ctx.scale(z, z); ctx.translate(-w / 2, -h / 2);
    return () => ctx.restore();
  };
  FX.withCamera = (ctx, t, opts, draw) => { const end = FX.camera(ctx, t, opts); try { draw(); } finally { end(); } };

  // ===================================================================================== transitions

  // A cinematic cut between two beats at time `at`. drawOld(c) / drawNew(c) paint each beat onto
  // the context they're given (pass the context through: (c) => beatOne(c, t)).
  //   type: 'zoom'   push into the old beat, new one settles in from slightly zoomed (default)
  //         'whip'   fast horizontal whip with motion smear
  //         'circle' new beat opens through a growing circle (from cx, cy)
  //         'wipe'   diagonal wipe with an accent edge
  //         'glitch' slice displacement + RGB split, then cut
  //         'flash'  white flash on the cut
  //         'blur'   old blurs out, new blurs in
  FX.transition = (ctx, t, at, drawOld, drawNew, { type = 'zoom', dur = 0.5, cx = null, cy = null, color = col('accent', '#FC5C2B') } = {}) => {
    const p = (t - at) / dur;
    if (p <= 0) return drawOld(ctx);
    if (p >= 1) return drawNew(ctx);
    const { w, h } = dims(ctx);
    const m = ctx.getTransform();
    const paint = (name, fn) => { const L = FX.layer(name, w, h); L.ctx.setTransform(m); fn(L.ctx); return L.canvas; };
    const blit = (img, { alpha = 1, scale = 1, dx = 0, dy = 0, blur = 0, op = 'source-over' } = {}) => {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
      ctx.translate(w / 2 + dx, h / 2 + dy); ctx.scale(scale, scale);
      if (blur > 2) {                                   // blur a quarter-size copy (fast), draw it back full size
        const Q = FX.layer('tq', Math.ceil(w / 4), Math.ceil(h / 4));
        Q.ctx.drawImage(img, 0, 0, Math.ceil(w / 4), Math.ceil(h / 4));
        ctx.filter = `blur(${(blur / 4).toFixed(1)}px)`;
        ctx.drawImage(Q.canvas, -w / 2, -h / 2, w, h);
      } else ctx.drawImage(img, -w / 2, -h / 2);
      ctx.restore();
    };
    const bg = () => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = col('bg', '#07080C'); ctx.fillRect(0, 0, w, h); ctx.restore(); };
    if (type === 'zoom' || type === 'blur') {
      const zoom = type === 'zoom';
      const o = paint('tA', drawOld), n = paint('tB', drawNew);
      bg();
      if (p < 0.55) blit(o, { alpha: 1 - clamp((p - 0.25) / 0.3), scale: zoom ? 1 + 1.4 * p * p : 1, blur: 30 * clamp(p / 0.5) });
      if (p > 0.35) blit(n, { alpha: clamp((p - 0.35) / 0.3), scale: zoom ? 1.25 - 0.25 * ease.outCubic(clamp((p - 0.35) / 0.65)) : 1, blur: 30 * (1 - clamp((p - 0.35) / 0.5)) });
    } else if (type === 'whip') {
      const o = paint('tA', drawOld), n = paint('tB', drawNew);
      const k = ease.inOutCubic(p), off = k * w * 1.2;
      bg();
      for (let i = 0; i < 6; i++) {                       // smear copies = cheap directional motion blur
        const s = (i / 5 - 0.5) * 160 * Math.sin(Math.PI * p);
        blit(o, { alpha: 0.28, dx: -off + s });
        blit(n, { alpha: 0.28, dx: w * 1.2 - off + s });
      }
    } else if (type === 'circle') {
      drawOld(ctx);
      const n = paint('tB', drawNew), k = ease.inOutCubic(p);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath(); ctx.arc(cx ?? w / 2, cy ?? h / 2, Math.hypot(w, h) * k, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(n, 0, 0);
      ctx.restore();
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.strokeStyle = color; ctx.lineWidth = 14 * (1 - k);
      ctx.beginPath(); ctx.arc(cx ?? w / 2, cy ?? h / 2, Math.hypot(w, h) * k, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    } else if (type === 'wipe') {
      drawOld(ctx);
      const n = paint('tB', drawNew), k = ease.inOutCubic(p), edge = lerp(-0.3 * w, 1.3 * w + h * 0.4, k);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(edge, 0); ctx.lineTo(edge - h * 0.4, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.save(); ctx.clip(); ctx.drawImage(n, 0, 0); ctx.restore();
      ctx.strokeStyle = color; ctx.lineWidth = 18; ctx.beginPath(); ctx.moveTo(edge, 0); ctx.lineTo(edge - h * 0.4, h); ctx.stroke();
      ctx.restore();
    } else if (type === 'glitch') {
      const src = paint('tA', p < 0.5 ? drawOld : drawNew);
      const r = FX.rng(Math.floor(t * 30) + 99), amt = Math.sin(Math.PI * p);
      bg();
      blit(src, { alpha: 1 });
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (let i = 0; i < 9; i++) {
        const sy = r() * h, sh = 20 + r() * 140, sx = (r() - 0.5) * 220 * amt;
        ctx.drawImage(src, 0, sy, w, sh, sx, sy, w, sh);
      }
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.5 * amt;
      ctx.drawImage(src, 14 * amt, 0); ctx.drawImage(src, -14 * amt, 0);
      ctx.restore();
    } else if (type === 'flash') {
      (p < 0.5 ? drawOld : drawNew)(ctx);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#FFFFFF'; ctx.globalAlpha = Math.pow(Math.sin(Math.PI * p), 2) * 0.9; ctx.fillRect(0, 0, w, h); ctx.restore();
    } else drawNew(ctx);
  };

  // Run a beat timeline: beats = [{ at, draw: (c) => ..., transition: 'zoom' }, ...]. Picks the
  // active beat and the transition into it. The transition's dur is centred on the cut.
  FX.timeline = (ctx, t, beats, { dur = 0.5 } = {}) => {
    let i = 0;
    while (i < beats.length - 1 && t >= beats[i + 1].at - (beats[i + 1].transition === 'none' ? 0 : dur / 2)) i++;
    const cur = beats[i], prev = beats[i - 1];
    if (!prev || cur.transition === 'none') return cur.draw(ctx);
    const start = cur.at - dur / 2;
    FX.transition(ctx, t, start, prev.draw, cur.draw, { type: cur.transition || 'zoom', dur });
  };

  window.FX = FX;
})();
