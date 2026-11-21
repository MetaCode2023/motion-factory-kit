// Load after motion.js and simulation.js. Poses share the same local coordinate space.
(() => {
  const M = window.M;
  const fields = ['lean', 'gaze', 'arm', 'eye', 'nod'];
  const neutral = { lean: 0, gaze: 0, arm: 0, eye: 1, nod: 0 };
  const easing = { linear: M.ease.linear, inOutCubic: M.ease.inOutCubic, outCubic: M.ease.outCubic };

  function poseAt(cues, poses) {
    if (!cues.length) throw new RangeError('Provide at least one pose cue');
    const frames = cues.map(({ at, pose, holdUntil = at, ease = 'inOutCubic' }, i) => {
      if (!Number.isFinite(at) || (i && at <= cues[i - 1].at) || !Object.hasOwn(poses, pose)) {
        throw new RangeError('Pose cues require increasing times and known pose names');
      }
      if (!Number.isFinite(holdUntil) || holdUntil < at ||
          (i + 1 < cues.length && holdUntil >= cues[i + 1].at) || !Object.hasOwn(easing, ease)) {
        throw new RangeError('Hold ends must precede the next cue and easing must be supported');
      }
      const values = { ...neutral, ...poses[pose] };
      if (fields.some(key => !Number.isFinite(values[key]))) throw new RangeError('Pose channels must be finite numbers');
      return { at, holdUntil, ease: easing[ease], pose: values };
    });
    return (t) => {
      const next = frames.findIndex(frame => frame.at > t);
      if (next === 0) return { ...frames[0].pose };
      if (next === -1) return { ...frames.at(-1).pose };
      const a = frames[next - 1], b = frames[next];
      if (t <= a.holdUntil) return { ...a.pose };
      const p = b.ease((t - a.holdUntil) / (b.at - a.holdUntil));
      return Object.fromEntries(fields.map(key => [key, M.lerp(a.pose[key], b.pose[key], p)]));
    };
  }

  window.CharacterMotion = { poseAt };
})();
