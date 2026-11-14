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
   `stock` / `pull` → `build`. Look at REPORT.md and `<name>.inserts.jpg`, fix, rebuild until clean.
6. Hand over the MP4, a title + description (hook, chapters, sources, credits), and any clips still to pull.

Existing footage instead of a new recording: `index` → `search` → plan → `build` (docs/LONGFORM.md).
