# Motion rules

The standard every generated graphic is held to. Distilled from the owner's own motion design system (the one
his best explainer components were built to), generalised so it applies to any brand. Read this before
designing a scene; run the checklist at the end before calling one done. Colours and fonts come from
`brand.js` and the video's `theme`; this file is about how things move and how a frame is built.

Numbers live in `design/motion-tokens.json` so code can read them.

## Principles

1. **Function before flourish.** Every movement explains something: a state change, a relationship, a
   hand-off, a decision, a result that stays. If a move explains nothing, cut it.
2. **One active idea at a time.** Most of the frame holds still while the current subject activates. Two
   things moving for attention means neither gets it.
3. **Labels stay still.** Type does not scale, glow or morph once it has arrived. Values and statuses may
   change; the words naming them don't move.
4. **Colour means something, and always the same thing.** Accent/blue = information and flow. Warm/orange =
   active, attention, a request. Green = resolved, verified, kept: it appears only *after* something resolves.
   Red = failure, blocked, retry, and nothing else. Structure is the dark neutral.
5. **Glow is not an animation.** Emphasis comes from the edge strengthening, the object coming forward, its
   values changing, a real connector arriving. A broad glow may support a hero number; it never stands in
   for a state.
6. **Objects behave like physical things.** Keep one light (key from the upper left, shadow down-right), one
   perspective per object, and never change perspective during a simple state change. Things pass *behind*
   rims and *through* openings (occlusion), not over the top of them.
7. **Readable holds.** Every meaningful state settles and then holds long enough to read on a phone.
8. **Deterministic.** The same time gives the same frame (the kit's `draw(ctx, t)` rule).
9. **Draw what moves.** Moving parts are drawn in code. Raster images are for reference and still texture.

## Timing

| Beat | Length |
|---|---|
| Anticipation (the small move before the move) | 120-180 ms |
| Primary action | 280-420 ms |
| A connector or packet travelling | 320-520 ms |
| Settle | 180-280 ms |
| Readable hold | 650-1100 ms at least |
| One small component, start to finish | about 2.8-5.6 s |

## Easing

| Name | Curve | Use |
|---|---|---|
| enter | cubic-bezier(0.16, 1, 0.3, 1) | things arriving |
| move | cubic-bezier(0.2, 0.8, 0.2, 1) | things travelling, camera moves |
| resolve | cubic-bezier(0.22, 1, 0.36, 1) | a state settling into place |
| exit | cubic-bezier(0.4, 0, 1, 1) | things leaving |
| linear | linear | only packets moving along a path |

**No bounce** unless the thing is physically a latch, a spring or an impact (a card slapped down, a coin
landing). An overshoot on a number or a label is decoration.

## Focus

When something becomes the subject: its edge strengthens 1.2-1.5x, it comes forward the equivalent of 4-8 px,
local contrast rises 8-15%, and everything not essential drops to 72-88% opacity. Its label does not scale.

## Connections

A line between two things ends on a real edge or port of each, follows a straight or perspective-true path,
and is drawn only when the relationship becomes relevant. Anything travelling follows that exact path and
can vanish when the hand-off completes. What was *kept* stays visible after the confirmation fades.

## Text

At most 3-5 words inside an object; longer explanation belongs in the caption or the voice. Numbers may
count; letters never morph. The key state must read at about 320 px displayed width without relying on
small text.

## Checklist before a scene is done

Look
- One light direction, one perspective per object, nothing clipped (objects or their shadows).
- Colour semantics hold: green only for resolved, red only for failure.
- No glow doing the job of a state change.

Motion
- Only one primary idea moves at a time.
- Anticipation brief, action decisive, a clean settle, then a readable hold.
- Travelling things follow the path that is drawn; occlusion is right.
- First and last frames are clean (they are what a transition shows).
- Nothing floats or bounces without a physical reason.

Phone
- The meaning is clear at 320 px wide; the active thing is obvious; lines are thick enough to read.

## Where the kit does not meet this yet

Known gaps, so nobody mistakes current behaviour for the standard:
- Many long-form templates pop elements in with an overshoot (`outBack`) and put a glow on headline numbers.
  New scenes should use the `enter` / `resolve` curves and reserve overshoot for physical impacts.
- Props bob gently when idle in `story`; under these rules idle objects hold still.
- Green and red are used by meaning in `compare` and `sim-poker`, but the accent colour is sometimes used
  for "resolved". Prefer green for the settled state.
