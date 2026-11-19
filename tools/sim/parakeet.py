#!/usr/bin/env python3
"""Word-level transcript with NVIDIA Parakeet TDT 0.6b v2 (int8) through sherpa-onnx. No Hugging Face.

    python tools/sim/parakeet.py <audio.wav> <model_dir> <out_prefix> [--ffmpeg PATH] [--max-chunk 28]

<audio.wav> is 16 kHz mono PCM (`sim ingest` makes it). The audio is split at silences into chunks of
--max-chunk seconds or less (ffmpeg silencedetect), each chunk is decoded, and its tokens are merged into
words using the chunk's offset. Writes:
    <out_prefix>.words.json   {"words": [{"w": "Hello", "s": 0.42, "e": 0.71}, ...]}
    <out_prefix>.txt          the transcript as paragraphs, a [m:ss] timestamp every ~30 s
Progress goes to stderr; the last stdout line is a JSON summary.
"""
import json
import re
import subprocess
import sys
import time
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx


def arg(name, default=None):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


def read_wav(path):
    with wave.open(str(path), "rb") as w:
        if w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise SystemExit(f"{path}: expected 16-bit mono PCM (sim ingest makes this)")
        sr = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    return data, sr


def silences(ffmpeg, path):
    """Midpoints of silences (>= 0.3 s under -35 dB)."""
    r = subprocess.run([ffmpeg, "-hide_banner", "-nostats", "-i", str(path), "-af",
                        "silencedetect=noise=-35dB:d=0.3", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    return [(a + b) / 2 for a, b in zip(starts, ends)]


def chunk_bounds(total, mids, max_len):
    """Cut at the latest silence that keeps each chunk <= max_len; hard-cut if there is none."""
    bounds, start = [], 0.0
    while total - start > max_len:
        options = [m for m in mids if start + 2.0 < m <= start + max_len]
        cut = options[-1] if options else start + max_len
        bounds.append((start, cut))
        start = cut
    bounds.append((start, total))
    return bounds


def fmt(t):
    t = int(t)
    return f"{t // 3600}:{t // 60 % 60:02d}:{t % 60:02d}" if t >= 3600 else f"{t // 60}:{t % 60:02d}"


def main():
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    wav, model, out = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    ffmpeg = arg("--ffmpeg", "ffmpeg")
    max_len = float(arg("--max-chunk", 28))
    pick = lambda pat: str(next(model.glob(pat)))
    rec = sherpa_onnx.OfflineRecognizer.from_transducer(
        encoder=pick("encoder*.onnx"), decoder=pick("decoder*.onnx"), joiner=pick("joiner*.onnx"),
        tokens=str(model / "tokens.txt"), num_threads=4, sample_rate=16000, feature_dim=80,
        decoding_method="greedy_search", model_type="nemo_transducer")

    samples, sr = read_wav(wav)
    total = len(samples) / sr
    bounds = chunk_bounds(total, silences(ffmpeg, wav), max_len)
    words, t0 = [], time.time()
    for k, (a, b) in enumerate(bounds):
        seg = samples[int(a * sr):int(b * sr)]
        if len(seg) < sr * 0.2:
            continue
        st = rec.create_stream()
        st.accept_waveform(sr, seg)
        rec.decode_stream(st)
        res = st.result
        toks, ts = list(res.tokens), list(res.timestamps)
        durs = list(getattr(res, "durations", []) or [])
        cur, space = None, True
        for i, (tok, t) in enumerate(zip(toks, ts)):
            tok = tok.replace("▁", " ")
            if not tok.strip():          # a bare space token: the next token starts a word
                space = True
                continue
            start = a + float(t)
            if i < len(durs) and durs[i] > 0:
                end = start + float(durs[i])
            else:
                end = a + float(ts[i + 1]) if i + 1 < len(ts) else min(b, start + 0.3)
            new_word = space or tok.startswith(" ") or cur is None
            space = False
            text = tok.strip()
            if new_word:
                if cur:
                    words.append(cur)
                cur = {"w": text, "s": round(start, 2), "e": round(end, 2)}
            else:
                cur["w"] += text
                cur["e"] = round(end, 2)
        if cur:
            words.append(cur)
        # A word's end never runs past the next word's start.
        print(f"chunk {k + 1}/{len(bounds)}  {fmt(a)}-{fmt(b)}", file=sys.stderr, flush=True)
    for i in range(len(words) - 1):
        words[i]["e"] = min(words[i]["e"], words[i + 1]["s"])

    Path(out + ".words.json").write_text(json.dumps({"words": words}, ensure_ascii=False), encoding="utf-8")
    lines, para, mark = [], [], 0.0
    for w in words:
        if not para:
            mark = w["s"]
        para.append(w["w"])
        if w["s"] - mark >= 30 and re.search(r"[.?!]$", w["w"]):
            lines.append(f"[{fmt(mark)}] " + " ".join(para))
            para = []
    if para:
        lines.append(f"[{fmt(mark)}] " + " ".join(para))
    Path(out + ".txt").write_text("\n\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "words": len(words), "chunks": len(bounds), "duration_s": round(total, 2),
                      "seconds": round(time.time() - t0, 1)}))


if __name__ == "__main__":
    main()
