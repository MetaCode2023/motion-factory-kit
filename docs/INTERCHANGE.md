# Interchange: the cut in and out of other editors

Send the A-roll cut to Premiere, DaVinci Resolve or Final Cut as an **xmeml timeline** or a **CMX3600 EDL**, trim
it there, and read the trimmed cut back into the kit to rebuild.

**Status: untested in external editors.** Nobody has opened these files in Premiere, Resolve or Final Cut yet, and
nothing here claims they import cleanly or round-trip there. The only round trip that is tested is inside the kit:
plan to xmeml to import, and plan to EDL to import, giving the same cuts within one frame
(`tests/interchange.test.mjs`). Whoever tries it in a real editor: follow `docs/INTERCHANGE-CHECKLIST.md` and record
the result in `docs/runs/`.

**Clean room.** The idea came from the owner's look at OpenShot, which is GPL-3.0; this repo is MIT. No OpenShot
code, presets or file formats were read, copied, ported or paraphrased. Everything here comes from the public Final
Cut Pro 7 XML (xmeml) format, the CMX3600 EDL convention, this repo's existing exporter (`tools/longform/premiere.mjs`)
and first principles. Anyone extending it must keep it that way: do not look at OpenShot source.

## Commands

```
node longform.mjs export <plan> [--edl] [--xml] [--df]      # default: both files
node longform.mjs import <plan> <cut.xml|cut.edl>
```

MCP tools: `longform_export_cut` (`plan`, `edl`, `xml`, `df`) and `longform_import_cut` (`plan`, `cut`).
`--flag value` pairs break `longform.mjs` flag parsing (a flag's value is read as a positional argument); the
export flags here are all booleans, so they are safe.

- `export` writes `out/longform/<name>/<name>.cut.xml` and `<name>.cut.edl`. It needs no build. It never writes
  `<name>.premiere.xml`, which belongs to `build`, so an export cannot overwrite a finished build's timeline.
- `import` writes `<plan>.imported.json` beside the plan (for `edits/longform/x.json`: `edits/longform/x.imported.json`).
  It never overwrites the plan itself; it does replace an earlier `<plan>.imported.json`.
  If the plan has a `"name"`, building the imported plan writes into the same `out/longform/<name>/` folder as the
  original; change `name` first to keep both.

## What export writes

### xmeml (`<name>.cut.xml`, from `tools/longform/premiere.mjs`)

| Track | Content |
|---|---|
| V1 | The A-roll pieces, pointing at the original files. Punch-ins are Basic Motion scale and center. |
| A1 | The A-roll sound, linked to V1 (only for clips that have audio). |
| V2 | Library B-roll (original file), and any insert that has been built (`media/` clip). Side layout is a scaled box. |
| A2 | Music, looped clip by clip, a static level per section. |
| A3 | Sound effects (only those the build mixed; a bare `export` has the plan's own). |
| A4 | `stems/mix.wav`, the preview mix, disabled. Only meaningful after a build. |
| Markers | One per chapter (`Chapter`, out -1) and one per pull placeholder (`PULL: <title>`). No marker colour is written. |

Sequence rate is the plan's `fps` (29.97 and 23.976 as NTSC timebase 30 and 24). Timecode is non-drop-frame from
00:00:00:00. Each clipitem's `<in>` and `<out>` are counted in the clipitem's own `<rate>`, which is the sequence
rate; a source whose frame rate differs keeps its own rate in its `<file>` element. Equal-rate output is
byte-identical to the exporter before this change (pinned by a hash in the test).

**Dropped from the xmeml:** transitions; the pip circle and split layouts (inserts are exported as plain full
frame or the side box); captions (the `.srt` is separate); insert audio; music ducking; voice clean-up; side
borders. Inserts that have no media (animations and the like before a build) are left off V2 and listed in the
warnings (`<id>: has no media yet (build the video to render it), so it is left off V2`).

### EDL (`<name>.cut.edl`, from `tools/longform/edl.mjs`)

Cuts only, one event per A-roll piece, in output order.

```
TITLE: <plan title>
FCM: NON-DROP FRAME            (DROP FRAME with --df)

001  A        B     C        00:00:00:15 00:00:01:15 01:00:00:00 01:00:01:00
* FROM CLIP NAME: a.mp4
* SOURCE FILE: /full/path/a.mp4
```

- **Record start is 01:00:00:00** (the convention). Record times are the same frames as the xmeml start/end.
- **Source time** is the file's embedded start timecode (the `timecode` tag ffmpeg reports, read by
  `probe().tc` in `tools/longform/common.mjs`; 00:00:00:00 when there is none) plus the position in the file. Without
  the offset, an editor conforming camera files lands in the wrong place.
- **Reel** is the library clip id, upper-cased, letters and digits only, 8 characters, made unique
  (`long-clip-one` and `long-clip-two` become `LONGCLIP` and `LONGCLI2`).
- **Track:** `B` picture and sound, `V` picture only (a clip with no audio), `A` sound only (voice-only clips).
- **Drop-frame** only with `--df` and only at 29.97 or 59.94; any other rate throws
  `drop-frame needs 29.97 or 59.94 (got <fps>)`. The default is non-drop-frame.
- Dropped: everything except the A-roll cuts (no inserts, music, markers, effects or transitions).

## Importing: `importCut` (`tools/longform/interchange.mjs`)

`importCut(text, kind, lib, { fps, probe })` with `kind` `'xmeml'` or `'edl'`. It is three steps, each a function:
**parse** (read the file into events and reject what the kit cannot represent), **match** (each event's media to a
library clip, `matchClip`) and **validate** (no gaps or overlaps on the picture track). `fps` is the plan's fps (the
EDL has no frame rate of its own); `probe` is injectable (it is only used to read a file's timecode tag for EDL
source offsets). It never throws: problems come back in `errors`.

### Result shape

```
{ a_roll: [{ clip: 'a', from: 3, to: 4, tighten: false }, ...],   // [] whenever errors is not empty
  errors:   ['V1 clip 2 ("a"): speed change or time remap is not supported (...)', ...],
  warnings: ['A1 clip "a" at 00:00:01:06 does not line up with V1; audio follows picture (split edits are ignored)', ...] }
```

`from` and `to` are seconds in the original file, to 3 decimals. `tighten: false` on every range: the cuts are
already tightened, and tightening again would change the round trip. The order is the timeline order, so
reordering in the editor reorders the plan.

`importPlan(planFile, cutFile, { lib, probe })` picks the format from the extension (`.xml` xmeml, `.edl` EDL;
anything else returns `can't tell the format of "<file>" (use .xml for xmeml or .edl)`), runs `importCut`, and on
success writes `<plan>.imported.json` (the plan with only `a_roll` replaced) and resolves it like `check` does:

```
{ ok, file, a_roll, errors, warnings, check: { errors, warnings } }
```

`ok` is true only when import had no errors and the resolved plan has none either. `file` is null when import had
errors (nothing is written). If `check.errors` is not empty (typically an insert anchored to speech that is no
longer in the cut), the file is still written so it can be fixed by hand; the original plan is untouched.

### What import accepts

- V1 cuts of **original library files**, in any order, trimmed. If V1 has no clips (a voice-only plan), A1 is used.
  For an EDL, events on a picture track (`V`, `B`, `AA/V` and so on) are used; if there are none, the audio events.
- V2 and above, and A2 and above, are ignored without comment (music, effects, inserts are re-planned by the kit).
- Basic Motion and Audio Levels effects are read past without error.

### What import rejects (exact messages; `<where>` is `V1 clip 2 ("name")` for xmeml, `event 3 (reel A)` for EDL)

| Case | Message |
|---|---|
| Speed change or time remap (xmeml `<speed>` not 100, a Time Remap filter, or source length differing from timeline length; EDL `M2`) | `<where>: speed change or time remap is not supported (the build cuts at normal speed)` |
| Transition (xmeml `transitionitem`; EDL event type other than `C`: `D`, `W`, `K`) | `<where>: transitions are not supported (cut straight between clips; the build adds its own transitions)` for xmeml, `<where>: transition D (dissolve, wipe or key) is not supported (cut straight ...)` for EDL |
| Nested sequence | `<where>: nested sequences are not supported (flatten the nesting to the original clips)` |
| Generator or title | `<where>: generators and titles are not supported on V1 (use the original footage)` |
| Black (EDL reel `BL`) | `<where>: black (reel BL) is a gap or generator, not footage` |
| Any other effect | `<where>: effect "<name>" is not supported (only Basic Motion and Audio Levels are read)` |
| Gap on the picture track (including before the first clip, xmeml) | `V1 has a gap of 10 frames at 00:00:01:00 (close it in the editor, or the cut will not match)` (`The EDL has ...` for an EDL, `A1 has ...` when A1 is used) |
| Overlap | `V1 has an overlap of N frames at <tc> (trim it in the editor, or the cut will not match)` |
| No library match | `<where>: no library clip matches "<name>" (<path>); index the original file (node longform.mjs index) or relink to it` |
| Two library matches | `<where>: "<name>" matches more than one library clip: a (/x/a.mp4), a-2 (/y/a.mp4); relink the clip to the original file` |
| No clips at all | `the cut has no V1 or A1 clips to import` |
| Unreadable XML | `can't read the XML: <reason>` |
| No sequence in the XML | `no sequence found in the XML (export a sequence, not a bin)` |

All problems in a file are collected, so one run lists everything to fix.

### What import warns on (and still imports)

| Case | Message |
|---|---|
| Audio that does not line up with its picture (split edit; xmeml A1 against V1, EDL audio-only events) | `A1 clip "a" at 00:00:01:06 does not line up with V1; audio follows picture (split edits are ignored)` / `audio event 3 at <tc> does not line up with picture; audio follows picture (split edits are ignored)` |
| Basic Motion scale differs between V1 clips | `Basic Motion scale differs between V1 clips; punch-ins are recomputed by the build, so the scale is ignored` |
| An insert in the plan placed by a number of seconds (`importPlan` only) | `inserts[2] (id) is placed at 12s of output time; the new cut can differ, so it will not move with the speech (anchor it to a word with clip#sentence instead)` |

### The clip matching rule (`matchClip(lib, { path, name, duration })`)

1. **Path:** the resolved path equals a library clip's resolved `file` (case-insensitive on Windows). A path match
   is final and never ambiguous.
2. **Name plus duration:** otherwise, library clips whose file name equals `name` (case-insensitive) and whose
   `duration` is within 0.5 s of the file's. xmeml supplies the name, the path from `<pathurl>` and the duration
   (`<file><duration>` frames over the file's rate). An EDL has no duration, so the name alone decides; the name is
   `* FROM CLIP NAME`, else the file name in `* SOURCE FILE`, else the reel.
3. One candidate matches; two or more is an error that lists every candidate; none is an error.

Returns `{ id, how: 'path' | 'name' }` or `{ error }`.

### Timecode rules (`tools/longform/timecode.mjs`)

- `rateOf(fps)` returns `{ timebase, ntsc, fps }`; 23.976, 29.97, 59.94, 47.952 and 119.88 are NTSC (real rate is the
  timebase times 1000/1001). Timecode counts frames at the integer timebase.
- `framesToTC(n, rate, { df })` and `tcToFrames(tc, rate, { df })`. Drop-frame skips the numbers :00 and :01 (:00 to :03
  at 59.94) at the start of every minute except each tenth, so at 29.97 frame 1800 is `00:01:00;02` and frame 17982
  is `00:10:00;00`. A `;` before the frames means drop-frame when `df` is not passed. Drop-frame at any other rate
  throws; a timecode that cannot exist in drop-frame (`00:01:00;00`) throws.
- EDL import converts timecode at the plan's fps (and drop-frame if `FCM: DROP FRAME`), then subtracts the matched
  file's embedded timecode (`probe(file).tc`) to get the position in the file. xmeml `in`/`out` are file-relative
  already and are converted with the clipitem's own rate.
- The EDL's first record time is taken as the start of the cut, whatever it is (01:00:00:00 and 00:00:00:00 both work).

## Tested versus untested

| Tested (`tests/interchange.test.mjs`, offline) | Not tested |
|---|---|
| xmeml structure (V1/A1 links, in/out, markers), equal-rate output unchanged | Opening any of these files in Premiere, Resolve or Final Cut |
| Mixed-rate in/out in the clipitem rate, A1 clipindex with silent clips | Whether an editor accepts the xmeml or the EDL without repair |
| EDL reels, TC, comments, FCM, source offsets, drop-frame | Whether the mixed-rate in/out fix matches what editors expect (checklist item 1) |
| Timecode round trips at 8 rates, known drop-frame values | Files written by an editor (only hand-written fixtures of the same shape are tested) |
| Import accept, reject and warn cases; matching | Relink behaviour; what an editor writes for a reordered or trimmed cut |
| plan to xmeml to import, plan to EDL to import (also 29.97 drop-frame, 25 fps source in a 30 fps sequence): same cuts within one frame | |

## Where things are

| File | What |
|---|---|
| `tools/longform/timecode.mjs` | rates, frames, SMPTE timecode |
| `tools/longform/xml.mjs` | minimal XML reader (no dependency) |
| `tools/longform/premiere.mjs` | xmeml writer (`premiereXML(R, plan, { accent, probe })`; pushes skipped inserts to `R.warnings`) |
| `tools/longform/edl.mjs` | `edlExport`, `parseEDL` |
| `tools/longform/interchange.mjs` | `readXmeml`, `matchClip`, `importCut`, `importPlan` |
| `tests/interchange.test.mjs`, `tests/interchange-fixture.mjs` | tests and the shared fixture (fake library, fake probe) |

Why the choices are the way they are: `docs/DECISIONS.md` (the 2026-11-19 interchange entries).
