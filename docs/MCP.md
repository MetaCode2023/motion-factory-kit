# MCP server: the kit as tools for any agent

`mcp/server.mjs` exposes the kit over the Model Context Protocol (stdio), so Claude Code, Claude
Desktop, Cursor or any MCP client can call it directly: index footage, check and write edit plans,
build batches, apply client feedback, render scenes, and *see* frames and cut stills.

## Connect

Claude Code picks it up automatically in this folder (`.mcp.json`). Elsewhere:

```bash
npm install
claude mcp add motion-factory -- node /path/to/motion-factory-kit/mcp/server.mjs
```

Any other client: command `node`, args `["/path/to/motion-factory-kit/mcp/server.mjs"]`.
Set `ELEVENLABS_API_KEY` (narration, speakers in transcripts) or `FOOTAGE_DIR` (a footage workspace
other than `footage/`) in the server's environment if you want them.

## Tools

| Tool | What it does |
|---|---|
| `kit_overview` | Start here: templates with their data keys, blocks, caption styles, the workflow, the rules. |
| `footage_index` | Transcribe and thumbnail a folder of clips. Returns sentences with timings and speakers, face coverage, thumbnail paths. |
| `footage_check_plan` | Validate an edit plan against the index without cutting: unknown clips, missing sentences, bad tallies, length. |
| `footage_write_plan` | Check, then save a plan to `edits/<name>.json`. |
| `footage_build` | Build ads from plans: every hook, every size, `DELIVERY.csv`, `review.html`. `only` / `redo` rebuild a subset. |
| `review_feedback` | Apply a client's `review.json`: `FEEDBACK.md`, `approved/`, the review column. Returns the ads to re-cut. |
| `review_page` | (Re)write a batch's review page. |
| `make_video` | Build any scene or template (with `data` for a template row). Returns files and every PASS/FIX check. |
| `render_still` | One frame of a scene, returned as a picture. |
| `look_at` | Any PNG/JPG in the kit (cut stills, thumbnails, covers) returned as a picture. |
| `overlay_transcribe` | One finished clip → timestamped lines (local faster-whisper), for writing overlay cues. |
| `overlay_write_cues` | Check and save `<clip>.cues.json`: chapters for the progress bar, explainer cards. |
| `overlay_render` | Burn the progress bar, cards and SFX onto the clip; returns the contact sheet as a picture. |
| `hook_alert` | A 3-second cold-open hook from a JSON spec (plus SFX/drone stems). |
| `overlay_join` | Put a hook in front of a clip. |

Every tool returns JSON. The same JSON is available from the command line with `--json`
(`node footage.mjs build edits/ --json`, `node make.mjs scene.html --json`): the last line printed is
the result. Each `make.mjs` build also writes `<name>.result.json` next to the video.

## A typical session

1. `kit_overview`, then read `CLAUDE.md` and `docs/EDITOR.md`.
2. `footage_index` → read the sentences, `look_at` a few thumbnail strips.
3. For each ad: write the plan, `footage_check_plan`, fix, `footage_write_plan`.
4. `footage_build` (with `fast: true` for a first pass), then `look_at` each `*.cuts.png` and read the
   failed checks. Fix plans, rebuild with `only`.
5. Send `out/<batch>/review.html` to the client. When `review.json` comes back: `review_feedback`,
   edit only the flagged plans, `footage_build` with `redo`.

Paths are relative to the kit; the server refuses to read or write outside it. Long builds block
until they finish (minutes for a batch).

Try it on the bundled demo footage first: `FOOTAGE_DIR=out/demo-footage`, index
`examples/demo/footage`, plans in `examples/demo/edits`, or just `npm run demo`.
