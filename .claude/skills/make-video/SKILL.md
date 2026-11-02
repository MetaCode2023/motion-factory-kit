---
name: make-video
description: Make a finished short-form video with this repo — a motion-graphics explainer or a UGC-style ad built around Higgsfield (or other) clips, with captions, music, effects and hook variants. Use when the user asks for a video, ad, reel, short, TikTok, UGC, explainer or motion graphic.
---

# Make a video

Follow `CLAUDE.md` in the repo root. In short:

1. Decide the type: **UGC ad** (footage of a creator/product → `scenes/examples/ugc-ad.html` + `docs/HIGGSFIELD.md`) or **explainer** (`scenes/examples/showcase.html`). Read `design/DESIGN.md`.
2. Ask at most one question if something essential is missing (product, offer, which clips). Otherwise start. Defaults: 1080×1920, 30 fps, 15–25 s, 3 hook variants via `M.pick`.
3. Write the beats (hook, problem, show, proof, CTA for ads), then `scenes/mine/<slug>.html` using blocks from `kit/blocks.js`.
4. Clips: use files in `assets/higgsfield/` if the user has them. If the Higgsfield tools are connected and the user wants new footage, draft the prompts from `docs/HIGGSFIELD.md`, show them, and generate only after a yes.
5. Build: `node make.mjs scenes/mine/<slug>.html --variants`. Check the sheet, stills after each cut (`node tools/stills.mjs`), `python score.py`, and every `!` warning. Fix and rebuild until clean.
6. Hand over the MP4s with one line each, plus anything the user still needs to supply.
