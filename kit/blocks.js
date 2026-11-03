// blocks.js: ready-made, brand-styled pieces for explainers and UGC ads. Load after motion.js:
//   <script src="../../brand.js"></script>
//   <script src="../../kit/motion.js"></script>
//   <script src="../../kit/blocks.js"></script>
//
// Every block is a function of time: B.name(ctx, t, { at, ...options }). `at` is when it enters.
// Most return { bottom } (the y just below what they drew) so you can stack things.
// Colours and fonts come from brand.js. Sizes assume a 1080-wide frame. See docs/BLOCKS.md.
(function () {
  const M = window.M;
  if (!M) throw new Error('load kit/motion.js before kit/blocks.js');
  const B = {};
  const DEF = {
    name: 'Your Brand', handle: '@yourbrand', url: 'yourbrand.com', logo: null,
    colors: { bg: '#0B0D12', surface: '#161A22', line: '#2A303C', ink: '#F5F7FA', muted: '#8A93A6', accent: '#FC5C2B', good: '#3DDC97', bad: '#FF4D5E' },
    fonts: { display: '"Plus Jakarta Sans"', body: '"Plus Jakarta Sans"', mono: '"JetBrains Mono"' },
  };
  const U = window.BRAND || {};
  B.brand = { ...DEF, ...U, colors: { ...DEF.colors, ...(U.colors || {}) }, fonts: { ...DEF.fonts, ...(U.fonts || {}) } };
  B.root = window.KIT_ROOT || '../../';           // scenes live two folders down (scenes/<folder>/x.html)
  const C = B.brand.colors, F = B.brand.fonts;
  const font = (w, px, fam = F.body) => `${w} ${px}px ${fam}`;
  M.fonts([font(600, 40), font(800, 40), font(800, 40, F.display), font(600, 40, F.mono)]);
  B.logo = B.brand.logo ? M.image(B.root + B.brand.logo) : null;

  const { clamp, lerp, ease, prog } = M;
  // 0..1 entrance progress. Anything that starts at 0 is fully there on frame 0 (it's the thumbnail).
  const appear = (t, at, d = 0.45) => (at <= 0 && t >= 0 ? 1 : clamp((t - at) / d));
  const shadow = (ctx, blur = 40, y = 14, a = 0.35) => { ctx.shadowColor = `rgba(0,0,0,${a})`; ctx.shadowBlur = blur; ctx.shadowOffsetY = y; };
  const noShadow = (ctx) => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };
  // Scale around a point (for pop-ins).
  const around = (ctx, cx, cy, s) => { ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy); };
  const lines = (ctx, str, w, f) => { ctx.save(); ctx.font = f; const l = M.wrap(ctx, str, w); ctx.restore(); return l; };
  // Same number of lines, but as even as possible (no one-word orphan on the last line).
  const balanced = (ctx, str, w, f) => {
    const n = lines(ctx, str, w, f).length;
    if (n < 2) return lines(ctx, str, w, f);
    let lo = w * 0.4, hi = w;
    for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (lines(ctx, str, mid, f).length > n) lo = mid; else hi = mid; }
    return lines(ctx, str, hi, f);
  };
  B.balanced = balanced;

  function star(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
  }
  function avatar(ctx, x, y, r, label, color = C.accent) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    M.text(ctx, String(label || '?').replace('@', '').charAt(0).toUpperCase(), x, y + r * 0.36, { font: font(800, r), color: '#fff', align: 'center' });
    ctx.restore();
  }
  function check(ctx, cx, cy, r, ok, k = 1) {
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r * (0.6 + 0.4 * ease.outBack(k)), 0, Math.PI * 2); ctx.fillStyle = ok ? C.good : C.bad; ctx.fill();
    ctx.strokeStyle = '#0B0D12'; ctx.lineWidth = r * 0.22; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (ok) { ctx.moveTo(cx - r * 0.42, cy + r * 0.02); ctx.lineTo(cx - r * 0.1, cy + r * 0.34); ctx.lineTo(cx + r * 0.45, cy - r * 0.3); }
    else { ctx.moveTo(cx - r * 0.33, cy - r * 0.33); ctx.lineTo(cx + r * 0.33, cy + r * 0.33); ctx.moveTo(cx + r * 0.33, cy - r * 0.33); ctx.lineTo(cx - r * 0.33, cy + r * 0.33); }
    ctx.stroke();
    ctx.restore();
  }
  B._star = star; B._avatar = avatar; B._check = check;

  // ===================================================================================== UGC / TikTok

  // TikTok-style text. style 'box' = each line on its own rounded label (the classic look),
  // 'dark' / 'blue' = the same label in black or blue with white text (Reels title pills),
  // 'outline' = white text with a dark stroke, 'shadow' = white text with a soft shadow (meme captions),
  // 'plain' = brand text. x is the centre.
  //   B.nativeText(ctx, t, { at: 0, text: 'POV: you found the fix', y: 330 })
  B.nativeText = (ctx, t, { at = 0, until = Infinity, text, x = 540, y = 320, size = 64, w = 860, style = 'box', bg = '#FFFFFF', color, weight = 800 } = {}) => {
    const a = Math.min(appear(t, at, 0.12), clamp((until - t) / 0.12));
    if (a <= 0) return { bottom: y };
    const f = font(weight, size, F.display);
    const ls = balanced(ctx, text, w, f), lh = size * 1.22;
    const k = at <= 0 ? 1 : ease.outBack(appear(t, at, 0.3));
    if (style === 'dark' || style === 'blue') { bg = style === 'dark' ? '#0E0E10' : '#1E8BF0'; color = color || '#FFFFFF'; style = 'box'; }
    ctx.save();
    ctx.globalAlpha *= a;
    around(ctx, x, y + (ls.length * lh) / 2, 0.85 + 0.15 * k);
    ctx.font = f; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ls.forEach((l, i) => {
      const cy = y + lh / 2 + i * lh, tw = ctx.measureText(l).width;
      if (style === 'box') {
        ctx.fillStyle = bg; M.roundRect(ctx, x - tw / 2 - size * 0.32, cy - lh / 2 - 2, tw + size * 0.64, lh + 4, size * 0.22); ctx.fill();
        ctx.fillStyle = color || '#111111'; ctx.fillText(l, x, cy + size * 0.04);
      } else if (style === 'shadow') {
        ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = size * 0.35; ctx.shadowOffsetY = size * 0.05;
        ctx.fillStyle = color || '#FFFFFF'; ctx.fillText(l, x, cy); ctx.shadowColor = 'transparent';
      } else if (style === 'outline') {
        ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.strokeText(l, x, cy);
        ctx.fillStyle = color || '#FFFFFF'; ctx.fillText(l, x, cy);
      } else { ctx.fillStyle = color || C.ink; ctx.fillText(l, x, cy); }
    });
    ctx.restore();
    return { bottom: y + ls.length * lh };
  };

  // TikTok "Reply to @user's comment" sticker. A classic UGC opener.
  //   B.commentReply(ctx, t, { at: 0, user: 'jess.makes', text: 'does this actually work??' })
  B.commentReply = (ctx, t, { at = 0, until = Infinity, user = 'user', text, x = 140, y = 300, w = 800, size = 44 } = {}) => {
    const a = Math.min(appear(t, at, 0.15), clamp((until - t) / 0.15));
    if (a <= 0) return { bottom: y };
    const tl = balanced(ctx, text, w - 150, font(700, size)), lh = size * 1.25;
    const h = 112 + tl.length * lh + 10;
    const k = at <= 0 ? 1 : ease.outBack(appear(t, at, 0.35));
    ctx.save();
    ctx.globalAlpha *= a;
    around(ctx, x + w / 2, y + h / 2, 0.8 + 0.2 * k);
    shadow(ctx, 30, 10, 0.3);
    ctx.fillStyle = '#FFFFFF'; M.roundRect(ctx, x, y, w, h, 26); ctx.fill();
    noShadow(ctx);
    avatar(ctx, x + 66, y + 70, 38, user, '#8E9AAF');
    M.text(ctx, `Reply to ${user.startsWith('@') ? user : '@' + user}'s comment`, x + 124, y + 62, { font: font(600, 32), color: '#8A8F98' });
    tl.forEach((l, i) => M.text(ctx, l, x + 124, y + 62 + 58 + i * lh, { font: font(700, size), color: '#111111' }));
    ctx.restore();
    return { bottom: y + h };
  };

  // Five stars, filling one by one from `at`. rating can be fractional (4.7).
  B.stars = (ctx, t, { at = 0, x, y, size = 34, rating = 5, color = '#FFC23D', gap = 8 } = {}) => {
    for (let i = 0; i < 5; i++) {
      const k = ease.outBack(appear(t, at + i * 0.07, 0.3)), cx = x + size / 2 + i * (size + gap), cy = y + size / 2;
      ctx.save();
      star(ctx, cx, cy, size / 2); ctx.fillStyle = 'rgba(128,128,128,0.35)'; ctx.fill();
      const fill = clamp(rating - i);
      if (fill > 0 && k > 0) {
        ctx.save(); star(ctx, cx, cy, (size / 2) * k); ctx.clip();
        ctx.fillStyle = color; ctx.fillRect(cx - size / 2, cy - size / 2, size * fill, size); ctx.restore();
      }
      ctx.restore();
    }
    return { right: x + 5 * (size + gap) - gap, bottom: y + size };
  };

  // Product card that slides up: image, name, price (with optional old price), rating, badge.
  //   B.productCard(ctx, t, { at: 6, image: M.image('../../assets/product.png'), name: 'Glow Serum', price: '$29', oldPrice: '$39', rating: 4.8, reviews: '2.1k' })
  B.productCard = (ctx, t, { at = 0, until = Infinity, image = null, name = 'Product', price = '', oldPrice = '', rating = 0, reviews = '', badge = '', x = 70, y = 980, w = 830, h = 300 } = {}) => {
    const a = Math.min(appear(t, at, 0.2), clamp((until - t) / 0.2));
    if (a <= 0) return { bottom: y };
    const k = at <= 0 ? 1 : ease.outCubic(appear(t, at, 0.5));
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(0, (1 - k) * 220);
    shadow(ctx, 50, 18, 0.4);
    ctx.fillStyle = '#FFFFFF'; M.roundRect(ctx, x, y, w, h, 36); ctx.fill();
    noShadow(ctx);
    const pad = 28, iw = h - pad * 2;
    ctx.save(); M.roundRect(ctx, x + pad, y + pad, iw, iw, 24); ctx.clip();
    ctx.fillStyle = '#EEF0F3'; ctx.fillRect(x + pad, y + pad, iw, iw);
    if (image) M.cover(ctx, image, x + pad, y + pad, iw, iw, { dim: 0 });
    ctx.restore();
    const tx = x + pad * 2 + iw, tw = w - iw - pad * 3;
    const nl = lines(ctx, name, tw, font(800, 50)).slice(0, 2);
    nl.forEach((l, i) => M.text(ctx, l, tx, y + 84 + i * 58, { font: font(800, 50), color: '#111111' }));
    let ry = y + 84 + nl.length * 58;
    if (rating) { const s = B.stars(ctx, t, { at: at + 0.3, x: tx, y: ry - 22, size: 32, rating }); if (reviews) M.text(ctx, `(${reviews})`, s.right + 14, ry + 4, { font: font(600, 30), color: '#6B7280' }); ry += 52; }
    if (price) {
      M.text(ctx, price, tx, ry + 30, { font: font(800, 64, F.display), color: '#111111' });
      if (oldPrice) {
        ctx.save(); ctx.font = font(800, 64, F.display); const pw = ctx.measureText(price).width; ctx.restore();
        ctx.save(); ctx.font = font(600, 38); const ow = ctx.measureText(oldPrice).width; ctx.restore();
        M.text(ctx, oldPrice, tx + pw + 20, ry + 26, { font: font(600, 38), color: '#9CA3AF' });
        ctx.fillStyle = '#9CA3AF'; ctx.fillRect(tx + pw + 18, ry + 12, ow + 4, 3);
      }
    }
    if (badge) {
      const bk = ease.outBack(appear(t, at + 0.45, 0.35));
      ctx.save(); around(ctx, x + w - 20, y + 20, bk);
      ctx.font = font(800, 34); const bw = ctx.measureText(badge).width + 40;
      ctx.fillStyle = C.accent; M.roundRect(ctx, x + w - bw + 10, y - 22, bw, 64, 32); ctx.fill();
      M.text(ctx, badge, x + w - bw / 2 + 10, y + 22, { font: font(800, 34), color: '#fff', align: 'center' });
      ctx.restore();
    }
    ctx.restore();
    return { bottom: y + h };
  };

  // Review / testimonial card. Label generated or example reviews as examples, never as real customers.
  B.review = (ctx, t, { at = 0, until = Infinity, name = 'Customer', text, rating = 5, verified = true, x = 90, y = 600, w = 900, light = true } = {}) => {
    const a = Math.min(appear(t, at, 0.2), clamp((until - t) / 0.2));
    if (a <= 0) return { bottom: y };
    const tl = lines(ctx, `“${text}”`, w - 96, font(700, 46)), lh = 58;
    const h = 150 + tl.length * lh + 40;
    const k = at <= 0 ? 1 : ease.outCubic(appear(t, at, 0.45));
    const ink = light ? '#111111' : C.ink, mut = light ? '#6B7280' : C.muted;
    ctx.save();
    ctx.globalAlpha *= a; ctx.translate(0, (1 - k) * 60);
    shadow(ctx, 40, 14, 0.3);
    ctx.fillStyle = light ? '#FFFFFF' : C.surface; M.roundRect(ctx, x, y, w, h, 32); ctx.fill();
    noShadow(ctx);
    B.stars(ctx, t, { at: at + 0.2, x: x + 48, y: y + 44, size: 40, rating });
    tl.forEach((l, i) => M.text(ctx, l, x + 48, y + 160 + i * lh, { font: font(700, 46), color: ink }));
    M.text(ctx, `— ${name}${verified ? '  ·  ✓ Verified buyer' : ''}`, x + 48, y + h - 36, { font: font(600, 32), color: mut });
    ctx.restore();
    return { bottom: y + h };
  };

  // Call-to-action pill that pops in, pulses, and gets tapped. x is the centre.
  B.ctaButton = (ctx, t, { at = 0, until = Infinity, text = 'Shop now', x = 540, y = 1150, w = 620, h = 132, color = C.accent, textColor = '#FFFFFF', tapAt = null } = {}) => {
    const a = Math.min(appear(t, at, 0.15), clamp((until - t) / 0.15));
    if (a <= 0) return { bottom: y };
    const k = ease.outBack(appear(t, at, 0.4));
    const pulse = 1 + 0.035 * Math.sin(Math.max(0, t - at - 0.5) * 6);
    const press = tapAt != null ? 1 - 0.07 * Math.sin(Math.PI * clamp((t - tapAt) / 0.25)) : 1;
    ctx.save();
    ctx.globalAlpha *= a;
    around(ctx, x, y + h / 2, k * pulse * press);
    shadow(ctx, 40, 14, 0.4);
    ctx.fillStyle = color; M.roundRect(ctx, x - w / 2, y, w, h, h / 2); ctx.fill();
    noShadow(ctx);
    M.text(ctx, text + '  →', x, y + h / 2 + 18, { font: font(800, 52, F.display), color: textColor, align: 'center' });
    ctx.restore();
    if (tapAt != null) B.tap(ctx, t, { at: tapAt, x: x + w * 0.22, y: y + h * 0.6 });
    return { bottom: y + h };
  };

  // A finger tap: dot plus expanding ring.
  B.tap = (ctx, t, { at = 0, x, y, color = '#FFFFFF' } = {}) => {
    const p = (t - at) / 0.6;
    if (p < -0.3 || p > 1) return;
    ctx.save();
    const inA = clamp((p + 0.3) / 0.3), outA = clamp((1 - p) / 0.4);
    ctx.globalAlpha *= Math.min(inA, outA) * 0.9;
    ctx.beginPath(); ctx.arc(x, y, 30 * (p < 0 ? 1.15 : 1 - 0.15 * Math.sin(Math.PI * clamp(p * 2))), 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.globalAlpha *= 0.85; ctx.fill();
    if (p > 0) {
      ctx.globalAlpha = (1 - p) * 0.8;
      ctx.beginPath(); ctx.arc(x, y, 30 + 80 * ease.outCubic(p), 0, Math.PI * 2);
      ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.stroke();
    }
    ctx.restore();
  };

  // Split screen with two layers (clips from M.video, or draw functions) and labels, e.g. before/after.
  //   B.split(ctx, t, { at: 0, left: before, right: after, labels: ['BEFORE', 'AFTER'] })
  B.split = (ctx, t, { at = 0, left, right, labels = [], x = 0, y = 0, w = 1080, h = 1920, mode = 'vertical', divider = 8 } = {}) => {
    const p = ease.outCubic(appear(t, at, 0.5));
    const paint = (layer, rx, ry, rw, rh) => {
      ctx.save(); ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
      if (layer && typeof layer.draw === 'function') layer.draw(ctx, t, rx, ry, rw, rh);
      else if (typeof layer === 'function') layer(ctx, rx, ry, rw, rh);
      ctx.restore();
    };
    const half = mode === 'vertical' ? (h / 2) : (w / 2);
    const cut = at <= 0 ? half : lerp(mode === 'vertical' ? h : w, half, p);
    if (mode === 'vertical') { paint(left, x, y, w, cut); paint(right, x, y + cut, w, h - cut); }
    else { paint(left, x, y, cut, h); paint(right, x + cut, y, w - cut, h); }
    ctx.fillStyle = '#FFFFFF';
    if (mode === 'vertical') ctx.fillRect(x, y + cut - divider / 2, w, divider); else ctx.fillRect(x + cut - divider / 2, y, divider, h);
    const la = appear(t, at + 0.3, 0.3);
    if (labels[0]) B.nativeText(ctx, t, { at: at + 0.3, text: labels[0], x: mode === 'vertical' ? x + w / 2 : x + cut / 2, y: mode === 'vertical' ? y + Math.max(240, cut - 140) : y + 260, size: 48, style: 'box', bg: C.bad, color: '#fff' });
    if (labels[1]) B.nativeText(ctx, t, { at: at + 0.45, text: labels[1], x: mode === 'vertical' ? x + w / 2 : x + cut + (w - cut) / 2, y: mode === 'vertical' ? y + cut + 40 : y + 260, size: 48, style: 'box', bg: C.good, color: '#0B0D12' });
    return { cut, alpha: la };
  };

  // Picture-in-picture: a rounded inset (a reaction cam, the product, a screen recording).
  B.pip = (ctx, t, { at = 0, until = Infinity, layer, x = 620, y = 260, w = 380, h = 560, radius = 32, border = '#FFFFFF' } = {}) => {
    const a = Math.min(appear(t, at, 0.2), clamp((until - t) / 0.2));
    if (a <= 0) return { bottom: y };
    const k = at <= 0 ? 1 : ease.outBack(appear(t, at, 0.4));
    ctx.save();
    ctx.globalAlpha *= a;
    around(ctx, x + w / 2, y + h / 2, 0.7 + 0.3 * k);
    shadow(ctx, 40, 16, 0.5);
    ctx.fillStyle = border; M.roundRect(ctx, x - 6, y - 6, w + 12, h + 12, radius + 6); ctx.fill();
    noShadow(ctx);
    ctx.save(); M.roundRect(ctx, x, y, w, h, radius); ctx.clip();
    ctx.fillStyle = '#222'; ctx.fillRect(x, y, w, h);
    if (layer && typeof layer.draw === 'function') layer.draw(ctx, t, x, y, w, h);
    else if (typeof layer === 'function') layer(ctx, x, y, w, h);
    ctx.restore();
    ctx.restore();
    return { bottom: y + h };
  };

  // ===================================================================================== explainer UI

  // iOS-style notification dropping in from the top.
  //   B.notification(ctx, t, { at: 0.2, app: 'Messages', title: 'Sarah', body: 'is this still available?' })
  B.notification = (ctx, t, { at = 0, until = Infinity, app = 'Messages', title = '', body = '', time = 'now', x = 70, y = 260, w = 940, iconColor = '#34C759', light = true } = {}) => {
    const a = Math.min(appear(t, at, 0.15), clamp((until - t) / 0.2));
    if (a <= 0) return { bottom: y };
    const bl = lines(ctx, body, w - 170, font(600, 40)).slice(0, 3), h = 138 + bl.length * 50;
    const k = at <= 0 ? 1 : ease.outBack(appear(t, at, 0.5));
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(0, (1 - k) * -260);
    shadow(ctx, 40, 14, 0.35);
    ctx.fillStyle = light ? 'rgba(245,245,247,0.97)' : 'rgba(40,42,48,0.97)'; M.roundRect(ctx, x, y, w, h, 40); ctx.fill();
    noShadow(ctx);
    ctx.fillStyle = iconColor; M.roundRect(ctx, x + 32, y + 34, 84, 84, 20); ctx.fill();
    ctx.fillStyle = '#fff'; M.roundRect(ctx, x + 50, y + 56, 48, 34, 10); ctx.fill();
    const ink = light ? '#111' : '#F5F5F7', mut = light ? '#6E6E73' : '#A1A1A6';
    M.text(ctx, app.toUpperCase(), x + 140, y + 62, { font: font(600, 28), color: mut });
    M.text(ctx, time, x + w - 36, y + 62, { font: font(600, 28), color: mut, align: 'right' });
    M.text(ctx, title, x + 140, y + 112, { font: font(800, 42), color: ink });
    bl.forEach((l, i) => M.text(ctx, l, x + 140, y + 162 + i * 50, { font: font(600, 40), color: ink }));
    ctx.restore();
    return { bottom: y + h };
  };

  // A text conversation. Messages arrive at their own times; "them" messages get typing dots first.
  //   B.chat(ctx, t, { y: 500, messages: [{ at: 1, text: 'Do you deliver Sunday?' }, { at: 2.5, me: true, text: 'Yes! 9-5.' }] })
  B.chat = (ctx, t, { messages = [], x = 70, y = 520, w = 940, size = 50, typing = 0.8, light = false } = {}) => {
    let cy = y;
    const meBg = C.accent, themBg = light ? '#E9E9EB' : '#262A33', themInk = light ? '#111' : C.ink;
    for (const m of messages) {
      if (t < m.at - (m.me ? 0 : typing)) break;
      const tl = lines(ctx, m.text, w * 0.72 - 64, font(600, size)), lh = size * 1.28;
      const bw = Math.min(w * 0.72, Math.max(...tl.map((l) => { ctx.save(); ctx.font = font(600, size); const mw = ctx.measureText(l).width; ctx.restore(); return mw; })) + 64);
      const bh = tl.length * lh + 40, bx = m.me ? x + w - bw : x;
      if (!m.me && t < m.at) {                                      // typing dots
        ctx.save(); ctx.fillStyle = themBg; M.roundRect(ctx, x, cy, 150, 92, 46); ctx.fill();
        for (let i = 0; i < 3; i++) { const b = Math.sin(t * 9 - i * 0.9) * 0.5 + 0.5; ctx.beginPath(); ctx.arc(x + 45 + i * 30, cy + 46 - b * 7, 9, 0, Math.PI * 2); ctx.fillStyle = light ? '#8E8E93' : C.muted; ctx.globalAlpha = 0.5 + b * 0.5; ctx.fill(); }
        ctx.restore(); cy += 92 + 22; break;
      }
      const k = ease.outBack(appear(t, m.at, 0.35));
      ctx.save();
      ctx.globalAlpha *= clamp((t - m.at) / 0.15);
      around(ctx, m.me ? bx + bw : bx, cy + bh, 0.7 + 0.3 * k);
      ctx.fillStyle = m.me ? meBg : themBg; M.roundRect(ctx, bx, cy, bw, bh, 40); ctx.fill();
      tl.forEach((l, i) => M.text(ctx, l, bx + 32, cy + 20 + size + i * lh - 6, { font: font(600, size), color: m.me ? '#fff' : themInk }));
      ctx.restore();
      cy += bh + 22;
    }
    return { bottom: cy };
  };

  // Checklist: each item pops a check (ok: true) or a cross (ok: false) and strikes through crosses.
  B.checklist = (ctx, t, { items = [], x = 110, y = 560, w = 860, size = 54, gap = 34 } = {}) => {
    let cy = y;
    for (const it of items) {
      const p = appear(t, it.at, 0.4);
      if (p <= 0) continue;
      ctx.save();
      ctx.globalAlpha *= clamp(p * 1.8); ctx.translate((1 - ease.outCubic(p)) * 40, 0);
      check(ctx, x + size * 0.55, cy + size * 0.55, size * 0.55, it.ok !== false, p);
      const ok = it.ok !== false, f = font(ok ? 800 : 600, size);
      M.text(ctx, it.text, x + size * 1.5, cy + size * 0.9, { font: f, color: ok ? C.ink : C.muted });
      if (!ok) { ctx.save(); ctx.font = f; const tw = ctx.measureText(it.text).width; ctx.restore(); ctx.fillStyle = C.muted; ctx.fillRect(x + size * 1.5, cy + size * 0.55, tw * ease.outCubic(clamp((t - it.at - 0.25) / 0.4)), 5); }
      ctx.restore();
      cy += size * 1.1 + gap;
    }
    return { bottom: cy };
  };

  // A big counted-up number with a label under it.
  //   B.stat(ctx, t, { at: 3, value: 38, suffix: '%', label: 'more booked jobs' })
  B.stat = (ctx, t, { at = 0, value = 0, prefix = '', suffix = '', decimals = 0, label = '', x = 120, y = 700, size = 260, color = C.accent, align = 'left', dur = 1.2 } = {}) => {
    const p = appear(t, at, 0.2);
    if (p <= 0) return { bottom: y };
    ctx.save(); ctx.globalAlpha *= p;
    M.text(ctx, M.count(value, prog(t, at, dur, ease.outExpo), { prefix, decimals }) + suffix, x, y + size * 0.8, { font: font(800, size, F.display), color, align });
    if (label) M.text(ctx, label, x, y + size + 30, { font: font(700, 56), color: C.ink, align, alpha: appear(t, at + 0.5, 0.35) });
    ctx.restore();
    return { bottom: y + size + (label ? 60 : 0) };
  };

  // Before/after (or us/them) columns.
  //   B.compare(ctx, t, { at: 5, left: { title: 'Before', items: ['Missed calls'] }, right: { title: 'After', items: ['Every call answered'] } })
  B.compare = (ctx, t, { at = 0, left = {}, right = {}, x = 70, y = 560, w = 940, size = 42, stagger = 0.35 } = {}) => {
    const cw = (w - 30) / 2, rows = Math.max((left.items || []).length, (right.items || []).length);
    // Each row is as tall as its longest (wrapped) item on either side, so rows never crowd.
    // An item whose longest word won't fit the column gets a smaller size instead of overflowing.
    const fitSize = (it) => {
      ctx.save(); ctx.font = font(700, size);
      const widest = Math.max(...String(it || '').split(/\s+/).map((wd) => ctx.measureText(wd).width), 1);
      ctx.restore();
      return Math.min(size, Math.floor(size * (cw - 130) / widest));
    };
    const nl = (it) => (it ? lines(ctx, it, cw - 130, font(700, fitSize(it))).length : 1);
    const rowH = Array.from({ length: rows }, (_, i) => Math.max(nl((left.items || [])[i]), nl((right.items || [])[i])) * size * 1.15 + 50);
    const rowY = rowH.map((_, i) => rowH.slice(0, i).reduce((a, b) => a + b, 0));
    const h = 130 + rowH.reduce((a, b) => a + b, 0) + 20;
    [[left, x, C.bad, false], [right, x + cw + 30, C.good, true]].forEach(([col, cx, tone, ok], ci) => {
      const ca = appear(t, at + ci * 0.25, 0.35);
      if (ca <= 0) return;
      ctx.save(); ctx.globalAlpha *= ca; ctx.translate(0, (1 - ease.outCubic(ca)) * 40);
      ctx.fillStyle = C.surface; M.roundRect(ctx, cx, y, cw, h, 30); ctx.fill();
      ctx.fillStyle = tone; M.roundRect(ctx, cx, y, cw, 10, 5); ctx.fill();
      M.text(ctx, (col.title || '').toUpperCase(), cx + 36, y + 86, { font: font(800, 40), color: tone });
      (col.items || []).forEach((it, i) => {
        const ia = appear(t, at + 0.4 + i * stagger + ci * 0.15, 0.35);
        if (ia <= 0) return;
        const iy = y + 130 + rowY[i];
        ctx.save(); ctx.globalAlpha *= ia;
        check(ctx, cx + 56, iy + size * 0.55, size * 0.5, ok, ia);
        const fs = fitSize(it);
        M.text(ctx, it, cx + 100, iy + size * 0.75, { font: font(700, fs), color: C.ink, maxWidth: cw - 130, lineHeight: fs * 1.15 });
        ctx.restore();
      });
      ctx.restore();
    });
    return { bottom: y + h };
  };

  // Vertical steps with a connector that fills as each step arrives.
  B.steps = (ctx, t, { steps = [], x = 120, y = 560, w = 840, gap = 170 } = {}) => {
    steps.forEach((s, i) => {
      const cy = y + i * gap, p = appear(t, s.at, 0.4), next = steps[i + 1];
      if (next) {
        ctx.fillStyle = C.line; ctx.fillRect(x + 30, cy + 64, 6, gap - 68);
        ctx.fillStyle = C.accent; ctx.fillRect(x + 30, cy + 64, 6, (gap - 68) * clamp((t - s.at) / Math.max(0.3, next.at - s.at)));
      }
      ctx.save();
      ctx.beginPath(); ctx.arc(x + 33, cy + 33, 33, 0, Math.PI * 2);
      ctx.fillStyle = p > 0 ? C.accent : C.surface; ctx.fill();
      ctx.strokeStyle = p > 0 ? C.accent : C.line; ctx.lineWidth = 4; ctx.stroke();
      M.text(ctx, String(i + 1), x + 33, cy + 47, { font: font(800, 36), color: p > 0 ? '#fff' : C.muted, align: 'center' });
      ctx.globalAlpha *= 0.35 + 0.65 * p; ctx.translate((1 - ease.outCubic(p)) * 30, 0);
      M.text(ctx, s.title, x + 100, cy + 50, { font: font(800, 54), color: C.ink });
      if (s.sub) M.text(ctx, s.sub, x + 100, cy + 108, { font: font(600, 38), color: C.muted, maxWidth: w - 100 });
      ctx.restore();
    });
    return { bottom: y + steps.length * gap };
  };

  // Horizontal bar chart that grows in. highlight: index of the bar in the accent colour.
  B.bars = (ctx, t, { at = 0, data = [], x = 110, y = 600, w = 860, barH = 64, gap = 54, highlight = -1, format = (v) => String(v), stagger = 0.15 } = {}) => {
    const max = Math.max(...data.map((d) => d.value), 1);
    data.forEach((d, i) => {
      const by = y + i * (barH + gap + 44), p = ease.outCubic(appear(t, at + i * stagger, 0.8));
      if (appear(t, at + i * stagger, 0.2) <= 0) return;
      M.text(ctx, d.label, x, by + 34, { font: font(700, 40), color: C.ink, alpha: clamp(p * 2) });
      ctx.fillStyle = C.line; M.roundRect(ctx, x, by + 50, w, barH, barH / 2); ctx.fill();
      ctx.fillStyle = i === highlight ? C.accent : C.muted;
      M.roundRect(ctx, x, by + 50, Math.max(barH, (w * d.value / max) * p), barH, barH / 2); ctx.fill();
      M.text(ctx, format(Math.round(d.value * p)), x + w, by + 34, { font: font(800, 40), color: i === highlight ? C.accent : C.ink, align: 'right', alpha: clamp(p * 2) });
    });
    return { bottom: y + data.length * (barH + gap + 44) };
  };

  // Phone frame; drawScreen(ctx, x, y, w, h) paints the screen (or pass a clip as `screen`).
  B.phone = (ctx, t, { at = 0, x = 240, y = 520, w = 600, screen = null, drawScreen = null, tilt = 0 } = {}) => {
    const h = w * 2.05, p = at <= 0 ? 1 : ease.outCubic(appear(t, at, 0.6));
    if (appear(t, at, 0.2) <= 0 && at > 0) return { bottom: y };
    ctx.save();
    ctx.globalAlpha *= clamp(p * 1.5);
    ctx.translate(0, (1 - p) * 120);
    if (tilt) { ctx.translate(x + w / 2, y + h / 2); ctx.rotate(tilt); ctx.translate(-(x + w / 2), -(y + h / 2)); }
    shadow(ctx, 60, 24, 0.5);
    ctx.fillStyle = '#0A0A0C'; M.roundRect(ctx, x, y, w, h, w * 0.14); ctx.fill();
    noShadow(ctx);
    ctx.strokeStyle = '#3A3D45'; ctx.lineWidth = 4; M.roundRect(ctx, x + 2, y + 2, w - 4, h - 4, w * 0.14); ctx.stroke();
    const b = w * 0.035, sx = x + b, sy = y + b, sw = w - 2 * b, sh = h - 2 * b;
    ctx.save(); M.roundRect(ctx, sx, sy, sw, sh, w * 0.11); ctx.clip();
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(sx, sy, sw, sh);
    if (screen && typeof screen.draw === 'function') screen.draw(ctx, t, sx, sy, sw, sh);
    if (drawScreen) drawScreen(ctx, sx, sy, sw, sh);
    ctx.restore();
    ctx.fillStyle = '#0A0A0C'; M.roundRect(ctx, x + w / 2 - w * 0.15, y + b + 14, w * 0.3, w * 0.075, w * 0.04); ctx.fill();
    ctx.restore();
    return { bottom: y + h, screen: { x: sx, y: sy, w: sw, h: sh } };
  };

  // Status toast that pops in and out. kind: 'good' | 'bad' | 'info'.
  B.toast = (ctx, t, { at = 0, until = at + 2.2, text, kind = 'good', x = 540, y = 1120 } = {}) => {
    const a = Math.min(appear(t, at, 0.15), clamp((until - t) / 0.2));
    if (a <= 0) return;
    const k = ease.outBack(appear(t, at, 0.35)), f = font(800, 46);
    ctx.save(); ctx.font = f; const tw = ctx.measureText(text).width; ctx.restore();
    const w = tw + 150, h = 104, col = kind === 'bad' ? C.bad : kind === 'info' ? C.accent : C.good;
    ctx.save(); ctx.globalAlpha *= a; around(ctx, x, y + h / 2, 0.6 + 0.4 * k);
    shadow(ctx, 30, 10, 0.4);
    ctx.fillStyle = C.surface; M.roundRect(ctx, x - w / 2, y, w, h, h / 2); ctx.fill(); noShadow(ctx);
    ctx.strokeStyle = col; ctx.lineWidth = 4; M.roundRect(ctx, x - w / 2, y, w, h, h / 2); ctx.stroke();
    if (kind === 'info') { ctx.beginPath(); ctx.arc(x - w / 2 + 60, y + h / 2, 18, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); }
    else check(ctx, x - w / 2 + 60, y + h / 2, 28, kind !== 'bad', 1);
    M.text(ctx, text, x - w / 2 + 104, y + h / 2 + 16, { font: f, color: C.ink });
    ctx.restore();
  };

  // End card: logo or name, the takeaway, a CTA pill and the URL. Fills the frame.
  B.endCard = (ctx, t, { at = 0, takeaway = '', cta = '', url = B.brand.url, bg = C.bg, w = 1080, h = 1920 } = {}) => {
    const a = appear(t, at, 0.3);
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha *= a;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const cy = h * 0.36;
    if (B.logo && B.logo.width) {
      const lh = 140, lw = (B.logo.width / B.logo.height) * lh, k = ease.outBack(appear(t, at + 0.1, 0.4));
      ctx.save(); around(ctx, w / 2, cy, k); ctx.drawImage(B.logo, w / 2 - lw / 2, cy - lh / 2, lw, lh); ctx.restore();
    } else M.text(ctx, B.brand.name, w / 2, cy + 20, { font: font(800, 64, F.display), color: C.muted, align: 'center', alpha: appear(t, at + 0.1, 0.3) });
    if (takeaway) M.headline(ctx, t, takeaway, w / 2, cy + 130, { family: F.display, start: at + 0.2, align: 'center', width: w - 200, max: 120, color: C.ink, accentColor: C.accent });
    if (cta) B.ctaButton(ctx, t, { at: at + 0.6, text: cta, x: w / 2, y: cy + 470 });
    if (url) M.text(ctx, url, w / 2, cy + (cta ? 720 : 520), { font: font(600, 44, F.mono), color: C.muted, align: 'center', alpha: appear(t, at + 0.8, 0.3) });
    ctx.restore();
  };

  // ===================================================================================== street interviews
  // Overlays for "host stops strangers and asks them something" footage. footage.mjs places them from
  // the edit plan (docs/EDITOR.md "Street interviews"); use them by hand in any scene too.

  // The question the host asked, pinned at the top while people answer. label is the small chip above it.
  //   B.questionCard(ctx, t, { at: 0.4, until: 9, text: 'What would you pay for this?', label: 'We asked' })
  B.questionCard = (ctx, t, { at = 0, until = Infinity, text = '', label = 'We asked', x = 540, y = 250, w = 900, size = 56, light = true, accent = C.accent } = {}) => {
    const a = Math.min(appear(t, at, 0.18), clamp((until - t) / 0.18));
    if (a <= 0 || !text) return { bottom: y };
    const f = font(800, size, F.display), lh = size * 1.18;
    const tl = balanced(ctx, String(text), w - 96, f);
    const chip = label ? 62 : 0, h = 44 + chip + tl.length * lh + 34;
    const k = at <= 0 ? 1 : ease.outBack(appear(t, at, 0.4));
    ctx.save();
    ctx.globalAlpha *= a;
    around(ctx, x, y + h / 2, 0.86 + 0.14 * k);
    ctx.translate(0, (1 - k) * -30);
    shadow(ctx, 34, 12, 0.32);
    ctx.fillStyle = light ? '#FFFFFF' : C.surface; M.roundRect(ctx, x - w / 2, y, w, h, 30); ctx.fill();
    noShadow(ctx);
    if (label) {
      const lf = font(800, 30), lw = (ctx.font = lf, ctx.measureText(label.toUpperCase()).width) + 44;
      ctx.fillStyle = accent; M.roundRect(ctx, x - w / 2 + 40, y + 34, lw, 48, 24); ctx.fill();
      M.text(ctx, label.toUpperCase(), x - w / 2 + 62, y + 69, { font: lf, color: '#FFFFFF' });
    }
    tl.forEach((l, i) => M.text(ctx, l, x - w / 2 + 48, y + 44 + chip + size * 0.92 + i * lh, { font: f, color: light ? '#111111' : C.ink }));
    ctx.restore();
    return { bottom: y + h };
  };

  // Name lower-third: an accent bar that wipes in, the name, and an optional detail line.
  // Only put names and details people gave you (on camera or on their release); never make them up.
  //   B.lowerThird(ctx, t, { at: 2.1, until: 4.6, name: 'Marcus', detail: 'Runs 40 miles a week' })
  B.lowerThird = (ctx, t, { at = 0, until = at + 2.6, name = '', detail = '', x = 70, y = 1030, size = 58, accent = C.accent } = {}) => {
    const a = Math.min(appear(t, at, 0.12), clamp((until - t) / 0.2));
    if (a <= 0 || !name) return { bottom: y };
    const nf = font(800, size, F.display), df = font(600, Math.round(size * 0.58));
    ctx.save(); ctx.font = nf; const nw = ctx.measureText(name).width; ctx.font = df; const dw = detail ? ctx.measureText(detail).width : 0; ctx.restore();
    const w = Math.min(940, Math.max(nw, dw) + 84), h = detail ? size * 2.25 : size * 1.5;
    const k = ease.outCubic(appear(t, at, 0.4)), reveal = ease.outCubic(appear(t, at + 0.08, 0.45));
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.fillStyle = accent; ctx.fillRect(x, y, 14, h * k);
    ctx.beginPath(); ctx.rect(x + 14, y - 10, (w + 20) * reveal, h + 20); ctx.clip();
    shadow(ctx, 24, 8, 0.3);
    ctx.fillStyle = 'rgba(12,12,14,0.86)'; ctx.fillRect(x + 14, y, w, h);
    noShadow(ctx);
    M.text(ctx, name, x + 50, y + size * 1.08, { font: nf, color: '#FFFFFF' });
    if (detail) M.text(ctx, detail, x + 52, y + size * 1.86, { font: df, color: 'rgba(255,255,255,0.78)' });
    ctx.restore();
    return { bottom: y + h };
  };

  // "Asked 50 people" counter. mode 'chip' = a small "7/50" badge per person (top right);
  // mode 'big' = the total counting up with a label, for an opener.
  //   B.counter(ctx, t, { at: 3, n: 7, total: 50 })
  //   B.counter(ctx, t, { at: 0, mode: 'big', total: 50, label: 'people asked' })
  B.counter = (ctx, t, { at = 0, until = Infinity, n = 1, total = 0, label = 'people asked', mode = 'chip', x, y, accent = C.accent } = {}) => {
    const a = Math.min(appear(t, at, 0.12), clamp((until - t) / 0.18));
    if (a <= 0) return { bottom: y ?? 0 };
    ctx.save();
    ctx.globalAlpha *= a;
    if (mode === 'big') {
      const cx = x ?? 540, cy = y ?? 760, p = at <= 0 ? 1 : ease.outCubic(clamp((t - at) / 1.1));
      const big = font(800, 300, F.display);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40;
      M.text(ctx, String(Math.round(total * p)), cx, cy, { font: big, color: '#FFFFFF', align: 'center' });
      ctx.restore();
      ctx.save(); ctx.font = font(800, 52); const lw = ctx.measureText(label.toUpperCase()).width + 64; ctx.restore();
      ctx.fillStyle = accent; M.roundRect(ctx, cx - lw / 2, cy + 50, lw, 84, 42); ctx.fill();
      M.text(ctx, label.toUpperCase(), cx, cy + 108, { font: font(800, 52), color: '#FFFFFF', align: 'center' });
      ctx.restore();
      return { bottom: cy + 134 };
    }
    const str = total ? `${n}/${total}` : `#${n}`, f = font(800, 44, F.display);
    ctx.font = f; const w = ctx.measureText(str).width + 56, h = 76;
    const bx = (x ?? 1010) - w, by = y ?? 250, k = at <= 0 ? 1 : ease.outBack(appear(t, at, 0.35));
    around(ctx, bx + w / 2, by + h / 2, 0.7 + 0.3 * k);
    shadow(ctx, 20, 6, 0.3);
    ctx.fillStyle = accent; M.roundRect(ctx, bx, by, w, h, h / 2); ctx.fill();
    noShadow(ctx);
    M.text(ctx, str, bx + w / 2, by + 53, { font: f, color: '#FFFFFF', align: 'center' });
    ctx.restore();
    return { bottom: by + h };
  };

  // Poll result bar: how the answers split. Use real counts from the shoot, never estimates.
  //   B.tally(ctx, t, { at: 12, title: 'Would you switch?', options: [{ label: 'Yes', value: 32 }, { label: 'No', value: 18 }] })
  B.tally = (ctx, t, { at = 0, until = Infinity, title = '', options = [], x = 90, y = 820, w = 900, accent = C.accent, other = '#3A3F4B' } = {}) => {
    const a = Math.min(appear(t, at, 0.2), clamp((until - t) / 0.2));
    const opts = options.filter((o) => +o.value >= 0).slice(0, 4);
    const sum = opts.reduce((s, o) => s + +o.value, 0);
    if (a <= 0 || !sum) return { bottom: y };
    const p = at <= 0 ? 1 : ease.outCubic(clamp((t - at - 0.2) / 1.0));
    const th = title ? 90 : 0, barY = y + th + 40, barH = 120, h = th + 40 + barH + 130;
    const cols = [accent, other, '#8A93A6', '#C9CED8'];
    ctx.save();
    ctx.globalAlpha *= a;
    shadow(ctx, 34, 12, 0.32);
    ctx.fillStyle = 'rgba(12,12,14,0.86)'; M.roundRect(ctx, x, y, w, h, 30); ctx.fill();
    noShadow(ctx);
    if (title) M.text(ctx, title, x + 44, y + 84, { font: font(800, 50, F.display), color: '#FFFFFF', maxWidth: w - 88 });
    ctx.save(); M.roundRect(ctx, x + 44, barY, w - 88, barH, 24); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 44, barY, w - 88, barH);
    let bx = x + 44;
    opts.forEach((o, i) => { const bw = (w - 88) * (o.value / sum) * p; ctx.fillStyle = cols[i]; ctx.fillRect(bx, barY, bw, barH); bx += bw; });
    ctx.restore();
    let lx = x + 44;
    opts.forEach((o, i) => {
      const pct = Math.round((100 * o.value) / sum * p);
      const seg = (w - 88) * (o.value / sum);
      if (seg > 150) M.text(ctx, `${pct}%`, lx + 26, barY + barH * 0.66, { font: font(800, 54, F.display), color: '#FFFFFF' });
      M.text(ctx, `${o.label} · ${Math.round(o.value * p)}`, lx + (i ? 0 : 4), barY + barH + 66, { font: font(700, 38), color: i ? 'rgba(255,255,255,0.7)' : '#FFFFFF', maxWidth: Math.max(160, seg) });
      lx += seg;
    });
    ctx.restore();
    return { bottom: y + h };
  };

  // ===================================================================================== creator formats

  // A framed picture over the top of the frame that swaps on every item of a spoken list ("posters,
  // mascots, billboards..."). items: [{ at, image?, video?, draw?(ctx, x, y, w, h, t) }]; the newest
  // started item shows. image/video come from M.image / M.video.
  //   B.photoPanel(ctx, t, { items: [{ at: 0.4, image: M.image('a.jpg') }, { at: 1.1, image: M.image('b.jpg') }] })
  B.photoPanel = (ctx, t, { items = [], x = 90, y = 240, w = 900, h = 860, border = 14, until = Infinity, pop = true } = {}) => {
    if (t >= until) return { bottom: y };
    let cur = -1;
    items.forEach((it, i) => { if (t >= (it.at ?? 0)) cur = i; });
    if (cur < 0) return { bottom: y };
    const it = items[cur], k = pop && (it.at ?? 0) > 0 ? ease.outCubic(appear(t, it.at, 0.14)) : 1;
    ctx.save();
    around(ctx, x + w / 2, y + h / 2, 0.96 + 0.04 * k);
    shadow(ctx, 36, 14, 0.35);
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x - border, y - border, w + 2 * border, h + 2 * border);
    noShadow(ctx);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = '#1A1C22'; ctx.fillRect(x, y, w, h);
    if (it.video) it.video.draw(ctx, t, x, y, w, h);
    else if (it.image && it.image.width) M.cover(ctx, it.image, x, y, w, h, { zoom: 1.02 + 0.03 * clamp((t - (it.at ?? 0)) / 2) });
    else if (it.draw) it.draw(ctx, x, y, w, h, t);
    ctx.restore();
    ctx.restore();
    return { bottom: y + h + border, index: cur };
  };

  // Meme card: a white band across the top with black bold text, footage below it. Returns the band's
  // bottom so you can draw the footage from there.
  //   const top = B.memeCard(ctx, t, { text: 'Me pitching a stunt to a CMO who wants a product photo' }).bottom;
  B.memeCard = (ctx, t, { at = 0, until = Infinity, text = '', y = 220, w = 1080, size = 52, pad = 44, bg = '#FFFFFF', color = '#0E0E10' } = {}) => {
    if (t < at || t >= until) return { bottom: y };
    const f = font(800, size, F.display), lh = size * 1.2;
    const ls = lines(ctx, text, w - pad * 2, f), h = ls.length * lh + pad * 1.6;
    ctx.save();
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, y + h);
    ls.forEach((l, i) => M.text(ctx, l, pad, y + pad * 0.8 + size * 0.95 + i * lh, { font: f, color }));
    ctx.restore();
    return { bottom: y + h };
  };

  // ===================================================================================== backgrounds for green screen

  // A social post (generic: no platform logos). Use as the "screenshot" a creator reacts to.
  //   B.postCard(ctx, t, { name: 'Dana Ruiz', handle: '@danaruiz', text: 'Unpopular opinion: ...', likes: '12.4K' })
  B.postCard = (ctx, t, { at = 0, until = Infinity, name = 'Someone', handle = '@someone', text = '', image = null, likes = '', comments = '', reposts = '', x = 70, y = 260, w = 940, light = true, avatarColor = '#7C8BA1' } = {}) => {
    const a = Math.min(appear(t, at, 0.2), clamp((until - t) / 0.2));
    if (a <= 0) return { bottom: y };
    const tl = balanced(ctx, text, w - 96, font(600, 44)), lh = 58;
    const imgH = image ? Math.round((w - 96) * 0.56) : 0;
    const h = 150 + tl.length * lh + (imgH ? imgH + 30 : 0) + (likes || comments || reposts ? 90 : 30);
    const k = at <= 0 ? 1 : ease.outCubic(appear(t, at, 0.45));
    const ink = light ? '#0F1419' : '#E7E9EA', mut = light ? '#536471' : '#71767B';
    ctx.save();
    ctx.globalAlpha *= a; ctx.translate(0, (1 - k) * 60);
    shadow(ctx, 50, 18, 0.35);
    ctx.fillStyle = light ? '#FFFFFF' : '#16181C'; M.roundRect(ctx, x, y, w, h, 32); ctx.fill();
    noShadow(ctx);
    avatar(ctx, x + 84, y + 84, 40, name, avatarColor);
    M.text(ctx, name, x + 144, y + 76, { font: font(800, 40), color: ink });
    M.text(ctx, handle, x + 144, y + 122, { font: font(600, 34), color: mut });
    tl.forEach((l, i) => M.text(ctx, l, x + 48, y + 196 + i * lh, { font: font(600, 44), color: ink }));
    let cy = y + 160 + tl.length * lh;
    if (image) { ctx.save(); M.roundRect(ctx, x + 48, cy + 10, w - 96, imgH, 24); ctx.clip(); M.cover(ctx, image, x + 48, cy + 10, w - 96, imgH, { dim: 0 }); ctx.restore(); cy += imgH + 30; }
    if (likes || comments || reposts) {
      const items = [comments && `💬 ${comments}`, reposts && `🔁 ${reposts}`, likes && `❤ ${likes}`].filter(Boolean);
      items.forEach((it, i) => M.text(ctx, it.replace(/^\S+ /, ''), x + 110 + i * 250, cy + 54, { font: font(700, 34), color: mut }));
      items.forEach((it, i) => { const img = B.emoji(it.split(' ')[0] === '❤' ? '❤️' : it.split(' ')[0]); if (img && img.width) ctx.drawImage(img, x + 56 + i * 250, cy + 22, 42, 42); });
    }
    ctx.restore();
    return { bottom: y + h };
  };

  // A browser window showing a page (pass an image, or draw it yourself with drawPage).
  B.browser = (ctx, t, { at = 0, until = Infinity, url = B.brand.url, image = null, drawPage = null, x = 40, y = 220, w = 1000, h = 1200, scroll = 0 } = {}) => {
    const a = Math.min(appear(t, at, 0.2), clamp((until - t) / 0.2));
    if (a <= 0) return { bottom: y };
    const k = at <= 0 ? 1 : ease.outCubic(appear(t, at, 0.5));
    ctx.save();
    ctx.globalAlpha *= a; ctx.translate(0, (1 - k) * 80);
    shadow(ctx, 60, 24, 0.45);
    ctx.fillStyle = '#E8EAED'; M.roundRect(ctx, x, y, w, h, 28); ctx.fill();
    noShadow(ctx);
    ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => { ctx.beginPath(); ctx.arc(x + 40 + i * 34, y + 40, 11, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); });
    ctx.fillStyle = '#FFFFFF'; M.roundRect(ctx, x + 150, y + 18, w - 190, 46, 23); ctx.fill();
    M.text(ctx, url, x + 180, y + 52, { font: font(600, 28), color: '#5F6368' });
    const px = x + 8, py = y + 84, pw = w - 16, ph = h - 92;
    ctx.save(); M.roundRect(ctx, px, py, pw, ph, 20); ctx.clip();
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(px, py, pw, ph);
    if (image && image.width) { const s = pw / image.width; ctx.drawImage(image, px, py - scroll, pw, image.height * s); }
    if (drawPage) drawPage(ctx, px, py - scroll, pw, ph);
    ctx.restore();
    ctx.restore();
    return { bottom: y + h, page: { x: px, y: py, w: pw, h: ph } };
  };

  // ===================================================================================== emoji

  // Emoji as images (Twemoji, bundled in assets/emoji: see its LICENSE.md). Canvas fonts here have
  // no colour emoji, so use these instead of typing emoji into text.
  const emojiCache = {};
  B.emojiCode = (ch) => [...String(ch)].map((c) => c.codePointAt(0).toString(16)).filter((c) => c !== 'fe0f').join('-');
  const warned = new Set();
  B.emoji = (ch) => {
    const c = B.emojiCode(ch);
    if (emojiCache[c]) return emojiCache[c];
    if (B.EMOJI_CODES && !B.EMOJI_CODES.has(c)) {             // not bundled: skip it rather than fail the render
      if (!warned.has(c)) { warned.add(c); console.warn(`[emoji] ${ch} (${c}) isn't in assets/emoji; add ${c}.svg from Twemoji to use it`); }
      return null;
    }
    return (emojiCache[c] = M.image(`${B.root}assets/emoji/${c}.svg`));
  };
  window.__emojiImg = (ch) => emojiCache[B.emojiCode(ch)];
  // The bundled set, preloaded so every frame (including the first) has them. Add an SVG named by its
  // code points (e.g. 1f525.svg) to assets/emoji and to this list to use another emoji.
  B.EMOJI = '🆕 🌟 🎁 🎉 🎯 🎵 🏆 🏠 👀 👆 👇 👉 👍 👎 👏 👑 💀 💄 💡 💥 💪 💬 💯 💰 💳 💸 💻 📈 📉 📍 📞 📦 📱 📸 🔊 🔔 🔥 😂 😍 😎 😤 😭 😮 😱 😳 🙄 🙌 🙏 🚀 🚗 🛍 🛒 🤌 🤑 🤔 🤝 🤯 🥰 🥹 🧠 🧴 🧾 🫣 🫶 ‼ ⏰ ☕ ⚠ ⚡ ✅ ✨ ❌ ❤ ➡ ⬇ ⭐'.split(' ');
  B.EMOJI.push('🔁');
  B.EMOJI.push(...'📄 🔍 📝 💼 🗓️ 🍕 🍔 🎧 👗 👟 🧘 💅 🧼 🧹 🔧 🛠️ 🚚 📣 🤩 😅 🥳 🙈 😬 🫡 💔 🤷 🙋 👋 ✋ ✌️ 🍷 🌱 🐶 ☀️ 🌙 💎 🏡 🔑 💤 🎬'.split(' '));
  B.EMOJI_CODES = new Set(B.EMOJI.map(B.emojiCode));
  B.EMOJI.forEach((ch) => B.emoji(ch));

  // A sticker that pops on with overshoot and a gentle wobble.
  //   B.sticker(ctx, t, { emoji: '🔥', at: 1.2, x: 860, y: 420, size: 150 })
  B.sticker = (ctx, t, { emoji = '🔥', at = 0, until = Infinity, x = 540, y = 600, size = 140, rotate = -0.12, wobble = 1 } = {}) => {
    const img = B.emoji(emoji);
    const a = Math.min(appear(t, at, 0.08), clamp((until - t) / 0.15));
    if (a <= 0 || !img || !img.width) return;
    const k = at <= 0 ? 1 : ease.outBack(appear(t, at, 0.4));
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(x, y);
    ctx.rotate(rotate + wobble * 0.08 * Math.sin((t - at) * 3.2));
    ctx.scale(k, k);
    shadow(ctx, 24, 10, 0.35);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  };

  // A burst of emoji floating up (reactions), e.g. on a payoff.
  B.emojiBurst = (ctx, t, { emoji = ['🔥', '😍', '💯'], at = 0, x = 540, y = 1300, count = 14, size = 90, seed = 9, dur = 2.2, height = 900, spread = 520 } = {}) => {
    const list = Array.isArray(emoji) ? emoji : [emoji];
    const p = (t - at) / dur;
    if (p <= 0 || p >= 1.4) return;
    let r = seed;
    const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < count; i++) {
      const delay = rnd() * 0.35, q = clamp((p - delay) / 0.75);
      if (q <= 0 || q >= 1) { rnd(); rnd(); rnd(); continue; }
      const img = B.emoji(list[i % list.length]);
      const dx = (rnd() - 0.5) * spread, rise = height * (0.55 + rnd() * 0.45), s = size * (0.6 + rnd() * 0.7);
      if (!img || !img.width) continue;
      ctx.save();
      ctx.globalAlpha *= Math.min(1, q * 5) * (1 - Math.pow(q, 3));
      ctx.translate(x + dx * ease.outCubic(q) + Math.sin(q * 9 + i) * 30, y - rise * ease.outCubic(q));
      ctx.rotate(Math.sin(q * 6 + i) * 0.3);
      ctx.drawImage(img, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
  };

  window.B = B;
})();
