# Blocks

Ready-made pieces in `kit/blocks.js`, styled from `brand.js`. Load them in a scene:

```html
<script src="../../brand.js"></script>
<script src="../../kit/motion.js"></script>
<script src="../../kit/blocks.js"></script>
```

Every block is `B.name(ctx, t, { at, ...options })`, called from your `draw(ctx, t)`. `at` is when
it enters, `until` (where offered) when it leaves. Most return `{ bottom }` so you can stack the next
thing under it. Sizes assume a 1080 × 1920 frame. Anything with `at: 0` is fully visible on frame 0.

See them all moving: `node render.mjs scenes/examples/blocks-gallery.html`

![Blocks, part 1](blocks-1.png)
![Blocks, part 2](blocks-2.png)

## UGC / TikTok-native

| Block | Key options |
|---|---|
| `B.nativeText` | `text, x (centre), y, size=64, style: 'box' \| 'outline' \| 'plain', bg, color, until` |
| `B.commentReply` | `user, text, x, y, w` — the "Reply to @user's comment" sticker |
| `B.productCard` | `image (M.image), name, price, oldPrice, rating, reviews, badge, y` — slides up |
| `B.review` | `name, text, rating, verified, light` |
| `B.stars` | `x, y, size, rating` (fractional ok) |
| `B.ctaButton` | `text, x (centre), y, color, tapAt` — pops, pulses, optional tap |
| `B.tap` | `x, y` — finger tap ripple |
| `B.split` | `left, right` (clips or draw functions), `labels: ['BEFORE','AFTER']`, `mode: 'vertical' \| 'horizontal'` |
| `B.pip` | `layer` (clip or draw function), `x, y, w, h, radius` — picture-in-picture |

## Explainer UI

| Block | Key options |
|---|---|
| `B.notification` | `app, title, body, time, y, light` — drops in from the top |
| `B.chat` | `messages: [{ at, text, me }]`, `y, size, light` — typing dots before replies |
| `B.checklist` | `items: [{ at, text, ok }]` — checks pop, crosses strike through |
| `B.stat` | `value, prefix, suffix, decimals, label, size, align` — counts up |
| `B.compare` | `left: { title, items }, right: { title, items }` — before/after columns |
| `B.steps` | `steps: [{ at, title, sub }]` — numbered, connector fills |
| `B.bars` | `data: [{ label, value }], highlight, format` — grows in |
| `B.phone` | `drawScreen(ctx, x, y, w, h)` or `screen: clip`, `tilt` — phone frame |
| `B.toast` | `text, kind: 'good' \| 'bad' \| 'info', until` |
| `B.endCard` | `takeaway, cta, url` — logo/name, headline, button, URL |

Helpers: `B.brand` (merged brand settings), `B.balanced(ctx, text, width, font)` (even line breaks).

## Adding your own block

Copy one from `kit/blocks.js`, keep the `(ctx, t, { at, ... })` shape, read colours from `B.brand`,
and add it to `scenes/examples/blocks-gallery.html` so you can see it.
