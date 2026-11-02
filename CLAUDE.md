# Motion Factory Kit — instructions for Claude

This repo turns code into motion-graphics videos. You write a **scene** (one HTML file with a
`draw(ctx, t)` function that paints the frame at `t` seconds), and `render.mjs` steps through every
frame and encodes an MP4. No screen recording, no dropped frames, no browser needed.

## When the user asks for a video

1. **Read `design/DESIGN.md` first.** It's the house style: safe zones, hook rules, pacing, type sizes,
   motion. Follow it unless the user asks for something different.
2. **Start from the closest example** in `scenes/examples/`:
   - `showcase.html` — the default pattern: big hook headline, push cuts between beats, cards that grow
     row by row, progress bar, slow camera push-in. Copy this structure for most explainers.
   - `loan-calculator.html` — a chat/UI demo with typed messages and a counted-up result.
   - `comparison.html` — two lanes, one decision at a time.
   - `timeline.html` — a request moving through steps.
3. **Plan beats before code.** Write the script as 4–6 beats (one short headline each, ≤ 7 words),
   with cut times. 15–30 s total for vertical social video.
4. **Write the scene** to `scenes/mine/<name>.html`. Load the kit with
   `<script src="../../kit/motion.js"></script>` and call `M.setup({ width, height, fps, duration, cuts, background, draw })`.
5. **Render and look at it yourself** before handing it over:
   ```
   node render.mjs scenes/mine/<name>.html --sheet      # MP4 + a 6-frame contact sheet
   node render.mjs scenes/mine/<name>.html --still 4.2  # one PNG at t=4.2s
   python score.py out/<name>.mp4                        # frozen stretches, slow open, text in unsafe zones
   ```
   Open the `.sheet.png` (and stills just after each cut) and fix clipped text, overlaps, empty frames,
   or anything `score.py` lists under `warnings`. Iterate fast with `--from 8 --to 12`.
6. **Hand over** `out/<name>.mp4` and say what's in it in a line or two.

## Kit helpers (`kit/motion.js`, all on `M`)

| Helper | Use it for |
|---|---|
| `M.headline(ctx, t, str, x, y, { family, start, accent, accentColor, max, lines, width, align })` | Hook and beat titles. Auto-fits size; readable at frame 0 when `start` ≤ 0. Returns `{ bottom }` for layout below. |
| `M.push(ctx, t, at, drawOld, drawNew)` | Cut between beats at time `at`. Use instead of crossfades. |
| `M.stack(ctx, t, box, items, { card, pad, gap })` | A card that builds row by row and scales to fill `box`. Items are `{ at, h, draw(ctx, x, y, w, k) }`. |
| `M.progress(ctx, t, cuts, { color, track })` | Slim beat bar at the bottom. |
| `M.prog(t, start, dur, ease)` / `M.window(t, start, end)` | 0→1 progress / fade-in-hold-fade-out opacity. |
| `M.ease.outCubic / outExpo / outBack / inOutCubic` | Easing curves. `outBack` only for small things. |
| `M.text(ctx, str, x, y, { font, color, align, alpha, maxWidth })` | Plain text, with wrapping. |
| `M.type(str, p)` / `M.count(n, p, { prefix })` | Typewriter text / counting numbers. |
| `M.roundRect`, `M.wrap`, `M.fitFont`, `M.clamp`, `M.lerp` | Drawing and math basics. |
| `M.safeBox(box)` / `M.clipSafe(ctx, fn)` | Keep content out of the TikTok/Reels UI zones. |
| `M.image(src)` / `M.cover(ctx, img, x, y, w, h, { dim, zoom })` | Photos as full-bleed backgrounds. |
| `M.clip(dir, count, fps)` | A video clip as a JPG frame sequence (`dir/0001.jpg` …); draw `clip.at(t, start)` with `M.cover`. Make frames with `ffmpeg -i clip.mp4 -vf fps=15,scale=1080:-1 dir/%04d.jpg`. |
| `M.fonts([...])` | Preload every font face the scene uses. |

## Rules that will bite you

- **Fonts:** only the files in `fonts/` exist for the renderer (Plus Jakarta Sans, Barlow, Barlow Condensed,
  JetBrains Mono). Name them exactly, e.g. `"Plus Jakarta Sans"`, and list every face in `M.fonts([...])`.
  To add a font, drop fontsource-style woff2 files in `fonts/` (`<family-slug>-latin-<weight>-normal.woff2`).
- **Everything is drawn on the canvas.** HTML/CSS layout is ignored by the default engine.
  No remote `<script src>`; images load from paths relative to the scene.
- **Safe zones (1080×1920):** no words above y=220 or below y=1440, and keep hook/CTA text inside x 120–960.
- **Time is the only state.** `draw(ctx, t)` must be a pure function of `t` (no `Date.now()`, no
  `Math.random()` without a seed) so any frame renders the same every time.
- **Words live in code**, never baked into generated images.

## Sound

- `node voice.mjs "script" --out out/voice.mp3` makes narration if `ELEVENLABS_API_KEY` is set.
- `node render.mjs scene.html --audio out/voice.mp3` muxes any audio file (voice, music) into the MP4.
- Mixing several tracks: use the ffmpeg that ships in `node_modules/ffmpeg-static` (`amix` filter).
