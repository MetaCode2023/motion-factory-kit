# Transitions and wipes

How a full-frame visual (a `full`, `pip` or `split` insert) arrives and leaves in a long-form video. Two kinds:

- **Legacy names**: ffmpeg `xfade` transitions (`smoothleft`, `slideup`, `circleopen`, `hblur`, `dissolve`, ...) and
  `cut`. Unchanged; see "Transitions and camera" in [LONGFORM.md](LONGFORM.md).
- **Wipes**: twenty soft-edged shapes (iris, clock, blinds, checker, noise, ...) drawn by `tools/longform/wipes.mjs`.
  Written `wipe:<family>` anywhere a transition name goes.

Code: `tools/longform/wipes.mjs` (the shapes and the mask frames), `tools/longform/transitions.mjs` (the grammar and
the ffmpeg graph), `composite()` in `tools/longform/build.mjs` (uses them), `resolvePlan()` in
`tools/longform/plan.mjs` (checks them). Tests: `tests/transitions.test.mjs`.

**Clean room.** The idea of a library of wipe shapes came from the owner's use of OpenShot, which is GPL-3.0; this
repo is MIT. Nothing here was looked up, read, copied, ported or paraphrased from OpenShot's code or its mask
images, and no mask image is stored in the repo. Every shape is generated from the maths in `wipes.mjs`. Do not add
code or images from GPL projects to this area.

## Grammar

A transition is written in one of three ways; all of them work in a plan, a script header and a script cue.

```
"transition": "smoothleft"                                  a legacy name (or "cut")
"transition": "wipe:iris"                                   a wipe, all defaults
"transition": "wipe:linear(softness=0.15 dur=0.6 angle=30)" a wipe with settings
"transition": { "wipe": "linear", "softness": 0.15, "angle": 30 }    the same, as an object (plans only)
```

In a plan: `"transitions": ["wipe:iris", "smoothleft", "wipe:blinds-h(count=6)"]` cycles through a mixed list;
`"transition"` on one insert sets that one. In a script: `transitions: wipe:iris(softness=0.2), smoothleft` in the
header, or `[[stat value: 5 | transition: wipe:clock(softness=0.2)]]` on one cue.

Rules (these exist because script headers split on commas and cues split on pipes and semicolons):

- Settings are `name=number` pairs separated by spaces. **No commas, pipes or semicolons** inside a spec.
- Common settings: `softness` (0 to 1, default 0.1: how wide the feathered edge is, as a share of the wipe) and
  `dur` (0.05 to 5 seconds, default 0.4; never more than a quarter of the insert's length).
- Each family also has its own settings (table below). An unknown setting is an error.
- A malformed `wipe:` spec (unknown family, bad number, out of range, unknown setting, missing bracket) is an
  **error** in `resolvePlan`, so the build stops and says which insert.
- An unknown legacy name is only a **warning**, and falls back exactly as before: on an insert, the plan's cycle
  is used; in `plan.transitions`, the entry is left out of the cycle (before, ffmpeg failed on it).

`parseTransition(value)` (in `transitions.mjs`) returns `null`, `{type:'cut'}`, `{type:'xfade', name}`,
`{type:'unknown', name}` or `{type:'wipe', family, softness, dur, params}`, and throws on a malformed wipe.

## Families

Pixels are revealed in a set order; the wipe reveals the NEW picture (the insert on the way in, the speaker on the
way out). "Centre" means the middle of the frame. Settings in the second column are the family's own, with defaults.

| Family | Settings | Shape |
|---|---|---|
| `linear` | `angle=0` | A straight edge sweeps across; 0 reveals from the left, 90 from the top. |
| `clock` | `angle=0` | A clock hand sweeps clockwise round the centre, starting at 12 o'clock plus `angle`. |
| `clock2` | `angle=0` | Two hands, opposite each other, sweep at once (a half-turn). |
| `iris` | none | A circle opens from the centre. |
| `iris-in` | none | The picture closes in from the edges to the centre (a circle shrinking). |
| `ellipse` | none | An ellipse the shape of the frame opens from the centre. |
| `diamond` | none | A diamond opens from the centre. |
| `box` | none | A rectangle the shape of the frame opens from the centre. |
| `cross` | none | A plus sign: arms along the middle lines thicken until they meet the corners. |
| `barn-h` | none | Barn doors: a vertical gap opens at the centre and widens sideways. |
| `barn-v` | none | Barn doors: a horizontal gap opens at the centre and widens up and down. |
| `blinds-h` | `count=8` | Horizontal slats, each opening top to bottom. |
| `blinds-v` | `count=8` | Vertical slats, each opening left to right. |
| `checker` | `count=8` | A chessboard (`count` squares across); one colour of square opens first, then the other. |
| `diagonal-bars` | `count=6 angle=45` | Diagonal bars, alternate bars sliding in from opposite ends. |
| `zigzag` | `count=8 amp=0.08 angle=0` | A linear sweep whose edge is a zigzag with `count` teeth, `amp` deep. |
| `wave` | `count=3 amp=0.08 angle=0` | A linear sweep whose edge is a sine wave with `count` waves, `amp` deep. |
| `spiral` | `turns=0.35` | A spiral arm sweeps out from the centre; `turns` is how tightly it winds. |
| `star` | `count=5 depth=0.5` | A star-shaped iris with `count` points, `depth` how pointed. |
| `noise` | `count=32 seed=1` | Random squares (`count` across) dissolve in; the same `seed` always gives the same pattern. |

## The ffmpeg graph, and why

Per insert chunk, `composite()` already builds a graph with the visual (`vis`), the speaker behind it (`bgA` for
the way in, `bgB` for the way out) and, when one visual runs straight into another, a still of the previous
visual's last frame (`from`). A legacy name joins them with `xfade`. A wipe joins them with:

```
[mask frames] -> format=gray, trim to the wipe length, scaled to the picture (scale2ref)
[new picture][mask] alphamerge            the new picture, transparent where the mask is black
[old picture][that] overlay               (for the way out: shifted to start `D - d` seconds in)
```

That is `wipeGraph(fromLbl, toLbl, maskIdx, d, offset, out)` in `transitions.mjs`. It adds one extra input (the PNG
sequence, `-framerate <fps> -i .../%04d.png`) per wipe, so a chunk still holds at most the two media streams plus
the small mask sequences (and the pip assets). Nothing else in the chunk changes: the `p.prev` still, the pip and
split layouts, the captions and the encode settings are all the same.

**Why not `xfade=transition=custom:expr=...`.** FFmpeg can evaluate an expression per pixel, and that is the
obvious way to add shapes. It was rejected because the expression runs per pixel per plane (slow at 1080p over
hundreds of chunks), it cannot read a third input, it has no seeded random source for `noise`, a feathered edge is
expensive to write there, and you cannot unit test an expression without running ffmpeg. Precomputed masks give
anti-aliased soft edges, are plain JavaScript (testable on their own), cost about a dozen small PNGs per wipe, and
reuse the `alphamerge` + `overlay` pattern the pip layout already uses.

Timing: a wipe lasts `d = min(dur, insert length / 4)` seconds, the first mask frame is fully black (the old
picture, so it joins the previous frame without a jump) and the last is fully white (the new picture).

## Masks and the cache

`wipeFrames(spec, {w, h, fps, dur})` writes `0000.png`, `0001.png`, ... (8-bit grayscale pictures) to
`out/.cache/wipes/<hash>/` and returns the folder. Masks are made at 960x540 and scaled up by the graph (soft edges
survive that; a hard-edged family at `softness=0` shows a slightly soft edge at 1080p). Nothing is committed.

The folder name is a hash of `WIPES_VERSION`, the family, its settings, `softness`, the size and the frame count.
So a mask is rebuilt when any of those change. **If you change a family's maths, bump `WIPES_VERSION` in
`wipes.mjs`**, or stale masks keep being used. A folder is written under a `.part` name and renamed when complete,
so an interrupted run never leaves a half-written cache. Deleting `out/.cache/wipes/` is always safe.

PNGs are written with skia-canvas, which the kit already depends on (the skia engine uses it). The alternative was
piping raw frames through ffmpeg; skia is a few lines of code and adds nothing to install.

## Adding a family (five steps)

1. In `wipes.mjs`, add the name and its settings with defaults to `FAMILIES`.
2. Add a function with the same key to `SHAPES`: `(q) => (x, y) => t`, where `q` has `w`, `h` and the settings, `x`
   and `y` are pixels from the centre, and `t` is any number that orders the pixels (smaller is revealed first).
   `revealMap` rescales it to 0 to 1. Keep it one small function.
3. Add a row to the table above. The first test checks every family is listed in this file by its backticked name.
4. If the family is pure arithmetic (no sin, cos, atan2), add a golden hash for it to the `golden` table in
   `tests/transitions.test.mjs`. Otherwise do nothing: the property test already checks p=0 is black, p=1 is white
   and the mask never darkens as p grows.
5. Run `node --test tests/transitions.test.mjs`, then look at a frame at p=0.5 (`maskFrame(revealMap(...), 0.5, 0.1)`).

## Tested and untested

Tested (`tests/transitions.test.mjs`, no network, ffmpeg only for the last two):

- every family: p=0 all black, p=1 all white, never darkens as p grows, at softness 0, 0.1 and 0.5
- one hand-worked mask (linear, four pixels) and golden hashes for ten arithmetic families
- determinism, and `noise` is seeded
- the grammar: legacy names, wipe strings, objects, every kind of bad spec
- `resolvePlan` errors on a bad wipe and warns on an unknown name; script cues and the script header keep the spec
- the PNG cache is reused and invalidated by length, softness and family
- two real renders of 64x36 clips: red to blue through a linear wipe in and out (first frame is the old picture, last
  is the new, the middle differs from both, and the edge moves left to right, which a legacy xfade would not), and
  a wipe between two touching visuals starting from the last frame of the first
- the legacy path is unchanged: before and after this work, `composite()` was run against a recorder in place of
  ffmpeg for plans with no transitions, `fade`, a custom list, explicit names, `cut`, an unknown name, a carried
  figure, pip, split, side and touching inserts; the ffmpeg arguments came out byte for byte the same.

Not tested: how each family looks on real footage (judge a few by eye before relying on them; only `star` was looked at
at 1920x1080, on flat colours), the `pip` and `split` layouts with a wipe (a 1920x1080 `full` and `split` wipe rendered
without error once by hand, but no committed test covers `split` or `pip`), and any ffmpeg other than the bundled
`ffmpeg-static` (6.1.1 here). `scale2ref` is used to match the mask to the picture; newer ffmpeg
(7.1 and later) lists it as deprecated but still has it.

## Known limits

- **Wipes are not carried into the Premiere XML export.** `premiere.mjs` writes no transitions of any kind (legacy
  ones were never exported either); the timeline shows hard cuts at every visual.
- `side` inserts still fade; they never use a wipe.
- A wipe is one setting for both ends of an insert; the way out reveals the speaker with the same shape.
- `dur` is capped at a quarter of the insert, so a 2 s insert gets at most a 0.5 s wipe.
- Mask size is fixed at 960x540 (16:9). A plan that renders another aspect ratio would need `MASK` in `build.mjs` changed.
