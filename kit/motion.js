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
    const iw = (img && (img.videoWidth || img.naturalWidth || img.width)) || 0, ih = (img && (img.videoHeight || img.naturalHeight || img.height)) || 0;
    if (!iw || !ih) return;
    const s = Math.max(w / iw, h / ih) * zoom;
    const dw = iw * s, dh = ih * s;
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

  // A video file (Higgsfield, Veo, Kling, phone footage...) as a layer. Any size, any frame rate.
  //   const talk = M.video('../../assets/higgsfield/hook.mp4', { at: 0, audio: true, captions: true });
  //   talk.draw(ctx, t, 0, 0, 1080, 1920, { dim: 0.1 });       // cover-fit, like M.cover
  // at: when the clip starts in the video. trim: seconds to skip into the file. speed: playback rate.
  // audio: mix the clip's own sound (make.mjs). speech: the audio is someone talking, so music ducks
  // under it (default true when captions is on). captions: transcribe the speech into word captions
  // (needs ELEVENLABS_API_KEY, or pass transcript: '...' for estimated timing). volume: clip audio level. loop / hold: what happens after the file ends.
  // key: 'green' | 'blue' | '#RRGGBB' removes a green/blue screen (the person floats over your scene;
  // use clip.draw with { dim: 0 }). The browser preview shows the unkeyed clip.
  // A missing file draws a labelled placeholder, so scenes can be written before the clip exists.
  M._media = [];
  M.video = (src, { at = 0, trim = 0, speed = 1, audio = true, volume = 1, captions = false, speech = captions, loop = false, transcript = '', key = null, fps: clipFps } = {}) => {
    const fps = clipFps || (window.VIDEO && window.VIDEO.fps) || 30;   // match the scene's fps (call after setup, or pass fps)
    const clip = { src, at, trim, speed, missing: false, duration: 0, width: 0, height: 0 };
    let frameAt;
    if (typeof window.__loadVideo === 'function') {             // rendering: exact frames from the engine
      const meta = window.__loadVideo(src, fps, key);
      Object.assign(clip, meta);
      if (!meta.missing) {
        let lastI = -1, lastImg = null;
        frameAt = (i) => (i === lastI ? lastImg : (lastImg = window.__videoFrame(meta.id, (lastI = i))));
      }
    } else {                                                     // browser preview: seek a <video>
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = src;
      v.addEventListener('error', () => { clip.missing = true; });
      v.addEventListener('loadedmetadata', () => { clip.duration = v.duration; clip.width = v.videoWidth; clip.height = v.videoHeight; });
      frameAt = (i, sec) => { if (Math.abs(v.currentTime - sec) > 0.5 / fps && !v.seeking) v.currentTime = sec; return v.readyState >= 2 ? v : null; };
    }
    clip.frame = (t) => {
      if (clip.missing || !frameAt) return null;
      let sec = (t - at) * speed + trim;
      if (sec < trim) return null;
      const last = Math.max(0, (clip.frames || Math.round(clip.duration * fps) || 1) - 1);
      let i = Math.floor(sec * fps + 1e-6);
      i = loop ? i % (last + 1) : Math.min(i, last);
      return frameAt(i, i / fps);
    };
    clip.at = clip.frame;                                        // same call shape as M.clip
    clip.playing = (t) => t >= at && (loop || (t - at) * speed + trim < (clip.duration || Infinity));
    clip.draw = (ctx, t, x, y, w, h, opts = {}) => {
      const img = clip.frame(t);
      if (img) { M.cover(ctx, img, x, y, w, h, { dim: 0, ...opts }); return true; }
      if (!clip.missing) return false;
      ctx.save();
      M.roundRect(ctx, x, y, w, h, opts.radius || 0); ctx.clip();
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#2A2F3A'); g.addColorStop(1, '#14171E');
      ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 4; ctx.setLineDash([18, 14]);
      ctx.strokeRect(x + 20, y + 20, w - 40, h - 40); ctx.setLineDash([]);
      const s = Math.max(22, Math.min(44, w / 20));
      M.text(ctx, 'CLIP GOES HERE', x + w / 2, y + h / 2 - s * 0.6, { font: `800 ${s * 1.2}px sans-serif`, color: '#FFFFFF', align: 'center', alpha: 0.85 });
      M.text(ctx, String(src).split('/').slice(-2).join('/'), x + w / 2, y + h / 2 + s * 0.9, { font: `600 ${s * 0.7}px sans-serif`, color: '#FFFFFF', align: 'center', alpha: 0.6 });
      ctx.restore();
      return true;
    };
    M._media.push({ src, at, trim, speed, audio, volume, captions, speech, loop, transcript });
    return clip;
  };

  // Canvas text doesn't trigger web-font loading, so preload every face the scene uses,
  // e.g. M.fonts(['400 40px "Plus Jakarta Sans"', '800 40px "Plus Jakarta Sans"']).
  M.fonts = (specs) => {
    for (const s of specs) {
      assets.push(document.fonts.load(s).then((f) => { if (!f.length) throw new Error('font not found: ' + s); }));
    }
  };

  // ---- captions --------------------------------------------------------------
  // Word-timed captions, drawn on top of every frame when the scene sets `captions: true`.
  // make.mjs supplies real word timings from the narration (window.CAPTIONS); without them
  // (browser preview, no voice yet) the timings are estimated from the voice lines' text.
  // words: [{ w: 'word', s: startSeconds, e: endSeconds }]
  M.estimateWords = (lines, wps = 2.7) => {
    const out = [];
    let cursor = 0;
    for (const line of lines || []) {
      let s = line.at != null ? Math.max(line.at, cursor) : cursor + 0.25;
      for (const w of String(line.text || '').split(/\s+/).filter(Boolean)) {
        const d = (0.12 + w.length * 0.045) * (2.7 / wps);
        out.push({ w, s, e: s + d });
        s += d + 0.06;
      }
      cursor = s;
    }
    return out;
  };
  // Chunks of up to `max` words (a new chunk after . , ! ? or a pause), shown until the next chunk.
  M.captionChunks = (words, max = 3) => {
    const chunks = [];
    let cur = null;
    words.forEach((wd, i) => {
      const prev = words[i - 1];
      const brk = !cur || cur.words.length >= max || /[.,!?;:]$/.test(prev?.w || '') || wd.s - (prev?.e ?? 0) > 0.45
        || cur.words.map((x) => x.w).join(' ').length + wd.w.length > 20;
      if (brk) chunks.push(cur = { words: [] });
      cur.words.push(wd);
    });
    chunks.forEach((c, i) => {
      c.s = c.words[0].s;
      const next = chunks[i + 1];
      const end = c.words[c.words.length - 1].e;
      c.e = next && next.s - end < 0.6 ? next.s : end + 0.35;
    });
    return chunks;
  };

  // Caption looks. Pick one in brand.js (captions: { style }) or per scene (M.setup({ captions: { style } })):
  //   'pill'     dark rounded pill, spoken word in the accent colour (default)
  //   'bold'     big uppercase white with a heavy outline, spoken word in accent and bigger (the "Hormozi" look)
  //   'box'      TikTok-native white label, black text
  //   'minimal'  clean white text with a soft shadow, spoken word underlined
  //   'karaoke'  the whole chunk faint, words light up as they're spoken
  //   'pop'      one word at a time, huge, punching in
  // Other options: uppercase, position (0-1 down the frame), size (scale), emoji: { word: '💰' } (adds a
  // sticker when that word is spoken; needs kit/blocks.js).
  M.CAPTION_STYLES = ['pill', 'bold', 'box', 'minimal', 'karaoke', 'pop'];
  M.drawCaptions = (ctx, t, chunks, { width, height }, opts = {}) => {
    const c = chunks.find((k) => t >= k.s && t < k.e);
    if (!c) return;
    const BR = window.BRAND || {};
    const style = opts.style || 'pill';
    const fam = (BR.fonts && BR.fonts.display) || '"Plus Jakarta Sans"';
    const accent = opts.accent || (BR.colors && BR.colors.accent) || '#FC5C2B';
    const upper = opts.uppercase ?? (style === 'bold' || style === 'pop');
    const base = { pill: 0.062, bold: 0.082, box: 0.06, minimal: 0.058, karaoke: 0.066, pop: 0.12 }[style] || 0.062;
    let size = Math.round(width * base * (opts.size || 1));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'middle';
    const words = c.words.map((w) => (upper ? w.w.toUpperCase() : w.w));
    const activeI = c.words.findIndex((wd, i) => t >= wd.s && t < (c.words[i + 1]?.s ?? c.e));
    // Shrink long chunks so they stay clear of the TikTok/Reels button rail on the right.
    let space, widths, total;
    for (let i = 0; i < 14; i++) {
      ctx.font = `800 ${size}px ${fam}`;
      space = ctx.measureText(' ').width;
      widths = words.map((w) => ctx.measureText(w).width);
      total = widths.reduce((a, b) => a + b, 0) + space * (words.length - 1);
      if (total + size * 0.9 <= width * 0.68 || size < width * 0.035) break;
      size = Math.round(size * 0.92);
    }
    const cy = height * (opts.position ?? (height > width ? 0.705 : 0.86));
    const k = M.prog(t, c.s, 0.18, M.ease.outBack);
    ctx.translate(width / 2, cy);
    if (style !== 'pop') ctx.scale(0.9 + 0.1 * k, 0.9 + 0.1 * k);
    const padX = size * 0.45, padY = size * 0.32;
    if (style === 'pill') {
      M.roundRect(ctx, -total / 2 - padX, -size / 2 - padY, total + 2 * padX, size + 2 * padY, size * 0.3);
      ctx.fillStyle = 'rgba(8,10,14,0.78)'; ctx.fill();
    }
    if (style === 'box') {
      M.roundRect(ctx, -total / 2 - padX * 0.7, -size / 2 - padY * 0.8, total + 1.4 * padX, size + 1.6 * padY, size * 0.22);
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
    }
    let x = -total / 2;
    words.forEach((w, i) => {
      const active = i === activeI, spoken = t >= c.words[i].s;
      const wk = M.prog(t, c.words[i].s, 0.16, M.ease.outBack);
      ctx.save();
      ctx.translate(x + widths[i] / 2, 0);
      if (style === 'bold' && active) ctx.scale(1 + 0.12 * wk, 1 + 0.12 * wk);
      if (style === 'pop') { const s = 0.5 + 0.5 * M.prog(t, c.s, 0.22, M.ease.outBack); ctx.scale(s, s); }
      ctx.textAlign = 'center';
      if (style === 'bold' || style === 'pop') {
        ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.2; ctx.strokeStyle = '#000000';
        ctx.strokeText(w, 0, 2);
        ctx.fillStyle = style === 'pop' ? (chunks.indexOf(c) % 3 === 0 ? accent : '#FFFFFF') : active ? accent : '#FFFFFF';
      } else if (style === 'box') {
        ctx.fillStyle = active ? accent : '#111111';
      } else if (style === 'minimal') {
        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = size * 0.35; ctx.shadowOffsetY = size * 0.06;
        ctx.fillStyle = '#FFFFFF';
      } else if (style === 'karaoke') {
        ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.14; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(w, 0, 2);
        ctx.fillStyle = active ? accent : spoken ? '#FFFFFF' : 'rgba(255,255,255,0.45)';
      } else {
        ctx.fillStyle = active ? accent : '#FFFFFF';
      }
      ctx.fillText(w, 0, 2);
      if (style === 'minimal' && active) { ctx.shadowBlur = 0; ctx.fillStyle = accent; ctx.fillRect(-widths[i] / 2, size * 0.55, widths[i] * wk, Math.max(4, size * 0.08)); }
      ctx.restore();
      x += widths[i] + space;
    });
    // Emoji sticker for keywords: emoji: { money: '💰', love: '😍' }
    const emap = opts.emoji || {};
    const hit = c.words.find((wd) => emap[String(wd.w).toLowerCase().replace(/[^a-z0-9']/g, '')]);
    if (hit && window.__emojiImg) {
      const img = window.__emojiImg(emap[String(hit.w).toLowerCase().replace(/[^a-z0-9']/g, '')]);
      if (img && img.width) {
        const ek = M.prog(t, hit.s, 0.3, M.ease.outBack), es = size * 1.5;
        ctx.save(); ctx.translate(0, -size * 1.45); ctx.rotate(-0.1 + 0.06 * Math.sin(t * 4)); ctx.scale(ek, ek);
        ctx.drawImage(img, -es / 2, -es / 2, es, es); ctx.restore();
      }
    }
    ctx.restore();
  };

  // ---- beats & narration cues -------------------------------------------------------
  // make.mjs finds the beats in the scene's music and the real start/end of each narration line, and
  // hands both to the scene before it runs, so timings can be built from them:
  //   const CUTS = [3, 6.5, 10].map((t) => M.snap(t));          // move each cut onto the nearest beat
  //   FX.camera(ctx, t, { punch: M.beats.filter((_, i) => i % 4 === 0) })   // punch on every bar
  //   const s = 1 + 0.03 * M.onBeat(t);                          // pulse something with the kick
  //   const CUES = M.cues(VOICE);  CUES[2].start                 // when narration line 3 really starts
  // In the browser preview (no make.mjs) beats are empty and cues are estimated from the text.
  M.beats = (window.BEATS && window.BEATS.beats) || [];
  M.bpm = (window.BEATS && window.BEATS.bpm) || 0;
  M.snap = (t, every = 1) => {
    const list = every > 1 ? M.beats.filter((_, i) => i % every === 0) : M.beats;
    return list.length ? list.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a)) : t;
  };
  M.onBeat = (t, { decay = 0.16, every = 1 } = {}) => {
    let last = -1;
    for (let i = 0; i < M.beats.length; i += every) { if (M.beats[i] <= t) last = M.beats[i]; else break; }
    return last < 0 ? 0 : Math.exp(-(t - last) / decay);
  };
  M.cues = (lines = [], { gap = 0.25 } = {}) => {
    if (window.CUES && window.CUES.length) return window.CUES;
    let cursor = 0;
    return lines.map((l) => {
      const text = typeof l === 'string' ? l : l.text, start = (typeof l === 'object' && l.at != null) ? l.at : cursor + gap;
      const end = start + String(text).split(/\s+/).filter(Boolean).reduce((a, w) => a + 0.18 + w.length * 0.045, 0);
      cursor = end;
      return { start, end, text };
    });
  };

  // ---- data -------------------------------------------------------------------
  // Content from outside the scene (a spreadsheet row, an edit plan), so one template makes many ads:
  //   const D = M.data({ product: 'Glow Serum', price: '$29', hooks: ['POV: ...'] });
  // make.mjs --data row.json (and batch-ads.mjs / footage.mjs) fill it in; the defaults are the preview.
  M.data = (defaults = {}) => {
    const d = window.DATA || {};
    const out = { ...defaults };
    for (const [k, v] of Object.entries(d)) {
      if (v === '' || v == null) continue;
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = { ...out[k], ...v };
      else out[k] = v;
    }
    return out;
  };

  // ---- variants --------------------------------------------------------------
  // Render several versions of one scene, e.g. three hooks to A/B test:
  //   const HOOK = M.pick(['POV: your ad finally converts', 'Stop scrolling if you sell online', '3 seconds. That is all you get.']);
  // `node make.mjs scene.html --variants` renders every one (out/<name>-v1.mp4, -v2...).
  M.variant = Number(window.VARIANT || 0);
  M._variants = 1;
  M.pick = (options) => { M._variants = Math.max(M._variants, options.length); return options[M.variant % options.length]; };

  // ---- setup / player --------------------------------------------------------
  //   post:       { caption, hashtags: ['a', 'b'] } -> out/<name>.post.txt for the upload
  //   cover:      seconds: the frame used for out/<name>.cover.jpg (default 0.7 s)
  //   look:       colour grade + grain applied by make.mjs: 'cinematic' | 'punchy' | 'film' | 'clean'
  //   motionBlur: samples per frame, e.g. 4 (filmic; render time grows with it), or
  //               { samples: 6, around: true } to blur only around the cuts (fast, nearly the same look).
  //   shutter:    0..1 (0.5 = a 180° shutter)
  // Sound is declared here and built by `node make.mjs <scene>` (see CLAUDE.md):
  //   voice:    [{ at: 0.3, text: 'One sentence per beat.' }, ...]   narration lines (ElevenLabs, or file: 'x.mp3')
  //   sfx:      [{ at: 0, name: 'hit' }, { at: 4.6, name: 'whoosh', volume: 0.5 }]   sounds/sfx/<name>.mp3
  //   music:    'pulse' or { track: 'calm', volume: 0.2 }             sounds/music/<track>.mp3
  //   captions: true   word-by-word captions; keeps the safe area's bottom clear for them
  //   preset:   'tiktok' | 'reels' | 'shorts' (1080x1920, the default), 'feed' (1080x1350, 4:5),
  //             'square' (1080x1080), 'youtube' (1920x1080). Sets the size and that platform's safe zone.
  //             To get other sizes from one vertical video instead, use make.mjs --formats.
  M.PRESETS = {
    tiktok: { width: 1080, height: 1920 }, reels: { width: 1080, height: 1920 }, shorts: { width: 1080, height: 1920 },
    vertical: { width: 1080, height: 1920 },
    feed: { width: 1080, height: 1350, safe: { left: 60, top: 60, right: 1020, bottom: 1290 } },
    square: { width: 1080, height: 1080, safe: { left: 60, top: 60, right: 1020, bottom: 1020 } },
    youtube: { width: 1920, height: 1080, safe: { left: 96, top: 54, right: 1824, bottom: 1000 } },
    landscape: { width: 1920, height: 1080, safe: { left: 96, top: 54, right: 1824, bottom: 1000 } },
  };
  M.setup = ({ preset = null, width, height, fps = 30, duration, cuts = [], background = '#fff', draw,
    voice = [], sfx = [], music = null, captions = false, look = null, motionBlur = 1, shutter = 0.5, post = null, cover = null, voiceId = null }) => {
    if (!duration) throw new Error('setup needs duration');
    const P = preset ? M.PRESETS[preset] : null;
    if (preset && !P) throw new Error(`unknown preset "${preset}" (try: ${Object.keys(M.PRESETS).join(', ')})`);
    width = width || (P && P.width) || 1080;
    height = height || (P && P.height) || 1920;
    if (P && P.safe) Object.assign(M.safe, P.safe);
    else if (Math.abs(width / height - 9 / 16) > 0.02) {                // a custom non-vertical size: 5% margins
      Object.assign(M.safe, { left: Math.round(width * 0.05), top: Math.round(height * 0.05), right: Math.round(width * 0.95), bottom: Math.round(height * 0.95) });
    }
    const canvas = document.createElement('canvas');
    canvas.id = 'stage';
    canvas.width = width;
    canvas.height = height;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    // Captions sit in the band just above the TikTok caption area, so content stays above it.
    if (captions && height > width) M.safe.bottom = Math.min(M.safe.bottom, Math.round(height * 0.65));
    const capOpts = { ...((window.BRAND || {}).captions || {}), ...(typeof captions === 'object' && captions ? captions : {}) };
    const capChunks = captions ? M.captionChunks(window.CAPTIONS || M.estimateWords(voice), capOpts.style === 'pop' ? 1 : (capOpts.maxWords || 3)) : [];

    window.VIDEO = { width, height, fps, duration, cuts, preset, voice, sfx, music, captions: !!captions, look, motionBlur, shutter, post, cover, voiceId, media: M._media, variants: M._variants, variant: M.variant };
    window.draw = (t) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      draw(ctx, t, { width, height });
      if (capChunks.length) M.drawCaptions(ctx, t, capChunks, { width, height }, capOpts);
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
