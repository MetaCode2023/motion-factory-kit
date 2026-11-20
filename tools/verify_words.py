"""tools/verify_words.py: check that every captioned word is really heard in a finished cut.

    python tools/verify_words.py <ffmpeg> <cut.mp4> tools/transcribe.py [model]   (reads <cut>.words.json)

Re-transcribes the cut audio and aligns it with the captions. Lines marked "delete" are captioned words nobody
hears (a clipped word, or a word the transcript invented in silence); "insert" lines are sounds with no caption
(a fragment of a neighbouring word leaking in at a cut). Spelling differences (disc/disk) are harmless.
Insert/delete at a cut: listen to that edge on its own (transcribe 1.5 s from the cut) before deciding."""
import json, subprocess, sys, re, difflib, os, tempfile
ffmpeg, mp4, tr = sys.argv[1:4]
wav = os.path.join(tempfile.gettempdir(), "verify_cut.wav")
subprocess.run([ffmpeg, "-v", "error", "-y", "-i", mp4, "-ac", "1", "-ar", "16000", wav], check=True)
r = subprocess.run([sys.executable, tr, wav, sys.argv[4] if len(sys.argv) > 4 else "small"], capture_output=True, text=True)
heard = json.loads(r.stdout.strip().splitlines()[-1])["words"]
cap = json.load(open(mp4.rsplit(".", 1)[0] + ".words.json"))
cap = cap["words"] if isinstance(cap, dict) else cap
norm = lambda w: re.sub(r"[^a-z0-9']", "", w.lower())
A, B = [norm(w["w"]) for w in cap], [norm(w["w"]) for w in heard]
bad = 0
for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, A, B, autojunk=False).get_opcodes():
    if op == "equal": continue
    capt = " ".join(w["w"] for w in cap[i1:i2]); hrd = " ".join(w["w"] for w in heard[j1:j2])
    at = cap[i1]["s"] if i1 < len(cap) else heard[j1]["s"]
    print(f"  {at:7.2f}s  {op:8} captions: {capt!r:40} heard: {hrd!r}"); bad += 1
print(f"{len(A)} caption words, {len(B)} heard, {bad} differences")
