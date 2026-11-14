// scenes/longform/poker.js: playing cards, suits, chips and probability shapes for the poker x physics
// animations (all drawn in code; suits are paths, so no font needs the glyphs). Global: P.
(function () {
  const P = {};
  const RED = '#E5484D', INK = '#15161C';

  P.suit = (c, s, x, y, size, color) => {
    const k = size / 100;
    c.save(); c.translate(x, y); c.scale(k, k); c.fillStyle = color || (s === 'h' || s === 'd' ? RED : INK);
    c.beginPath();
    if (s === 'h') {
      c.moveTo(0, 38); c.bezierCurveTo(-60, -5, -48, -55, 0, -28); c.bezierCurveTo(48, -55, 60, -5, 0, 38);
    } else if (s === 'd') {
      c.moveTo(0, -45); c.lineTo(34, 0); c.lineTo(0, 45); c.lineTo(-34, 0); c.closePath();
    } else if (s === 's') {
      c.moveTo(0, -42); c.bezierCurveTo(-60, 2, -48, 48, 0, 20); c.bezierCurveTo(48, 48, 60, 2, 0, -42);
      c.fill(); c.beginPath(); c.moveTo(0, 12); c.lineTo(16, 46); c.lineTo(-16, 46); c.closePath();
    } else {
      for (const [cx, cy] of [[0, -22], [-22, 10], [22, 10]]) { c.moveTo(cx + 19, cy); c.arc(cx, cy, 19, 0, Math.PI * 2); }
      c.fill(); c.beginPath(); c.moveTo(0, 2); c.lineTo(15, 46); c.lineTo(-15, 46); c.closePath();
    }
    c.fill(); c.restore();
  };

  // A card centred on (x, y), width w (height 1.4 w). flip: 0 = back, 1 = face (animates through edge-on).
  P.card = (c, x, y, w, { rank = 'A', suit = 's', flip = 1, alpha = 1, rot = 0, glow = 0, glowColor = '#3CE0FF', back = '#1E3A8A' } = {}) => {
    const h = w * 1.4, sx = Math.abs(Math.cos(Math.PI * (1 - flip))) || 0.001, face = flip >= 0.5;
    c.save(); c.globalAlpha *= alpha; c.translate(x, y); c.rotate(rot); c.scale(sx, 1);
    if (glow > 0) { c.shadowColor = glowColor; c.shadowBlur = 60 * glow; }
    else { c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 24; c.shadowOffsetY = 10; }
    M.roundRect(c, -w / 2, -h / 2, w, h, w * 0.08);
    c.fillStyle = face ? '#F7F5EF' : back; c.fill();
    c.shadowColor = 'transparent';
    if (face) {
      const col = suit === 'h' || suit === 'd' ? RED : INK;
      c.fillStyle = col; c.font = `800 ${Math.round(w * 0.3)}px "Plus Jakarta Sans"`; c.textBaseline = 'alphabetic';
      c.fillText(rank, -w / 2 + w * 0.09, -h / 2 + w * 0.33);
      P.suit(c, suit, -w / 2 + w * 0.2, -h / 2 + w * 0.5, w * 0.2, col);
      P.suit(c, suit, 0, h * 0.06, w * 0.62, col);
    } else {
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = w * 0.025;
      M.roundRect(c, -w / 2 + w * 0.08, -h / 2 + w * 0.08, w * 0.84, h - w * 0.16, w * 0.05); c.stroke();
      c.save(); c.clip();
      c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = w * 0.02;
      for (let i = -10; i < 10; i++) { c.beginPath(); c.moveTo(i * w * 0.14, -h); c.lineTo(i * w * 0.14 + h, h); c.stroke(); c.beginPath(); c.moveTo(i * w * 0.14, h); c.lineTo(i * w * 0.14 + h, -h); c.stroke(); }
      c.restore();
    }
    c.restore();
  };

  // A stack of chips (count high), colour, centred at the bottom (x, y).
  P.chips = (c, x, y, r, count, color = '#E5484D') => {
    for (let i = 0; i < count; i++) {
      const cy = y - i * r * 0.28;
      c.save(); c.beginPath(); c.ellipse(x, cy, r, r * 0.38, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
      c.lineWidth = r * 0.12; c.setLineDash([r * 0.32, r * 0.32]); c.strokeStyle = '#fff'; c.stroke(); c.setLineDash([]);
      c.beginPath(); c.ellipse(x, cy, r * 0.6, r * 0.22, 0, 0, Math.PI * 2); c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 2; c.stroke(); c.restore();
    }
  };

  // Deep table backdrop: dark felt, soft spotlight, drifting dust.
  P.backdrop = (c, t, W, H, { tint = '#0E3B2E', accent = '#3CE0FF' } = {}) => {
    const g = c.createRadialGradient(W * 0.45, H * 0.55, 50, W * 0.45, H * 0.55, W * 0.75);
    g.addColorStop(0, tint); g.addColorStop(1, '#05060A');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    FX.particles(c, t, { count: 70, opacity: 0.22, color: accent, size: 1.1 });
  };

  // A probability cloud: seeded gaussian dots that shimmer.
  P.cloud = (c, t, cx, cy, rx, ry, { n = 260, color = '#3CE0FF', alpha = 1, seed = 4, collapse = 0, tx = cx, ty = cy } = {}) => {
    const r = FX.rng(seed);
    c.save();
    for (let i = 0; i < n; i++) {
      const u = r(), v = r(), g = Math.sqrt(-2 * Math.log(u + 1e-6)) * Math.cos(2 * Math.PI * v), g2 = Math.sqrt(-2 * Math.log(u + 1e-6)) * Math.sin(2 * Math.PI * v);
      const ph = r() * 6.28, sp = 0.6 + r();
      let x = cx + g * rx * 0.45 + Math.sin(t * sp + ph) * 8, y = cy + g2 * ry * 0.45 + Math.cos(t * sp * 0.8 + ph) * 8;
      x += (tx - x) * collapse; y += (ty - y) * collapse;
      c.globalAlpha = alpha * (0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3 * sp + ph)));
      c.fillStyle = color; c.beginPath(); c.arc(x, y, 1.6 + 2.2 * r(), 0, Math.PI * 2); c.fill();
    }
    c.restore();
  };

  // Left-aligned kicker + headline block (used by every scene).
  P.title = (c, t, { kicker, headline, accent, x = 120, y = 110, color = '#3CE0FF', width = 900 }) => {
    if (kicker) FX.text(c, t, kicker, x, y, { at: 0.05, mode: 'scramble', font: '600 30px "JetBrains Mono"', color, maxWidth: 900 });
    if (headline) FX.text(c, t, headline, x, y + 52, { at: 0.25, mode: 'rise', font: '800 76px "Plus Jakarta Sans"', accent: accent || '', accentColor: color, maxWidth: width, stagger: 0.05 });
  };

  window.P = P;
})();
