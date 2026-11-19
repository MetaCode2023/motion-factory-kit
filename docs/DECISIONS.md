# Decisions

Why things are the way they are, so a later agent doesn't undo them by accident. One entry per decision, newest
first: the date, the decision, the reason, and what would change it.

## 2026-11-19: Wipe transitions are precomputed masks, not xfade custom (plan decision 10)
**Decision.** A wipe is a set of grayscale PNG mask frames computed in Node (`tools/longform/wipes.mjs`, cached in
`out/.cache/wipes/<hash>/`), joined to the picture with `alphamerge` + `overlay`, the same pattern as the pip layout.
The legacy `xfade` path is untouched.
**Why.** `xfade=transition=custom` runs an expression per pixel per plane (slow), cannot read a third input, has no
seeded random source and makes soft edges costly. Masks give anti-aliased feathered edges, are testable without
ffmpeg, cost about a dozen small PNGs per wipe and keep the two-media-streams-per-chunk rule.
**What would change it.** A need for a wipe that depends on the picture content, or an ffmpeg filter that does masked
blends natively and cheaply.

## 2026-11-19: Wipe grammar is wipe:<family>(name=number ...), no commas (plan decision 11)
**Decision.** `"wipe:<family>"`, `"wipe:<family>(softness=0.15 dur=0.6 angle=30)"` or `{ "wipe": "linear", "softness": 0.15 }`.
A malformed wipe is an error in `resolvePlan`; an unknown legacy name stays a warning with the old fallback.
**Why.** Script headers split `transitions:` on commas and cues split on pipes and semicolons, so the spec can
contain none of them and still travel through a script. A wipe typo should stop the build (it would otherwise
render the wrong thing silently); a legacy name has always fallen back, and changing that breaks old plans.
The future project-format work should adopt this grammar. Clean room: nothing came from OpenShot (GPL-3.0); see docs/TRANSITIONS.md.

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
