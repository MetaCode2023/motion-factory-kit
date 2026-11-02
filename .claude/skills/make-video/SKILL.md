---
name: make-video
description: Make a motion-graphics explainer video (vertical 9:16 by default) as a code-drawn scene and render it to MP4 with this repo. Use when the user asks for a video, reel, short, TikTok, animated explainer or motion graphic.
---

# Make a video

Follow `CLAUDE.md` in the repo root. In short:

1. Ask at most one question if the topic is unclear; otherwise start. Defaults: 1080×1920, 30 fps, 18–25 s, dark background, one accent colour.
2. Read `design/DESIGN.md`, then open `scenes/examples/showcase.html` (and the closest other example) as the starting pattern.
3. Write the beats first: 4–6 beats, one headline each (≤ 7 words), cut times. Show the user the beat list in one short message, then keep going without waiting unless they're clearly present and the topic is ambiguous.
4. Write `scenes/mine/<slug>.html` using the kit helpers (`M.headline`, `M.push`, `M.stack`, `M.progress`).
5. Render with `node render.mjs scenes/mine/<slug>.html --sheet`, then look at `out/<slug>.sheet.png`, a `--still` just after each cut, and `python score.py out/<slug>.mp4`. Fix anything clipped, overlapping, empty, frozen, or under the UI zones. Repeat until clean (usually 2–3 passes).
6. If the user wants narration and `ELEVENLABS_API_KEY` is set: `node voice.mjs --file script.txt --out out/<slug>-voice.mp3`, then re-render with `--audio`.
7. Hand over `out/<slug>.mp4` with one line on what it shows.
