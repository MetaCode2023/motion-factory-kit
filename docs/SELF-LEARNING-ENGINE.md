# Self-learning engine (planned)

**Status: approved as a future phase, not built.** The owner asked for this to be written down so it isn't
forgotten. Storage: a Cloudflare R2 bucket is coming (not set up yet as of 2026-11-19). Build it after roadmap
phases 1-4 (`docs/ROADMAP.md`), because it learns from the decision records those phases produce.

## The idea

Every video the editor makes is an experiment. It already writes down what it decided and why (the brief, the
critique, the run report). The engine stores those decisions, ties the owner's feedback and the real audience
numbers back to each one, finds what works, and feeds it into the next edit. The editor gets better every time
it works, without anyone re-explaining their taste.

## Storage

| Store | Holds | Why there |
|---|---|---|
| **R2** (object storage) | raw footage, renders, transcripts, edit maps, briefs, plans, CRITIQUE.md, run reports | big files, cheap, kept for good |
| **D1** (SQL) | one row per decision (what, why, which video, which second), feedback on it, view and retention stats, rules learned | small, structured, queryable by the editor and the workers |

Suggested D1 tables: `videos` (id, title, format, published_at, platform ids), `decisions` (video, kind: hook /
cut / structure / visual / broll / sound / format / title / thumbnail, at, choice, reason, alternatives),
`feedback` (decision, source: owner / collaborator / client, verdict: keep / change / reject, note),
`metrics` (video, platform, day, views, avg view duration, retention curve, likes, shares, follows),
`rules` (text, evidence, confidence, status: proposed / active / vetoed, since).

## How it works

1. **Every run logs its decisions.** The brief, the critique, the plan and the run report become rows in
   `decisions`, each with its reason and the alternatives considered (the edit map's other hook candidates, the
   takes not used). Raw files go to R2.
2. **Feedback is tied to the decision it's about.** Review notes (`review.json`), approve / reject on Shorts,
   re-cuts: each one points at the decision and the second on screen it changed.
3. **A scheduled worker pulls the audience numbers** from YouTube and TikTok (views, average view duration,
   the retention curve, shares) and links each dip and spike to the decision on screen at that second. This is
   the most valuable step: it is the audience's feedback, not ours.
4. **A nightly worker finds patterns** across videos ("cold opens on a number hold 20% more viewers at 0:30",
   "photo B-roll under 2 s loses people") and proposes rules. Rules that keep holding are promoted into
   `docs/TASTE.md` / the playbook; ones that stop holding are demoted.
5. **The editor reads the rules before planning**, and pulls the most similar past winners (same topic, same
   format, same kind of hook) into the brief as references.
6. **A weekly "what I learned" note goes to the owner**, who can veto any rule. Hooks and thumbnails get A/B
   tested where the platform allows it, so rules come from experiments, not guesses.

## Guard rails

- The owner approves rules before they change defaults; vetoed rules stay vetoed.
- Nothing is posted or scheduled by the engine.
- Client footage and private recordings stay in private storage; nothing personal goes into the repo.
- Numbers can mislead on small samples: a rule needs several videos behind it before it's promoted.

## What exists already to build on

- Decision records: `edits/longform/<video>.brief.md`, `CRITIQUE.md`, `docs/runs/`, `docs/DECISIONS.md`.
- Feedback capture: `review.html` → `review.json` → `node longform.mjs feedback` (FEEDBACK.md, with proposed
  TASTE.md rules).
- Machine-readable output: every build writes `out/longform/<name>/decisions.json` (brief, editor notes, inserts,
  chapters) so the first ingest worker only has to upload it.

## First steps when it's time

1. Create the R2 bucket and the D1 database; a Worker with an upload endpoint for `decisions.json` + files.
2. Upload every past run (backfill from `docs/runs/`).
3. YouTube Analytics and TikTok stats pull (needs the owner's sign-in to each platform).
4. Nightly pattern job and the weekly note.
