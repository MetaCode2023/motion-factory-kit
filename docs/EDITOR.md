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
| `focus`, `focusY` | Where to crop when reframing (0 = left/top, 1 = right/bottom). Horizontal footage → vertical: set `focus` to where the face is in the thumbnails. |
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
