"""Animated explainer cards for footage overlays. Each kind is a function (t, card, size, accent) -> RGBA image,
where t runs from 0 at the card's entrance. All cards share the static cards' chrome (dark panel, accent edge,
kicker pill) so a clip can mix both.

Kinds and their cue fields:
  split      total, basis, rate, [labels]  e.g. {"total": 1000, "basis": 100, "rate": 0.10} (in $M)
             A bar splits into original value and gains, the tax slice lifts off, and the heirs' share counts up.
  curve      [left, right]  A landscape with a local and a global peak. A ball wobbles on the small peak, then
             rolls across the valley to the tall one.
  pricedrop  items: ["Energy", ...], [anchor: "Music file"]  Cost bars shrink toward $0 one after another. The
             anchor row is already at ~$0.
  map        highlight: ["NV", "UT", ...], value: "245M", unit: "acres", label: "..."  States on a tile-grid US map
             light up west to east while the number counts up.

Each kind also lists SFX beats (seconds from entrance) in BEATS for overlay.py's sound pass.
"""
import math
from PIL import Image, ImageDraw, ImageFilter

from overlay import font, HEAD, BODY, BODY_B, MONO, INK, PAPER

MUTED = (120, 138, 156)
TRACK = (34, 52, 68)
WARN = (255, 92, 92)
GOOD = (60, 230, 140)


def clamp(x): return max(0.0, min(1.0, x))
def out_expo(x): x = clamp(x); return 1.0 if x >= 1 else 1 - 2 ** (-10 * x)
def out_cubic(x): x = clamp(x); return 1 - (1 - x) ** 3
def in_out(x): x = clamp(x); return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2
def out_back(x, s=1.7): x = clamp(x) - 1; return 1 + (s + 1) * x ** 3 + s * x ** 2
def lerp(a, b, k): return a + (b - a) * k
def mix(c1, c2, k): return tuple(int(lerp(a, b, k)) for a, b in zip(c1, c2))


def money_m(m):
    """$ in millions -> '$90M' / '$1B' / '$1.2B'."""
    if m >= 1000:
        v = m / 1000
        return f"${v:.0f}B" if abs(v - round(v)) < 0.05 else f"${v:.1f}B"
    return f"${m:,.0f}M"


def chrome(size, card, accent, s):
    w, h = size
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=int(34 * s), fill=INK + (232,))
    d.rounded_rectangle((0, 0, int(10 * s), h - 1), radius=int(5 * s), fill=accent)
    k = (card.get("kicker") or "").upper()
    if k:
        kf = font(MONO, int(28 * s))
        tw = d.textlength(k, font=kf)
        x, y = int(44 * s), int(30 * s)
        d.rounded_rectangle((x, y, x + tw + 24 * s, y + kf.size + 16 * s), radius=int(9 * s), fill=accent)
        d.text((x + 12 * s, y + 7 * s), k, font=kf, fill=INK)
    t = card.get("title")
    if t:
        tf = font(HEAD, int(56 * s))
        d.text((int(44 * s) + (d.textlength(k, font=font(MONO, int(28 * s))) + 44 * s if k else 0), int(22 * s)),
               t, font=tf, fill=PAPER)
    return img, d


# ---------------------------------------------------------------- split
def _retime(t, src, dst):
    """Piecewise-map time so beat src[i] lands where the drawing code expects dst[i]. Between beats the
    drawing runs at normal speed and then holds just before the next beat until it arrives."""
    if t < src[0]:
        return t - src[0] + dst[0]
    for i in range(len(src) - 1):
        if t < src[i + 1]:
            return min(t - src[i] + dst[i], dst[i + 1] - 1e-3)
    return t - src[-1] + dst[-1]


def split(t, card, size, accent):
    w, h = size; s = w / 900
    img, d = chrome(size, card, accent, s)
    total, basis, rate = card.get("total", 1000), card.get("basis", 100), card.get("rate", 0.10)
    # beat times (s from entrance) so the split / tax / heirs moments can land on the speaker's words
    ts, tt, tk = card.get("t_split", 0.5), card.get("t_tax", 1.6), card.get("t_keep", 2.5)
    t = t if (ts, tt, tk) == (0.5, 1.6, 2.5) else _retime(t, (ts, tt, tk), (0.5, 1.6, 2.5))
    gains = total - basis; tax = gains * rate; keep = total - tax
    x0, x1 = 44 * s, w - 44 * s
    by, bh = 150 * s, 66 * s
    gap = 10 * s * out_cubic((t - 0.5) / 0.5)
    k_split = out_expo((t - 0.5) / 0.6)
    bw = x1 - x0 - gap
    bx = x0 + bw * (basis / total)
    lf, vf = font(BODY, int(32 * s)), font(BODY_B, int(34 * s))
    # whole estate bar
    if k_split <= 0:
        d.rounded_rectangle((x0, by, x1, by + bh), radius=int(12 * s), fill=mix(TRACK, accent, 0.35))
        txt = "ESTATE " + money_m(total)
        d.text(((x0 + x1) / 2 - d.textlength(txt, font=vf) / 2, by + bh / 2 - vf.size * 0.6), txt, font=vf, fill=PAPER)
    else:
        d.rounded_rectangle((x0, by, bx, by + bh), radius=int(12 * s), fill=MUTED)
        gx0 = bx + gap
        # gains segment; the tax slice is cut from its right end and lifts away
        slice_w = (x1 - gx0) * rate
        lift = out_back((t - 1.6) / 0.55) if t >= 1.6 else 0
        d.rounded_rectangle((gx0, by, x1 - (slice_w + 6 * s) * (1 if t >= 1.6 else 0), by + bh), radius=int(12 * s),
                            fill=mix(accent, GOOD, out_cubic((t - 2.5) / 0.4)))
        if t >= 1.6:
            sy = by - 70 * s * lift
            d.rounded_rectangle((x1 - slice_w, sy, x1, sy + bh), radius=int(12 * s), fill=WARN)
            lab = f"{rate * 100:.0f}% TAX  {money_m(tax)}"
            a = clamp((t - 1.85) / 0.25)
            if a > 0:
                tf = font(BODY_B, int(32 * s))
                tw = d.textlength(lab, font=tf)
                d.text((x1 - tw, sy - 44 * s), lab, font=tf, fill=WARN + (int(255 * a),))
        a = clamp((t - 0.8) / 0.3)
        if a > 0:
            d.text((x0, by + bh + 12 * s), money_m(basis) + " paid in", font=lf, fill=MUTED + (int(255 * a),))
            g = money_m(gains) + " unrealized gains"
            d.text((x1 - d.textlength(g, font=lf), by + bh + 12 * s), g, font=lf, fill=PAPER + (int(255 * a),))
    # payoff line
    if t >= 2.5:
        k = out_expo((t - 2.5) / 0.8)
        hf = font(HEAD, int(92 * s))
        val = money_m(round(lerp(total * 0.6, keep, k)))
        d.text((x0, 288 * s), "HEIRS KEEP", font=font(BODY_B, int(40 * s)), fill=PAPER)
        d.text((x1 - d.textlength(val, font=hf), 268 * s), val, font=hf, fill=GOOD)
    return img


# ---------------------------------------------------------------- curve
def _land(u):
    """Fitness landscape over u in 0..1: small peak at .24, valley at .45, tall peak at .74. Returns height 0..1."""
    g = lambda c, wd, a: a * math.exp(-((u - c) / wd) ** 2)
    return 0.06 + g(0.24, 0.10, 0.42) + g(0.74, 0.13, 0.86)


def curve(t, card, size, accent):
    w, h = size; s = w / 900
    img, d = chrome(size, card, accent, s)
    x0, x1, base, top = 44 * s, w - 44 * s, h - 34 * s, 120 * s
    X = lambda u: lerp(x0, x1, u)
    Y = lambda u: base - (base - top) * _land(u)
    reveal = out_cubic(t / 0.7)
    pts = [(X(i / 200), Y(i / 200)) for i in range(int(200 * reveal) + 1)]
    if len(pts) > 1:
        poly = pts + [(pts[-1][0], base), (x0, base)]
        d.polygon(poly, fill=mix(INK, accent, 0.12) + (255,))
        d.line(pts, fill=accent, width=int(6 * s), joint="curve")
    lf = font(BODY_B, int(30 * s))
    left, right = card.get("left", "LOCAL MAX"), card.get("right", "GLOBAL MAX")
    if t > 0.45:
        a = int(255 * clamp((t - 0.45) / 0.3))
        d.text((X(0.24) - d.textlength(left, font=lf) / 2, Y(0.24) - 92 * s), left, font=lf, fill=MUTED + (a,))
    if t > 0.65:
        arrived = clamp((t - 3.1) / 0.3)
        a = int(255 * clamp((t - 0.65) / 0.3))
        col = mix(MUTED, GOOD, arrived)
        d.text((X(0.74) - d.textlength(right, font=lf) / 2, Y(0.74) - 92 * s), right, font=lf, fill=col + (a,))
    # ball: wobbles on the local peak, then rolls across the valley to the global peak
    if t > 0.7:
        if t < 1.7:
            u = 0.24 + 0.018 * math.sin((t - 0.7) * 14) * (1 - clamp((t - 1.3) / 0.4))
            if t > 0.9:
                sf = font(MONO, int(26 * s))
                d.text((X(0.24) + 40 * s, Y(0.24) - 46 * s), "stuck", font=sf, fill=WARN + (int(255 * clamp((t - 0.9) / 0.2) * (1 - clamp((t - 1.6) / 0.15))),))
        else:
            k = in_out((t - 1.7) / 1.4)
            u = lerp(0.24, 0.74, k)
            for j in range(1, 9):   # trail
                ut = lerp(0.24, 0.74, in_out((t - 1.7 - j * 0.035) / 1.4))
                r = (13 - j) * s
                d.ellipse((X(ut) - r, Y(ut) - 18 * s - r, X(ut) + r, Y(ut) - 18 * s + r), fill=accent + (int(160 - j * 18),))
        r = 18 * s
        bx, byy = X(u), Y(u) - r
        if t > 3.1:   # arrival ring
            k = clamp((t - 3.1) / 0.5); rr = r + 50 * s * k
            d.ellipse((bx - rr, byy - rr, bx + rr, byy + rr), outline=GOOD + (int(255 * (1 - k)),), width=int(4 * s))
        d.ellipse((bx - r, byy - r, bx + r, byy + r), fill=PAPER, outline=accent, width=int(4 * s))
    return img


# ---------------------------------------------------------------- pricedrop
def pricedrop(t, card, size, accent):
    w, h = size; s = w / 900
    img, d = chrome(size, card, accent, s)
    anchor = card.get("anchor", "Music file")
    items = [anchor] + card.get("items", ["Energy", "Housing", "Food", "Healthcare"])[:5]
    x0, x1 = 44 * s, w - 44 * s
    y0 = 104 * s
    rh = (h - y0 - 26 * s) / len(items)
    nf = font(BODY_B, int(min(34, rh / s * 0.6) * s))
    vf = font(MONO, int(min(30, rh / s * 0.52) * s))
    lx = x0 + 230 * s
    tail = 120 * s
    for i, name in enumerate(items):
        y = y0 + i * rh
        k_in = out_cubic((t - 0.1 - i * 0.07) / 0.35)
        if k_in <= 0:
            continue
        cy = y + rh / 2
        d.text((x0, cy - nf.size * 0.62), name, font=nf, fill=(accent if i == 0 else PAPER) + (int(255 * k_in),))
        full = (x1 - tail) - lx
        if i == 0:
            frac = 0.03
        else:
            start = 0.7 + (i - 1) * 0.5
            frac = lerp(1.0, 0.03, out_expo((t - start) / 1.1))
        bh = rh * 0.42
        d.rounded_rectangle((lx, cy - bh / 2, x1 - tail, cy + bh / 2), radius=int(bh / 2), fill=TRACK + (int(255 * k_in),))
        col = mix(WARN, GOOD, clamp((1 - frac) / 0.97)) if i else GOOD
        d.rounded_rectangle((lx, cy - bh / 2, lx + max(bh, full * frac * k_in), cy + bh / 2), radius=int(bh / 2), fill=col)
        lab = "~$0" if frac < 0.06 else ("$" * max(1, round(frac * 4)))
        d.text((x1 - tail + 18 * s, cy - vf.size * 0.62), lab, font=vf, fill=col)
    return img


# ---------------------------------------------------------------- map
TILES = {  # tile-grid US map: state -> (col, row)
    "AK": (0, 0), "ME": (11, 0), "WI": (6, 1), "VT": (10, 1), "NH": (11, 1),
    "WA": (1, 2), "ID": (2, 2), "MT": (3, 2), "ND": (4, 2), "MN": (5, 2), "IL": (6, 2), "MI": (7, 2), "NY": (9, 2), "MA": (10, 2),
    "OR": (1, 3), "NV": (2, 3), "WY": (3, 3), "SD": (4, 3), "IA": (5, 3), "IN": (6, 3), "OH": (7, 3), "PA": (8, 3), "NJ": (9, 3), "CT": (10, 3), "RI": (11, 3),
    "CA": (1, 4), "UT": (2, 4), "CO": (3, 4), "NE": (4, 4), "MO": (5, 4), "KY": (6, 4), "WV": (7, 4), "VA": (8, 4), "MD": (9, 4), "DE": (10, 4),
    "AZ": (2, 5), "NM": (3, 5), "KS": (4, 5), "AR": (5, 5), "TN": (6, 5), "NC": (7, 5), "SC": (8, 5), "DC": (9, 5),
    "OK": (4, 6), "LA": (5, 6), "MS": (6, 6), "AL": (7, 6), "GA": (8, 6),
    "HI": (0, 7), "TX": (4, 7), "FL": (9, 7),
}


def usmap(t, card, size, accent):
    w, h = size; s = w / 900
    img, d = chrome(size, card, accent, s)
    hl = card.get("highlight", ["NV", "UT", "ID", "OR", "WY", "CA", "AZ", "NM", "MT", "CO", "AK"])
    gx0, gy0 = 44 * s, 104 * s
    cell = min((w * 0.58) / 12, (h - gy0 - 24 * s) / 8)
    g = cell * 0.12
    order = sorted(hl, key=lambda st: (TILES[st][0], TILES[st][1]))
    lit_at = {st: 0.6 + i * (1.4 / max(1, len(order))) for i, st in enumerate(order)}
    sf = font(BODY_B, int(cell * 0.34))
    for st, (c, r) in TILES.items():
        k_in = out_cubic((t - 0.05 - (c + r) * 0.02) / 0.3)
        if k_in <= 0:
            continue
        x, y = gx0 + c * cell, gy0 + r * cell
        col = TRACK
        if st in lit_at:
            col = mix(TRACK, accent, out_expo((t - lit_at[st]) / 0.3))
        pad = g + (1 - k_in) * cell * 0.3
        d.rounded_rectangle((x + pad, y + pad, x + cell - pad, y + cell - pad), radius=int(cell * 0.14), fill=col)
        if st in lit_at and t >= lit_at[st]:
            d.text((x + cell / 2 - d.textlength(st, font=sf) / 2, y + cell / 2 - sf.size * 0.62), st, font=sf, fill=INK)
    tx = gx0 + 12 * cell + 30 * s
    tw = w - 44 * s - tx
    value, unit = card.get("value", "245M"), card.get("unit", "acres")
    num = "".join(ch for ch in value if ch.isdigit() or ch == ".")
    suffix = value[len(num):] if value.startswith(num) else ""
    k = out_expo((t - 0.6) / 1.6)
    shown = (f"{float(num) * k:.0f}" if num else value) + suffix
    hf = font(HEAD, int(96 * s))
    d.text((tx, 120 * s), shown, font=hf, fill=accent)
    d.text((tx, 120 * s + hf.size * 1.02), unit, font=font(BODY_B, int(40 * s)), fill=PAPER)
    lab = card.get("label", "")
    if lab and t > 1.2:
        lf = font(BODY, int(30 * s))
        words, line, y = lab.split(), "", 120 * s + hf.size * 1.02 + 60 * s
        a = int(255 * clamp((t - 1.2) / 0.3))
        for wd in words:
            trial = (line + " " + wd).strip()
            if d.textlength(trial, font=lf) > tw and line:
                d.text((tx, y), line, font=lf, fill=(200, 210, 222, a)); y += lf.size * 1.25; line = wd
            else:
                line = trial
        if line:
            d.text((tx, y), line, font=lf, fill=(200, 210, 222, a))
    return img


KINDS = {"split": split, "curve": curve, "pricedrop": pricedrop, "map": usmap}

# SFX beats (seconds from entrance): (time, sound)
BEATS = {
    "split": [(0.5, "pop"), (1.6, "swish"), (2.5, "ding")],
    "curve": [(0.75, "tick"), (1.7, "roll"), (3.1, "ding")],
    "pricedrop": [(0.7 + i * 0.5 + 0.6, "down") for i in range(4)],
    "map": [(0.6 + i * 0.13, "tick") for i in range(11)] + [(2.2, "ding")],
}
