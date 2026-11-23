# Motion Factory production playbook

Start with the finished video the creator wants. Choose an edit workflow for the source media, then choose a visual treatment for each beat that needs one. Use `kit_overview` for the routes and tool names available to an MCP client.

## Choose the workflow

| Starting point | Use | First useful result |
| --- | --- | --- |
| Raw clips for one or more shorts | [Footage editor](EDITOR.md) | An index and a checked edit plan with the real spoken segments |
| A script and its recording | [Long-form script alignment](LONGFORM.md) | An alignment report showing where each visual lands and which lines need a decision |
| Existing long-form footage | [Long-form editor](LONGFORM.md) | Selected passages and word anchors for visuals |
| An approved cut with locked timing | [Overlays](OVERLAYS.md) | A cue sheet timed to the existing clip |
| One line in Writer that needs a visual | [Script-linked cutaways](CUTAWAYS.md) | Comparable previews tied to the line ID. Recheck the current line before using a selection. |
| Creator clips for a single ad | [UGC example](../scenes/examples/ugc-ad.html) and [template gallery](TEMPLATES.md) | A short cut using the actual product and creator footage, with alternate hooks when requested |
| Repeatable videos from a sheet | `batch-ads.mjs` and [template data keys](TEMPLATES.md) | One representative row rendered and checked before building the batch |
| A visual or transition that needs bespoke movement | [Scene renderer](MCP.md) | A rendered still at the key cue, followed by a short moving preview |

For plug-and-play tools, check the tools exposed by your connected server and the guides present in its checkout. The simulation, character, and editorial helpers are scene-code libraries. Use the scene renderer to see them in action.

Combine routes in edit order. A custom scene can become a long-form insert. Use the overlay route after the final cut is locked. Keep the working plan around so feedback can change the relevant beat without rebuilding the editorial decisions.

## Choose tools by what the viewer needs

| Viewer needs to | Start with | Inspect |
| --- | --- | --- |
| Follow a spoken explanation while seeing the host | Use the long-form `pip` layout for a corner speaker or use `B.pip` in a custom scene. | Face crop, caption clearance, and graphic legibility at the target aspect ratio |
| Understand cause and effect | Use the [simulation guide](SIMULATION.md). Start from the [one-take example](../scenes/examples/whiteboard-one-take.html) when camera moves should stay in a shared world. | The setup, the actual event, and the result. Verify the visualization supports the narration. |
| See exactly which control was used | Place `EditorialFX.cursor` on the real screen recording. Use `EditorialFX.focusLayers` if the attention shift warrants it. | Cursor destination and dwell time, plus readable evidence |
| Direct attention to a control in a screenshot across interface types | Use the [validated UI motion recipe](../examples/ui-motion/README.md) for a target spotlight, focus callout and chapter transition. | Original source bounds through crops/recomposition, actual control text at phone size, caption clearance and scoped hold revisions. Editorial and glass examples remain candidates pending human acceptance. |
| See the pieces of a diagram | Separate independent layers with `EditorialFX.focusLayers`. Use the [editorial reel](../scenes/examples/editorial-reel.html) for working examples. | Each layer remains identifiable throughout the move |
| Read a comparison, number, or sequence | Use [`B.compare`, `B.stat`, or `B.steps`](BLOCKS.md), with verified values and units. | Readable hold and enough space around captions |
| Follow a recurring character’s attention | Reuse its approved rig and set spoken cues with `CharacterMotion.poseAt`. See the [character wave lab](../scenes/examples/character-wave-lab.html). | Gesture destination, pose hold, and clear space around the evidence |
| Feel a moment (a hook, a reveal, a trailer or title beat) rather than read it | Shoot it in drawn 3D with the film layer in [CINEMATIC.md](CINEMATIC.md): one motivated light, lens depth of field with a rack focus, distant bokeh, dust in the light, hard cuts, 24 fps, letterbox, and a hard silence before the reveal. | Stills at each cut: nothing blown out, the subject is the sharpest thing, type sits in a dark area |
| Move to a new idea | Start with a cut. If the outgoing and incoming images tell one story together, try a wipe, zoom, or paper reveal from the [editorial recipes](EDITORIAL-EFFECTS.md). | The connection reads in motion, and the incoming shot settles before the next cue |

Record the source clip or exact spoken phrase, the intended focal point, which evidence is real, where the speaker and captions go, and where the movement starts, holds, and exits. Anchor to a spoken word when footage exists. Pick one primary move per beat and give evidence time to read.

## Worked example — take the host through a microphone into the corner

1. Mark the exact phrase that should start the move. Choose the source clip, a microphone layer or crop, and the graphic behind it.
2. For the signature shot, compose the glass reveal and the speaker move in one custom scene. Animate the same speaker crop into its final bottom-corner position with scene time. Use the microphone aperture as the reveal mask if the footage supports it. Preserve the original voice track on the edit timeline and align the moving crop to it. This is a custom composition. If the assets only support a clean picture-in-picture, use the standard layout and flag that choice in the preview.
3. Reserve the corner before placing graphics or captions. Hold the speaker there through the explanation, with clear space for the face, labels, and subtitles. For a longer video, use the custom scene as the timed insert. Use the built-in `pip` layout for adjacent beats that only need the steady corner position.
4. Render the frame before the move, the point where the face crosses the aperture, and the settled frame. Watch the transition with the spoken line before approving it. If the host is voice-only, show the full graphic and retain the original audio. A contact sheet alone cannot show whether the face blinks out or the move lands on the right word.

## Calibrate what “good” looks like

Use the [video quality comparisons](MOTION-QUALITY-CALIBRATION.md) to agree on
speaker continuity, spoken-cue timing, caption clearance, evidence legibility,
and result holds. Preview at delivery size with audio. Check precise timing on
the timeline and use a blind comparison for subjective judgments.

## Review before delivery

- Inspect the stills and play the short preview at normal speed with audio. Check entrance, hold, and exit at each requested aspect ratio.
- For cuts from real speech, check the words immediately before and after each edited join against the source. Review sound and caption timing.
- Read the build report and contact sheet. Repair failed checks and watch the exported segment again. Record any remaining limitation with its timestamp.
- Keep source media, edit plans, and render outputs in the project workspace. Use footage and assets the project is authorized to use.
