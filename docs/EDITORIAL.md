# Thinking like an editor

The kit's job is not to execute instructions. It takes raw footage (long whiteboard sessions, rambling takes,
podcast archives, notes) and works out **what is worth keeping, what it means, and how to show it**, then makes a
clean finished video in every format with as little hand-holding as possible.

Read this before editing any raw footage, and before turning anyone's notes into a video.

## The rule

**Everything you are given is raw material, not a script.** A recording, a voice memo, a list of notes, a request
("make a video about X"): each is evidence of what the person wants to say. Your job is to find the strongest version
of it. That means:

- Find the **one idea** under the talking, the claim a viewer could repeat to a friend.
- Pick the **strongest opener** from anywhere in the footage, not the first thing that was said.
- Put it in **story order** (hook, promise, build, turn, payoff, next step), not recording order.
- **Cut** what doesn't serve the one idea: repeats (keep the best take), tangents, table talk, warm-up.
- **Add depth** the footage doesn't have: define every term on screen, add the real numbers and context (researched,
  sourced), show instead of tell. Never put words in the speaker's mouth; if a beat is missing, write the line for
  them to record (a pickup).
- **Choose the formats**: the long-form cut, plus the stretches that stand alone as vertical Shorts.

Notes are the same. If someone gives you bullet points, don't narrate the bullets. Work out what they're getting
at, restructure, cut the weak points, deepen the strong ones, and say what you changed and why.

## The loop

```
1. index      node longform.mjs index                       transcripts, numbered sentences, contact sheets,
                                                             whiteboard scan (when the board is being drawn on)
2. map        node longform.mjs analyze <clip> --name <video> EDITMAP.md: sections, repeats, false starts, fluff,
                                                             hook candidates, Short candidates, undefined terms
              node longform.mjs takes                       TAKES.md: the same point in several recordings, best take first
3. look       open <clip>.sheet.jpg and stills where it matters (what's on the board? is there anything to see?)
4. brief      edits/longform/<video>.brief.md                the decisions, each with its reason (template below)
5. plan       edits/longform/<video>.json                    follows the brief, in story order
              node longform.mjs check <plan>                warns without a brief; the editor notes (opener, promise,
                                                             order, repeats, fluff, terms, dead air, pace, ending, board)
              node longform.mjs depth <plan>                DEPTH.md: terms to explain, figures to source, pickup lines
6. build      node longform.mjs package <plan>              the video, vertical Shorts, thumbnails, PACKAGE.md
7. critique   CRITIQUE.md (written by every build)          fix what a first-time viewer would trip on, rebuild
                                                             (2-3 passes is normal); say why for what you leave
8. record     docs/runs/<date>-<video>.md                    what you decided, why, what the reviewer said, what to change
              (every build also writes decisions.json for the self-learning engine, docs/SELF-LEARNING-ENGINE.md)
```

**Hands-off:** `node longform.mjs auto` runs steps 1-2 on anything dropped in `footage/inbox/` and step 6 on any
plan whose brief is filled in, and writes `footage/QUEUE.md`: what is waiting for the editor (briefs and plans to
write) and what is ready for review. The judgement steps (4 and 5) stay with the editor, and nothing is posted.

The edit map is evidence, not a decision. It finds candidates cheaply; you still read the transcript and decide.
A "hook candidate" that leans on the line before it is not a hook. A "repeat" might be a deliberate callback.

## The brief

`analyze` writes a template. Fill in every section before you write the plan. Keep it short: one or two lines per
decision, each with its reason. Worked example: `examples/longform/physics-of-poker.brief.md`.

| Section | The question it answers |
|---|---|
| The one idea | What is this video saying? (A claim, not a topic.) |
| Who it's for | What do they already know? Default: curious, has never heard the term. |
| Hook | Which line opens it, and why that one beats the others. |
| Structure | 4-6 beats in story order, each mapped to source lines (`clip#n-#m`). |
| Cut, and why | What goes, how many seconds it saves. |
| Added depth | Terms explained on screen, researched context with sources, pickup lines to record. |
| Formats | Long-form length; which stretches become Shorts and why each stands alone. |
| Look and sound | From `docs/TASTE.md` unless this video needs something else. |
| Open questions | Only what you can't decide yourself, each with the default you'll use. |

## When to ask, and when to decide

Decide by default, then explain. Ask first only when:

- it **spends money or credits** (Higgsfield generations, paid narration, stock subscriptions), or
- it **publishes or sends** something (posting, scheduling, emailing a client), or
- the footage **can't support the point** and the fix is a new recording (give them the lines), or
- two readings of the goal lead to **different videos** and nothing (TASTE.md, SERIES.md, earlier runs) settles it.

Everything else (structure, hook, cuts, formats, B-roll, pacing, music) is your call. Put each guess in the brief's
open questions with the default you used, build with the default, and let the review change it.

## Learning from feedback

Every review note is two things: a fix for this video and, often, a rule for every video.

1. Fix the video (`node longform.mjs feedback`, change only what the notes ask, rebuild).
2. Ask what the note says about taste in general. `FEEDBACK.md` lists the notes that sound like standing
   preferences under "Proposed rules". If one generalises ("never just a talking head", "real video over photos"),
   add it to `docs/TASTE.md` with the date and the video it came from.
3. Record the run in `docs/runs/` (template in `docs/runs/README.md`).

The next video starts from TASTE.md, so the same note never has to be given twice.
