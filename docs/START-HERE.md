# Start here: your first long video

You talk to Claude. Claude writes the script with you, you record it, and Claude builds the video.
You never have to type the commands in this repo yourself; Claude runs them. This page is the one-time setup
and what to say.

## One-time setup (about 20 minutes)

1. **Install four things** if you don't have them:
   - **Claude Code**: <https://claude.com/claude-code>
   - **Node** (the "LTS" version): <https://nodejs.org>
   - **Python 3**: <https://www.python.org/downloads/> (on Windows, tick "Add Python to PATH")
   - **Google Chrome** (you probably have it; it draws the 3D animations)
2. **Get this repo onto your computer.** Open Claude Code and say:
   > Clone https://github.com/MetaCode2023/motion-factory-kit into my Documents folder and open it.
3. **Let Claude finish the install.** In that folder, say:
   > Set this up for long-form videos. Run the doctor check and fix whatever is missing.

   Claude installs the rest and tells you if anything still needs you.
4. **Optional, for stock footage:** get a free key at <https://www.pexels.com/api/> and give it to Claude
   ("here's my Pexels key, save it for this project"). Without it, stock shots stay as labelled placeholders.

You're set up when Claude says the check is **Ready**.

## Making a video

1. **Say what it's about.**
   > Let's make a 10-minute video on how taxes work.

   Claude asks for the angle, researches it, and writes a script with you. Push back as much as you like:
   "less formal", "cut the second chapter", "that joke isn't me". It scores the script for where viewers
   tend to leave and fixes those spots.
2. **Record it.** Claude gives you a clean reading copy (a `.read.txt` file: just the words, no markup).
   Read it into your mic, or on camera. Flub a line? Say it again and keep going. No need to stop or edit.
3. **Hand over the recording.** Put the file anywhere and tell Claude where:
   > The recording is on my Desktop, taxes-take1.mp4. Build the video.
4. **Review it.** Claude gives you the video and a review page. Open `review.html`, watch, pause wherever
   something is off, type a note, press Add. When you're done press **Save notes** and tell Claude:
   > My notes are in Downloads. Apply them.
5. **Publish.** Ask for the rest when you're happy:
   > Give me titles, the description, thumbnails and shorts.

## Things worth saying

- "Use the paper look for this one." (Looks: aurora, blueprint, noir, sunset, paper, terminal.)
- "Keep my face on screen more." / "This one is voice only."
- "Learn how I talk from these recordings." (Point it at a few of your solo videos. It measures your pace
  and phrases so scripts sound like you.)
- "Find me two outside clips that prove this point." (It proposes; you decide. Keep them short.)
- "Show me the thumbnails." / "Cut three shorts from this."

## What to expect

- A build takes a while: roughly 15 to 30 minutes for a 10-minute video, depending on your computer.
  Later rebuilds are much faster because finished animations are reused.
- Dashed boxes in the video are spots waiting for stock footage or an outside clip.
- The script file itself (`.script.md`) has visual cues in double brackets, like `[[stat value: 1,326 …]]`.
  That's Claude's markup for where each animation goes. Read the `.read.txt` instead.
- Your scripts, recordings and videos stay on your computer. They are never uploaded to this repo.

## If something goes wrong

Tell Claude what you saw, in plain words ("the build stopped with an error", "the captions are off at 2:10").
It can read its own reports and fix most things. If it says something is missing on your machine, say
"run the doctor check" and follow what it lists.
