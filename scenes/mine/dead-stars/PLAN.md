# You Are Made of Dead Stars: plan (2026-11-24 one-shot benchmark)

Brief: Austin's v2 prompt + "virality layer" (10) + 29 more = 59 upgrades, approved with "Run it".
Output: 3 hook variants (9:16) + a native 16:9 cut. Files: /mnt/project-files/dead-stars/.

## Pipeline (reproduce)
1. `footage/dead-stars/` holds the raw clips (git-ignored); `cut/` has them trimmed to the used ranges at 30 fps.
2. Voice: one Higgsfield seed_audio take (voice "Cillian", all three hooks + body, 5.4 credits) -> `vo.wav`;
   `python3 tools/transcribe.py vo.wav small > vo.words.json`.
3. `python3 scenes/mine/dead-stars/prep.py` cuts it into 3 hook files + 22 body lines, writes `timeline.js` (body
   times relative to the chosen hook's end, so one timeline serves all three variants).
4. `python3 scenes/mine/dead-stars/sound.py` synthesizes a score per variant + thump/ping/boom/heart.
5. `node make.mjs scenes/mine/dead-stars/dead-stars.html --variants` and `--data '{"wide":true}' --name dead-stars-wide`.

## Shot list (body seconds after the hook; hook A adds 3.53 s)
| body s | line | on screen | colour |
|---|---|---|---|
| hook | "This hand is 13 billion years old." (B: dare "DON'T LOOK AT YOUR HAND." first; C: gold ring) | palm opening, headline on screen at frame 0 | warm |
| 0.0 | "At the start... hydrogen and helium" | MATCH CUT palm -> NASA cosmic-web simulation; H, He light blue | cold blue |
| 4.7 | "So where did the rest of you come from?" | Hubble deep field push | cold |
| 6.6 | "Stars." | NASA SDO, the Sun full disc (thump) | amber |
| 7.6 | "They crush light atoms... Carbon. Oxygen." | SDO limb close-up; C, O pop with a ping | amber |
| 12.0 | "The calcium in your bones." | hand in a shaft of light; Ca pops | amber |
| 14.1 | "Then they reach iron." | red blood cells (iron in your blood); Fe pops red | red |
| 15.5 | "Iron gives no energy back." | MATCH CUT blood cell -> R Doradus (real ALMA video of a red giant's boiling surface) | red |
| 17.9 | "The core collapses in under a second," | Hubble supernova: the star, speeding up; accelerating thumps | red |
| 20.3 | (0.32 s) | black, music drops out completely, then the hit | - |
| 20.6 | "and the star explodes, scattering everything it made." | white flash -> expanding Crab remnant; Co..Sr light white | white |
| 23.5 | "Most gold needs something worse." | gold ring on a finger | gold |
| 25.5 | "Two dead stars, so dense a sugar cube of them weighs as much as a mountain..." | MATCH CUT ring -> ESO neutron-star inspiral, accelerating with a gravitational-wave chirp; "1 SUGAR CUBE OF NEUTRON STAR / 1,000,000,000 TONS" counts up | gold |
| 30.0 | "Colliding." | flash -> kilonova bloom; Au + r-process elements light gold; screenshot line "THE GOLD IN YOUR RING CAME FROM TWO DEAD STARS COLLIDING." (1.5 s) | gold |
| 32.2 | (1.0 s) | black, full silence | - |
| 33.4 | "Those atoms drifted for billions of years." | Hubble Milky Way zoom | violet |
| 36.8 | "Then, for a little while, they became you." | hand reaching into light; the table returns lit as the body's elements, "YOU" | warm skin |
| 39.9 | "Well, almost all of you. Your hydrogen is even older." | cupped hands; H pulses blue, "YOUR HYDROGEN: 13.8 BILLION YEARS OLD" | warm / blue |
| 43.9 | "Look at your hand." | the hero hand turning back to the exact frame the video opened on; share line + Part 2; hook headline fades back in on the last frames = seamless loop | warm |

## Calls on conflicting / infeasible upgrades
- **Length:** 60 s (v1) vs 45-55 s (#21): 50.1 s (A), 52.7 s (B), 49.9 s (C). The script ran 56 s of speech before
  the pauses were tightened; nothing was cut from it.
- **"Shoot the hand in real light" (#14) / POV hand (virality #2):** no camera, so the hand is real stock video
  (Pexels), not AI. POV phone-in-other-hand not found in stock; skipped rather than generated.
- **One continuous camera move (#8):** approximated: every cut is a zoom-through + sub thump, and the order goes
  hand -> cosmos -> body -> cosmos -> hand. A true single zoom would need generated footage.
- **Bone -> white dwarf match cut:** no real white-dwarf video exists; replaced by blood cell -> red giant and
  ring -> neutron stars (both real).
- **Hidden hand in the supernova (virality #5):** not done; it would need compositing an image into NASA/ESA
  footage, which edges into altering science imagery. Proposed instead as a Part 2 Easter egg.
- **Trending slowed+reverb track (virality #9):** not done: the cloud can't reach TikTok's library and the score
  is original (safer for reach on YouTube). The TikTok music tool exists in Higgsfield; add one at posting.
- **Higgsfield virality predictor (#27):** not run (costs credits; quote first next time).
- **Ticking atom-age counter (#2 of 29), a named calcium atom (#1 of 29):** left out to keep one focal point
  (#13); the periodic table already carries the "follow the atoms" thread.
- **Native-text version per platform (#22), posting time (#24), pinned comment (#19), 48 h log (#29):** in the
  post kit / handover, not the render. Posting waits for Austin.
