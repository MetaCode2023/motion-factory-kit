# Simulation pipeline (`sim`)

The production backend for the Simulation YouTube channel. A raw whiteboard recording (20 min to 2 h,
1-2 GB) becomes 3-6 long videos (5-10 min, 16:9) and 10-20 vertical shorts (15-60 s). Several agents
(Claude Code, Codex, Gemini CLI, ...) share the work from different machines at different times, so **all state
lives in Cloudflare** and every mechanical step is one command. Rules for agents: [AGENTS.md](../AGENTS.md).

```
Google Drive "Simulation Videos/Inbox"
        │  sim watch / sim ingest
        ▼
 R2 raw/<job>/<file>  ──►  work/<job>/proxy.mp4, audio16k.wav
        │  sim transcribe                       (Parakeet TDT 0.6b v2, sherpa-onnx, local)
        ▼
 work/<job>/words.json, transcript.txt
        │  an agent reads transcript.txt, writes plan.json;  sim propose
        ▼
 D1 outputs (proposed)
        │  sim build                             (longform.mjs build / shorts on each segment)
        ▼
 R2 out/<job>/long/<slug>/, out/<job>/shorts/<slug>/   (outputs: built)
        │  sim review                            (job: in_review, REVIEW.md with links)
        ▼
 a human: sim approve / sim reject   ──►   posts it   ──►   sim mark-posted
```

## Where things live

| What | Where |
|---|---|
| Database | Cloudflare D1 `simulation` (id in `infra/cloudflare/wrangler.jsonc`); schema in `infra/cloudflare/migrations/` |
| Files | Cloudflare R2 bucket `simulation-videos` |
| Secrets | `.env` at the repo root (git-ignored; template `.env.example`) or the environment |
| Local scratch | `out/sim/<job>/` (proxy, audio, words, plans; safe to delete, everything is in R2) |
| Model cache | `~/.cache/sim/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/` |

R2 layout:

```
raw/<job_id>/<original filename>
work/<job_id>/proxy.mp4 · audio16k.wav · words.json · transcript.txt · plan.json
out/<job_id>/REVIEW.md
out/<job_id>/long/<slug>/    video.mp4 captions.srt CHAPTERS.txt thumbnail.jpg stills.jpg inserts.jpg REPORT.md metadata.json
out/<job_id>/shorts/<slug>/  video.mp4 captions.srt thumbnail.jpg stills.jpg REPORT.md metadata.json
```

Job status: `new → ingested → transcribed → planned → built → in_review → approved → posted` (or `failed`).
Output status: `proposed → built → approved | rejected → posted`. Every change also writes a row to `events`.

## Commands

Run from the repo root: `node sim.mjs <command>` (or `npm run sim -- <command>`). Add `--json` for one JSON object on
stdout (progress goes to stderr). Set `SIM_AGENT` (e.g. `claude-code`, `codex`, `gemini`) so the log says who did it.

| Command | What it does |
|---|---|
| `sim init` | Checks node, ffmpeg, python + sherpa-onnx, wrangler, keys, D1 (applies migrations) and R2. Creates what's missing. Safe to re-run. |
| `sim ingest <file-or-folder> [--title "..."]` | For each new video: job row, multipart upload to `raw/`, a 1080p/30 fps x264 CRF 22 proxy (audio copied) and 16 kHz mono wav uploaded to `work/`. Skips files already ingested (same name + size). |
| `sim watch <folder> [--every 5m]` | Ingests anything new in the folder. Waits until a file has stopped growing (Drive syncs large files slowly). |
| `sim status [job]` | All jobs with output counts and who holds each one; with a job: its outputs and recent events. |
| `sim claim <job>` / `sim release <job>` | Take a job for 30 min (`--minutes n`) / give it back. Working commands claim and renew automatically. |
| `sim note <job> "..."` | A handoff note for the next agent (shown in `sim status <job>`). |
| `sim transcribe <job>` | Word-level transcript: `work/<job>/words.json` (`{"words":[{"w","s","e"}]}`) and `transcript.txt` (paragraphs, `[m:ss]` every ~30 s). Model downloads once from the k2-fsa/sherpa-onnx GitHub releases. |
| `sim propose <job> --from plan.json` | Checks the plan and records each video as an output (`proposed`). `--force` accepts length warnings only. |
| `sim build <job> [output]` | Builds every proposed output (or one, to rebuild): cuts the span from the proxy, runs the kit, uploads to `out/`, records the kit's FIX lines as events. |
| `sim review <job>` | Writes `out/<job>/REVIEW.md` (titles, descriptions, spans, chapters, FIX notes, 7-day links) and sets the job `in_review`. |
| `sim approve <output>` | **Human only.** Asks you to type `approve`. |
| `sim reject <output> --note "..."` | **Human only.** Asks you to type `reject`. The note is stored for the next agent. |
| `sim mark-posted <output> --platform youtube --url <url>` | Records where an approved output went live. |

`<output>` is the full id (`<job>/long/<slug>`), `long/<slug>` within `sim build`, or just the slug when it is unique.

## plan.json

Written by an agent after reading `out/sim/<job>/transcript.txt` (or `work/<job>/transcript.txt` in R2).
Times are **in the original recording**: seconds (`754.2`) or `m:ss` / `h:mm:ss` (`"12:34.2"`).

```jsonc
{
  "job": "2026-11-18-physics-of-poker",
  "long": [
    {
      "slug": "why-the-house-always-wins",          // optional; made from the title if missing
      "title": "Why the House Always Wins (It's Not Luck)",
      "start": "3:12", "end": "11:40",               // 5-10 min
      "hook": "Why does a casino always win? It is not luck.",   // the line it opens on
      "why": "Full arc: question, the 5% edge, the law of large numbers, the flip side.",
      "description": "YouTube description: the hook, one line of value, what they'll learn.",
      "chapters": [                                  // required for long videos: 3+, each 10 s+, source times
        { "at": "3:12", "title": "The 5% edge" },
        { "at": "5:40", "title": "The law of large numbers" },
        { "at": "8:55", "title": "When you have the edge" }
      ],
      "kit": { "theme": "blueprint", "inserts": [], "thumbnail": { "text": "HOUSE ALWAYS WINS", "accent": "WINS", "prop": "chip" } }
    }
  ],
  "shorts": [
    {
      "title": "Flip a coin 10,000 times",           // a hook, not a chapter name
      "start": "5:40.1", "end": "6:04.8",            // 15-60 s, starts on the hook, ends on the payoff
      "hook": "This is the law of large numbers.",
      "why": "Self-contained: names the idea, proves it, lands on a line."
    }
  ]
}
```

- `hook`, `why` and `title` are required on every item; `chapters` on every long one (`sim build` records a FIX if they
  are missing).
- `kit` is optional and merged into the plan `sim build` hands the long-form editor (docs/LONGFORM.md, "Plans from
  existing footage"): `theme`, `inserts` (anchor them as `"segment@<seconds into the segment>"`), `music`,
  `auto_broll: {...}` (off by default), `captions`, `thumbnail`. The segment is the clip `segment`.
- Re-proposing replaces outputs that are still `proposed` or `rejected`; built, approved and posted ones are kept.

## How a build works

For each output, `sim build` cuts `[start, end]` from the proxy into `out/sim/<job>/library/<kind>-<slug>/segment.mp4`
with the matching words (`segment.words.json`, shifted to 0), points the kit's library there (`LONGFORM_LIBRARY`),
writes `out/sim/<job>/<kind>-<slug>.plan.json` and runs `longform.mjs index` + `build` (fillers and pauses tightened,
chapters, music). Shorts then go through `longform.mjs shorts` (9:16, title on top, word captions burned in). It makes
`stills.jpg` (6 frames) and `thumbnail.jpg`, uploads everything with `metadata.json`, and records each `FIX` line from
the kit's REPORT.md as a `fix` event. Look at the stills before you hand over.

## Setup on a new machine

1. `git clone` the repo, `npm install`, Python 3.10+.
2. Copy `.env.example` to `.env` and fill it in (ask the channel owner; never paste keys into chat or commits).
3. `node sim.mjs init` until it says Ready. The first `sim transcribe` downloads the model (~480 MB).

R2 keys (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`) are separate from the API token. To make them: Cloudflare
dashboard → R2 Object Storage → Manage API tokens → Create Account API token → Object Read & Write, "Apply to
specific buckets only" → `simulation-videos` → Create. Copy the Access Key ID and Secret Access Key (shown once) into `.env`.
