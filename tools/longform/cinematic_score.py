#!/usr/bin/env python3
"""Synthesize a short cinematic score bed (no credits, no samples): drone -> riser -> hard silence -> sub hit -> pad.

  python tools/longform/cinematic_score.py out.wav --dur 16 --silence 10.3 --hit 11.07 --cuts 4.6,9.2,12.4 \
      --shimmer 4.6:10.3 --pad 12.4

Trailer grammar it encodes: build tension under the picture, cut ALL sound a beat before the reveal (the
silence is the effect), land the reveal on a sub-bass drop with a long tail, then a quiet resolved chord
under the title. Mix kit sfx (hit, tap, chime) over it with ffmpeg.
"""
import argparse, wave
import numpy as np

SR = 48000

def lp(x, cut):  # one-pole low-pass, vectorised by FFT (zero-phase is fine for a bed)
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X / np.sqrt(1 + (f / cut) ** 4), len(x))

def bp(x, lo, hi):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(X * ((f > lo) & (f < hi)), len(x))

def env(t, a, b, fa=0.5, fb=0.5):
    return np.clip((t - a) / max(fa, 1e-3), 0, 1) * np.clip((b - t) / max(fb, 1e-3), 0, 1)

def reverb(x, secs=3.5, mix=0.35, seed=1):
    r = np.random.default_rng(seed); n = int(secs * SR)
    ir = r.standard_normal(n) * np.exp(-np.arange(n) / SR * 6.9 / secs); ir = lp(ir, 3500); ir /= np.abs(ir).sum() ** 0.5 * 8
    y = np.fft.irfft(np.fft.rfft(x, len(x) + n) * np.fft.rfft(ir, len(x) + n))[: len(x)]
    return x * (1 - mix) + y * mix

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out'); ap.add_argument('--dur', type=float, default=16); ap.add_argument('--silence', type=float, default=10.3)
    ap.add_argument('--hit', type=float, default=11.07); ap.add_argument('--cuts', default='4.6,9.2,12.4')
    ap.add_argument('--shimmer', default='4.6:10.3'); ap.add_argument('--pad', type=float, default=12.4); ap.add_argument('--root', type=float, default=55.0)
    a = ap.parse_args()
    n = int(a.dur * SR); t = np.arange(n) / SR; rng = np.random.default_rng(7); R = a.root
    out = np.zeros(n)
    # 1. drone: root + fifth + octave, slow swell, beating detune; filtered air on top
    sw = env(t, 0, a.silence, 2.5, 0.02) * (0.35 + 0.65 * np.clip(t / a.silence, 0, 1) ** 1.5)
    drone = sum(g * np.sin(2 * np.pi * f * t + p) for f, g, p in [(R, 1, 0), (R * 1.003, 0.6, 1), (R * 1.5, 0.45, 2), (R * 2.002, 0.3, 3)])
    air = lp(rng.standard_normal(n), 400) * 2.2
    out += (drone * 0.22 + air * 0.08) * sw
    # 2. shimmer: glassy high partials that flicker in and out (the ghost cards)
    s0, s1 = map(float, a.shimmer.split(':'))
    sh = sum(np.sin(2 * np.pi * f * t) * (0.5 + 0.5 * np.sin(2 * np.pi * (0.7 + i * 0.37) * t + i)) for i, f in enumerate([R * 24, R * 32, R * 38.05, R * 48]))
    out += reverb(sh * env(t, s0, s1, 1.5, 0.05) * 0.02, 2.5, 0.6, 3)
    # 3. riser into the silence: noise band sweeping up + a rising tone
    r0 = a.silence - 1.8; k = np.clip((t - r0) / 1.8, 0, 1)
    noise = rng.standard_normal(n); rise = np.zeros(n)
    for i in range(12):   # piecewise band sweep
        lo = 300 * 2 ** (i * 0.45); m = (k > i / 12) & (k <= (i + 1) / 12)
        rise += bp(noise, lo, lo * 2.2) * m
    tone = np.sin(2 * np.pi * np.cumsum(R * 4 * (1 + 3 * k ** 2)) / SR)
    out += (rise * 0.25 + tone * 0.06) * k ** 2 * (t < a.silence)
    # 4. soft low thumps on the cuts before the silence
    for c in [float(x) for x in a.cuts.split(',') if x]:
        if c >= a.silence: continue
        d = np.clip(t - c, 0, None); out += np.sin(2 * np.pi * (70 * np.exp(-d * 8) + 38) * d) * np.exp(-d * 5) * (t >= c) * 0.35
    out *= t < a.silence                    # the hard silence
    # 5. the hit: a sub drop with a long tail, and a noise crack
    d = np.clip(t - a.hit, 0, None); on = t >= a.hit
    sub = np.sin(2 * np.pi * np.cumsum(32 + 30 * np.exp(-d * 5)) / SR) * np.exp(-d * 0.9) * on
    crack = lp(rng.standard_normal(n), 2500) * np.exp(-d * 18) * on
    out += reverb(sub * 0.9 + crack * 0.5, 4.0, 0.4, 5)
    # 6. pad under the title: a resolved minor-add9 chord, slow attack, fades with the picture
    chord = sum(np.sin(2 * np.pi * f * t + i) for i, f in enumerate([R * 2, R * 3, R * 4 * 1.189, R * 4 * 1.5, R * 9]))
    out += reverb(chord * env(t, a.pad + 0.3, a.dur, 2.0, 1.6) * 0.05, 3.0, 0.5, 9)
    out = np.tanh(out * 1.3) / np.tanh(1.3)
    out /= max(1e-6, np.abs(out).max()) / 0.89
    st = np.stack([out, out], 1)
    with wave.open(a.out, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((st * 32767).astype('<i2').tobytes())
    print('score ->', a.out)

if __name__ == '__main__':
    main()
