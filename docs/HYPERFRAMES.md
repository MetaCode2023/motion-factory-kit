# HyperFrames for DOM-native shots

HyperFrames is an optional browser renderer for Motion Factory Kit. It earns
its place when the deliverable depends on actual HTML layout, CSS, or a
seekable browser animation. The Kit Canvas pipeline remains the default for
simulations, footage edits, and existing Kit scenes.

## Choose the renderer from the shot

| What needs to happen | Choose | Why |
| --- | --- | --- |
| A live HTML mockup rearranges cards, opens a dialog, resizes a pane, or changes layout while the viewer watches | HyperFrames | Browser layout and paint define the shot. Preserve the DOM instead of redrawing it on Canvas. |
| A shot needs editable DOM text, CSS Grid or Flexbox, inline SVG, or a paused GSAP timeline | HyperFrames | The browser can seek and capture that composition at specific times. |
| A recorded screen or static screenshot needs a spotlight, captions, or punch-ins | Kit UI motion or Kit overlays | Use the real captured evidence. A DOM reconstruction can change what the interface actually showed. |
| A speaker travels through a microphone portal into a corner while simulated terrain appears | Kit | The Kit already has the footage, masking, frame-based simulation, and audio workflow needed for the whole move. |
| Baked physics, character poses, particle effects, cutaways, or an existing `M.setup` scene | Kit | Stay in the scene format with the required helpers and deterministic time sampling. |
| A Kit edit needs one DOM-native shot | Use both | Render that shot with HyperFrames and bring the local MP4 back as a Kit insert. Keep the main timeline, captions, and audio mix in the Kit. |

## Author and render

Use Node 22+, FFmpeg, and a Chromium installation supported by the CLI.
The npm entry point pins HyperFrames to 0.9.80 and installs it on demand. Ordinary
Kit installs do not pull in the HyperFrames runtime. The Kit entry point disables
HyperFrames usage telemetry.

1. State why the shot needs browser layout. If it is a real product workflow,
   use authorized UI assets and accurate labels. Label a fictional demo as
   such when it could otherwise be mistaken for actual product evidence.
2. Put the composition in its own folder with `index.html`. Copy
   [the queue demo](../examples/hyperframes/index.html) to start. Give the
   root a composition ID, dimensions, start, and finite duration. Mark
   timed elements as clips with starts, durations, and track indices.
3. Keep images, media, fonts, and scripts local to that composition. Use
   CSS keyframes, as in the example. Mark the root `data-no-timeline` when there
   is no registered timeline. For GSAP, register a paused timeline in
   `window.__timelines` under the root's composition ID. Use the timeline
   rather than timers, autoplay, or wall-clock state. Check that revisiting a
   timestamp reproduces the same pose.
4. Validate and render a draft. Inspect the frame before the interaction,
   the main move, and the final hold. Review the actual exported video for text
   clipping, visible UI state, crop, runtime, and audio if present.

From the Kit root:

```sh
npm run hyperframes -- doctor
npm run hyperframes -- lint examples/hyperframes
npm run hyperframes -- check examples/hyperframes
npm run hyperframes -- render examples/hyperframes --output out/hyperframes-queue-tour.mp4 --quality draft --strict
```

Use `npm run hyperframes -- preview examples/hyperframes` to review in the
browser studio. The included sample is a silent, five-second UI insert.
Choose final output dimensions and FPS to match the receiving edit. Put the
rendered clip where the Kit scene can read it and use
`M.video(localPath, { at: cueTime, audio: false })` when the Kit owns sound.
Enable clip audio deliberately when the insert contains an essential excerpt.
Retain the HyperFrames project and its assets with the edit for revisions.

If the browser does not launch, check `doctor` and run
`npm run hyperframes -- browser --help` for the pinned CLI's installation
commands. If a DOM-only insert cannot be rendered on the current machine,
flag that shot as blocked or use an approved capture as the source.

Upstream references: [HyperFrames CLI](https://github.com/heygen-com/hyperframes/tree/main/packages/cli)
and [composition contract](https://github.com/heygen-com/hyperframes/blob/main/docs/concepts/compositions.mdx).
