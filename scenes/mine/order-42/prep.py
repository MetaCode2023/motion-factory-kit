"""Order #42: cut the two voice takes into lines, treat them, lay them on the timeline.

    python3 scenes/mine/order-42/prep.py

Reads assets/broll/taco/{me,spk}.wav and their .words.json (tools/transcribe.py), writes
assets/broll/taco/vo/NN.wav, scenes/mine/order-42/timeline.js (lines, word times, story cues for the scene)
and assets/broll/taco/cues.json (the same cues for sound.py).

Display text: CAPS words pop in the captions. The cut points are the middle of the pause between lines.
"""
import json
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
A = os.path.join(ROOT, 'assets/broll/taco')
os.makedirs(f'{A}/vo', exist_ok=True)
FF = 'ffmpeg'
ME_TEMPO = 1.1          # the take is a touch slow for a Short

# who, first word index in its take, display text, gap before (s)
LINES = [
    ('me', 0, 'Nobody tells you ENLIGHTENMENT happens in a Taco Bell DRIVE-THRU.', 0.25),
    ('spk', 0, 'Welcome to Taco Bell. What can I get you?', 0.45),
    ('me', 11, 'Uh, can I get a NUMBER FOUR and a large Baja Blast.', 0.25),
    ('spk', 9, 'Anything ELSE?', 0.35),
    ('me', 23, "And I'm just sitting there, thinking about WHAT ELSE.", 0.9),
    ('me', 32, "Like, WHO'S actually ORDERING?", 0.5),
    ('me', 36, "There's a VOICE in my head picking the SAUCE. Is that ME?", 0.45),
    ('me', 48, "It's 86 BILLION NEURONS firing in the DARK, pretending to be ONE GUY.", 0.45),
    ('me', 61, 'The IRON in my blood. The CARBON in this burrito. All of it cooked inside STARS that died before the EARTH existed.', 0.45),
    ('me', 83, '13.8 BILLION YEARS. STARS. PLANETS. OCEANS. BRAINS.', 0.5),
    ('me', 91, 'Just so one tiny piece of the UNIVERSE could sit in a HONDA and WONDER what it is.', 0.45),
    ('spk', 11, 'SIR? Anything else?', 1.1),        # after the honk
    ('me', 109, "No. That's EVERYTHING.", 0.35),
    ('spk', 14, '$8.47 at the window.', 0.5),
]


def dur(f):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f],
                                capture_output=True, text=True).stdout)


def main():
    takes = {k: json.load(open(f'{A}/{k}.words.json'))['words'] for k in ('me', 'spk')}
    lens = {k: dur(f'{A}/{k}.wav') for k in takes}
    # spans: from the middle of the pause before the line's first word to the middle of the pause before the next line
    starts = {k: sorted(i for (w, i, _, _) in LINES if w == k) for k in takes}
    out, cursor = [], 0.0
    for n, (who, i, text, gap) in enumerate(LINES):
        ws = takes[who]; st = starts[who]; j = st.index(i)
        nxt = st[j + 1] if j + 1 < len(st) else None
        a = 0.0 if i == 0 else (ws[i - 1]['e'] + ws[i]['s']) / 2
        b = lens[who] if nxt is None else (ws[nxt - 1]['e'] + ws[nxt]['s']) / 2
        last = (nxt or len(ws)) - 1
        b = max(b, ws[last]['e'] + 0.12)   # keep the release of the last word
        f = f'{A}/vo/{n + 1:02d}.wav'
        if who == 'me':
            af = f'atempo={ME_TEMPO},highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,afade=t=in:d=0.02'
            k = 1 / ME_TEMPO
        else:   # the drive-thru intercom: telephone band, a little grit, a little box
            af = ('highpass=f=420,lowpass=f=3300,acrusher=bits=10:mix=0.25,'
                  'aecho=0.8:0.4:25:0.25,acompressor=threshold=-24dB:ratio=6,afade=t=in:d=0.01')
            k = 1.0
            if text.startswith('Anything ELSE'):   # the line the whole trip hangs on: a tail that never ends
                af += ',apad=pad_dur=3.5,aecho=0.85:0.75:220|470|760|1100:0.55|0.42|0.32|0.24'
        subprocess.run([FF, '-v', 'error', '-y', '-ss', f'{a:.3f}', '-to', f'{b:.3f}', '-i', f'{A}/{who}.wav',
                        '-af', af, '-ar', '44100', '-ac', '2', f], check=True)
        d = dur(f)
        start = cursor + gap
        # word times for the display words: the take's own times when the counts match, else spread by length
        src = ws[i:last + 1]
        disp = text.split()
        if len(src) == len(disp):
            words = [{'w': w, 's': round(start + (x['s'] - a) * k, 3), 'e': round(start + (x['e'] - a) * k, 3)} for w, x in zip(disp, src)]
        else:
            s0, s1 = (src[0]['s'] - a) * k, (src[-1]['e'] - a) * k
            wt = [len(w) + 2 for w in disp]; tot = sum(wt); s = s0; words = []
            for w, q in zip(disp, wt):
                dd = (s1 - s0) * q / tot
                words.append({'w': w, 's': round(start + s, 3), 'e': round(start + s + dd * 0.92, 3)}); s += dd
        speech_end = start + (src[-1]['e'] - a) * k
        json.dump([{'w': w['w'], 's': round(w['s'] - start, 3), 'e': round(w['e'] - start, 3)} for w in words], open(f[:-4] + '.words.json', 'w'))
        out.append({'n': n + 1, 'who': who, 'text': text, 'file': f'../../../assets/broll/taco/vo/{n + 1:02d}.wav',
                    'at': round(start, 3), 'end': round(speech_end, 3), 'dur': round(d, 3), 'words': words})
        cursor = speech_end
        if text.startswith('Anything ELSE'):
            cursor += 0.2
    L = {o['n']: o for o in out}
    honk = round(L[11]['end'] + 0.55, 3)
    # the honk lands in the pause: shift the last three lines to after it
    shift = honk + 0.45 + LINES[11][3] - 1.1 - L[12]['at']
    for o in out[11:]:
        o['at'] = round(o['at'] + shift, 3); o['end'] = round(o['end'] + shift, 3)
        for w in o['words']:
            w['s'] = round(w['s'] + shift, 3); w['e'] = round(w['e'] + shift, 3)
    cues = {
        'else': L[4]['at'],                       # "anything else?"
        'trip': L[6]['at'] - 0.3,                 # "who's actually ordering?"
        'neurons': L[8]['at'],
        'stars': L[9]['at'],
        'years': L[10]['at'],
        'universe': L[11]['at'],
        'peak': next(w['s'] for w in L[11]['words'] if w['w'].startswith('UNIVERSE')),
        'honk': honk,
        'window': L[14]['at'] - 0.4,
        'receipt': L[14]['end'] + 0.15,
        'glint': L[14]['end'] + 1.9,
    }
    cues['end'] = round(cues['glint'] + 2.8, 2)
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'timeline.js'), 'w') as fh:
        fh.write('// Written by prep.py from the voice takes. Do not edit by hand.\n')
        fh.write(f'window.ORDER42 = {json.dumps({"lines": out, "cues": cues}, indent=1)};\n')
    json.dump(cues, open(f'{A}/cues.json', 'w'))
    for o in out:
        print(f"{o['n']:>2} {o['who']:>3} {o['at']:6.2f}-{o['end']:6.2f}  {o['text'][:60]}")
    print(json.dumps(cues))


if __name__ == '__main__':
    main()
