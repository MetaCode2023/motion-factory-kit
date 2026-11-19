# Decisions

Why things are the way they are, so a later agent doesn't undo them by accident. One entry per decision, newest
first: the date, the decision, the reason, and what would change it.

## 2026-11-19: Sound effect names are pageturn and swipe
**Decision.** PR #5 and PR #6 both added the same short-form effects under different names. Kept #5's names
(`pageturn`, `swipe`) and #6's extra `click` and `wonder` music; #6's code now uses the kept names.
**Why.** #5 merges first and its names are in its scenes and docs; the owner asked for "page turns".

## 2026-11-19: Judgement stays with the editor in the drop folder
**Decision.** `auto` runs index, map and package by itself but queues the brief and the plan for the editor.
**Why.** Those two steps are the reasoning; automating them with fixed rules is the literal-executor failure again.
**Would change if.** The self-learning engine has enough evidence that a class of brief decision is reliable.

## 2026-11-19: Self-learning engine is planned, not built
**Decision.** Written up in docs/SELF-LEARNING-ENGINE.md; builds write `decisions.json` now so the history exists.
**Why.** The owner approved it as a future phase; the R2 bucket isn't set up yet.

## 2026-11-19: Edit raw footage through a brief, not straight into a plan
**Decision.** For raw footage, `longform.mjs analyze` writes an edit map and a brief template; the agent fills in the
brief (one idea, hook, story order, cuts, depth, formats) before writing the plan, and `check` warns without one.
Script-first plans are exempt: the script is their brief.
**Why.** The owner's critique: early videos took a collaborator's words literally and turned them straight into a
video. The missing step was deciding what the material is saying. A written brief makes that step explicit and
reviewable.
**Would change if.** Briefs become boilerplate nobody reads; then move the decisions into the plan itself.

## 2026-11-19: The edit map flags, it doesn't cut
**Decision.** `analyze` lists repeats, false starts, fluff and hook candidates with reasons; it never edits the plan.
**Why.** Cheap text heuristics are wrong often enough (a callback looks like a repeat, a quiet line can be the best
hook). Evidence for the editor beats an automatic cut nobody checks.
**Would change if.** Measured on several real sessions, a class of flag is right almost every time; then apply it
by default with an opt-out.

## 2026-11-19: The repo explains itself
**Decision.** `AGENTS.md` is the front door; `docs/STATUS.md` (with a handoff queue), this file and `docs/runs/`
are kept current by every agent before it finishes.
**Why.** The owner wants any agent that opens the repo to know exactly what is going on: goal, pieces, state, open
work, lessons, why.

## 2026-11-19: Build on PR #5
**Decision.** Roadmap phase 1 is stacked on PR #5's branch, not main.
**Why.** The owner asked to build on that work (docs/LESSONS.md, the Openverse fallback, voice-lines).

## 2026-11-18: Free-license B-roll only, no keys by default
**Decision.** Automatic B-roll searches Openverse and Wikimedia Commons (CC0, PD, CC BY, CC BY-SA) and credits
every file; Pexels/Pixabay only if a key is set. Copyrighted clips (news, YouTube) are pulls the owner approves one by one.
**Why.** Pexels paused new keys and the owner rejected Pixabay; outside clips carry Content ID and fair-use risk.

## 2026-11-17: Captions burned in, something on screen every second
**Decision.** Long-form defaults: burned captions with key words popped, no talking-head gap without a graphic
(pip for full graphics, split otherwise). See `docs/TASTE.md`.
**Why.** Owner's notes on Physics of Poker v1: first-time viewers need something to read and look at every second.

<!-- Interchange (xmeml and EDL in and out): decisions 1 to 5 of the four-additions plan, 2026-11-19. Details: docs/INTERCHANGE.md -->
## 2026-11-19: Interchange 1 to 5 (xmeml and EDL out, a trimmed cut back in)
**1. Import writes `<plan>.imported.json` next to the plan and never overwrites the plan.** Each range is
`{clip, from, to, tighten: false}`. Why: the exported cuts are already tightened, so tightening again would break the
round trip; and a failed or wrong import must not cost the owner the plan. Would change if: a project file format
exists that can hold both versions.

**2. Clip matching: resolved path, then file name plus duration within 0.5 s; two candidates is an error that lists
both.** Why: a moved or relinked file keeps its name and length; guessing between two lookalikes would silently cut the
wrong recording. An EDL has no duration, so its name alone decides.

**3. Import supports V1 (or A1 when V1 is empty) cuts of original library files, reordered and trimmed.** It rejects
speed or time remap, nested sequences, generators and titles, transitions, other effects, gaps and unmatched media; it
warns on split audio, varying Basic Motion scale and numeric-`at` inserts. Why: a transition makes the neighbouring
start/end -1 and a speed change makes the source length differ from the timeline, so the cut cannot be reconstructed
faithfully; failing loudly with the exact reason beats a wrong cut that looks right.

**4. EDL record start is 01:00:00:00; source TC is offset by the file's embedded timecode** (`probe().tc`, an additive
field). Reels are the clip id (8 upper alphanumerics, unique). NDF by default; drop-frame only with `--df` at 29.97 or
59.94. Why: the convention, and without the source offset Resolve conforms camera files to the wrong place.

**5. xmeml `<in>`/`<out>` are counted in the clipitem's declared rate (the sequence rate), not the source file's.**
Why: the clipitem says one rate and the numbers used another whenever the source fps differs from the sequence's.
Equal-rate output is byte-identical (pinned by a hash). Unproven in a real editor, so it is the first item on
`docs/INTERCHANGE-CHECKLIST.md`. Would change if: the checklist shows an editor reading them in the file's rate.
Also fixed in the same change: the A1 `clipindex` counts audio clips only, and inserts without media are skipped with a warning.
