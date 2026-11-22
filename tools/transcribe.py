"""tools/transcribe.py: local speech-to-text with word timings, no API key (footage.mjs uses it).

    python tools/transcribe.py audio.wav [model]     # prints JSON: {"words": [{"w", "s", "e"}, ...]}

Uses faster-whisper (`pip install faster-whisper`; the model downloads once, ~500 MB for "small").
Model: argument, else $WHISPER_MODEL, else "small" ("base" is faster, "medium" more accurate).
Prints {"error": ...} when faster-whisper isn't installed, so the caller can try something else.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys


def silence_ranges(audio: str) -> list[tuple[float, float]]:
    """Long quiet ranges used to reject Whisper words invented over room tone."""
    ffmpeg = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if not ffmpeg:
        return []
    run = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", audio, "-af", "silencedetect=noise=-35dB:d=0.6", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    starts = [float(x) for x in re.findall(r"silence_start:\s*([\d.]+)", run.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end:\s*([\d.]+)", run.stderr)]
    return list(zip(starts, ends))


def drop_silent_words(words: list[dict], quiet: list[tuple[float, float]]) -> list[dict]:
    # Keep boundary words: plosives and breaths can overlap the detector by a few milliseconds.
    return [w for w in words if not any(w["s"] >= a + 0.08 and w["e"] <= b - 0.08 for a, b in quiet)]


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
    segments, _info = model.transcribe(audio, word_timestamps=True, vad_filter=True)
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if text:
                words.append({"w": text, "s": round(w.start, 3), "e": round(w.end, 3)})
    quiet = silence_ranges(audio)
    clean = drop_silent_words(words, quiet)
    print(json.dumps({"words": clean, "silence_ranges": quiet, "dropped_in_silence": len(words) - len(clean)}))


if __name__ == "__main__":
    main()
