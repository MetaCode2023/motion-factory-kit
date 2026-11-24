# Rethink: why our videos look amateur, and the new plan

*2026-11-24. Written after frame-sampling Dead Stars (hook A), Order #42, Global Maximum (crazier) and Physics of Poker v3, and timing every cut in Dead Stars against its audio.*

## The short version

We have been building a **renderer with a checklist**, and calling its first output the final. Pro studios spend most of their time *before* anything renders: one art direction for the whole video, style frames, an animatic that is approved before production, music chosen first and cut to. We skip all of that. Then we pile on more parts (HUDs, pop captions, badges, counters) to make up for the lack of a look. The 59-point upgrade brief made this worse, not better: every addition was another thing on screen.

**The new direction:** every video gets **one designed world**. We lock a style with 3-4 approved style frames before anything else. Every shot is made to match those frames: generated with frontier image-to-video models that are given the frames as references, or built in code using the same palette and type. Nothing is pulled from 13 different stock sources. Then an **animatic gate** (stills plus voice plus music, timed) has to pass before any credits go on motion. A **taste critic** compares our frames with real pro frames and won't let a video through until it holds up side by side. Fewer elements, each one designed.

---

## 1. What is actually wrong (measured, not assumed)

Evidence: [dead-stars-1fps.jpg](dead-stars-1fps.jpg) (one frame per second) and [dead-stars-cut-frames.jpg](dead-stars-cut-frames.jpg) (frames −2 to +3 around six cuts).

| # | Problem | Evidence | Verdict |
|---|---|---|---|
| 1 | **No single look.** Each shot comes from a different source with its own colour, grain, sharpness and lens. | Dead Stars goes from a blue NASA cosmic web to an orange SDO sun, a pink flare, a red CG blood cell, a soft white blowout and a stock wedding ring, all in 25 s. Order #42 mixes flat vector drive-thru art with JWST photos and a macro eye. | **Main cause.** It's what makes a video read as "assembled from stock". |
| 2 | **Continuity breaks inside one idea.** | "This hand" is played by **four different people's hands** (different skin tone, light and lens). The viewer stops believing "this hand" is one hand. | Confirmed. A pro would use one hand, shot once (or generated once), the whole way through. |
| 3 | **Some cuts are off, and most cuts jump between unrelated pictures.** | *Corrected after a finer re-measure:* 9 of 12 Dead Stars cuts do land within a frame of a word or hit. Two are about 170 ms (5 frames) off (14.2 s and 24.4 s), and one (36.0 s) has no sound event under it at all. The bigger problem is *what* is cut together: hard jumps in colour, light direction and subject (warm hand → blue web → orange sun → white blowout) with nothing matched across the cut. The "So where did the" caption also appears 2 frames before its cut. | Partly confirmed. "Cuts that aren't perfect" is mostly **unmatched** cuts (problem 1 showing up at the cut), plus a few timing misses. Our checks test that cuts exist, not that they're on something or matched. |
| 4 | **Clutter that looks like an AI tool.** | A permanent tiny periodic-table HUD over 70% of Dead Stars that you can't read on a phone. Fe/C badges and "13.8 BN YRS" counters in Order #42. Caption pills **over the speaker's eyes** in Global Maximum. Captions in 3 sizes and 3 colours a line. | Confirmed. Each piece came from a checklist item ("explain on screen", "pop key words"), and together they read as template software. |
| 5 | **Text that fails on its own frame.** | "EXPLODES," in pale grey on a white blowout. "The gold in your ring…" laid over a busy nebula texture. Both unreadable. | Confirmed. These were self-graded A−. |
| 6 | **Source quality.** | Agency clips are 720-1080p, cropped to 9:16 (a 3x punch-in), so they're soft. The Order #42 drive-thru is flat clip-art. Poker v3 is a dim webcam next to dark slide cards. | Confirmed. A high-budget video is crisp everywhere. |
| 7 | **Sound is synthesized.** | The scores are numpy drones and pulses. The design is clever (chirp, drop-out), but it sounds like a demo, not a composed track. | Likely a big part of "cheap", even though nobody names it. Studios use composers (Kurzgesagt: Epic Mountain; Johnny Harris: Tom Fox). |
| 8 | **The self-grade checks rules, not taste.** | Dead Stars was graded "Visuals A−" with problems 1-5 visible in the frames. The grader was the maker, scoring against its own brief. | Confirmed. That's why the grades felt generous. |

**What's not the problem:** scripts and fact-checking are strong (Dead Stars' notes are pro-level). Resolution and bitrate of the output are fine. The engine renders frame-exact. The gap is design and editing, not plumbing.

---

## 2. How top studios actually do it

| Studio | What matters for us |
|---|---|
| **Kurzgesagt** | Research → a dozen script drafts → **illustration (sketches, then style frames)** → **the voiceover sets the animation timing** → animation → a **custom score by Epic Mountain**. About 1,200 hours a video. One visual language for 10+ years: a fixed palette, flat shapes, a 2D/3D mix. ([kurzgesagt.org/youtube](https://kurzgesagt.org/youtube/), [kottke](https://also.kottke.org/20/02/how-to-make-a-kurzgesagt-video-in-just-1200-hours)) |
| **Vox / Johnny Harris** | A *small, repeatable* set of looks: textured paper, archival footage with a consistent grade, animated maps (After Effects + GEOlayers), a signature **"desk" of real objects**, and composed music (Tom Fox). The texture is the brand. ([aescripts](https://aescripts.com/learn/how-johnny-harris-makes-maps)) |
| **LEMMiNO** | One person: a dark, minimal palette, slow precise camera moves, Blender/AE, a self-composed score. Few elements, perfect timing. Proof that restraint reads as expensive. |
| **Veritasium** | Real practical shots (a filmed experiment) plus clean diagrams in one house style. |
| **Motion-design studios** (Buck, Ordinary Folk, Giant Ant) | Brief → **style frames (3-6 stills that define the look) signed off** → storyboard → **animatic** (timed boards with temp VO and music) signed off → design and animation → sound design → grade. Nothing animates until the animatic is approved. |

**What they share, and we lack:** (1) one art direction, defined in stills, before production; (2) an animatic gate; (3) music chosen or composed early, and the edit cut to it and to the VO; (4) restraint: one idea and one focal point per shot, no permanent overlays; (5) a human with taste saying no.

**Toolchain reality (Nov 2026):**
- **After Effects / Cinema 4D / Blender** are still where the top tier finishes. Our canvas/three.js engine can match flat 2D motion design and simple 3D, but not lit, textured 3D or character animation.
- **Frontier video models** (Veo 3.1, Kling 3.0, Seedance 2.0) now make cinematic 5-10 s shots at about **$0.05-0.40 per second** depending on model and tier. They accept reference images (Seedance up to 9, Kling up to 4, Veo 1), so you can **lock a style with frames**. They're weak on text (never put words in a shot) and on complex physics and choreography. Max 720p-1080p, so upscale. ([ModelsLab](https://modelslab.com/blog/api/veo-3-1-vs-kling-3-sora-2-ai-video-api-cost-2026), [Atlas](https://www.atlascloud.ai/blog/guides/seedance-vs-kling-vs-sora-vs-veo); the two reseller sites disagree on exact prices.) We already have them through Higgsfield.
- **Remotion / our canvas engine** are great for typography, diagrams, data and UI, and for frame-exact timing. They're the wrong tool for "cinematic". Use them as the graphics *layer*, not the whole picture.

---

## 3. The direction I'm choosing, and why

**"One designed world per video": style frames → animatic → generated hero shots locked to the frames → code-built graphics in the same palette → one grade → cut to a real music track.**

Why this one and not the alternatives:
- *Keep improving stock assembly:* no. Mismatched sources (problem 1) can't be fixed with better picking. It's built into the approach.
- *Pure code-drawn motion graphics (Kurzgesagt-style in canvas):* possible, but reaching Kurzgesagt's polish in hand-written canvas code is months of illustration work per style. It's good for diagrams, not for the "wow" shots.
- *Pure AI video:* it drifts shot to shot, and text and diagrams break. On its own it reads as "AI slop".
- *The hybrid:* generated shots made **from our own approved style frames** give one look plus cinematic quality. The kit's engine does what it's precise at: type, diagrams, captions, timing, mix. This is also how small, top-tier studios are working now.

### The new pipeline (each step is a gate)

1. **Script** (as now; it's already good). Lock VO timing early: VO first, like Kurzgesagt.
2. **Art bible** (new): a one-page look. Palette (5 colours), one type pairing, lens and light ("macro, warm key, black void"), texture and grain, and *what never appears*. The agent makes **3 directions × 3 style frames** as stills and Austin picks one. A few image credits.
3. **Music first** (new): a licensed composed track (Artlist / Epidemic / Musicbed) picked to the emotional curve, or a commissioned score for flagship pieces. Get the beat map and hit points from it. Synth score only for SFX sweeteners.
4. **Animatic gate** (new, required): every shot as a still frame (style-frame-matched), with the real VO and music, cut on the beat. Rendered cheap in minutes. **Austin approves the animatic before any video credits are spent.** This is where cuts get perfect, because the timing is solved while it's cheap.
5. **Shot production:** each hero shot goes to image-to-video with the approved still as its **first frame** (and last frame where the model supports it), plus the style frames as references. Generate 2-3 takes, keep the best. Upscale to 4K, then down to delivery. One continuous subject ("the hand") is generated once and reused.
6. **Graphics layer:** canvas/three.js only for things that must be exact: numbers, a diagram, a title. Same palette and type as the bible. **No permanent HUDs.** A graphic appears for its idea, then leaves.
7. **Finish:** one LUT/grade over everything, matched grain, a sound mix (VO −16, music ducked, SFX on hits), loudness to −14 LUFS.
8. **Taste gate** (new, replaces the self-grade; below).

### Hard rules that go into the kit

- **Cuts snap to an audio event:** a beat, a VO word onset or an SFX hit, within **1 frame**. Measured by the build, and FIX if not.
- **No caption runs across a cut.** Caption chunks break at cuts.
- **One focal point per frame.** At most one graphic element on screen besides captions.
- **Captions: one style, one size, one accent.** A key word changes colour only (no scaling pop). Never over a face.
- **Text contrast ≥ 4.5:1** against its actual local background, measured per frame.
- **Shot-to-shot grade continuity:** the mean colour and contrast difference across a cut must be within limits, unless the cut is marked as a deliberate contrast cut.
- **Source floor:** no shot upscaled more than 1.5x, and no soft stock.

### The taste critic (replaces "the maker grades itself")

- **A reference library:** ~40 frames from pro work in each style we use (Kurzgesagt, LEMMiNO, Johnny Harris, Apple product films, A24 trailers), stored as reference only, never published.
- **Blind pairwise test:** a separate critic (a fresh agent that never saw the brief) gets our frame and a pro frame unlabelled and is asked which is professional and why. Ship only if it can't reliably tell them apart on most sampled frames.
- **Motion check:** the same blind test on 3-second clips around every cut.
- **The human score is what counts:** Austin rates the animatic and the final 1-10 on "would someone ask who made this?". The critic's job is to catch problems *before* he sees it, not to grade it.

---

## 4. What Austin or Alan need to supply, and costs

| Item | Who | Cost |
|---|---|---|
| Pick 1 of 3 art directions (stills) | Austin, about 5 min | Image credits for 9 frames: small (I'll quote before generating) |
| Approve the animatic | Austin, about 5 min | Free (rendered here) |
| Video credits for hero shots | Approval before each spend | About 10-15 hero shots × 5 s × 2-3 takes ≈ 100-225 s of generation. At roughly $0.08-0.40/s that's **about $10-90 a minute of video**, depending on model. I'll quote it in Higgsfield credits before spending. |
| Music licence | Austin signs up | Artlist or Epidemic ≈ $10-20 a month. Musicbed is more. A commissioned score for a flagship is $500+. |
| Narration | Alan's or Austin's own recorded voice (best), or a pro VO read | Own voice: free. A pro voice actor for a 60 s read is about $100-300. The AI voice is OK for animatics only. |
| *Optional, big lever:* a freelance motion designer to make the **first art bible plus style frames** | Austin hires | About $300-800 one time. Their frames then feed every generated shot. It's the fastest way to buy taste we don't have yet. |

---

## 5. The proof test to run next (small, about 1 day)

**Remake the first 15 seconds of Dead Stars** (hook → "at the start the universe made…" → stars crushing atoms) in the new pipeline, and put it **side by side** with the current version and two pro reference clips.

1. 3 art directions × 3 style frames (for example: *macro-cinematic*: one hand in a black void, cosmos inside the skin; *illustrated-cosmic*: flat, Kurzgesagt-adjacent; *archival-texture*: Johnny Harris-style paper and light). **Austin picks one.**
2. An animatic of the 15 s on a licensed track, every cut on a beat or word within 1 frame. **Austin approves.**
3. 4-5 hero shots via image-to-video from the approved stills (one hand throughout), upscaled, one grade, minimal captions, no HUD.
4. A blind critic pass, then Austin watches all three clips and answers one question: *who made that?*

**Spend for the test:** about 9 style-frame images plus about 5 shots × 2-3 takes ≈ 50-75 s of video. Roughly **25-60 Higgsfield credits** depending on model. I'll give an exact quote before generating. Plus one music track (Austin's Artlist/Epidemic account, or a free trial).

**If it passes,** the kit changes (in this order): art-bible and style-frame step, animatic renderer, beat-snap cut check, caption simplification, the grade/contrast/continuity checks, the blind critic. Then the next full video goes through it. **If it doesn't pass,** we'll know whether the gap is generation quality (try Veo Standard or a human designer) or editing (cuts and sound), because the animatic isolates editing.

## 6. Ten more improvements (added 2026-11-24, at Austin's request, before the proof test)

These build on the plan above. Each one becomes a field in the shot list or a check in the build.

1. **A north-star reference for every video.** Before style frames, pick one pro piece we're aiming at (for the Dead Stars test, a LEMMiNO-style or Apple "macro" film) and break it down shot by shot: shot length, camera move, where the text sits, the grade. Our style frames and animatic copy *its* grammar, not a checklist. The blind test at the end compares against this same piece.
2. **A hero bible.** One reference sheet for the recurring subject: the same hand (skin tone, nails, a thin gold ring), the same rim light, the same lens. Every generation gets the sheet as a reference image. Any take where the hand changes is rejected, even if it's pretty.
3. **Light continuity.** The key light comes from upper left and stays there, with one colour temperature per scene. A cut between two shots lit from opposite sides reads as two videos. The critic checks the light direction on the frames either side of every cut.
4. **One camera language, and cuts that carry motion.** Each shot declares one move (a slow push-in, a lateral drift or a rack focus) with an eased speed. A cut keeps the direction and speed of the move before it (push into the palm → keep pushing into the cosmic web), or it's a deliberate hard stop on a hit. No random zooms.
5. **Designed transitions, made with start and end frames.** For every pair of shots, the *last frame* of one and the *first frame* of the next are designed together as a match (the shape, position and brightness line up) and handed to the video model as start and end frames. This is what makes cuts feel "perfect": they're composed, not found.
6. **Fewer, longer shots, and breathing room.** About 40% fewer cuts than Dead Stars. The average shot is 3-4 s, and the hero shot holds 5-6 s. Plan at least one beat with no new information: silence or a held image. Cheap videos cut because they're nervous; expensive ones hold.
7. **Typography in the scene, not caption templates.** One premium type treatment per video, placed *in* the shot: tracked to the camera move, sitting in the black space the style frames leave open, and allowed to go behind the hand. Default burned captions are replaced with sparse editorial lines (2-5 words, on the beat). Full subtitles go in the platform's own captions (.srt). Text gets the same grain and grade as the picture, because clean digital text over graded footage is a dead giveaway.
8. **A finishing stack last, over everything.** The order: composite → one grade (LUT) → halation on highlights → a matched grain plate → a gentle vignette → a black-level and contrast check → sharpen for phone. The graphics layer goes *under* the finish, not on top. One look file per video, reused across every shot.
9. **A film-grade sound pass.** A licensed score edited to the cut (the edit points are chosen on its phrases). Then Foley (skin movement, breath, a ring's tick), a room-tone bed so silences aren't digital zero, sound design that is motivated by the picture (no stock whooshes on every cut), and a master to −14 LUFS with true peak ≤ −1 dB. A real voice: the AI voice is for the animatic only.
10. **Overshoot, then cut ruthlessly.** Generate 2-3 takes per shot and score them against the style frames and hero bible. Drop the weakest third of the shots after the first assembly, even if they cost credits. Masters come from 4K-upscaled shots, exported per platform (9:16 at high bitrate, a native 16:9 recompose instead of a crop). The final review is a blind side-by-side against the north star, by a fresh critic and then by Austin.

**Effect on the proof test:** 2-3 takes per shot with start and end frames, plus upscaling, pushes the test to the top of the earlier range, about **50-70 credits**. I'll give an exact quote after the animatic is approved.

## What we stop doing

- Briefs with 59 upgrades. One look and five rules beat sixty features.
- Pulling from 10+ footage sources per video.
- Permanent overlays, counters and HUDs. Scaling pop captions.
- Synthesized music as the score.
- The maker grading its own work.

## What happened next (same day)

- **Style frames + still-frame animatic: rejected.** Austin: "textbook AI, manipulating freeze frames, no cinematic integrity." Camera moves over AI stills never read as cinema, and the "epic glow" image look (embers, teal/amber) reads as AI on its own.
- **One Kling 4.0 text-to-video test** with a plain documentary-realism prompt (50mm, tungsten lamp, "no glow, no sparkles"): Austin, "Yes that's real animation". This is the bar.
- **The real-motion opening** (`scenes/mine/dead-stars-v2/cut.py`): 5 kling4_0 shots (hand, palm macro, milk+ink nebula, sparks, closing hand), with one grade, cuts on word onsets, and editorial type. 112.5 credits including one re-roll.
- Practical-effect prompts (ink in water, sparks) look real. kling4_0 rejects references on text-to-video (they need a start image), and upload.higgsfield.ai is blocked from the cloud, so locking one hand needs the laptop.
