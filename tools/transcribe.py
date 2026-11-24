"""tools/transcribe.py: local speech-to-text with word timings, no API key (footage.mjs uses it).

    python tools/transcribe.py audio.wav [model]     # prints JSON: {"words": [{"w", "s", "e"}, ...]}

Uses faster-whisper (`pip install faster-whisper`; the model downloads once, ~500 MB for "small").
Model: argument, else $WHISPER_MODEL, else "small" ("base" is faster, "medium" more accurate).
Prints {"error": ...} when faster-whisper isn't installed, so the caller can try something else.
"""
from __future__ import annotations

import json
import os
import sys


def _load(audio: str):
    """Decode with ffmpeg to 16 kHz mono float32. faster-whisper's own decoder (PyAV) breaks when the
    installed `av` version doesn't match it (TypeError: open() got an unexpected keyword 'metadata_errors');
    passing samples avoids PyAV entirely. Falls back to the path if ffmpeg or numpy is missing."""
    import shutil
    import subprocess
    ff = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    try:
        import numpy as np  # type: ignore
        if not ff:
            return audio
        raw = subprocess.run([ff, "-v", "error", "-i", audio, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                             capture_output=True, check=True).stdout
        return np.frombuffer(raw, dtype=np.float32).copy()
    except Exception:  # noqa: BLE001
        return audio


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    audio = sys.argv[1]
    model_name = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("WHISPER_MODEL", "small")
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": f"faster-whisper not installed ({e.__class__.__name__})"}))
        return
    model = WhisperModel(model_name, device="auto", compute_type="int8")
    segments, _info = model.transcribe(_load(audio), word_timestamps=True, vad_filter=True)
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if text:
                words.append({"w": text, "s": round(w.start, 3), "e": round(w.end, 3)})
    print(json.dumps({"words": words}))


if __name__ == "__main__":
    main()
