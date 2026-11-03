"""tools/make-demo-footage.py: build the demo "street interview" footage in examples/demo/footage.

    pip install opencv-python-headless numpy espeakng-loader
    python tools/make-demo-footage.py

Everything is made here, so nobody real is shown saying anything: cartoon people drawn with OpenCV,
synthetic voices from espeak-ng, street noise, wind. Clips are horizontal (1280x720, like a camera
shoot) so the reframing has work to do. Each clip gets an exact transcript next to it
(<clip>.words.json, with speakers: A = the host, off camera; B = the person answering), which is
the same sidecar format you can drop next to your own footage.
You only need this to regenerate the pack; the clips are committed.
"""
from __future__ import annotations

import ctypes
import json
import math
import os
import subprocess
import sys
from pathlib import Path

import cv2  # type: ignore
import numpy as np  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "examples" / "demo" / "footage"
FF = next((p for p in (ROOT / "node_modules/ffmpeg-static/ffmpeg", ROOT / "node_modules/ffmpeg-static/ffmpeg.exe") if p.exists()), Path("ffmpeg"))
W, H, FPS, SR = 1280, 720, 30, 22050

# ---- voices ------------------------------------------------------------------------------------
import espeakng_loader as E  # type: ignore

_lib = ctypes.CDLL(E.get_library_path())


class _Ev(ctypes.Structure):
    _fields_ = [("type", ctypes.c_int), ("uid", ctypes.c_uint), ("text_position", ctypes.c_int), ("length", ctypes.c_int),
                ("audio_position", ctypes.c_int), ("sample", ctypes.c_int), ("user_data", ctypes.c_void_p), ("id", ctypes.c_char * 8)]


_CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.POINTER(_Ev))
_sr = _lib.espeak_Initialize(2, 500, os.path.dirname(E.get_data_path()).encode(), 0)
assert _sr == SR, _sr
_buf: list = []
_events: list = []


def _cb(wav, n, ev):
    if n > 0:
        _buf.append(np.ctypeslib.as_array(wav, shape=(n,)).astype(np.float32) / 32768)
    i = 0
    while ev[i].type != 0:
        if ev[i].type == 1:   # word
            _events.append((ev[i].text_position, ev[i].length, ev[i].sample))
        i += 1
    return 0


_cbref = _CB(_cb)
_lib.espeak_SetSynthCallback(_cbref)


def say(text: str, voice: str, rate: int = 165, pitch: int = 50):
    """-> (samples float32, words [(word, start_s, end_s)])"""
    _buf.clear(); _events.clear()
    _lib.espeak_SetVoiceByName(voice.encode())
    _lib.espeak_SetParameter(1, rate, 0)    # rate
    _lib.espeak_SetParameter(3, pitch, 0)   # pitch
    b = text.encode()
    _lib.espeak_Synth(b, len(b) + 1, 0, 1, 0, 0, None, None)
    _lib.espeak_Synchronize()
    audio = np.concatenate(_buf) if _buf else np.zeros(1, np.float32)
    # espeak reports word starts by character position, but folds some short words ("a", "the") into
    # their neighbour. Time every word of the original text: matched words take their event, the rest
    # share the span of the word they were folded into.
    import re
    tokens = [(m.start() + 1, m.group()) for m in re.finditer(r"\S+", text)]
    at = {pos: smp for (pos, _ln, smp) in _events}
    starts, last = [], 0
    for pos, _w in tokens:
        smp = next((at[p] for p in range(pos, pos + 3) if p in at), None)
        starts.append(smp)
    known = [i for i, v in enumerate(starts) if v is not None]
    for i in range(len(starts)):
        if starts[i] is None:   # between the neighbouring known words
            prev = max([k for k in known if k < i], default=None)
            nxt = min([k for k in known if k > i], default=None)
            a0 = starts[prev] if prev is not None else 0
            a1 = starts[nxt] if nxt is not None else len(audio)
            span = (nxt if nxt is not None else len(starts)) - (prev if prev is not None else -1)
            starts[i] = int(a0 + (a1 - a0) * (i - (prev if prev is not None else -1)) / span)
    words = []
    for k, (pos, w) in enumerate(tokens):
        smp = starts[k]
        nxt = starts[k + 1] if k + 1 < len(tokens) else len(audio)
        seg = np.abs(audio[smp:max(smp + 1, nxt)])
        loud = np.nonzero(seg > 0.02)[0]
        end = smp + (loud[-1] + 1 if len(loud) else len(seg))
        words.append((w, smp / SR, end / SR))
    return audio, words


# ---- drawing -----------------------------------------------------------------------------------
def street(t: float, seed: int, cam_x: float) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = np.zeros((H, W, 3), np.uint8)
    sky = np.linspace(0, 1, H)[:, None]
    img[:] = (np.stack([200 - 60 * sky, 190 - 50 * sky, 170 - 40 * sky], -1)).astype(np.uint8)
    off = int(cam_x)
    x = -200
    while x < W + 400:   # buildings
        bw, bh = int(rng.integers(140, 260)), int(rng.integers(260, 560))
        col = tuple(int(c) for c in rng.integers(70, 150, 3))
        x0 = x - off // 2
        cv2.rectangle(img, (x0, H - 160 - bh), (x0 + bw, H - 160), col, -1)
        for wy in range(H - 140 - bh, H - 190, 48):
            for wx in range(x0 + 16, x0 + bw - 30, 40):
                cv2.rectangle(img, (wx, wy), (wx + 20, wy + 26), (min(255, col[0] + 70), min(255, col[1] + 70), min(255, col[2] + 50)), -1)
        x += bw + int(rng.integers(6, 30))
    cv2.rectangle(img, (0, H - 160), (W, H), (90, 92, 96), -1)          # sidewalk
    cv2.rectangle(img, (0, H - 70), (W, H), (60, 62, 66), -1)           # road
    for k in range(3):                                                   # passing cars
        cx = int((t * (180 + 70 * k) + k * 700 + seed * 130) % (W + 600)) - 300 - off
        cv2.rectangle(img, (cx, H - 66), (cx + 220, H - 18), [(40, 60, 170), (150, 150, 150), (170, 90, 40)][k], -1)
    return cv2.GaussianBlur(img, (0, 0), 3.5)    # shallow depth of field


def person(img, cx: float, cy: float, s: float, look: dict, mouth: float, blink: bool):
    skin, hair, shirt = look["skin"], look["hair"], look["shirt"]
    p = lambda x, y: (int(cx + x * s), int(cy + y * s))
    cv2.ellipse(img, p(0, 300), (int(190 * s), int(180 * s)), 0, 180, 360, shirt, -1)          # shoulders
    cv2.rectangle(img, p(-190, 300), p(190, 600), shirt, -1)
    cv2.rectangle(img, p(-34, 70), p(34, 140), skin, -1)                                         # neck
    cv2.ellipse(img, p(0, 0), (int(96 * s), int(124 * s)), 0, 0, 360, skin, -1)                  # head
    cv2.ellipse(img, p(-98, 10), (int(14 * s), int(28 * s)), 0, 0, 360, skin, -1)                # ears
    cv2.ellipse(img, p(98, 10), (int(14 * s), int(28 * s)), 0, 0, 360, skin, -1)
    cv2.ellipse(img, p(0, -62), (int(104 * s), int(68 * s)), 0, 180, 360, hair, -1)              # hair
    if look.get("cap"):
        cv2.ellipse(img, p(0, -70), (int(106 * s), int(64 * s)), 0, 180, 360, look["cap"], -1)
        cv2.ellipse(img, p(40, -72), (int(110 * s), int(18 * s)), 0, 0, 180, look["cap"], -1)
    for dx in (-36, 36):
        if blink:
            cv2.line(img, p(dx - 16, 0), p(dx + 16, 0), (40, 30, 30), max(2, int(4 * s)))
        else:
            cv2.ellipse(img, p(dx, 0), (int(18 * s), int(11 * s)), 0, 0, 360, (250, 250, 250), -1)
            cv2.circle(img, p(dx, 0), int(8 * s), (40, 30, 25), -1)
        cv2.line(img, p(dx - 20, -26), p(dx + 20, -30), hair, max(3, int(6 * s)))                # brows
    cv2.polylines(img, [np.array([p(0, 4), p(-12, 44), p(10, 44)])], False, tuple(int(c * 0.82) for c in skin), max(2, int(4 * s)))
    h = int((4 + 26 * mouth) * s)
    cv2.ellipse(img, p(0, 76), (int(30 * s), max(2, h)), 0, 0, 360, (60, 50, 140), -1)           # mouth


LOOKS = [
    {"skin": (150, 180, 225), "hair": (40, 50, 70), "shirt": (60, 120, 200)},
    {"skin": (90, 130, 180), "hair": (25, 25, 30), "shirt": (160, 110, 60), "cap": (40, 40, 160)},
    {"skin": (170, 200, 240), "hair": (60, 120, 190), "shirt": (90, 160, 90)},
    {"skin": (110, 150, 200), "hair": (20, 20, 20), "shirt": (120, 60, 140)},
]


def envelope(audio: np.ndarray, t: float) -> float:
    i = int(t * SR)
    seg = audio[max(0, i - 600): i + 600]
    return float(min(1.0, np.sqrt(np.mean(seg ** 2)) * 9)) if len(seg) else 0.0


def noise(n: int, seed: int, wind: float) -> np.ndarray:
    rng = np.random.default_rng(seed)
    traffic = np.convolve(rng.normal(0, 1, n), np.ones(24) / 24, "same") * 0.06
    rumble = np.convolve(rng.normal(0, 1, n), np.ones(500) / 500, "same") * 1.2 * wind
    return (traffic + rumble).astype(np.float32)


def clip(name: str, lines: list, look: int, dur: float, seed: int, walk: float = 0.0, wind: float = 0.0, broll: bool = False):
    """lines: [(speaker 'A'|'B', at seconds, text, gain)]. A = host off camera, B = the person on camera."""
    n = int(dur * SR)
    host, guest, words, free = np.zeros(n, np.float32), np.zeros(n, np.float32), [], 0.0
    for sp, at, text, gain in lines:
        audio, ws = say(text, "en-us+m3" if sp == "A" else ["en-us+f3", "en-us+m1", "en-us+f4", "en-us+m4"][look], rate=160, pitch=45 if sp == "A" else 55)
        at = max(at, free)                # people don't talk over each other here
        free = at + len(audio) / SR + 0.45
        i = int(at * SR)
        tgt = host if sp == "A" else guest
        tgt[i: i + len(audio)] += audio[: max(0, n - i)] * gain
        words += [{"w": w, "s": round(at + s, 3), "e": round(at + e, 3), "sp": sp} for (w, s, e) in ws]
    mix = np.clip(host + guest + noise(n, seed, wind), -1, 1)
    wav = OUT / f"{name}.wav"
    import wave
    with wave.open(str(wav), "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR); f.writeframes((mix * 32000).astype(np.int16).tobytes())
    out = OUT / f"{name}.mp4"
    proc = subprocess.Popen([str(FF), "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                             "-i", str(wav), "-c:v", "libx264", "-preset", "slow", "-crf", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", str(out)],
                            stdin=subprocess.PIPE)
    for f in range(int(dur * FPS)):
        t = f / FPS
        shake = (math.sin(t * 2.1 + seed) * 6, math.sin(t * 1.7 + seed * 2) * 4)   # handheld
        img = street(t, seed, shake[0] + walk * t * 40)
        if broll:
            cv2.ellipse(img, (640, 600), (260, 40), 0, 0, 360, (70, 90, 120), -1)               # table
            cv2.rectangle(img, (570, 380), (710, 590), (30, 60, 110), -1)                          # a cup
            cv2.rectangle(img, (570, 440), (710, 520), (230, 230, 230), -1)
            cv2.putText(img, "COLD BREW", (582, 492), cv2.FONT_HERSHEY_DUPLEX, 0.8, (30, 60, 110), 2)
        else:
            cx = 640 + walk * (t / dur - 0.5) * 900 + shake[0] * 2 + (0 if walk else 180 * math.sin(seed))
            blink = (t * 1.3 + seed) % 3.1 < 0.12
            person(img, cx, 300 + shake[1], 1.0, LOOKS[look], envelope(guest, t), blink)
        cv2.putText(img, "SYNTHETIC DEMO FOOTAGE", (24, H - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (235, 235, 235), 1, cv2.LINE_AA)
        proc.stdin.write(img.tobytes())
    proc.stdin.close(); proc.wait(); wav.unlink()
    if words:
        (OUT / f"{name}.words.json").write_text(json.dumps(words))
    print(f"  {out.relative_to(ROOT)}  {dur:.1f}s  {len(words)} words")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # A fictional cold brew street poll. Host (A) asks off camera; each person (B) answers on camera.
    clip("street-01", [("A", 0.3, "Quick question. Would you pay eight dollars for a cold brew?", 0.9),
                       ("B", 0.0, "Eight dollars? That is a lot. Honestly, if it tastes this good, yes. I would.", 0.22)], look=0, dur=10.5, seed=1)
    clip("street-02", [("A", 0.2, "What do you drink in the morning?", 0.9),
                       ("B", 0.0, "Iced coffee, every single day. Even in winter. My friends think I am crazy.", 0.2)], look=1, dur=8.0, seed=2, walk=1.0)
    clip("street-03", [("B", 0.4, "I would switch tomorrow. It is smoother than what I buy now, and it is not bitter at all.", 0.12)], look=2, dur=6.5, seed=3, wind=1.0)
    clip("street-04", [("A", 0.3, "Would you pay eight dollars for a cold brew?", 0.9),
                       ("B", 0.0, "No way. Four, maybe five. Eight is too much for me.", 0.2)], look=3, dur=7.5, seed=5)
    clip("broll-cup", [], look=0, dur=4.0, seed=4, broll=True)


if __name__ == "__main__":
    sys.exit(main())
