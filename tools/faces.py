"""tools/faces.py: find faces through a clip, for automatic reframing (footage.mjs index runs it).

    python tools/faces.py <ffmpeg> <video> [fps]      # prints JSON: {"fps": 3, "samples": [[t, [[cx, cy, h], ...]], ...]}

cx, cy are the face centre and h its height, all as fractions of the frame. Up to 3 faces per sample,
biggest first. Needs OpenCV (`pip install opencv-python-headless`); without it, prints {"error": ...}
and the editor falls back to the plan's focus / the centre.

ffmpeg decodes (so any format ffmpeg reads works, HEVC iPhone clips included) into small greyscale
frames; the YuNet detector (tools/models, OpenCV model zoo, MIT) finds faces in them, frontal and turned.
Older OpenCV builds without YuNet fall back to the bundled Haar cascades.
"""
from __future__ import annotations

import json
import subprocess
import sys


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    ffmpeg, video = sys.argv[1], sys.argv[2]
    fps = float(sys.argv[3]) if len(sys.argv) > 3 else 3.0
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": f"OpenCV not installed ({e.__class__.__name__}); pip install opencv-python-headless"}))
        return

    W = 480  # analysis width; height keeps the aspect
    probe = subprocess.run([ffmpeg, "-hide_banner", "-i", video], capture_output=True, text=True).stderr
    import re
    m = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", probe)
    if not m:
        print(json.dumps({"error": "no video stream"}))
        return
    sw, sh = int(m.group(1)), int(m.group(2))
    rot = re.search(r"rotation of (-?[\d.]+) degrees", probe) or re.search(r"rotate\s*:\s*(-?\d+)", probe)
    if rot and abs(abs(float(rot.group(1))) % 180 - 90) < 1:
        sw, sh = sh, sw
    H = int(round(W * sh / sw / 2) * 2)

    proc = subprocess.Popen(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-i", video, "-vf", f"fps={fps},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        stdout=subprocess.PIPE,
    )
    from pathlib import Path
    model = Path(__file__).resolve().parent / "models" / "face_detection_yunet_2023mar.onnx"
    yunet = None
    if hasattr(cv2, "FaceDetectorYN") and model.exists():
        yunet = cv2.FaceDetectorYN.create(str(model), "", (W, H), 0.6, 0.3, 50)
    else:
        base = getattr(getattr(cv2, "data", None), "haarcascades", "")
        frontal = cv2.CascadeClassifier(base + "haarcascade_frontalface_default.xml")
        profile = cv2.CascadeClassifier(base + "haarcascade_profileface.xml")
        if frontal.empty():
            print(json.dumps({"error": "this OpenCV has neither YuNet nor Haar cascades; pip install opencv-python-headless"}))
            return
    size = W * H
    samples = []
    i = 0
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        gray = np.frombuffer(buf, dtype=np.uint8).reshape(H, W)
        if yunet is not None:
            _, found = yunet.detect(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR))
            boxes = [(float(f[0]), float(f[1]), float(f[2]), float(f[3])) for f in (found if found is not None else [])]
        else:
            img = cv2.equalizeHist(gray)
            mn = max(24, int(min(W, H) * 0.07))
            boxes = list(frontal.detectMultiScale(img, 1.1, 5, minSize=(mn, mn)))
            if not boxes:   # turned heads: profile both ways
                boxes = list(profile.detectMultiScale(img, 1.1, 5, minSize=(mn, mn)))
                flipped = profile.detectMultiScale(cv2.flip(img, 1), 1.1, 5, minSize=(mn, mn))
                boxes += [(W - x - w, y, w, h) for (x, y, w, h) in flipped]
        faces = sorted(((x + w / 2) / W, (y + h / 2) / H, h / H) for (x, y, w, h) in boxes)
        faces = sorted(faces, key=lambda f: -f[2])[:3]
        samples.append([round(i / fps, 3), [[round(a, 4), round(b, 4), round(c, 4)] for a, b, c in faces]])
        i += 1
    proc.wait()
    print(json.dumps({"fps": fps, "samples": samples}))


if __name__ == "__main__":
    main()
