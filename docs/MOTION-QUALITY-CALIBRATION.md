# Calibrate a Motion Factory video judge

This fixture is a six-second illustrated scene with synthetic narration. It isolates five editing choices. Each pair has the same source audio and layout except for the defect under study. Treat the expected preference as a proposed standard. Ask the creator to confirm it before using the rubric on their projects.

| Criterion | Deliberate defect | Expected improvement | Review cue |
| --- | --- | --- | --- |
| Speaker continuity | Portrait disappears during the reveal | The same portrait travels to the corner and stays visible | At the move and transition midpoint |
| Spoken cue | Motion begins 780 ms after the cue | Motion starts on “Watch” | Compare the cut against the actual audio onset |
| Caption clearance | Subtitle covers the result labels | Captions and evidence remain visible together | During the result |
| Evidence legibility | Comparison values use small, low-contrast text | Larger, contrasting labels make both values readable | Read the values at delivery size |
| Hold duration | The result vanishes after 460 ms | The result is held for 2.25 s | Watch at normal speed |

## Reproduce the camera and sound evidence

Install Pillow and FFmpeg with the flite filter. From the repository root, run:

```sh
python tools/motion-quality-fixtures.py out/motion-quality
node --test tests/clef-motion-calibration.test.mjs
```

The review reel has five side-by-side comparisons. The ten individual MP4s are unlabelled in the picture so a model cannot pick a winner from a title card. The manifest records clip sizes and SHA-256 hashes and the measured speech onset. Keep the reel and MP4s outside Git.

## Send a blind pair to Clef Omni

Use `calibrationRequests(directory)` on the runner to assemble the two video orders, then send only `request.payload` to a trusted server-side Workers AI caller. Example binding call inside that caller:

```js
const response = await env.AI.run('@cf/cloudflare/clef-omni', payload);
```

Use `calibrationResult(request, response)` on the runner to retain the model's choice, probability distribution, confidence, and agreement with the expected winner. Keep raw MP4 bytes and credentials out of logs. This harness assembles requests and validates responses locally.

Compare results in both orders for each criterion. Record a disagreement or abstention as a calibration miss. Keep model judgments advisory until Austin and Allen agree on the examples and the model has been checked against representative, held-out cuts. Include pairs where both edits are acceptable and pairs where both are flawed before using comparisons as a release gate.

Cloudflare documents video sampling at 2 fps. Keep frame-accurate timing, overlap, captions, audio sync, and decode checks in the render pipeline. Use model judgment for the perceptual question of whether the edit reads clearly.

[Cloudflare Clef Omni model documentation](https://developers.cloudflare.com/workers-ai/models/clef-omni/)
