# Underwater documentary shot: lookdev ground truth

Shot: 6 s, 1920x1080, 30 fps, one continuous move. Open water with light shafts (establishing,
0-1.5 s), the camera cranes up and tilts down onto a sea turtle gliding over a caustic-lit floor
(hero, 2.5-3.8 s), then focus racks to marine snow drifting just in front of the lens (macro, 4.8-6 s).
Tone: calm, observational natural-history documentary. Quiet awe, not spectacle.

Plates (procedural lookdev stand-ins, `refine/lookdev/underwater/`, made by `tools/lookdev-plates.mjs`):

| Plate | Maps to | What it fixes |
| --- | --- | --- |
| plate-1-establishing | t = 0.8 s | Shaft geometry and falloff, surface ripple, deep-water colour |
| plate-2-hero | t = 3.2 s | Light on the subject, caustics on shell and floor, translucent flipper edges |
| plate-3-macro | t = 5.4 s | Bokeh scale, snow density near the lens, background softness |

## Lighting

- One key: the sun, refracted through the surface, entering from upper left and travelling down-right.
  Every highlight in frame must agree with that direction.
- Shafts are volume, not overlays: they fan from a source above frame, are brightest near the
  surface and are gone by the lower third. 5-9 visible shafts, irregular widths.
- Key/fill: the turtle's lit top vs shadowed flank roughly 4:1. Ambient fill is blue and weak.
- Occlusion grounds the subject: a soft contact shadow on the floor once the floor is in frame.
- Caustics: bright, sharp-edged net on the sand; the same pattern, softer, crawling over the shell.

## Colour

- Cool, deep blue. Temperature reads around 8000-9500 K: measured b* stays at or below -12 on every
  keyframe. Red is absorbed first: the shell keeps warmth only where the key light hits it.
- Palette: abyssal navy (#02121e), mid-water cobalt (#0b4f8a), shaft cyan-white (#bfefff), shell
  amber (#9a6a3a) as the only warm accent. No greens beyond a faint skin tint.
- Saturation: rich but not neon; chroma C* at least 15.

## Materials

- Shell: scutes read as plates with seams and a slight lift at their centres, not as stripes or
  scribbles. Roughness high, a narrow specular rim where the key grazes.
- Flippers: thin, mottled skin; their trailing edges transmit warm light (subsurface).
- Sand: fine-grained, matte, lit only by caustics and ambient.

## Particles

- Marine snow at three depths. Near-lens flakes become soft bokeh discs during the rack focus.
- Density: present everywhere but sparse (measured speckle density at least 1 per 1000 px at
  analysis size), and brighter where it crosses a shaft: snow follows the light, it is not a uniform
  noise field.

## Camera

- Smooth crane and push, eased in and out; no handheld shake at this focal length.
- Depth of field: subject sharp through the hero beat; the rack to the lens completes by 5.0 s and holds.

## Measurable targets (checked on every keyframe; the critic still decides)

| Metric | Target | Why |
| --- | --- | --- |
| bMean (b*) | <= -12 | cool deep-water temperature |
| chroma (C*) | >= 15 | rich, not grey |
| contrast (L* p95-p05) | >= 28 | motivated key light, not flat |
| speckleDensity | >= 1 | marine snow present |
| primaryFraction | <= 0.01 | no default primaries |
