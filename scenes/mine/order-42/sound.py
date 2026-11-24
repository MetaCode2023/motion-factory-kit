"""Order #42: score and sound effects, synthesized (no samples, no credits).

    python3 scenes/mine/order-42/sound.py <out_dir> <cues.json>

cues.json gives the times the score is cut to (seconds):
  {"else": 10.6, "trip": 14.8, "peak": 40.5, "honk": 46.0, "end": 60.0}

Writes music.wav (lo-fi car radio -> filtered away -> cosmic pad -> dead stop on the honk -> radio resumes
exactly where it left off) and one wav per effect: crackle, honk, scratch, ting, printer, idle-tick.
"""
import json
import sys
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(42)


def write(path, x, stereo=None):
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    peak = np.max(np.abs(x)) or 1
    x = x / peak * 0.89
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())


def t_(d):
    return np.arange(int(d * SR)) / SR


def env(n, a=0.005, r=0.2, shape=1.0):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) / max(r, 1e-4))
    return e ** shape


def onepole_lp(x, fc):
    """One-pole low-pass; fc may be an array (a sweep)."""
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x); s = 0.0
    for i in range(len(x)):
        s = (1 - a[i]) * x[i] + a[i] * s
        y[i] = s
    return y


def lp(x, fc, order=2):
    for _ in range(order):
        x = onepole_lp(x, fc)
    return x


def hp(x, fc):
    return x - lp(x, fc, 1)


def fft_band(x, lo, hi):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    X[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(X, len(x))


def note(f, d, kind='keys'):
    t = t_(d)
    if kind == 'keys':   # soft electric-piano: sine + a little 2nd/3rd harmonic, bell attack, tremolo
        x = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t) * np.exp(-t * 6) + 0.08 * np.sin(6 * np.pi * f * t)
        x *= env(len(t), 0.004, 1.4) * (1 + 0.12 * np.sin(2 * np.pi * 4.5 * t))
    elif kind == 'saw':
        x = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 14))
    return x


def mtof(m):
    return 440 * 2 ** ((m - 69) / 12)


# ---- the lo-fi radio loop (80 bpm, 4 bars, Fmaj7 Em7 Dm7 Cmaj7) ------------------------------------
BPM = 80; BEAT = 60 / BPM; BAR = 4 * BEAT


def lofi(dur):
    n = int(dur * SR); x = np.zeros(n)
    chords = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]]
    bass = [41, 40, 38, 36]
    kick = np.sin(2 * np.pi * (50 + 90 * np.exp(-t_(0.35) * 30)) * t_(0.35)) * env(int(0.35 * SR), 0.002, 0.12)
    snr = fft_band(rng.standard_normal(int(0.25 * SR)), 900, 6000) * env(int(0.25 * SR), 0.002, 0.06)
    hat = fft_band(rng.standard_normal(int(0.06 * SR)), 6000, 14000) * env(int(0.06 * SR), 0.001, 0.015)
    def put(sig, at, g=1.0):
        i = int(at * SR)
        if i >= n: return
        j = min(n, i + len(sig)); x[i:j] += g * sig[:j - i]
    b = 0
    while b * BAR < dur:
        t0 = b * BAR; ch = chords[b % 4]
        for m in ch:
            put(note(mtof(m), BAR * 1.05), t0 + 0.02 * (ch.index(m)), 0.16)
        put(note(mtof(bass[b % 4]), BAR * 0.9) * 1.0, t0, 0.35)
        for q in range(4):
            sw = 0.035 if q % 2 else 0          # lazy swing
            put(kick, t0 + q * BEAT + (0.0 if q in (0, 2) else 10), 0.9) if q in (0, 2) else None
            if q == 2 and b % 2: put(kick, t0 + 2.5 * BEAT, 0.6)
            if q in (1, 3): put(snr, t0 + q * BEAT, 0.35)
            put(hat, t0 + q * BEAT, 0.12); put(hat, t0 + (q + 0.5) * BEAT + sw, 0.08)
        b += 1
    # vinyl dust
    dust = np.zeros(n); idx = rng.integers(0, n, int(dur * 9)); dust[idx] = rng.uniform(-1, 1, len(idx))
    x += 0.25 * lp(dust, 3000, 1)
    return x


def car_radio(x):
    """Through a car's door speakers: no deep lows, soft highs."""
    return lp(hp(x, 110), 5200, 1)


def pad(dur, peak_at):
    """Cosmic pad: detuned saws through a slowly opening filter, a formant 'aah', swelling to the peak."""
    t = t_(dur); n = len(t)
    roots = [mtof(m) for m in (41, 48, 53, 57, 60, 64, 67)]   # F add9 voicing, wide
    x = np.zeros(n)
    for i, f in enumerate(roots):
        for d in (-0.11, 0.0, 0.13):
            ff = f * 2 ** (d / 12)
            ph = rng.uniform(0, 2 * np.pi)
            x += sum(np.sin(2 * np.pi * ff * k * t + ph * k) / k for k in range(1, 8)) / (1 + 0.15 * i)
    rise = np.clip(t / peak_at, 0, 1) ** 1.6
    x = lp(x, 300 + 3200 * rise, 2)
    # 'aah' formants (700 / 1200 Hz) layered in on the way up
    aah = fft_band(x, 600, 800) * 2.0 + fft_band(x, 1050, 1300) * 1.2
    x = x + aah * rise
    # the peak: a shimmer chord two octaves up, blooming at the peak
    shimmer = sum(np.sin(2 * np.pi * mtof(m) * t) for m in (77, 81, 84, 88, 91)) * 0.18
    bloom = np.clip((t - peak_at) / 0.8 + 1, 0, 1) ** 2
    x = x + shimmer * bloom * (1 + 0.3 * np.sin(2 * np.pi * 6 * t))
    amp = 0.15 + 0.85 * rise
    amp = np.where(t > peak_at, 1.0, amp)
    return x * amp * np.minimum(1, t / 1.5)


def reverb(x, tail=2.5, mix=0.35):
    ir_n = int(tail * SR)
    ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR * (6.9 / tail))
    ir = lp(ir, 4000, 1)
    y = np.fft.irfft(np.fft.rfft(x, len(x) + ir_n) * np.fft.rfft(ir, len(x) + ir_n))[: len(x)]
    y /= (np.max(np.abs(y)) or 1) / (np.max(np.abs(x)) or 1)
    return (1 - mix) * x + mix * y


def idle(dur):
    """Car idling: a low 4-cylinder thrum plus cabin rumble."""
    t = t_(dur)
    fire = 26 + 0.6 * np.sin(2 * np.pi * 0.3 * t)
    ph = 2 * np.pi * np.cumsum(fire) / SR
    x = 0.5 * np.sin(ph) + 0.3 * np.sin(2 * ph + 0.4) + 0.15 * np.sign(np.sin(ph)) * 0.3
    x += 0.6 * lp(rng.standard_normal(len(t)), 180, 2)
    return lp(x, 400, 1)


def main(out, cues):
    E, T, P, H, END = cues['else'], cues['trip'], cues['peak'], cues['honk'], cues['end']
    n = int(END * SR); tt = np.arange(n) / SR
    radio = car_radio(lofi(END + 4))
    mix = np.zeros(n)
    # 1. radio from 0 to the honk, filtered away after "anything else?"
    r1 = radio[:n].copy()
    close = np.clip((tt - E) / 2.5, 0, 1)
    r1 = lp(r1, 5200 * (1 - close) ** 2 + 180, 1) * (1 - 0.85 * close)
    r1 *= (tt < T + 1.5)
    mix += 0.8 * r1
    # 2. the pad from the trip to the honk, dead stop on the honk
    pd = pad(H - T + 0.05, P - T)
    i0 = int(T * SR); mix[i0:i0 + len(pd)] += 0.55 * pd[: n - i0] / (np.max(np.abs(pd)) or 1)
    mix[int(H * SR):int((H + 0.02) * SR)] *= np.linspace(1, 0, int(0.02 * SR))
    mix[int((H + 0.02) * SR):] = 0
    # 3. radio resumes after the honk exactly where it was when the trip began (no time passed)
    R = H + 0.7
    src = radio[int(E * SR):]
    k = int(R * SR); seg = src[: n - k]
    fade_in = np.minimum(1, np.arange(len(seg)) / (0.05 * SR))
    mix[k:k + len(seg)] += 0.8 * seg * fade_in
    # 4. engine idle under the real world, gone during the trip
    idl = idle(END)
    world = 1 - np.clip((tt - E) / 3, 0, 1) + np.clip((tt - H) / 0.05, 0, 1)
    mix += 0.35 * idl * np.clip(world, 0, 1)
    # end fade
    mix *= np.clip((END - tt) / 2.0, 0, 1)
    write(f'{out}/music.wav', mix)

    # ---- effects ----
    # speaker squelch: a burst of band-limited noise with a click, like a drive-thru intercom keying up
    d = 0.35; c = fft_band(rng.standard_normal(int(d * SR)), 1500, 4500) * env(int(d * SR), 0.003, 0.09)
    c[: 200] += np.hanning(400)[:200] * 0.8
    write(f'{out}/crackle.wav', c)
    # car horn: two detuned square-ish tones (~420/520 Hz), slightly sagging, 0.9 s, from behind (some room)
    t = t_(0.9)
    h = sum(np.sign(np.sin(2 * np.pi * f * (1 - 0.01 * t) * t)) * 0.5 for f in (420, 523))
    h = lp(h, 2500, 1) * np.minimum(1, t / 0.01) * np.minimum(1, (0.9 - t) / 0.05)
    write(f'{out}/honk.wav', reverb(np.concatenate([h, np.zeros(int(0.6 * SR))]), 0.8, 0.25))
    # record scratch: a short noise+tone sweep down then up
    t = t_(0.45)
    f = 900 * np.where(t < 0.2, 1 - 3.5 * t, 0.3 + 3 * (t - 0.2))
    s = np.sin(2 * np.pi * np.cumsum(np.abs(f)) / SR) * 0.6 + fft_band(rng.standard_normal(len(t)), 500, 5000) * 0.5
    s *= np.sin(np.pi * t / 0.45) ** 0.5
    write(f'{out}/scratch.wav', s)
    # sparkle ting: high bell partials, quick shimmer
    t = t_(1.6)
    g = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t * dcy) for f, a, dcy in ((2637, 1, 3), (3951, 0.5, 4), (5274, 0.35, 6), (7040, 0.2, 9)))
    g *= np.minimum(1, t / 0.002)
    write(f'{out}/ting.wav', reverb(g, 1.5, 0.3))
    # receipt printer: rapid dot-matrix chatter in three bursts
    d = 1.3; p = np.zeros(int(d * SR))
    for k0 in np.arange(0, d, 1 / 38):
        if (k0 % 0.45) < 0.33:
            i = int(k0 * SR); bl = fft_band(rng.standard_normal(500), 1800, 7000) * env(500, 0.0005, 0.004)
            p[i:i + 500] += bl[: len(p) - i]
    write(f'{out}/printer.wav', p)


if __name__ == '__main__':
    main(sys.argv[1], json.load(open(sys.argv[2])))
