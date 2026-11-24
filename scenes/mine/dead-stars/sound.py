"""Dead Stars: synthesize the score and the sound design from the narration cues. No samples, no credits.

    python3 scenes/mine/dead-stars/sound.py        # after prep.py

Writes footage/dead-stars/snd/score-{A,B,C}.wav (one per hook, the body starts at a different time) and the
one-shot effects thump.wav (match cuts), ping.wav (an element lights up), boom.wav (the supernova), heart.wav.

Arc (rule 3 of the brief): a low drone that climbs in pitch across the four beats, drops out completely a beat
before the explosion, then hits; a gravitational-wave chirp into the collision; a full second of silence on
black; a warm chord for "you" that resolves on the loop point. A heartbeat sits under every hand shot.
"""
import json
import os
import subprocess

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
A = os.path.join(ROOT, 'footage/dead-stars')
OUT = f'{A}/snd'
os.makedirs(OUT, exist_ok=True)
SR = 44100
rng = np.random.default_rng(7)


def write(name, x):
    x = np.asarray(x, dtype=np.float32)
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    peak = np.max(np.abs(x)) or 1
    if peak > 0.98:
        x = x * (0.98 / peak)
    raw = (x * 32767).astype('<i2').tobytes()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '2', '-i', '-', f'{OUT}/{name}'],
                   input=raw, check=True)


def env(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na)
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return e


def lowpass(x, cutoff):
    # one-pole, cutoff may be an array (moving filter)
    a = np.exp(-2 * np.pi * np.broadcast_to(cutoff, x.shape) / SR)
    y = np.empty_like(x); s = 0.0
    for i in range(len(x)):
        s = (1 - a[i]) * x[i] + a[i] * s; y[i] = s
    return y


def heartbeat():
    def thud(f0, d):
        t = np.arange(int(d * SR)) / SR
        f = f0 * (1 + 0.8 * np.exp(-t * 30))
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14)
    n = int(0.9 * SR); x = np.zeros(n)
    a = thud(52, 0.35); x[:len(a)] += a
    b = thud(46, 0.35) * 0.7; o = int(0.28 * SR); x[o:o + len(b)] += b
    return x * 0.9


def thump():
    t = np.arange(int(0.7 * SR)) / SR
    f = 38 + 90 * np.exp(-t * 22)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 6)
    click = rng.standard_normal(len(t)) * np.exp(-t * 180) * 0.25
    return x + lowpass(click, 2500)


def ping():
    t = np.arange(int(1.4 * SR)) / SR
    x = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, a, d in [(1760, 0.5, 5), (2637, 0.25, 7), (4400, 0.12, 11)])
    return x * env(len(t), 0.003, 0.2) * 0.5


def boom():
    t = np.arange(int(5.0 * SR)) / SR
    sub = np.sin(2 * np.pi * np.cumsum(30 + 60 * np.exp(-t * 4)) / SR) * np.exp(-t * 0.9)
    noise = lowpass(rng.standard_normal(len(t)), 300 + 5000 * np.exp(-t * 2.5)) * np.exp(-t * 0.8) * 0.9
    return (sub + noise) * env(len(t), 0.002, 1.5)


def score(off, cues, end, hooks_hand_end):
    n = int((end + 0.5) * SR); t = np.arange(n) / SR
    c = {k: v + off for k, v in cues.items() if isinstance(v, (int, float))}
    L = np.zeros(n); R = np.zeros(n)

    def add(x, at, gain=1.0, pan=0.0):
        i = int(at * SR); x = x[:max(0, n - i)]
        L[i:i + len(x)] += x * gain * (1 - pan) ** 0.5
        R[i:i + len(x)] += x * gain * (1 + pan) ** 0.5

    # --- drone: root climbs across the beats (A1 -> C2 -> D2 -> E2), cut dead just before the explosion
    pts = [(0, 55.0), (c['stars'], 55.0), (c['stars'] + 0.4, 65.41), (c['ironLine'], 65.41), (c['ironLine'] + 0.6, 73.42),
           (c['collapse'], 77.78), (c['explode'], 82.41)]
    f = np.interp(t, [p[0] for p in pts], [p[1] for p in pts])
    ph = 2 * np.pi * np.cumsum(f) / SR
    drone = np.sin(ph) + 0.5 * np.sin(2 * ph + 0.3) + 0.25 * np.sin(3 * ph) + 0.18 * np.sin(1.5 * ph)
    bright = np.interp(t, [0, c['stars'], c['ironLine'], c['explode']], [400, 900, 1500, 2600])
    drone = lowpass(drone + 0.15 * rng.standard_normal(n), bright)
    lvl = np.interp(t, [0, c['t0'] - 0.5, c['t0'] + 1, c['collapse'], c['explode'] - 0.45, c['explode'] - 0.35],
                    [0.10, 0.10, 0.22, 0.34, 0.42, 0.0])
    lvl[t >= c['explode'] - 0.35] = 0
    # cold shimmer for the early universe
    shim = sum(np.sin(2 * np.pi * fr * t + k) for k, fr in enumerate([880, 1318.5, 1760])) * 0.05 * (1 + 0.5 * np.sin(2 * np.pi * 0.3 * t))
    sl = np.interp(t, [c['t0'], c['t0'] + 1, c['stars'] - 0.2, c['stars'] + 0.4], [0, 1, 1, 0])
    add(drone * lvl + shim * sl, 0)
    # collapse: pulses that speed up ("in under a second"), into the drop-out
    k = c['collapse']
    for i in range(10):
        at = k + 1.2 * (1 - 0.82 ** i) / (1 - 0.82)
        if at > c['explode'] - 0.4: break
        add(thump() * 0.35, at)
    # supernova hit + its tail (the tail dies before the gold beat)
    add(boom() * 0.9, c['explode'])
    # gold: bell-like pad, then the inspiral chirp into the collision
    tg = np.arange(int((c['collide'] - c['gold'] + 0.2) * SR)) / SR
    bell = sum(a * np.sin(2 * np.pi * fr * tg) for fr, a in [(220, 0.4), (329.6, 0.3), (440, 0.2), (659.3, 0.12)])
    add(bell * env(len(tg), 1.0, 0.3) * 0.12, c['gold'])
    dur = c['collide'] - c['deadstars']
    tc = np.arange(int(dur * SR)) / SR
    tau = np.maximum(dur - tc, 0.02)
    fc = 28 * (tau / dur) ** (-3 / 8)            # GW chirp: f ~ (t_c - t)^(-3/8)
    fc = np.minimum(fc, 380)
    chirp = np.sin(2 * np.pi * np.cumsum(fc) / SR) * (tau / dur) ** (-1 / 4) * 0.08
    add(lowpass(chirp, 1200) * env(len(tc), 0.5, 0.02), c['deadstars'])
    # collision bloom: hit + shimmering gold that fades to nothing by `black`
    add(boom() * 0.55, c['collide'])
    tb = np.arange(int((c['black'] - c['collide']) * SR)) / SR
    gl = sum(np.sin(2 * np.pi * fr * tb) * np.exp(-tb * 1.5) for fr in [880, 1108.7, 1318.5, 1760]) * 0.05
    add(gl, c['collide'])
    # hard silence from `black` for 1 s: clear everything that leaks in
    i0, i1 = int(c['black'] * SR), int((c['black'] + 1.0) * SR)
    fade = int(0.08 * SR)
    for ch in (L, R):
        ch[i0 - fade:i0] *= np.linspace(1, 0, fade); ch[i0:i1] = 0
    # "you": a warm A-major chord that swells and resolves on the loop point
    ty = np.arange(int((end - c['drift'] + 0.5) * SR)) / SR
    chord = sum(a * np.sin(2 * np.pi * fr * ty + 0.4 * np.sin(2 * np.pi * 0.15 * ty)) for fr, a in
                [(110, 0.35), (164.8, 0.3), (220, 0.25), (277.2, 0.2), (329.6, 0.16), (440, 0.08)])
    ce = np.interp(ty, [0, 1.5, c['you'] - c['drift'], end - c['drift'] - 1.6, end - c['drift']], [0, 0.6, 1.0, 0.8, 0.0])
    add(lowpass(chord, 1400) * ce * 0.16, c['drift'])
    # heartbeat under the hand shots (hook, the "you" beat, the end)
    for a, b in [(0.05, hooks_hand_end)] + [(c['while'], c['look'] - 0.3), (c['look'], end - 0.3)]:
        x = a
        while x < b:
            add(heartbeat() * 0.35, x); x += 1.0
    return np.stack([L, R], 1) * 0.9


def main():
    j = json.load(open(f'{A}/cues.json'))
    tl = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'timeline.js')).read()
    data = json.loads(tl.split('=', 1)[1].rsplit(';', 1)[0])
    cues = data['cues']
    for k, h in data['hooks'].items():
        off = h['off']
        end = off + cues['end']
        write(f'score-{k}.wav', score(off, cues, end, off))
        print('score', k, round(end, 2))
    write('thump.wav', thump()); write('ping.wav', ping()); write('boom.wav', boom()); write('heart.wav', heartbeat())


if __name__ == '__main__':
    main()
