# Long-form playbook

The standing rules for making a series, not just one video. Claude reads this before drafting a script and
again before handing a video over. The creator's own files (`scripts/VOICE.md`, `scripts/SERIES.md`) are
git-ignored: they describe a person and a channel, not this repo.

## 1. Voice (`scripts/VOICE.md`)

`node longform.mjs voice` measures how the creator talks from their own indexed recordings: pace, sentence
length, how often they ask questions, the phrases they really use. Index their **solo** recordings first
(guests in a podcast would be measured too), or pass the clip ids. The measured block is rewritten each run;
everything else in the file is kept.

- Read it before drafting. Write to its pace and sentence length. Scripts are timed at the measured pace.
- Fill in the hand-kept sections after the first conversation: how they sound, what they never say, humour,
  how they open and sign off.
- **Every time the creator changes a draft, add a line under Corrections** ("what I wrote → what they changed it
  to"). Check new drafts against that list before showing them.
- The phrase list contains topic words from whatever they recorded; borrow the turns of phrase, not the topics.

## 2. Series bible (`scripts/SERIES.md`)

One page per channel, decided once, so video 8 matches video 1. Ask for what's missing the first time; after
that, follow it without asking. Template:

```
# <Channel / series name>
Audience: who is watching and what they already know
Promise: what every video delivers ("a hard idea made obvious in ten minutes")
Look: theme (aurora | blueprint | noir | sunset | paper | terminal), accent colour
Music: track(s), how loud
Intro: the first line pattern or cold open, how long before the title
Sign-off: the last line, what to send people to
Thumbnail: 2-4 words, which layout, which kind of object, colours
Titles: the pattern that works for this channel, two examples
Length: target minutes, words
Never: topics, words, kinds of clip this channel doesn't use
```

Put the look in each script's header (`theme: paper`) so the build follows it.

## 3. Facts

- Every figure, date and quote in a script comes from research done for that script, with a `source:` on the
  visual that shows it and a link in the sources list at the bottom of the script. `node longform.mjs script`
  warns about figure visuals with no source.
- Note the date of each figure. Anything that changes (prices, rates, laws, who holds an office, "the latest")
  is looked up fresh, not remembered. Flag figures more than two years old to the creator.
- Prefer the primary source (the agency, the paper, the filing) over an article about it.
- Where sources disagree or the question is contested (taxes, voting, healthcare policy), say so in the script
  and give both; don't pick the convenient number.
- Rounded on screen is fine ("about 23 trillion"); the exact figure goes in the description.
- Never put words in a real person's mouth. Quotes are exact and attributed; if it's a paraphrase, the
  visual says so.
- Before recording, list for the creator: every claim you could not source, and every claim that is their
  opinion rather than a fact.

## 4. Outside clips

Outside clips are part of the look: a real moment on screen makes a point land ("here's the hand he folded").
Use them fearlessly, the fair-use way: a few seconds, talked over, credited.

- **Write them into the script.** Put a `[[clip <what it shows> | search: <words> | say: <words spoken in it>]]` cue
  wherever a real-world moment proves the point: the famous hand, the launch, the interview line. You don't need
  the URL; `node longform.mjs clips <plan>` finds the video, picks the seconds (where `say:` is spoken, else the
  most-replayed moment) and cuts them. Aim for one every 60-90 s in a 10-minute video.
- **Names said get clips on their own.** The same command finds the people and events the speaker names ("Phil
  Ivey", "Tom Dwan") and adds a 3-8 s clip in a box beside them, in the gaps between other visuals. Set
  `"auto_clips": { "context": "poker" }` in the plan so the searches stay on the subject, `exclude` for channels
  never to use (the creator's own), `skip` for names that aren't the subject.
- **Short and talked over:** under 10 s each (the build flags longer), the creator's voice continues over it, the
  clip's own sound off by default (`audio: 0.3` brings it up under the voice). Each clip shows a small "Source:
  channel" label, and CREDITS.md has the line for the description.
- **The creator checks, not hunts:** CLIPS.md links every pick to its exact second. Drop or swap any in the
  lockfile (`"status": "drop"`, `"pick": 2`, a new `"query"`), rerun `clips`, rebuild.
- **Real when it has to be real.** A real person or event needs the actual footage, never generated, re-created or
  staged. Something imagined (an AI dystopia, a future city) can come from movies, CGI or animation. Faking a real
  person (deepfakes, voice clones, impressions) is never used. Judge by what the clip is for, not a blanket rule.
- **Flashbacks** are the signature move, used sparingly: one or two in a video at most, many videos none. Reach back
  3 months to 2 years, to where the creator said the same thing (`node longform.mjs echoes`), rewind to it with the
  date on screen. Flash-forwards (`future` scene) are just as rare.
- **Don't use:** music videos or songs (the music gets claimed), full scenes from films and TV, another creator's
  video as the backbone of this one, private people in distress, or footage whose source can't be identified.

## 5. The publish package

A video is finished when all of this is handed over together:

1. The MP4, the review page, and anything still to pull.
2. **Three titles**: different angles (the question, the surprising claim, the plain description), under ~60
   characters, no clickbait the video doesn't pay off.
3. **Description**: the hook in the first two lines (they show before "more"), one paragraph on what the
   viewer learns, chapters from `CHAPTERS.txt`, sources with links, clip and stock credits.
4. **Tags**: 8-12, specific before general.
5. **Thumbnails**: `node longform.mjs thumbnail <plan>`, the creator picks one.
6. **Pinned comment**: one question that invites an answer, or the correction/caveat that didn't fit.
7. **Shorts**: `node longform.mjs shorts <plan>` with hand-picked ranges and hook titles; suggest an order
   (the strongest one the day the long video goes up, the rest over the following week).
8. What you are unsure about: unsourced claims, clips that might be claimed, anything the checks flagged.
