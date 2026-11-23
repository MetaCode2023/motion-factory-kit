# Synthesize a 20 s epic trailer bed: drone, i-VI-VII-i string pad, taiko hits, pulse, riser, silence, final hit.
# Usage: python3 tools/trailer-score.py assets/vo/quantum-promo/trailer.wav  (needs numpy)
import numpy as np, wave, sys
sr = 48000; D = 20.0; n = int(sr * D); t = np.arange(n) / sr
rng = np.random.default_rng(7)
out = np.zeros((2, n))
def note(f): return 440 * 2 ** ((f - 69) / 12)
def lp(x, fc):
    a = np.exp(-2 * np.pi * fc / sr); y = np.empty_like(x); s = 0.0
    for i in range(len(x)): s = (1 - a) * x[i] + a * s; y[i] = s
    return y
def lp_fast(x, fc):  # FFT brickwall-ish soft lowpass
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / sr); X *= 1 / (1 + (f / fc) ** 4); return np.fft.irfft(X, len(x))
def hp_fast(x, fc):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / sr); X *= 1 / (1 + (fc / np.maximum(f, 1)) ** 4); return np.fft.irfft(X, len(x))
def saw(f, tt, ph=0):
    y = np.zeros_like(tt)
    for k in range(1, 16): y += np.sin(2 * np.pi * f * k * tt + ph * k) / k
    return y
def env(a, s, e, r):  # attack from a, sustain to e, release r
    g = np.clip((t - a) / max(s, 1e-3), 0, 1) * np.clip(1 - (t - e) / r, 0, 1)
    return np.where(t < a, 0, g)
GAP0, GAP1 = 17.35, 17.8
# Drone on D
dr = (np.sin(2 * np.pi * note(26) * t) * 0.6 + lp_fast(saw(note(38), t), 400) * 0.35) * env(0, 3.5, GAP0, 0.25)
out += dr * 0.5
# Pad chords: Dm, Bb, C, Dm  (detuned saws, two voices per note, panned)
chords = [(0.3, 8.0, [50, 53, 57, 62]), (8.0, 12.0, [46, 50, 53, 58]), (12.0, 14.8, [48, 52, 55, 60]), (14.8, GAP0, [50, 53, 57, 62, 65])]
for a, e, ns in chords:
    seg = np.zeros((2, n))
    for j, m in enumerate(ns):
        for d, ch in ((-0.06, 0), (0.06, 1)):
            seg[ch] += saw(note(m + d), t, ph=j + ch)
    g = env(a, 1.2 if a < 1 else 0.35, e, 0.35 if e < GAP0 else 0.08)
    lift = 0.6 + 0.4 * np.clip((t - 4) / 13, 0, 1)
    for ch in range(2): out[ch] += lp_fast(seg[ch], 900 + 1800 * (a / 15)) * g * lift * 0.06
# Taiko hits
def taiko(at, amp=1.0, big=False):
    i0 = int(at * sr); L = int((2.5 if big else 0.9) * sr); tt = np.arange(L) / sr
    f = 40 + 55 * np.exp(-tt * 18)
    body = np.sin(2 * np.pi * np.cumsum(f) / sr) * np.exp(-tt * (1.6 if big else 5.5))
    sk = lp_fast(rng.standard_normal(L), 1800) * np.exp(-tt * 40) * 0.5
    x = (body + sk) * amp
    if big: x += lp_fast(rng.standard_normal(L), 300) * np.exp(-tt * 2.2) * 0.35 * amp
    j1 = min(n, i0 + L); out[:, i0:j1] += x[: j1 - i0]
for at, a in [(0, 1.0), (4.3, 0.9), (6.6, 0.9), (8.0, 1.0), (9.0, 0.5), (10.0, 0.8), (11.0, 0.5), (12.0, 1.0), (12.75, 0.5), (13.5, 0.6), (13.9, 0.9), (14.2, 0.9), (14.5, 0.9), (14.8, 1.1), (15.45, 0.6), (16.1, 0.9), (16.6, 0.7), (16.85, 0.8), (17.1, 0.9)]:
    taiko(at, a)
taiko(GAP1, 1.6, big=True)
# Low staccato string pulse, 8ths at 0.25 s, 8.0 -> gap
pulse = np.zeros(n)
for k, at in enumerate(np.arange(8.0, GAP0 - 0.05, 0.25)):
    i0 = int(at * sr); L = int(0.2 * sr); tt = np.arange(L) / sr
    root = 38 if at < 12 else (34 if at < 14.8 else 38)
    if 8.0 <= at < 12: root = 34
    elif 12 <= at < 14.8: root = 36
    else: root = 38
    pulse[i0:i0 + L] += lp_fast(saw(note(root), tt), 700) * np.exp(-tt * 14)
pulse *= 0.5 + 0.5 * np.clip((t - 8) / 9, 0, 1)
out += pulse * 0.22
# Riser: filtered noise + rising tone, 12.6 -> gap
rg = np.clip((t - 12.6) / (GAP0 - 12.6), 0, 1) ** 2 * (t < GAP0)
nz = hp_fast(rng.standard_normal(n), 1500) * rg * 0.12
tone = np.sin(2 * np.pi * np.cumsum(note(62) * 2 ** (np.clip((t - 12.6) / 4.75, 0, 1) * 1.0)) / sr) * rg * 0.07
out[0] += nz + tone; out[1] += np.roll(nz, 37) + tone
# Final chord after the gap: D minor, big and decaying
fin = np.zeros((2, n)); ga = np.clip((t - GAP1) / 0.05, 0, 1) * np.exp(-np.maximum(t - GAP1, 0) * 0.9) * (t >= GAP1)
for j, m in enumerate([26, 38, 45, 50, 53, 57, 62]):
    for d, ch in ((-0.07, 0), (0.07, 1)): fin[ch] += saw(note(m + d), t, ph=j) * (1.0 if m < 40 else 0.5)
for ch in range(2): out[ch] += lp_fast(fin[ch], 1400) * ga * 0.09
# Reverb: exponential-decay noise IR, FFT convolution
L = int(2.2 * sr); it = np.arange(L) / sr
for ch in range(2):
    ir = rng.standard_normal(L) * np.exp(-it * 2.6); ir = lp_fast(ir, 5000); ir /= np.sqrt((ir ** 2).sum())
    N = n + L; wet = np.fft.irfft(np.fft.rfft(out[ch], N) * np.fft.rfft(ir, N), N)[:n]
    out[ch] = out[ch] * 0.8 + wet * 0.35
# Hard gap before the final hit (keep the reverb tail short)
gap = np.clip(1 - (t - GAP0) / 0.12, 0, 1) * (t < GAP1) + (t >= GAP1)
gap = np.where(t < GAP0, 1, gap); out *= gap
out *= np.clip((D - t) / 0.6, 0, 1)
out /= np.abs(out).max() * 1.12
pcm = (np.tanh(out * 1.3) / np.tanh(1.3) * 32000).astype(np.int16).T.copy()
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
