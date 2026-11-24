"""Dead Stars: cut the one narration take into timed lines and write the timeline the scene and score use.

    python3 scenes/mine/dead-stars/prep.py

Reads footage/dead-stars/vo.wav and vo.words.json (tools/transcribe.py). Writes footage/dead-stars/vo/NN.wav
(+ .words.json), scenes/mine/dead-stars/timeline.js and footage/dead-stars/cues.json.

The take holds three hook readings and the body. Body times and cues are relative to the end of the chosen
hook (hooks[k].off), so one body timeline serves all three variants. Cuts follow the speechCut rule: keep each word's release (+0.15 s) unless the next
word starts sooner, then cut in the middle of the gap. CAPS in the display text = pop-out key words.
"""
import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
A = os.path.join(ROOT, 'footage/dead-stars')
os.makedirs(f'{A}/vo', exist_ok=True)

HOOKS = {   # first word, end word (exclusive), display, voice start in the slot
    'A': (0, 7, 'This hand is 13 BILLION years old.', 0.35),
    'B': (7, 14, "Too late. It's 13 BILLION years old.", 1.15),   # after the dare has been on screen ~1 s
    'C': (14, 24, 'The GOLD in your ring came from two DEAD STARS.', 0.35),
}
# first word, end word, display, gap before, beat
BODY = [
    (24, 36, 'At the start, the universe made almost nothing but HYDROGEN and HELIUM.', 0.0, 'cold'),
    (36, 45, 'So where did the rest of YOU come from?', 0.3, 'cold'),
    (45, 46, 'STARS.', 0.4, 'fusion'),
    (46, 53, 'They crush light atoms into heavier ones.', 0.2, 'fusion'),
    (53, 54, 'CARBON.', 0.25, 'fusion'),
    (54, 55, 'OXYGEN.', 0.25, 'fusion'),
    (55, 60, 'The CALCIUM in your bones.', 0.25, 'fusion'),
    (60, 64, 'Then they reach IRON.', 0.5, 'iron'),
    (64, 69, 'Iron gives no energy back.', 0.25, 'iron'),
    (69, 76, 'The core COLLAPSES in under a second,', 0.25, 'iron'),
    (76, 80, 'and the star EXPLODES,', 0.2, 'blast'),
    (80, 84, 'scattering everything it made.', 0.15, 'blast'),
    (84, 89, 'Most GOLD needs something worse.', 0.55, 'gold'),
    (89, 92, 'Two DEAD STARS,', 0.25, 'gold'),
    (92, 105, 'so dense a sugar cube of them weighs as much as a MOUNTAIN...', 0.1, 'gold'),
    (105, 106, 'COLLIDING.', 0.3, 'gold'),
    (106, 113, 'Those atoms drifted for billions of years.', 2.85, 'drift'),   # 1.6 s bloom to screenshot, then 1 s of silence on black
    (113, 118, 'Then, for a little while,', 0.3, 'you'),
    (118, 121, 'they became YOU.', 0.12, 'you'),
    (121, 126, 'Well, almost all of you.', 0.55, 'you'),
    (126, 131, 'Your HYDROGEN is even older.', 0.2, 'you'),
    (131, 135, 'Look at your HAND.', 0.55, 'end'),
]
AF = 'highpass=f=65,lowshelf=g=2.5:f=180,acompressor=threshold=-22dB:ratio=2.5:attack=6:release=90,afade=t=in:d=0.015'


def dur(f):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f],
                                capture_output=True, text=True).stdout)


def cut(ws, i, j, name, start, text):
    a = 0.0 if i == 0 else max((ws[i - 1]['e'] + ws[i]['s']) / 2, ws[i]['s'] - 0.25)
    e = ws[j - 1]['e']
    b = e + 0.15 if j >= len(ws) else min(e + 0.15, max(e + 0.03, (e + ws[j]['s']) / 2))
    f = f'{A}/vo/{name}.wav'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{a:.3f}', '-to', f'{b:.3f}', '-i', f'{A}/vo.wav',
                    '-af', AF + f',afade=t=out:st={max(0, b - a - 0.02):.3f}:d=0.02', '-ar', '44100', '-ac', '2', f], check=True)
    src, disp = ws[i:j], text.split()
    assert len(src) == len(disp), (text, [x['w'] for x in src])
    rel = [{'w': d, 's': round(x['s'] - a, 3), 'e': round(x['e'] - a, 3)} for d, x in zip(disp, src)]
    json.dump(rel, open(f[:-4] + '.words.json', 'w'))
    words = [{'w': r['w'], 's': round(start + r['s'], 3), 'e': round(start + r['e'], 3)} for r in rel]
    return {'name': name, 'text': text, 'file': f'../../../footage/dead-stars/vo/{name}.wav', 'at': round(start, 3),
            'end': words[-1]['e'], 'words': words, 'lead': round(rel[0]['s'], 3)}


def main():
    ws = json.load(open(f'{A}/vo.words.json'))['words']
    hooks = {k: cut(ws, i, j, f'hook{k}', at, text) for k, (i, j, text, at) in HOOKS.items()}
    # the hook voice starts at `at` (its first word), so shift by the cut's lead
    for h in hooks.values():
        sh = -h['lead']
        h['at'] = round(h['at'] + sh, 3); h['end'] = round(h['end'] + sh, 3)
        for w in h['words']:
            w['s'] = round(w['s'] + sh, 3); w['e'] = round(w['e'] + sh, 3)
    for h in hooks.values():
        h['off'] = round(h['end'] + 0.45, 3)        # where the body starts after this hook
    t0 = 0.0                                          # body times are relative to the hook's `off`
    lines, cursor = [], t0
    for n, (i, j, text, gap, beat) in enumerate(BODY):
        first = ws[i]['s']
        L = cut(ws, i, j, f'{n + 1:02d}', 0, text)
        start = cursor + gap - L['lead']          # first word lands `gap` after the previous line's last word
        for w in L['words']:
            w['s'] = round(w['s'] + start, 3); w['e'] = round(w['e'] + start, 3)
        L['at'] = round(start, 3); L['end'] = L['words'][-1]['e']; L['beat'] = beat; L['n'] = n + 1
        lines.append(L); cursor = L['end']
    by = {l['n']: l for l in lines}
    word = lambda n, p: next(w for w in by[n]['words'] if w['w'].upper().strip('.,?').startswith(p))
    cues = {
        't0': t0,
        'hydrogen': word(1, 'HYDROGEN')['s'], 'helium': word(1, 'HELIUM')['s'],
        'question': by[2]['at'] + by[2]['lead'],
        'stars': by[3]['words'][0]['s'], 'crush': by[4]['words'][0]['s'],
        'carbon': by[5]['words'][0]['s'], 'oxygen': by[6]['words'][0]['s'], 'calcium': word(7, 'CALCIUM')['s'],
        'iron': word(8, 'IRON')['s'], 'ironLine': by[8]['words'][0]['s'], 'nopay': by[9]['words'][0]['s'],
        'collapse': word(10, 'COLLAPSES')['s'], 'explode': word(11, 'EXPLODES')['s'], 'scatter': by[12]['words'][0]['s'],
        'gold': by[13]['words'][0]['s'], 'deadstars': by[14]['words'][0]['s'], 'dense': by[15]['words'][0]['s'],
        'mountain': word(15, 'MOUNTAIN')['s'], 'collide': by[16]['words'][0]['s'], 'collideEnd': by[16]['end'],
        'drift': by[17]['words'][0]['s'], 'while': by[18]['words'][0]['s'], 'you': word(19, 'YOU')['s'],
        'almost': by[20]['words'][0]['s'], 'older': by[21]['words'][0]['s'], 'look': by[22]['words'][0]['s'],
        'lookEnd': by[22]['end'],
    }
    cues['black'] = round(cues['collideEnd'] + 1.6, 3)       # the bloom holds (screenshot), then a full second of black and silence
    cues['end'] = round(cues['lookEnd'] + 1.6, 3)
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'timeline.js'), 'w') as fh:
        fh.write('// Written by prep.py from the narration take. Do not edit by hand.\n')
        fh.write(f'window.DEADSTARS = {json.dumps({"hooks": hooks, "lines": lines, "cues": cues}, indent=1)};\n')
    json.dump({'cues': cues, 'hooks': {k: [h['at'], h['end']] for k, h in hooks.items()},
               'lines': [[l['at'], l['end'], l['beat']] for l in lines]}, open(f'{A}/cues.json', 'w'), indent=1)
    for k, h in hooks.items():
        print(f"hook {k} {h['at']:5.2f}-{h['end']:5.2f} body at {h['off']:5.2f}  {h['text']}")
    for l in lines:
        print(f"{l['n']:>2} {l['at']:6.2f}-{l['end']:6.2f} {l['beat']:6} {l['text'][:60]}")
    print('t0', t0, 'end', cues['end'])


if __name__ == '__main__':
    main()
