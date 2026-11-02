// motion.js: the shared runtime every scene loads.
//
// Contract with render.mjs:
//   window.VIDEO  = { width, height, fps, duration }
//   window.draw(t) paints the frame at t seconds onto <canvas id="stage">
//   window.__ready resolves once fonts and images are loaded
//
// Opened directly in a browser, the scene plays with a scrub bar (space = play/pause,
// arrows = step one frame). With ?render in the URL, it waits for render.mjs to drive draw(t).
(function () {
  const M = {};
  const assets = [];
  // Same 1080x1920 content boundary as score.py. Photos may extend outside it.
  M.safe = { left: 70, top: 220, right: 940, bottom: 1440 };
  M.safeBox = (box) => {
    const x = Math.max(M.safe.left, box.x), y = Math.max(M.safe.top, box.y);
    return { x, y, w: Math.max(0, Math.min(box.x + box.w, M.safe.right) - x),
      h: Math.max(0, Math.min(box.y + box.h, M.safe.bottom) - y) };
  };
  M.clipSafe = (ctx, draw) => {
    ctx.save();
    try {
      ctx.beginPath(); ctx.rect(M.safe.left, M.safe.top, M.safe.right - M.safe.left, M.safe.bottom - M.safe.top);
      ctx.clip(); draw();
    } finally { ctx.restore(); }
  };

  // ---- math / easing -------------------------------------------------------
  M.clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  M.lerp = (a, b, p) => a + (b - a) * p;
  M.ease = {
    linear: (p) => p,
    outCubic: (p) => 1 - Math.pow(1 - p, 3),
    inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    outBack: (p) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
    outExpo: (p) => (p === 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  };
  // 0→1 progress of a beat that starts at `start` and lasts `dur`, eased.
  M.prog = (t, start, dur, ease = M.ease.outCubic) => ease(M.clamp((t - start) / dur));
  // Fade in at `start`, hold, fade out at `end`. Returns 0..1 opacity.
  M.window = (t, start, end, fade = 0.35) =>
    Math.min(M.clamp((t - start) / fade), M.clamp((end - t) / fade));

  // A push cut between two beats at time `at`: the outgoing beat slides up and clears in the first
  // 40% of `dur` while the incoming one rises from below, so no frame is a washed-out crossfade with
  // both beats half visible. drawOut/drawIn paint each beat at its resting layout.
  //   M.push(ctx, t, 8.4, () => beatOne(ctx, t), () => beatTwo(ctx, t));
  M.push = (ctx, t, at, drawOut, drawIn, { dur = 0.4, dist = 160 } = {}) => {
    const p = M.clamp((t - at) / dur);
    if (p <= 0) return drawOut();
    if (p >= 1) return drawIn();
    const po = M.clamp(p / 0.4), pi = M.ease.outCubic(M.clamp((p - 0.4) / 0.6));
    if (po < 1) {
      ctx.save();
      ctx.translate(0, -0.1 * dist * M.ease.inOutCubic(po));
      drawOut();
      ctx.restore();
    }
    if (po >= 1) {
      ctx.save();
      ctx.translate(0, dist * (1 - pi));
      drawIn();
      ctx.restore();
    }
  };

  // ---- drawing helpers -----------------------------------------------------
  M.roundRect = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  };

  // Word-wrap `text` to `maxWidth`; returns lines. Uses the ctx's current font.
  M.wrap = (ctx, text, maxWidth) => {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) { out.push(line); line = word; }
        else line = test;
      }
      out.push(line);
    }
    return out;
  };

  M.text = (ctx, str, x, y, { font, color = '#111', align = 'left', baseline = 'alphabetic', alpha = 1, maxWidth, lineHeight } = {}) => {
    ctx.save();
    if (font) ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.globalAlpha *= alpha;
    const lines = maxWidth ? M.wrap(ctx, str, maxWidth) : [String(str)];
    // Read the px size out of ctx.font: Chrome serializes "800 40px X", skia "normal 800 40px X".
    const lh = lineHeight || parseFloat(ctx.font.match(/([\d.]+)px/)[1]) * 1.25;
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
    ctx.restore();
    return lines.length * lh;
  };

  // The largest font, from `max` down to `min` px, that sets `str` in at most `lines` lines of `width`.
  // Returns { font, size, lines }. family is the CSS family, e.g. '"Plus Jakarta Sans"'.
  M.fitFont = (ctx, str, { width = 840, max = 140, min = 72, lines = 2, weight = 800, family = 'sans-serif' } = {}) => {
    ctx.save();
    let size = max, out;
    for (; ; size -= 4) {
      ctx.font = `${weight} ${size}px ${family}`;
      out = M.wrap(ctx, str, width);
      const fits = out.length <= lines && out.every((l) => ctx.measureText(l).width <= width);
      if (fits || size - 4 < min) break;
    }
    const font = ctx.font;
    ctx.restore();
    return { font, size, lines: out };
  };

  // A hook or beat headline, set as large as fits (M.fitFont) and readable on its first frame.
  // (x, y) is the top-left of the block (top-centre with align: 'center'). Each line rises into place
  // from `start`, but at full opacity whenever start <= 0, so frame 0 of the video already shows the
  // words while they still move. `accent` is a word or phrase drawn in accentColor with an underline
  // that sweeps in under it. Returns { size, lines, h, bottom } to lay out what goes below.
  //   const h = M.headline(ctx, t, 'Who answers at 11 PM?', 120, 260, { family: '"Plus Jakarta Sans"', accent: '11 PM?', accentColor: '#FC5C2B' });
  M.headline = (ctx, t, str, x, y, {
    start = 0, width = 840, max = 140, min = 72, lines = 2, weight = 800, family = 'sans-serif',
    color = '#F5F7FA', accent = '', accentColor = '#FC5C2B', align = 'left', leading = 1.08, alpha = 1,
  } = {}) => {
    const fit = M.fitFont(ctx, str, { width, max, min, lines, weight, family });
    const lh = fit.size * leading;
    const acc = accent ? String(accent).split(' ') : [];
    ctx.save();
    ctx.font = fit.font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const space = ctx.measureText(' ').width;
    let wi = 0;
    const all = str.split(/\s+/);
    // Index of the first accent word in the full text, so a repeated word isn't highlighted twice.
    let accAt = -1;
    for (let i = 0; acc.length && i + acc.length <= all.length; i++) {
      if (acc.every((a, j) => all[i + j] === a)) { accAt = i; break; }
    }
    fit.lines.forEach((line, li) => {
      const k = M.prog(t, start + li * 0.06, 0.5, M.ease.outExpo);
      const a = start > 0 ? M.clamp((t - start - li * 0.06) / 0.15) : 1;
      if (a <= 0) { wi += line.split(' ').length; return; }
      const lw = ctx.measureText(line).width;
      let cx = align === 'center' ? x - lw / 2 : align === 'right' ? x - lw : x;
      const by = y + fit.size * 0.92 + li * lh + (1 - k) * fit.size * 0.35;
      ctx.globalAlpha = alpha * a;
      let ux0 = null, ux1 = 0;
      for (const word of line.split(' ')) {
        const hot = accAt >= 0 && wi >= accAt && wi < accAt + acc.length;
        const w = ctx.measureText(word).width;
        ctx.fillStyle = hot ? accentColor : color;
        ctx.fillText(word, cx, by);
        if (hot) { if (ux0 === null) ux0 = cx; ux1 = cx + w; }
        cx += w + space;
        wi++;
      }
      if (ux0 !== null) {
        const u = M.prog(t, Math.max(start, 0) + 0.25 + li * 0.06, 0.45, M.ease.outCubic);
        ctx.fillStyle = accentColor;
        ctx.fillRect(ux0, by + fit.size * 0.14, (ux1 - ux0) * u, Math.max(6, fit.size * 0.07));
      }
    });
    ctx.restore();
    const h = fit.lines.length * lh;
    return { size: fit.size, lines: fit.lines, h, bottom: y + h };
  };

  // A card body that builds row by row and always fills its box. Each item is { at, h, draw } where
  // `at` is when it arrives, `h` its height in px at scale 1, and draw(ctx, x, y, w, k) paints it at
  // (x, y) in width w with arrival progress k (0..1; the stack already fades and lifts it in).
  // The stack scales the rows that have arrived up to `max` so a sparse beat reads big instead of
  // sitting in an empty card, then eases the scale down as rows land, and the card (drawn by
  // card(ctx, x, y, w, h) behind the rows) grows to hug them. box is { x, y, w, h }: the space under
  // the beat headline, e.g. { x: 70, y: h.bottom + 40, w: 900, h: 1380 - h.bottom - 40 }. The box is
  // clipped to the safe area (right edge x 940, bottom y 1440) so a scaled-up card never runs under
  // the TikTok rail or caption. Returns { scale, h, bottom }: the drawn height and bottom edge.
  //   M.stack(ctx, t, box, rows.map((r, i) => ({ at: S + 0.4 + i * 0.6, h: 120, draw: (c, x, y, w) => row(c, r, x, y, w) })),
  //     { card: (c, x, y, w, h) => card(c, x, y, w, h), pad: 48 });
  M.stack = (ctx, t, box, items, { gap = 24, pad = 0, max = 1.5, card = null, dur = 0.5, valign = 'top' } = {}) => {
    box = M.safeBox(box);
    if (!box.w || !box.h) return { scale: 1, h: 0, bottom: box.y };
    const ks = items.map((it) => M.prog(t, it.at, dur, M.ease.outCubic));
    // Height of the rows that have arrived, growing smoothly as each one lands.
    let inner = 0, n = 0;
    items.forEach((it, i) => { if (ks[i] > 0) { inner += (n ? gap : 0) * ks[i] + it.h * ks[i]; n++; } });
    const need = inner + 2 * pad;
    // Never smaller than designed; never taller or wider than the box.
    const s = need > 0 ? Math.min(max, box.h / need) : max;
    const w = box.w / s, drawn = need * s;
    const top = valign === 'center' ? box.y + Math.max(0, (box.h - drawn) / 2) : box.y;
    ctx.save();
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    ctx.translate(box.x, top);
    ctx.scale(s, s);
    if (card && need > 0) card(ctx, 0, 0, w, need);
    let y = pad, first = true;
    items.forEach((it, i) => {
      const k = ks[i];
      if (k <= 0) return;
      if (!first) y += gap * k;
      first = false;
      ctx.save();
      ctx.globalAlpha *= M.clamp(k * 1.6);
      ctx.translate(0, (1 - k) * 24);
      it.draw(ctx, pad, y, w - 2 * pad, k);
      ctx.restore();
      y += it.h * k;
    });
    ctx.restore();
    return { scale: s, h: drawn, bottom: top + drawn };
  };

  // The beat progress bar: one slim segment per beat along the bottom edge, filling from cuts[i] to
  // cuts[i + 1], fading out over 0.2 s after the last cut so the end card stays clean. It is drawn
  // thin and half-strength on purpose: it is decoration under the TikTok caption, and a heavy bar there
  // reads as content (score.py counts it as text under the caption).
  //   M.progress(ctx, t, [2.6, 8.4, 14.2, 20.0, 25.5], { color: C.accent, track: C.line });
  M.progress = (ctx, t, cuts, { x = 70, w = 870, y = 1850, h = 4, gap = 16, color = '#FC5C2B', track = 'rgba(128,128,128,0.35)', strength = 0.5 } = {}) => {
    const n = cuts.length - 1;
    if (n < 1) return;
    const a = M.clamp((cuts[n] + 0.2 - t) / 0.2);
    if (a <= 0) return;
    const sw = (w - (n - 1) * gap) / n;
    ctx.save();
    ctx.globalAlpha *= a * strength;
    for (let i = 0; i < n; i++) {
      const sx = x + i * (sw + gap);
      M.roundRect(ctx, sx, y, sw, h, h / 2); ctx.fillStyle = track; ctx.fill();
      const f = M.clamp((t - cuts[i]) / (cuts[i + 1] - cuts[i]));
      if (f > 0) { M.roundRect(ctx, sx, y, sw * f, h, h / 2); ctx.fillStyle = color; ctx.fill(); }
    }
    ctx.restore();
  };

  // Typewriter: the first p (0..1) of a string.
  M.type = (str, p) => str.slice(0, Math.round(str.length * M.clamp(p)));

  // Count-up number formatted with commas and an optional prefix.
  M.count = (value, p, { prefix = '', decimals = 0 } = {}) =>
    prefix + (value * M.clamp(p)).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  // ---- assets ----------------------------------------------------------------
  M.image = (src) => {
    const img = new Image();
    assets.push(new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('image failed: ' + src)); }));
    img.src = src;
    return img;
  };

  // Draw an image to cover the rect (cropping, never stretching), then darken it by `dim` (0..1) so
  // text on top stays readable. fx/fy (0..1) pick the crop focus. zoom > 1 for a slow push (pass 1 + 0.05 * p).
  M.cover = (ctx, img, x, y, w, h, { dim = 0.5, fx = 0.5, fy = 0.5, zoom = 1, radius = 0, alpha = 1 } = {}) => {
    if (!img || !img.width) return;
    const s = Math.max(w / img.width, h / img.height) * zoom;
    const dw = img.width * s, dh = img.height * s;
    ctx.save();
    ctx.globalAlpha *= alpha;
    M.roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.drawImage(img, x + (w - dw) * fx, y + (h - dh) * fy, dw, dh);
    if (dim > 0) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(x, y, w, h); }
    ctx.restore();
  };

  // A clip from the asset library as a frame sequence: M.clip('assets/leak', 90, 15).
  // Returns { at(t, start = 0, { loop = false }) -> image }, the frame to show at time t.
  M.clip = (dir, count, fps = 15) => {
    const frames = [];
    for (let i = 1; i <= count; i++) frames.push(M.image(`${dir}/${String(i).padStart(4, '0')}.jpg`));
    return {
      frames, fps, duration: count / fps,
      at: (t, start = 0, { loop = false } = {}) => {
        let i = Math.floor((t - start) * fps);
        i = loop ? ((i % count) + count) % count : M.clamp(i, 0, count - 1);
        return frames[i];
      },
    };
  };

  // Canvas text doesn't trigger web-font loading, so preload every face the scene uses,
  // e.g. M.fonts(['400 40px "Plus Jakarta Sans"', '800 40px "Plus Jakarta Sans"']).
  M.fonts = (specs) => {
    for (const s of specs) {
      assets.push(document.fonts.load(s).then((f) => { if (!f.length) throw new Error('font not found: ' + s); }));
    }
  };

  // ---- setup / player --------------------------------------------------------
  M.setup = ({ width = 1080, height = 1920, fps = 30, duration, cuts = [], background = '#fff', draw }) => {
    if (!duration) throw new Error('setup needs duration');
    const canvas = document.createElement('canvas');
    canvas.id = 'stage';
    canvas.width = width;
    canvas.height = height;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    window.VIDEO = { width, height, fps, duration, cuts };
    window.draw = (t) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      draw(ctx, t, { width, height });
    };
    window.__ready = Promise.all([document.fonts.ready, ...assets]).then(() => document.fonts.ready);

    const rendering = new URLSearchParams(location.search).has('render');
    document.documentElement.style.cssText = 'margin:0;background:' + (rendering ? background : '#1b1b1f');
    document.body.style.cssText = 'margin:0;';
    if (rendering) return;

    // Preview player: fit the canvas to the window, add a scrub bar.
    canvas.style.cssText = 'display:block;margin:12px auto 0;max-height:calc(100vh - 70px);max-width:96vw;box-shadow:0 8px 40px #0008;';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:10px;align-items:center;max-width:720px;margin:10px auto;color:#ccc;font:13px system-ui';
    bar.innerHTML = '<button id="pp" style="width:64px">Pause</button><input id="sc" type="range" min="0" max="' +
      duration + '" step="' + 1 / fps + '" style="flex:1"><span id="tc" style="width:90px;text-align:right"></span>';
    document.body.appendChild(bar);
    const pp = bar.querySelector('#pp'), sc = bar.querySelector('#sc'), tc = bar.querySelector('#tc');
    let t = 0, playing = true, last = performance.now();
    const show = () => { window.draw(t); sc.value = t; tc.textContent = t.toFixed(2) + ' / ' + duration + 's'; };
    const toggle = () => { playing = !playing; pp.textContent = playing ? 'Pause' : 'Play'; last = performance.now(); };
    pp.onclick = toggle;
    sc.oninput = () => { t = +sc.value; if (playing) toggle(); show(); };
    addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        if (playing) toggle();
        t = M.clamp(t + (e.code === 'ArrowRight' ? 1 : -1) / fps, 0, duration);
        show();
      }
    });
    window.__ready.then(function loop(now) {
      now = performance.now();
      if (playing) { t = (t + (now - last) / 1000) % duration; }
      last = now;
      show();
      requestAnimationFrame(loop);
    });
  };

  window.M = M;
})();
