# Underwater demo: evidence

Text evidence for the Phase 7 demonstration (frames, packets and videos are excluded from git for size;
`run2/manifest.json` lists the sha256 of every file in the full 148-file bundle, and the per-iteration
scene snapshots + params reproduce each render deterministically).

- **run1-escalated/**: the first run stopped at iteration 1 with `creative-direction-shift` — the isolated
  critic found the hero plate's shell teal while DESIGN.md asks for amber. The stand-in plate was fixed and
  the contract re-hashed (run 2).
- **run2/**: six still iterations, each with scene snapshot, params, delta log, isolated critique and
  record (hash chain in `chain.json`). Criteria passing by iteration: 0, 0, 0, 1 (composition),
  2 (+colour), 3 (+narrative). Lighting, materials, spatial and originality never passed, so the loop
  escalated `budget-exhausted` to a human after iteration 6; temporal refinement and the final render are
  refused until a human resolves it.
- **COMPARISON.md / comparison.png**: single-pass vs legacy technical+layout review vs visual refinement,
  measured against the plates. Paths 1 and 2 are byte-identical pictures: the legacy review passed the
  picture and only flagged missing sound (`path2-legacy.report.md`).
