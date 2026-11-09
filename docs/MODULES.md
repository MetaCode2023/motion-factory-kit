# Modules: use the whole kit, or lift one piece

This repo is built so any coding agent can read it, compare it with the pipeline it already has, and
take only what helps. Each piece below says what it does, where it lives, what it depends on, and how
to lift it out. Most are single files with no ties to the rest of the kit. MIT licensed: copy freely.

## Quick comparison checklist

Ask of your current setup, and grab the matching piece where the answer is no:

| Does your pipeline... | Piece here |
|---|---|
| Cut raw footage on word boundaries, dropping "um"s and dead air, from a transcript? | `footage.mjs` (`rangesFor`, `cut`) |
| Know which speaker is the host and which is the person interviewed? | `footage.mjs` (`transcribe` asks ElevenLabs to diarize; `A:`/`B:` in INDEX.md) |
| Clean street audio (wind, traffic, harsh "s") and level a loud host against a quiet stranger? | `tools/audio.mjs` |
| Reframe horizontal footage to 9:16 around the face, panning when the person moves? | `tools/faces.py` + `tools/reframe.mjs` |
| Put the interviewer's question, names, "7/50" counters and a poll bar on screen from data? | `kit/blocks.js` street-interview blocks + `scenes/templates/raw-edit.html` |
| Let a client approve / flag each ad and hook, then re-cut only the flagged ones? | `tools/review.mjs` + `footage.mjs feedback` / `build --redo` |
| Hand a media buyer a sheet of every file, size, hook and check status? | `tools/delivery.mjs` |
| Self-check every render (sound, captions, hook on frame 0, text under the app buttons)? | `make.mjs` report + `score.py` |
| Let an agent drive the whole thing as tools (and see the frames it made)? | `mcp/server.mjs` ([MCP.md](MCP.md)) |
| Use subtitles you already have (.srt/.vtt) or a local model instead of a paid speech-to-text key? | `tools/transcripts.mjs`, `tools/transcribe.py` |
| Check an edit plan against the footage before spending a render on it? | `tools/plans.mjs` |
| Make one ad per spreadsheet row with hook variants and every size? | `batch-ads.mjs` + any template |
| Add a chaptered progress bar, timed explainer graphics (static and animated) and an SFX stem to a finished clip? | `tools/overlay.py` + `tools/anim.py` ([OVERLAYS.md](OVERLAYS.md)) |
| Put a 3-second cold-open hook in front of a talking head? | `tools/hook_alert.py` + `overlay.py join` |

## The pieces

### Overlays on finished clips
`tools/overlay.py` (Python: pillow, numpy, fonttools, brotli; ffmpeg) adds a chaptered progress bar, explainer cards and
a quiet SFX stem from a JSON cue file, keeping the clip's audio. `tools/anim.py` has the animated cards (`split`,
`curve`, `pricedrop`, `map`): each is one function `(t, card, size, accent) -> RGBA`, so adding one is easy.
`tools/hook_alert.py` builds a 3 s alert hook from a JSON spec. The three files and `fonts/` lift out together.
See [OVERLAYS.md](OVERLAYS.md).

### MCP server and JSON output
`mcp/server.mjs` (needs `@modelcontextprotocol/sdk`): ten tools covering index → plan → build → review,
plus `render_still` / `look_at` that return pictures. It shells out to the CLIs with `--json`, so the
same results are scriptable without MCP. See [MCP.md](MCP.md).

### Transcripts without a key
`tools/transcripts.mjs` (standalone): `readSidecar(clip)` reads `clip.words.json`, `.srt` or `.vtt`;
`parseCues` / `wordsFromCues` turn any subtitles into word timings. `tools/transcribe.py`: faster-whisper
with word timestamps as JSON.

### Plan checker
`tools/plans.mjs` (standalone): `checkPlan(plan, clips)` returns errors, warnings and the estimated
length, so an agent can fix a plan before rendering.

### Word-exact cutting from a transcript
`footage.mjs` → `transcribe()`, `sentencesOf()`, `rangesFor()`, `cut()`.
Input: clips + word timings (ElevenLabs speech-to-text, or local `openai-whisper`). Output: one A-roll per
plan with fillers and pauses over 0.4 s removed, alternating punch-ins to hide jump cuts, and a
`*.words.json` of the kept words for captions. Needs: `ffmpeg-static`. The plan format is in `docs/EDITOR.md`.

### Street-audio clean-up and speaker levelling
`tools/audio.mjs` (no other kit dependencies). `cleanChain(options)` returns an ffmpeg `-af` chain
(high-pass, FFT denoise, de-ess, compressor); `loudness(file, { from, dur, chain })` measures LUFS;
`speakerGains(pieces)` gives one gain per speaker so everyone lands at the same loudness.
To lift it: copy the file, call `cleanChain` + `volume=<gain>dB` wherever you cut audio.

### Face-following reframe
`tools/faces.py` (OpenCV + the bundled YuNet model in `tools/models/`) prints a face track for any
clip ffmpeg can read. `tools/reframe.mjs` turns that track into an ffmpeg `scale,crop` filter: a fixed
crop when the face stays put, a piecewise-linear pan when it moves, and it sticks with one person when
two are in frame. Both are standalone: `python tools/faces.py <ffmpeg> clip.mp4 3` then
`cropFilter({ width, height }, { track: pickTrack(samples), a, b }).filter`.

### Street-interview overlays
`kit/blocks.js`: `B.questionCard`, `B.lowerThird`, `B.counter`, `B.tally` (plus `B.photoPanel`,
`B.memeCard`, and `B.nativeText` styles `dark` / `blue` / `shadow` for creator-native posts). They are
plain canvas-2D functions of time `(ctx, t, { at, ... })`, so they port to any canvas renderer
(node-canvas, skia-canvas, a browser). See `docs/BLOCKS.md`; `scenes/examples/street-interview.html` shows them together.

### Client review loop
`tools/review.mjs` (no other kit dependencies). `writeReview(folder)` writes one self-contained
`review.html` next to the MP4s (player, hook tabs, Approve / Needs changes, notes; saves in the browser;
exports `review.json`). `applyFeedback(folder, reviewJson)` writes `FEEDBACK.md`, copies approved files to
`approved/` and adds a `review` column to `DELIVERY.csv`. It only reads file names, so it works on any
folder of MP4s named `<ad>[-v<n>][.4x5|.1x1|.16x9].mp4`.

### Creator-native templates
`scenes/templates/rapid-list.html` (a picture over the top that swaps on every spoken item, landing on
the word), `title-explainer.html` (creator in the corner over the thing itself, title pill), and
`meme-caption.html`. Caption style `word` in `kit/motion.js` (one word as spoken, mid-frame). These need
the kit's renderer (`make.mjs`); the layouts and timings are the part worth copying.

## Rules the kit keeps (worth keeping wherever these pieces go)

- Never invent quotes, names, or poll numbers. Question cards use the words the host actually said;
  names and counts come from the shoot.
- Client footage, edit plans and spreadsheets stay out of git (`.gitignore`).
- All on-screen text is drawn in code, never baked into generated footage.

## Trying it without your footage

`npm install && npm run demo`: bundled synthetic street-poll footage (`examples/demo`) → finished ads,
`DELIVERY.csv` and `review.html` in `out/demo/`, no keys. `npm test` runs the checks (the face test
needs `pip install opencv-python-headless`). Any template builds with labelled placeholders until clips are added.
