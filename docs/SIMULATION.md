# Simulation and mathematical animation

Use [the whiteboard simulation](../scenes/examples/whiteboard-simulation.html) as a starting point for scenes where motion explains the idea.

```sh
npm install
node render.mjs scenes/examples/whiteboard-simulation.html --sheet
```

Open the same HTML locally for a preview with a scrub bar. The export lands in `out/whiteboard-simulation.mp4`.

| Shot | Approach |
| --- | --- |
| Pieces fall, bounce, or collide | Build a Matter.js engine and call `bakePhysics(engine, bodies, { duration })` once before `M.setup`. Draw the returned poses at the scene time in seconds. |
| Staggered labels or multi-part moves | Use an Anime.js timeline with `autoplay: false` and plain objects as targets. Seek to the requested time in milliseconds on every draw. |
| A sketch becomes a clean diagram | Use `morphPoints(from, to, progress)` with the same number and order of points on both paths. |
| A pointer, limb, or hinged piece follows its parent | Nest `drawJoint(ctx, { x, y, angle }, draw)` calls. Poses are relative to their parent and angles are in radians. |
| Dust or a drifting particle layer | Use `particleField({ count, width, height, seed, speed })` and draw the field with the current scene time. |
| Equations or an exact mathematical plot | Use Manim as an optional pre-rendered shot and composite the clip with `M.video`. |

Load the scripts locally in the order used by the example. The default Skia engine supports the object-target Anime.js pattern, where the scene draws all pixels on its canvas. Keep each draw independent of the previously drawn frame so stills, scrubbing, motion blur, and parallel exports can request times in any order.

## Optional Manim shot

With [Manim Community installed](https://docs.manim.community/en/stable/installation.html), render the sine trace:

```sh
manim render -ql --disable_caching --media_dir out/manim examples/manim/sine-trace.py SineTrace
```

To try the full handoff, copy the generated clip to the path used by [the compositing example](../examples/manim/sine-composite.html) and build the scene:

```sh
cp "$(find out/manim/videos -name SineTrace.mp4 -print -quit)" out/manim/sine-trace.mp4
node make.mjs examples/manim/sine-composite.html --fast
```

For your own scene, place the clip in your assets, create it with `M.video(relativePath, { at: startTime, audio: false })`, and call its `draw(ctx, t, x, y, width, height)` during that beat.

## One continuous shot

Start with [the tray one-take](../scenes/examples/whiteboard-one-take.html).

```sh
node make.mjs scenes/examples/whiteboard-one-take.html
```

Use one coordinate system for the full shot. Create the camera once with
`FX.cameraPath([{ at, focus, zoom }, ...], { width, height })`. Keyframes use scene
seconds. Focus is a world-space `{ x, y }` or a function of scene time that returns
a point. Two consecutive keyframes with the same focus function follow that target.
The camera blends into and out of tracking and holds the endpoint keyframes outside
their time range. A dynamic endpoint continues to follow its target.

Inside `draw`, pass the sampled pose to `FX.withCamera(ctx, t, cameraAt(t), drawWorld)`.
Draw labels that should stay fixed on screen after that call. Reuse the same
timestamps for camera beats and narration cues. For physics events, derive the
timestamp during the simulation bake and use it for the camera, captions, and
sound. The tray example derives its impact cue from Matter.js contact.
