# Long-form YouTube: from a subject to a finished 16:9 video

For creators who explain things: a 10-minute video on the physics of poker, how money works, the future of voting.
The creator brings the subject and reads the script. Claude does the rest: it co-writes the script with the visuals
built in, then turns the recording into a finished video. That means animations every ~15 seconds, B-roll,
outside clips that back up the points, music, sound effects and captions. A Premiere timeline is included in
case anything needs a touch.

**Script first (new recordings), the main workflow:**

```
1. "What's the video about?"      Claude asks for the subject and the angle
                                    ("why people love poker, as a Trojan horse for quantum mechanics")
2. Script, together               Claude researches, outlines, drafts. Every visual is a [[cue]] in the text,
                                    one every ~15 s. You revise it until it's yours.
                                    node longform.mjs script x.script.md   -> runtime, visual cadence, teleprompter copy
3. You record it                  camera + mic, or just the mic. Read the reading copy. Flubbed a line? Just
                                    re-read it: the last take wins.
4. Approve the storyboard         node longform.mjs board edits/longform/x.json
                                    -> board.html, one finished-looking frame per cue; revise until "go"
5. Finished video                 node longform.mjs build edits/longform/x.json
                                    -> every approved cue on its word, fully rendered
```

**From footage you already have** (podcast archives): index the library, search everything you've said, and
write a plan from the best takes. See "Plans from existing footage" below.

```
out/longform/<name>/
  <name>.mp4              the video: picture, voice, music ducked under it, effects, YouTube loudness
  <name>.premiere.xml     the same edit as a timeline (Premiere, Resolve, FCP), pointing at your original files
  <name>.resolve.xml      Resolve-labelled FCP 7 XML
  <name>.fcpxml           modern Final Cut Pro timeline
  <name>.edl              portable CMX3600 cut list
  <name>.srt              captions for YouTube
  CHAPTERS.txt            paste into the description
  PULL-LIST.md            outside clips still to grab, with sources and timestamps
  REVIEW.md               harsh P0/P1/P2 second review; read this before REPORT.md
  REPORT.md               self-check (PASS/FIX) + the timeline
  <name>.inserts.jpg      one frame from every visual
  <name>.cuts-phone.jpg   360 px-wide strips from -0.2 s to +0.2 s around every cut
```

Try it with no recording and no keys: `node longform.mjs demo`. A synthetic voice reads
`examples/longform/physics-of-poker.script.md`, including a flubbed line and an ad-lib, and you get the finished video.

## The script

A Markdown file. Text is what you say. `## Headings` are chapters. `// lines` are notes for the writer that
aren't read aloud. `[[cues]]` are visuals, and each one lands on the word right after it.

```markdown
---
title: The Physics of Poker
theme: {"color": "#3CE0FF", "tint": "#0C1B2A"}     // every animation in this colour
captions: {"burn": true, "pop": 1.15, "highlight": true, "avoid_face": true}
cadence: 15                                         // target seconds between visuals (the check warns past ~27)
wpm: 150                                            // your reading pace, for the runtime estimate
base: backdrop                                      // optional: never show the camera (voice-only look)
---
## Every hand at once
[[quote text: You don't love poker for the cards. | highlight: cards]] You don't love poker for the cards.
[[stock poker cards face down on table]] You love it for the moment right before they're turned over.
[[stat value: 1,326 | label: possible two-card starting hands]] There are one thousand three hundred...
[[collapse dur: 7 | mark.flipAt: boom]] Then the river card comes. [[sfx hit]] Boom.
[[clip A famous televised bluff | url: https://youtu.be/... | from: 1:02 | to: 1:08 | audio: 0.6]] Which is why bluffing works.
[[face]] So next time you sit down at a table, remember...
```

| Cue | What it puts on screen |
|---|---|
| `[[story beats: bank=The Fed - creates money; coin=New dollars; person=You \| flow: coin \| layout: row/loop]]` | **Show it, don't write it.** Drawn objects pop in on the words that name them, joined by arrows with things flowing along them; the camera travels to follow. Objects: see `scenes/longform/props-gallery.html` (44: bank, ballot, camera, barrel, hospital, person, crowd, coin, chip, card, atom, eye...) |
| `[[count prop: card \| total: 221 \| highlight: 1 \| value: 1 in 221 \| label: ..]]` | A grid of objects; the ones that matter light up on the spoken number |
| `[[table3d board: Ks 9h 4d Jc \| river: Qs \| mark.flipAt: boom \| reveal: false]]` | **3D.** A poker table: the board is dealt and turned on its words, the camera drops in on the river |
| `[[globe3d points: New York; London; Tokyo; Riyadh=24.7,46.7 \| hub: New York \| value: 56.7% \| label: ..]]` | **3D.** A dotted globe: places light up as they are named, arcs fly between them, the globe turns to follow (about 45 place names built in, or `Name=lat,lon`) |
| `[[stacks3d bars: Rent=42; Food=27 \| prop: chip/coin \| unit: %]]` | **3D.** Amounts as stacks of chips or coins dropping in piece by piece, camera arcing around them |
| `[[stat value: .. \| label: .. \| sub: .. \| source: ..]]` | One big number counting up |
| `[[quote text: .. \| highlight: words \| by: ..]]` | A line, written big, key words lit (`by` only for a real quote) |
| `[[term term: .. \| definition: .. \| plain: ..]]` | A definition with an everyday translation |
| `[[compare left.title: .. \| left.items: a; b \| left.tone: bad \| right...]]` | Two sides, with a verdict |
| `[[steps steps: Title - body; Title - body]]` | A process building along a line |
| `[[bars bars: Label=42; Label=27 \| unit: % \| source: ..]]` | Amounts as growing bars |
| `[[line points: 1971=35; 2024=2400 \| notes: 1971=Gold window closes \| unit: .. \| source: ..]]` | A trend drawing itself, with labelled moments |
| `[[share slices: Income tax=50; Payroll=35; Other=15 \| center: ..]]` | Part of a whole: a ring filling slice by slice |
| `[[flow nodes: Bank - writes a loan; You - spend it; Store - deposits it \| labels: credit; pays \| loop: true]]` | How a system connects: boxes, moving arrows, an optional loop back |
| `[[timeline events: 1913=The Fed; 1971=Off gold; 2008=Bailouts]]` | Dated events, the camera tracking to the latest |
| `[[superposition]]` `[[collapse]]` `[[deception]]` | The poker x physics set (`scenes/longform/`) |
| `[[<any scene name> key: value]]` / `[[anim path.html]]` | Any 16:9 scene in `scenes/longform/`, including new ones Claude writes for this video |
| `[[stock <search>]]` | Free stock footage from Pexels (`node longform.mjs stock`) |
| `[[clip <title> \| url \| from \| to \| search \| audio]]` | An outside clip that backs up the point (see "Outside clips") |
| `[[broll <library clip> \| from: ..]]` / `[[image file]]` | Your own footage or a picture |
| `[[face]]` | Back to you on camera here (ends the previous visual) |
| `[[music drive 0.08]]` / `[[sfx hit]]` | Music from here / one effect on the next word |

Options on any visual: `dur` (seconds; default auto, which runs until the next visual, capped at 7 s on camera
and 12 s voice-only), `layout: side` (a framed box with you still on screen), `id`, `note`, `offset`.
On animations, `mark.<key>: <word>` lands a beat on that spoken word, e.g. the river flips on "boom".
`unit: none` / `prefix: none` blank out a default (an empty value keeps the default).

**Animations follow the words.** The build hands every animation the words spoken while it is on screen,
with their times. Each step, item, bar, slice, node, event, note or object appears when the speaker says it (its
label or `say:` words), the number finishes counting as it is said, and anything not said spreads evenly between.
Every template also drifts slowly, so nothing sits frozen after its last beat. Write cue labels with the words
the script actually uses and the sync takes care of itself.

**Captions can stay on throughout.** Set `"captions": { "burn": true }` in a plan (or the same `captions:`
JSON in the script header). Captions use 3–5 word groups and break on pauses of 150 ms or more. Mark a phrase
`*like this*` in the script to pop those spoken words in the accent colour; `underline`, `highlight`, `pop`,
`position: "top"` and `box: false` are optional style controls. The default dim box protects bright footage.
`avoid_face: true` with `face_area: "bottom"` moves captions to the top. Approved caption settings saved in
`scripts/SERIES.md` apply when a plan does not override them.

Transcription rejects words Whisper invents wholly inside detected silence (`-35 dB`, 0.6 s), and repeated
words are verified by position rather than matched to whichever duplicate is convenient. The build also
samples pulled clips for likely burned-in lower-third subtitles and flags them in REPORT.md. This check is
conservative; a flag means review/crop/replace the clip, not that OCR proved the words.

**Sound design comes with the animations.** Every template declares its own effects in `M.setup({ sfx })`,
timed to its own beats: a pop as a number lands, ticks while it counts, a pop per list item, a riser into a
reveal, a hit on the collapse. The build mixes them under the voice (and onto A3 in Premiere), plus a whoosh
on every full-screen cut. `[[sfx name]]` adds one more; `"scene_sfx": false` in the plan turns them off and
`"scene_sfx_volume": 0.4` makes them quieter. New scenes should declare theirs the same way.

**On camera or voice only.** If the recording has a picture, the gaps between visuals show you (with punch-ins on
the jump cuts), so the cadence of cues decides how often you're on screen. With an audio-only recording, or
`base: backdrop`, the gaps get an animated backdrop with big word-by-word captions.

**Retakes.** Flub a line and re-read it from the start of the sentence. The aligner keeps the last take and
cuts the earlier one. Ums and dead air come out automatically. Unscripted lines are kept and listed, so you
can drop any with `tighten.drop`/`cut` in the plan.

## 3D scenes

Scenes in `scenes/longform/3d/` are real 3D (three.js): lit objects, shadows, a camera that moves through
the space. They use the same cues, the same word timing and the same sound declarations as the 2D ones; the
build renders them through headless Chrome instead of the 2D engine.

- `kit3d.js` is the stage: lights, backdrop and camera paths, drawn-in-code playing cards, chips, coins, a felt
  table and a studio floor, plus a 2D HUD for titles and labels pinned to 3D points (`S.project`).
- A scene is one page: `const S = await stage(defaults)`, build objects, `S.run({ update(t), hud(c, t), sfx })`.
  `update` is a pure function of `t`. Copy `table3d.html` or `stacks3d.html` to start a new one.
- Check a frame: `node tools/longform/render3d.mjs scenes/longform/3d/table3d.html --still 6`.
- Needs Chrome (or Edge) installed, or `npx playwright install chromium`, and `npm install` (three is included).
  Software rendering works anywhere at roughly half a second per frame; set `MF_GPU=1` to use the graphics card.
- Use 3D where depth is the point (objects, places, things you could pick up); keep 2D for charts and words.

## Retention check

`node longform.mjs script` ends with a score out of 100 and notes on where viewers are most likely to leave:
a greeting or flat first 10 s, no promise by 45 s, 95 s+ with no question or turn, sentences over 34 words,
chapters over ~2:45 or under 25 s, the same visual twice in a row, more than ~30% word cards, no next step at
the end. They are heuristics: fix each one or decide it's fine. Figure visuals with no `source:` are warned about.

## Layouts

| Layout | What you see | Use it for |
|---|---|---|
| `full` (default) | the visual fills the frame | most visuals |
| `side` | a box beside the speaker | a clip or a small fact while they keep talking |
| `pip` | the visual fills the frame, the speaker stays in a corner circle | long explanations, so a face stays on screen |
| `split` | speaker on the left half, the visual on the right | simple visuals: one number, one object, 3D |

`[[stat: … | layout: pip]]` in a script, `"layout": "pip"` in a plan. `"face": { "x": 0.4 }` in the plan says
where the speaker sits across the frame if they're off-centre; `"pip": { "size": 300, "margin": 56 }` resizes the
circle. In voice-only videos there is no picture of the speaker, so `pip` and `split` become `full`. The Premiere
timeline shows them as full-frame clips.

Set `"pip": { "animate": true }` to start on the full-frame speaker, shrink them into the bottom-corner
circle as the visual arrives, then expand them back at the end. Static PiP remains the default for existing
plans; `size` and `margin` still control the settled circle.

### Text behind the speaker (opt-in)

`[[quote text: BREAKING NEWS | behind: true]]` (or `"behind": true` on an insert) puts that rendered visual
behind a transparent speaker for a news-desk look. It is **off by default** because high-quality matting is
large and slow. Configure a wrapper:

```json
"cutout": {
  "command": "python3",
  "args": ["tools/my-rvm-wrapper.py"],
  "ext": ".mov"
}
```

The wrapper is called once with `<input.mp4> <output.mov>` and must write full-frame alpha video (ProRes 4444,
qtrle, or VP9 alpha). Set `MF_CUTOUT_CMD` for a single executable with no extra arguments. Robust Video
Matting or BackgroundMattingV2 are suitable local models; install them separately and pin their model/license.
The cutout is cached and reused by all behind cues. Voice-only plans ignore `behind`. This repository ships
the compositing scaffold, not a multi-gigabyte model or weights.

## Transitions and camera

Full-frame visuals arrive and leave with a real transition instead of a fade, cycling through soft wipes,
slides, a circle open and a blur whip. When one visual runs straight into the next, it transitions from the
old picture to the new one (no flash of the speaker or backdrop in between); an `auto` length now runs right
up to the next full-frame visual for that reason.

- `"transitions": "fade"` in a plan (or `transitions: fade` in a script header) goes back to plain fades;
  `"transitions": ["smoothleft", "slideup"]` cycles your own list.
- `transition: circleopen` on one cue (or `"transition"` on one insert) sets that one. Names are ffmpeg
  xfade transitions (`smoothleft/right/up/down`, `slideleft/right/up/down`, `wipeleft/…`, `circleopen`,
  `circleclose`, `hblur`, `dissolve`, `fadeblack`, `zoomin`, `radial`, `pixelize`).
- `side` boxes still fade.

Every 2D template shares one camera (`LF.drift` in `lf.js`): it lands (arrives slightly close and settles),
pushes in slowly, and can go to a point when it matters (`focus: [{ at, x, y, zoom, hold }]`; `stat` pushes in
on the number while it counts, `line` goes to where the line ends). The first half second of every animation
is rendered with motion blur (`LF.blur`). New scenes: call `LF.drift` after the backdrop and add
`motionBlur: LF.blur` to `M.setup`.

## Drawn places, lit objects, carried figures

- **`place`**: a drawn establishing shot instead of stock footage: one building (`place: bank | capitol |
  hospital | factory | school | house`, or any prop name) on a street, in layers that slide at different speeds as
  the camera pushes in. People walk past (`people: 0-6`), a prop can rise out of the building (`rise: coin`,
  `ballot`, `cash`…), and a one-line `caption` lands on its word. Use it where you would reach for a stock shot
  of "a bank" or "the capitol".
- **Objects are lit.** Every prop in `props.js` is painted once into a sprite with light from the top left, shade
  at the lower right, soft shadows between its parts and a contact shadow under it. `flat: true` in `PR.draw`
  gives the old plain drawing.
- **Carried figures.** When a `stat`, `count` or `share` (with a `center`) is followed directly by another 2D
  visual, its number is still on screen when the next one starts, then shrinks into a chip in the top-right corner
  and stays for that visual. The two cross-dissolve so the number appears to stay put. `carry: false` on the
  second cue turns it off.

## Looks

One word restyles the whole video: every animation and the voice-only backdrop. In a script's header write
`theme: blueprint`; in a plan, `"theme": "blueprint"` (or `{ "style": "blueprint", "color": "#..." }` to
keep the look and change the accent).

| Style | Feel | Good for |
|---|---|---|
| `aurora` (default) | dark, soft colour fields, cyan | science, tech |
| `blueprint` | drafting grid on deep blue | how things work, engineering, systems |
| `noir` | black, one spotlight, yellow | surveillance, crime, power |
| `sunset` | plum to orange, low sun | history, endings, energy |
| `paper` | light ruled paper, red ink | money, taxes, voting, anything civic |
| `terminal` | green on black, scanlines | data, hacking, AI |

Pick one per video (or per series) so the videos don't all look the same. 3D scenes take the accent colour
only.

## Review, thumbnail, shorts

- **Self-review.** `REVIEW.md` is regenerated from only the resolved plan and key stills, so prior intent
  cannot excuse a confusing frame. It uses no numeric scores: every P0/P1/P2 note names the time, location,
  problem, exact change, and what must stay. The next editing session reads this before REPORT.md.
- **Readability.** REPORT.md flags copy that cannot be read in its screen time, declared text below 2.6%
  of the frame's short side, a blank/black first frame, and picture that does not change for 3 seconds.
  The phone-width cut sheet exposes flashes, duplicate frames, and awkward joins around every cut.
- **Review.** Every build writes `out/longform/<name>/review.html`. Send the folder (or open it yourself):
  watch, pause where something is off, type the note, press Add; Save notes downloads `<name>.review.json`.
  `node longform.mjs feedback <name>.review.json` writes `FEEDBACK.md`. Change only what the notes ask for
  in the script/plan and rebuild; untouched visuals come from the cache.
- **Thumbnail.** Two to four words that work at phone size, one accent word, one object from
  `props-gallery.html`. Write two or three different angles in `"thumbnails": [{...}, {...}]` if you want options.
- **Shorts.** Pick the 30-55 s stretches that stand alone (a surprising number, a clean analogy) and give
  each a title that is a hook, not the chapter name. Times are in the finished video.

## Setup

Run `node longform.mjs doctor` first: it lists what is installed and what is missing.

```bash
npm install
pip install faster-whisper            # local transcripts, no key (or set ELEVENLABS_API_KEY)
export PEXELS_API_KEY=...             # optional: free stock B-roll (https://www.pexels.com/api/)
```

Put your videos in `footage/library/`. Subfolders are fine. The folder is git-ignored, so it never gets
pushed. Then run `node longform.mjs index`. The first run on hours of footage takes a while because of
transcription. After that, only new files are processed. Already have transcripts? Put `<clip>.srt` or
`<clip>.words.json` next to each video and indexing takes seconds.

## Commands

| Command | What it does |
|---|---|
| `node longform.mjs script <x.script.md>` | Checks the script (cues, runtime at your pace, a visual every ~15 s, chapters) and writes `<x>.read.txt` for the teleprompter. |
| `node longform.mjs from-script <script> <recording> [--build]` | Transcribes the recording, aligns it to the script, and writes `edits/longform/<name>.json`. Reports retakes cut, ad-libs kept, and lines it couldn't find. |
| `node longform.mjs pull <plan>` | Downloads outside clips that have a `url` and `from`/`to` (needs yt-dlp). |
| `node longform.mjs index [dir]` | Transcribes and indexes everything. Writes `footage/library/.index/LIBRARY.md` (one row per clip with its topics), `<clip>.md` (every sentence numbered with times), and `<clip>.sheet.jpg` (12 frames). |
| `node longform.mjs search "bluffing"` | Ranks moments across the whole archive. Each hit is an anchor like `ep12#88` you can use directly in a plan. |
| `node longform.mjs clip <id>` / `words <id> [#n]` | One clip's sentences, or word timings for cutting false starts. |
| `node longform.mjs check <plan>` | Resolves the plan and lists every problem at once, then shows the timeline. |
| `node longform.mjs cut <plan> --preview` | Prints every source in/out and resulting timeline cut without rendering or changing files. |
| `node longform.mjs board <plan>` | Renders one representative still per cue into `board.html`. Save cue notes as review JSON, run `feedback`, revise, and get approval before a full build. |
| `node longform.mjs stock <plan>` | Downloads Pexels B-roll for `"stock"` inserts into `assets/broll/` and adds credits to `assets/broll/CREDITS.md`. |
| `node longform.mjs build <plan>` | Builds everything above. Rendered animations and cut pieces are cached, so rebuilds are quick. Animations render several at a time (`LONGFORM_JOBS=3` to set how many). Also writes `review.html`. |
| `node longform.mjs voice [clip ids]` | Measures how the creator talks from their indexed recordings (pace, sentence length, real phrases) into `scripts/VOICE.md`. Scripts are then timed at that pace. See `docs/PLAYBOOK.md`. |
| `node longform.mjs doctor` | Checks this machine: Node, packages, Python, transcription, Chrome for 3D, keys. Says what's missing and the one-line fix. |
| `node longform.mjs feedback <name>.review.json` | Turns the reviewer's notes into `FEEDBACK.md`: each note with what was on screen, what was being said, and which insert in the plan to change. |
| `node longform.mjs freeze <plan> --name <name>` | Saves an approved video's header, layouts, caption style, theme and transitions as the next version in `scripts/templates/`; also refreshes Allen's defaults in `scripts/SERIES.md`. |
| `node longform.mjs thumbnail <plan>` | Three 1280x720 thumbnails (`thumbnail-1..3.jpg`) from `"thumbnail": { "text", "accent", "prop", "kicker" }` in the plan. |
| `node longform.mjs shorts <plan>` | Vertical shorts cut from the finished video, one per chapter, or the ones in `"shorts": [{ "from", "to", "title" }]`. |

The same steps are MCP tools (`longform_index`, `longform_search`, `longform_words`, `longform_write_plan`,
`longform_stock`, `longform_build`, `longform_doctor`, `longform_feedback`, `longform_thumbnail`, `longform_shorts`). The build tool returns the inserts contact sheet as a picture.

## Plans from existing footage

`from-script` writes a plan for you. To edit from existing footage (a podcast archive), or to adjust a
generated plan, here is the format.

```jsonc
{
  "name": "physics-of-poker",
  "title": "The Physics of Poker",
  // The talking, in story order. Ranges can come from any clip, so one video can be stitched from
  // several podcast episodes. from/to: "#n" (sentence) or seconds/"m:ss". Omit both for the whole clip.
  "a_roll": [
    { "clip": "podcast-ep1" },
    { "clip": "podcast-ep2", "from": "#2", "to": "#9" }
  ],
  // Word-exact tightening: fillers (um, uh...) out, pauses over max_pause out, padded so words aren't clipped.
  "tighten": {
    "fillers": true, "max_pause": 0.45, "pad": 0.08,
    "drop": ["podcast-ep1#15"],                                      // whole sentences to lose
    "cut": [{ "at": "podcast-ep1#19", "text": "They're running um" }]   // a false start / repeat, by its words
  },
  // Alternate framing on jump cuts so they look intentional. focus = where the face is (0-1).
  "punch_in": { "every": 2, "zoom": 1.12, "focus": [0.43, 0.42] },
  "chapters": [{ "at": "podcast-ep1#1", "title": "Every hand at once" }, ...],   // 3+, each 10 s+
  "inserts": [ ... ],
  "music": [{ "at": 0, "track": "calm", "volume": 0.1 }, { "at": "podcast-ep1#12", "track": "drive", "volume": 0.09 }],
  "sfx":   [{ "at": "podcast-ep1#13", "name": "hit", "volume": 0.5 }],
  "side":  { "w": 960, "x": 896, "y": 96 }          // optional: where "side" inserts sit (keep it off the face)
}
```

**Anchors.** Anything with an `"at"` can be `"clip#n"` (the start of sentence n), `"clip@1:23.4"` (a source
time), or a plain number (seconds on the finished timeline). Add `"word": "river"` to land exactly on that word
inside the sentence, and `"offset": -0.3` to nudge. Anchors follow the cuts. Tighten the A-roll however you
like and every insert stays on its word.

### Inserts

| kind | Fields | What you get |
|---|---|---|
| `animation` | `scene`, `data`, `marks` | A code-drawn 16:9 scene (`scenes/longform/*.html`), rendered at the insert's length. |
| `broll` | `clip` + `from` (from the library) · `file` (your own) · `stock: "search"` | Footage, muted, cover-fit. |
| `image` | `file` | A still with a slow push-in. |
| `pull` | `title`, `url` or `search`, `from`, `to`, `note` | A labelled placeholder for a clip you'll grab yourself (a famous hand, a TV moment). It's listed in PULL-LIST.md and marked on the Premiere timeline. Save the clip as `assets/broll/<id>.mp4` and the next build uses it. |

Every insert takes `id`, `at` (+ `word`, `offset`), `dur` (seconds, 1.5–8 reads best), and
`layout: "full"` (cutaway; the voice keeps going) or `"side"` (a framed box with the speaker still visible).
`sfx` defaults to a whoosh on full inserts and a pop on side ones (`"sfx": null` for none). Inserts can't overlap.

**marks** put an animation's beat on a spoken word.
`"marks": { "flipAt": { "at": "podcast-ep1#13", "word": "boom" } }` sets `data.flipAt` to the number of seconds into
the insert where "boom" is said. The collapse scene flips the river card on it.

### Animations

Starters in `scenes/longform/`. All are data-driven (`M.data`), so a plan can reuse them with new words:

| Scene | Shows | Data |
|---|---|---|
| `superposition.html` | Face-down cards inside a cloud of flickering possible hands, with the range as weighted bars | `kicker`, `headline`, `accent`, `caption`, `hands: [{ label, cards, p }]` |
| `collapse.html` | The river flips (the measurement), the screen flashes, and a wave of outcomes collapses to one spike | `board`, `river`, `before`, `after`, `flipAt` |
| `deception.html` | Two hands make the same bet and read the same on the opponent's meter. Then the truth is revealed | `left`/`right: { cards, truth }`, `bet`, `reading` |

`scenes/longform/poker.js` has the drawing pieces (cards with drawn suits, chips, probability clouds, the
title block). To make a new animation, copy the closest scene. Keep `M.setup({ preset: 'youtube', duration: D.dur })`
and read every word and number from `M.data`. Check it with `node render.mjs <scene> --still 3`. One idea per
animation, readable in 2 seconds, with the payoff at the end of the insert, not the start.

## In Premiere

File → Import → `<name>.premiere.xml`. You get a sequence with:

- **V1 / A1:** the talking, cut from your **original files**, so you can roll, slip or undo any cut. Punch-ins are a Scale on Motion.
- **V2:** the inserts (animations and placeholders from `out/longform/<name>/media/`; library and stock B-roll from the original files).
- **A2:** music, **A3:** effects, **A4:** the preview mix (muted, for reference).
- **Markers:** the chapters, plus a marker on every clip still to pull.

Music ducking is baked into the preview, but not into the XML. In Premiere, tag the voice Dialogue and the music
Music in Essential Sound and turn on Ducking. If you move the project folder, Premiere asks you to relink, so
point it at the same files.

## Automatic B-roll

When the speaker names something you can picture ("China", "Las Vegas", "a casino", "Heisenberg"), the video cuts
to a 1.5-3 s photo of it while the voice carries on. Free-license sources only, no keys: Openverse (mostly Flickr)
and Wikimedia Commons, keeping CC0, public domain, CC BY and CC BY-SA. Pixabay and Pexels are used too if
`PIXABAY_API_KEY` / `PEXELS_API_KEY` is set.

```
node longform.mjs broll edits/longform/x.json --dry   # list the moments, download nothing
node longform.mjs broll edits/longform/x.json         # find, place, fetch, lock
node longform.mjs build edits/longform/x.json         # the cutaways are in the video; CREDITS.md lists every pick
```

- **Finding the moments** (`tools/broll/find.mjs`): the lexicon (`tools/broll/lexicon.json`: countries, cities, states,
  landmarks, settings, objects, a short list of historic scientists) matched longest phrase first. Lowercase
  place names ("fine china"), repeats within 60 s and words that could be a name ("Austin", "Jordan") are left out.
  Capitalised names the lexicon doesn't know are listed for review only.
- **Placing them** (`tools/broll/place.mjs`): gaps only. Never over a visual, the first 3 s or the last 8 s; at least
  6 s apart; one per 15 s on average; hard cuts in and out; captions stay on.
- **Reviewing**: `out/longform/<name>/BROLL.md` lists every moment, the search, the pick and why others were
  skipped. Change one in `edits/longform/<name>.broll.lock.json`: `"status": "drop"` or `"keep"`, a new `"query"`,
  or `"pick": 2`, then run `broll` again. Rebuilds use the locked picks.
- **Settings** in the plan: `"auto_broll": { "every": 15, "min": 1.5, "max": 3, "skip": ["Vegas"], "layout": "full",
  "force": [{ "at": "rec#41", "word": "Macau", "query": "Macau casino night" }] }`; `"auto_broll": false` turns it off.
- Searches are cached for 30 days in `assets/broll/.cache/`, media is saved once in `assets/broll/stock/`.
- Search moments and report rows stay in narration order. Candidate clips are ranked against the complete
  script line, and BROLL.md records a relevance score plus a plain-English reason. The dependency-free
  fallback compares narration to titles/tags. For real local image-text scoring, set `BROLL_RELEVANCE_CMD`
  to an executable that reads JSON lines (`text`, `image`, `media`) and returns
  `{"score": 0..1, "reason": "..."}`; an OpenCLIP/SigLIP wrapper can plug in without becoming a required
  heavyweight dependency.
- Wikimedia rate-limits busy servers (cloud sessions especially): the tool waits and retries, and falls back to the next
  source. Openverse often answers slowly; it retries those too. Paste CREDITS.md into the video description.

## Outside clips

Clips from other channels, news and TV make a point land ("here's the moment he folded the winning hand").
While writing the script, Claude finds specific moments with web search and writes them as
`[[clip title | url: .. | from: m:ss | to: m:ss]]`. Each one builds as a labelled placeholder until the clip is in
`assets/broll/<id>.mp4`. `node longform.mjs pull <plan>` downloads just those seconds with yt-dlp if you have it,
or you can save them yourself. `audio: 0.6` plays the clip's own sound under you.

Using someone else's footage is your call, and YouTube's Content ID can claim or block a video over it.
Keep each clip short (the report flags anything over 10 s), make it part of what you're explaining, talk
over it or right after it, and credit the source. Every pull is listed in PULL-LIST.md and as a timeline
marker, so you can review them before you post.

## What it doesn't do (yet)

- Automatic B-roll is photos only so far (with a slow push-in). Video from NASA, CERN, the Internet Archive and Commons is next.
- Animations render on your computer: a 10-minute video with ~40 visuals takes a few minutes the first time,
  and rebuilds reuse everything that didn't change.
- Burned-in captions are opt-in (`captions.burn: true`); an `.srt` is still always written.
- One shot of the speaker. Multi-camera switching isn't automatic. Put the second angle in the library and use it as `broll`.
