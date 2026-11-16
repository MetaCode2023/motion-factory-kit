# Content engine

Post on a schedule without starting from a blank page each week. One folder per brand, one plan per week,
and a hard stop for a person's approval before anything is scheduled. The engine (`content.mjs`) keeps the
structure and the state. The agent does the judgment: which ideas, what hook, the script, and it builds each
video with the tools already in this repo.

It is not tied to any business. `brands/example/` is the only brand in git; every real brand folder is
git-ignored, so your voice, ideas, plans and results stay on your machine.

## The loop

```
brand.json (set once)
   -> idea inbox  ->  weekly plan  ->  build  ->  YOU APPROVE  ->  schedule  ->  results
          ^                                                                         |
          +-------------------------- what worked feeds next week ------------------+
```

## Set up a brand

`node content.mjs init <brand>` copies the example to `brands/<brand>/`. Then fill in `brand.json`. If you are
the agent, ask the owner for what you can't infer (one question at a time) and write it for them:

| Field | What it is |
|---|---|
| `one_line`, `audience` | what the business does, who the posts are for |
| `voice`, `never` | how it sounds, with an example line; words, claims and topics it does not post |
| `cta` | what a viewer should do next |
| `look` | `theme` (aurora, blueprint, noir, sunset, paper, terminal) and `accent` colour |
| `pillars` | 2-4 kinds of post with a `share` each (they are balanced across the week) |
| `channels` | where it posts: `name`, `format`, `per_week` |
| `scheduler` | how approved posts get scheduled (`buffer`, or `manual`) |

Formats: `short` (15-45 s vertical motion explainer), `ad` (template or raw-footage ad), `long` (YouTube, 16:9),
`shorts` (vertical cuts from a long video), `overlay` (a finished clip with graphics added).

## Each week

1. **Ideas.** Anything can go in the inbox: a blog post, a call recording, a demo, a one-line note.
   `node content.mjs idea <brand> "…" --pillar teach --source "client call"`. If the inbox is thin, propose
   ideas from the pillars and add them the same way.
2. **Plan.** `node content.mjs plan <brand>` makes the week's slots (one per channel post, pillars balanced) and
   fills them from the inbox. Open `brands/<brand>/weeks/<week>/plan.json` and, for every post, write the `hook`
   (first line on screen, 12 words or fewer). Slots left open need an idea from you.
3. **Build.** For each post, make the video with the matching tool (`make.mjs`, a template, `longform.mjs`,
   overlays), following `CLAUDE.md` and `design/MOTION-RULES.md`, in the brand's look. Write the `caption` (hook,
   one line of value, the call to action, 3-5 hashtags). Then
   `node content.mjs mark <brand> <id> built --video out/<file>.mp4`.
4. **Check.** `node content.mjs check <brand>`: fix every FIX.
5. **Review.** `node content.mjs review <brand>` writes one page with every built post. The owner watches,
   presses Approve or Reject, adds notes, and saves a file. `node content.mjs apply <brand> <file>` records it.
   A post approved *with a note* is not final: make the change, then it goes back for a look. Rejected posts
   are not rebuilt unless the note says how.
6. **Schedule.** `node content.mjs queue <brand>` lists the approved posts. Schedule only those, with the
   brand's scheduler (with Buffer connected: add each to the channel's queue), then
   `node content.mjs mark <brand> <id> scheduled`. **Nothing is scheduled or posted without an approval on
   record.** If no scheduler is connected, hand the owner the files and captions.
7. **Results.** When numbers are in, `mark … posted --url …`, and add a few lines to
   `brands/<brand>/results.md`: what was posted, what it got, what that suggests. Read that file before the next
   plan and let it move the mix.

`node content.mjs report <brand>` shows where every post of the week stands. `--week 2026-W47` on any command
works on another week; `--json` gives a machine-readable last line.

## Rules

- The brand's `never` list and voice win over a clever idea.
- Claims and figures follow `docs/PLAYBOOK.md` (sourced, dated, nothing invented; no fake reviews or customers).
- One idea per post. If a post needs two hooks, it is two posts.
- Running this on a schedule: plan and build may run unattended; review, scheduling and posting wait for a person.
