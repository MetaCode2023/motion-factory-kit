# Editor test: Physics of Poker v1 as "raw" footage (analysis only, no video)

2026-11-19 · source: the finished v1 cut (4:48 of Austin talking), transcribed here with faster-whisper, because the
raw draft and Alan's whiteboard sessions were on the owner's laptop, which was offline · no output video

## What the tools said
- `analyze`: 4 sections, 1 false start (#2 "poker fascinates you" restarted), no repeats (expected: it was already cut),
  Short candidates at #5-#7 and #22-#26.
- `check` (whole clip, recording order, no visuals): editor 48/100. Opener weaker than #12, no promise in the first
  45 s, 276 s with nothing on screen, undefined terms (measurement, observer, probability, uncertainty principle),
  no next step at the end. All fair calls on that edit.
- `depth`: 11 terms to explain, with a term insert ready to fill for each.

## What it got wrong, and what changed in the kit
- **Every repeated word was a "term"** (poker, seven, table, fascinated). Now a jargon list
  (`tools/longform/terms.json`) plus technical endings decide what needs explaining.
- **Hooks started mid-sentence.** Whisper splits run-on speech at 40 words, so a "sentence" can begin "the
  measurement of what the cards...". Lines that continue the previous one can no longer be hooks or Short starts.
- **"Actually" counted as a turn.** People say it constantly; removed.
- **"So, here's the thing..." was treated as leaning on the line before.** Leading so/okay/um are skipped now.
- **Card values counted as figures to source** ("eight, 10, two"). Figures now need a unit, a big number or a
  percentage.

## What to change in the kit next
- Run on a real raw whiteboard session (STATUS.md handoff queue item 1): repeats, fluff and the whiteboard scan
  are only tested on synthetic data so far.
