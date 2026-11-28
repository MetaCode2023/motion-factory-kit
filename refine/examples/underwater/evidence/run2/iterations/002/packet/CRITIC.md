# Isolated visual critique (still, iteration 2)

You are the critic for one refinement iteration. You have NOT seen, and must not ask for, the
scene source code or its parameters. Judge only what is on screen, against the reference plates,
the brief and DESIGN.md. Look at every image listed in packet.json (Read them).

Brief: A calm natural-history documentary shot: sunlight shafts in open water, the camera cranes down onto a sea turtle gliding over caustic-lit sand, then racks focus to marine snow drifting in front of the lens. Quiet awe, observational, cool deep blue with the turtle's amber shell as the only warm accent.

For each criterion in packet.json, decide **pass** or **fail** using its passWhen/failWhen text.
Write what you saw (observation), how it differs from the reference (delta), which evidence ids you
looked at, and for every fail a concrete visual correction ("shafts should fan from upper-left and
fade by mid-frame", not "make it better"). No numeric scores, ratings or superlatives: they are
rejected. Measured deltas are listed for you; they are evidence, not verdicts, and they can be wrong.
If the brief itself seems to need a different creative direction than the plates show, set
"directionShift": true and explain in "summary" (a human will decide).

Write critique.json in this folder:

{
  "critic": { "id": "<who you are>", "context": "isolated", "sawSourceCode": false },
  "outputHash": "7a44a019d1821cc979ff6f860e2c3303ed324ed784f43c2f4ee0919a58399a2c",
  "packetHash": "4e7860cf33ee689bb8ad73608f9f794e761738e1bdb921b45e11d8e7d9583f1e",
  "criteria": {
    "composition": { "verdict": "pass|fail", "observation": "...", "delta": "...", "evidence": ["frame:t=..."], "correction": "..." },
    "lighting": { "verdict": "pass|fail", "observation": "...", "delta": "...", "evidence": ["frame:t=..."], "correction": "..." },
    "materials": { "verdict": "pass|fail", "observation": "...", "delta": "...", "evidence": ["frame:t=..."], "correction": "..." },
    "spatial": { "verdict": "pass|fail", "observation": "...", "delta": "...", "evidence": ["frame:t=..."], "correction": "..." },
    "color": { "verdict": "pass|fail", "observation": "...", "delta": "...", "evidence": ["frame:t=..."], "correction": "..." },
    "narrative": { "verdict": "pass|fail", "observation": "...", "delta": "...", "evidence": ["frame:t=..."], "correction": "..." },
    "originality": { "verdict": "pass|fail", "observation": "...", "delta": "...", "evidence": ["frame:t=..."], "correction": "..." }
  },
  "summary": "one or two sentences",
  "directionShift": false
}
