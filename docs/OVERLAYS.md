# Overlays: a progress bar, explainer graphics and a hook on a clip you already have

For finished clips such as a talking head, a podcast cut, a whiteboard lesson or a series episode. The kit keeps the
clip's picture and voice and adds:

- **A chaptered progress bar**: one segment per chapter, with the chapter name, a playhead and elapsed/total time ("0:58 / 1:33").
- **Explainer cards**, timed to the words. Four are static (`stat`, `list`, `compare`, `term`) and four are animated:
  - `split`: an estate splits into basis and gains, the tax slice lifts off, and the heirs' share counts up.
  - `curve`: a ball stuck on a local peak rolls across to the global peak.
  - `pricedrop`: cost bars fall to ~$0 beside an anchor such as "Music file".
  - `map`: a tile-grid US map lights up while a number counts.
- **A quiet SFX stem**: a whoosh on each card and pops, dings and swishes on each animation's beats, about 14 dB under the voice.
- **An optional 3-second alert hook** (`tools/hook_alert.py`) in front.

```bash
npm install
pip install -r tools/requirements-overlays.txt              # faster-whisper is only for transcribe
npm run overlays-demo                                        # stand-in clip -> out/overlay-demo/demo.final.mp4
```

## The workflow (CLI or MCP tools)

| Step | CLI | MCP tool |
|---|---|---|
| 1. Put the clip in the kit | `footage/clips/<name>.mp4` (git-ignored) | |
| 2. Get the words with timings | `python tools/overlay.py transcribe footage/clips/x.mp4` | `overlay_transcribe` |
| 3. Look at the layout | stills with ffmpeg | `look_at` on a still |
| 4. Write the cues | write `footage/clips/x.cues.json` | `overlay_write_cues` (checks it first) |
| 5. Render and check | `python tools/overlay.py render footage/clips/x.mp4 --sfx --sheet` | `overlay_render` (returns the contact sheet) |
| 6. Optional hook | `python tools/hook_alert.py spec.json out/hooks/x` | `hook_alert` |
| 7. Join | `python tools/overlay.py join out/hooks/x/hook.mp4 out/overlays/x.overlay.mp4 out/x.final.mp4` | `overlay_join` |

**No transcript?** If the clip has burned-in captions or the key words are on a whiteboard, read frames instead.
Tile the caption strip at 4 fps with a timestamp on each tile, and crop the whiteboard. That gives exact words and
the figures the speaker wrote down.

## Writing good cues (instructions for the agent)

1. **Find the empty area before placing anything.** Look at one frame. If the clip already has a title, a framed
   video window and captions, put the cards in the empty space (for example `"position": 0.76` under the captions)
   and lower `card_scale` to fit. Put the bar where a player's scrubber would be (`--bar-y 0.63` at the bottom
   edge of a framed window), or lift it above burned-in captions or the app's caption area (`0.78`).
2. **Match the series.** Sample the clip's brand colour and set `"accent"` to it. The default is `brand.js`.
3. **Explain, don't repeat.** A card earns its place when it adds the number, the definition, the steps or the
   contrast. It shouldn't just repeat the sentence on screen. Good triggers:
   - a number said out loud → `stat` or `split`
   - a sequence → `list`
   - "X vs Y" → `compare` or `curve`
   - a term most viewers wouldn't know → `term`
   - "costs fall" → `pricedrop`
   - land or places → `map`
4. **Time to the words.** Start a card about 0.3 s after the speaker begins the idea. Keep each card on screen
   for 3.5–6 s. Cards never overlap, and there should be at least 1 s between them. `split` takes `t_split`,
   `t_tax` and `t_keep`, so each beat lands on its word (e.g. the tax slice on "flat 10%").
5. **Keep text short.** At most 7 words a line, list items of 6 words or fewer, and a kicker of 1–2 words.
6. **Don't invent facts.** Use figures the speaker says or writes. Background you add, like a definition or an
   official figure, must be uncontroversial, and you should name it in your handover so a human checks it.
7. **Chapters:** 2–4 chapters at the topic shifts, with 1–3 word labels. The first starts at 0.
8. **Check before handing over.** Read the contact sheet (one still per card). Look for clipped text, cards
   covering the speaker's face or captions, and cards that land early or late. Then re-render.

## The hook (`hook_alert`)

The hook is a 3-second cold open in this order:
1. The headline is on screen at frame 0.
2. A heart monitor beats, then flatlines.
3. An alert panel slams in with a detected value and two rows, then counts up a total.
4. A stamp lands, then a punchline bar.
5. Hard cut to the speaker.

Write it as "something just happened → a system reacted", using the clip's own figures. Then start the clip on the
line that continues it. Use `render --start` to cut a weak opener such as "So we went over…". Every field is in
`examples/overlays/hook.json`. A hook that promises more than the clip delivers loses viewers, so frame claims as
the speaker's plan, not as fact.

## Cue file reference

```jsonc
{
  "accent": "#00D7FE", "position": 0.76, "card_scale": 0.78,
  "bar_hide": [[32.8, 40.0]],          // hide the progress bar while a full-frame insert plays
  "chapters": [{ "at": 0, "label": "1 · The tax" }, { "at": 22, "label": "2 · Deflation" }],
  "cards": [
    { "at": 0.6, "dur": 4.6, "kind": "list", "kicker": "The plan", "title": "3 steps", "items": ["...", "...", "..."] },
    { "at": 8.6, "dur": 7.6, "kind": "split", "kicker": "His example", "total": 1000, "basis": 100, "rate": 0.10,
      "t_split": 0.4, "t_tax": 1.4, "t_keep": 5.6 },                       // $ in millions
    { "at": 22.2, "dur": 4.6, "kind": "term", "kicker": "Definition", "title": "Kardashev scale", "body": "..." },
    { "at": 32.6, "dur": 5.0, "kind": "curve", "kicker": "Local vs global", "left": "LOCAL MAX", "right": "GLOBAL MAX" },
    { "at": 40.2, "dur": 6.0, "kind": "pricedrop", "anchor": "Music file", "items": ["Energy", "Housing", "Food"] },
    { "at": 52.4, "dur": 3.9, "kind": "stat", "kicker": "The model", "value": "~$0", "body": "..." },
    { "at": 57.4, "dur": 6.0, "kind": "map", "highlight": ["NV", "UT", "AZ"], "value": "245M", "unit": "acres", "label": "..." },
    { "at": 64.0, "dur": 4.5, "kind": "compare", "left": ["Today", "...", "..."], "right": ["After", "...", "..."] }
  ]
}
```

The renderer is `tools/overlay.py`, and the animated cards are in `tools/anim.py`. Each animated kind is one
function `(t, card, size, accent) -> RGBA image`. Its SFX beats are listed in `BEATS`, so a new kind is one
function plus one line.

## Reel-safe layout

Instagram and TikTok draw their own buttons and caption over the video. On a 1080x1920 frame keep overlays out of:
the top 240 px (header), the bottom 300 px (username and caption), the right 175 px below y=1040 (like/comment/share),
and the outer 51 px on each side (cropped on tall phones). Cue-file settings for that:

- `"position": 0.13`: cards start just under the header instead of at the bottom.
- `"card_scale": 0.65` and `"anim_scale": 0.78`: shrink static and animated cards to fit the band above the subject.
- `"bar_margin": [90, 200]`: left/right margins of the progress bar, so the time label clears the like button.
