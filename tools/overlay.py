"""tools/overlay.py: a progress bar, explainer cards and sound effects on top of a finished clip
(talking head, podcast cut, whiteboard lesson). The clip's own audio and picture are kept. Docs: docs/OVERLAYS.md.

    python tools/overlay.py transcribe clip.mp4        # -> clip.words.json (local faster-whisper, word timings)
    python tools/overlay.py render clip.mp4 [--cues clip.cues.json] [--bar-y 0.63] [--sfx] [--sheet] [--json]
    python tools/overlay.py demo                       # stand-in clip + example cues -> out/overlay-demo/

Cue file (clip.cues.json); the agent writes it from the transcript:
{
  "accent": "#FC5C2B",          # optional; default is brand.js colors.accent
  "position": "top",            # card top edge: "top", "middle" or a fraction of the frame height (e.g. 0.76)
  "card_scale": 1.0,            # shrink text cards to fit a tight empty area
  "chapters": [{"at": 0, "label": "The problem"}, {"at": 14.5, "label": "The fix"}],
  "cards": [
    {"at": 3.2, "dur": 4.5, "kind": "stat", "kicker": "The number", "value": "$900M", "body": "..."},
    {"at": 9, "dur": 5, "kind": "list", "kicker": "The plan", "title": "3 steps", "items": ["...", "...", "..."]},
    {"at": 16, "dur": 4.5, "kind": "compare", "kicker": "Trade-off", "left": ["Today", "..."], "right": ["After", "..."]},
    {"at": 22, "dur": 4, "kind": "term", "kicker": "Definition", "title": "Externality", "body": "..."},
    {"at": 28, "dur": 6, "kind": "split", "kicker": "Example", "total": 1000, "basis": 100, "rate": 0.1},
    {"at": 36, "dur": 5, "kind": "curve", "left": "LOCAL MAX", "right": "GLOBAL MAX"},
    {"at": 43, "dur": 6, "kind": "pricedrop", "anchor": "Music file", "items": ["Energy", "Housing"]},
    {"at": 51, "dur": 5, "kind": "map", "highlight": ["NV", "UT"], "value": "245M", "unit": "acres", "label": "..."}
  ]
}
"""
import argparse, json, math, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "fonts"
def _brand_accent():
    try:
        m = re.search(r"accent:\s*'(#[0-9A-Fa-f]{6})'", (ROOT / "brand.js").read_text())
        h = m.group(1).lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:  # noqa: BLE001
        return (252, 92, 43)


ACCENT = _brand_accent()      # brand.js colors.accent; a cue file's "accent" overrides it
INK = (11, 13, 18)            # #0B0D12
PAPER = (245, 247, 250)       # #F5F7FA
MUTED = (160, 168, 180)


# ---------------------------------------------------------------- helpers
def _ffmpeg():
    """ffmpeg from $FFMPEG (the MCP server passes ffmpeg-static's), else PATH, else node_modules/ffmpeg-static."""
    env = os.environ.get("FFMPEG")
    if env and Path(env).exists():
        return env
    if shutil.which("ffmpeg"):
        return "ffmpeg"
    local = ROOT / "node_modules" / "ffmpeg-static" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    if local.exists():
        return str(local)
    sys.exit("ffmpeg not found: run `npm install` in the kit, or install ffmpeg")


FF = _ffmpeg()


def probe(path):
    """(width, height, fps, duration) from ffmpeg's own banner, so ffprobe isn't needed."""
    err = subprocess.run([FF, "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    v = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", err)
    fps = re.search(r"(\d+(?:\.\d+)?) fps", err) or re.search(r"(\d+(?:\.\d+)?) tbr", err)
    d = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", err)
    if not (v and d):
        sys.exit(f"can't read video info from {path}")
    dur = int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3))
    return int(v.group(1)), int(v.group(2)), float(fps.group(1)) if fps else 30.0, dur


_font_cache = {}
def font(name, size):
    """Pillow can't open woff2, so convert the repo's fonts to TTF once into a temp cache."""
    key = (name, size)
    if key in _font_cache:
        return _font_cache[key]
    cache = Path(tempfile.gettempdir()) / "mf-fonts"
    cache.mkdir(exist_ok=True)
    ttf = cache / (name + ".ttf")
    if not ttf.exists():
        from fontTools.ttLib import TTFont
        f = TTFont(str(FONTS / (name + ".woff2")))
        f.flavor = None
        f.save(str(ttf))
    _font_cache[key] = ImageFont.truetype(str(ttf), size)
    return _font_cache[key]

HEAD = "barlow-condensed-latin-800-normal"
BODY = "plus-jakarta-sans-latin-600-normal"
BODY_B = "plus-jakarta-sans-latin-800-normal"
MONO = "jetbrains-mono-latin-600-normal"


def wrap(draw, text, f, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=f) <= width or not cur:
            cur = trial
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    return lines


def fmt(sec):
    sec = max(0, int(sec))
    return f"{sec // 60}:{sec % 60:02d}"


# ---------------------------------------------------------------- cards
def render_card(card, W, scale=1.0):
    """Draw one card to a transparent RGBA image sized to its content. Sizes scale with frame width."""
    s = W / 1080 * scale
    cw = int(900 * W / 1080)
    pad = int(48 * s)
    inner = cw - 2 * pad
    probe_img = Image.new("RGBA", (10, 10))
    d = ImageDraw.Draw(probe_img)
    kicker_f = font(MONO, int(34 * s))
    blocks = []                                   # (height, painter(draw, x, y))

    def text_block(text, f, color, gap=10):
        lines = wrap(d, text, f, inner)
        lh = int(f.size * 1.12)
        def paint(dr, x, y):
            for i, ln in enumerate(lines):
                dr.text((x, y + i * lh), ln, font=f, fill=color)
        blocks.append((lh * len(lines) + int(gap * s), paint))

    kind = card.get("kind", "term")
    if card.get("kicker"):
        k = card["kicker"].upper()
        def paint_k(dr, x, y, k=k):
            tw = dr.textlength(k, font=kicker_f)
            dr.rounded_rectangle((x, y, x + tw + 28 * s, y + kicker_f.size + 20 * s), radius=int(10 * s), fill=ACCENT)
            dr.text((x + 14 * s, y + 8 * s), k, font=kicker_f, fill=INK)
        blocks.append((int(kicker_f.size + 20 * s + 22 * s), paint_k))

    if kind == "stat":
        text_block(card["value"], font(HEAD, int(150 * s)), ACCENT, gap=6)
        if card.get("body"):
            text_block(card["body"], font(BODY, int(52 * s)), PAPER)
    elif kind == "list":
        if card.get("title"):
            text_block(card["title"], font(HEAD, int(96 * s)), PAPER, gap=14)
        f = font(BODY, int(50 * s))
        for i, item in enumerate(card.get("items", [])[:4]):
            lines = wrap(d, item, f, inner - int(80 * s))
            lh = int(f.size * 1.15)
            def paint_i(dr, x, y, i=i, lines=lines, lh=lh, f=f):
                r = int(26 * s)
                dr.ellipse((x, y + 4 * s, x + 2 * r, y + 4 * s + 2 * r), fill=ACCENT)
                n = str(i + 1); nf = font(BODY_B, int(32 * s))
                dr.text((x + r - dr.textlength(n, font=nf) / 2, y + 4 * s + r - nf.size * 0.62), n, font=nf, fill=INK)
                for j, ln in enumerate(lines):
                    dr.text((x + int(80 * s), y + j * lh), ln, font=f, fill=PAPER)
            blocks.append((lh * len(lines) + int(18 * s), paint_i))
    elif kind == "compare":
        L, R = card["left"], card["right"]
        hf, bf = font(HEAD, int(72 * s)), font(BODY, int(50 * s))
        colw = (inner - int(40 * s)) // 2
        def col_h(col):
            n = sum(len(wrap(d, b, bf, colw)) for b in col[1:])
            return int(hf.size * 1.2 + n * bf.size * 1.2 + 10 * s)
        h = max(col_h(L), col_h(R))
        def paint_c(dr, x, y):
            for ci, col in enumerate((L, R)):
                cx = x + ci * (colw + int(40 * s))
                dr.text((cx, y), col[0], font=hf, fill=MUTED if ci == 0 else ACCENT)
                yy = y + hf.size * 1.2
                for b in col[1:]:
                    for ln in wrap(d, b, bf, colw):
                        dr.text((cx, yy), ln, font=bf, fill=PAPER); yy += bf.size * 1.2
            mx = x + colw + int(20 * s)
            dr.line((mx, y, mx, y + h - 10 * s), fill=(255, 255, 255, 60), width=max(2, int(3 * s)))
        blocks.append((h, paint_c))
    else:  # term / quote
        if card.get("title"):
            text_block(card["title"], font(HEAD, int(104 * s)), PAPER, gap=8)
        if card.get("body"):
            text_block(card["body"], font(BODY, int(50 * s)), (210, 216, 226))

    H = pad * 2 + sum(h for h, _ in blocks)
    img = Image.new("RGBA", (cw, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    dr.rounded_rectangle((0, 0, cw - 1, H - 1), radius=int(34 * s), fill=INK + (226,))
    dr.rounded_rectangle((0, 0, int(10 * s), H - 1), radius=int(5 * s), fill=ACCENT)
    y = pad
    for h, paint in blocks:
        paint(dr, pad + int(8 * s), y)
        y += h
    return img


# ---------------------------------------------------------------- progress strip
def strip_frames(W, H, fps, dur, chapters, floating=False):
    """Yield RGBA bytes for the bottom strip: chapter-segmented bar, playhead, elapsed/total and chapter name."""
    s = W / 1080
    SH = int(120 * s)
    x0, x1 = int(70 * s), W - int(70 * s)
    bar_y, bar_h = SH - int(34 * s), max(6, int(10 * s))
    gap = int(10 * s) if len(chapters) > 1 else 0
    starts = [c["at"] for c in chapters] or [0]
    if starts[0] > 0:
        starts = [0] + starts
    bounds = starts + [dur]
    n = len(bounds) - 1
    seg_w = ((x1 - x0) - gap * (n - 1)) / n if n else (x1 - x0)
    # Segments are equal-width per chapter only if chapters are equal; use true proportions instead.
    total_w = (x1 - x0) - gap * (n - 1)
    segs = []
    x = x0
    for i in range(n):
        w = total_w * (bounds[i + 1] - bounds[i]) / dur
        segs.append((x, x + w, bounds[i], bounds[i + 1])); x += w + gap

    base = np.zeros((SH, W, 4), np.uint8)
    # soft dark gradient so the bar reads on bright footage
    for yy in range(SH):
        base[yy, :, 3] = int(110 * math.sin(math.pi * yy / SH)) if floating else int(150 * (yy / SH) ** 1.6)
    track = (255, 255, 255, 90)
    for (a, b, *_ ) in segs:
        base[bar_y:bar_y + bar_h, int(a):int(b)] = track

    label_f = font(MONO, int(30 * s))
    chap_f = font(BODY_B, int(30 * s))
    cache = {}
    def label(text, f, color):
        k = (text, f.size, color)
        if k not in cache:
            im = Image.new("RGBA", (int(f.getlength(text)) + 4, int(f.size * 1.3)), (0, 0, 0, 0))
            ImageDraw.Draw(im).text((0, 0), text, font=f, fill=color)
            cache[k] = np.array(im)
        return cache[k]

    def blit(dst, src, x, y):
        h, w = src.shape[:2]
        x, y = int(x), int(y)
        w = min(w, dst.shape[1] - x)
        if w <= 0: return
        region = dst[y:y + h, x:x + w].astype(np.float32)
        a = src[:h, :w, 3:4].astype(np.float32) / 255
        region[..., :3] = src[:h, :w, :3] * a + region[..., :3] * (1 - a)
        region[..., 3:4] = np.maximum(region[..., 3:4], a * 255)
        dst[y:y + h, x:x + w] = region.astype(np.uint8)

    names = [c.get("label", "") for c in chapters]
    if chapters and chapters[0]["at"] > 0:
        names = [""] + names
    total = fmt(dur)
    frames = int(round(dur * fps))
    for f in range(frames):
        t = f / fps
        fr = base.copy()
        cur = 0
        for i, (a, b, ta, tb) in enumerate(segs):
            p = min(1, max(0, (t - ta) / (tb - ta)))
            if p > 0:
                fr[bar_y:bar_y + bar_h, int(a):int(a + (b - a) * p)] = ACCENT + (255,)
            if ta <= t < tb:
                cur = i
        # playhead
        a, b, ta, tb = segs[cur]
        px = a + (b - a) * min(1, max(0, (t - ta) / (tb - ta)))
        r = int(bar_h * 1.1)
        yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
        disk = (xx * xx + yy * yy) <= r * r
        cy = bar_y + bar_h // 2
        y0, y1 = cy - r, cy + r + 1
        xa, xb = int(px) - r, int(px) + r + 1
        if xa >= 0 and xb <= W:
            fr[y0:y1, xa:xb][disk] = PAPER + (255,)
        blit(fr, label(f"{fmt(t)} / {total}", label_f, PAPER + (235,)), x1 - label_f.getlength(f"{fmt(t)} / {total}"), bar_y - int(46 * s))
        if names[cur]:
            blit(fr, label(names[cur].upper(), chap_f, PAPER + (235,)), x0, bar_y - int(46 * s))
        yield fr.tobytes(), SH


# ---------------------------------------------------------------- commands
def cmd_render(a):
    clip = Path(a.clip)
    if getattr(a, "start", 0):   # drop a weak opener first; cue times are then relative to the new start
        tdir = Path(tempfile.mkdtemp(prefix="mf-trim-"))
        trimmed = tdir / clip.name
        subprocess.run([FF, "-y", "-loglevel", "error", "-ss", f"{a.start:.3f}", "-i", str(clip), "-c:v", "libx264",
                        "-preset", "veryfast", "-crf", "14", "-c:a", "aac", "-b:a", "192k", str(trimmed)], check=True)
        if not a.cues and clip.with_suffix(".cues.json").exists():
            a.cues = str(clip.with_suffix(".cues.json"))
        if not a.out:
            a.out = str(ROOT / "out" / "overlays" / (clip.stem + ".overlay.mp4"))
        clip = trimmed
    W, H, fps, dur = probe(clip)
    cues = {}
    cue_path = Path(a.cues) if a.cues else clip.with_suffix(".cues.json")
    if cue_path.exists():
        cues = json.loads(cue_path.read_text())
    elif a.cues:
        sys.exit(f"cue file not found: {cue_path}")
    chapters = cues.get("chapters", [])
    cards = [c for c in cues.get("cards", []) if c["at"] < dur]
    out = Path(a.out) if a.out else ROOT / "out" / "overlays" / (clip.stem + ".overlay.mp4")
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="mf-overlay-"))

    s = W / 1080
    SH = int(120 * s)
    inputs = ["-i", str(clip),
              "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{SH}", "-r", f"{fps}", "-i", "pipe:0"]
    chains = [f"[0:v][1:v]overlay=0:{int(H * a.bar_y)}-h:eof_action=pass[v0]"]
    pos = cues.get("position", "top")
    top = int(H * (pos if isinstance(pos, (int, float)) else 0.125 if pos == "top" else 0.36))
    cscale = float(cues.get("card_scale", 1.0))
    if cues.get("accent"):
        global ACCENT
        h = cues["accent"].lstrip("#"); ACCENT = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    for i, c in enumerate(cards):
        d = float(c.get("dur", 4.5)); at = float(c["at"])
        if c.get("kind") in ANIM:
            size = (int(900 * W / 1080), int(c.get("h", 420) * W / 1080))
            fdir = tmp / f"card{i}"; fdir.mkdir()
            n = int(round(d * fps))
            for fi in range(n):
                img = ANIM[c["kind"]](fi / fps, c, size, ACCENT)
                img.save(fdir / f"{fi:04d}.png", compress_level=1)
            inputs += ["-framerate", f"{fps}", "-i", str(fdir / "%04d.png")]
        else:
            img = render_card(c, W, cscale)
            p = tmp / f"card{i}.png"; img.save(p)
            inputs += ["-loop", "1", "-t", f"{d:.3f}", "-i", str(p)]
        idx = i + 2
        ox = (W - img.width) // 2
        # rise 40px with an ease-out over 0.45 s; fade in 0.35 s, out 0.22 s (exits ~half of entrances)
        chains.append(f"[{idx}:v]format=rgba,fade=t=in:st=0:d=0.35:alpha=1,"
                      f"fade=t=out:st={max(0, d - 0.22):.3f}:d=0.22:alpha=1,setpts=PTS+{at:.3f}/TB[c{i}]")
        rise = f"{int(40 * s)}*pow(1-min(1\\,max(0\\,(t-{at:.3f})/0.45))\\,3)"
        chains.append(f"[v{i}][c{i}]overlay=x={ox}:y={top}+{rise}:eof_action=pass:"
                      f"enable='between(t\\,{at:.3f}\\,{at + d:.3f})'[v{i + 1}]")
    last = f"[v{len(cards)}]"
    amap, acodec = ["-map", "0:a?"], ["-c:a", "copy"]
    if a.sfx and cards:
        wav = tmp / "sfx.wav"
        build_sfx(cards, dur, wav)
        inputs += ["-i", str(wav)]
        chains.append(f"[0:a][{len(cards) + 2}:a]amix=inputs=2:duration=first:normalize=0[aout]")
        amap, acodec = ["-map", "[aout]"], ["-c:a", "aac", "-b:a", "192k"]
    cmd = [FF, "-y", "-loglevel", "error", *inputs, "-filter_complex", ";".join(chains),
           "-map", last, *amap, "-c:v", "libx264", "-preset", a.preset, "-crf", str(a.crf),
           "-pix_fmt", "yuv420p", *acodec, "-movflags", "+faststart", str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    try:
        for buf, _ in strip_frames(W, H, fps, dur, chapters, floating=a.bar_y < 0.99):
            proc.stdin.write(buf)
    except BrokenPipeError:
        pass
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit("ffmpeg failed")
    if (tmp / "sfx.wav").exists():
        shutil.copy(tmp / "sfx.wav", out.with_suffix(".sfx.wav"))
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"wrote {out}  ({W}x{H}, {dur:.1f}s, {len(cards)} cards, {len(chapters)} chapters)")
    result = {"ok": True, "video": str(out), "width": W, "height": H, "duration": round(dur, 2),
              "cards": len(cards), "chapters": len(chapters)}
    if out.with_suffix(".sfx.wav").exists():
        result["sfx_stem"] = str(out.with_suffix(".sfx.wav"))
    if a.sheet:
        result["sheet"] = str(sheet(out, [c["at"] + 1.2 for c in cards] or [dur * k / 6 for k in range(1, 6)]))
    if getattr(a, "json", False):
        print(json.dumps(result))
    return result


# ---------------------------------------------------------------- sound
def build_sfx(cards, dur, path, sr=44100, peak_db=-16.0):
    """Quiet SFX track: a soft whoosh on every card entrance plus each animated kind's beats (anim.BEATS).
    peak_db keeps it well under the voice; the stem is also saved next to the output for editing."""
    import wave
    rng = np.random.default_rng(7)
    n = int(sr * (dur + 1)); out = np.zeros(n)
    T = lambda d: np.arange(int(sr * d)) / sr
    def add(at, sig, g=1.0):
        i = int(at * sr)
        if i < n: out[i:i + len(sig)] += g * sig[: n - i]
    def whoosh(d=0.4):
        x = T(d); z = np.convolve(rng.standard_normal(len(x)), np.ones(30) / 30, "same")
        return 2.2 * z * np.sin(np.pi * x / d) ** 2
    def tone(f, d, decay):
        x = T(d); return np.sin(2 * np.pi * f * x) * np.minimum(1, x / 0.003) * np.exp(-x / decay)
    S = {
        "pop": lambda: tone(880, 0.12, 0.03) + 0.6 * tone(440, 0.12, 0.04),
        "tick": lambda: 0.6 * tone(2600, 0.03, 0.005),
        "swish": lambda: whoosh(0.3),
        "ding": lambda: tone(1318.5, 0.6, 0.15) + 0.7 * tone(1975.5, 0.6, 0.12),
        "down": lambda: np.concatenate([tone(f, 0.07, 0.03) for f in (988, 784, 659)]),
        "roll": lambda: (lambda x: 0.5 * np.sin(2 * np.pi * (90 + 40 * x) * x) * np.sin(np.pi * x / 1.4))(T(1.4)),
    }
    for c in cards:
        add(max(0, c["at"] - 0.1), whoosh(), 0.6)
        beats = BEATS.get(c.get("kind"), [])
        if c.get("kind") == "split":
            beats = [(c.get("t_split", 0.5), "pop"), (c.get("t_tax", 1.6), "swish"), (c.get("t_keep", 2.5), "ding")]
        if c.get("kind") == "curve" and c.get("delay"):
            beats = [(b + c["delay"], n) for b, n in beats]
        for bt, name in beats:
            if bt < c.get("dur", 4.5):
                add(c["at"] + bt, S[name]())
    peak = np.max(np.abs(out)) or 1
    out = out / peak * 10 ** (peak_db / 20)
    st = np.repeat((out * 32767).astype(np.int16)[:, None], 2, axis=1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(st.tobytes())


def sheet(video, times):
    """Contact sheet at each card's settled moment, for review."""
    video = Path(video)
    tmp = Path(tempfile.mkdtemp(prefix="mf-sheet-"))
    shots = []
    for i, t in enumerate(times[:10]):
        p = tmp / f"{i}.png"
        subprocess.run([FF, "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(video),
                        "-frames:v", "1", "-vf", "scale=360:-2", str(p)], check=True)
        shots.append(Image.open(p))
    if not shots: return
    w, h = shots[0].size
    out = Image.new("RGB", (w * len(shots), h), INK)
    for i, im in enumerate(shots):
        out.paste(im, (i * w, 0))
    dst = video.with_suffix(".sheet.png"); out.save(dst)
    print(f"wrote {dst}")
    return dst


def cmd_transcribe(a):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("pip install faster-whisper  (runs on CPU; 'small' takes ~1x realtime)")
    model = WhisperModel(a.model, device="auto", compute_type="int8")
    segs, _ = model.transcribe(a.clip, word_timestamps=True, vad_filter=True)
    words, lines = [], []
    for sg in segs:
        lines.append({"start": round(sg.start, 2), "end": round(sg.end, 2), "text": sg.text.strip()})
        for w in sg.words or []:
            words.append({"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word.strip()})
    dst = Path(a.clip).with_suffix(".words.json")
    dst.write_text(json.dumps({"segments": lines, "words": words}, indent=1))
    print(f"wrote {dst}  ({len(lines)} segments)")
    if getattr(a, "json", False):
        print(json.dumps({"ok": True, "words_json": str(dst), "segments": lines}))


def cmd_join(a):
    """hook + clip -> one MP4 at the clip's size and frame rate; both re-encoded, audio resampled to 44.1 kHz."""
    W, H, fps, _ = probe(a.clip)
    out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    f = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={fps},setsar=1[a];"
         f"[1:v]fps={fps},setsar=1[b];[0:a]aresample=44100,volume={a.hook_gain}dB[x];[1:a]aresample=44100[y];"
         "[a][x][b][y]concat=n=2:v=1:a=1[v][au]")
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", a.hook, "-i", a.clip, "-filter_complex", f, "-map", "[v]",
                    "-map", "[au]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)], check=True)
    print(f"wrote {out}")
    if a.json:
        print(json.dumps({"ok": True, "video": str(out)}))


def cmd_demo(a):
    """Stand-in clip (moving gradient + tone) and the example cues -> out/overlay-demo/. No footage or keys needed."""
    out = ROOT / "out" / "overlay-demo"; out.mkdir(parents=True, exist_ok=True)
    clip = out / "standin.mp4"
    subprocess.run([FF, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "gradients=s=1080x1920:r=30:d=40:speed=0.02",
                    "-f", "lavfi", "-i", "sine=f=220:d=40", "-shortest", "-c:v", "libx264", "-preset", "veryfast",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", str(clip)], check=True)
    cues = ROOT / "examples" / "overlays" / "demo.cues.json"
    ns = argparse.Namespace(clip=str(clip), cues=str(cues), out=str(out / "demo.overlay.mp4"), crf=20, start=0,
                            preset="veryfast", sheet=True, bar_y=1.0, sfx=True, json=False)
    res = cmd_render(ns)
    hook = subprocess.run([sys.executable, str(Path(__file__).parent / "hook_alert.py"),
                           str(ROOT / "examples" / "overlays" / "hook.json"), str(out / "hook")], check=True)
    cmd_join(argparse.Namespace(hook=str(out / "hook" / "hook.mp4"), clip=res["video"],
                                out=str(out / "demo.final.mp4"), hook_gain=-3.0, json=False))
    res["final"] = str(out / "demo.final.mp4")
    if getattr(a, "json", False):
        print(json.dumps(res))


def _load_anim():
    global ANIM, BEATS
    import anim
    ANIM, BEATS = anim.KINDS, anim.BEATS


ANIM, BEATS = {}, {}


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    _load_anim()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("render"); r.add_argument("clip"); r.add_argument("--cues"); r.add_argument("--out")
    r.add_argument("--crf", type=int, default=18); r.add_argument("--preset", default="veryfast")
    r.add_argument("--sheet", action="store_true")
    r.add_argument("--json", action="store_true", help="print a JSON result as the last line")
    r.add_argument("--start", type=float, default=0.0, help="cut this many seconds off the start first (cue times then count from the cut)")
    r.add_argument("--sfx", action="store_true", help="mix a quiet whoosh/beat SFX track under the original audio")
    r.add_argument("--bar-y", type=float, default=1.0, help="bottom edge of the progress strip as a fraction of frame height (1.0 = bottom; e.g. 0.78 to clear burned-in captions or platform UI)")
    t = sub.add_parser("transcribe"); t.add_argument("clip"); t.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "small"))
    t.add_argument("--json", action="store_true")
    dm = sub.add_parser("demo"); dm.add_argument("--json", action="store_true")
    j = sub.add_parser("join", help="put a hook (or any intro) in front of a clip")
    j.add_argument("hook"); j.add_argument("clip"); j.add_argument("out")
    j.add_argument("--hook-gain", type=float, default=-3.0, help="dB applied to the hook's audio (default -3)")
    j.add_argument("--json", action="store_true")
    a = ap.parse_args()
    {"render": cmd_render, "transcribe": cmd_transcribe, "demo": cmd_demo, "join": cmd_join}[a.cmd](a)


if __name__ == "__main__":
    main()
