# Ad templates

Ready-made ad formats in `scenes/templates/`. Each is one scene driven by data, so the same template
makes one ad (edit the defaults at the top) or a hundred (one spreadsheet row each):

```bash
node make.mjs scenes/templates/three-reasons.html --variants                 # the defaults, every hook
node batch-ads.mjs scenes/templates/three-reasons.html data/my-ads.csv --variants --formats 4:5
```

Every template lists its data keys in the comment at the top of the file. In a spreadsheet:
`product.name` style headers make nested values, `hook1`, `hook2`, `hook3` become the hook variants,
and `a | b | c` makes a list. `data/example-ads.csv` is a working example for `three-reasons`.

| Template | Format | Footage |
|---|---|---|
| `raw-edit` | Polish layer for ads cut from raw footage (`footage.mjs`, see EDITOR.md) | the A-roll + B-roll |
| `three-reasons` | "3 reasons why ___": hook, three numbered reasons, CTA | optional clip per reason |
| `us-vs-them` | Side-by-side comparison that builds row by row, verdict, CTA | none |
| `before-after` | Before full screen, split reveal, result, CTA | before + after clips or images |
| `testimonial-stack` | Reviews piling up, the rating, CTA | optional background clip |
| `problem-solution` | Problem, agitate (a stat), solution, CTA | optional clip for the solution |
| `listicle` | "5 things ___" countdown, a different transition per item | optional clip per item |
| `unboxing` | Product shots with drawn-on callouts, price reveal, CTA | 2-4 product clips |
| `green-screen` | Creator cut out over a post, web page or photo | creator on green/blue |
| `rapid-list` | Talking head with a framed picture that swaps on every spoken item, one-word captions | talking head + a picture or clip per item |
| `title-explainer` | Creator in the corner over the thing itself, title pill pinned, one-word captions mid-frame | background clip/photo + creator (green screen or plain) |
| `meme-caption` | One clip, one relatable line: shadow text over it, or a white meme card above it | one clip |

All of them: kinetic type, camera punches on cuts, a different transition into each beat, music +
effects, the cinematic grade, hook variants, and narration if you give them `voice` lines.

## Creator-native formats

`rapid-list`, `title-explainer` and `meme-caption` follow the look of creator-led brand content on Reels:
no grade, no effects, a quiet music bed, captions one word at a time as spoken (`captions: { style: 'word' }`),
and the hook as a title pill (`B.nativeText` with `style: 'dark'` or `'blue'`). In `rapid-list`, each
picture lands on the word that names it when real word timings exist (ElevenLabs key, or an A-roll from
`footage.mjs`). Edit plans can use the same look: `"captions": "word", "hookStyle": "dark"`.

## Ground rules baked in

- Compare against categories ("drugstore brands"), not named competitors, unless every claim is backed.
- Reviews and results must be real (or clearly labelled as examples/illustrative).
- No words inside generated footage; all text is drawn in code so it stays sharp and editable.

## Make your own

Copy the closest template into `scenes/mine/`, keep `M.data({...})` at the top with sensible
defaults, and build beats with `FX.timeline`. `kit/ad.js` has the shared pieces (`AD.hook`,
`AD.number`, `AD.cta`, `AD.background`, `AD.voice`, `AD.sfx`).
