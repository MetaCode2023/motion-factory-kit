# Run report: "You Are Made of Dead Stars" (one-shot, 59-upgrade brief), 2026-11-24

**The brief:** a 60 s vertical Short + a 16:9 cut, script first, real NASA/ESA/JWST/Pexels video over stills, two
or more match cuts, a silence beat, hand bookends, beat-coloured pop captions, three hook versions, a fact-checked
notes file, a self-grade and lessons. Approved by Austin with "Run it" and up to 46 credits ("Ok go").

**What came out:** `scenes/mine/dead-stars/` → three 9:16 versions (A "This hand is 13 billion years old" 50.1 s,
B "Don't look at your hand" 52.7 s, C "The gold in your ring came from two dead stars" 49.9 s), a native 1920×1080
cut (`--data '{"wide":true}'`), covers, SRTs, post captions. Plan, shot list and every call on a conflicting
upgrade: `scenes/mine/dead-stars/PLAN.md`. Fact check: `/mnt/project-files/dead-stars/notes.md`.

## How it was made (so the next one is faster)
1. Script locked first (~120 words, question ladder), with the hedges the science needs ("most gold",
   "almost all of you"), then a source table for every claim.
2. One narration take for all three hooks + body (Higgsfield seed_audio, 5.4 credits), transcribed, cut into
   lines by `prep.py` (speechCut rule), body times relative to the chosen hook so one timeline serves 3 variants.
3. **Real video B-roll**: 7 NASA/ESO/ESA-Hubble clips + 6 Pexels clips used (21 downloaded). This needed one
   environment change (Austin approved): the agency and Pexels CDNs are now on the Default allowlist.
   How-to: `docs/VIDEO-SOURCES.md`.
4. Score and all effects synthesized in `sound.py` from the same cues: rising drone, accelerating collapse
   pulses, a 0.32 s total drop-out before the supernova hit, a real gravitational-wave chirp shape
   (f ∝ (t_c − t)^−3/8) into the collision, a full second of silence on black, heartbeat under every hand shot,
   a warm chord that resolves on the loop point.
5. Scene: shot list as data (clip, range, speed ramp, zoom), zoom-through cuts with sub thumps, a periodic table
   that lights element by element on its word, captions in 2-4 word chunks with IRON/GOLD/YOU popping in the
   beat colour, the end shot running the hero clip *into* the frame the video opened on (seamless loop).
6. Checked stills and the cuts sheet, fixed (a NASA clip's title card and interview, caption spacing, end text
   under the last caption), rendered. Four more passes for the report's right-rail FIXes: the dare and the
   screenshot line were fitted to 86% width (now 70% when they sit beside the rail), captions to 62%, and a
   popping key word grew past its slot and covered the next word ("You HYDROGEN"); key words now get their pop
   room in the layout. Captions also got an outline after one washed out on the supernova flash. All four
   cuts pass every check.

## Self-grade
| | Grade | Why |
|---|---|---|
| Hook | **B+** | Text on screen at frame 0, a real hand, three variants to test. The hand is a stock hand, not the viewer's POV, and the first line is 3 s long; a 1 s hook would need a shorter line. |
| Accuracy | **A** | Every claim sourced; the classic error (every atom made in stars) is avoided and turned into the comment bait; "most gold" hedged; iron-in-blood shown without claiming this collapse made it. |
| Visuals | **A−** | All real moving footage, three match cuts that work (palm→cosmic web, blood cell→red giant, ring→neutron stars), a colour arc, a loop. Not one continuous camera move; some agency animations are soft at 1080p when cropped to 9:16; the periodic table is small on a phone. |
| Sound | **B** | Designed, not stock: the drop-out, the chirp, the silence and the heartbeat are all there. Synthesized score is plainer than a composed track; no trending sound layered in. |
| Pacing | **B+** | ~50 s, a new visual every 2-3 s, one focal point. The calcium-to-iron stretch has three short shots in 4 s; the drift beat could breathe a little more. |

**Overall: A−** (Order #42 was a B because of stills; this one fixes that.)

## What the system should change next time (priority order)
1. **Lift the reusable parts into the kit:** the shot-list-as-data + zoom-through cut, the "one take → hook
   variants + relative body timeline" prep (with Order #42's two-character version: one `tools/dialogue.py`),
   the element table, and the cue-driven synthesized score. This run copied patterns by hand again.
2. **A `broll` step that knows the agency CDNs** (NASA images API, ESO/ESA video IDs) and builds the contact sheet
   automatically, so picking clean ranges takes one look, not five commands.
3. **make.mjs voice-overlap check** compared file starts, not speech: fixed in this PR (it now uses the first
   word's time). The per-line gap still has to be ≥ 0.15 s to stay silent.
4. **A native 16:9 mode for scenes** (`M.data({ wide })` here) beats `--formats 16:9` (blurred pillarbox) for a
   YouTube cut; worth a kit helper for W/H/safe zones.
5. **Pop room in kit captions:** any caption style that scales a word up should reserve that width, and the
   fit should count the pop, or the word overlaps its neighbour and slides under the app's buttons.
6. Merge the open branches (#5, #7, #20...) so main has caption emphasis, LESSONS and the voice-file fix.
