# Higgsfield + Motion Factory Kit

Higgsfield makes the footage: AI creators talking to camera, product shots, B-roll.
This kit makes it *postable*: TikTok-native text, word-by-word captions from the creator's own
voice, product cards, reviews, CTAs, music that ducks under the voice, sound effects, and hook
variants to A/B test. Everything stays editable, so a new hook is a one-line change, not a re-edit.

```
Higgsfield clip(s)  ──►  assets/higgsfield/  ──►  scene (overlays + timing)  ──►  node make.mjs  ──►  postable MP4
```

## Two ways to get clips in

**A. Download them yourself.** Generate in Higgsfield, download the MP4s, and drop them into
`assets/higgsfield/`. Then ask Claude: *"Make a UGC ad from assets/higgsfield/hook.mp4 and
assets/higgsfield/broll.mp4 for <product>."*

**B. Let Claude drive Higgsfield.** Connect the Higgsfield connector to Claude Code once:

```bash
claude mcp add --transport http higgsfield https://mcp.higgsfield.ai
```

Then start `claude` and sign in to Higgsfield when it asks. After that you can say:
*"Generate a 9:16 talking-head clip of a creator saying <script>, then build the ad around it."*
Claude generates the clip, saves it into `assets/higgsfield/`, and composes the video.
(Generations use your Higgsfield credits. Claude should show you the prompts before spending them.)

## Clip specs that work best

| | |
|---|---|
| Aspect | **9:16** vertical for TikTok/Reels/Shorts (any size works; clips are cover-fit) |
| Length | 5–10 s per clip; cut several together rather than one long take |
| Frame rate | Anything (24/25/30/60). The kit resamples to the scene's fps. |
| Audio | Keep the creator's voice in the clip. The kit mixes it, ducks the music, and transcribes it into captions. |
| Text | **No text in the generated video.** All words go on in code, so they're sharp, editable and on-brand. |
| Framing | Leave the **top ~25%** (hook text, comment sticker) and **lower third** (captions) uncluttered. Face in the middle band. |

## Prompt starters

Swap the bracketed parts. Add your model's own style words if you like.

**Talking-head UGC creator (the A-roll)**
> Vertical 9:16 selfie video, handheld phone camera, natural window light, [woman in her late 20s,
> casual hoodie] in [her bathroom], talking directly to camera like a TikTok review, relaxed and
> genuine, slight handheld movement, face centred in the middle of the frame, plain background
> above her head, no text, no captions, no logos. She says: "[script, 1–3 sentences]"

**Product B-roll**
> Vertical 9:16 close-up of [product] on [marble counter], slow push-in, soft morning light, shallow
> depth of field, product centred, empty space at the top and bottom of frame, no text, no logos.

**Hands demo**
> Vertical 9:16 top-down shot of hands [applying / opening / using] [product], clean background,
> natural light, smooth slow motion, no text.

**Before / after pair** (render twice with the same seed and framing, change only the state)
> Vertical 9:16, same framing both times, [the problem state] … / … [the solved state], no text.

**Green-screen creator (for `scenes/templates/green-screen.html`)**
> Vertical 9:16, [person] standing in front of a flat, evenly lit solid bright green background,
> talking to camera, waist-up, no shadows on the background, no green clothing, no text. They say: "[script]"

**Reaction shot (for picture-in-picture)**
> Vertical 9:16 close-up of [person] reacting with surprise, then nodding, looking at the camera,
> plain background, no text.

## A UGC ad structure that works

| Time | Beat | Blocks |
|---|---|---|
| 0–3 s | **Hook**: a comment, a bold claim, a "POV" | `B.commentReply`, `B.nativeText` |
| 3–6 s | **Problem**, in the creator's words | creator clip + captions |
| 6–9 s | **Show it**: product, demo or before/after | B-roll clip, `B.productCard`, `B.split` |
| 9–12 s | **Proof**: result, number, review | `B.review`, `B.stat` |
| 12–15 s | **CTA** | `B.ctaButton` or `B.endCard` |

`scenes/examples/ugc-ad.html` is this structure, ready to fill in. It renders with placeholders
until your clips exist, so you can check timing first.

## Test hooks, not whole ads

Put your hook options in `M.pick([...])` and render them all at once:

```bash
node make.mjs scenes/mine/my-ad.html --variants     # out/my-ad-v1.mp4, -v2, -v3
```

Same footage, different first three seconds: the cheapest A/B test there is.

## Captions from the creator's voice

Set `captions: true` in `M.setup` and `captions: true` on the clip:

```js
const creator = M.video('../../assets/higgsfield/talking-head.mp4', { at: 0, captions: true });
```

With `ELEVENLABS_API_KEY` set, `make.mjs` transcribes the clip with ElevenLabs speech-to-text and
times each word exactly. Without a key, pass `transcript: '...'` and the timing is estimated.
Transcripts are cached, so re-renders are free.

## Be straight with viewers

AI creators aren't real customers. Turn on the platform's AI-generated content label when you post
(TikTok, Instagram and YouTube all have one), don't present generated people as real buyers, and only
put real reviews in `B.review` if you have them and permission to use them.
