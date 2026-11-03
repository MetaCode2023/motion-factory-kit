# The raw-footage editor

For the job where a client sends a Drive folder of raw footage (street interviews, UGC takes,
testimonials, B-roll) and needs **dozens of ready-to-run ads** back.

```
footage/raw/  ──index──►  footage/INDEX.md  ──Claude writes──►  edits/*.json  ──build──►  out/delivery/ + DELIVERY.csv
 (client clips)         (transcripts, thumbs)     (one plan per ad)              (finished ads, every size)
```

## 1. Get the footage in

Put the clips in `footage/raw/` (subfolders are fine; MP4, MOV, M4V, WEBM, MKV). From Google Drive:
download the folder (Drive zips it) and unzip it there, or, if Claude has the Google Drive connector,
ask it to download the folder into `footage/raw/`.

> `footage/` and `edits/` are git-ignored: client footage and plans never get pushed, even if your copy of this repo is public.

## 2. Index it

```bash
node footage.mjs index
```

Every clip gets an ID (`C01`, `C02`...), a thumbnail strip (`footage/thumbs/C01.jpg`, six frames across
the clip), and, with `ELEVENLABS_API_KEY` set, a word-timed transcript split into numbered sentences.
`footage/INDEX.md` is the editor's notebook:

```
## C07 · IMG_0412.MOV
0:48.2 · 1080x1920 vertical · 30 fps · thumbs: footage/thumbs/C07.jpg
- s0 [0.42–3.10] Okay so (um) I've been using this for two weeks.
- s1 [3.60–6.85] And honestly my skin has never looked this good.
```

With the key, the transcript also says **who is talking** (`A:` / `B:` per sentence; in a street
interview A is usually the host, since they speak first). Horizontal clips also get a **face track**
(needs `pip install opencv-python-headless`; the index notes "face found in 92% (auto-reframe)").

Without a key you still get thumbnails and "speech at 2.1–6.4s" ranges (or install the free
`openai-whisper` and it's used automatically). Transcripts are cached; re-indexing only does new clips.

## 3. Plan the edits (Claude's job)

Ask Claude something like:

> Read footage/INDEX.md and look at the thumbnails. Write 20 edit plans in edits/ for Glow Serum ads:
> 15–25 s each, different hooks and angles (price, results, social proof, objections), best takes only.

One plan per ad, `edits/<name>.json`:

```json
{
  "name": "glow-07-results",
  "angle": "results after two weeks",
  "hooks": ["Two weeks on this serum. Look.", "I didn't believe the reviews either"],
  "comment": { "user": "maya.k", "text": "does it actually work??" },
  "segments": [
    { "clip": "C07", "sentence": 0 },
    { "clip": "C03", "sentences": [1, 2], "focus": 0.35 },
    { "clip": "C12", "from": 4.2, "to": 7.9 }
  ],
  "broll": [{ "clip": "C20", "from": 0, "to": 2.5, "over": 1 }],
  "product": { "name": "Glow Serum 30ml", "price": "$29", "oldPrice": "$39", "rating": 4.8, "reviews": "2.1k" },
  "cta": "Shop now"
}
```

| Field | Meaning |
|---|---|
| `segments` | The A-roll, in order. Pick by `sentence` / `sentences: [from, to]` (from the index), or `from`/`to` seconds. |
| `focus`, `focusY` | Manual crop when reframing (0 = left/top, 1 = right/bottom). Usually leave them out: horizontal clips follow the face automatically (below). |
| `face` | Which face to follow: `largest` (default), `left`, `right`, `center`, or `false` for the centre crop. |
| `audio` | Street-audio clean-up (below). `false` turns it off. |
| `question`, `person`, `n`, `answer` | Street-interview overlays on a segment (below). |
| `street`, `tally` | Plan-level street-interview settings (below). |
| `captions`, `hookStyle` | Caption look (`word` for one word at a time mid-frame, or any caption style) and hook look (`box`, `dark`, `blue`). |
| `zoom` | Force a zoom for a segment. Otherwise jump cuts alternate normal / punched-in (`"punch": 1.1` on the plan; `false` to turn off). |
| `keepFillers`, `maxPause`, `tight` | Cleanup: fillers ("um", "uh") and pauses over 0.4 s are cut by default; `tight: false` keeps the raw range. |
| `broll` | Cutaways over the A-roll (voice continues): `clip`, `from`/`to`, and `over: <segment index>` (or `at` seconds). |
| `hooks` | On-screen hook text; several = one video per hook with `--variants`. |
| `comment` | Optional "Reply to @user's comment" sticker over the hook. |
| `product`, `productAt` | Product card (name, price, oldPrice, rating, reviews, badge, image). |
| `cta`, `endCard` | Closing button; `endCard: { takeaway, cta, url }` for a full end card. |
| `music`, `look` | `pulse` / `calm` / `drive` / your file; `punchy` / `cinematic` / `film` / `clean`. |

## 4. Build everything

```bash
node footage.mjs build edits/ --variants --formats 4:5,16:9 --batch glow-oct
```

For each plan: cut the A-roll (word-exact trims, fillers and dead air removed, punch-ins, reframed to
9:16, loudness-matched), lay the polish on (`scenes/templates/raw-edit.html`: hook, captions from the
real words, B-roll, product card, CTA, music, grade), and run the self-check.

`out/glow-oct/` then holds every MP4 (each hook, each size), a report per ad, and **`DELIVERY.csv`**:
ad, file, size, hook, angle, length and check status: hand it to the media buyer with the folder.

Check one plan quickly: `node footage.mjs cut edits/glow-07-results.json` (just the A-roll, in seconds).
Use your own polish layer: `--template scenes/mine/my-edit.html` (read the plan with `M.data`).

## Street interviews

Mark the host's question and the people answering in the plan; the overlays place themselves.

```json
{
  "name": "coffee-08-price",
  "hooks": ["We asked 50 people what this coffee is worth"],
  "street": { "total": 50, "label": "We asked" },
  "segments": [
    { "clip": "C04", "sentence": 0, "question": true },
    { "clip": "C04", "sentence": 1, "person": { "name": "Marcus", "detail": "Runs every morning" } },
    { "clip": "C09", "sentences": [0, 1], "n": 23 },
    { "clip": "C11", "sentence": 2, "answer": "yes" }
  ],
  "tally": { "title": "Would you pay $8?", "options": [{ "label": "Yes", "value": 31 }, { "label": "No", "value": 19 }] },
  "cta": "Try a bag"
}
```

- `question: true` shows the words the host actually said as a card at the top, and keeps it up
  through the answers that follow (until the next question or the tally). `question: "text"` overrides
  it; keep it to what was asked.
- `person` adds a name lower-third as that person starts talking. **Only names and details people
  gave on camera or on their release.** Leave it out otherwise.
- With `street.total`, every answer gets an "n/total" chip, numbered in order (`n` to set it, e.g. when
  the same person appears twice). `street.intro: true` opens on the total counting up.
- `tally` is the poll result. **Use the real counts from the shoot**, never estimates.

## Street audio

On by default for every cut piece: a high-pass for rumble, an FFT denoiser that tracks the street noise,
a de-esser, a gentle compressor, then each speaker is levelled to the same loudness (per speaker when the
transcript knows who is talking, so the host and a quiet stranger match, and one person's jump cuts
don't jump in volume). Tune it per plan or per segment:

```json
"audio": { "denoise": "strong", "wind": true, "deess": true, "level": true, "target": -16 }
```

`denoise`: `light` | `medium` (default) | `strong` | `false`. `wind: true` cuts harder below 120 Hz.
`"audio": false` passes the sound through untouched (music videos, ambience you want to keep).

## Automatic reframing

Horizontal (or square) clips are cropped to 9:16 around the face found by `tools/faces.py` (OpenCV's
YuNet detector, bundled in `tools/models`). A face that stays put gets one crop per piece; one that
moves gets a smooth pan that follows it. With two people in frame it sticks with the one it's following
(the biggest at the start) instead of flipping; `"face": "left"` / `"right"` picks one. `focus` /
`focusY` still override. Check the cuts image after a build: if a crop is wrong, set `focus` on that
segment.

## Review and re-cut

Every `build` also writes **`out/<batch>/review.html`**: each ad's player, its hook variants, Approve /
Needs changes buttons and a notes box. Zip the batch folder (or put it on Drive) for the client; the
page works opened straight from the folder, and decisions save in their browser.

1. They click **Export feedback** and send you `review.json` (or **Copy notes** into a message).
2. `node footage.mjs feedback out/<batch>/review.json` writes `FEEDBACK.md` (per ad: what to change),
   copies approved files to `out/<batch>/approved/` for the media buyer, and adds a `review` column to
   `DELIVERY.csv`.
3. Claude edits only the flagged plans to address the notes, then
   `node footage.mjs build edits/ --redo out/<batch>/review.json --batch <batch>` rebuilds just those.
   The sheet and the review page keep every other ad; re-cut ads come back as "to review", approved
   ones stay approved. `--only a,b` rebuilds named ads without a review file.

