# UI motion overnight build — 2026-11-21

Start: 2026-11-21 19:51 America/Phoenix (2026-11-22 02:51 UTC).
Deadline: 2026-11-22 03:51 America/Phoenix. Reserve final 30 minutes for verification/handoff.

## Scope and assumptions

- Branch `codex/ui-motion-20261121`, isolated worktree based on PR #15 head `928d483`. Original main checkout has human changes in fx/tests and assets; left untouched.
- Kit PR #15 and Ontrel PR #5 inspected; both open drafts. No concrete Ontrel compatibility gap identified, so no Ontrel edits planned.
- Design Memory library link returns login in both web reader and in-app browser. Cannot read or append; supply append-ready entry. Exact feedback in assignment remains the authority.
- References downloaded through authorized Drive connector, in assignment order. Synthetic originals only in exports. Reference binaries remain outside Git.
- Bahnschrift installed at Windows Fonts; do not redistribute its binary. Portable licensed fallback must be explicit and recorded.
- Primary study keeps exact reference copy: FIND / THE SIGNAL.; FOCUS / THE ACTION.; FOLLOW / THE CUT. Labels: TREND, PRIMARY ACTION, ACTIVE CLIP.
- Editorial/glass pair will keep accent, copy, layout, timing and audio constant, changing material only. Glass remains pending human approval.
- No narration needed for these UI graphics; use the same locally synthesized restrained audio bed and cue sounds in paired studies.
- Engineering checks, agent creative review, model advice and human approval remain separate.

## Milestone 0 — inspected

2026-11-21 20:00 Phoenix: read repository AGENTS/CLAUDE, motion rules, design guide, PR playbook and Clef harness. Inspected reference contact sheets. Existing renderer is deterministic Skia canvas with M timing and EditorialFX helpers. Plan: validated data-only manifests, geometry compiler, fixed reusable scene painter and atomic render wrapper; original synthetic screenshot fixtures.

Agent review of references: strong typography and alternating value establish hierarchy; target callout labels are too small at phone width. Port should preserve staged attention while enlarging those labels. This is agent judgment, not accepted design guidance.

## Milestone 1 — first repeatable reel verified

2026-11-21 20:03 Phoenix: tests written and observed failing before plan compiler,
renderer and fixture generator implementations. First 12s three-shot editorial
MP4 rendered, decoded and inspected at overview, focus and hold frames.
Fixed floating duration accumulation by rounding to frames. Used existing
installed FFmpeg binary in the fresh worktree dependency cache after the
ignore-scripts install left ffmpeg-static without a binary. No repository
dependency or renderer changes needed for that environment repair.

Biggest visible defect: mobile source label remained too small despite its
spotlight. Added a failing minimum target-width regression, widened its focus
viewport and supplied a normalized crop. Same source, copy and cue; button
width increases from 258px to ~495px. After frame inspected at 6.0s. Source
mapping stays shared across crops. Editorial and glass outputs both decode;
all 30 focused test invocations pass (includes repeated imported tests).

Existing full suite: 65/66 pass on Windows. The pre-existing verify_words test
writes a POSIX executable shell stub named `ffmpeg`; Windows Python rejects
it with WinError 193. This failure exists in unchanged baseline code; keep
it distinct from new recipe checks. No unrelated production fix attempted.

Quality loss versus standalone: focused source crops sacrifice some interface
context during the hold; overview restores context before the move. Label
legibility improves. Glass keeps the same red accent rather than reproducing
the older glass reel's mint, to isolate the material comparison. Sound review
and moving playback remain pending at this checkpoint.

## Milestone 2 — five rounds and frame verification

2026-11-21 20:15 Phoenix: rendered the editorial/glass pair, held-out table,
portrait/landscape recompose with caption reservations and edge target, and
10s/11s hold revision. Tightened only the table's focus framing after its
original control text proved small; retained that meaningful before/after.
The geometry stays in source space; no table-specific renderer code added.

Actual MP4 verification: 128 decoded samples across eight study exports.
Each checks setup, frame before cue, cue, during move, first readable frame,
hold midpoint/end and transition midpoint. All samples pass pixel comparison
against the deterministic scene; all during-move best offsets are zero
within a ±2 frame search. This is a pipeline timing check, not an independent
creative judgment. Metadata/decode checks also pass. Long labels now fail
with a legibility review error instead of shrinking without limit.

Self-review added failing tests for floating cue subtraction at 4.8s and
explicit gaps selecting a future shot too early. Fixed both. Added encoder
failure and source-dimension regressions. Fallback CLI flag order exposed a
path parsing bug; fixed after a failing test. All 20 unique recipe tests pass.
Tests use explicit licensed Barlow; review renders use installed Bahnschrift.

Normal-speed browser playback exercised with sampled visual observations.
Do not equate discrete screenshot observations with continuous motion or
audio listening. Audible review remains unverified. Real calibration clips
rendered with the installed Python 3.13/Pillow environment (`python3`);
Python 3.12 (`python`) lacked Pillow and was not modified. Ten existing Clef
request payloads validate against real MP4s in both orders. No verified
no-spend hosted caller/account binding; live scoring pending, no responses
invented. No new resources or model spend.

Code checkpoint includes focused CI with explicit Barlow generation, real
portrait/landscape renders and decoded-frame verification. Next: finish
playback checks, independent media metadata/audio checks, package and draft
PR. Glass and all example acceptance remain pending human approval.

## Milestone 3 — review package and CI correction

2026-11-21 20:18 Phoenix: draft PR #16 opened, stacked on PR #15. Focused
Linux CI passed its tests and fixture generation, then exposed missing
`ffprobe` on the runner. Add explicit FFmpeg/ffprobe installation to this
new job; local installed tools already provide them. First failing job:
https://github.com/MetaCode2023/motion-factory-kit/actions/runs/44979786905/job/137077547871

Playback observations revealed the synthetic editor playhead crossing the
word ACTIVE. A failing raster regression now requires readable source label
ink left of the playhead; move the unchanged text left, retain target bounds.
Rerender all affected reels and verify their decoded samples again. This
fixture correction does not affect the table before/after or hold pair.

2026-11-21 20:25 Phoenix: continued phone-size inspection found two remaining
source issues: timeline text was still small, and the landscape phone crop
cut through a context label. Added failing source-framing regressions, then
tightened the timeline focus window and moved the phone window into whitespace.
Targets, exact copy and cues remain fixed. Final 320px evidence strips will
show the original UI words, not just readable overlay labels.

Strengthened the director-revision evidence: final pair is now the full
three-shot reel at 12s/13s. Only `shots.2.hold` changes 2.4 -> 3.4 seconds;
the two earlier beats stay unchanged. The earlier single-shot diagnostic
was superseded and is not catalogued. Focused Linux CI now passes after
the explicit ffprobe dependency fix; final source-framing revision will
be pushed and checked again.

## Milestone 4 — scoped revision and final evidence

2026-11-21 20:31 Phoenix: a raw-frame equality test caught the global progress
spine changing earlier beats when the last hold grew. Changed the spine to
use per-chapter timing. The same test now verifies identical raw source
frames at 1.2s and 5.2s in the 12s/13s pair, including the spine. No renderer
code is supplied through the manifest. Re-rendered and checked all eight
studies against the final fixed scene; 160 decoded frame samples pass,
including zero best offsets on every sampled move. Final source controls
were inspected together at 320px width in the phone-readability strip.

The editorial/glass decoded PCM hashes match, as do the table pair hashes.
The revision pair's shared audio prefix matches. Audio is intentionally a
quiet synthetic diagnostic bed (editorial mean -39.8dB, peak -25.8dB), not a
claimed finished soundtrack. Listening remains unverified. Normal-rate
browser playback works; continuous perceptual review remains sampled.

Self-review complete: explicit target failures, source dimensions, exact
copy legibility, cue frames, safe areas, gaps, reduced motion, encoder
failure preserving prior output, and revision isolation have regressions.
Original main worktree's human changes remain untouched. No generated MP4
or Windows font binary added to Git. Existing Barlow license identifies
SIL Open Font License 1.1. New local recipe suite has 21 unique tests;
relevant Kit/Clef/recipe run has 31 tests. The existing full Windows suite's
one POSIX-stub failure stays separate from these results.

Review assets are uploaded privately through authorized Drive access; no
sharing permissions expanded. Design Memory is still inaccessible, so the
review package includes an append-ready entry and separate results JSON.
All creative examples, especially glass, remain pending human approval.
