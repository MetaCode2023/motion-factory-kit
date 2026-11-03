# Test footage: the editor end to end, no keys

These clips are deliberately simple drawn stand-ins for checking the pipeline (cuts, reframing,
audio, overlays, review loop), not an example of how finished ads look.

`npm run demo` runs the whole footage editor on this folder:

- `footage/`: five horizontal clips of a fictional cold brew street poll. Everything in them is
  synthetic (cartoon people drawn in code, espeak voices, street noise and wind), made by
  `tools/make-demo-footage.py`, so no real person is shown saying anything. Each clip has a
  `.words.json` transcript next to it, the same sidecar you can give your own footage (or a `.srt`).
- `edits/`: three edit plans: a street poll with the question card, "n/2" counters, a B-roll cutaway
  and the real yes/no split; the creator-native look (one-word captions, title pill); and a windy,
  quiet clip with strong audio clean-up that opens on the strongest line.

Output: `out/demo/` with every ad (two hooks for the first one), `DELIVERY.csv`, and `review.html`.
Horizontal clips follow the face when OpenCV is installed (`pip install opencv-python-headless`);
without it they use a centre crop.
