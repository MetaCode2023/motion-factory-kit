// Load after motion.js and the local Matter.js build. Bake once, sample at any time.
(() => {
  function bakePhysics(engine, bodies, { duration, hz = 120 } = {}) {
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(hz) || hz <= 0) {
      throw new RangeError('Expected a positive duration and integer simulation frequency');
    }
    const steps = Math.ceil(duration * hz);
    const frames = [];
    for (let step = 0; step <= steps; step++) {
      frames.push(bodies.map(({ position, angle }) => ({ x: position.x, y: position.y, angle })));
      if (step < steps) Matter.Engine.update(engine, 1000 / hz);
    }
    return (t) => {
      const frame = Math.max(0, Math.min(duration, t)) * hz;
      const index = Math.floor(frame);
      const blend = frame - index;
      const next = frames[Math.min(index + 1, steps)];
      return frames[index].map(({ x, y, angle }, body) => ({
        x: M.lerp(x, next[body].x, blend),
        y: M.lerp(y, next[body].y, blend),
        angle: M.lerp(angle, next[body].angle, blend),
      }));
    };
  }

  function morphPoints(from, to, progress) {
    if (from.length !== to.length) throw new RangeError('Morph paths need matching point counts');
    return from.map(([x, y], index) => [
      M.lerp(x, to[index][0], progress),
      M.lerp(y, to[index][1], progress),
    ]);
  }

  function drawJoint(ctx, { x = 0, y = 0, angle = 0 }, draw) {
    ctx.save();
    try {
      ctx.translate(x, y);
      ctx.rotate(angle);
      draw(ctx);
    } finally {
      ctx.restore();
    }
  }

  function particleField({ count, width, height, seed = 1, speed = 40 }) {
    let state = seed >>> 0;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const particles = Array.from({ length: count }, () => ({
      x: random() * width,
      y: random() * height,
      radius: 1 + random() * 2,
      velocity: speed * (0.4 + random() * 0.6),
    }));
    return (ctx, t, color) => {
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      for (const { x, y, radius, velocity } of particles) {
        const offset = ((y - velocity * t) % height + height) % height;
        ctx.moveTo(x + radius, offset);
        ctx.arc(x, offset, radius, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();
    };
  }

  window.MotionSimulation = { bakePhysics, morphPoints, drawJoint, particleField };
})();
