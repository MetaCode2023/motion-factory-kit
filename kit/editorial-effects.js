// Frame-driven techniques for editorial reels. Load after motion.js.
(() => {
  const M = window.M;

  function cursor(ctx, t, { from, to, at = 0, duration = 0.55, color = '#f7fff8' }) {
    const p = M.prog(t, at, duration);
    ctx.save();
    ctx.translate(M.lerp(from.x, to.x, p), M.lerp(from.y, to.y, p));
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(20, 14); ctx.lineTo(11, 15);
    ctx.lineTo(8, 23); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#163032'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }

  function stagger(ctx, t, items, { at = 0, step = 0.1, duration = 0.35 }, draw) {
    items.forEach((item, index) => {
      if (t < at + index * step) return;
      const p = M.prog(t, at + index * step, duration);
      ctx.save();
      try { draw(ctx, item, index, p); } finally { ctx.restore(); }
    });
  }

  function dial(ctx, { x, y, radius, progress, ticks = 24, color = '#b9f3d7' }) {
    const p = M.clamp(progress);
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    for (let i = 0; i < ticks; i++) {
      const a = i / ticks * Math.PI * 2 - Math.PI / 2;
      const inner = radius - (i % 4 === 0 ? 13 : 6);
      ctx.globalAlpha = i / ticks <= p ? 0.95 : 0.24;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.rotate(p * Math.PI * 2);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -0.72 * radius);
    ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
  }

  // Each layer supplies a depth from 0 (foreground) to 1 (background).
  function focusLayers(ctx, layers, { focus, blur = 15, spread = 0, zoom = 1, x, y }) {
    for (const { depth, draw, dx = 0, dy = 0 } of layers) {
      const scale = zoom + (1 - depth) * spread;
      ctx.save();
      try {
        ctx.translate(x + dx, y + dy);
        ctx.scale(scale, scale);
        ctx.translate(-x, -y);
        ctx.filter = `blur(${Math.abs(depth - focus) * blur}px)`;
        draw(ctx);
      } finally { ctx.restore(); }
    }
  }

  // Reveal the next shot behind a ragged edge. The jitter is stable at any timestamp.
  function paperTear(ctx, progress, { x, y, width, height, color = '#e9dcc0' }, draw) {
    const p = M.clamp(progress);
    if (p === 0) return;
    if (p === 1) { draw(ctx); return; }
    const edge = x - 20 + (width + 40) * p;
    const ridge = Array.from({ length: 25 }, (_, i) => [edge + Math.sin(i * 6.7) * 10, y + i * height / 24]);
    ctx.save();
    try {
      ctx.beginPath(); ctx.moveTo(x, y);
      for (const [px, py] of ridge) ctx.lineTo(px, py);
      ctx.lineTo(x, y + height);ctx.closePath();ctx.clip();
      draw(ctx);
    } finally { ctx.restore(); }
    ctx.save();
    ctx.beginPath();
    ridge.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
    ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.stroke();
    ctx.restore();
  }

  window.EditorialFX = { cursor, stagger, dial, focusLayers, paperTear };
})();
