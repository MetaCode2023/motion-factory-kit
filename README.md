# Motion Factory Kit

**Turn Higgsfield clips into finished UGC ads, or make motion-graphics explainers from scratch, by asking Claude.**

You describe the video. Claude writes it as a small code "scene" and this repo builds a postable MP4:
TikTok-native text, word-by-word captions from the creator's own voice, product cards, reviews,
CTAs, music that ducks under the voice, sound effects, and several hook variants to A/B test.
Exact timing, no timeline editor.

![Three example videos made with the kit](docs/media/hero.gif)

**[See the examples with sound →](https://metacode2023.github.io/motion-factory-kit/)**

**Try it in one command, no API keys:** `npm install && npm run demo` cuts a bundled synthetic street-poll
shoot into finished vertical ads with a client review page ([examples/demo](examples/demo)).

**Plug it into your agent:** an MCP server exposes every step as a tool (index footage, check and write
edit plans, build, apply client feedback, render and *look at* frames). [docs/MCP.md](docs/MCP.md)

**Use all of it, or one piece.** Already have a pipeline? Point your agent at
[docs/MODULES.md](docs/MODULES.md): a checklist to compare against, and which pieces (word-exact cutting,
street-audio cleanup, face-following reframe, overlays, client review loop) lift out on their own.

## What's in it

**Make lots of ads**
- **Raw-footage editor** (`footage.mjs`): drop a client's Drive folder of footage in, get dozens of finished ads out.
  Clips are transcribed (with who's talking), Claude picks the best takes and writes an edit plan per ad, and the
  kit cuts them word-exact (no "um"s, no dead air, punch-in jump cuts), adds hooks, captions, B-roll, product cards
  and CTAs, and writes a delivery sheet for the media buyer. [docs/EDITOR.md](docs/EDITOR.md)
- **Street-interview ready**: the host's question as a card, name lower-thirds, "7/50" counters and a poll bar,
  placed from the edit plan. Street audio cleaned (wind, traffic, harsh "s") and every speaker levelled.
  Horizontal footage **follows the face** into vertical automatically.
- **Client review loop**: every batch gets a review page (approve / needs changes / notes per ad and hook);
  the exported feedback re-cuts **only** the flagged ads and sorts approved files for the media buyer.
- **12 proven ad templates**: 3 reasons, us vs them, before/after, testimonial stack, problem/solution,
  listicle, unboxing, green screen, raw edit, plus creator-native formats: rapid list (pictures swap on
  every spoken item), title explainer (creator over the thing, title pill), meme caption. [docs/TEMPLATES.md](docs/TEMPLATES.md)
- **Spreadsheet batches** (`batch-ads.mjs`): one template + one CSV = a folder of ads, with a delivery sheet.
- **Hook variants**: write three hooks, get three MP4s. **Every size**: `--formats 4:5,1:1,16:9`.
- **Other languages**: translated rows, multilingual narration, dubbed creator clips. [docs/LANGUAGES.md](docs/LANGUAGES.md)

**Make them look expensive**
- **Visual toolkit** (`kit/fx.js`): animated aurora backgrounds, glass cards, glow, gradient and kinetic type,
  camera punches, zoom/whip/circle/wipe/glitch/flash transitions, colour grades, film grain, motion blur.
- **Cuts on the beat**: the music's beats are detected and handed to the scene (`M.snap`, `M.onBeat`), and
  narrated pieces can time themselves from the real voiceover (`M.cues`).
- **32 building blocks** (`kit/blocks.js`): comment-reply sticker, TikTok text, product card, reviews, CTA,
  split screen, picture-in-picture, social post, browser window, emoji stickers and reactions, notifications,
  chat, checklists, stats, charts, phone frame, end card, street-interview overlays, photo panel, meme card. [docs/BLOCKS.md](docs/BLOCKS.md)
- **Seven caption styles** (pill, bold, box, minimal, karaoke, one-word pop, creator-native word) with keyword emoji.
- **Green screen**: creators cut out of green/blue backgrounds and placed over posts, pages or photos.
- **Higgsfield-ready** (`M.video`): any clip, any size or frame rate; its audio is mixed and its speech becomes
  captions. Or let Claude generate the footage through the Higgsfield connector. [docs/HIGGSFIELD.md](docs/HIGGSFIELD.md)

**Ship them**
- **One command per video** (`make.mjs`): picture, narration, captions, music ducked under the voice,
  effects, loudness for social, plus a cover image, a subtitles file and a drafted post caption.
- **Self-checking**: every build writes a PASS/FIX report and a still after every cut, so Claude fixes
  problems before you see them. A GitHub check re-renders the examples on every change.
- **Your brand in one file** (`brand.js`), **a sound library** (15 original effects and beds), a **design guide**
  Claude follows, and **Claude instructions** (`CLAUDE.md` + a `make-video` skill) for the whole workflow.

## Setup (5 minutes)

You need [Node.js 18+](https://nodejs.org), Python 3 for the checker, and
[Claude Code](https://claude.com/claude-code). For automatic face-tracking on raw footage:
`pip install opencv-python-headless`.

```bash
git clone https://github.com/MetaCode2023/motion-factory-kit.git
cd motion-factory-kit
npm install
node make.mjs scenes/examples/ugc-ad.html    # builds out/ugc-ad.mp4 (with placeholders until you add clips)
```

Optional, but worth it:

```bash
npm run demo                              # the footage editor end to end on bundled demo clips, no keys
claude mcp add motion-factory -- node "$PWD/mcp/server.mjs"   # the kit as tools for your agent (auto in this folder)
pip install faster-whisper opencv-python-headless   # local transcripts (no key) + face-following reframe
export ELEVENLABS_API_KEY=your_key        # narration + exact captions from speech (PowerShell: $env:ELEVENLABS_API_KEY="your_key")
claude mcp add --transport http higgsfield https://mcp.higgsfield.ai   # let Claude generate Higgsfield clips
```

Then edit `brand.js` with your name, colours and URL.

## Make videos

Run `claude` in this folder and ask. For example:

> I put a talking-head clip in assets/higgsfield/hook.mp4 and a product shot in assets/higgsfield/serum.mp4.
> Make a 15-second UGC ad for Glow Serum, $29. Give me 3 hooks.

> Make a 20-second explainer on why texting back missed calls beats voicemail. Dark, orange accent, narrated.
> Also give me feed and YouTube versions.

> Generate a Higgsfield clip of a creator unboxing our coffee grinder and build an ad around it.

Claude writes `scenes/mine/<name>.html`, builds it, checks the frames, fixes problems, and gives you
`out/<name>.mp4` (or `-v1`, `-v2`, `-v3`). Then just ask for changes: "hook 2 but punchier",
"product card earlier", "lower the music".

## By hand

```bash
node make.mjs scenes/mine/x.html                 # finished MP4 with sound and captions
node make.mjs scenes/mine/x.html --variants      # one MP4 per M.pick option
node make.mjs scenes/mine/x.html --formats 4:5,1:1,16:9   # plus feed, square and YouTube versions
node make.mjs scenes/mine/x.html --fast          # skip the picture score for quick drafts
node make.mjs scenes/mine/x.html --voice-only    # make narration first; prints each line's timing
node render.mjs scenes/mine/x.html --still 6.5   # one frame as a PNG
node footage.mjs index                           # raw footage -> transcripts + thumbnails (footage/INDEX.md)
node footage.mjs build edits/ --variants         # every edit plan -> finished ads + DELIVERY.csv + review.html
node footage.mjs feedback out/delivery/review.json   # client decisions -> FEEDBACK.md + approved/
node footage.mjs build edits/ --redo out/delivery/review.json   # re-cut only the flagged ads
node batch-ads.mjs scenes/templates/three-reasons.html data/example-ads.csv   # one ad per row
python score.py out/x.mp4                        # quality check
```

**Preview while editing:** open any scene file in Chrome. It plays with a scrub bar (space = play/pause,
arrows = one frame). Captions show with estimated timing; sound comes from `make.mjs`.

## How a scene looks

```html
<script src="../../brand.js"></script>
<script src="../../kit/motion.js"></script>
<script src="../../kit/blocks.js"></script>
<script>
const HOOK = M.pick(['POV: you found the fix', 'Stop scrolling if your skin hates winter']);
M.setup({ width: 1080, height: 1920, fps: 30, duration: 12, background: '#000',
  captions: true, music: { track: 'pulse', volume: 0.12 }, sfx: [{ at: 0, name: 'pop' }], draw });
const creator = M.video('../../assets/higgsfield/talking-head.mp4', { captions: true });
function draw(ctx, t) {
  creator.draw(ctx, t, 0, 0, 1080, 1920);
  B.nativeText(ctx, t, { at: 0, text: HOOK, y: 320 });
  B.productCard(ctx, t, { at: 6, name: 'Glow Serum', price: '$29', rating: 4.8 });
}
</script>
```

Everything is a function of time `t`, so every frame is exact and every render is identical.

## Folders

```
make.mjs render.mjs batch.mjs voice.mjs score.py   the tools
brand.js                                           your colours, fonts, logo
kit/motion.js  kit/blocks.js                       animation helpers and blocks
design/DESIGN.md                                   the style rules Claude follows
docs/                                              Higgsfield guide, block reference, the gallery page
scenes/examples/                                   showreel, ugc-ad, showcase, blocks-gallery, and more
scenes/templates/                                  the ad formats (spreadsheet-ready)
footage/  edits/  data/                            raw footage, edit plans, spreadsheets (git-ignored)
scenes/mine/                                       your scenes
assets/higgsfield/                                 your clips
sounds/                                            effects and music beds
fonts/                                             bundled open-source fonts
out/                                               renders (git-ignored)
```

## Checks on every change

`.github/workflows/check.yml` re-renders the examples and runs the tests on every push, and attaches
the videos and reports to the run. Fork it and your changes get the same safety net.

## License

Code and sounds: MIT. Fonts: SIL Open Font License (see `fonts/LICENSE.txt`). Emoji graphics:
Twemoji, CC-BY 4.0 (see `assets/emoji/LICENSE.md`).
