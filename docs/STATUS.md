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
| **Edit map + brief before planning** | `longform.mjs analyze` (docs/EDITORIAL.md) | New (roadmap phase 1); not yet run on Alan's footage |
| Automatic B-roll (free-license photos/video) | `longform.mjs broll` | Works; Wikimedia 429s from the cloud (docs/LESSONS.md) |
| Overlays on a finished clip | `tools/overlay.py` (docs/OVERLAYS.md) | Stable |
| Weekly content for a brand | `content.mjs` (docs/CONTENT.md) | Stable |
| Native vertical Short from a long-form plan | `tools/longform/vertical.mjs` | On PR #2 only |

Runs on the cloud box: rendering, mixing, captions, animations, transcripts (faster-whisper). Needs the owner's
laptop: YouTube/social pulls (yt-dlp) and ElevenLabs. Details: `docs/LESSONS.md`.

## Open pull requests

| PR | What | State / what's needed |
|---|---|---|
| #7 | Roadmap phase 1: edit map, brief, orientation docs | Draft, stacked on #5. Merge after #5. |
| #6 | Validated video B-roll (Commons video, CC YouTube), depth score for scripts, automatic editing sounds, `wonder` music | Open. **Overlaps #5** (same effects under other names: `page`/`pageturn`, `swish`/`swipe`; both change `tools/broll/sources.mjs`). Rebase onto #5 and keep one set of names. |
| #5 | B-roll throughout, real video, 11 short-form effects, deeper playbook, docs/LESSONS.md, voice-lines | Draft. Merge first. |
| #3 | `key: 'alpha'` for clips with their own transparency | Draft, small, independent. |
| #2 | Native 9:16 Short compositor, evidence scene, caption emphasis, split_crop | Draft. Needed for roadmap phase 2 (formats). |
| #1 | table3d `show` option, `term pronounce: none` | Draft, small. |

Suggested merge order: #5, #7, #6 (after reconciling), #2, #3, #1.

## Videos made so far

Finished files live in the project's shared folder, not in git. Per-video decisions and feedback: `docs/runs/`.

- Physics of Poker (long-form, v1-v3, Shorts, thumbnail, YouTube package)
- Build Don't Buy (long-form from a 3.6 h meeting recording + Short)
- Quantum mechanics: the observer (45 s vertical, B-roll test)
- Global maximum (two viral vertical re-edits of a TikTok)
- B-roll tests: Phoenix, poker

## Handoff queue (next tasks, in priority order)

1. Run phase 1 on a real raw recording of Alan's (a whiteboard session): `analyze`, write the brief, build, and log
   the run in `docs/runs/`. Tune `tools/longform/editmap.mjs` thresholds on what it gets wrong.
2. Reconcile PR #6 with PR #5 (one sound-effect naming, one sources.mjs), then merge #5 → #7 → #6.
3. Phase 2: structure check on plans; cross-session best take; merge PR #2 and add `longform.mjs package`
   (long-form + Shorts + thumbnail + titles in one run).
4. Phase 3: depth pass with PICKUPS.md; whiteboard detection; CRITIQUE.md after every build.
5. Phase 4: TASTE.md rules proposed from feedback; `longform.mjs auto <folder>`.

## Before you finish (every agent)

- Update this file: the tables above if something changed, and the handoff queue.
- Add a line to `docs/DECISIONS.md` for any choice a later agent might otherwise undo.
- Made a video? Add `docs/runs/<date>-<name>.md`.
- Learned something about the environment or a source? `docs/LESSONS.md`. A preference that generalises?
  `docs/TASTE.md`.
