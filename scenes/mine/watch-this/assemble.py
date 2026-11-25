"""Watch This: assemble the 45 s film from 7 Kling shots, the narrator take, two kid lines and the score.

usage: python3 assemble.py [--still t ...] [--audio-only]
media/ holds s1..s7.mp4, narr.wav, kid5.wav, kid9.wav, score.mp3, words.json (faster-whisper word times).
Everything is timed from the narrator's real phrase boundaries; cuts sit just before a phrase onset.
"""
import json, subprocess, sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
M = os.path.join(HERE, 'media')
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)
W, H, FPS, SR = 1080, 1920, 24, 48000
FILES = {'s2': 's2b', 's6': 's6b', 's7': 's7b'}       # v2 re-rolls: real shallow focus, sun behind the kid, focus pulls
TEMPO = 1.14
FONT = '/usr/share/fonts/opentype/inter/Inter-{}.otf'


def read_audio(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def tempo(x, t):
    if abs(t - 1) < 1e-3:
        return x
    p = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                        '-af', f'atempo={t}', '-f', 'f32le', '-'], input=x.tobytes(), capture_output=True, check=True)
    return np.frombuffer(p.stdout, np.float32).copy()


def refine_end(a, start, wend, nxt=None):
    """Keep everything up to the real pause after the last word, plus 0.15 s (final consonants)."""
    hop = int(0.01 * SR)
    e = np.sqrt(np.convolve(a ** 2, np.ones(hop * 4) / (hop * 4), 'same'))
    peak = e[int(start * SR):int(wend * SR)].max()
    i = int((wend - 0.25) * SR)
    lim = int(min(wend + 0.6, nxt if nxt else 1e9, len(a) / SR) * SR)
    quiet = 0
    while i < lim:
        quiet = quiet + hop if e[i] < peak * 0.06 else 0
        if quiet >= int(0.08 * SR):
            return min(i / SR - 0.08 + 0.15, nxt - 0.02 if nxt else 1e9)
        i += hop
    return lim / SR


def squeeze(x, keep=0.28, longer=0.4):
    """Shorten every silence inside a phrase longer than `longer` s to `keep` s (the take is slow and pausey).
    Returns the new audio and a time map old->new for the captions."""
    hop = int(0.01 * SR)
    n = len(x) // hop
    e = np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(1))
    quiet = e < e.max() * 0.05
    out, cuts, i, pos = [], [], 0, 0
    while i < n:
        j = i
        while j < n and quiet[j] == quiet[i]:
            j += 1
        a, b = i * hop, (j * hop if j < n else len(x))
        if quiet[i] and i == 0 and j < n and (b - a) > 0.06 * SR:          # leading air (whisper starts words early)
            seg = x[b - int(0.05 * SR):b]
            cuts.append((a / SR, b / SR, (b - a - int(0.05 * SR)) / SR))
        elif quiet[i] and i > 0 and j < n and (b - a) > longer * SR:
            k = int(keep * SR)
            seg = np.concatenate([x[a:a + k // 2], x[b - k // 2:b]])
            cuts.append((a / SR, b / SR, (b - a - k // 2 * 2) / SR))
        else:
            seg = x[a:b]
        out.append(seg)
        i = j
    y = np.concatenate(out) if out else x

    def remap(t):
        d = 0.0
        for a, b, rem in cuts:
            if t >= b:
                d += rem
            elif t > a:
                d += min(rem, t - a)
        return t - d
    return y, remap


def fade(x, ms=12):
    n = int(SR * ms / 1000)
    if len(x) > 2 * n:
        x[:n] *= np.linspace(0, 1, n)
        x[-n:] *= np.linspace(1, 0, n)
    return x


# ---------------------------------------------------------------- the narration, phrase by phrase
words = json.load(open(os.path.join(M, 'words.json')))
NW = words['narr.wav']
narr = read_audio(os.path.join(M, 'narr.wav'))


def span(first, last, after=None):
    """Source span from the word index `first` to `last` (inclusive)."""
    s = max(0.0, NW[first][1] - 0.06)
    nxt = NW[last + 1][1] if last + 1 < len(NW) else None
    return s, refine_end(narr, s, NW[last][2], nxt)


def find(word, start_at=0):
    for i in range(start_at, len(NW)):
        if NW[i][0].strip(' ,.!?').lower() == word.lower():
            return i
    raise KeyError(word)


def phrase(first_word, last_word, from_i=0):
    i = find(first_word, from_i)
    j = find(last_word, i)
    return i, j


ix = {}
ix['P1'] = phrase('By', '18')
ix['P2'] = phrase("you've", 'them', ix['P1'][1] + 1)          # skips the garbled "I've already dated…" stumble
ix['P3'] = phrase('It', 'this', ix['P2'][1])
ix['P4'] = phrase('At', 'cartwheel', ix['P3'][1])
ix['P5'] = phrase('At', 'bike', ix['P4'][1])
ix['P6'] = phrase('At', 'saw', ix['P5'][1])
ix['P7'] = phrase("They'll", 'times', ix['P6'][1])
ix['P8'] = phrase('Then', 'time', ix['P7'][1])
ix['P9'] = phrase('And', 'time', ix['P8'][1])
ix['P10'] = phrase('Your', 'back', ix['P9'][1])
ix['P11'] = phrase('Whatever', 'life', ix['P10'][1])
ix['P12'] = phrase('So', 'this', ix['P11'][1])
ix['P13'] = (len(NW) - 1, len(NW) - 1)

clips, cap_words = {}, {}
for k, (i, j) in ix.items():
    s, e = span(i, j)
    if k == 'P13':
        e = min(len(narr) / SR, NW[-1][2] + 0.5)
    seg, rm = squeeze(narr[int(s * SR):int(e * SR)].copy())
    clips[k] = tempo(fade(seg), TEMPO)
    cap_words[k] = [(w.strip(), rm(a - s) / TEMPO, rm(b - s) / TEMPO) for w, a, b in NW[i:j + 1]]

# caption text follows the script's punctuation, not whisper's
FIX = {('P1', '18'): 'eighteen,', ('P2', '93'): '93%', ('P2', '%'): None, ('P2', 'them'): 'them.',
       ('P3', 'this'): 'this.', ('P4', 'cartwheel'): 'cartwheel.', ('P5', 'nine,'): 'nine,', ('P5', 'bike'): 'bike.',
       ('P6', '13,'): 'thirteen,', ('P6', 'anymore'): 'anymore.', ('P6', 'over'): 'over…', ('P6', 'saw'): 'saw.',
       ('P7', 'times'): 'times.', ('P8', 'time'): 'time.', ('P9', 'time'): 'time.', ('P10', 'back'): 'back.',
       ('P11', 'at'): 'at…', ('P11', 'life'): 'life.', ('P12', 'watch'): '“watch', ('P12', 'this'): 'this”…',
       ('P13', 'Watch'): 'watch.'}
for k in list(cap_words):
    out = []
    for w, a, b in cap_words[k]:
        r = FIX.get((k, w), w)
        if r is None:
            out[-1] = (out[-1][0], out[-1][1], b)
            continue
        out.append((r, a, b))
    cap_words[k] = out

kid5 = read_audio(os.path.join(M, 'kid5.wav'))
k5w = words['kid5.wav']
clips['K5'] = fade(kid5[:int(min(k5w[1][2] + 0.2, k5w[2][1] - 0.05) * SR)].copy())   # one "Watch this!"
cap_words['K5'] = [('“Watch', 0, 0.5), ('this!”', 0.5, 1.2)]
kid9 = read_audio(os.path.join(M, 'kid9.wav'))
clips['K9'] = fade(kid9[:int(min(len(kid9) / SR, words['kid9.wav'][-1][2] + 0.25) * SR)].copy())
cap_words['K9'] = [('“Dad,', 0, 0.5), ('watch', 0.5, 1.0), ('this!”', 1.0, 1.6)]

# ---------------------------------------------------------------- the timeline
# (clip, gap before, volume); shot cuts are anchored to clip onsets
SEQ = [('D', 0.0, 0.0), ('P1', 0.15, 1), ('P2', 0.3, 1),
       ('P3', 0.55, 1), ('K5', 0.25, 0.85), ('P4', 0.3, 1),
       ('K9', 0.45, 0.85), ('P5', 0.25, 1),
       ('P6', 0.55, 1),
       ('P7', 0.65, 1), ('P8', 0.3, 1),
       ('P9', 0.55, 1), ('P10', 2.1, 1), ('P11', 0.25, 1),
       ('P12', 1.3, 1), ('P13', 0.4, 1)]
# s1's own sound: the kid in the background calls "Dad! … Hey, Dad!" and he doesn't look up (0-3 s)
clips['D'] = np.zeros(int(2.9 * SR), np.float32)
cap_words['D'] = [('“Dad!', 0.0, 1.22), ('Hey,', 1.98, 2.46), ('Dad!”', 2.56, 2.96)]
T, t = {}, 0.0
for name, gap, vol in SEQ:
    t += gap
    T[name] = (t, t + len(clips[name]) / SR, vol)
    t = T[name][1]
BLACK = T['P13'][1] + 1.1
END = BLACK + 2.6

CUTS = {  # shot: (start, end)
    's1': (0.0, T['K5'][0] - 0.06),                      # the cut lands on the kid's "Watch this!"
    's2': (T['K5'][0] - 0.06, T['K9'][0] - 0.25),
    's3': (T['K9'][0] - 0.25, T['P6'][0] - 0.3),
    's4': (T['P6'][0] - 0.3, T['P7'][0] - 0.3),
    's5': (T['P7'][0] - 0.3, T['P9'][0] - 0.25),
    's6': (T['P9'][0] - 0.25, T['P12'][0] - 0.85),
    's7': (T['P12'][0] - 0.85, BLACK),
}


def build_audio():
    n = int(END * SR) + SR
    voice = np.zeros(n, np.float32)
    for name, (a, b, vol) in T.items():
        x = clips[name] * vol
        voice[int(a * SR):int(a * SR) + len(x)] += x
    # kid voices sit further away: a touch of room (short slap delays)
    music = read_audio(os.path.join(M, 'score.mp3'))
    music = np.pad(music, (0, max(0, n - len(music))))[:n]
    env = np.full(n, 0.55, np.float32)
    sil_a, sil_b = T['P9'][1] + 0.05, T['P10'][0] - 0.05            # the silence: music drops out completely
    tt = np.arange(n) / SR
    env[(tt > sil_a) & (tt < sil_b)] = 0.0
    env[tt >= sil_b] = 0.42
    env = np.convolve(env, np.ones(int(0.25 * SR)) / int(0.25 * SR), 'same')        # 250 ms ramps
    # duck under speech
    v = np.convolve(np.abs(voice), np.ones(int(0.05 * SR)) / int(0.05 * SR), 'same')
    duck = np.clip(v / 0.05, 0, 1)
    duck = np.convolve(duck, np.ones(int(0.3 * SR)) / int(0.3 * SR), 'same')
    env *= 1 - 0.45 * duck
    fo = (tt > END - 1.2)
    env[fo] *= np.clip((END - tt[fo]) / 1.2, 0, 1)
    # each shot's own sound (yard, birds, the kid) at 1x from the cut, looped with crossfades if the shot runs long
    amb = np.zeros(n, np.float32)
    for shot, (a, b) in CUTS.items():
        src = read_audio(os.path.join(M, FILES.get(shot, shot) + '.mp4'))
        if shot == 's7':
            src = src[:int(2.4 * SR)]                        # after that the kid calls out, over the narrator
        need = int((b - a + 0.3) * SR)
        xf = int(0.4 * SR)
        y = src.copy()
        while len(y) < need:
            tail = y[-xf:] * np.linspace(1, 0, xf) + src[:xf] * np.linspace(0, 1, xf)
            y = np.concatenate([y[:-xf], tail, src[xf:]])
        y = y[:need]
        g = np.ones(need, np.float32) * AMB.get(shot, 0.3)
        if shot == 's1':
            g[:int(3.3 * SR)] = 1.0                          # the kid's calls are heard clearly
        y = y * g
        y[:int(0.03 * SR)] *= np.linspace(0, 1, int(0.03 * SR))
        y[-int(0.3 * SR):] *= np.linspace(1, 0, int(0.3 * SR))
        i0 = int(a * SR)
        amb[i0:i0 + need] += y[:max(0, min(need, n - i0))]
    vd = np.convolve(np.abs(voice), np.ones(int(0.05 * SR)) / int(0.05 * SR), 'same')
    vd = np.convolve(np.clip(vd / 0.05, 0, 1), np.ones(int(0.3 * SR)) / int(0.3 * SR), 'same')
    amb *= 1 - 0.5 * vd
    amb[tt > BLACK] *= np.clip(1 - (tt[tt > BLACK] - BLACK) / 0.4, 0, 1)
    mix = voice * 1.0 + music * env + amb
    mix /= max(1e-6, np.abs(mix).max()) / 0.89
    path = os.path.join(OUT, 'mix.wav')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', str(SR), '-ac', '2', path],
                   input=mix[:int(END * SR)].astype(np.float32).tobytes(), check=True)
    return path


# ---------------------------------------------------------------- picture
def load(path):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={W}:{H}:flags=lanczos,fps={FPS}',
                          '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(out, np.uint8).reshape(-1, H, W, 3)


yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIG = 1 - 0.38 * np.clip(((xx - W / 2) / (W * 0.62)) ** 2 + ((yy - H * 0.47) / (H * 0.6)) ** 2, 0, 1) ** 1.4
VIG = VIG[..., None]


# director notes: saturated red cap, deeper porch shadows, low backlight haze + an edge flare on the golden-hour shots
FLARE = np.exp(-(((xx - W * 0.92) / (W * 0.55)) ** 2 + ((yy - H * 0.16) / (H * 0.32)) ** 2))[..., None] \
    * np.array([1.0, 0.62, 0.28], np.float32)
HAZE = np.clip(1 - yy / (H * 0.55), 0, 1)[..., None] * np.array([1.0, 0.8, 0.55], np.float32)
GOLDEN = {'s2': 0.25, 's3': 0.8, 's4': 0.6, 's6': 0.2, 's7': 0.25}   # the re-rolls carry their own sun
CRUSH = {'s6': 0.06, 's7': 0.12}


def grade(f, shot=None):
    x = f.astype(np.float32) / 255
    r, g, b = x[..., 0:1], x[..., 1:2], x[..., 2:3]
    red = np.clip((r - np.maximum(g, b)) / (r + 1e-3) * 2.2 - 0.6, 0, 1) * np.clip(r * 3, 0, 1)
    lum0 = 0.3 * r + 0.59 * g + 0.11 * b
    x = x + red * (x - lum0) * 0.75                          # the cap reads true red through the grade
    c = CRUSH.get(shot, 0.2)
    x = x * (1 - c + c * np.clip(lum0 / 0.35, 0, 1))        # deeper shadows so highlights and the phone glow pop
    if shot == 's6':
        x = x * 1.22                                         # the look-up take is dark; lift it a little
    if shot == 's7':                                         # a red flare ghost grows on the railing: neutralise it
        reg = x[1380:1800, 700:]
        reg[..., 0] = np.minimum(reg[..., 0], np.maximum(reg[..., 1], reg[..., 2]) * 1.2 + 0.02)
    k = GOLDEN.get(shot, 0)
    if k:
        x = x + FLARE * 0.10 * k + HAZE * 0.035 * k
    x = x * x * (3 - 2 * x) * 0.3 + x * 0.7                 # gentle S-curve
    lum = x.mean(axis=2, keepdims=True)
    x = x + lum * lum * np.array([0.035, 0.012, -0.03], np.float32)   # warm highlights; shadows keep the phone's blue
    x = x * 0.97 + 0.018                                     # lifted film blacks
    return x


def finish(x, n):
    x = x * VIG
    rng = np.random.default_rng(n)
    g = rng.normal(0, 0.022, (H // 2, W // 2, 1)).astype(np.float32)
    g = np.repeat(np.repeat(g, 2, 0), 2, 1)
    x = x + g * (0.6 + 0.4 * (1 - x.mean(axis=2, keepdims=True)))
    return (np.clip(x, 0, 1) * 255).astype(np.uint8)


def sample(clip, u):
    """Frame at fractional index u, blended between neighbours (smooth slow motion)."""
    u = float(np.clip(u, 0, len(clip) - 1))
    i = int(u)
    f = u - i
    if f < 1e-3 or i + 1 >= len(clip):
        return clip[i].astype(np.float32)
    return clip[i].astype(np.float32) * (1 - f) + clip[i + 1].astype(np.float32) * f


F_CAP = ImageFont.truetype(FONT.format('Medium'), 50)
F_CAP_I = ImageFont.truetype(FONT.format('MediumItalic'), 50)
F_END = ImageFont.truetype(FONT.format('Light'), 46)
F_N_T = ImageFont.truetype(FONT.format('SemiBold'), 34)
F_N_B = ImageFont.truetype(FONT.format('Regular'), 34)
F_N_S = ImageFont.truetype(FONT.format('Regular'), 26)


def captions(img, t):
    for name, (a, b, _) in T.items():
        hold = b + 0.35                                      # a caption never hangs across a picture cut
        for _, (ca, _cb) in CUTS.items():
            if b - 0.05 < ca < hold:
                hold = ca
        for other, (oa, _ob, _v) in T.items():               # …or into the next line
            if other != name and cap_words.get(other) and b - 0.05 < oa - 0.05 < hold:
                hold = oa - 0.05
        if not cap_words.get(name) or not (a - 0.05 <= t < hold):
            continue
        # one sentence (or at most 6 words) on screen at a time
        groups, cur = [], []
        for w in cap_words[name]:
            cur.append(w)
            if w[0][-1] in '.,…!”' and len(cur) >= 3 or len(cur) >= 6:
                groups.append(cur)
                cur = []
        if cur:
            if groups and len(cur) < 3:
                groups[-1] += cur
            else:
                groups.append(cur)
        rel = t - a
        gi = max([i for i, g in enumerate(groups) if rel >= g[0][1] - 0.08] or [0])
        ws = groups[gi]
        last = gi == len(groups) - 1
        kid = name.startswith('K')
        font = F_CAP_I if kid else F_CAP
        # wrap into lines of <= 860 px
        lines, cur = [], []
        d = ImageDraw.Draw(img)
        for w in ws:
            test = ' '.join(x[0] for x in cur + [w])
            if cur and d.textlength(test, font=font) > 860:
                lines.append(cur)
                cur = []
            cur.append(w)
        lines.append(cur)
        y0 = 1330 - (len(lines) - 1) * 64
        ov = Image.new('RGBA', img.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        fade_out = np.clip((hold - t) / 0.2, 0, 1) if last else 1.0
        for li, line in enumerate(lines):
            text = ' '.join(x[0] for x in line)
            x = (W - od.textlength(text, font=font)) / 2
            y = y0 + li * 64
            for w, ws_, we in line:
                on = t >= a + ws_ - 0.02
                alpha = int(255 * fade_out * (1.0 if on else 0.42))
                od.text((x + 2, y + 2), w, font=font, fill=(0, 0, 0, int(alpha * 0.55)))
                od.text((x, y), w, font=font, fill=(255, 255, 255, alpha))
                x += od.textlength(w + ' ', font=font)
        img.alpha_composite(ov)


def banner(img, t):
    """The kid's "Watch this!!" arrives as a notification on the viewer's own screen, and gets swiped away."""
    t_in, t_out = 0.25, 2.55
    if not (t_in <= t <= t_out + 0.35):
        return
    k_in = 1 - (1 - np.clip((t - t_in) / 0.35, 0, 1)) ** 3
    k_out = np.clip((t - t_out) / 0.3, 0, 1) ** 2
    y = 140 + (1 - k_in) * -260 - k_out * 420
    x0, w, h = 40, W - 80, 150
    ov = Image.new('RGBA', img.size, (0, 0, 0, 0))
    # frosted card: blur what's behind it
    box = (int(x0), int(max(0, y)), int(x0 + w), int(max(1, y + h)))
    if box[3] > box[1] + 2:
        behind = img.crop(box).filter(ImageFilter.GaussianBlur(28))
        mask = Image.new('L', behind.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, behind.size[0] - 1, behind.size[1] - 1), 38, fill=255)
        ov.paste(behind, box[:2], mask)
    od = ImageDraw.Draw(ov)
    od.rounded_rectangle((x0, y, x0 + w, y + h), 38, fill=(245, 245, 247, 185))
    od.rounded_rectangle((x0 + 28, y + 33, x0 + 112, y + 117), 20, fill=(255, 196, 64, 255))
    od.text((x0 + 70, y + 75), 'L', font=ImageFont.truetype(FONT.format('Bold'), 44), fill=(120, 72, 0, 255), anchor='mm')
    od.text((x0 + 136, y + 38), 'Leo', font=F_N_T, fill=(20, 20, 24, 255))
    od.text((x0 + w - 32, y + 40), 'now', font=F_N_S, fill=(90, 90, 96, 255), anchor='ra')
    od.text((x0 + 136, y + 82), 'Watch this!!', font=F_N_B, fill=(30, 30, 34, 255))
    img.alpha_composite(ov)


def end_card(img, t):
    k = np.clip((t - BLACK - 0.9) / 0.6, 0, 1)
    if k <= 0:
        return
    d = ImageDraw.Draw(img)
    for i, line in enumerate(['Send this to someone', 'who still says “watch this.”']):
        d.text((W / 2, 900 + i * 58), line, font=F_END, fill=(235, 232, 225, int(255 * k)), anchor='mm')


AMB = {'s1': 0.3, 's2': 0.45, 's3': 0.35, 's4': 0.4, 's5': 0.4, 's6': 0.45, 's7': 0.6}
# ---------------------------------------------------------------- the opening title (top third, first 3 s only)
TYPE = os.path.join(HERE, 'type')
T_OUT = 3.0                                                  # the title is gone before the narrator's first word lands


def _serif(size, italic=False, wght=500):
    f = ImageFont.truetype(os.path.join(TYPE, 'CormorantGaramond-Italic[wght].ttf' if italic
                                        else 'CormorantGaramond[wght].ttf'), size)
    f.set_variation_by_axes([wght])
    return f


F_T1, F_T2 = _serif(112, wght=600), _serif(70, italic=True, wght=500)
TITLE = [('You get 18 summers', F_T1, 288), ('with your kid.', F_T1, 400), ('Most parents spend them like this.', F_T2, 540)]
SCRIM = (np.clip(1 - yy / 820, 0, 1) ** 1.3 * 0.5)[..., None]
WARM = np.array([1.0, 0.955, 0.87], np.float32)


def title(x, t):
    """A film title, not a caption: it sits in the picture (under the grain), blooms in and dissolves out of focus."""
    if t > T_OUT + 0.7:
        return x
    out = float(np.clip((t - T_OUT) / 0.6, 0, 1))
    mask = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(mask)
    for li, (text, font, y) in enumerate(TITLE):
        if li < 2:                                           # the hook is readable at frame 0
            d.text((W / 2, y), text, font=font, fill=255, anchor='mm')
            continue
        k = float(np.clip((t - 1.25) / 0.9, 0, 1))          # the turn: one slow, quiet fade after the kid's first "Dad!"
        k = k * k * (3 - 2 * k)
        if k > 0:
            d.text((W / 2, y + (1 - k) * 6), text, font=font, fill=int(255 * k), anchor='mm')
    if out > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(22 * out))
    rise = 0.78 + 0.22 * float(np.clip(t / 0.7, 0, 1))      # readable at frame 0, then it eases up to full
    a = np.asarray(mask, np.float32)[..., None] / 255 * (1 - out) ** 1.5 * rise
    soft = np.asarray(mask.filter(ImageFilter.GaussianBlur(26)), np.float32)[..., None] / 255
    shade = np.asarray(mask.filter(ImageFilter.GaussianBlur(9)), np.float32)[..., None] / 255
    settle = 0.3 + 0.5 * float(np.clip(1 - t / 1.2, 0, 1)) ** 2          # the light settles over the first second
    x = x * (1 - SCRIM * (1 - out))
    x = x * (1 - 0.5 * shade * (1 - out))
    x = x + soft * WARM * settle * (1 - out) * 0.55
    return x * (1 - a) + WARM * 0.97 * a


SHOT_IN = {'s1': 0.0, 's2': 0.0, 's3': 0.0, 's4': 0.0, 's5': 0.0, 's6': 0.0, 's7': 0.0}


def render(stills=None):
    frames = range(int(END * FPS)) if stills is None else [int(s * FPS) for s in stills]
    proc = None
    if stills is None:
        proc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                                 '-r', str(FPS), '-i', '-', '-i', os.path.join(OUT, 'mix.wav'),
                                 '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
                                 '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-shortest',
                                 '-movflags', '+faststart', os.path.join(OUT, 'watch-this.mp4')], stdin=subprocess.PIPE)
    cache = {}
    for n in frames:
        t = n / FPS
        shot = next((s for s, (a, b) in CUTS.items() if a <= t < b), None)
        if shot:
            if shot not in cache:
                cache.clear()
                cache[shot] = load(os.path.join(M, FILES.get(shot, shot) + '.mp4'))
            clip = cache[shot]
            a, b = CUTS[shot]
            src_len = len(clip) - 1 - SHOT_IN[shot] * FPS
            speed = min(1.0, src_len / ((b - a) * FPS))
            if shot == 's1':                                 # ping-pong: the wave and the scrolling read the same both ways
                L = len(clip) - 1
                u = (t - a) * FPS * min(1.0, 2 * L / ((b - a) * FPS))
                u = u if u <= L else 2 * L - u
                x = grade(sample(clip, u), shot)
                x = title(x, t)
            else:
                x = grade(sample(clip, SHOT_IN[shot] * FPS + (t - a) * FPS * speed), shot)
            # one shared settle: every shot eases in 1.5% over its length (locked camera, barely breathing)
            img = Image.fromarray(finish(x, n)).convert('RGBA')
        else:
            img = Image.new('RGBA', (W, H), (0, 0, 0, 255))
            end_card(img, t)
        captions(img, t)
        fr = np.asarray(img.convert('RGB'))
        if proc:
            proc.stdin.write(fr.tobytes())
        else:
            Image.fromarray(fr).save(os.path.join(OUT, f'still-{t:.2f}.png'))
    if proc:
        proc.stdin.close()
        proc.wait()


if __name__ == '__main__':
    print(json.dumps({k: [round(v[0], 2), round(v[1], 2)] for k, v in T.items()}))
    print('cuts', {k: [round(a, 2), round(b, 2)] for k, (a, b) in CUTS.items()}, 'end', round(END, 2))
    if '--plan' in sys.argv:
        sys.exit()
    if '--still' in sys.argv:
        render([float(x) for x in sys.argv[sys.argv.index('--still') + 1:]])
    else:
        build_audio()
        render()
