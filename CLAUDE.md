# Motion Factory Kit — instructions for Claude

This repo turns code into finished short-form videos. You write a **scene** (one HTML file with a
`draw(ctx, t)` function that paints the frame at `t` seconds), and `make.mjs` renders it frame-exact,
adds narration, captions, music and sound effects, and writes a postable MP4. It's built for
**UGC-style ads around Higgsfield clips** and for **motion-graphics explainers**.

## When the user asks for a video

1. **Figure out the type.**
   - *UGC ad / creator video / Higgsfield clips* → start from `scenes/examples/ugc-ad.html` and read `docs/HIGGSFIELD.md`.
   - *Explainer / motion graphics / no footage* → start from `scenes/examples/showcase.html`.
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

UGC: `nativeText`, `commentReply`, `productCard`, `review`, `stars`, `ctaButton`, `tap`, `split`, `pip`.
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
