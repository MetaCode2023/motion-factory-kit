# Status

Where the kit stands right now. **Every agent updates this file (and the handoff queue at the bottom) before it
finishes a piece of work**, in the same commit. Last updated 2026-11-19.

## The goal

A reasoning video editor: raw footage in (whiteboard sessions, talking heads, podcasts, notes), finished videos out
in every format, with minimal hand-holding. How it should think: `docs/EDITORIAL.md`. What the owner likes:
`docs/TASTE.md`. Where it's going: `docs/ROADMAP.md`.

## What works today

| Piece | Entry point | State |
|---|---|---|
| Short-form scenes (ads, explainers, 9:16) | `make.mjs`, `scenes/`, `kit/` | Stable |
| Raw client footage → many ads | `footage.mjs` (docs/EDITOR.md) | Stable |
| Long-form 16:9 from a script + recording | `longform.mjs script / from-script / build` | Stable; used for Physics of Poker v1-v3 and Build Don't Buy |
| Long-form from existing footage | `longform.mjs index / search / plan / build` | Stable |
| **Edit map + brief before planning** | `longform.mjs analyze` (docs/EDITORIAL.md) | New; tuned on one real recording (Physics of Poker), not yet on a raw whiteboard session |
| **Editor critique** (before and after the build) | `longform.mjs check`, `CRITIQUE.md` | New |
| **Best take across sessions** | `longform.mjs takes` | New; untested on a real multi-session series |
| **Depth worklist** | `longform.mjs depth` (DEPTH.md) | New |
| **Every format in one run** | `longform.mjs package` (PACKAGE.md) | New; tested on the demo |
| **Whiteboard scan** | runs in `index`; used by the critique | New; thresholds untested on real board footage |
| **Drop folder** | `longform.mjs auto` (footage/QUEUE.md) | New |
| Self-learning engine | docs/SELF-LEARNING-ENGINE.md | Planned, not built (waiting on R2/D1) |
| Automatic B-roll (free-license photos/video) | `longform.mjs broll` | Works; Wikimedia 429s from the cloud (docs/LESSONS.md) |
| Overlays on a finished clip | `tools/overlay.py` (docs/OVERLAYS.md) | Stable |
| Weekly content for a brand | `content.mjs` (docs/CONTENT.md) | Stable |
| Native vertical Short from a long-form plan | `tools/longform/vertical.mjs` | Merged into #7 from PR #2 |

Runs on the cloud box: rendering, mixing, captions, animations, transcripts (faster-whisper). Needs the owner's
laptop: YouTube/social pulls (yt-dlp) and ElevenLabs. Automatic B-roll lists YouTube (Creative Commons only) as a
source, but it is skipped wherever yt-dlp isn't installed or YouTube is blocked, so in the cloud it never runs. Details: `docs/LESSONS.md`.

## Open pull requests

| PR | What | State / what's needed |
|---|---|---|
| #7 | Roadmap phases 1-4 (edit map, brief, critique, takes, depth, package, whiteboard scan, drop folder), orientation docs. **Also contains #6 and #2**, reconciled: one set of sound names (`pageturn`, `swipe`; #6's `click` and `wonder` kept), one B-roll sources file. | Draft, stacked on #5. Merge #5, then #7; then close #6 and #2 as merged through #7. |
| #6 | Validated video B-roll, depth score, automatic editing sounds | Contained in #7 (renamed `page`→`pageturn`, `swish`→`swipe`). Close after #7 merges. |
| #5 | B-roll throughout, real video, 11 short-form effects, deeper playbook, docs/LESSONS.md, voice-lines | Draft. Merge first. |
| #3 | `key: 'alpha'` for clips with their own transparency | Draft, small, independent. |
| #2 | Native 9:16 Short compositor, evidence scene, caption emphasis, split_crop | Contained in #7. Close after #7 merges. |
| #1 | table3d `show` option, `term pronounce: none` | Draft, small. |

Suggested merge order: #5, #7 (closes #6 and #2), then #3 and #1.

## Videos made so far

Finished files live in the project's shared folder, not in git. Per-video decisions and feedback: `docs/runs/`.

- Physics of Poker (long-form, v1-v3, Shorts, thumbnail, YouTube package)
- Build Don't Buy (long-form from a 3.6 h meeting recording + Short)
- Quantum mechanics: the observer (45 s vertical, B-roll test)
- Global maximum (two viral vertical re-edits of a TikTok)
- B-roll tests: Phoenix, poker

## Handoff queue (next tasks, in priority order)

1. **Run the loop on a raw whiteboard session of Alan's** (drop it in `footage/inbox/`, `node longform.mjs auto`,
   write the brief, plan, `package`) and log it in `docs/runs/`. Tune on what it gets wrong: the whiteboard scan
   thresholds (`tools/longform/board.mjs`), repeat detection on run-on transcripts, the jargon list
   (`tools/longform/terms.json`). The raw Physics of Poker draft is on the owner's laptop (Downloads) as a second test.
2. Merge #5, then #7; close #6 and #2.
3. Native vertical Shorts from `package` (today it crops the finished 16:9; `tools/longform/vertical.mjs` makes the
   better title + circle-face layout but needs its own captions-off plan per Short).
4. Self-learning engine, step 1 (docs/SELF-LEARNING-ENGINE.md): once R2/D1 exist, upload each build's
   `decisions.json` and the run reports.
5. Re-run `broll` on Physics of Poker v3 (built before B-roll existed).

## Before you finish (every agent)

- Update this file: the tables above if something changed, and the handoff queue.
- Add a line to `docs/DECISIONS.md` for any choice a later agent might otherwise undo.
- Made a video? Add `docs/runs/<date>-<name>.md`.
- Learned something about the environment or a source? `docs/LESSONS.md`. A preference that generalises?
  `docs/TASTE.md`.

## Titles 4a (added 2026-11-18)

| Piece | Entry point | State |
|---|---|---|
| Opening, chapter and end cards | `kit/titles.js`, `scenes/longform/title.html` / `chapter.html` / `endcard.html` (docs/TITLES.md) | New; tested for text on screen and inside the YouTube safe zone, not yet judged by eye in a real build or against a real YouTube end screen |
| `B.lowerThird` `maxW` | `kit/blocks.js` (docs/BLOCKS.md) | New; default unchanged |

Handoff: lower third OVER the speaker (4b) waits for PR #3's alpha work (needs an `over` layout). `[[chapter ..]]` is a reserved
cue word, so the chapter card is cued as `[[anim scenes/longform/chapter.html | ..]]`; making `chapter` a real card cue is a change to
`tools/longform/script.mjs` that was not made.
