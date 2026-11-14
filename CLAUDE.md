# Motion Factory Kit — instructions for Claude

This repo turns code into finished short-form videos. You write a **scene** (one HTML file with a
`draw(ctx, t)` function that paints the frame at `t` seconds), and `make.mjs` renders it frame-exact,
adds narration, captions, music and sound effects, and writes a postable MP4. It's built for
**UGC-style ads around Higgsfield clips** and for **motion-graphics explainers**.

## When the user asks for a video

1. **Figure out the type.**
   - *UGC ad / creator video / Higgsfield clips* → start from `scenes/examples/ugc-ad.html` and read `docs/HIGGSFIELD.md`.
   - *Explainer / motion graphics / no footage* → start from `scenes/examples/showreel.html` (high-end look) or `showcase.html` (simpler).
   - *A folder of raw client footage → many ads* → the **editor** (`docs/EDITOR.md`, below).
   - *Many ads from a list/spreadsheet* → a template + `batch-ads.mjs` (below).
   - *A long-form YouTube video (16:9, 5-20 min): "a 10-minute video on the physics of poker", a script to
     record, a recording to finish, or podcasts to mine* → the **long-form editor** (`docs/LONGFORM.md`, below).
   - *A finished clip that needs a progress bar, explainer graphics or a hook* (talking head, podcast cut,
     whiteboard lesson, a series episode) → **overlays** (`docs/OVERLAYS.md`, below).
   - *A proven ad format* (3 reasons, us vs them, before/after, testimonials, problem/solution, listicle,
     unboxing, green screen) → copy the matching file in `scenes/templates/` (`docs/TEMPLATES.md`).
   - *Creator-native organic posts* (a spoken list over pictures, an idea explained over the thing itself,
     a meme line over a clip) → `rapid-list`, `title-explainer`, `meme-caption`: plain look, one-word captions,
     title pill, quiet music, no effects.
   - Read `design/DESIGN.md` either way. Check `brand.js`; if it still says "Your Brand", ask once for name, colours and URL, or carry on with the defaults and say so.
2. **Plan beats before code.** 4–6 beats, one short line each (≤ 7 words on screen), cut times,
   15–30 s total. For ads: hook (0–3 s), problem, show it, proof, CTA. Write 2–3 hook options with
   `M.pick([...])` unless the user wants one.
3. **Write the scene** to `scenes/mine/<name>.html` with the four script tags (brand, motion, blocks, your code).
   Use **blocks** (`docs/BLOCKS.md`) instead of hand-drawing common pieces.
4. **Build it:** `node make.mjs scenes/mine/<name>.html` → `out/<name>.mp4`.
   With hook variants: add `--variants`. Other sizes: add `--formats 4:5,1:1,16:9` (feed, square, YouTube)
   when the user wants them. Drafts: `--fast` skips the picture score.
5. **Check it yourself before handing over.** Every build writes `out/<name>.report.md` (PASS/FIX for sound,
   captions, footage, the hook at frame 0, text under the app buttons, frozen stretches) and
   `out/<name>.cuts.png` (frame 0, a still just after every cut, the end). **Read the report and look at the
   cuts image**, fix every FIX you can, rebuild. 2–3 passes is normal. A FIX you can't fix (missing footage,
   no API key) goes in your handover.
6. **Hand over** the MP4 path(s) with one or two lines on what's in it and anything the user must
   supply (e.g. "drop your clip at assets/higgsfield/talking-head.mp4 and re-run").

## Make it look expensive (`kit/fx.js`, all on `FX`)

Default to this for explainers and motion graphics; flat backgrounds look cheap.
- Depth: `FX.aurora` (animated colour fields), `FX.particles`, `FX.grid`, `FX.vignette`, `FX.lightLeak`.
- Materials: `FX.glass(ctx, x, y, w, h)` (frosted card over what's behind it), `FX.glow(ctx, draw)`, `FX.gradientText`.
- Kinetic type: `FX.text(ctx, t, str, x, y, { at, mode: 'rise' | 'mask' | 'chars' | 'scramble' | 'pop', accent, font })`.
- Camera: `const end = FX.camera(ctx, t, { punch: [cut times], shake: 0.15 }); ...; end();`
- Transitions: `FX.timeline(ctx, t, [{ at, draw: (c) => beat(c, t), transition: 'zoom' | 'whip' | 'circle' | 'wipe' | 'glitch' | 'flash' | 'blur' }])`.
  Beat functions must draw on the context they're given (`c`), not a global.
- Finish: `M.setup({ look: 'cinematic' | 'punchy' | 'film', motionBlur: { samples: 6, around: true } })` — colour grade,
  film grain, and motion blur on the cuts.
- Glass is the most expensive effect (it blurs what's behind it); use a few cards, not dozens.

## Raw footage → finished ads (`footage.mjs`, details in `docs/EDITOR.md`)

If the `motion-factory` MCP tools are connected (`.mcp.json`; `docs/MCP.md`), use them for these steps:
`footage_index`, `footage_check_plan` before every `footage_write_plan`, `footage_build`, `look_at` the cut
stills, `review_feedback`. Without them, the commands below do the same (add `--json` for a machine-readable
last line). New to the editor? `npm run demo` runs it end to end on `examples/demo`.
Transcripts come from, in order: a `<clip>.words.json` / `.srt` / `.vtt` next to the clip, `ELEVENLABS_API_KEY`
(with speakers), local faster-whisper (`pip install faster-whisper`), the openai-whisper CLI.

1. Footage goes in `footage/raw/`. Run `node footage.mjs index` → `footage/INDEX.md` (clip IDs, numbered
   sentences with timings, `(um)` fillers) and `footage/thumbs/<ID>.jpg`.
2. **You are the editor.** Read INDEX.md and look at the thumbnail images. Pick the strongest hooks and the
   cleanest, most convincing takes; vary angles across ads (results, price, social proof, objections, curiosity).
   Write one plan per ad to `edits/<name>.json` (format in docs/EDITOR.md). Keep ads 12–25 s; open on the strongest line.
   - Horizontal clips follow the face automatically (index says "auto-reframe"); set `focus` only to fix a bad crop,
     `face: 'left' | 'right'` when two people are in frame and it picks the wrong one.
   - Street audio is cleaned and speakers levelled by default; `audio: { denoise: 'strong', wind: true }` for rough clips.
   - **Street interviews:** `A:`/`B:` in the index mark speakers (A is usually the host). Put the host's question in
     its own segment with `question: true` (the card shows their real words), `person: { name, detail }` only when the
     person gave it, `street: { total: 50 }` for "n/50" chips, `tally` only with real counts. Vary which respondents
     open each ad; a strong reaction beats a long answer.
3. `node footage.mjs cut edits/<one>.json` to sanity-check a plan, then
   `node footage.mjs build edits/ --variants --formats 4:5,16:9 --batch <client>`.
4. Read `out/<batch>/DELIVERY.md` and the reports; fix plans with FIXes and rebuild those (`--only a,b`).
5. **Review loop:** the build writes `out/<batch>/review.html` for the client. When feedback comes back:
   `node footage.mjs feedback out/<batch>/review.json`, read `FEEDBACK.md`, edit only the flagged plans to do what
   the notes ask, then `node footage.mjs build edits/ --redo out/<batch>/review.json --batch <batch>`. If a note asks
   for something the footage can't give (a line nobody said), say so instead of faking it.
Never commit client footage or plans (they're git-ignored); never invent quotes the people didn't say.

## Long-form YouTube (`longform.mjs`, details in `docs/LONGFORM.md`)

You are the writer's room, the editor and the motion designer. The creator brings a subject and their voice;
the goal is a 10-minute video they can post without touching it.

**Script first (new recordings), the default.** MCP: `longform_script`, `longform_from_script`, `longform_stock`, `longform_pull`.
1. **Ask what the video is about** if they haven't said, and the angle (e.g. "why people love poker, as a Trojan
   horse for quantum mechanics"). Then research it (web search): the real numbers, the clearest analogies, and
   2-5 specific outside clips that prove a point (exact URL + timestamps).
2. **Outline, then draft the script** in `scripts/<name>.script.md` (git-ignored; format in docs/LONGFORM.md).
   Hook in the first 10 s, 4-6 chapters (`##`), ~1,400-1,600 words for 10 min, written to be said out loud.
   **Put a visual cue every ~15 s** (every ~35-40 words): animations for ideas (`stat`, `term`, `compare`,
   `steps`, `bars`, `quote`, `line`, `share`, `flow`, `timeline`, `story`, `count`, or a new scene that declares its own `sfx`), `stock` for scenes, `clip` for outside proof, `[[face]]` when the
   speaker should be seen. 3D scenes (`scenes/longform/3d/`: `table3d`, `stacks3d`, `globe3d`; three.js via `kit3d.js`, checked with
   `node tools/longform/render3d.mjs <scene> --still t`) for objects and places with depth. **Show, don't write**: prefer `story` (drawn objects on their words, `scenes/longform/props-gallery.html`) and
   `count` over text cards; at most ~1 in 4 visuals should be mostly words. Label items with the words the script
   says, so they land on them. Vary them; never two of the same template in a row. Figures only from your research,
   with `source:`. Run `node longform.mjs script` and fix every error and cadence warning.
3. **Revise with the creator** until they approve. Then they record from the `.read.txt` (re-reading a flubbed
   line is fine). New animations the script needs: write them now while they record (copy the closest
   `scenes/longform/*.html`; `preset: 'youtube'`, all text from `M.data`; check stills). Several new scenes are
   independent, so write them in parallel with subagents if you can.
4. **Recording in** (`footage/` or wherever they put it): `node longform.mjs from-script <script> <recording>`.
   Read the alignment report: lines not found and ad-libs are your call (drop with `tighten.drop`/`cut`).
   `stock` (PEXELS_API_KEY) and `pull` (yt-dlp, clips with a url) fill placeholders, then `build`.
   Give each video a look: `theme: blueprint | noir | sunset | paper | terminal` in the script header (default `aurora`).
5. **Check like a viewer**: REPORT.md, the inserts sheet, and stills at a few gaps. Fix and rebuild (cached).
   Hand over the MP4 to review, the YouTube title + description (hook, CHAPTERS.txt, sources, credits from
   `assets/broll/CREDITS.md`), and anything still to pull. The `.premiere.xml` is there if they want to tweak.

6. **Around the video.** New machine: `node longform.mjs doctor`. The build writes `review.html`; when the
   creator sends back `<name>.review.json`, run `node longform.mjs feedback <file>`, read `FEEDBACK.md`, change
   only what the notes ask for, rebuild. `thumbnail <plan>` (set `"thumbnail": { text, accent, prop }`: 2-4 words)
   and `shorts <plan>` (set `"shorts": [{ from, to, title }]` to the stretches that stand alone) finish the package.

**From existing footage** (podcast archives). MCP: `longform_index`, `longform_search`, `longform_words`, `longform_write_plan`, `longform_build`.
`node longform.mjs index` (footage in `footage/library/`), `search` several phrasings of every beat, pick the
clearest take, and write a plan (`edits/longform/<name>.json`): `a_roll` in story order across clips,
`tighten.cut` for false starts, inserts anchored to words, chapters, music. Never stitch words into a sentence
they didn't say; if a beat isn't covered, give them the lines to record.

Scripts, footage, plans and `assets/broll/` stay out of git. Outside clips: short, talked over, credited;
the creator decides what to use.

## Finished clip → progress bar, explainer graphics, hook (`tools/overlay.py`, details in `docs/OVERLAYS.md`)

MCP tools: `overlay_transcribe` → `overlay_write_cues` → `overlay_render` (returns the contact sheet; look at it)
→ optional `hook_alert` + `overlay_join`. The clip goes in `footage/clips/` (git-ignored).
1. Look at a frame first. Put cards in the empty area (`position`, `card_scale`) and the bar where a scrubber
   belongs (`bar_y`). Set `accent` to the series' own colour.
2. Cards explain: the number, the steps, the contrast, the definition. Animated kinds (`split`, `curve`, `pricedrop`,
   `map`) beat static text when the idea moves. Time each card about 0.3 s after its words, 3.5-6 s, no overlaps.
3. Only figures the speaker says or writes. Name any background fact you added in the handover.
4. Hooks: 3 s, headline on screen at frame 0, the clip's own numbers. Start the clip on the line that continues
   the hook (`--start` cuts a weak opener).

## Templates (`scenes/templates/`, see `docs/TEMPLATES.md`)

`three-reasons`, `us-vs-them`, `before-after`, `testimonial-stack`, `problem-solution`, `listicle`, `unboxing`,
`green-screen`, `raw-edit`, `rapid-list`, `title-explainer`, `meme-caption`. Each reads its content from `M.data({...})` (keys listed at the top of the file), so it
works for one ad (`node make.mjs scenes/templates/x.html`) or a spreadsheet of them. Shared pieces live in
`kit/ad.js` (`AD.hook`, `AD.number`, `AD.cta`, `AD.background`, `AD.voice`, `AD.sfx`, `AD.post`).

## Captions, emoji, green screen

- Caption look: `brand.js` → `captions: { style: 'pill' | 'bold' | 'box' | 'minimal' | 'karaoke' | 'pop' | 'word', emoji: { money: '💰' } }`,
  or per scene `M.setup({ captions: { style: 'bold' } })`. `bold`/`pop` suit UGC ads; `pill`/`minimal` suit explainers;
  `word` (one word as spoken, small, mid-frame with `position: 0.5`) is the creator-native organic look.
- Titles: `B.nativeText(..., { style: 'dark' | 'blue' })` = the Reels title pill; `'shadow'` = meme caption over footage.
- Emoji are images (`assets/emoji`, Twemoji): `B.sticker(ctx, t, { emoji: '🔥', at, x, y })`, `B.emojiBurst(...)`.
  Never type emoji into text; the fonts can't draw them. Unbundled emoji are skipped with a warning.
- Green screen: `M.video(path, { key: 'green' | 'blue' | '#hex' })` cuts the background out; draw the clip over a
  `B.postCard`, `B.browser` or image. Template: `scenes/templates/green-screen.html`.

## Timing from the music and the voice

`make.mjs` hands the scene the music's beats and the narration's real timings before it runs:
`M.snap(t, every)` moves a time onto the nearest beat (use it for cuts), `M.onBeat(t)` is a 0→1 pulse on each beat,
`M.beats` / `M.bpm`, and `M.cues(VOICE)` gives each narration line's real `{ start, end }` (estimated in preview).
Prefer voice-first timing for narrated pieces: cuts at `CUES[i].start`, duration `CUES[last].end + 1.5`.

## What a build hands over

`out/<name>.mp4` (+ `-v2`, `.4x5`...), `.cover.jpg` (the frame at `M.setup({ cover })`, default 0.7 s), `.srt`
(subtitles for YouTube/accessibility), `.post.txt` (from `M.setup({ post: { caption, hashtags } })`), `.report.md`, `.cuts.png`.
Write a real post caption: the hook, one line of value, the CTA, 3-5 relevant hashtags.

## Spreadsheet batches (`batch-ads.mjs`)

`node batch-ads.mjs scenes/templates/<template>.html data/<sheet>.csv --variants --batch <name>`: one ad per row.
Columns = the template's `M.data` keys (`product.name`, `hook1..hook3`, lists as `a | b | c`). Each template
documents its keys at the top. Output: `out/<name>/` + `DELIVERY.csv`. To make a sheet, write the CSV yourself.

## Higgsfield / video clips

```js
const creator = M.video('../../assets/higgsfield/talking-head.mp4', { at: 0, captions: true });
const broll   = M.video('../../assets/higgsfield/product.mp4', { at: 6, audio: false });
// in draw(ctx, t):
creator.draw(ctx, t, 0, 0, 1080, 1920, { zoom: 1.03 });   // cover-fit; any size or fps
```

- Options: `at` (start in the video), `trim` (skip into the file), `speed`, `audio` (mix its sound),
  `volume`, `captions` (transcribe its speech into captions), `speech` (duck music under it; default = captions),
  `loop`, `transcript` (estimated captions without an API key).
- Missing files render as labelled placeholders, so you can build before the footage exists.
- If the **Higgsfield tools** are connected (mcp `higgsfield`), you can generate clips yourself: use the
  prompt starters in `docs/HIGGSFIELD.md` (9:16, no text in the video, clear top and lower third),
  **show the user the prompts and get a yes before spending credits**, then download the result into
  `assets/higgsfield/`.
- Never put words inside generated footage; all text goes on in code.

## Sound (declared in `M.setup`, built by `make.mjs`)

```js
M.setup({ ...,
  captions: true,                                       // word-by-word captions; keep content above y≈1250
  music: { track: 'pulse', volume: 0.2 },                // sounds/music: pulse, calm, drive (or your own file)
  sfx: [{ at: 0, name: 'hit' }, { at: 4.6, name: 'whoosh', volume: 0.45 }],
  voice: [{ at: 0.3, text: 'One sentence per beat.' }],  // ElevenLabs narration (or file: 'x.mp3')
});
```

- Effects in `sounds/sfx/`: `whoosh tap tick pop hit chime success error type notify riser coin`.
  One effect per beat at most: `hit` on the hook, `whoosh` on cuts, `success`/`chime` on the payoff,
  `pop` on badges, `notify` with `B.notification`, `type` with typed text, `coin` on prices.
- Narration needs `ELEVENLABS_API_KEY` (voice: `ELEVENLABS_VOICE_ID` or `--voice <id>`). Without it the video
  still gets music + effects, and captions use estimated timing. Run `node make.mjs <scene> --voice-only`
  to get each line's real start/end, then set cut times to match.
- Music ducks automatically under narration and under clips with `speech`. Output is loudness-normalized (−14 LUFS).
- In UGC ads keep music low (0.10–0.15): the creator's voice is the point.

## Blocks (`kit/blocks.js`, all on `B`; details in `docs/BLOCKS.md`)

UGC: `nativeText`, `commentReply`, `productCard`, `review`, `stars`, `ctaButton`, `tap`, `split`, `pip`,
`sticker`, `emojiBurst`, `postCard`, `browser`.
Street interviews: `questionCard`, `lowerThird`, `counter`, `tally`. Creator formats: `photoPanel`, `memeCard`.
Explainer: `notification`, `chat`, `checklist`, `stat`, `compare`, `steps`, `bars`, `phone`, `toast`, `endCard`.
All take `(ctx, t, { at, ... })`; colours and fonts come from `brand.js` (`B.brand`).

## Kit helpers (`kit/motion.js`, all on `M`)

| Helper | Use it for |
|---|---|
| `M.headline(ctx, t, str, x, y, { family, start, accent, accentColor, max, lines, width, align })` | Big auto-fitting titles; readable at frame 0 when `start` ≤ 0. Returns `{ bottom }`. |
| `M.push(ctx, t, at, drawOld, drawNew)` | Cut between beats (never crossfade). |
| `M.stack(ctx, t, box, items, { card, pad, gap })` | A card that builds row by row and fills `box`. |
| `M.progress(ctx, t, cuts, { color, track })` | Slim beat bar. |
| `M.prog`, `M.window`, `M.ease.*`, `M.clamp`, `M.lerp` | Timing and easing. |
| `M.text`, `M.wrap`, `M.fitFont`, `M.type`, `M.count`, `M.roundRect` | Text and drawing basics. |
| `M.image(src)`, `M.cover(ctx, img, x, y, w, h, { dim, zoom })`, `M.video(...)` | Pictures and footage. |
| `M.pick([...])` | Variants (hooks, CTAs); `make.mjs --variants` renders each. Call at the top level. |
| `M.safeBox`, `M.clipSafe` | Keep words out of the TikTok/Reels UI zones. |
| `M.fonts([...])` | Preload fonts the scene uses directly (blocks preload their own). |

## Rules that will bite you

- **Fonts:** only files in `fonts/` exist (Plus Jakarta Sans, Barlow, Barlow Condensed, JetBrains Mono).
- **Everything is drawn on the canvas.** HTML/CSS layout is ignored; no remote scripts; paths are relative to the scene file.
- **Safe zones (1080×1920):** no words above y=220 or below y=1440; with `captions: true`, keep content above y≈1250.
- **Other platforms:** for a natively designed non-vertical video use `M.setup({ preset: 'youtube' | 'feed' | 'square' })`
  (sets size and safe zone, `M.safe`); blocks default to vertical positions, so pass `x`/`y` explicitly there.
  For most requests, design vertical and export other sizes with `--formats` instead.
- **Time is the only state.** `draw(ctx, t)` must depend only on `t` (no `Date.now()`, no unseeded random).
- **Honesty:** label example reviews as examples; don't present AI-generated people as real customers.

## Other commands

```
node render.mjs <scene> --still 4.2            # one PNG at a time (quick look, no sound)
node render.mjs <scene> --from 8 --to 12       # silent render of one section
node batch.mjs scenes/mine --sheet             # silent renders of a folder
node voice.mjs "text" --out out/voice.mp3      # a single narration file
node tools/make-sounds.mjs                     # regenerate the bundled sound library
```
