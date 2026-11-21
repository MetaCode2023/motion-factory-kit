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


def integer_words(value: int) -> list[str]:
    if value < 0:
        return ["minus", *integer_words(-value)]
    if value < 20:
        return [ONES[value]]
    if value < 100:
        return [TENS[value // 10], *([ONES[value % 10]] if value % 10 else [])]
    if value < 1000:
        return [ONES[value // 100], "hundred", *(integer_words(value % 100) if value % 100 else [])]
    return [str(value)]


def normalize(word: object) -> list[str]:
    text = str(word).lower().replace("’", "'").replace(",", "")
    numeric = re.sub(r"[$£€¥\s]", "", text)
    if re.fullmatch(r"[+-]?\d+", numeric):
        return integer_words(int(numeric))
    token = re.sub(r"[^a-z0-9]", "", text)
    return [token] if token else []


def normalized_words(words: list[object], label: str) -> tuple[list[str], list[int]]:
    tokens: list[str] = []
    owners: list[int] = []
    for index, word in enumerate(words):
        if not isinstance(word, dict) or "w" not in word:
            fail(f"{label} word {index} must be an object containing 'w'")
        parts = normalize(word["w"])
        tokens.extend(parts)
        owners.extend([index] * len(parts))
    return tokens, owners


def raw_span(words: list[object], owners: list[int], start: int, end: int) -> tuple[int, int]:
    if start < end:
        return owners[start], owners[end - 1] + 1
    index = owners[start] if start < len(owners) else len(words)
    return index, index


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

    left, left_owners = normalized_words(captions, "caption")
    right, right_owners = normalized_words(heard, "transcribed")
    bad = 0
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, left, right, autojunk=False).get_opcodes():
        if op == "equal":
            continue
        ci1, ci2 = raw_span(captions, left_owners, i1, i2)
        hj1, hj2 = raw_span(heard, right_owners, j1, j2)
        caption_text = " ".join(str(word.get("w", "")) for word in captions[ci1:ci2])
        heard_text = " ".join(str(word.get("w", "")) for word in heard[hj1:hj2])
        at = captions[ci1].get("s", 0) if ci1 < len(captions) else heard[hj1].get("s", 0)
        print(f"  {at:7.2f}s  {op:8} captions: {caption_text!r:40} heard: {heard_text!r}")
        bad += 1
    print(f"{len(captions)} caption words, {len(heard)} heard, {bad} differences")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(run())
