"""Dead Stars v2 opening: real-motion cut. Generated shots, cuts on word onsets, editorial type, one finish.

usage: python3 cut.py <shots_dir> <voice_source.mp4> <out.mp4> [--still t ...]
Shots dir holds s1.mp4 ... s5.mp4 (Kling 4.0, 1080x1920, 24 fps).
"""
import sys, subprocess, json
import numpy as np
from PIL import Image
import animatic as A  # text, finishing stack, easing

FPS = 24
W, H = A.W, A.H
END = 18.2

# src_in: where in the clip the shot starts; push: zoom from/to across the shot (1 = no zoom)
SHOTS = [
    dict(f='s1', start=0.00, end=3.75, src_in=0.4, speed=1.0, push=(1.00, 1.04)),
    dict(f='s2', start=3.75, end=6.50, src_in=0.8, speed=1.0, push=(1.00, 1.03)),
    dict(f='s3', start=6.50, end=10.40, src_in=0.6, speed=1.0, push=(1.00, 1.06)),
    dict(f='s4', start=10.40, end=15.30, src_in=0.0, speed=1.0, push=(1.04, 1.00)),
    dict(f='s5', start=15.30, end=END, src_in=1.6, speed=1.0, push=(1.00, 1.03)),
]
A.TEXT[:] = [
    (0.0, 3.45, ['This hand is', '13 billion years old.'], 92, 1230, A.FONT_LIGHT, {'13 billion'}),
    (6.75, 8.30, ['hydrogen.  helium.'], 58, 1330, A.FONT_MED, set()),
    (8.44, 10.15, ['So where did', 'the rest of you', 'come from?'], 76, 1160, A.FONT_LIGHT, set()),
    (13.99, 15.2, ['carbon'], 60, 300, A.FONT_MED, set()),
    (14.58, 15.2, ['oxygen'], 60, 380, A.FONT_MED, set()),
    (15.40, 17.9, ['the calcium', 'in your bones.'], 80, 280, A.FONT_LIGHT, {'calcium'}),
]
A.exposure = lambda t: 1  # no artificial light ramps: the footage carries the light


def load(path):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={W}:{H}', '-f', 'rawvideo',
                          '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(out, np.uint8).reshape(-1, H, W, 3)


def grade(f):
    # one look over every shot: gentle S-curve, cool shadows, warm highlights
    x = f.astype(np.float32) / 255
    x = x * x * (3 - 2 * x) * 0.35 + x * 0.65
    lum = x.mean(axis=2, keepdims=True)
    x = x + (1 - lum) * lum * np.array([-0.02, 0.0, 0.03], np.float32) * 2 \
        + lum * lum * np.array([0.03, 0.01, -0.03], np.float32)
    return (np.clip(x, 0, 1) * 255).astype(np.uint8)


def frame_at(clips, t, n):
    s = next(x for x in SHOTS if x['start'] <= t < x['end'] or x is SHOTS[-1])
    c = clips[s['f']]
    i = min(len(c) - 1, int(round((s['src_in'] + (t - s['start']) * s['speed']) * FPS)))
    u = A.smooth(min(1, (t - s['start']) / (s['end'] - s['start'])))
    z = s['push'][0] + (s['push'][1] - s['push'][0]) * u
    img = Image.fromarray(grade(c[i]))
    if abs(z - 1) > 1e-3:
        img = A.render_cam(img, 0.5, 0.5, z)
    fr = img.convert('RGBA')
    A.draw_text(fr, t)
    return A.finish(fr.convert('RGB'), n)


def main():
    d, voice, out = sys.argv[1:4]
    clips = {s['f']: load(f'{d}/{s["f"]}.mp4') for s in SHOTS}
    if '--still' in sys.argv:
        for i, ts in enumerate(sys.argv[sys.argv.index('--still') + 1:]):
            Image.fromarray(frame_at(clips, float(ts), i)).save(out.replace('.mp4', f'-{ts}.png'))
        return
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}',
                          '-r', str(FPS), '-i', '-', '-t', str(END), '-i', voice,
                          '-filter_complex', f'[1:a]afade=t=out:st={END - 0.5}:d=0.5[a]', '-map', '0:v', '-map', '[a]',
                          '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p',
                          '-c:a', 'aac', '-b:a', '256k', '-shortest', out], stdin=subprocess.PIPE)
    for n in range(int(END * FPS)):
        p.stdin.write(frame_at(clips, n / FPS, n).tobytes())
    p.stdin.close()
    p.wait()


if __name__ == '__main__':
    main()
