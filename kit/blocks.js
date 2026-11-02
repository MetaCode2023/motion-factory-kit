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
  // 'outline' = white text with a dark stroke, 'plain' = brand text. x is the centre.
  //   B.nativeText(ctx, t, { at: 0, text: 'POV: you found the fix', y: 330 })
  B.nativeText = (ctx, t, { at = 0, until = Infinity, text, x = 540, y = 320, size = 64, w = 860, style = 'box', bg = '#FFFFFF', color, weight = 800 } = {}) => {
    const a = Math.min(appear(t, at, 0.12), clamp((until - t) / 0.12));
    if (a <= 0) return { bottom: y };
    const f = font(weight, size, F.display);
    const ls = balanced(ctx, text, w, f), lh = size * 1.22;
    const k = at <= 0 ? 1 : ease.outBack(appear(t, at, 0.3));
    ctx.save();
    ctx.globalAlpha *= a;
    around(ctx, x, y + (ls.length * lh) / 2, 0.85 + 0.15 * k);
    ctx.font = f; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ls.forEach((l, i) => {
      const cy = y + lh / 2 + i * lh, tw = ctx.measureText(l).width;
      if (style === 'box') {
        ctx.fillStyle = bg; M.roundRect(ctx, x - tw / 2 - size * 0.32, cy - lh / 2 - 2, tw + size * 0.64, lh + 4, size * 0.22); ctx.fill();
        ctx.fillStyle = color || '#111111'; ctx.fillText(l, x, cy + size * 0.04);
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
    const h = 130 + rows * (size * 1.3 + 50) + 20;
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
        const iy = y + 130 + i * (size * 1.3 + 50);
        ctx.save(); ctx.globalAlpha *= ia;
        check(ctx, cx + 56, iy + size * 0.55, size * 0.5, ok, ia);
        M.text(ctx, it, cx + 100, iy + size * 0.75, { font: font(700, size), color: C.ink, maxWidth: cw - 130, lineHeight: size * 1.15 });
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

  window.B = B;
})();
