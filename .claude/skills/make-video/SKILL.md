---
name: make-video
description: Make a finished short-form video with this repo — a motion-graphics explainer or a UGC-style ad built around Higgsfield (or other) clips, with captions, music, effects and hook variants. Use when the user asks for a video, ad, reel, short, TikTok, UGC, explainer or motion graphic.
---

# Make a video

Follow `CLAUDE.md` in the repo root. In short:

1. Decide the type: **UGC ad** (footage of a creator/product → `scenes/examples/ugc-ad.html` + `docs/HIGGSFIELD.md`), **explainer** (`scenes/examples/showreel.html` with `kit/fx.js`), **raw client footage → many ads** (`footage.mjs`, `docs/EDITOR.md`: index, write edit plans, build, then the client review loop; street interviews get question cards, name lower-thirds, counters and a poll bar from the plan), **creator-native organic posts** (`rapid-list`, `title-explainer`, `meme-caption` in `scenes/templates/`), or **many ads from a sheet** (`batch-ads.mjs` + a template in `scenes/templates/`). Read `design/DESIGN.md`.
2. Ask at most one question if something essential is missing (product, offer, which clips). Otherwise start. Defaults: 1080×1920, 30 fps, 15–25 s, 3 hook variants via `M.pick`.
3. Write the beats (hook, problem, show, proof, CTA for ads), then `scenes/mine/<slug>.html` using blocks from `kit/blocks.js`.
4. Clips: use files in `assets/higgsfield/` if the user has them. If the Higgsfield tools are connected and the user wants new footage, draft the prompts from `docs/HIGGSFIELD.md`, show them, and generate only after a yes.
5. Build: `node make.mjs scenes/mine/<slug>.html --variants` (add `--formats 4:5,1:1,16:9` if they want other sizes). Read `out/<name>.report.md` and look at `out/<name>.cuts.png`; fix every FIX you can and rebuild until clean.
6. Hand over the MP4s with one line each, plus anything the user still needs to supply.

## Simulation shots

When the story depends on motion, use [the simulation guide](../../../docs/SIMULATION.md)
and [the whiteboard example](../../../scenes/examples/whiteboard-simulation.html). Pick a technique
for each shot, render a short preview, and inspect frames at the key moments before the final build.
Keep motion tied to scene time so previews and exports can seek directly to any frame.
For a continuous shot, start with [the one-take tray example](../../../scenes/examples/whiteboard-one-take.html).
Plan the wide view, push-in, tracked action, and reveal before writing the scene.
Use one shared world and align each camera beat to a story cue or simulation event.

For a visual based on a specific script line, use the [cutaway workflow](../../../docs/CUTAWAYS.md).
Read project preferences, render distinct options, and recheck the line before saving the user's choice.
