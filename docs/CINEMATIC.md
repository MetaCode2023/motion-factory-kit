# Cinematic motion graphics (film look from drawn 3D)

How to make a motion-graphics shot read like a frame from a film instead of a template. First test:
`scenes/longform/3d/river-cinematic.html` (The Physics of Poker: "before the river turns, it is every card at
once"), 16 s, 24 fps, no footage, no credits spent.

```
node tools/longform/render3d.mjs scenes/longform/3d/river-cinematic.html --still 7       # look at one frame
node tools/longform/render3d.mjs scenes/longform/3d/river-cinematic.html --fps 24 --out out/x.silent.mp4
python tools/longform/cinematic_score.py out/x.wav --dur 16 --silence 10.3 --hit 11.07     # free score bed
```

## The layer: `scenes/longform/3d/cinema.js`

Any kit3d scene can opt in with `const C = cinema(S, {...})` and `C.run(...)` instead of `S.run(...)`.
Per frame, all pure functions of t:

1. Scene rendered in linear HDR (half float) with a depth texture.
2. **Lens depth of field**: golden-angle bokeh gather sized by each pixel's circle of confusion.
   `C.focus` is the focus distance in metres, `C.aperture` the blur radius (px) of things at infinity.
   Bright points away from focus open into round discs, which is what sells "a real lens".
3. **fx layer** (`C.fx.add(...)`): light shafts, dust, holograms. Additive, drawn after the DOF and hidden behind
   solid objects by a depth pre-pass. Dust (`dust()`) defocuses itself from the same focus numbers.
4. **Bloom** only above a threshold (HDR > 1.5): bulbs and practicals glow, white cards don't.
5. **Finish**: ACES film curve, split-tone grade (cool shadows, warm highlights), lifted tinted blacks,
   vignette, edge chromatic aberration, film grain seeded by frame number (deterministic, changes every frame).
6. **Shutter**: `samples(t)` averages sub-frames across a 180° shutter, only where something moves fast
   (the card flip uses 5). Costs N× for those frames only.

HUD on top in 2D: `C.letterbox(c)` (2.39:1) and `C.title(...)` (Barlow Condensed, wide tracking, blur-in).

Speed in the cloud (software GL, SwiftShader, 4 cores): stills take ~6 s, but a full render averaged 4.65 s per frame at 1920×1080 (the lens blur dominates; the 5-sample flip frames cost 5×), so the 16 s test took 30 min. Render stills first, the full film once.

## What made it look like cinema (and what didn't)

Kept, because each one visibly moved the stills from "3D render" toward "film still":
- **One motivated light source.** A single overhead tungsten lamp with soft shadows, nearly no fill, a faint cool
  rim from behind. Darkness around the table is the set. Flat even light was the biggest "cheap" tell.
- **Distant practicals as bokeh.** ~45 small hot points 11-20 m away. Out of focus they become the warm/cool discs
  every casino film shot has. Free, and they make depth readable at a glance.
- **A foreground object out of focus** (a chip stack close to a felt-level lens) plus a **rack focus** from it to
  the subject. Parallax plus focus change is the strongest "real camera" signal.
- **Dust in the light.** Motes only visible inside the lamp's cone, drifting, defocused per mote.
- **Slow eased moves and hard cuts.** Each shot is one push or drift (inOutCubic, no overshoot); shots change on
  hard cuts, never crossfades. 4-5 s per shot.
- **24 fps, 2.39 letterbox, grain, small chromatic aberration.** Small individually; together they code "film".
- **Trailer sound grammar.** Drone that swells, a riser, then a hard silence just before the reveal (the card
  turns in silence), and the reveal lands on a sub-bass drop with a long tail. Silence did more than any effect.
- **Type**: few words, condensed caps, wide tracking, low in the frame, blur-in. One line per shot.

Fixed along the way (check for these on the next one):
- White cards under a hot key light blew out and bloomed. Fix: lower the key, bloom threshold 1.5.
- The reveal flash (exposure + bloom + a point light at once) whited out the whole frame. Keep reveal boosts small
  (exposure +0.12, bloom +0.35); the sub drop and silence carry the moment, not brightness.
- Card lifted on the flip left the close-up frame (only its shadow showed). Keep lift small in close-ups.
- Chromatic aberration at 0.012 put RGB fringes on every dust mote. 0.004 is enough.
- Holograms (ghost cards) at 0.4 opacity cluttered the frame; 0.2 reads as "possibility".
- A title over the subject is unreadable; put it in the dark part of the frame.

## Next steps worth trying

- Composite over a real plate (a Higgsfield or stock clip of a hand on cards) with matched grade: the 3D layer
  then only adds the impossible part (ghost cards). Higgsfield costs credits: show the prompt, get a yes first.
- Port the finish pass to the 2D kit (`M.setup({ look })`) so 2D explainers get the same grain/grade/CA.
- GPU render (`MF_GPU=1` on a machine with a GPU) for ~10× speed.
