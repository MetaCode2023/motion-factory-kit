// scenes/longform/lf.js: shared look for the 16:9 animation templates (global LF).
// Every template reads its colours from data: color (accent), tint (background), so one plan-level
// "theme" restyles a whole video. Text uses the bundled fonts only.
(function () {
  const LF = {};
  LF.W = 1920; LF.H = 1080;
  LF.F = { display: '"Plus Jakarta Sans"', mono: '"JetBrains Mono"' };
  LF.theme = (D) => ({ color: D.color || '#3CE0FF', tint: D.tint || '#0C1B2A', ink: '#F5F7FA', muted: '#8A93A6', good: D.good || '#3DDC97', bad: D.bad || '#FF4D5E', warm: D.warm || '#FFC23D' });

  LF.backdrop = (c, t, th, { particles = true } = {}) => {
    const g = c.createRadialGradient(LF.W * 0.5, LF.H * 0.55, 60, LF.W * 0.5, LF.H * 0.55, LF.W * 0.8);
    g.addColorStop(0, th.tint); g.addColorStop(1, '#05060A');
    c.fillStyle = g; c.fillRect(0, 0, LF.W, LF.H);
    FX.aurora(c, t, { colors: [th.color, th.tint], intensity: 0.18, base: 'rgba(0,0,0,0)' });
    if (particles) FX.particles(c, t, { count: 60, opacity: 0.18, color: th.color, size: 1.1 });
  };

  LF.title = (c, t, { kicker, headline, accent }, th, { x = 120, y = 110, width = 1500, at = 0 } = {}) => {
    if (kicker) FX.text(c, t, String(kicker).toUpperCase(), x, y, { at: at + 0.05, mode: 'scramble', font: `600 30px ${LF.F.mono}`, color: th.color, maxWidth: width });
    if (headline) FX.text(c, t, headline, x, y + 52, { at: at + 0.25, mode: 'rise', font: `800 76px ${LF.F.display}`, accent: accent || '', accentColor: th.color, maxWidth: width, stagger: 0.05 });
  };

  // "1,326" / "$4.2T" / "38%" -> { pre, num, post, decimals } so the number can count up.
  LF.parseNumber = (s) => {
    const m = String(s).match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
    if (!m) return null;
    const raw = m[2].replace(/,/g, ''), dec = (raw.split('.')[1] || '').length;
    return { pre: m[1], num: parseFloat(raw), post: m[3], decimals: dec, commas: m[2].includes(',') };
  };
  LF.formatNumber = (p, v) => {
    let s = v.toFixed(p.decimals);
    if (p.commas) { const [a, b] = s.split('.'); s = a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b ? '.' + b : ''); }
    return p.pre + s + p.post;
  };

  LF.card = (c, x, y, w, h, th, { glow = 0 } = {}) => {
    FX.glass(c, x, y, w, h, { radius: 32, tint: FX.alpha(th.color, 0.05), border: FX.alpha(th.color, 0.3 + 0.4 * glow) });
  };

  // Wrapped text, left/centre aligned; returns the y below the last line.
  LF.para = (c, str, x, y, { font, color, width = 900, lh = 1.25, align = 'left', alpha = 1 }) => {
    c.save(); c.font = font; c.fillStyle = color; c.globalAlpha *= alpha; c.textAlign = align; c.textBaseline = 'alphabetic';
    const size = parseFloat(font.match(/([\d.]+)px/)[1]);
    const lines = M.wrap(c, String(str), width);
    lines.forEach((l, i) => c.fillText(l, x, y + size + i * size * lh));
    c.restore();
    return y + size + (lines.length - 1) * size * lh + size * 0.35;
  };

  window.LF = LF;
})();
