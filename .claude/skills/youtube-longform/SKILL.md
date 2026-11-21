---
name: youtube-longform
description: Make a 5-20 minute horizontal YouTube video (16:9) end to end - co-write the script with visual cues every ~15 s, then turn the creator's recording (camera or voice only) into a finished video with animations, B-roll, outside clips, music, sound effects and captions. Also edits existing podcast footage. Use when the user wants a YouTube video, a long video, a video script, "a 10-minute video on X", or hands over a recording of a script.
---

# Long-form YouTube video

Follow the "Long-form YouTube" section of `CLAUDE.md` and `docs/LONGFORM.md`. The order:

1. **Ask: "What's the video about, and what's the angle?"** (one question; skip if they said).
2. Research (web search): real figures with sources, the best analogies, 2-5 outside clips that prove points
   (exact URL + from/to).
3. Outline (hook in 10 s, 4-6 chapters), then draft `scripts/<name>.script.md`: ~150 words a minute, said
   out loud, a `[[cue]]` every ~15 s (stat, term, compare, steps, bars, quote, poker set, new scenes, stock,
   clip, face). `node longform.mjs script scripts/<name>.script.md` until clean. Show it; revise together.
4. They record from `scripts/<name>.read.txt`. Meanwhile write any new animation scenes (in parallel if you
   can) and check a still of each.
5. `node longform.mjs from-script scripts/<name>.script.md <recording> ` → read the alignment report →
   `broll` (automatic free-license cutaways; read BROLL.md, drop or re-search bad picks in the lockfile) →
   `stock` / `pull` → **`board`**. Open `board.html`; revise its cue notes through `feedback` until the
   visual flow is approved ("go"). Only then run `build`. Read `REVIEW.md` first, then REPORT.md and
   `<name>.inserts.jpg`; fix the ranked notes before handing over.
6. Hand over the MP4, a title + description (hook, chapters, sources, credits), and any clips still to pull.

Existing footage instead of a new recording: `index` → `search` → plan → `build` (docs/LONGFORM.md).

Before drafting: read `docs/PLAYBOOK.md` plus `scripts/VOICE.md` / `scripts/SERIES.md` if present. `node longform.mjs script`
prints a retention score with notes: fix them. On-camera layouts: `full`, `side`, `pip`, `split`.

Around the video:
- New machine: `node longform.mjs doctor` (what's installed, what's missing, the fix).
- Give each video a look in the script header: `theme: blueprint | noir | sunset | paper | terminal` (default aurora).
- For captions throughout use `captions: {"burn":true}`; mark key spoken phrases `*like this*` so they
  pop in the accent colour. Keep the dim box over bright footage and move captions away from the face.
- Every build writes `review.html`. Notes come back as `<name>.review.json` → `node longform.mjs feedback <file>` →
  read `FEEDBACK.md`, change only what the notes ask for, rebuild. This also grows the private Never again
  list in `scripts/SERIES.md`; after approval run `freeze <plan> --name <series>` to version the proven defaults.
- `node longform.mjs thumbnail <plan>` (plan: `"thumbnail": { text: 2-4 words, accent, prop }`) and
  `node longform.mjs shorts <plan>` (plan: `"shorts": [{ from, to, title }]`, or one per chapter).
- Every build writes a fresh, score-free `REVIEW.md` from only the plan and key stills. Read it before
  REPORT.md; apply P0, then P1 notes in the stated `problem -> exact change · what stays` form.
