# Long-form playbook

The standing rules for making a series, not just one video. Claude reads this before drafting a script and
again before handing a video over. The creator's own files (`scripts/VOICE.md`, `scripts/SERIES.md`) are
git-ignored: they describe a person and a channel, not this repo.

## 0. Depth: teach like a polymath, explain like a friend

The creator doesn't want the explanation every other channel gives. Write as a cutting-edge educator who
connects fields (physics to philosophy, history to economics, biology to the viewer's own life), and assume
the viewer has never heard of any of it.

- **Go to the idea that's actually profound**, not the textbook summary. Quantum mechanics is not "particles
  are weird": it's superposition, what a measurement does, the collapse question, Copenhagen versus Many Worlds,
  and what it means that the observer is part of the system. Find the version of the topic that changes how
  the viewer sees themselves or the world, and build to it.
- **Every term is earned before it's used.** Introduce the plain picture first, then name it ("a cloud of
  maybe, called a superposition"). One new term per ~20 seconds at most. Never stack jargon.
- **One concrete image per idea**, something the viewer can see (dots building stripes on a screen, a coin
  still spinning), then the abstraction.
- **Name the open question honestly.** Where experts disagree (interpretations, contested numbers), say so,
  give the main positions in one sentence each, and don't pretend it's settled.
- **No filler phrases** ("in today's world", "it's important to note", "mind-blowing"). Short sentences, said out loud.
- **End on the turn back to the viewer**: what this means for them, in one line.

Check a draft by reading it as someone who has never studied the subject: every sentence should be
understandable on its own and lead to the next.

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

## 4. B-roll and outside clips

**B-roll runs through the whole video** (`auto_broll` defaults to `mode: "throughout"`): every thing the
speaker names gets a shot, held until the next one, and real footage is preferred over photos.

- Free footage first: `node longform.mjs broll` searches Wikimedia Commons video (NASA, ESA, university labs,
  museums) before photos, and credits every pick. Read `BROLL.md`: every shot must show **the actual subject**
  of that line (a national park named = footage of that park, a real experiment = that experiment). Swap any
  that are only loosely related (`"query"` or `"pick": 2` in the lockfile).
- Where free footage can't show it, find a real clip on YouTube, TikTok, Instagram or a news site and add it
  as a `clip` cue (exact URL, from, to). **Validate it before proposing it**: check the video's title,
  channel and the frames at those timestamps really show the subject (pull it and look at stills; don't trust a
  title alone). Pulls run on the creator's computer (`node longform.mjs pull`), where yt-dlp can reach the sites.

Outside clips (someone else's video):

- The creator decides what to use. Claude proposes: the exact URL, start and end, what it proves, and one
  line on why this clip and not another.
- Short and talked over: under 10 s each (the build flags longer), the creator's voice continues over it,
  the clip's own sound low or off. A clip is evidence for a point the creator is making, never the content.
- As many as the points need, each one short and from a source you can name. Credit every one in the description
  (`assets/broll/CREDITS.md` collects them).
- Don't propose: music videos or songs, full scenes from films and TV, sports broadcasts, another creator's
  video used as the backbone of this one, anything showing private people in distress, or footage whose
  source can't be identified.
- If a point can be shown with a drawn animation, stock footage or the creator's own footage instead, prefer that.

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
