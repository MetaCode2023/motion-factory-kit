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
4. Finished video                 node longform.mjs from-script x.script.md recording.mp4 --build
                                    -> aligned word by word, retakes cut, every cue on its word, built
```

**From footage you already have** (podcast archives): index the library, search everything you've said, and
write a plan from the best takes. See "Plans from existing footage" below.

```
out/longform/<name>/
  <name>.mp4              the video: picture, voice, music ducked under it, effects, YouTube loudness
  <name>.premiere.xml     the same edit as a timeline (Premiere, Resolve, FCP), pointing at your original files
  <name>.srt              captions for YouTube
  CHAPTERS.txt            paste into the description
  PULL-LIST.md            outside clips still to grab, with sources and timestamps
  REPORT.md               self-check (PASS/FIX) + the timeline
  <name>.inserts.jpg      one frame from every visual
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

## Setup

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
| `node longform.mjs stock <plan>` | Downloads Pexels B-roll for `"stock"` inserts into `assets/broll/` and adds credits to `assets/broll/CREDITS.md`. |
| `node longform.mjs build <plan>` | Builds everything above. Rendered animations and cut pieces are cached, so rebuilds are quick. |

The same steps are MCP tools (`longform_index`, `longform_search`, `longform_words`, `longform_write_plan`,
`longform_stock`, `longform_build`). The build tool returns the inserts contact sheet as a picture.

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

- Stock comes from Pexels only (free key). Other sources go through `clip`/`pull` + `assets/broll/`.
- Animations render on your computer: a 10-minute video with ~40 visuals takes a few minutes the first time,
  and rebuilds reuse everything that didn't change.
- No burned-in captions. Upload the `.srt` to YouTube instead.
- One shot of the speaker. Multi-camera switching isn't automatic. Put the second angle in the library and use it as `broll`.
