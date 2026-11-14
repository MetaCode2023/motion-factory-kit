// scenes/longform/lf.js: shared look for the 16:9 animation templates (global LF).
// Every template reads its colours from data: color (accent), tint (background), so one plan-level
// "theme" restyles a whole video. Text uses the bundled fonts only.
(function () {
  const LF = {};
  LF.W = 1920; LF.H = 1080;
  LF.F = { display: '"Plus Jakarta Sans"', mono: '"JetBrains Mono"' };
  // Looks: one word in the plan/script ("theme": "blueprint") restyles the whole video: palette and the
  // ground every animation and the voice-only backdrop sit on. color / tint in the theme still override.
  LF.STYLES = {
    aurora:    { color: '#3CE0FF', tint: '#0C1B2A', deep: '#05060A', ink: '#F5F7FA', muted: '#8A93A6' },
    blueprint: { color: '#8FD8FF', tint: '#0E3A66', deep: '#06182E', ink: '#F2F8FF', muted: '#8FB0CC' },
    noir:      { color: '#FFD23D', tint: '#26262B', deep: '#050505', ink: '#FFFFFF', muted: '#9A9AA2' },
    sunset:    { color: '#FF9A4C', tint: '#4A1638', deep: '#12060F', ink: '#FFF6EE', muted: '#C79FA6' },
    paper:     { color: '#E0452B', tint: '#F4EEE2', deep: '#E4DBC9', ink: '#1B1A17', muted: '#6E685C', light: true },
    terminal:  { color: '#3DFF8B', tint: '#06210F', deep: '#020603', ink: '#E6FFE9', muted: '#6FA882' },
  };
  LF.theme = (D) => {
    const style = LF.STYLES[D.style] ? D.style : 'aurora', S = LF.STYLES[style];
    return { style, light: !!S.light, color: D.color || S.color, tint: D.tint || S.tint, deep: S.deep, ink: S.ink, muted: S.muted,
      good: D.good || (S.light ? '#1E9E63' : '#3DDC97'), bad: D.bad || (S.light ? '#D0342C' : '#FF4D5E'), warm: D.warm || (S.light ? '#C98A00' : '#FFC23D') };
  };

  // The ground of a look. `p` is a phase in radians: pass (t / dur) * 2π for a seamless loop.
  LF.ground = (c, p, th) => {
    const W = LF.W, H = LF.H;
    const g = c.createRadialGradient(W * 0.5 + 220 * Math.cos(p), H * 0.55 + 120 * Math.sin(p), 60, W * 0.5, H * 0.55, W * 0.8);
    g.addColorStop(0, th.tint); g.addColorStop(1, th.deep);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.save();
    if (th.style === 'blueprint') {
      // drafting grid: fine and coarse lines, a slow scanning bar
      c.strokeStyle = th.color; c.lineWidth = 1;
      for (let x = 0; x <= W; x += 48) { c.globalAlpha = x % 240 === 0 ? 0.16 : 0.06; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
      for (let y = 0; y <= H; y += 48) { c.globalAlpha = y % 240 === 0 ? 0.16 : 0.06; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      const sx = W * (0.5 + 0.5 * Math.sin(p));
      const sg = c.createLinearGradient(sx - 260, 0, sx + 260, 0);
      sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(0.5, th.color); sg.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalAlpha = 0.07; c.fillStyle = sg; c.fillRect(sx - 260, 0, 520, H);
    } else if (th.style === 'noir') {
      // one hard spotlight that sways, heavy falloff
      const lx = W * (0.5 + 0.12 * Math.sin(p)), sg = c.createRadialGradient(lx, -120, 40, lx, H * 0.5, H * 1.05);
      sg.addColorStop(0, 'rgba(255,255,255,0.20)'); sg.addColorStop(0.55, 'rgba(255,255,255,0.04)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = sg; c.fillRect(0, 0, W, H);
      c.globalAlpha = 0.5; c.fillStyle = th.color; c.fillRect(0, H - 10, W, 10);
    } else if (th.style === 'sunset') {
      // a low sun and drifting horizon bands
      const sy = H * 0.86 + 14 * Math.sin(p), sg = c.createRadialGradient(W * 0.5, sy, 20, W * 0.5, sy, 760);
      sg.addColorStop(0, th.color); sg.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalAlpha = 0.42; c.fillStyle = sg; c.fillRect(0, 0, W, H);
      c.fillStyle = th.deep;
      for (let i = 0; i < 7; i++) { c.globalAlpha = 0.5; const y = H * 0.8 + i * 34 + 6 * Math.sin(p + i); c.fillRect(0, y, W, 5 + i * 3); }
    } else if (th.style === 'paper') {
      // ruled paper: faint lines, a margin rule, soft fibre specks
      c.strokeStyle = th.ink; c.lineWidth = 1; c.globalAlpha = 0.06;
      for (let y = 90; y < H; y += 54) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      c.strokeStyle = th.color; c.globalAlpha = 0.28; c.lineWidth = 2; c.beginPath(); c.moveTo(84, 0); c.lineTo(84, H); c.stroke();
      const r = FX.rng(11); c.fillStyle = th.ink;
      for (let i = 0; i < 160; i++) { c.globalAlpha = 0.03 + 0.03 * r(); c.fillRect(r() * W, r() * H, 1 + r() * 3, 1); }
    } else if (th.style === 'terminal') {
      // scanlines and a column of falling ticks
      c.fillStyle = th.color;
      for (let y = 0; y < H; y += 6) { c.globalAlpha = 0.035; c.fillRect(0, y, W, 2); }
      const r = FX.rng(5);
      for (let i = 0; i < 46; i++) { const x = Math.round(r() * 40) * 48, ph = r() * 6.28, y = ((p + ph) / 6.2832 % 1) * (H + 200) - 100; c.globalAlpha = 0.10 + 0.14 * r(); c.fillRect(x, y, 3, 26 + r() * 60); }
    } else {
      c.globalAlpha = 0.07; c.strokeStyle = th.color; c.lineWidth = 1;
      for (let x = -100; x < W + 100; x += 80) { c.beginPath(); c.moveTo(x + 40 * Math.sin(p), 0); c.lineTo(x - 40 * Math.sin(p), H); c.stroke(); }
    }
    c.restore();
  };

  LF.backdrop = (c, t, th, { particles = true } = {}) => {
    if (th.style && th.style !== 'aurora') {
      LF.ground(c, (t / 12) * Math.PI * 2, th);
      if (particles && !th.light) FX.particles(c, t, { count: 40, opacity: 0.14, color: th.color, size: 1.1 });
      return;
    }
    const g = c.createRadialGradient(LF.W * 0.5, LF.H * 0.55, 60, LF.W * 0.5, LF.H * 0.55, LF.W * 0.8);
    g.addColorStop(0, th.tint); g.addColorStop(1, '#05060A');
    c.fillStyle = g; c.fillRect(0, 0, LF.W, LF.H);
    FX.aurora(c, t, { colors: [th.color, th.tint], intensity: 0.18, base: 'rgba(0,0,0,0)' });
    if (particles) FX.particles(c, t, { count: 60, opacity: 0.18, color: th.color, size: 1.1 });
  };

  // White-on-dark hairlines and tracks flip to ink on a light look; the vignette backs off.
  LF.w = (th, a) => (th.light ? `rgba(20,18,14,${a})` : `rgba(255,255,255,${a})`);
  LF.vignette = (c, th, strength = 0.45) => { if (!th.light) FX.vignette(c, { strength }); };

  LF.title = (c, t, { kicker, headline, accent }, th, { x = 120, y = 110, width = 1500, at = 0 } = {}) => {
    if (kicker) FX.text(c, t, String(kicker).toUpperCase(), x, y, { at: at + 0.05, mode: 'scramble', font: `600 30px ${LF.F.mono}`, color: th.color, maxWidth: width });
    if (headline) FX.text(c, t, headline, x, y + 52, { at: at + 0.25, mode: 'rise', font: `800 76px ${LF.F.display}`, color: th.ink, accent: accent || '', accentColor: th.color, maxWidth: width, stagger: 0.05 });
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
    if (th.light) { c.save(); c.shadowColor = 'rgba(40,30,10,0.18)'; c.shadowBlur = 40; c.shadowOffsetY = 12; c.fillStyle = '#FFFDF8'; M.roundRect(c, x, y, w, h, 32); c.fill(); c.shadowColor = 'transparent'; c.strokeStyle = FX.alpha(th.color, 0.35 + 0.4 * glow); c.lineWidth = 2; c.stroke(); c.restore(); return; }
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
  LF.schedule = (D, items, { start = 0.6, end = null, gap = 0.35, lead = 0.1, open: _o } = {}) => {
    const n = items.length, hi = end ?? Math.max(start + 0.5, (D.dur || 6) - 1.2);
    // Each item's word, searched from the start (not after the previous item, so one late match can't
    // push everything after it off the end). Matches that would break the order are dropped, and the
    // first item never waits more than `open` seconds: an animation opens on something, not an empty frame.
    let found = items.map((it) => { const t = it == null ? null : LF.when(D, it, start - lead); return t == null ? null : Math.max(start, t - lead); });
    let last = -Infinity;
    found = found.map((t) => { if (t == null || t <= last) return null; last = t; return t; });
    const open = start + 0.8;
    if (found[0] == null || found[0] > open) found[0] = start;
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
