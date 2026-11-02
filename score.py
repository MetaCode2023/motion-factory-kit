"""score.py: measure a rendered video from its frames, so design quality is a number we can track.

    python score.py path/to/video.mp4          # prints the score as JSON

No model and no extra packages: ffmpeg decodes small grayscale frames and plain Python measures them.
The numbers are coarse on purpose. They catch the failures a contact sheet hides (long frozen
stretches, a slow open, half-empty frames, text under the TikTok buttons) and they let us see whether
whether your videos are getting better over time.

The thresholds live in THRESHOLDS; when we learn better values from what performs, change them there.
"""
from __future__ import annotations

import json
import hashlib
import math
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
_FF = REPO / "node_modules" / "ffmpeg-static"
FFMPEG = next((p for p in (_FF / "ffmpeg.exe", _FF / "ffmpeg") if p.exists()), Path("ffmpeg"))  # npm's copy, else PATH

W, H, FPS = 108, 192, 10           # analysis frames: 1/10 scale, 10 per second
CELL = 12                          # 9 x 16 grid of 12px cells (120px at full size)
INK = 6                            # a cell holds content if its pixels vary more than this (0-255)
TEXT = 60                          # ...and holds text-like content (high contrast) above this
MOVE = 0.4                         # mean abs change per pixel between frames that counts as motion

# Regions covered by app UI on a 1080x1920 frame, as fractions (x0, y0, x1, y1). Third-party
# measurements of TikTok's overlay (adkit.so, revid.ai); X's viewer covers less, so TikTok's cover both.
# These are the looser published numbers: text here is hidden for most viewers. design/DESIGN.md asks
# for the stricter box (x 120-960, y 240-1260) for the hook and the CTA.
UNSAFE = {
    "top_bar": (0.00, 0.00, 1.00, 220 / 1920),
    "right_rail": (940 / 1080, 840 / 1920, 1.00, 0.75),
    "bottom_caption": (0.00, 0.75, 1.00, 1.00),     # y > 1440: handle, caption, sound
}

THRESHOLDS = {
    "max_still_s": 3.0,            # longest stretch with no motion at all
    "min_open_motion": 1.0,        # mean motion over the first second (a hook moves)
    "min_fill": 0.30,              # median share of the frame that holds content
    "max_unsafe_ink": 0.10,        # share of an unsafe zone's cells holding content (time-averaged)
}


def frames(mp4: Path) -> list[bytes]:
    raw = subprocess.run([str(FFMPEG), "-hide_banner", "-loglevel", "error", "-i", str(mp4),
                          "-vf", f"fps={FPS},scale={W}:{H}:flags=area,format=gray",
                          "-f", "rawvideo", "-"], capture_output=True, check=True, timeout=300).stdout
    n = W * H
    return [raw[i:i + n] for i in range(0, len(raw) - n + 1, n)]


def ink_cells(f: bytes, level: int = INK) -> list[list[bool]]:
    """For each grid cell, whether its local contrast exceeds `level`."""
    grid = []
    for cy in range(H // CELL):
        row = []
        for cx in range(W // CELL):
            px = [f[(cy * CELL + y) * W + cx * CELL + x] for y in range(0, CELL, 2) for x in range(0, CELL, 2)]
            row.append(max(px) - min(px) > level)
        grid.append(row)
    return grid


def motion(a: bytes, b: bytes) -> float:
    return sum(abs(a[i] - b[i]) for i in range(0, len(a), 3)) / (len(a) / 3)


def size_of(mp4: Path) -> tuple[int, int]:
    err = subprocess.run([str(FFMPEG), "-hide_banner", "-i", str(mp4)], capture_output=True, text=True).stderr
    m = __import__("re").search(r"Video:.*?(\d{2,5})x(\d{2,5})", err)
    return (int(m.group(1)), int(m.group(2))) if m else (1080, 1920)


def score(mp4: Path) -> dict:
    # Analyse at 1/10 scale in the video's own shape (multiples of the cell size).
    global W, H
    vw, vh = size_of(mp4)
    W, H = max(CELL, round(vw / 10 / CELL) * CELL), max(CELL, round(vh / 10 / CELL) * CELL)
    vertical = abs(vw / vh - 9 / 16) < 0.02
    fs = frames(mp4)
    if len(fs) < FPS * 2:
        raise RuntimeError(f"only {len(fs)} analysis frames in {mp4}")
    dur = len(fs) / FPS
    mv = [motion(fs[i - 1], fs[i]) for i in range(1, len(fs))]

    longest = run = 0
    for m in mv:
        run = run + 1 if m < MOVE else 0
        longest = max(longest, run)

    sample = fs[::FPS // 2]                          # 2 per second is plenty for layout
    grids = [ink_cells(f) for f in sample]
    texts = [ink_cells(f, TEXT) for f in sample]   # card edges and progress bars are low contrast
    rows, cols = H // CELL, W // CELL
    fill = sorted(sum(map(sum, g)) / (rows * cols) for g in grids)
    lower = sorted(sum(sum(r) for r in g[rows // 2:]) / (rows // 2 * cols) for g in grids)

    # A scene with pictures has a layout.mp4 beside it (same frames, every picture blank). Measure the safe
    # zones on that, so a photo's texture under the TikTok UI isn't mistaken for text.
    layout = mp4.with_name("layout.mp4")
    if layout.exists() and layout.stat().st_mtime >= mp4.stat().st_mtime - 600:
        texts = [ink_cells(f, TEXT) for f in frames(layout)[::FPS // 2]]
    mask = mp4.with_name('text.mp4')
    manifest = mp4.with_name('text-mask.json')
    text_mask = False
    if mask.exists() and manifest.exists():
        identity = json.loads(manifest.read_text(encoding='utf-8'))
        if identity.get('video_sha256') == hashlib.sha256(mp4.read_bytes()).hexdigest():
            # Pixel masks contain only canvas text. Card edges and photos cannot trigger them.
            texts = frames(mask)
            if len(texts) != len(fs):
                raise RuntimeError('text mask duration does not match video')
            text_mask = True
    unsafe, peaks, at_times = {}, {}, {}
    # The TikTok/Reels overlay zones only apply to vertical video.
    for name, (x0, y0, x1, y1) in (UNSAFE.items() if vertical else []):
        if text_mask:
            pixels = [y * W + x for y in range(math.ceil(y0 * H), min(H, math.ceil(y1 * H)))
                      for x in range(math.ceil(x0 * W), min(W, math.ceil(x1 * W)))]
            counts = [sum(f[i] > TEXT for i in pixels) for f in texts]
            values = [n / len(pixels) for n in counts]
            # A real glyph (>= 3 reduced pixels), even briefly, needs review.
            ignore = identity.get('ignore', [])   # transition windows: text moves through zones on purpose
            at_times[name] = [round(i / FPS, 1) for i, n in enumerate(counts)
                              if n >= 3 and not any(a <= i / FPS <= b for a, b in ignore)][:20]
        else:
            cells = [(cy, cx) for cy in range(int(y0 * rows), min(rows, round(y1 * rows)))
                     for cx in range(int(x0 * cols), min(cols, round(x1 * cols)))]
            values = [sum(g[cy][cx] for cy, cx in cells) / len(cells) for g in texts]
        unsafe[name] = round(sum(values) / len(values), 4)
        peaks[name] = round(max(values), 4)

    # The first frame is the thumbnail: it should already carry words (the hook).
    if text_mask:
        first = texts[0]
        frame0_text = round(sum(v > TEXT for v in first) / len(first), 4)
    else:
        first = texts[0]
        frame0_text = round(sum(map(sum, first)) / (rows * cols), 4)
    s = {
        "size": f"{vw}x{vh}",
        "duration_s": round(dur, 1),
        "frame0_text": frame0_text,
        "longest_still_s": round(longest / FPS, 1),
        "open_motion": round(sum(mv[:FPS]) / FPS, 2),
        "mean_motion": round(sum(mv) / len(mv), 2),
        "median_fill": round(fill[len(fill) // 2], 2),
        "median_lower_half_fill": round(lower[len(lower) // 2], 2),
        "unsafe_ink": unsafe,
        "unsafe_peak": peaks,
        "unsafe_times": at_times,
        "text_mask": text_mask,
    }
    T = THRESHOLDS
    warn = []
    if frame0_text < 0.002:
        warn.append("no words on screen at frame 0: the first frame is the thumbnail, so put the hook on it")
    if s["longest_still_s"] > T["max_still_s"]:
        warn.append(f"frozen for {s['longest_still_s']}s at a stretch (keep something alive: a drift, a pulse, a counter)")
    if s["open_motion"] < T["min_open_motion"]:
        warn.append(f"slow open (first-second motion {s['open_motion']}): the hook should move right away")
    if s["median_fill"] < T["min_fill"]:
        warn.append(f"half-empty frames (median fill {s['median_fill']}): scale content up or use the space")
    for name, v in unsafe.items():
        if text_mask and at_times[name]:
            warn.append(f"text under the {name.replace('_', ' ')} at {at_times[name][0]}s")
        elif not text_mask and v > T["max_unsafe_ink"]:
            warn.append(f"content under the {name.replace('_', ' ')} ({v}): app UI will cover it")
    s["warnings"] = warn
    return s


if __name__ == "__main__":
    print(json.dumps(score(Path(sys.argv[1])), indent=2))
