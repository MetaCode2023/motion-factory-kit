// scenes/longform/props.js: a library of drawn objects for "show it, don't write it" animations (global PR).
// Every prop is drawn in a 100x100 box centred on (0,0) and scaled to `size`; one flat style: a light body,
// the accent colour for the meaningful part, soft shadow. Original drawings, no logos or brands.
//
//   PR.draw(ctx, 'bank', x, y, size, { color, t, glow, alpha })
//   PR.names  -> every prop name
//
// Props: person, crowd, house, bank, factory, hospital, school, capitol, coin, coins, cash, card, chip, dice,
// ballot, vote, eye, camera, phone, laptop, document, lock, globe, atom, barrel, fuel, bolt, sun, wind, car,
// clock, chart, scale, lightbulb, gear, flag, pill, heart, shield, server, key, magnifier
(function () {
  const PR = {};
  const BODY = '#E9EDF5', SHADE = '#C7CEDC', INK = '#161922';
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, r) : c.rect(x, y, w, h); };
  const circ = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); };
  const poly = (c, pts) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); };
  const fill = (c, col) => { c.fillStyle = col; c.fill(); };
  const line = (c, col, w = 4) => { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); };

  const D = {
    person(c, a) { circ(c, 0, -26, 16); fill(c, BODY); c.beginPath(); c.moveTo(-30, 44); c.quadraticCurveTo(-30, 2, 0, 2); c.quadraticCurveTo(30, 2, 30, 44); c.closePath(); fill(c, a); },
    crowd(c, a) { c.save(); c.translate(-28, 8); c.scale(0.7, 0.7); D.person(c, SHADE); c.restore(); c.save(); c.translate(28, 8); c.scale(0.7, 0.7); D.person(c, SHADE); c.restore(); c.save(); c.translate(0, -2); c.scale(0.85, 0.85); D.person(c, a); c.restore(); },
    house(c, a) { poly(c, [[-40, -4], [0, -40], [40, -4]]); fill(c, a); rr(c, -32, -6, 64, 46, 3); fill(c, BODY); rr(c, -9, 14, 18, 26, 2); fill(c, a); rr(c, 14, 4, 12, 12, 2); fill(c, SHADE); },
    bank(c, a) { poly(c, [[-46, -18], [0, -44], [46, -18]]); fill(c, a); rr(c, -42, -18, 84, 8, 2); fill(c, BODY); for (let i = 0; i < 4; i++) { rr(c, -34 + i * 20, -8, 8, 38, 2); fill(c, BODY); } rr(c, -46, 30, 92, 10, 2); fill(c, BODY); circ(c, 0, -27, 5); fill(c, BODY); },
    factory(c, a) { poly(c, [[-44, 40], [-44, -6], [-20, 8], [-20, -6], [4, 8], [4, -6], [28, 8], [28, -30], [44, -30], [44, 40]]); fill(c, BODY); rr(c, 30, -44, 12, 14, 2); fill(c, a); for (let i = 0; i < 3; i++) { rr(c, -36 + i * 24, 18, 12, 10, 2); fill(c, a); } },
    hospital(c, a) { rr(c, -40, -30, 80, 70, 4); fill(c, BODY); rr(c, -10, -22, 20, 44, 3); fill(c, a); rr(c, -22, -10, 44, 20, 3); fill(c, a); rr(c, -10, 26, 20, 14, 2); fill(c, SHADE); },
    school(c, a) { poly(c, [[-44, -10], [0, -36], [44, -10]]); fill(c, a); rr(c, -38, -10, 76, 50, 3); fill(c, BODY); rr(c, -8, 16, 16, 24, 2); fill(c, a); rr(c, -28, 2, 12, 12, 2); fill(c, SHADE); rr(c, 16, 2, 12, 12, 2); fill(c, SHADE); c.beginPath(); c.moveTo(0, -36); c.lineTo(0, -48); line(c, BODY, 3); poly(c, [[0, -48], [14, -44], [0, -40]]); fill(c, a); },
    capitol(c, a) { c.beginPath(); c.arc(0, -10, 22, Math.PI, 0); c.closePath(); fill(c, a); rr(c, -3, -42, 6, 12, 2); fill(c, a); rr(c, -44, -10, 88, 8, 2); fill(c, BODY); for (let i = 0; i < 5; i++) { rr(c, -38 + i * 17, -2, 7, 32, 2); fill(c, BODY); } rr(c, -48, 30, 96, 10, 2); fill(c, BODY); },
    coin(c, a) { circ(c, 0, 0, 38); fill(c, a); circ(c, 0, 0, 29); line(c, 'rgba(255,255,255,0.55)', 4); c.font = '800 40px "Plus Jakarta Sans"'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.fillText('$', 0, 2); },
    coins(c, a) { for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(0, 26 - i * 12, 34, 11, 0, 0, Math.PI * 2); fill(c, i % 2 ? a : FX.alpha(a, 0.75)); c.beginPath(); c.ellipse(0, 26 - i * 12, 34, 11, 0, 0, Math.PI * 2); line(c, 'rgba(255,255,255,0.5)', 2); } c.save(); c.translate(26, -24); c.scale(0.5, 0.5); D.coin(c, a); c.restore(); },
    cash(c, a) { c.save(); c.rotate(-0.12); rr(c, -46, -24, 92, 48, 6); fill(c, a); rr(c, -38, -16, 76, 32, 4); line(c, 'rgba(255,255,255,0.5)', 3); circ(c, 0, 0, 12); line(c, 'rgba(255,255,255,0.8)', 3); c.restore(); },
    card(c, a) { rr(c, -26, -36, 52, 72, 6); fill(c, '#F7F5EF'); c.font = '800 22px "Plus Jakarta Sans"'; c.fillStyle = a; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText('A', -20, -14); if (window.P) P.suit(c, 's', 0, 8, 34, INK); },
    chip(c, a) { circ(c, 0, 0, 38); fill(c, a); for (let i = 0; i < 8; i++) { c.save(); c.rotate((i * Math.PI) / 4); rr(c, -5, -38, 10, 12, 2); fill(c, '#fff'); c.restore(); } circ(c, 0, 0, 22); line(c, 'rgba(255,255,255,0.7)', 3); },
    dice(c, a) { rr(c, -34, -34, 68, 68, 12); fill(c, BODY); [[-16, -16], [16, 16], [0, 0], [16, -16], [-16, 16]].forEach(([x, y]) => { circ(c, x, y, 6); fill(c, a); }); },
    ballot(c, a) { rr(c, -40, -6, 80, 46, 5); fill(c, BODY); rr(c, -24, -4, 48, 6, 3); fill(c, INK); c.save(); c.translate(0, -16); c.rotate(-0.05); rr(c, -20, -28, 40, 34, 3); fill(c, '#fff'); c.beginPath(); c.moveTo(-10, -12); c.lineTo(-3, -4); c.lineTo(12, -20); line(c, a, 5); c.restore(); rr(c, -14, 18, 28, 8, 3); fill(c, a); },
    vote(c, a) { rr(c, -32, -40, 64, 80, 5); fill(c, '#fff'); for (let i = 0; i < 3; i++) { rr(c, -22, -26 + i * 22, 12, 12, 2); line(c, SHADE, 3); rr(c, -4, -22 + i * 22, 28, 5, 2); fill(c, SHADE); } c.beginPath(); c.moveTo(-20, -3); c.lineTo(-15, 2); c.lineTo(-6, -10); line(c, a, 5); },
    eye(c, a) { c.beginPath(); c.moveTo(-46, 0); c.quadraticCurveTo(0, -40, 46, 0); c.quadraticCurveTo(0, 40, -46, 0); fill(c, BODY); circ(c, 0, 0, 17); fill(c, a); circ(c, 0, 0, 7); fill(c, INK); circ(c, 5, -5, 3); fill(c, '#fff'); },
    camera(c, a) { c.save(); c.rotate(0.25); rr(c, -36, -16, 60, 30, 6); fill(c, BODY); circ(c, 24, -1, 12); fill(c, a); circ(c, 24, -1, 5); fill(c, INK); c.restore(); rr(c, -40, -32, 10, 48, 3); fill(c, SHADE); circ(c, -18, -6, 3); fill(c, '#FF4D5E'); },
    phone(c, a) { rr(c, -22, -42, 44, 84, 9); fill(c, INK); rr(c, -18, -34, 36, 66, 5); fill(c, a); rr(c, -8, 34, 16, 3, 2); fill(c, SHADE); rr(c, -12, -24, 24, 6, 3); fill(c, 'rgba(255,255,255,0.7)'); rr(c, -12, -12, 18, 6, 3); fill(c, 'rgba(255,255,255,0.45)'); },
    laptop(c, a) { rr(c, -34, -32, 68, 46, 5); fill(c, INK); rr(c, -29, -27, 58, 36, 3); fill(c, a); poly(c, [[-44, 16], [44, 16], [38, 26], [-38, 26]]); fill(c, BODY); },
    document(c, a) { poly(c, [[-28, -40], [16, -40], [30, -26], [30, 40], [-28, 40]]); fill(c, '#fff'); poly(c, [[16, -40], [30, -26], [16, -26]]); fill(c, SHADE); for (let i = 0; i < 4; i++) { rr(c, -18, -18 + i * 13, i === 3 ? 26 : 38, 5, 2); fill(c, i ? SHADE : a); } },
    lock(c, a) { c.beginPath(); c.arc(0, -10, 18, Math.PI, 0); line(c, SHADE, 9); rr(c, -28, -10, 56, 46, 7); fill(c, a); circ(c, 0, 8, 6); fill(c, INK); rr(c, -2, 8, 4, 12, 2); fill(c, INK); },
    globe(c, a) { circ(c, 0, 0, 38); fill(c, a); c.save(); circ(c, 0, 0, 38); c.clip(); c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.ellipse(-10, -12, 14, 18, 0.4, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(16, 14, 12, 16, -0.3, 0, Math.PI * 2); c.fill(); c.restore(); c.beginPath(); c.ellipse(0, 0, 16, 38, 0, 0, Math.PI * 2); line(c, 'rgba(255,255,255,0.35)', 2); c.beginPath(); c.moveTo(-38, 0); c.lineTo(38, 0); line(c, 'rgba(255,255,255,0.35)', 2); },
    atom(c, a) { for (let i = 0; i < 3; i++) { c.save(); c.rotate((i * Math.PI) / 3); c.beginPath(); c.ellipse(0, 0, 44, 16, 0, 0, Math.PI * 2); line(c, BODY, 4); c.restore(); } circ(c, 0, 0, 10); fill(c, a); },
    barrel(c, a) { rr(c, -28, -40, 56, 80, 10); fill(c, a); for (const y of [-22, 0, 22]) { rr(c, -30, y - 3, 60, 6, 3); fill(c, 'rgba(0,0,0,0.25)'); } c.beginPath(); c.moveTo(0, -12); c.quadraticCurveTo(10, 2, 0, 10); c.quadraticCurveTo(-10, 2, 0, -12); fill(c, BODY); },
    fuel(c, a) { rr(c, -30, -36, 40, 76, 6); fill(c, BODY); rr(c, -24, -28, 28, 22, 3); fill(c, a); c.beginPath(); c.moveTo(10, -16); c.lineTo(24, -16); c.lineTo(24, 22); c.quadraticCurveTo(24, 30, 32, 30); line(c, SHADE, 5); },
    bolt(c, a) { poly(c, [[8, -44], [-26, 6], [-2, 6], [-10, 44], [26, -8], [2, -8]]); fill(c, a); },
    sun(c, a) { for (let i = 0; i < 8; i++) { c.save(); c.rotate((i * Math.PI) / 4); rr(c, -4, -46, 8, 16, 4); fill(c, a); c.restore(); } circ(c, 0, 0, 24); fill(c, a); },
    wind(c, a) { rr(c, -3, -10, 6, 54, 3); fill(c, BODY); for (let i = 0; i < 3; i++) { c.save(); c.translate(0, -10); c.rotate((i * 2 * Math.PI) / 3 - Math.PI / 2); c.beginPath(); c.ellipse(0, -22, 6, 22, 0, 0, Math.PI * 2); fill(c, a); c.restore(); } circ(c, 0, -10, 6); fill(c, BODY); },
    car(c, a) { poly(c, [[-46, 10], [-40, -6], [-22, -8], [-12, -24], [18, -24], [30, -8], [46, -4], [46, 14], [-46, 14]]); fill(c, a); rr(c, -8, -20, 22, 12, 2); fill(c, 'rgba(255,255,255,0.6)'); for (const x of [-26, 26]) { circ(c, x, 16, 11); fill(c, INK); circ(c, x, 16, 4); fill(c, SHADE); } },
    clock(c, a) { circ(c, 0, 0, 40); fill(c, BODY); circ(c, 0, 0, 40); line(c, a, 6); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -24); line(c, INK, 5); c.beginPath(); c.moveTo(0, 0); c.lineTo(16, 8); line(c, a, 5); circ(c, 0, 0, 4); fill(c, INK); },
    chart(c, a) { rr(c, -42, -38, 84, 76, 6); fill(c, BODY); [[-28, 18], [-10, 8], [8, -4], [26, -22]].forEach(([x, h], i) => { rr(c, x - 7, 26 - (40 - h), 14, 40 - h, 3); fill(c, i === 3 ? a : SHADE); }); c.beginPath(); c.moveTo(-30, 6); c.lineTo(-10, -2); c.lineTo(8, -12); c.lineTo(28, -30); line(c, a, 4); },
    scale(c, a) { rr(c, -3, -36, 6, 70, 3); fill(c, BODY); rr(c, -24, 32, 48, 8, 3); fill(c, BODY); c.beginPath(); c.moveTo(-38, -26); c.lineTo(38, -26); line(c, BODY, 5); for (const x of [-34, 34]) { c.beginPath(); c.moveTo(x, -26); c.lineTo(x - 12, 2); c.moveTo(x, -26); c.lineTo(x + 12, 2); line(c, SHADE, 2); c.beginPath(); c.arc(x, 2, 14, 0, Math.PI); fill(c, a); } },
    lightbulb(c, a) { circ(c, 0, -10, 28); fill(c, a); rr(c, -14, 14, 28, 18, 4); fill(c, SHADE); rr(c, -10, 32, 20, 8, 3); fill(c, INK); c.beginPath(); c.moveTo(-8, -8); c.lineTo(0, 4); c.lineTo(8, -8); line(c, 'rgba(255,255,255,0.8)', 3); },
    gear(c, a) { for (let i = 0; i < 8; i++) { c.save(); c.rotate((i * Math.PI) / 4); rr(c, -7, -44, 14, 16, 3); fill(c, a); c.restore(); } circ(c, 0, 0, 32); fill(c, a); circ(c, 0, 0, 12); fill(c, BODY); },
    flag(c, a) { rr(c, -34, -42, 5, 84, 2); fill(c, BODY); c.beginPath(); c.moveTo(-29, -38); c.quadraticCurveTo(0, -48, 36, -36); c.lineTo(36, -2); c.quadraticCurveTo(0, -14, -29, -4); c.closePath(); fill(c, a); },
    pill(c, a) { c.save(); c.rotate(-0.6); rr(c, -40, -16, 80, 32, 16); fill(c, BODY); c.save(); rr(c, -40, -16, 80, 32, 16); c.clip(); c.fillStyle = a; c.fillRect(0, -16, 40, 32); c.restore(); c.restore(); },
    heart(c, a) { c.beginPath(); c.moveTo(0, 36); c.bezierCurveTo(-58, -6, -40, -52, 0, -22); c.bezierCurveTo(40, -52, 58, -6, 0, 36); fill(c, a); },
    shield(c, a) { c.beginPath(); c.moveTo(0, -42); c.lineTo(36, -28); c.quadraticCurveTo(34, 20, 0, 42); c.quadraticCurveTo(-34, 20, -36, -28); c.closePath(); fill(c, a); c.beginPath(); c.moveTo(-12, 0); c.lineTo(-2, 10); c.lineTo(16, -12); line(c, '#fff', 6); },
    server(c, a) { for (let i = 0; i < 3; i++) { rr(c, -36, -40 + i * 28, 72, 22, 4); fill(c, BODY); circ(c, 24, -29 + i * 28, 4); fill(c, a); rr(c, -26, -31 + i * 28, 30, 4, 2); fill(c, SHADE); } },
    key(c, a) { circ(c, -18, 0, 18); fill(c, a); circ(c, -18, 0, 7); fill(c, '#05060A'); rr(c, -2, -5, 46, 10, 3); fill(c, a); rr(c, 30, 4, 7, 12, 2); fill(c, a); rr(c, 18, 4, 7, 9, 2); fill(c, a); },
    magnifier(c, a) { circ(c, -8, -8, 28); line(c, a, 9); circ(c, -8, -8, 22); fill(c, 'rgba(255,255,255,0.12)'); c.beginPath(); c.moveTo(12, 12); c.lineTo(38, 38); line(c, BODY, 12); },
  };
  PR.names = Object.keys(D);

  PR.draw = (c, name, x, y, size, { color = '#3CE0FF', alpha = 1, glow = 0, rot = 0, shadow = true } = {}) => {
    const f = D[name] || D.document;
    c.save(); c.translate(x, y); c.rotate(rot); c.scale(size / 100, size / 100); c.globalAlpha *= alpha;
    if (glow > 0) { c.shadowColor = color; c.shadowBlur = 50 * glow; }
    else if (shadow) { c.shadowColor = 'rgba(0,0,0,0.45)'; c.shadowBlur = 18; c.shadowOffsetY = 8; }
    f(c, color);
    c.restore();
  };

  // Pop in with overshoot at `at` (k: 0..1+) and bob gently afterwards. Returns the scale used.
  PR.pop = (t, at, dur = 0.45) => M.ease.outBack(M.clamp((t - at) / dur));
  PR.bob = (t, seed = 0, amp = 6) => amp * Math.sin(t * 1.6 + seed * 1.7);

  window.PR = PR;
})();
