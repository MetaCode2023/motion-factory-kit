# Direct a reusable character

Use a character when an action or reaction guides the viewer through an idea.
Point at the object you are naming. Lean in when the result is about to change.
Hold still while the viewer reads or compares a result. Return the character's
gaze to the audience when the explanation lands.

Start with [Pipette's pose sheet](../scenes/examples/character-pose-sheet.html).
For a new character, define its silhouette, proportions, palette, and pose
names in one shared asset. Preview the pose sheet and get the user's approval
before using the character across a series. Reuse that asset in every scene
with the same character. Keep optional props in a separately drawn layer.

## Direct the performance

| Pose | Use it when |
| --- | --- |
| `neutral` | Opening, listening, or leaving space for the graphic. |
| `point` | Naming a specific object. Put it to Pipette's right. |
| `inspect` | Observing a change. Give the viewer a moment to observe too. |
| `relieved` | A result resolves and the character looks back at the audience. |
| `blink` | Adding a brief natural rest between gestures. |

Load `motion.js`, `simulation.js`, `character.js`, then the chosen character
asset. Pass increasing `{ at, pose }` cues to
`CharacterMotion.poseAt(cues, Pipette.poses)`. The returned function samples a
pose from scene seconds. Pass that pose to `Pipette.draw(ctx, { x, y, scale, pose, t })`.
Repeat a pose at the end of a hold before adding the next pose. Use identical
cue times for related captions, sound accents, or narration. The character can
be rendered in any frame order.

Use the [wave lab](../scenes/examples/character-wave-lab.html) for a character
pointing, inspecting, and returning its gaze to the viewer. The
[shadow lab](../scenes/examples/character-light-lab.html) reuses the same rig,
palette, and named poses in a second setting.

```sh
node render.mjs scenes/examples/character-pose-sheet.html --still 0
node make.mjs scenes/examples/character-wave-lab.html
node make.mjs scenes/examples/character-light-lab.html
```
