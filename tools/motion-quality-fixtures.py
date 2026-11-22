"""Render synthetic motion-quality calibration clips. Requires Pillow, FFmpeg with flite."""
import argparse
import hashlib
import json
import math
import subprocess
import wave
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

FPS = 30
DURATION = 6
CASES = [
    ("continuity", "Keep the speaker visible", "The same face stays visible through the reveal."),
    ("cue_timing", "Land on the spoken cue", "The move begins on the word Watch."),
    ("caption_clearance", "Give captions their own space", "Captions and the graphic labels stay separate."),
    ("evidence_legibility", "Make the comparison readable", "The two values are large and easy to find."),
    ("hold_duration", "Hold the result", "The result stays up long enough to read."),
]
SCRIPT = [
    (0.22, "Two signals."),
    (1.78, "Watch"),
    (2.50, "the wave repeat."),
    (4.05, "One cycle. Two cycles."),
]
FONT = Path("C:/Windows/Fonts")
def font(size, bold=False):
    names = ["segoeuib.ttf", "DejaVuSans-Bold.ttf"] if bold else ["segoeui.ttf", "DejaVuSans.ttf"]
    for name in names:
        try:
            return ImageFont.truetype(str(FONT / name) if name.startswith("segoe") else name, size)
        except OSError:
            continue
    raise RuntimeError("Install Segoe UI or DejaVu Sans")

F = {size: font(size) for size in (10, 12, 14, 17, 18, 20, 22)}
B = {size: font(size, True) for size in (12, 14, 18, 20, 22, 26, 32, 40, 45, 48)}

def ease(t):
    t = min(1, max(0, t))
    return t * t * (3 - 2 * t)

def make_portrait():
    im = Image.new("RGBA", (180, 180))
    d = ImageDraw.Draw(im)
    d.ellipse((2, 2, 178, 178), fill="#253a5c", outline="#9cbaff", width=4)
    d.ellipse((23, 94, 157, 177), fill="#879df0")
    d.rounded_rectangle((72, 91, 109, 136), radius=12, fill="#d48c68")
    d.ellipse((52, 29, 129, 121), fill="#f0ac81")
    d.pieslice((45, 14, 135, 93), 174, 360, fill="#19182a")
    d.ellipse((69, 70, 77, 79), fill="#27243a")
    d.ellipse((102, 70, 110, 79), fill="#27243a")
    d.arc((77, 83, 102, 100), 10, 165, fill="#773d43", width=3)
    return im

PORTRAIT = make_portrait()
def scene(case, good, t, cue):
    im = Image.new("RGB", (600, 338), "#0d1728")
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((12, 12, 588, 326), radius=18, fill="#141f32", outline="#2b3d58", width=2)
    for x in range(35, 565, 24):
        for y in range(76, 286, 24):
            d.point((x, y), fill="#394b67")
    d.text((31, 24), "SIGNAL LAB", font=B[14], fill="#aabdf2")
    d.text((566, 25), "FIELD STUDY", font=F[12], fill="#a5b6d4", anchor="ra")
    start = cue + (0.78 if case == "cue_timing" and not good else 0)
    p = ease((t - start) / 0.68)
    if p > 0.01:
        for i, (count, color) in enumerate(((1, "#78eddb"), (2, "#aeb9ff"))):
            y = 104 + 66 * i
            width = max(2, int(304 * p))
            points = [(55 + x, y + 13 * math.sin(x / 304 * count * math.tau))
                      for x in range(width + 1)]
            d.line((52, y, 360, y), fill="#485a7a", width=1)
            d.line(points, fill=color, width=3)
        if t >= start + .7:
            d.text((380, 97), "Signal A", font=F[17], fill="#78eddb")
            d.text((380, 163), "Signal B", font=F[17], fill="#aeb9ff")
    if p < 1:
        x, y = int(300 + 198*p), int(157 + 82*p)
        ring = int(96 - 44*p)
        d.ellipse((x-ring, y-ring, x+ring, y+ring), outline="#8293cd", width=2)
    if not (case == "continuity" and not good and cue + .13 <= t < cue + 1.16):
        x, y = int(300 + 198*p), int(157 + 82*p)
        size = int(132 - 64*p)
        portrait = PORTRAIT.resize((size, size), Image.Resampling.LANCZOS)
        im.paste(portrait, (x-size//2, y-size//2), portrait)
    show_result = 3.75 <= t < (4.21 if case == "hold_duration" and not good else DURATION)
    if show_result:
        low = case == "evidence_legibility" and not good
        d.rounded_rectangle((46, 208, 414, 267), radius=10, fill="#22304a", outline="#405577")
        d.text((66, 237), "1 cycle", font=F[12] if low else B[26],
               fill="#495774" if low else "#78eddb", anchor="lm")
        d.text((243, 237), "2 cycles", font=F[12] if low else B[26],
               fill="#495774" if low else "#c2cbff", anchor="lm")
    collision = case == "caption_clearance" and not good and t >= 3.75
    if t < 1.65:
        caption = "Two signals."
    elif t < 3.75:
        caption = "Watch the wave repeat."
    elif t < 5.75:
        caption = "One cycle. Two cycles."
    else:
        caption = ""
    if caption:
        y = 235 if collision else 300
        d.rounded_rectangle((142, y-16, 458, y+16), radius=9, fill="#070e1d")
        d.text((300, y), caption, font=B[14], fill="white", anchor="mm")
    return im

def make_audio(out):
    samples = bytearray(48000 * 2 * DURATION)
    cue = SCRIPT[1][0]
    for index, (at, line) in enumerate(SCRIPT):
        clip = out / f"voice-{index}.wav"
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi",
                        "-i", f"flite=text='{line}':voice=slt", "-ar", "48000", "-ac", "1", str(clip)], check=True)
        with wave.open(str(clip)) as source:
            raw = source.readframes(source.getnframes())
        first = next((i for i in range(0, len(raw), 2)
                      if abs(int.from_bytes(raw[i:i+2], "little", signed=True)) > 150), 0)
        first = max(0, first - 960)
        position = round(at * 48000) * 2
        last = next((i for i in range(len(raw)-2, first, -2)
                     if abs(int.from_bytes(raw[i:i+2], "little", signed=True)) > 100), len(raw)-2)
        raw = raw[first:min(last+1920, len(samples)-position+first)]
        if any(samples[position:position+len(raw)]):
            raise ValueError(f"Speech overlaps at {at}")
        samples[position:position+len(raw)] = raw
        if index == 1:
            cue += max(0, next((i for i in range(0, len(raw), 2)
                               if abs(int.from_bytes(raw[i:i+2], "little", signed=True)) > 150), 0)) / 96000
        clip.unlink()
    audio = out / "synthetic-voice.wav"
    with wave.open(str(audio), "wb") as dest:
        dest.setparams((1, 2, 48000, 0, "NONE", "not compressed"))
        dest.writeframes(samples)
    return audio, cue

def render(path, size, frames, audio):
    width, height = size
    command = ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt",
               "rgb24", "-s", f"{width}x{height}", "-r", str(FPS), "-i", "-", "-i", str(audio),
               "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest", str(path)]
    with subprocess.Popen(command, stdin=subprocess.PIPE) as process:
        for frame in frames:
            process.stdin.write(frame.tobytes())
        process.stdin.close()
        if process.wait():
            raise RuntimeError(f"Could not encode {path}")
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(path),
                    "-f", "null", "-"], check=True)

def compare_frames(case, title, description, cue, index):
    base = Image.new("RGB", (1280, 610), "#0a1120")
    d = ImageDraw.Draw(base)
    d.rectangle((0, 0, 1280, 5), fill="#7ce8d9")
    d.text((28, 23), f"MOTION FACTORY   /   QUALITY STUDY {index:02d} OF 05", font=B[14], fill="#8ae9db")
    d.text((28, 53), title, font=B[45], fill="#f4f6ff")
    d.text((30, 112), description, font=F[22], fill="#b1bfdb")
    d.text((32, 160), "BEFORE", font=B[18], fill="#ecad9e")
    d.text((648, 160), "AFTER", font=B[18], fill="#88edba")
    for frame in range(DURATION * FPS):
        t = frame / FPS
        im = base.copy()
        im.paste(scene(case, False, t, cue), (32, 191))
        im.paste(scene(case, True, t, cue), (648, 191))
        bar = ImageDraw.Draw(im)
        bar.rounded_rectangle((32, 556, 1248, 562), radius=3, fill="#26344b")
        bar.rounded_rectangle((32, 556, 32+int(1216*t/DURATION), 562), radius=3, fill="#88edba")
        bar.text((32, 575), "ILLUSTRATED HOST  /  SYNTHETIC VOICE", font=B[12], fill="#8397b8")
        yield im

def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("out", type=Path)
    args = cli.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    audio, cue = make_audio(out)
    manifest = {"version": 1, "fixture": "synthetic-signal-lab", "fps": FPS,
                "durationSeconds": DURATION, "watchCueSeconds": round(cue, 4), "pairs": []}
    parts = []
    for index, (case, title, description) in enumerate(CASES, 1):
        pair = {"criterion": case, "humanExpectedPreference": "after",
                "reviewStart": (index-1)*DURATION}
        for label, good in (("before", False), ("after", True)):
            path = out / f"{case}-{label}.mp4"
            render(path, (600, 338), (scene(case, good, frame / FPS, cue)
                                    for frame in range(DURATION*FPS)), audio)
            pair[label] = {"file": path.name, "bytes": path.stat().st_size,
                           "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        manifest["pairs"].append(pair)
        part = out / f"study-{index}.mp4"
        render(part, (1280, 610), compare_frames(case, title, description, cue, index), audio)
        parts.append(part)
    concat = out / "concat.txt"
    concat.write_text("".join(f"file '{part.name}'\n" for part in parts), encoding="utf-8")
    reel = out / "motion-factory-five-quality-tests.mp4"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "concat", "-safe", "1",
                    "-i", str(concat), "-c", "copy", "-movflags", "+faststart", str(reel)], check=True)
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(reel),
                    "-f", "null", "-"], check=True)
    for item in [*parts, concat, audio]:
        item.unlink()
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(reel)

if __name__ == "__main__":
    main()
