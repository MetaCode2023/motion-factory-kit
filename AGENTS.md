# Start here (any agent)

**What this is.** Motion Factory Kit turns code and raw footage into finished videos. The goal it is being built
toward: **a reasoning video editor** that takes raw recordings (long whiteboard explainers, talking heads, podcasts,
notes), works out what is worth keeping and what it means, and produces clean finished videos in every format
(long-form 16:9, vertical Shorts/Reels/TikTok) with minimal hand-holding.

**How to think.** Everything you're given is raw material, not a script. Find the one idea, the strongest hook, the
story order; cut repeats and fluff; add the depth a first-time viewer needs; pick the formats. Decide by default and
explain afterwards; ask only before spending money or posting. Full version: `docs/EDITORIAL.md`.

## Read in this order

1. `docs/STATUS.md`: what works, open PRs, videos made, and the **handoff queue** (what to do next).
2. `docs/EDITORIAL.md`: the editing loop (index → map → brief → plan → build → critique → record).
3. `docs/TASTE.md`: what the owner wants in every video. Beats the defaults.
4. `docs/LESSONS.md`: what runs where (cloud vs the owner's laptop), rate limits, picking B-roll.
5. `CLAUDE.md`: the full workflow and every tool, by kind of video.
6. `docs/ROADMAP.md` and `docs/DECISIONS.md`: where it's going and why things are the way they are.
7. `docs/SELF-LEARNING-ENGINE.md`: the planned engine that learns from every run (decisions, feedback, view stats).

## The pieces

| Kind of job | Entry point | Docs |
|---|---|---|
| Raw recording(s) → long-form 16:9 | `longform.mjs` (`index`, `analyze`, `search`, `check`, `build`) | docs/LONGFORM.md, docs/EDITORIAL.md |
| Script → recording → long-form | `longform.mjs script / from-script` | docs/LONGFORM.md, docs/PLAYBOOK.md |
| Short-form scene (explainer, ad, 9:16) | `make.mjs` + `scenes/` + `kit/` | CLAUDE.md, design/ |
| Raw client footage → many ads | `footage.mjs` | docs/EDITOR.md |
| Overlays on a finished clip | `tools/overlay.py` | docs/OVERLAYS.md |
| Regular posting for a brand | `content.mjs` | docs/CONTENT.md |

If you speak MCP, connect `mcp/server.mjs` (docs/MCP.md) and every step is a tool. `npm test` runs the suite;
`node longform.mjs demo` builds a long-form video end to end with no keys.

Already have your own pipeline? `docs/MODULES.md` maps the pieces you can lift out on their own.

## Before you finish

Update `docs/STATUS.md` (and its handoff queue), add to `docs/DECISIONS.md` for choices a later agent might undo,
write `docs/runs/<date>-<video>.md` for any video you made, and put lessons and preferences in `docs/LESSONS.md` /
`docs/TASTE.md`. Footage, scripts, plans and brand data never go in git.

Title cards (opening, chapter, end card) and their data keys: `kit/titles.js`, `docs/TITLES.md`.
