# Reel effects for agent-directed edits

Choose the effect from the job it does in the edit. Decide what the viewer should notice, then pick one primary effect per beat. Use an ordinary cut when the effect adds no meaning. Time entrances to spoken words with `M.cues` where available and keep captions in screen space, outside any camera transform.

| Effect | Use when | Build with |
| --- | --- | --- |
| Orbit | Introduce a small set of tools or concepts around one subject. Use three to five short labels. | `ReelFX.orbit`; draw the chips in its callback. |
| Chat takeover | Show a prompt and response or tell a conversation beat. Label a recreated conversation. | `B.chat` over an opaque panel, with `B.pip` if the speaker stays visible. |
| Frame escape | Make a person or object break out of a card for a reveal. Use a transparent subject or keyed footage. | `ReelFX.frameEscape`; paint the clipped insert first, then the foreground subject. |
| Snap zoom | Put a short accent on a punchline or keyword. Check that the face and text remain in frame. | `FX.camera` with one timed punch. |
| Checklist pop | Reveal steps or milestones as the speaker names them. | `B.checklist` with per-item times. |
| Headline storm | Stack a few short headlines to show momentum or reactions. Use measured claims and leave room to read them. | `ReelFX.headlines` with spaced entrance times. |
| Zoom portal | Enter a detail or secondary view through a point on screen. | `FX.transition` with `type:'circle'` and a deliberate center. |
| Growth curve | Show a trend from an actual series. Supply axis labels and a unit. Label illustrative data explicitly. | `ReelFX.growthCurve` with equally spaced observations normalized to a common range. |
| B-roll overlay | Show the proof, interface, or object the narration mentions. | `M.video` for footage and `B.pip` or `B.browser` for the composition. |
| Paper cutout | Illustrate an abstract line with a tactile, short cutaway. | [Script-linked cutaways](CUTAWAYS.md) or the paper-cutout template. |
| Magazine cover | Give an editorial title or closing portrait a single recognizable composition. | Compose an original masthead with `FX.text`, a portrait, and two short cover lines. |
| Liquid glass | Highlight a small callout over busy footage. Check contrast in the rendered frame. | `FX.glass` for a frosted-panel treatment. |
| Zoom-through cut | Connect two shots with the same subject or composition. | `FX.transition` with `type:'zoom'`. |
| Green screen | Put a speaker over evidence or a diagram. Use genuinely keyable footage and inspect the edges. | `M.video(src, {key:'green'})`. |
| Frame break | Let a highlighted object cross a panel edge while maintaining its position. | Same `ReelFX.frameEscape` layering as frame escape. Use a stationary frame. |
| Digital zoom | Make a deliberate in-shot reframe legible. Add the camera overlay only if it suits the story. | `FX.withCamera` for zoom and `ReelFX.cameraHud` in screen space. |
| Phone mockup | Demonstrate a mobile workflow. Use the actual app recording or label a mockup. | `B.phone` with a screen draw callback. |
| Checklist tally | Recap how many items are complete or show results from actual counts. | `B.counter` and `B.checklist`, or `B.tally` for a poll. |

Load `kit/reel.js` after `kit/motion.js` for the ReelFX helpers. See the
[runnable examples](../scenes/examples/reel-effects.html):

```sh
node make.mjs scenes/examples/reel-effects.html
```

Write down the cue, primary effect, and required asset for each beat. If the
asset is missing, choose a simpler effect that can tell the same story.
Review the frame before the cue, the first readable frame, and the last frame
before the next cut. Keep faces, proof, and captions clear of competing graphics.
