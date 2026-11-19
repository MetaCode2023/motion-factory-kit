# Run reports

One file per video: `YYYY-MM-DD-<name>.md`. Written by the agent that made it, updated when feedback comes back.
It is how the next agent learns what was tried, what the owner thought, and what to change in the kit.
Finished videos live in the project's shared folder, not in git; source footage, scripts and plans are git-ignored,
so write the decisions in words here, without private details (no client data, no quotes nobody approved).

```markdown
# <Video title> (<format>, <length>)

Date · source footage (what and how long) · output location · plan/brief file names

## What I decided, and why
- One idea:
- Hook:
- Structure:
- Cut:
- Added:
- Formats:

## Defaults I guessed (open questions)

## Feedback
- <date> <who>: <note> -> <what changed in the video> -> <rule added to TASTE.md, or why not>

## What to change in the kit
- <tool/doc>: <the change> (done in <PR> / queued in STATUS.md)
