# Direct a UI from a manifest

The `ui-motion-v1` recipe renders original screenshots with a target spotlight,
focus callout and chapter wipe. It uses Kit's deterministic Skia renderer,
`M.prog`/easing and `FX.glass`. Manifest data cannot supply drawing code.

From the repository root (PowerShell or a shell with Node and FFmpeg on PATH):

```
node tools/ui-motion-fixtures.mjs
node tools/render-ui-motion.mjs examples/ui-motion/editorial.json --out out/ui-motion/editorial.mp4
node tools/render-ui-motion.mjs examples/ui-motion/glass.json --out out/ui-motion/glass.mp4
```

The fixture builder requires installed Bahnschrift. On a runner without it,
explicitly choose `node tools/ui-motion-fixtures.mjs --barlow` to regenerate
the examples using the bundled licensed Barlow font. The renderer checks the
requested font and records it in the receipt; it never silently substitutes.
Do not commit or redistribute the Windows Bahnschrift font binary.

Each shot supplies exact chapter/headline/callout/caption copy, source dimensions,
a stable target name, normalized source bounds (or a unique captured locator
with normalized resolved bounds), cue, move, hold, transition, theme and
accessibility settings. Times must be exact 30fps frame multiples.
Source paths resolve relative to the manifest. Real image dimensions must
match the declared dimensions before rendering begins.
`target.name` is an internal stable identifier and is never rendered. Put
visible chapter wording in `copy.chapter`; omit it to leave that line empty.

`framing` is a normalized source crop used for the focused view. The scene
starts with a contain-fit overview and moves to that crop on the cue.
Target coordinates remain in the original source space. The compiler
accounts for contain letterboxing and cover crop offsets. Final target
bounds must fit the viewport. Crop small controls more tightly instead of
retyping their labels over the screenshot.

`protected` rectangles use normalized destination coordinates; reserve
captions or platform UI here. The compiler places callouts inside safe
areas, away from target, headline, caption and protected regions. A missing,
ambiguous, clipped, undersized or blocked target stops export with a review
message. Supply explicit bounds/framing or revise the composition. The
reserved `context` fallback is preview-only and also refuses export; this
version does not guess a target. `reducedMotion` removes the camera move and
uses a cut in place of the chapter wipe while preserving cue and hold.

Choose spotlight when a crowded interface competes with a control; choose
callout when the surrounding context should stay undimmed. Choose editorial
for the clearest value hierarchy; glass is a candidate material treatment
with opaque label substrates and unblurred target pixels, pending Austin's
creative decision. The primary control remains the evidence in either style.

For revisions, use `reviseHold(manifest, shotId, 1)` and `planDiff(before, after)`
from `tools/ui-motion-plan.mjs`. Give unrelated beats explicit `start` times
to keep them fixed; an extension that overlaps them is rejected. Retain the
stable manifest ID and record the revision through the manifest hash/diff.

Each MP4 is staged, probed and fully decoded before publication. A failed
render leaves the previous MP4 intact. The JSON receipt records actual font,
dimensions, duration, source plan, mapped target/callout, cues, checksum and
separate engineering/creative/model/human statuses. Video binaries belong in
`out/` or an external review package, never Git.

The examples are candidate studies, not human-approved toolbox entries.
