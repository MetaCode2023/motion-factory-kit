"""Dead Stars v2 animatic: approved style frames (look A), timed to the existing voice take.

Designed-world pipeline, step 4 (animatic gate). Stills only, camera moves on stills, cuts on word onsets,
editorial type placed in the frame's open space, one finishing stack (halation, grain, vignette) over everything.

usage: python3 animatic.py <frames_dir> <voice_source.mp4> <out.mp4> [--still t ...]
"""
import sys, math, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, FPS = 1080, 1920, 30
END = 18.2
FONT_LIGHT = '/usr/share/fonts/opentype/inter/InterDisplay-Light.otf'
FONT_MED = '/usr/share/fonts/opentype/inter/InterDisplay-Medium.otf'
AMBER = (232, 160, 74)
BONE = (237, 230, 218)

# Shot list. Cuts sit one frame before the word onset (from the take's word timings).
# cam keys: (t, cx, cy, scale) in source-normalised coords; scale 1 = whole frame.
SHOTS = [
    dict(src='A1', start=0.0, end=3.75, cam=[(0.0, 0.50, 0.55, 1.00), (3.75, 0.46, 0.62, 1.10)]),
    # one continuous move: tilt up from palm skin into the cosmic web, then push toward a bright node
    dict(src='A2', start=3.75, end=10.40, cam=[(3.75, 0.50, 0.70, 1.45), (7.6, 0.52, 0.42, 1.45),
                                               (10.40, 0.615, 0.382, 4.2)]),
    # match cut: the node becomes the star's core at the same screen position and brightness
    dict(src='A3', start=10.40, end=15.30, cam=[(10.40, 0.31, 0.68, 2.4), (15.30, 0.42, 0.55, 1.25)]),
    dict(src='A1', start=15.30, end=END, cam=[(15.30, 0.42, 0.70, 1.28), (END, 0.42, 0.71, 1.38)]),
]

# Editorial lines: (in, out, text, size, y, font, accent words)
TEXT = [
    (0.0, 3.45, ['This hand is', '13 billion years old.'], 100, 300, FONT_LIGHT, {'13 billion'}),
    (6.55, 8.25, ['hydrogen.  helium.'], 60, 1420, FONT_MED, set()),
    (8.44, 10.0, ['So where did', 'the rest of you', 'come from?'], 78, 1180, FONT_LIGHT, set()),
    (13.99, 15.2, ['carbon'], 60, 330, FONT_MED, {'carbon'}),
    (14.58, 15.2, ['oxygen'], 60, 410, FONT_MED, {'oxygen'}),
    (15.40, 17.9, ['the calcium', 'in your bones.'], 82, 300, FONT_LIGHT, {'calcium'}),
]


def smooth(u):
    return u * u * (3 - 2 * u)


def cam_at(shot, t):
    k = shot['cam']
    if len(k) == 2:
        (t0, *a), (t1, *b) = k
        u = smooth(min(1, max(0, (t - t0) / (t1 - t0))))
        return [x + (y - x) * u for x, y in zip(a, b)]
    # three keys: one continuous path, ease in at the start, ease out at the end, no stop in the middle
    ts = [x[0] for x in k]
    u = min(1, max(0, (t - ts[0]) / (ts[-1] - ts[0])))
    u = smooth(u)
    tt = ts[0] + u * (ts[-1] - ts[0])
    seg = 0 if tt < ts[1] else 1
    t0, t1 = ts[seg], ts[seg + 1]
    v = (tt - t0) / (t1 - t0)
    a, b = k[seg][1:], k[seg + 1][1:]
    return [x + (y - x) * v for x, y in zip(a, b)]


def render_cam(img, cx, cy, s):
    sw, sh = img.size
    vw, vh = sw / s, sh / s
    x0 = min(max(cx * sw - vw / 2, 0), sw - vw)
    y0 = min(max(cy * sh - vh / 2, 0), sh - vh)
    a = vw / W
    return img.transform((W, H), Image.AFFINE, (a, 0, x0, 0, a, y0), resample=Image.BICUBIC)


def alpha_for(t, tin, tout, fade=0.25):
    if t < tin or t > tout:
        return 0.0
    if tin <= 0.0:
        return min(1, (tout - t) / fade)
    return min(1, (t - tin) / fade, (tout - t) / fade)


def draw_text(frame, t):
    over = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    for tin, tout, lines, size, y, font, accent in TEXT:
        a = alpha_for(t, tin, tout)
        if a <= 0:
            continue
        f = ImageFont.truetype(font, size)
        bh = len(lines) * size * 1.22
        sc = Image.new('L', (W, H), 0)
        ImageDraw.Draw(sc).ellipse((W * 0.08, y - size * 0.9, W * 0.92, y + bh + size * 0.6), fill=int(150 * a))
        sc = sc.resize((W // 8, H // 8)).filter(ImageFilter.GaussianBlur(10)).resize((W, H), Image.BILINEAR)
        over.alpha_composite(Image.merge('RGBA', (sc.point(lambda v: 0),) * 3 + (sc,)))
        rise = (1 - smooth(min(1, (t - tin) / 0.5))) * 14 if tin > 0 else 0
        for i, line in enumerate(lines):
            col = AMBER if any(w in line for w in accent) else BONE
            tw = d.textlength(line, font=f)
            yy = y + i * size * 1.22 + rise
            d.text(((W - tw) / 2 + 2, yy + 3), line, font=f, fill=(0, 0, 0, int(140 * a)))
            d.text(((W - tw) / 2, yy), line, font=f, fill=col + (int(255 * a),))
    frame.alpha_composite(over)


yy, xx = np.mgrid[0:H, 0:W]
VIG = 1 - 0.38 * np.clip((((xx - W / 2) / (W * 0.62)) ** 2 + ((yy - H / 2) / (H * 0.62)) ** 2), 0, 1) ** 1.4
VIG = VIG[..., None].astype(np.float32)


def finish(rgb, n):
    f = np.asarray(rgb, dtype=np.float32) / 255
    # halation: blurred highlights, warm
    lum = f.mean(axis=2, keepdims=True)
    hi = np.clip((lum - 0.62) / 0.38, 0, 1) * f
    small = Image.fromarray((hi * 255).astype(np.uint8)).resize((W // 4, H // 4), Image.BILINEAR)
    small = small.filter(ImageFilter.GaussianBlur(6)).resize((W, H), Image.BILINEAR)
    f = f + np.asarray(small, dtype=np.float32) / 255 * np.array([0.32, 0.20, 0.10], dtype=np.float32)
    # lift blacks a touch so they read as film, not digital zero; vignette
    f = (0.012 + f * 0.988) * VIG
    # grain, seeded by frame so renders repeat exactly
    rng = np.random.default_rng(n)
    g = rng.normal(0, 0.022, (H // 2, W // 2)).astype(np.float32)
    g = np.repeat(np.repeat(g, 2, 0), 2, 1)[..., None]
    f = f + g * (0.6 + 0.4 * (1 - lum))
    return (np.clip(f, 0, 1) * 255).astype(np.uint8)


def frame_at(imgs, t, n):
    shot = next(s for s in SHOTS if s['start'] <= t < s['end'] or s is SHOTS[-1])
    cx, cy, s = cam_at(shot, t)
    fr = render_cam(imgs[shot['src']], cx, cy, s).convert('RGBA')
    draw_text(fr, t)
    rgb = fr.convert('RGB')
    gain = exposure(t)
    if gain != 1:
        rgb = Image.fromarray(np.clip(np.asarray(rgb, dtype=np.float32) * gain, 0, 255).astype(np.uint8))
    return finish(rgb, n)


def exposure(t):
    # light transition into STARS: the node blooms to white, the star settles out of it
    cut = 10.40
    if cut - 0.6 < t < cut:
        return 1 + 1.6 * smooth((t - (cut - 0.6)) / 0.6) ** 2
    if cut <= t < cut + 0.5:
        return 1 + 0.9 * (1 - smooth((t - cut) / 0.5))
    return 1


def main():
    frames_dir, voice, out = sys.argv[1:4]
    # pre-upscale sources 2x so the camera can push in without going soft as fast
    imgs = {k: Image.open(f'{frames_dir}/{k}.png').convert('RGB') for k in ('A1', 'A2', 'A3')}
    imgs = {k: v.resize((v.width * 2, v.height * 2), Image.LANCZOS) for k, v in imgs.items()}
    if '--still' in sys.argv:
        for i, ts in enumerate(sys.argv[sys.argv.index('--still') + 1:]):
            Image.fromarray(frame_at(imgs, float(ts), i)).save(out.replace('.mp4', f'-{ts}.png'))
        return
    n_frames = int(END * FPS)
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                          '-r', str(FPS), '-i', '-', '-ss', '0', '-t', str(END), '-i', voice,
                          '-filter_complex', f'[1:a]afade=t=out:st={END - 0.5}:d=0.5[a]', '-map', '0:v', '-map', '[a]',
                          '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
                          '-c:a', 'aac', '-b:a', '256k', '-shortest', out], stdin=subprocess.PIPE)
    for n in range(n_frames):
        p.stdin.write(frame_at(imgs, n / FPS, n).tobytes())
    p.stdin.close()
    p.wait()


if __name__ == '__main__':
    main()
