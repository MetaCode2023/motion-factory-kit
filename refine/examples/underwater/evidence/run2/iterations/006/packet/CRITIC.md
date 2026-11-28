# Isolated visual critique (still, iteration 6)

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
  "outputHash": "09d1923badc712a6da7aa1c1da03c94e22cae341bff1e4b339d43a1ef19fa953",
  "packetHash": "b897d34af8e006770b6b21d0bf55dee3cee6847e6e411c9b81ff2a3116060633",
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
