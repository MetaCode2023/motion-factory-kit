# Editorial effects

Use an effect to direct attention, explain an edit, or move between story beats.
Choose one focal point, time the effect to the spoken cue, and leave enough
time to read titles or evidence. The examples below describe how to recreate the
technique with your own content and visual identity.

| Effect | When to use it | Kit recipe |
| --- | --- | --- |
| Live cursor | Guide the viewer to the real control being demonstrated. | `EditorialFX.cursor` between known screen coordinates. |
| Clone row | Show repeated objects, variants, or steps. | `EditorialFX.stagger` with the same drawing callback and per-item placement. |
| Day dial | Show elapsed time or progress toward a real milestone. | `EditorialFX.dial` with normalized progress and an external time label. |
| Predict keys | Show typed input or a prediction central to the demonstration. | Reveal text with `FX.text` in `chars` mode and add original keycaps. |
| Orbit ring | Introduce a small group of related subjects. | `ReelFX.orbit` with short labels. |
| Code body | Treat code as a visual motif for a coding story. Keep any evidence readable. | Draw a silhouette mask and clip a monospace text texture to it. |
| Post wall | Compare multiple actual posts or show the scale of a batch. | Use `B.postCard` for readable foreground posts and thumbnails in the background. |
| Letter dive | Enter a title or large letter when the next image completes its meaning. | Use `FX.transition` with a zoom, or with a circular reveal centered inside the letter. |
| Comment drop | Bring one genuine reaction into focus. Label reenactments. | Use `B.commentReply` with a staggered entrance for multiple comments. |
| Layer explode | Explain a composition by separating its parts. | Offset independent layers with `EditorialFX.focusLayers` using per-layer `dx` and `dy` offsets. |
| Sketch words | Highlight one hand-drawn phrase during an explanation. | Use `FX.text` and an original sketch underline. |
| Blade slice | Cut sharply on a beat while revealing the next shot. | Use `FX.transition` with `type:'wipe'`. |
| Head stack | Add a playful emphasis to repeated reactions. | Use `EditorialFX.stagger` with an alpha-masked portrait and offset copies. |
| Rack focus | Shift the viewer from a foreground detail to background evidence or back. | Draw back-to-front with `EditorialFX.focusLayers` and animate `focus` from 0 to 1 or 1 to 0. |
| Banknote | Turn a verified number into a fictional voucher graphic. | Draw a custom ornamental frame, number and portrait with `M.text` and `M.cover`. |
| Voice note | Show an audio excerpt when hearing it is part of the story. | Use a rounded panel and the actual excerpt's waveform sampled from its audio. |
| Impact frame | Punctuate one short, decisive word or reveal. | Combine bold `FX.text` with original radial lines. |
| Dolly zoom | Use a perspective shift to suggest surprise or rising stakes. | For 2D layers, approximate with `EditorialFX.focusLayers`: change background `zoom` and offset it with foreground `spread`. Use a real perspective camera for a 3D scene. |
| Press front | Present one announcement as an editorial title. | Compose an original masthead, headline and image; keep any supporting columns legible. |
| Paper tear | Reveal a new shot with a tactile edge. | Paint the outgoing shot, then call `EditorialFX.paperTear` with the incoming draw callback. |
| Blow away | Suggest an object breaking apart or disappearing. | Replace the outgoing outline with seeded particles from `MotionSimulation.particleField` or `FX.particles`. |

The clip shows a separate closing blow-away treatment after the other effects.
The [editable example](../scenes/examples/editorial-reel.html) runs five short
studies showing the new drawing helpers. Start with the existing
[reel effects](REEL-EFFECTS.md) for common talking-head treatments.

```sh
node make.mjs scenes/examples/editorial-reel.html
```
