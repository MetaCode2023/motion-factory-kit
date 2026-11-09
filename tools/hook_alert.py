"""tools/hook_alert.py: a 3-second cold-open hook, "something just happened -> a system reacts", built
before the speaker comes in. Picture, timed SFX and a low drone, with the stems kept. Docs: docs/OVERLAYS.md.

    python tools/hook_alert.py spec.json OUT_DIR [--fps 30]

Spec (every field optional; defaults reproduce the example in examples/overlays/hook.json):
  headline      ["A BILLIONAIRE", "JUST DIED."]   on screen at frame 0, big
  monitor       S("monitor", "BILLIONAIRE · AGE 84")            heart-monitor label; it beats, then flatlines at 0.95 s
  panel         S("panel", "AI AGENT · ESTATE EVENT")         the alert panel's header bar (slams in at 1.2 s)
  detect        ["ESTATE DETECTED", "$1,000,000,000"]
  rows          [["UNREALIZED GAINS", "$900,000,000"], ["RATE", "FLAT 10%"]]
  total         ["TAX DUE", 90000000, "$"]        label, number it counts up to, prefix
  stamp         "SENT"
  punchline     "AN AI SENT THE BILL."            lands at 2.25 s in an accent bar
  accent        "#00D7FE"                         default: brand.js colors.accent
Only use figures the speaker actually says or shows. The hook must set up what the clip delivers.
"""
import argparse, math, subprocess, sys, wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from overlay import font, HEAD, BODY, BODY_B, MONO, ACCENT as BRAND_ACCENT, FF  # noqa: E402
import json  # noqa: E402

SPEC = {}
def S(k, d): return SPEC.get(k, d)

W, H, DUR = 1080, 1920, 3.0
SR = 44100
INK = (3, 6, 12)
PAPER = (245, 247, 250)
RED = (255, 59, 72)
GREEN = (60, 230, 140)


def clamp(x): return max(0.0, min(1.0, x))
def out_expo(x): x = clamp(x); return 1 if x >= 1 else 1 - 2 ** (-10 * x)
def out_back(x, s=1.9): x = clamp(x) - 1; return 1 + (s + 1) * x ** 3 + s * x ** 2
def money(v): return "${:,.0f}".format(v)


def ecg(phase):
    """One heartbeat shape over phase 0..1 (PQRST), amplitude ~ -1..1."""
    p = phase % 1.0
    g = lambda c, w, a: a * math.exp(-((p - c) / w) ** 2)
    return g(0.18, 0.025, 0.12) - g(0.30, 0.008, 0.18) + g(0.32, 0.010, 1.0) - g(0.345, 0.010, 0.32) + g(0.55, 0.045, 0.22)


def background(accent):
    bg = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(bg)
    for x in range(0, W, 60):
        d.line((x, 0, x, H), fill=(10, 22, 34))
    for y in range(0, H, 60):
        d.line((0, y, W, y), fill=(10, 22, 34))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse((140, 640, 940, 1440), fill=tuple(int(c * 0.22) for c in accent))
    glow = glow.filter(ImageFilter.GaussianBlur(160))
    return Image.fromarray(np.clip(np.array(bg, np.int16) + np.array(glow, np.int16), 0, 255).astype(np.uint8))


def headline(d, t, accent):
    f = font(HEAD, 132)
    lines = [(x, PAPER) for x in S("headline", ["A BILLIONAIRE", "JUST DIED."])]
    for i, (txt, col) in enumerate(lines):
        k = out_expo((t + 0.25 - i * 0.06) / 0.45)        # already mostly risen at t=0 (never fades from 0)
        d.text((90, 250 + i * 138 + 30 * (1 - k)), txt, font=f, fill=col)
    if t >= 2.25:
        k = out_expo((t - 2.25) / 0.35)
        f2 = font(HEAD, 104)
        txt = S("punchline", "AN AI SENT THE BILL.")
        tw = d.textlength(txt, font=f2)
        y = 1490 + 30 * (1 - k)
        d.rounded_rectangle((78, y - 6, 78 + (tw + 30) * k, y + 112), radius=14, fill=accent)
        if k > 0.6:
            d.text((93, y), txt, font=f2, fill=INK)


def monitor(d, t, accent, layer):
    x0, y0, x1, y1 = 90, 600, 990, 1060
    d.rounded_rectangle((x0, y0, x1, y1), radius=26, outline=(40, 70, 90), width=3, fill=(6, 12, 20))
    d.text((x0 + 34, y0 + 26), S("monitor", "BILLIONAIRE · AGE 84"), font=font(MONO, 34), fill=(150, 170, 185))
    flat = t >= 0.95
    bpm = "72" if t < 0.95 else "0"
    col = RED if flat else accent
    fb = font(HEAD, 120)
    d.text((x1 - 34 - d.textlength(bpm, font=fb), y0 + 8), bpm, font=fb, fill=col)
    d.text((x1 - 34 - 80, y0 + 130), "BPM", font=font(MONO, 28), fill=(150, 170, 185))
    # trace: sweep cursor moves left->right; drawn as a polyline over the last ~0.9 of the panel
    mid = (y0 + y1) / 2 + 40
    pts = []
    sweep = 1.25  # seconds per screen width
    for px in range(x0 + 30, x1 - 30, 3):
        age = ((x1 - 30) - px) / ((x1 - 30) - (x0 + 30)) * sweep   # seconds ago this pixel was drawn
        ts = t - age
        if ts < -0.6:
            continue
        v = 0 if ts >= 0.95 else ecg(ts * 1.2)   # 72 BPM
        pts.append((px, mid - v * 150))
    if len(pts) > 1:
        layer.line(pts, fill=col, width=8, joint="curve")
        d.line(pts, fill=col, width=6, joint="curve")
        d.line(pts, fill=(220, 250, 255) if not flat else (255, 200, 205), width=2, joint="curve")


def alert(img, t, accent):
    if t < 1.2:
        return
    k = out_back((t - 1.2) / 0.32)
    pw, ph = 960, 620
    panel = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
    d = ImageDraw.Draw(panel)
    d.rounded_rectangle((0, 0, pw - 1, ph - 1), radius=30, fill=(8, 16, 26, 245), outline=accent, width=5)
    d.rectangle((0, 0, pw, 86), fill=accent)
    d.text((34, 18), S("panel", "AI AGENT · ESTATE EVENT"), font=font(MONO, 40), fill=INK)
    det = S("detect", ["ESTATE DETECTED", "$1,000,000,000"])
    d.text((34, 118), det[0], font=font(MONO, 34), fill=(150, 170, 185))
    d.text((34, 160), det[1], font=font(HEAD, 120), fill=PAPER)
    rows = [(1.45 + i * 0.13, a_, b_) for i, (a_, b_) in enumerate(S("rows", [["UNREALIZED GAINS", "$900,000,000"], ["RATE", "FLAT 10%"]])[:2])]
    y = 312
    for at, a, b in rows:
        if t >= at:
            fr = font(BODY, 40)
            d.text((34, y), a, font=fr, fill=(170, 185, 200))
            d.text((pw - 34 - d.textlength(b, font=font(BODY_B, 44)), y - 2), b, font=font(BODY_B, 44), fill=PAPER)
        y += 64
    if t >= 1.7:
        d.line((34, y + 4, pw - 34, y + 4), fill=(50, 80, 100), width=3)
        lab, target, pre = (S("total", ["TAX DUE", 90000000, "$"]) + ["$"])[:3]
        v = float(target) * out_expo((t - 1.7) / 0.5)
        d.text((34, y + 28), lab, font=font(BODY_B, 46), fill=accent)
        step = 10 ** max(0, len(str(int(float(target)))) - 3)
        s = pre + "{:,.0f}".format(round(v / step) * step)
        fb = font(HEAD, 96)
        d.text((pw - 34 - d.textlength(s, font=fb), y + 4), s, font=fb, fill=accent)
    sc = 0.6 + 0.4 * k
    panel = panel.resize((max(1, int(pw * sc)), max(1, int(ph * sc))), Image.LANCZOS)
    a = clamp((t - 1.2) / 0.12)
    if a < 1:
        panel.putalpha(panel.getchannel("A").point(lambda v: int(v * a)))
    img.alpha_composite(panel, ((W - panel.width) // 2, 905 - panel.height // 2))
    if t >= 2.25:   # SENT stamp
        ks = out_back((t - 2.25) / 0.25, 2.4)
        st = Image.new("RGBA", (420, 150), (0, 0, 0, 0))
        sd = ImageDraw.Draw(st)
        sd.rounded_rectangle((4, 4, 416, 146), radius=20, outline=GREEN, width=10)
        sd.text((40, 18), S("stamp", "SENT"), font=font(HEAD, 112), fill=GREEN)
        sd.line((300, 76, 336, 112, 392, 38), fill=GREEN, width=16, joint="curve")
        sz = 1.8 - 0.8 * ks
        st = st.resize((int(420 * sz), int(150 * sz)), Image.LANCZOS).rotate(-8, expand=True, resample=Image.BICUBIC)
        img.alpha_composite(st, (640 - st.width // 2, 1250 - st.height // 2))


def frame(t, base, accent):
    img = base.copy().convert("RGBA")
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    d = ImageDraw.Draw(img)
    monitor(d, t, accent, gd)
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(img)
    monitor(d, t, accent, ImageDraw.Draw(Image.new("RGBA", (1, 1))))
    alert(img, t, accent)
    d = ImageDraw.Draw(img)
    headline(d, t, accent)
    # slow push-in (no frame is static) + red flash on flatline
    z = 1 + 0.035 * t / DUR
    if z > 1:
        w2, h2 = int(W / z), int(H / z)
        img = img.crop(((W - w2) // 2, (H - h2) // 2, (W + w2) // 2, (H + h2) // 2)).resize((W, H), Image.LANCZOS)
    if 0.95 <= t < 1.15:
        flash = Image.new("RGBA", (W, H), RED + (int(70 * (1 - (t - 0.95) / 0.2)),))
        img.alpha_composite(flash)
    return img.convert("RGB")


# ---------------------------------------------------------------- sound
def sfx():
    n = int(SR * (DUR + 0.6))
    out = np.zeros(n)
    tt = lambda d: np.arange(int(SR * d)) / SR
    def add(at, sig):
        i = int(at * SR); out[i:i + len(sig)] += sig[: n - i]
    env = lambda x, a, r: np.minimum(1, x / a) * np.exp(-x / r)
    for b in (0.0, 0.5):                                       # monitor beeps (72 BPM is 0.83 s; quickened for tension)
        x = tt(0.13); add(b + 0.32 / 1.2, 0.28 * np.sin(2 * np.pi * 1000 * x) * np.minimum(1, (0.13 - x) / 0.02))
    x = tt(0.65); add(0.95, 0.26 * np.sin(2 * np.pi * 1000 * x) * np.minimum(1, (0.65 - x) / 0.25))  # flatline tone
    x = tt(0.5)                                                # slam: low thump + noise burst
    thump = np.sin(2 * np.pi * (55 + 90 * np.exp(-x / 0.05)) * x) * env(x, 0.003, 0.14)
    noise = np.random.default_rng(1).standard_normal(len(x)) * env(x, 0.001, 0.05)
    add(1.2, 0.75 * thump + 0.2 * noise)
    for i in range(12):                                        # count-up ticks
        x = tt(0.02); add(1.7 + i * 0.042, 0.18 * np.sin(2 * np.pi * 3200 * x) * np.exp(-x / 0.004))
    x = tt(0.8)                                                # stamp: thump + bright two-note chime
    add(2.25, 0.6 * np.sin(2 * np.pi * (70 + 60 * np.exp(-x / 0.04)) * x) * env(x, 0.002, 0.12))
    for f0, d0 in ((1318.5, 0.0), (1975.5, 0.07)):
        y = tt(0.7); add(2.27 + d0, 0.16 * np.sin(2 * np.pi * f0 * y) * env(y, 0.004, 0.18))
    x = tt(0.55)                                               # whoosh into the cut (filtered noise swell)
    wn = np.random.default_rng(2).standard_normal(len(x))
    wn = np.convolve(wn, np.ones(24) / 24, mode="same")
    add(2.55, 0.9 * wn * np.sin(np.pi * x / 0.55) ** 2)
    return out


def drone():
    n = int(SR * DUR); x = np.arange(n) / SR
    sig = 0.10 * np.sin(2 * np.pi * 55 * x) + 0.05 * np.sin(2 * np.pi * 82.4 * x) + 0.03 * np.sin(2 * np.pi * 110 * x * (1 + 0.002 * x))
    sig *= np.minimum(1, x / 0.05) * np.minimum(1, (DUR - x) / 0.25)
    sig[int(0.95 * SR):] *= 1.6                                  # tension rises after the flatline
    return sig


def write_wav(path, mono, peak_db=-1.0):
    peak = np.max(np.abs(mono)) or 1
    mono = mono / peak * 10 ** (peak_db / 20)
    st = np.repeat((mono * 32767).astype(np.int16)[:, None], 2, axis=1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(st.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec"); ap.add_argument("out"); ap.add_argument("--fps", type=float, default=30)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    SPEC.update(json.loads(Path(a.spec).read_text()))
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    acc = SPEC.get("accent")
    accent = tuple(int(acc.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)) if acc else BRAND_ACCENT
    s, dr = sfx(), drone()
    write_wav(out / "hook_sfx.wav", s, -3); write_wav(out / "hook_drone.wav", dr, -12)
    mix = s / np.max(np.abs(s)) * 10 ** (-3 / 20)
    mix[: len(dr)] += dr / np.max(np.abs(dr)) * 10 ** (-14 / 20)
    write_wav(out / "hook_mix.wav", mix[: int(SR * DUR)], -1.5)
    base = background(accent)
    frames = int(round(DUR * a.fps))
    p = subprocess.Popen([FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                          "-r", str(a.fps), "-i", "pipe:0", "-i", str(out / "hook_mix.wav"), "-c:v", "libx264",
                          "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                          "-shortest", str(out / "hook.mp4")], stdin=subprocess.PIPE)
    for i in range(frames):
        p.stdin.write(frame(i / a.fps, base, accent).tobytes())
    p.stdin.close(); p.wait()
    print(f"wrote {out / 'hook.mp4'} ({frames} frames) + stems")
    if a.json:
        print(json.dumps({"ok": True, "video": str(out / "hook.mp4"), "duration": DUR,
                          "stems": [str(out / n) for n in ("hook_sfx.wav", "hook_drone.wav", "hook_mix.wav")]}))


if __name__ == "__main__":
    main()
