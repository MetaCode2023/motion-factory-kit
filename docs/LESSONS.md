# Lessons from real builds

What we learned making videos with this kit, so the next session doesn't relearn it. Add to it when a build
teaches you something. Newest first inside each section.

## Where things can run

| Task | Cloud session | Creator's computer |
|---|---|---|
| Render, mix, captions, animations | yes | yes |
| Wikimedia Commons / Openverse search | yes, but rate-limited (below) | yes |
| YouTube, TikTok, Instagram, news clips (`pull`, yt-dlp) | **no**: blocked by the cloud proxy | yes |
| ElevenLabs narration (`ELEVENLABS_API_KEY`) | **no**: api.elevenlabs.io is blocked | yes |
| Higgsfield narration (MCP) | yes, costs credits: ask first | yes |

- Node's `fetch` only uses the cloud proxy with `NODE_USE_ENV_PROXY=1`.
- Python's `urllib` default User-Agent gets a 403 from Openverse; send a real one.

## Wikimedia and Flickr rate limits

- A cloud session shares its IP with many others. Wikimedia (API, originals and thumbnails) and Flickr
  answer with **429 and `Retry-After: 600`**. Retrying sooner restarts the ten minutes: wait it out or move on.
  `tools/broll/sources.mjs` now does that (a long block skips to the next source).
- Commons **transcoded video** (`/transcoded/.../<file>.720p.vp9.webm`, `.360p.mpeg4.mov`) often comes through
  when originals don't. Its path is built from the file name: `md5(name_with_underscores)` → `a/ab/<name>`, so it can
  be fetched without the API when the API is the thing that's blocked.
- **Openverse's image proxy** serves an image when its origin blocks you:
  `https://api.openverse.org/v1/images/<id>/thumb/?full_size=true`. It refuses very large originals (424), so it
  works for ~1024 px Flickr photos, not 6000 px Commons ones. `download()` falls back to it automatically.
- Space downloads ~15 s apart and fetch in one pass. If a cloud run still comes back thin, run `broll` on the
  creator's computer.

## Picking B-roll that is actually about the subject

- **Look at stills of every pick** before building. Titles mislead: a Commons "Scanning Electron Microscope" video
  was a text-heavy explainer diagram; a search for "Werner Heisenberg" returned his grave, schools named after him
  and Breaking Bad fan photos. A group photo (Solvay 1927 for Bohr / Heisenberg / Einstein) often beats a bad portrait.
- Real footage beats an animation, and an animation beats a photo. The strongest shot in the quantum test was
  real electrons building the double-slit pattern one at a time (Bach et al. 2013, CC BY 3.0 on Commons).
- Science footage is often 640-1200 px wide. Don't stretch it full screen: put the sharp clip in a card over a
  blurred copy of itself, and zoom in ~8% to trim the clip's own progress bar or watermark.
- Footage with burned-in text fights the captions. Pick a stretch without it, or put it in a card.
- Speed a slow real clip up (the electron build-up at 7x) so the change happens inside the line.

## Narration

- No ElevenLabs key in the cloud: Higgsfield `text2speech_v2` with `variant: "elevenlabs"` works, about 1.8 credits
  for 100 words. Quote it (`estimate_audio_cost`) and get a yes before generating.
- Generate **one take** of the whole script (one price, consistent delivery), then time each line from its pauses:
  `node tools/voice-lines.mjs narration.mp3 script.txt` prints start/end per line. Cut each shot ~0.1 s before its line.

## Writing

- See `PLAYBOOK.md` section 0: go to the profound version of the idea, earn every term, one concrete image per
  idea, end on what it means for the viewer. A deeper script runs longer: the 20 s test became 45 s.
- Key words in CAPS in the scene's line text make a simple rule for which caption words pop (accent colour, ~1.7x).

## Sound

- The short-form effects people expect (page turn, beep, boop, bop, ding, shutter, record scratch, boom, glitch,
  sparkle, swipe) are in `sounds/sfx/`, synthesized here (MIT). One per beat, matched to what the beat does.

## Automating long recordings (a watched folder)

For a pipeline that picks up new recordings by itself:

- Only start on a file once its **size has stopped changing** for a while (a copy or an export in progress
  looks like a finished file).
- **Move it into a `Working/` folder** before processing. The move is the lock: a second run can't pick it up,
  and a crash leaves it somewhere obvious.
- **Cache the transcriber model on disk** (faster-whisper downloads it on first use); the first run is slow,
  every run after it shouldn't be.
- **Propose, then render.** Write the clip timestamps and titles to a plan and get them approved before spending
  render time; rebuilds after a change are cached.
