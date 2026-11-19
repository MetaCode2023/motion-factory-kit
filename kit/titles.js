// titles.js: title cards in the kit's own look: an opening title, a chapter card and a long-form end card.
// Load after motion.js and fx.js (lf.js too, if you want the kit's named curves):
//   <script src="../../kit/titles.js"></script>
//
// Each one is a function of time that draws the FOREGROUND only (type, a rule, a pill); the scene paints the
// ground first (LF.backdrop) and the vignette after. They work at any frame size: the content box is
// M.safe (set by M.setup's preset), type is fitted into it, and long strings are shortened with an ellipsis
// rather than run past the box. `th` is an LF.theme()-shaped theme; TT.themeFromBrand() builds one from brand.js.
//   TT.opening(ctx, t, { kicker, title, sub, at }, th)
//   TT.chapter(ctx, t, { n, title, at }, th)
//   TT.endCard(ctx, t, { title, cta, url, at }, th)       the right half stays clear for YouTube end screens
// Rules kept (design/MOTION-RULES.md): one thing moves at a time, in order; type arrives on the "enter"
// curve and never scales, glows or bounces after it lands; the last frame holds clean. Written from this
// repo's own code and first principles: no code, presets or templates from any other product. See docs/TITLES.md.
(function () {
  const { M, FX } = window;
  if (!M || !FX) throw new Error('load kit/motion.js and kit/fx.js before kit/titles.js');
  const TT = {};
  const enter = (k) => (window.LF ? window.LF.E.enter : M.ease.outExpo)(M.clamp(k));

  const geo = () => { const s = M.safe, bw = s.right - s.left, u = Math.min(1, bw / 1200); return { s, bw, u, x: s.left + Math.round(56 * u), cy: (s.top + s.bottom) / 2 }; };
  const fam = (th) => ({ d: (th.fonts && th.fonts.display) || '"Plus Jakarta Sans"', m: (th.fonts && th.fonts.mono) || '"JetBrains Mono"' });
  const clip = (str, n) => { str = String(str ?? ''); return str.length > n ? str.slice(0, n - 1).trimEnd() + '…' : str; };

  // The largest type that sets `str` in at most o.lines lines of o.width; shortens the string until it does.
  const fitText = (c, str, o) => {
    const base = String(str);
    for (let n = base.length; ; n = Math.floor(n * 0.85)) {
      const s = clip(base, n + 1), r = M.fitFont(c, s, o);
      c.save(); c.font = r.font;
      const ok = r.lines.length <= o.lines && r.lines.every((l) => c.measureText(l).width <= o.width);
      c.restore();
      if (ok || n <= 2) return { ...r, str: s };
    }
  };
  // One line at `size`, shrunk to fit `width`.
  const oneLine = (c, str, weight, size, family, width) => {
    c.save(); c.font = `${weight} ${size}px ${family}`;
    const w = c.measureText(str).width; c.restore();
    return `${weight} ${w > width ? Math.floor(size * width / w) : size}px ${family}`;
  };
  const sum = (parts) => parts.reduce((h, p) => h + p, 0);

  // A vertical accent rule that grows down the left edge of the content box.
  const rule = (c, th, g, top, h, k) => { c.fillStyle = th.color; c.fillRect(g.s.left, top, Math.max(2, Math.round(8 * g.u)), h * enter(k)); };

  TT.opening = (c, t, { kicker = '', title = '', sub = '', at = 0 } = {}, th) => {
    const g = geo(), f = fam(th), w = g.s.right - g.x;
    const T = fitText(c, title, { width: w, max: Math.round(124 * g.u), min: Math.round(52 * g.u), lines: 3, weight: 800, family: f.d });
    const S = sub ? fitText(c, sub, { width: w, max: Math.round(44 * g.u), min: Math.round(30 * g.u), lines: 2, weight: 600, family: f.d }) : null;
    const kStr = clip(String(kicker).toUpperCase(), 60), kSize = Math.round(30 * g.u), kGap = Math.round(28 * g.u), sGap = Math.round(36 * g.u);
    const kH = kStr ? kSize * 1.25 + kGap : 0, tH = T.lines.length * T.size * 1.12, sH = S ? sGap + S.lines.length * S.size * 1.12 : 0;
    const top = g.cy - sum([kH, tH, sH]) / 2;
    rule(c, th, g, top, kH + tH + sH, t - at);
    if (kStr) FX.text(c, t, kStr, g.x, top, { at: at + 0.15, mode: 'mask', font: oneLine(c, kStr, 600, kSize, f.m, w), color: th.color, maxWidth: w });
    FX.text(c, t, T.str, g.x, top + kH, { at: at + 0.3, mode: 'mask', font: T.font, color: th.ink, maxWidth: w, stagger: 0.06 });
    if (S) FX.text(c, t, S.str, g.x, top + kH + tH + sGap, { at: at + 0.9, mode: 'mask', font: S.font, color: th.muted, maxWidth: w });
  };

  TT.chapter = (c, t, { n = '', title = '', at = 0 } = {}, th) => {
    const g = geo(), f = fam(th), num = clip(/^\d+$/.test(String(n)) ? String(n).padStart(2, '0') : n, 4), nSize = Math.round(200 * g.u);
    c.save(); c.font = `800 ${nSize}px ${f.d}`; const nW = c.measureText(num).width; c.restore();
    const tx = g.x + nW + Math.round(90 * g.u), w = g.s.right - tx;
    const T = fitText(c, title, { width: w, max: Math.round(96 * g.u), min: Math.round(48 * g.u), lines: 3, weight: 800, family: f.d });
    const tH = T.lines.length * T.size * 1.12, span = Math.max(nSize * 0.8, tH) * 1.1, lx = g.x + nW + Math.round(40 * g.u);
    c.save(); c.fillStyle = th.color; c.globalAlpha = 0.5;
    c.fillRect(lx, g.cy - span / 2, Math.max(2, Math.round(4 * g.u)), span * enter((t - at - 0.3) / 0.6)); c.restore();
    FX.text(c, t, num, g.x, g.cy - nSize * 0.54, { at: at + 0.1, mode: 'mask', font: `800 ${nSize}px ${f.d}`, color: th.color, maxWidth: nW + 40 });
    FX.text(c, t, T.str, tx, g.cy - tH / 2, { at: at + 0.4, mode: 'mask', font: T.font, color: th.ink, maxWidth: w, stagger: 0.06 });
  };

  // The right half of the content box, where YouTube puts its end-screen video and subscribe elements.
  TT.endScreenZone = () => { const s = M.safe; return { left: (s.left + s.right) / 2, top: s.top, right: s.right, bottom: s.bottom }; };

  TT.endCard = (c, t, { title = '', cta = '', url = '', at = 0 } = {}, th) => {
    const g = geo(), f = fam(th), w = TT.endScreenZone().left - g.x;
    const T = fitText(c, title, { width: w, max: Math.round(100 * g.u), min: Math.round(48 * g.u), lines: 3, weight: 800, family: f.d });
    const cStr = clip(cta, 60), cH = Math.round(84 * g.u), cGap = Math.round(44 * g.u), uStr = clip(url, 48), uSize = Math.round(30 * g.u), uGap = Math.round(36 * g.u);
    const cFont = oneLine(c, cStr, 700, Math.round(36 * g.u), f.d, w - Math.round(72 * g.u));
    c.save(); c.font = cFont; const cW = c.measureText(cStr).width + Math.round(72 * g.u); c.restore();
    const tH = T.lines.length * T.size * 1.12, bH = cStr ? cGap + cH : 0, uH = uStr ? uGap + uSize * 1.25 : 0;
    const top = g.cy - sum([tH, bH, uH]) / 2, k = t - at;
    rule(c, th, g, top, tH + bH + uH, k);
    FX.text(c, t, T.str, g.x, top, { at: at + 0.1, mode: 'mask', font: T.font, color: th.ink, maxWidth: w, stagger: 0.06 });
    if (cStr) {
      const py = top + tH + cGap;
      c.save(); c.beginPath(); c.rect(g.x - 4, py - 4, (cW + 8) * enter((k - 0.7) / 0.5), cH + 8); c.clip();
      M.roundRect(c, g.x, py, cW, cH, cH / 2); c.fillStyle = th.color; c.fill();
      M.text(c, cStr, g.x + cW / 2, py + cH / 2, { font: cFont, color: th.deep, align: 'center', baseline: 'middle' });
      c.restore();
    }
    if (uStr) FX.text(c, t, uStr, g.x, top + tH + bH + uGap, { at: at + 1.1, mode: 'mask', font: oneLine(c, uStr, 600, uSize, f.m, w), color: th.muted, maxWidth: w });
  };

  // An LF.theme()-shaped theme from brand.js, so these cards match the short-form blocks.
  TT.themeFromBrand = () => {
    const b = window.BRAND || {}, col = b.colors || {}, fn = b.fonts || {};
    return { style: 'brand', light: false, color: col.accent || '#FC5C2B', tint: col.surface || '#161A22', deep: col.bg || '#0B0D12', ink: col.ink || '#F5F7FA',
      muted: col.muted || '#8A93A6', good: col.good || '#3DDC97', bad: col.bad || '#FF4D5E', warm: col.accent || '#FC5C2B',
      fonts: { display: fn.display || '"Plus Jakarta Sans"', mono: fn.mono || '"JetBrains Mono"' } };
  };

  window.TT = TT;
})();
