# Roadmap: from executor to editor

Goal: an agent that takes raw footage (Alan's and Austin's whiteboard sessions, talking heads, podcasts, notes),
works out what's worth keeping, and turns it into clean finished videos in every format (long-form 16:9, vertical
Shorts/Reels/TikTok) with minimal hand-holding. Written 2026-11-19 after the owner's critique that the kit was
executing requests literally ("you took exactly what Alan said and made a video about it").

## Ten changes, ranked by impact

| # | Change | Why it matters | Phase |
|---|---|---|---|
| 1 | **Brief before plan.** A short decision record (one idea, hook, story order, cuts, added depth, formats, open questions), each call with a reason. `check` warns when a plan has none. | The literal-executor failure happens at exactly this step: going from material to plan with no "what is this saying?" in between. | 1 (done) |
| 2 | **Edit map of raw footage** (`longform.mjs analyze`): sections, points said twice (keep which take), false starts, table talk, hook candidates from anywhere, Short candidates, terms never defined. | Gives the agent evidence to reason from on a 40-minute whiteboard session instead of reading it top to bottom and keeping it in order. | 1 (done) |
| 3 | **Story order, checked.** A `structure` check on plans: does it open on a strong self-contained line, is there a promise in 45 s, does every beat map to the one idea, is it still in recording order (a smell)? | Raw sessions wander; viewers need hook, promise, build, turn, payoff. | 2 |
| 4 | **Best take across sessions.** Cross-clip repeat detection over the whole library: when Alan explains the same idea in three sessions, rank the takes (clarity, fillers, energy, board state) and use the best. | Whiteboard series re-explain constantly; the best version is rarely in the session you opened. | 2 |
| 5 | **One recording, every format** (`longform.mjs package`): from the brief, build the long-form cut and the native vertical Shorts (merge PR #2's compositor), thumbnail, titles, captions, in one run. | "All the different formats" without separate requests. | 2 |
| 6 | **Depth pass.** For each undefined term and each bare claim: an on-screen definition, a researched number with source, or a pickup line for the speaker to record (`PICKUPS.md`). Never faked words. | Turns "what he said" into "what a first-time viewer needs to follow it". | 3 |
| 7 | **Whiteboard awareness.** Detect when the board is the visual (writing activity, the drawing being pointed at): don't cover it with inserts, punch in on it, or redraw the diagram cleanly as an animation. | Alan's footage is whiteboard-first; the board is often the best visual in the frame. | 3 |
| 8 | **Self-critique after every render** (`CRITIQUE.md`): watch it as a viewer: stretches with nothing new on screen, jargon density, slow sections, repeated visual types, drift from the brief. Fix and rebuild, 2-3 passes, before handing over. | The owner shouldn't be the first person to notice a dull minute. | 3 |
| 9 | **Taste that learns** (`docs/TASTE.md`): every review note that generalises becomes a dated rule; `feedback` proposes the rule automatically. | The same note never has to be given twice. | 1 (seeded), 4 (automatic) |
| 10 | **Confidence-gated questions.** Decide by default; ask only before spending, posting, a new recording, or a goal-changing fork nothing settles. Every guess is listed in the brief with the default used. | Minimal hand-holding without silent wrong guesses. | 1 (rules), 4 (in the run log) |

Plus the repo itself has to explain what's going on to any agent that opens it: `AGENTS.md` (front door),
`docs/STATUS.md` (what works, open PRs, the handoff queue), `docs/DECISIONS.md` (why), `docs/runs/` (what each
video decided and what the reviewer said). Phase 1.

## Phases

**Phase 1: think before cutting (this PR, stacked on PR #5).**
`analyze` + EDITMAP.md, the brief template and the `check` warning, `longform_analyze` MCP tool, docs/EDITORIAL.md,
docs/TASTE.md, the orientation docs and the "update STATUS before you finish" rule. Worked example brief for the demo.

**Phase 2: structure and formats.**
Structure check on plans (#3). Cross-session best take (#4) using the library. Merge PR #2 (vertical compositor) and
add `package` (#5). Reconcile PRs #5 and #6 first: both add the same kinds of sound effects under different names
(`pageturn`/`page`, `swipe`/`swish`) and both change the B-roll sources.

**Phase 3: depth and self-critique.**
Depth pass with PICKUPS.md (#6). Whiteboard detection from frame differences in the board region (#7). CRITIQUE.md
after every build with a fix-and-rebuild loop (#8).

**Phase 4: hands-off.**
`feedback` proposes TASTE.md rules (#9). Open questions and their defaults recorded per run (#10).
`longform.mjs auto <folder>`: a watched folder (rules in docs/LESSONS.md) that indexes, maps, briefs, plans, builds,
critiques and packages, stopping only at the gates in docs/EDITORIAL.md.

Each phase is tested on a real recording of Alan's before the next starts, and the run goes in `docs/runs/`.
