"""tools/make-longform-demo.py: build stand-in podcast footage for the long-form demo (examples/longform).

    python tools/make-longform-demo.py            # needs espeak-ng, numpy, opencv-python-headless
    python tools/make-longform-demo.py script     # a voice-only take of examples/longform/physics-of-poker.script.md

Two horizontal 1920x1080 "talking into a mic" clips: a drawn host (no real person), a synthetic espeak-ng
voice, real-sounding problems to fix (ums, false starts, long pauses), and an exact transcript next to
each clip (<clip>.words.json, the same sidecar format the kit reads for your own footage).
The voice is synthesized one word at a time, so every word's timing is exact.
"""
from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import cv2  # type: ignore
import numpy as np  # type: ignore

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "examples" / "longform" / "footage"
FF = next((str(p) for p in (ROOT / "node_modules/ffmpeg-static/ffmpeg", ROOT / "node_modules/ffmpeg-static/ffmpeg.exe") if p.exists()), "ffmpeg")
W, H, FPS, SR = 1920, 1080, 30, 22050

# "|" = a long pause (a breath the editor should tighten). "um"/"uh" are fillers it should cut.
CLIPS = {
    "podcast-ep1": dict(skin=(150, 180, 220), shirt=(70, 60, 160), text="""
So um here's the thing about poker that nobody tells you. |
Before the cards are turned over, your opponent's hand is not one hand. It's every hand at once. |
Physicists have a word for that. Superposition. |
Uh a quantum particle doesn't have one position until you measure it. It's a cloud of possibilities, each with a probability. |
And that's exactly what a good player sees. Not aces. Not a bluff. A spread of hands, weighted by everything they've seen so far. |
Then the river card comes. Boom. The wave function collapses. |
Uh the measurement. Measurement changes the system. In poker every bet you make is a measurement, and it changes what your opponent does next. |
So the best players aren't guessing. They're running um they're running the probabilities, and updating every single street.
"""),
    "podcast-ep2": dict(skin=(120, 160, 200), shirt=(40, 120, 90), text="""
Okay so let's talk about bluffing. |
A bluff is basically noise injected into the signal. |
You want the other player to measure the wrong thing. You show them strength when the hand is weak. |
And uh the crazy part is, the bluff only works if you also bet your strong hands the same way. Otherwise the pattern gives you away. |
That's the deception. Not lying once. Making every observation look the same.
"""),
}
FILLERS = {"um", "uh"}


def say(word: str, tmp: Path) -> np.ndarray:
    wav = tmp / "w.wav"
    spoken = {"um": "umm", "uh": "uhh"}.get(word.lower().strip(",.?!"), word)
    subprocess.run(["espeak-ng", "-v", "en-us", "-s", "175", "-p", "38", "-w", str(wav), spoken], check=True)
    with wave.open(str(wav)) as f:
        sr = f.getframerate()
        a = np.frombuffer(f.readframes(f.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    if sr != SR:
        a = np.interp(np.linspace(0, len(a), int(len(a) * SR / sr), endpoint=False), np.arange(len(a)), a)
    nz = np.nonzero(np.abs(a) > 0.01)[0]   # trim espeak's silence so word timings are tight
    return a[nz[0]:nz[-1] + 1] if len(nz) else a


def synth(text: str, tmp: Path):
    audio, words, t = [], [], 0.4
    audio.append(np.zeros(int(0.4 * SR), np.float32))
    for chunk in text.split():
        if chunk == "|":
            gap = 1.35
            audio.append(np.zeros(int(gap * SR), np.float32)); t += gap; continue
        a = say(chunk, tmp)
        d = len(a) / SR
        words.append({"w": chunk, "s": round(t, 3), "e": round(t + d, 3)})
        audio.append(a); t += d
        gap = 0.32 if chunk[-1] in ".?!" else 0.22 if chunk[-1] == "," else 0.06
        if chunk.lower().strip(",.") in FILLERS:
            gap = 0.45
        audio.append(np.zeros(int(gap * SR), np.float32)); t += gap
    audio.append(np.zeros(int(0.6 * SR), np.float32))
    return np.concatenate(audio) * 0.9, words


def draw_frame(t, level, skin, shirt, label):
    img = np.zeros((H, W, 3), np.uint8)
    for y in range(0, H, 8):   # studio wall gradient
        c = 22 + int(18 * y / H)
        img[y:y + 8] = (c + 6, c, c - 4)
    cv2.rectangle(img, (1260, 160), (1760, 560), (40, 46, 70), -1)            # acoustic panel
    for i in range(6):
        cv2.line(img, (1260 + i * 100, 160), (1260 + i * 100, 560), (34, 38, 58), 6)
    cv2.circle(img, (1580, 720), 60, (30, 140, 230), -1)                      # warm lamp glow
    sway = int(6 * math.sin(t * 1.3))
    cx, cy = 820 + sway, 470
    cv2.ellipse(img, (cx, 1080), (330, 260), 0, 180, 360, shirt, -1)          # shoulders
    cv2.rectangle(img, (cx - 60, 640), (cx + 60, 760), tuple(int(c * 0.9) for c in skin), -1)
    cv2.ellipse(img, (cx, cy), (185, 225), 0, 0, 360, skin, -1)               # head
    cv2.ellipse(img, (cx, cy - 150), (195, 110), 0, 180, 360, (40, 40, 50), -1)  # hair
    blink = (t % 4.1) < 0.12
    for ex in (-70, 70):
        if blink:
            cv2.line(img, (cx + ex - 22, cy - 20), (cx + ex + 22, cy - 20), (30, 30, 30), 5)
        else:
            cv2.circle(img, (cx + ex, cy - 20), 15, (30, 30, 30), -1)
    mouth = int(6 + 40 * level)
    cv2.ellipse(img, (cx, cy + 105), (55, mouth), 0, 0, 360, (40, 30, 90), -1)
    cv2.rectangle(img, (1010, 520), (1090, 740), (60, 60, 66), -1)            # microphone
    cv2.circle(img, (1050, 520), 70, (90, 90, 98), -1)
    for k in range(-50, 60, 16):
        cv2.line(img, (1000, 520 + k), (1100, 520 + k), (70, 70, 76), 3)
    cv2.line(img, (1050, 740), (1250, 1080), (60, 60, 66), 14)                # boom arm
    cv2.putText(img, label, (60, 1040), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (120, 120, 130), 2, cv2.LINE_AA)
    return img


def build(name, spec, tmp):
    audio, words = synth(" ".join(spec["text"].split()), tmp)
    wav = tmp / f"{name}.wav"
    with wave.open(str(wav), "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
    dur = len(audio) / SR
    n = int(dur * FPS)
    hop = SR // FPS
    env = np.array([np.sqrt(np.mean(audio[i * hop:(i + 1) * hop] ** 2)) if i * hop < len(audio) else 0 for i in range(n)])
    env = np.clip(env / (env.max() + 1e-6) * 1.6, 0, 1)
    out = OUT / f"{name}.mp4"
    p = subprocess.Popen([FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS),
                          "-i", "pipe:0", "-i", str(wav), "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
                          "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", str(out)], stdin=subprocess.PIPE)
    for i in range(n):
        p.stdin.write(draw_frame(i / FPS, env[i], spec["skin"], spec["shirt"], f"DEMO STAND-IN  {name}").tobytes())
    p.stdin.close(); p.wait()
    (OUT / f"{name}.words.json").write_text(json.dumps({"words": words}, indent=0))
    print(f"wrote {out}  ({dur:.1f}s, {len(words)} words)")


def script_take(tmp):
    """A voice-only 'recording' of examples/longform/physics-of-poker.read.txt, read the way people really
    read: one restarted line (a retake the aligner should cut), one ad-lib, a couple of ums."""
    read = (ROOT / "examples/longform/physics-of-poker.read.txt").read_text()
    lines = [l.strip() for l in read.splitlines() if l.strip() and not l.startswith("\u2014") and not l.isupper()]
    text = " | ".join(lines)
    text = text.replace("Here's the part most players miss.", "Here's the part most uh most | Here's the part most players miss.")
    text = text.replace("Superposition.", "Superposition. Weird word, I know.")
    text = text.replace("Then the river card comes.", "So um then the river card comes.")
    audio, words = synth(text, tmp)
    wav = tmp / "take.wav"
    with wave.open(str(wav), "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
    out = OUT / "poker-take1.m4a"
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", str(wav), "-c:a", "aac", "-b:a", "64k", str(out)], check=True)
    (OUT / "poker-take1.words.json").write_text(json.dumps({"words": words}, indent=0))
    print(f"wrote {out}  ({len(audio) / SR:.1f}s, {len(words)} words, voice only)")


def main():
    if not shutil.which("espeak-ng"):
        sys.exit("needs espeak-ng (apt install espeak-ng / brew install espeak-ng)")
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="mf-lf-"))
    if "script" in sys.argv[1:]:
        script_take(tmp)
    else:
        for name, spec in CLIPS.items():
            build(name, spec, tmp)
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
