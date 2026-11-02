// ad.js: shared pieces for the templates in scenes/templates/ (load after blocks.js and fx.js).
// A template = beats on a timeline + a background + optional narration, all from M.data().
(function () {
  const { M, B, FX } = window;
  if (!M || !B || !FX) throw new Error('load motion.js, blocks.js and fx.js before ad.js');
  const AD = {};
  const C = B.brand.colors, F = B.brand.fonts;
  AD.font = (w, px, fam = F.display) => `${w} ${px}px ${fam}`;

  // Background: a footage clip (cover, dimmed, slow push) or animated colour.
  //   const bg = AD.background(D.clip);  ...  bg(ctx, t)
  AD.background = (clipPath, { dim = 0.45, captions = false, audio = true } = {}) => {
    const clip = clipPath ? M.video(clipPath, { at: 0, captions, audio, loop: true }) : null;
    return (ctx, t) => {
      if (clip && !clip.missing) clip.draw(ctx, t, 0, 0, 1080, 1920, { dim, zoom: 1.02 + 0.03 * Math.sin(t * 0.2) });
      else { FX.aurora(ctx, t, { intensity: 0.5 }); FX.particles(ctx, t, { count: 40, opacity: 0.3 }); }
    };
  };

  // Narration from a list of lines, one per beat: [{ at, text }] for M.setup({ voice }).
  AD.voice = (lines, starts) => (Array.isArray(lines) ? lines : lines ? [lines] : [])
    .map((text, i) => (text ? { at: (starts[i] ?? starts[starts.length - 1]) + 0.25, text } : null)).filter(Boolean);

  // Standard sound: hit on the hook, whoosh on each cut, chime on the CTA.
  AD.sfx = (cuts, ctaAt) => [
    { at: 0, name: 'hit', volume: 0.55 },
    ...cuts.map((c) => ({ at: Math.max(0, c - 0.22), name: 'whoosh', volume: 0.4 })),
    ...(ctaAt != null ? [{ at: ctaAt, name: 'chime', volume: 0.45 }] : []),
  ];

  // The hook beat: big kinetic headline with an accent word, optional sticker and comment.
  AD.hook = (ctx, t, { text, accent = '', at = 0, sticker = null, comment = null, y = 340 } = {}) => {
    let top = y;
    if (comment) top = B.commentReply(ctx, t, { at, user: comment.user || 'customer', text: comment.text || comment, y: 260 }).bottom + 50;
    const h = FX.text(ctx, t, text, 120, top, { at, mode: 'rise', font: AD.font(800, 112), accent, maxWidth: 840 });
    if (sticker) B.sticker(ctx, t, { emoji: sticker, at: at + 0.4, x: 930, y: top - 95, size: 150 });
    return h;
  };

  // A big glowing index number for list beats ("1", "2", "3").
  AD.number = (ctx, t, n, at, { x = 120, y = 360, size = 300, color = C.accent } = {}) => {
    const k = M.ease.outBack(M.clamp((t - at) / 0.45));
    if (k <= 0) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    FX.glow(ctx, () => FX.gradientText(ctx, String(n), 0, size * 0.8, { font: AD.font(800, size), colors: [color, '#FFC23D'], t }), { color, blur: 40, strength: 0.6 });
    ctx.restore();
  };

  // The closing beat: end card with takeaway + CTA, or a CTA button over footage.
  AD.cta = (ctx, t, { at, takeaway = '', cta = 'Shop now', url = B.brand.url, overFootage = false } = {}) => {
    if (overFootage) return B.ctaButton(ctx, t, { at, text: cta, y: 1040, tapAt: at + 1.2 });
    B.endCard(ctx, t, { at, takeaway, cta, url });
    B.tap(ctx, t, { at: at + 1.6, x: 640, y: 1220 });
  };

  // The upload caption (out/<name>.post.txt): data `caption` if given, else hook + takeaway + CTA.
  AD.post = (D, hook) => ({
    caption: D.caption || [hook, D.takeaway, D.cta ? `${D.cta}${D.url ? ' → ' + D.url : ''}` : ''].filter(Boolean).join('\n\n'),
    hashtags: [].concat(D.hashtags || []),
  });

  window.AD = AD;
})();
