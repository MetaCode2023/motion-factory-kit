# House design guide

Claude reads this before writing any scene. Each rule names its evidence in brackets: [research] is a
research pass on short-form video craft, [review] is a critique of rendered videos, [blind judge] is an
A/B comparison of two renders. Edit it as you learn what works for your audience; keep it short enough to follow.

## Frame and safe zones
- Hook text and the closing line sit inside x 120–960, y 240–1260. Below y=840, stay left of x=780.
  The TikTok caption and action rail cover the rest for many viewers. [research: TikTok overlay files via adkit.so]
- Nothing readable above y=220 or below y=1440. Decoration may go there; words may not. Draw the beat progress
  bar with `M.progress(ctx, t, CUTS, { color, track })`, never a hand-drawn bar: it is slim and half-strength,
  so it doesn't read as content under the caption. [research; cycle-4 bench: hand-drawn 10px bars at y=1838 put
  every fresh video over the bottom-caption check (0.10) with no words there]
- Use `M.safeBox` to constrain content and `M.clipSafe` for bounded drawings; `M.stack` now clips its
  own box and scales down when needed. Readability still requires review: clipping prevents overflow,
  it does not prove that all words are visible. Text-only masks exclude photos and card borders; a
  brief violation is reported with its timestamp. [code review and render regression 2026-10-16]
- Use the frame. Scale cards and phones up so the content spans the safe box. A card in the top
  third of an empty frame looks unfinished. [review 2026-10-15: beats 1-2 used the top 40%; score.py median fill ≈ 0.5]
- No empty cards. A card whose rows arrive one by one must not be drawn at its final size first: build it
  with `M.stack(ctx, t, box, items, { card, pad })` (box = the space under the beat headline, x 70, width 900,
  down to y≈1380; each item is { at, h, draw }). The card grows to hug the rows that have arrived, and a sparse
  beat is scaled up (to 1.5×) so its first row reads big. The kit clips the box to the safe area. The same goes
  for lists of chips or steps without a card. [blind judge, night bench 3: "small text in cards that leave large
  empty areas"; night bench 4: M.stack scenes won all 4 topics in both orders for "large, phone-readable type"]

## Hook: the first 3 seconds
- Frame 0 already shows the problem: the 11:04 PM notification landing, the number that's wrong,
  the message that just arrived. No logo sting, fade from black or empty title card. [research: TikTok "first 3 seconds"; practitioner consensus]
- Frame 0 is the thumbnail: the hook headline is already on screen at full opacity at t=0, set big
  (110–140px, 2–3 lines, top edge at y≈260) with the problem's artifact right under it. Draw it with
  `M.headline(ctx, t, str, 120, 260, { family, accent })` and start 0: the lines rise into place and the
  accent underline sweeps in, so the open moves without ever fading in from nothing. Never fade or type the
  hook headline in from 0. [review 2026-10-15-overnight: base fresh/04 faded its question in at 0.35 s, so its
  first sheet frame showed only small code; most blind-judge verdicts on both night benches named a big, high hook headline as the decisive difference]
- Something visibly changes before 1.0 s. score.py flags a slow open. [research]
- The brand goes on the end card, in the last 2–3 s. [research]

## Pacing and text
- At most 7 words per text block and at most 2 lines. Hold each block for 0.3 s plus about 0.33 s per word
  (roughly 3 words a second). [research: BBC/Netflix reading speeds]
- Something changes every 1.5–3 s, which works out to about 8–12 visual beats in 25 s. score.py flags anything frozen longer than 3 s. [research]
- Sizes: headline 96–140px, body 56–72px, UI labels 36px or more. Use weights 600–800, and no thin weights under 72px.
  Upload compression softens small text. [research; review 2026-10-15: card labels around 26px were hard to read on a phone]
- Highlight one keyword per screen with a single accent: a pill, or an underline that sweeps in. [research]

## Motion craft
- Ease out on entrances (M.ease.outExpo or outCubic, 0.4–0.5 s). Exits run about half as long. Use linear only for slow constant drift. [research: Material 3 emphasized easing]
- Stagger related items 40–80 ms apart. The primary element moves first and secondary elements follow. Never bring everything in at once. [research]
- Overshoot (outBack) only on small things such as badges, toasts and checkmarks. Cards and panels settle without bouncing. [research]
- No frame is static: give the whole scene a slow camera push-in (2–5% scale per beat) or a parallax drift
  (background at 0.3–0.6× the foreground's speed). [research]
- Between beats, prefer a match move to a crossfade: zoom into the card that becomes the next beat, or
  cut with `M.push(ctx, t, at, drawOld, drawNew)` (0.4 s; the old beat clears before the new one rises in).
  Keep every transition under 0.5 s. The contact sheet and the scroll both sample frames at random, and a
  crossfade caught halfway reads as a washed-out, empty frame. [research; review 2026-10-15 frame 6; blind judge, night benches 1–2: "washed-out transition frame", "nearly empty transition frames"]
- Declare every cut in `M.setup({ cuts: [...] })`, and check a `--still` just after each cut, not only the
  contact sheet. `M.push` draws one opaque beat at a time.
  [2026-10-16 home-services overlap; frame-by-frame helper regression]
- Beat titles use `M.headline` too (max 72–96, lines: 1, start: the beat's start), so they fit the width at the largest size instead of a fixed small one.
- Show interaction: a tap ripple, a cursor, a key typed. Proof beats claims. [review]

## Your own visuals (assets/)
- Put photos and clips you made (ChatGPT, Midjourney, Veo, your phone) in `assets/`. Look at each one before writing the scene.
- A setting photo makes a strong background: `M.cover(ctx, img, 0, 0, 1080, 1920, { dim: 0.55, zoom: 1 + 0.05 * p })`,
  with the UI cards on top. Dim it enough that body text keeps 4.5:1 contrast.
- A clip of the problem makes the best cold open: `M.cover(ctx, clip.at(t), ...)` for the first 2–4 s, then cut or
  zoom into the UI. Clips run at 15 fps. Keep them full-frame and darkened, not small.
- All words stay in code. Never rely on text inside an image, and never present a generated person as a real customer.
- Don't force it: an asset that doesn't match the topic or the look makes the video worse. Skip it.

## Colour and depth
- One accent colour plus neutrals. Avoid pure #000 and #FFF: use near-black (#0B0D12) and off-white (#F5F7FA). [research]
- Contrast: 4.5:1 for body text, 7:1 or more for the hook line, because glare and compression cost contrast. [research: WCAG + compression]
- Add depth: soft shadows under cards, a radial gradient or vignette instead of a flat fill, and optionally grain at 2–4% opacity
  to stop gradient banding after compression. [research]

## Story
- Choose a composition for the story: interaction, comparison, timeline, object, or result. Start from
  the closest file in scenes/examples/; keep photos where they fit the topic.
  These references are curated patterns, not proven audience winners. [code review 2026-10-16]
- Show, don't tell: a message arriving, a number changing, a check landing. Use illustrative names and label them as examples.
- Every claim must come from the topic or its source material. A recap of a post uses the post's own argument and examples. [review 2026-10-15: blog video held back without the post]
- The end card gives the takeaway in 3–4 words, plus the URL. The URL stays inside the safe box.

## Sound
- TikTok is sound-on, X is muted: a quiet music bed and a few effects on TikTok, and the picture alone still tells the whole story.
- Effects mark beats, not elements: one per beat at most. The hook lands on `hit`, the failure on `error`, the payoff on `chime` or `stamp`.
- Narrate arguments and stories; leave UI demos and code to the bed and effects. One sentence per beat, starting by 0.5 s, saying what the screen says in spoken words.

## UGC ads (creator footage + overlays)
- It should look like a post, not an ad: TikTok-native text (`B.nativeText`), a comment sticker
  (`B.commentReply`), real-feeling handheld footage. Polished brand graphics belong at the end only.
- The face carries the video. Don't cover it: overlays go in the top quarter and lower third; the
  middle band stays clear while the creator talks.
- Hook in the first second, on screen at frame 0. Test 2–3 hooks with `M.pick` before anything else;
  the hook moves results more than any other change.
- Cut to B-roll or a product shot every 3–5 s, then back to the face. Keep the voice running over the cut.
- Captions always on (`captions: true`), highlighted word in the accent colour. Most viewers start muted.
- Music low (0.10–0.15) under speech; one effect per beat.
- Show the product by second 6–8, price or offer once, CTA in the last 3 s.
- Don't present AI-generated people as real customers, and only show reviews you can back up.
