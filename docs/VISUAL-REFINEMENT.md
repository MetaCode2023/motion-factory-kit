# Visual refinement loop

Refine one shot against lookdev reference plates (Google Stitch exports, a moodboard, concept art,
a paintover) until an isolated critic approves it, stills first and motion second. Every approval
is bound by hash to the exact scene code, parameters and rendered output that were judged.

The engine is `refine/loop.mjs`; drive it with `node refine.mjs ...`, the `refine_*` MCP tools, or
motion-factory's `daily.py --refine` runner. The contract format is shared with motion-factory
(`visual_contract.py`) and studio-engine (`src/visual-refinement-contract.mjs`); its JSON
description is `refine/visual-refinement-contract.v1.json`, identical in all three repos.

## Rules the loop enforces

- **A saved image is not a quality check.** The approval gate needs a recorded critique from an
  isolated critic, bound to the output hash. Technical checks (render ran, PNG decodes, right
  resolution, valid MP4) only decide whether there is anything to look at.
- **No false successes.** Blank, zero-variance, flat-fill, magenta/checkerboard fallback textures
  and frames byte-identical to a reference plate fail the technical check.
- **Isolated critique.** The critic gets a packet folder (frames, render|reference comparisons,
  plates, the brief, DESIGN.md, measured deltas) and never the scene source or parameters. Use a
  separate session: `node refine.mjs critic <run>` (Claude Code on your subscription, credentials
  stripped from its environment), or a subagent given only the packet folder.
- **No numeric quality scores.** Critiques are pass/fail verdicts per criterion with observations,
  evidence ids and corrections. Numbers under `criteria`, keys like `score`/`rating`, and claims like
  "cinematic excellence" are rejected.
- **Measurements can block but never approve.** A criterion passes only when the critic passes it
  and no measured gap for that criterion is beyond 2x its tolerance (or, for originality, no generic
  tripwire: flat lighting, evenly spread default noise, default primaries).
- **Budget and stopping.** Default 6 still iterations, 3 temporal. Every iteration must change
  params or code. The loop escalates to a human only for: budget exhausted, converged without
  approval (delta distance moved less than `convergenceDelta` for `patience` iterations), three
  technical failures in a row, a critic flagging a creative-direction shift, or anything needing
  paid APIs, publishing, deployment or merging (all off unless the contract's `authorization` says
  otherwise). There are no timed human check-ins.

## The contract

`refine/examples/underwater/contract.json` is a complete example. The parts:

| Field | What it is |
| --- | --- |
| `shot` | id, scene file, duration, fps, size, optional `cuts`, and the brief in words |
| `references[]` | each plate: id, role (establishing, hero, macro, mood, palette, detail), source (google-stitch, moodboard, concept-art, photograph, procedural-lookdev, paintover), path, sha256, size. `node refine.mjs ingest plate.png` prints the sha256 and size |
| `keyframes[]` | shot times, each mapped to one plate: the render at `t` is compared with that plate |
| `design` | DESIGN.md (path + sha256) and measurable `targets` (`{ bMean: { max: -12 } }`) |
| `params` | the scene's `M.data` values to start from |
| `tuning` | optional advisory map from a metric to the params that move it, for suggestions |
| `temporal` | which params are motion-only, preview fps and `previewData` (e.g. `{ "resolutionScale": 0.25 }`) |
| `budget`, `authorization` | iteration limits and what is allowed (paid API, publish, deploy, merge: all false by default) |

Write the scene so every look decision is a parameter (`const D = M.data({...})`), and support a
`resolutionScale` for previews. `scenes/examples/underwater-documentary.html` is the reference.

## The still-first loop (9 steps)

```bash
node refine.mjs init refine/examples/underwater/contract.json        # 1 target ingestion
node refine.mjs still out/refine/underwater-documentary --set rayIntensity=0.6 --note "why"
                                                                      # 2 render, 3 technical, 4 packet
node refine.mjs critic out/refine/underwater-documentary              # 5-9 via an isolated critic session
# or: hand out/refine/<shot>/iterations/NNN/packet/ to an isolated reviewer, then
node refine.mjs critique out/refine/underwater-documentary critique.json
node refine.mjs status out/refine/underwater-documentary
```

| Step | What happens | Written to `iterations/NNN/` |
| --- | --- | --- |
| 1 target ingestion | contract validated, plates verified against their sha256, copied, measured | `../references/`, `../contract.json` |
| 2 initial render | `render.mjs --still` at every keyframe (the same path as `render_still`) | `frames/`, `params.json`, `scene.html` |
| 3 technical check | render errors, decode, resolution, false-success frames | `record.json` `technical` |
| 4 visual inspection | frames + render-or-reference comparisons packed for the critic | `packet/` (`CRITIC.md`, `packet.json`) |
| 5 rubric evaluation | the critic's verdict per criterion, cross-checked with measurements | `critique.json`, `record.json` `rubric` |
| 6 delta identification | observed + measured gaps as a delta log | `delta.json`, `record.json` `deltaLog` |
| 7 code adjustment | the next iteration's change (params and/or scene code), next to what was suggested | `record.json` `adjustment` |
| 8 hash re-verification | frames, params, scene snapshot and the current scene re-hashed; state chained to its parent | `record.json` `stateHash`, `../chain.json` |
| 9 approval gate | `approval-still.json` only for the exact state that passed | `../approval-still.json` |

## Creative criteria

composition, lighting, materials, spatial, color, narrative, originality. Their questions and
pass/fail wording are in the shared JSON; studio-engine's `src/creative-judgment.mjs`
(`VISUAL_CRITERIA`) owns them.

## Temporal refinement

```bash
node refine.mjs temporal out/refine/underwater-documentary --set cameraShake=0
```

Needs a verified still approval. Renders a low-res preview (`temporal.previewData`), decodes every
frame and measures flicker, camera jitter, texture boil/swimming, physics pops, duplicated or
missing frames (frame-rate drops), frozen stretches and pacing; samples ordered keyframes (contract
keyframes, both sides of cuts, peak motion) into a sequence sheet for the critic. Only the
contract's `temporal.params` may change here. When the critic fails a look criterion in motion, the
run loops back to stills and the still approval is revoked; motion-only problems stay temporal.
Every temporal record states its sampling limits (preview resolution, sampled vs total frames).

## Finishing

```bash
node refine.mjs final out/refine/underwater-documentary --out out/underwater_cinematic_final.mp4
node refine.mjs bundle out/refine/underwater-documentary --dest out/refine/underwater-bundle
node refine.mjs verify-bundle out/refine/underwater-bundle
```

`final` refuses without a verified temporal approval descending from the approved still state. The
bundle holds the contract, plates, every iteration's scene snapshot, params, frames, packets,
critiques, delta logs, the hash chain, approvals and the final render record, with `manifest.json`
(sha256 of every file) and `SUMMARY.md`.

Restore a saved iteration with `node refine.mjs restore <run> <n>`: its snapshots are verified
first, the scene and params come back, and any approval is revoked until it is rendered and
critiqued again.

## Lookdev plates

`tools/lookdev-plates.mjs` renders the procedural plates used by the underwater example (a per-pixel
volumetric renderer, independent of the canvas scene). Replace them with art-directed plates by
writing new PNGs and updating each reference's sha256; nothing else changes.
