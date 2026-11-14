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

  // ---- word timing ----------------------------------------------------------------------------------
  // D.words = [{ w, t }]: what the speaker says while this animation is on screen (t = seconds from its
  // start; the build fills it in). Without it (preview, tests) everything falls back to an even spread.
  const STOP = new Set('the a an and or but so to of in on at for with is it its this that these those be was were are you your they their we our he she his her i my me not no do does did just like then than as from by into out up about there here what when how why who all any some one very really can will would'.split(' '));
  const bare = (w) => String(w).toLowerCase().replace(/[^a-z0-9$%]/g, '');
  const keys = (text) => String(text).toLowerCase().split(/[^a-z0-9$%]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const hit = (spoken, key) => { const a = bare(spoken); return a && (a === key || (key.length > 4 && a.startsWith(key.slice(0, Math.max(5, key.length - 2)))) || (a.length > 4 && key.startsWith(a.slice(0, Math.max(5, a.length - 2))))); };

  // The time the speaker says (one of the content words of) `text`, after `after`; null if they don't.
  LF.when = (D, text, after = 0) => {
    const ks = Array.isArray(text) ? text.flatMap(keys) : keys(text);
    if (!ks.length) return null;
    for (const w of D.words || []) if (w.t >= after - 0.01 && ks.some((k) => hit(w.w, k))) return w.t;
    return null;
  };

  // One time per item, in order: each on its spoken word when it is said, the rest spread between the
  // known ones. Times stay inside [start, end] and at least `gap` apart.
  LF.schedule = (D, items, { start = 0.6, end = null, gap = 0.35, lead = 0.1 } = {}) => {
    const n = items.length, hi = end ?? Math.max(start + 0.5, (D.dur || 6) - 1.2);
    const found = [];
    let after = start - lead;
    for (const it of items) { const t = it == null ? null : LF.when(D, it, after); found.push(t == null ? null : Math.max(start, t - lead)); if (t != null) after = t + 0.05; }
    const out = found.slice();
    for (let i = 0; i < n; i++) if (out[i] == null) {
      let a = i - 1; while (a >= 0 && out[a] == null) a--;
      let b = i + 1; while (b < n && found[b] == null) b++;
      const ta = a >= 0 ? out[a] : start - (hi - start) / Math.max(1, n), tb = b < n ? found[b] : hi + (hi - start) / Math.max(1, n);
      out[i] = ta + ((tb - ta) * (i - a)) / (b - a);
    }
    for (let i = 0; i < n; i++) out[i] = Math.min(hi, Math.max(start + i * 0.05, out[i], i ? out[i - 1] + gap : start));
    return out.map((t) => +t.toFixed(3));
  };

  // ---- never freeze ---------------------------------------------------------------------------------
  // A slow push-in across the whole insert plus a gentle drift: after the last reveal the frame still moves.
  LF.drift = (c, t, D, { zoom = 0.05, x = 18, y = 10 } = {}) => {
    const k = M.ease.inOutCubic(M.clamp(t / (D.dur || 6)));
    return FX.camera(c, t, { zoom: 1 + zoom * k, x: x * Math.sin(t * 0.35), y: y * Math.cos(t * 0.28) });
  };
  LF.pulse = (t, speed = 2, phase = 0) => 0.5 + 0.5 * Math.sin(t * speed + phase);

  window.LF = LF;
})();
