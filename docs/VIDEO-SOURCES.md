# Real video B-roll the cloud box can download (no API keys)

The Default cloud environment allows these hosts (added 2026-11-24, approved by Austin). They give **moving
footage**, not stills, so there is no reason to fake a camera move on a photo for space or body subjects.

| Source | What | Licence / credit | How to get the file |
|---|---|---|---|
| NASA Image and Video Library | NASA centre videos: SDO Sun, Hubble/Webb animations, simulations | Public domain (credit "NASA" + centre) | `https://images-api.nasa.gov/search?media_type=video&q=<terms>` -> `nasa_id`; `https://images-api.nasa.gov/asset/<nasa_id>` lists `~orig.mp4`, `~medium.mp4` (use https) |
| ESO | Artist's animations (kilonova eso1733b, supernovae), real VLT/ALMA time series (R Doradus eso2412a, Betelgeuse eso2003) | CC BY 4.0, credit line on the page ("ESO/L. Calçada") | page `https://www.eso.org/public/videos/<id>/` (search: `?search=<terms>`); file `https://cdn.eso.org/videos/hd_1080p25_screen/<id>.mp4` (also `ultra_hd/`) |
| ESA/Hubble | Zooms, pans, animations (Crab supernova heic0515a, Milky Way zoom heic1614a) | CC BY 4.0 | `https://esahubble.org/videos/<id>/`, file `https://cdn.esahubble.org/archives/videos/hd_1080p25_screen/<id>.mp4` |
| ESA/Webb | Webb pans and zooms | CC BY 4.0 | `https://esawebb.org/videos/<id>/`, `https://cdn.esawebb.org/archives/videos/...` |
| Pexels | People, hands, macro, body animations (red blood cells), objects | Pexels licence, no attribution required | browse `https://www.pexels.com/search/videos/<terms>/` (needs a browser: the site blocks scripts); each video page lists `https://videos.pexels.com/video-files/<id>/<file>.mp4`, which the cloud downloads directly |

Rules learned on "You Are Made of Dead Stars" (docs/runs/2026-11-24-dead-stars.md):
- **Look before you cut.** Agency videos have title cards, talking heads, logos and date stamps inside them
  (NASA "First Light" switches between a simulation and an interview; eso2412a burns in dates). Make a contact
  sheet (`ffmpeg -vf "fps=8/<dur>,scale=320:-2,tile=8x1"`) and pick clean ranges.
- **Pre-trim** to the used range at the scene's fps (`ffmpeg -ss a -t d -an -vf fps=30`). The engine extracts
  every frame of a clip, and 100 MB agency masters slow the build for nothing.
- Pexels search pages need a real browser (the Claude browser on Austin's laptop works); the CDN does not.
- A browser-triggered download on the laptop does not reliably land in Downloads (video files stay `.tmp` and get
  removed). Don't fight it: open the host for the cloud instead.
- Real science footage is not to be altered beyond grading and cropping (no compositing objects into it).
