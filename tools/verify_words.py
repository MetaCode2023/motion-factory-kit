"""Check that every captioned word is heard in a finished cut.

Usage:
    python tools/verify_words.py <ffmpeg> <cut.mp4> tools/transcribe.py [model]

The command reads <cut>.words.json, re-transcribes the cut with faster-whisper, and exits nonzero
for tool failures or word differences. Case, punctuation, and equivalent integer forms such as
"eight"/"8" are normalized. Other spelling differences are reported for a human to review.
"""
import difflib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path


ONES = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
        "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
        "seventeen", "eighteen", "nineteen")
TENS = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")


def fail(message: str) -> "None":
    print(f"verify_words: {message}", file=sys.stderr)
    raise SystemExit(2)


def integer_word(value: int) -> str:
    if value < 0:
        return "minus" + integer_word(-value)
    if value < 20:
        return ONES[value]
    if value < 100:
        return TENS[value // 10] + (ONES[value % 10] if value % 10 else "")
    if value < 1000:
        return ONES[value // 100] + "hundred" + (integer_word(value % 100) if value % 100 else "")
    return str(value)


def normalize(word: object) -> str:
    text = str(word).lower().replace("’", "'").replace(",", "")
    numeric = re.sub(r"[$£€¥\s]", "", text)
    if re.fullmatch(r"[+-]?\d+", numeric):
        return integer_word(int(numeric))
    return re.sub(r"[^a-z0-9']", "", text)


def run() -> int:
    if len(sys.argv) not in (4, 5):
        fail("usage: python tools/verify_words.py <ffmpeg> <cut.mp4> tools/transcribe.py [model]")
    ffmpeg, mp4, transcriber = sys.argv[1:4]
    model = sys.argv[4] if len(sys.argv) == 5 else "small"
    captions_path = Path(mp4).with_suffix(".words.json")
    if not captions_path.is_file():
        fail(f"caption words not found: {captions_path}")

    with tempfile.TemporaryDirectory(prefix="verify-words-") as work:
        wav = Path(work) / "cut.wav"
        try:
            decoded = subprocess.run(
                [ffmpeg, "-v", "error", "-y", "-i", mp4, "-ac", "1", "-ar", "16000", str(wav)],
                capture_output=True, text=True,
            )
        except OSError as error:
            fail(f"cannot start ffmpeg: {error}")
        if decoded.returncode:
            fail(f"ffmpeg audio decode failed ({decoded.returncode}): {(decoded.stderr or decoded.stdout).strip()}")
        try:
            transcribed = subprocess.run(
                [sys.executable, transcriber, str(wav), model], capture_output=True, text=True,
            )
        except OSError as error:
            fail(f"cannot start transcriber: {error}")
        if transcribed.returncode:
            fail(f"transcription failed ({transcribed.returncode}): {(transcribed.stderr or transcribed.stdout).strip()}")
        lines = [line for line in transcribed.stdout.splitlines() if line.strip()]
        if not lines:
            fail("transcription produced no JSON output")
        try:
            result = json.loads(lines[-1])
        except json.JSONDecodeError as error:
            fail(f"transcription returned invalid JSON: {error}")
        if not isinstance(result, dict):
            fail("transcription JSON must be an object")
        if result.get("error"):
            fail(f"transcription unavailable: {result['error']}")
        heard = result.get("words")
        if not isinstance(heard, list):
            fail("transcription JSON has no 'words' list")

    try:
        captions = json.loads(captions_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        fail(f"cannot read caption words: {error}")
    captions = captions.get("words") if isinstance(captions, dict) else captions
    if not isinstance(captions, list):
        fail("caption JSON must be a word list or an object containing 'words'")

    left = [normalize(word.get("w", "")) for word in captions]
    right = [normalize(word.get("w", "")) for word in heard]
    bad = 0
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, left, right, autojunk=False).get_opcodes():
        if op == "equal":
            continue
        caption_text = " ".join(str(word.get("w", "")) for word in captions[i1:i2])
        heard_text = " ".join(str(word.get("w", "")) for word in heard[j1:j2])
        at = captions[i1].get("s", 0) if i1 < len(captions) else heard[j1].get("s", 0)
        print(f"  {at:7.2f}s  {op:8} captions: {caption_text!r:40} heard: {heard_text!r}")
        bad += 1
    print(f"{len(left)} caption words, {len(right)} heard, {bad} differences")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(run())
