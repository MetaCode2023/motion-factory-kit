# Interchange: manual checklist for a person

Nothing in `docs/INTERCHANGE.md` has been opened in Premiere, Resolve or Final Cut. This is the list for the first
person who tries. Do the whole list once per editor you have, note what broke, and write the result up (last section).
You need a plan that has been built at least once, so the footage is indexed and `out/longform/<name>/` exists.

Use a short plan (1 to 3 minutes) with a punch-in or two and a library B-roll insert. Keep a copy of the plan file.

## 0. Export

```
node longform.mjs export edits/longform/<name>.json
```

Files: `out/longform/<name>/<name>.cut.xml` (xmeml) and `<name>.cut.edl`. Read the warnings it prints (inserts with
no media are expected before a build).

## 1. First thing to check, in any editor: the in/out points

The xmeml's `in`/`out` are now written in the sequence's frame rate (they used to be in the source file's rate). This
is the least certain change. After import, play three clips whose source frame rate differs from the sequence
(a 25 or 29.97 fps file in a 30 fps plan) and compare the first spoken word of each with the finished video.
- [ ] Each clip starts on the same word as in the built video (within a frame).
- [ ] If clips start early or late by a fixed ratio (for example 25/30), the fix is wrong for this editor: record it and stop.

## Premiere Pro

1. File > Import > `<name>.cut.xml`.
   - [ ] A sequence appears with V1/A1 (talking), V2 (B-roll), A2 (music), A3 (effects), A4 (muted mix) and markers.
   - [ ] Record any dialog or error it shows.
2. Relink: if media shows offline, right-click > Link Media, point at the original footage folder.
   - [ ] Relinks to the original files, not copies.
3. Trim: roll or slip two cuts, move one clip to a different place on V1, delete one clip and close the gap
   (ripple delete). Do not add transitions, speed changes, titles or effects.
4. Re-export: File > Export > Final Cut Pro XML (the xmeml), and separately an EDL (File > Export > EDL, tick video and audio tracks).
5. Bring it back (two commands, one per file):
   ```
   node longform.mjs import edits/longform/<name>.json path/to/premiere-export.xml
   node longform.mjs import edits/longform/<name>.json path/to/premiere-export.edl
   ```
   - [ ] `ok: true` (or the error is one of the documented messages in `docs/INTERCHANGE.md`).
   - [ ] The warnings match what you did (split audio only if you split an edit).
   - [ ] `edits/longform/<name>.imported.json` has one `a_roll` range per V1 clip, in the new order.
6. Rebuild: `node longform.mjs build edits/longform/<name>.imported.json`. Watch the result.
   - [ ] The cuts sit where you put them (within a frame). Inserts anchored to words follow the speech.

## DaVinci Resolve

1. File > Import > Timeline, pick `<name>.cut.xml` (or the `.edl`). For the EDL set the frame rate to the plan's fps and,
   for a drop-frame plan, use the drop-frame timeline setting.
   - [ ] Timeline appears; record any import dialog.
2. Relink: Media Pool > right-click the offline clips > Relink Selected Clips, point at the original footage.
3. Trim, move and ripple delete as above. No transitions, speed changes, titles or effects.
4. Re-export: File > Export > Timeline > "FCP 7 XML" (xmeml) and "CMX 3600 EDL". For the EDL, check "Use Source TC" is on (it should match the clip's timecode) and re-export.
5. `node longform.mjs import ...` for each, then rebuild (as in Premiere steps 5 and 6).
   - [ ] If Resolve conformed the EDL to the wrong place, the clips' timecode tag is the first suspect: compare the
     file's `timecode` (`ffmpeg -i file`) with the first event's source timecode in `<name>.cut.edl`.

## Final Cut Pro (7, or X through an xmeml converter)

1. FCP 7: File > Import > XML. FCP X: only through a converter app that reads xmeml (record which one).
   - [ ] Imports; record dialogs.
2. Relink, trim, move, ripple delete (as above).
3. Export XML (FCP 7: File > Export > XML, version 4), then `node longform.mjs import ...` and rebuild.

## Record the result

Write `docs/runs/<date>-interchange-<editor>.md` (format: `docs/runs/README.md`) with, per editor: the version,
which of the checkboxes passed, the exact text of any dialog, error or `longform.mjs import` message, and which
files you used (names only, no private footage). Then:

- Passed everything: update the "Status" paragraph at the top of `docs/INTERCHANGE.md` for that editor, and `docs/STATUS.md`.
- Something failed: add the case to `tests/interchange.test.mjs` first (a fixture of what that editor wrote), then fix the code.
- The in/out check in section 1 failed: that is decision 5 in `docs/DECISIONS.md`; revisit it with the evidence.
