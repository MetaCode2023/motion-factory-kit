# Titles: opening, chapter and end cards

Three title cards for long-form videos, in the kit's own look. Code: `kit/titles.js` (global `TT`). Scenes:
`scenes/longform/title.html`, `chapter.html`, `endcard.html`. Tests: `tests/titles.test.mjs`.

**Clean room.** The idea of "title templates" came from the owner looking at OpenShot, which is GPL-3.0. This repo
is MIT. Nothing here is copied, ported or paraphrased from OpenShot code, presets, masks or title templates, and
nobody working on this should open that source. The cards were written from this repo's own code
(`kit/fx.js`, `scenes/longform/lf.js`), `design/MOTION-RULES.md`, `design/motion-tokens.json` and first
principles. Keep it that way.

## What already existed (not new, do not rebuild)

| Piece | Where | Use it for |
|---|---|---|
| Quote card | `scenes/longform/quote.html` | A line written big with key words lit |
| Stat callout | `scenes/longform/stat.html` | One number counting up |
| Kicker + headline helper | `LF.title` in `scenes/longform/lf.js` | A heading inside another template |
| Definition card | `scenes/longform/term.html` | A term and its plain meaning |
| Short-form blocks | `B.lowerThird`, `B.endCard`, `B.stat`, `B.questionCard` in `kit/blocks.js` | 9:16 ads and street interviews |
| Short-form title | `scenes/templates/title-explainer.html` | A title pill over footage |
| Safe-zone check | skia engine `textOnly` mode plus `M.PRESETS.youtube.safe` | Measuring where text lands |

## What is new

| Piece | Where |
|---|---|
| Opening title | `TT.opening`, `scenes/longform/title.html` |
| Chapter card | `TT.chapter`, `scenes/longform/chapter.html` |
| Long-form end card | `TT.endCard`, `scenes/longform/endcard.html` |
| Brand theme for short-form | `TT.themeFromBrand()` |
| Width cap on the lower third | `maxW` on `B.lowerThird` (docs/BLOCKS.md) |

Not built yet: a lower third drawn OVER the speaker. Every long-form insert is opaque (no alpha), so it needs a new
`over` layout and an alpha intermediate. That waits on PR #3 (`key: 'alpha'`). See "Known limits".

## Data keys

Every scene also takes the usual theme keys: `style` (aurora, blueprint, noir, sunset, paper, terminal), `color`,
`tint`, and `dur` (seconds; the build sets it from the insert).

| Scene | Key | Meaning | Limit |
|---|---|---|---|
| `title` | `kicker` | Small mono label above the title ("PART ONE"), shown in capitals | 60 characters, one line |
| | `title` | The title | up to 3 lines, shortened with an ellipsis past that |
| | `sub` | One line of context under it | up to 2 lines |
| `chapter` | `n` | Chapter number. `2` or `"2"` shows `02` | 4 characters |
| | `title` | The chapter's name | up to 3 lines |
| `endcard` | `title` | What to watch next, or a thank you | up to 3 lines |
| | `cta` | Pill text ("Subscribe for the next one") | 60 characters, one line |
| | `url` | Address in mono type | 48 characters |

Examples (the scene is a path in a plan insert):

```json
{ "id": "open", "kind": "animation", "at": 0, "dur": 5, "layout": "full", "scene": "scenes/longform/title.html",
  "data": { "kicker": "Part one", "title": "Why money works the way it does", "sub": "A first look at the machine" } }
{ "id": "ch2", "kind": "animation", "at": "clip#14", "dur": 3.5, "layout": "full", "scene": "scenes/longform/chapter.html",
  "data": { "n": 2, "title": "How a loan creates a deposit" } }
{ "id": "end", "kind": "animation", "at": "clip#40", "dur": 8, "layout": "full", "scene": "scenes/longform/endcard.html",
  "data": { "title": "Thanks for watching", "cta": "Subscribe for the next one", "url": "example.com/next" } }
```

## Using them

**As a script cue.** Any scene name in `scenes/longform/` is a cue, so these work:

```
[[title kicker: Part one | title: Why money works the way it does | sub: A first look at the machine]]
[[endcard title: Thanks for watching | cta: Subscribe for the next one | url: example.com/next]]
```

**Chapter is the exception.** `chapter` is a reserved cue word in `tools/longform/script.mjs` (line 68), so
`[[chapter ...]]` does NOT reach `chapter.html`. Use the path form:

```
[[anim scenes/longform/chapter.html | n: 2 | title: How a loan creates a deposit | dur: 3.5]]
```

A `## Heading` in a script makes a YouTube chapter in the plan (the timestamp list); it does not draw a card. Add the
card cue next to it if you want one on screen.

**Timing.** Title and chapter cards read in about 3 to 5 seconds, an end card needs 5 to 20 seconds (YouTube's rule for
end screens). The first card word lands at 0.15 to 0.4 s, the last element at about 1.1 s, then it holds still.

**From your own scene.** Load `kit/motion.js`, `kit/fx.js`, `scenes/longform/lf.js` (optional) then `kit/titles.js`, paint
a ground, call `TT.opening(ctx, t, { kicker, title, sub, at }, theme)`, paint the vignette. See `title.html`, it is 25 lines.

## Theming

`th` is the object `LF.theme(D)` returns: `color` (accent: the rule, kicker, numeral, pill), `ink` (titles), `muted`
(sub line, url), `deep` (text on the pill), `light`. The six looks (`style`) and plan-level `theme` all apply, and the
template test renders every scene in a dark and a light look.

For short-form (`brand.js` instead of a plan theme): `const th = TT.themeFromBrand()` returns the same shape from
`window.BRAND`, and adds `fonts: { display, mono }` which `TT` also honours.

## How it is built (for the next agent)

- `TT.*` draw the foreground only. The scene paints `LF.backdrop` first and `LF.vignette` last. That keeps the scenes thin.
- The content box is `M.safe`, which `M.setup({ preset })` sets (`youtube`: 96, 54 to 1824, 1000). Type is fitted into it
  with `M.fitFont`, and `fitText` shortens the string until it fits, so nothing can run past the safe zone.
- Sizes scale by `u = min(1, safeWidth / 1200)`, so a narrower box gets smaller type. Layouts are tuned for 16:9.
- Motion follows `design/MOTION-RULES.md`: one thing moves at a time (rule, then label, then title, then sub line), arrivals
  use `LF.E.enter` (falls back to `M.ease.outExpo` when `lf.js` is not loaded), labels never scale or glow after arriving,
  no overshoot, no camera drift, so the last frame is clean for a transition.
- The end card keeps `TT.endScreenZone()` (the right half of the safe box) empty. It draws nothing there, not even a guide.

## What is tested, and what is not

`tests/titles.test.mjs`, offline and fast (about 1 s):
- every title scene draws text at t = 0.5, 1.5 and 3 s
- with strings of about 190 characters, the pixels of text stay inside `M.PRESETS.youtube.safe` at 0.5, 1.5, 3 and 5.9 s
- the end card's text stays left of the half way line, with short and long strings
- `B.lowerThird` honours `maxW`, and the default stays 940
- the script cue forms above resolve to the right scenes and data
- `tests/longform.test.mjs` also renders every scene in `scenes/longform/` in a `noir` and a `paper` look

Not tested: how it looks (judge it with a still: `node render.mjs scenes/longform/title.html --still 3`), the shapes
(the safe-zone test runs in text-only mode, so the rule and pill are not measured; they sit inside the same box by
construction), light themes against the safe zone, vertical frames, non-English text, and a real YouTube end screen
over the empty half.

## Known limits

- Titles over a long unbroken word (a URL as a title) can still be too wide: shortening works on characters, and the
  smallest type size is about half the large one.
- Chapter and end card are 16:9 designs. They run at other sizes without leaving the box, but are not tuned for them.
- The end screen's zone is the right half, a safe simplification of where YouTube places elements. Check one in YouTube Studio.
- No lower third over the speaker (`over` layout, alpha): after PR #3. Until then `B.lowerThird` works in short-form scenes only.
- A plain `## Heading` in a script does not draw a chapter card.
