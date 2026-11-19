# Agent instructions

**Working on the Simulation channel pipeline** (raw recordings → long videos and shorts, state in Cloudflare)?
Read ["Simulation pipeline"](#simulation-pipeline) below and follow it exactly.

See CLAUDE.md: the same workflow applies to any coding agent. If you speak MCP, connect
`mcp/server.mjs` (docs/MCP.md) and every step is a tool. `npm run demo` shows the footage editor end to
end with no API keys; `node longform.mjs demo` does the same for the long-form YouTube editor (docs/LONGFORM.md).

Already have your own video pipeline? Read docs/MODULES.md: a comparison checklist and a map of the
pieces you can lift out on their own (word-exact cutting, street-audio cleanup, face-following reframe,
street-interview overlays, client review loop, delivery sheet, render self-checks).

## Simulation pipeline

Raw whiteboard recordings (20 min to 2 h) become 3-6 long videos (5-10 min, 16:9) and 10-20 vertical shorts
(15-60 s) for the Simulation YouTube channel. Several agents (Claude Code, Codex, Gemini CLI, others) work on it
from different machines at different times. **All state is in Cloudflare** (D1 database `simulation`, R2 bucket
`simulation-videos`), so you never rely on another agent's local files. Details and the plan format: [docs/SIM.md](docs/SIM.md).

Your judgment is needed for three things only: choosing segments, writing titles/descriptions/visual cues, and
checking the result. Everything else is a command. Run them from the repo root:

```
export SIM_AGENT=<your agent name>        # claude-code, codex, gemini, ... (PowerShell: $env:SIM_AGENT="codex")
node sim.mjs status                        # what exists, who holds what, what waits for review
node sim.mjs claim <job>                   # take one job before touching it
node sim.mjs transcribe <job>              # if status is ingested
#   read out/sim/<job>/transcript.txt, write out/sim/<job>/plan.json  (format: docs/SIM.md)
node sim.mjs propose <job> --from out/sim/<job>/plan.json
node sim.mjs build <job>                   # look at stills.jpg + FIX notes; fix the plan and rebuild if needed
node sim.mjs review <job>                  # hands it to a human
node sim.mjs release <job>                 # ALWAYS, when you stop for any reason
```

### The order of steps

1. `status`. Pick a job that is not claimed (the "working on it" column is `-`). Prefer finishing a job over starting one.
2. `claim <job>`. If it says someone else holds it, pick another job; never work on a claimed job. The lease is
   30 minutes; every `sim` command renews it while it runs. If you will think for longer than that between
   commands, run `claim <job>` again to renew.
3. Do the next step for its status: `ingested` → `transcribe`; `transcribed` → write the plan and `propose`;
   `planned` → `build`; `built` → check, then `review`; `in_review` → wait for the human. Rejected outputs: read the
   reviewer's note in `status <job>`, change the plan, `propose` again, `build <job> <output>`.
4. Stopping before the job is done (blocked, out of time or context)? Leave a handoff note first:
   `node sim.mjs note <job> "transcribed; plan half-written; shorts still to pick"`. It shows in `status <job>`.
5. `release <job>` when you stop, for any reason.

### Quality rules

- **Segments.** A long video is a complete arc: a question or promise in the first 10 s, a turn in the middle, a
  payoff at the end. A short opens on its strongest line (a hook in the first 5 seconds that makes sense with no
  context) and ends on a clear payoff, not mid-thought. Cut at sentence boundaries from the transcript times.
- **Titles** are hooks, not chapter names. Descriptions: the hook, one line of value, what they'll learn.
- **Every long video gets chapters** (3+, each 10 s+, first at its start). `sim build` flags a missing set.
- **Visual cues** (`kit.inserts`, see docs/LONGFORM.md) follow the long-form rules: one about every 15 s, shown not
  written, figures only from the speaker or with a source.
- **Check before you call it built.** Open `stills.jpg` (and `inserts.jpg`) in `out/longform/sim-<job>-<kind>-<slug>/`
  and read the FIX notes `build` prints. Fix what you can and rebuild that output; say what you couldn't fix.
- Never put words in the speaker's mouth: cut only at their own sentence boundaries, never stitch sentences.

### Hard rules

- **Never post, approve or reject.** `sim approve` / `sim reject` are for humans; never pass `--yes`. Never upload
  anything to a social platform. Record a posting (`mark-posted`) only when the human tells you the URL.
- **Never delete** from R2 or D1 (no `wrangler r2 object delete`, no `DELETE`/`DROP`, no editing rows by hand).
  If something must go, ask the human.
- **Always log your agent name**: set `SIM_AGENT` before running anything.
- **Always release your claim** when you stop.
- Never print, log or commit keys. They live in `.env` (git-ignored) or the environment.
