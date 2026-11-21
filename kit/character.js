// Load after motion.js and simulation.js. Poses share the same local coordinate space.
(() => {
  const M = window.M;
  const fields = ['lean', 'gaze', 'arm', 'eye', 'nod'];
  const neutral = { lean: 0, gaze: 0, arm: 0, eye: 1, nod: 0 };

  function poseAt(cues, poses) {
    if (!cues.length) throw new RangeError('Provide at least one pose cue');
    const frames = cues.map(({ at, pose }, i) => {
      if (!Number.isFinite(at) || (i && at <= cues[i - 1].at) || !Object.hasOwn(poses, pose)) {
        throw new RangeError('Pose cues require increasing times and known pose names');
      }
      return { at, pose: { ...neutral, ...poses[pose] } };
    });
    return (t) => {
      const next = frames.findIndex(frame => frame.at > t);
      if (next === 0) return { ...frames[0].pose };
      if (next === -1) return { ...frames.at(-1).pose };
      const a = frames[next - 1], b = frames[next];
      const p = M.ease.inOutCubic((t - a.at) / (b.at - a.at));
      return Object.fromEntries(fields.map(key => [key, M.lerp(a.pose[key], b.pose[key], p)]));
    };
  }

  window.CharacterMotion = { poseAt };
})();
