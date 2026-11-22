// Talking-head effects. Load after motion.js. Every pose is a function of scene time.
(() => {
  const M = window.M;

  function orbit(ctx, t, { x, y, rx, ry, items, period = 5 }, drawItem) {
    const pieces = items.map((item, index) => {
      const angle = 2 * Math.PI * (t / period + index / items.length);
      return { item, x: x + rx * Math.cos(angle), y: y + ry * Math.sin(angle), depth: Math.sin(angle) };
    }).sort((a, b) => a.depth - b.depth);
    for (const piece of pieces) {
      ctx.save();
      try {
        ctx.translate(piece.x, piece.y);
        const scale = 0.85 + 0.15 * piece.depth;
        ctx.scale(scale, scale);
        drawItem(ctx, piece.item, piece.depth);
      } finally { ctx.restore(); }
    }
  }

  // Paint the frame background inside the mask, then use a keyed or transparent subject outside it.
  function frameEscape(ctx, { x, y, width, height, radius = 12, border = '#fff' }, drawInside, drawSubject) {
    ctx.save();
    try {
      ctx.save();
      try {
        M.roundRect(ctx, x, y, width, height, radius);
        ctx.clip();
        drawInside(ctx);
      } finally { ctx.restore(); }
      M.roundRect(ctx, x, y, width, height, radius);
      ctx.strokeStyle = border;
      ctx.lineWidth = 4;
      ctx.stroke();
      drawSubject(ctx);
    } finally { ctx.restore(); }
  }

  function headlines(ctx, t, { x, y, width, items, rowHeight = 48, color = '#e8fcf7', ink = '#122924' }) {
    items.forEach(({ at, text }, index) => {
      if (t < at) return;
      const p = M.prog(t, at, 0.28, M.ease.outCubic);
      ctx.save();
      ctx.globalAlpha *= p;
      ctx.translate((1 - p) * (index % 2 ? -36 : 36), 0);
      ctx.fillStyle = color;
      M.roundRect(ctx, x, y + index * rowHeight, width, rowHeight - 6, 8);
      ctx.fill();
      ctx.font = 'bold ' + Math.round(rowHeight * 0.43) + 'px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = ink;
      ctx.fillText(text, x + 12, y + index * rowHeight + (rowHeight - 6) / 2, width - 24);
      ctx.restore();
    });
  }

  // Plot normalized points while revealing a series from left to right.
  function growthCurve(ctx, progress, { x, y, width, height, values, color = '#64e1bf' }) {
    if (values.length < 2) return;
    const last = values.length - 1;
    const extent = M.clamp(progress) * last;
    const step = width / last;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y + height * (1 - values[0]));
    for (let i = 1; i <= Math.ceil(extent); i++) {
      const part = Math.min(1, extent - i + 1);
      const value = M.lerp(values[i - 1], values[i], part);
      ctx.lineTo(x + (i - 1 + part) * step, y + height * (1 - value));
    }
    ctx.stroke();
    ctx.restore();
  }

  function cameraHud(ctx, { x, y, width, height, zoom = 1, color = '#fff' }) {
    const corner = Math.min(width, height) * 0.09;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const sx of [0, 1]) for (const sy of [0, 1]) {
      const cx = x + sx * width, cy = y + sy * height;
      ctx.moveTo(cx + (sx ? -corner : corner), cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + (sy ? -corner : corner));
    }
    ctx.stroke();
    M.text(ctx, zoom.toFixed(1) + '×', x + width / 2, y + 28, {
      font: '600 16px monospace', color, align: 'center',
    });
    ctx.restore();
  }

  window.ReelFX = { orbit, frameEscape, headlines, growthCurve, cameraHud };
})();
