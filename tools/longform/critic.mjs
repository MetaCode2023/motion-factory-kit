// Deliberately harsh, score-free review. It receives only the resolved plan and the sampled still list:
// no script rationale, previous feedback, or implementation notes that could bias a second reviewer.
import { fmt } from './common.mjs';
import { existsSync, readFileSync } from 'node:fs';

const note = (level, t, where, problem, change, keep) =>
  `- **${level}** t=${(+t).toFixed(1)}s · ${where} · ${problem} -> ${change} · keep: ${keep}`;

export function harshReview(R, plan, shots = []) {
  const notes = [];
  if (!R.inserts.length) notes.push(note('P0', 0, 'whole video', 'no planned visual cues', 'add proof or explanatory visuals in narration order before building', 'the A-roll and spoken structure'));
  for (const i of R.inserts) {
    if (i.kind === 'pull') notes.push(note('P0', i.at, i.id, 'placeholder footage is still visible', 'pull or replace this exact clip', 'its timing and narration'));
    if (!i.note && !i.title && !i.src?.search && i.kind !== 'animation') notes.push(note('P1', i.at, i.id, 'the visual has no stated editorial job', 'write a one-line note saying what this proves', 'the source and duration'));
    if (i.dur < 1.5) notes.push(note('P1', i.at, i.id, `${i.dur.toFixed(1)}s is too brief to understand`, 'hold it for at least 1.5s or simplify it', 'its start time'));
  }
  let end = 0;
  for (const i of R.inserts) {
    if (i.at - end > 45) notes.push(note('P1', end, 'speaker stretch', `${(i.at - end).toFixed(1)}s passes without a planned visual change`, 'add one relevant visual beat inside this stretch', 'the surrounding cues'));
    end = Math.max(end, i.at + i.dur);
  }
  if (R.total - end > 45) notes.push(note('P1', end, 'ending stretch', `${(R.total - end).toFixed(1)}s passes without a planned visual change`, 'add one relevant beat before the close', 'the final call to action'));
  for (const [at, dur] of R.frozen || []) notes.push(note('P1', at, 'picture', `the frame barely changes for ${dur.toFixed(1)}s`, 'add intentional motion or cut to a new image', 'the words and overall visual idea'));
  for (const w of R.warnings || []) notes.push(note('P2', 0, 'plan', w, 'resolve this warning or record why it is intentional', 'all unaffected cue timing'));
  if (!notes.length) notes.push(note('P2', 0, 'whole video', 'no deterministic defect was found; this is not aesthetic approval', 'watch once with sound off and once without reading the plan', 'the approved structure'));

  const frames = shots.map((s, k) => {
    const i = R.inserts.find((x) => s.t >= x.at && s.t < x.at + x.dur);
    const desc = i
      ? `A stranger sees **${i.note || i.title || i.src?.search || i.id}** (${i.kind}/${i.layout}) and should understand why it supports the current line without plan context.`
      : 'A stranger sees the speaker or backdrop; check that framing, captions, and expression carry the moment without relying on the next cue.';
    return `${k + 1}. **${fmt(s.t)} — ${s.label}:** ${desc}`;
  });
  const ranked = ['P0', 'P1', 'P2'].flatMap((p) => notes.filter((n) => n.includes(`**${p}**`)));
  return [
    `# Harsh review: ${plan.title || plan.name}`, '',
    '> Reviewer boundary: this pass used only the resolved plan and sampled stills. It did not use the script rationale, prior feedback, or a numeric rating.', '',
    'Read this file before REPORT.md in the next session. Fix P0 first, then P1. P2 is polish or an explicit decision.', '',
    '## Ranked changes', '', ...ranked, '',
    '## Stranger-eye frame read', '', ...(frames.length ? frames : ['No key frames were supplied. Generate the contact sheet again.']), '',
  ].join('\n');
}

export function readabilityChecks(R) {
  const warnings = [];
  for (const i of R.inserts || []) {
    const text = [i.note, i.title, ...Object.values(i.data || {}).filter((x) => typeof x === 'string')].filter(Boolean).join(' ');
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const need = words ? 0.45 + words / 3 : 0;
    if (need > i.dur) warnings.push(`${i.id}: ${words} on-screen words need about ${need.toFixed(1)}s, but the cue lasts ${i.dur.toFixed(1)}s`);
    if (i.kind === 'animation' && i.scene && existsSync(i.scene)) {
      const sizes = [...readFileSync(i.scene, 'utf8').matchAll(/(?:font\s*=\s*['"`][^'"`]*?|font:\s*['"`][^'"`]*?)(\d+(?:\.\d+)?)px/g)].map((m) => +m[1]);
      const tiny = sizes.filter((x) => x > 0 && x < 28.1);
      if (tiny.length) warnings.push(`${i.id}: scene declares ${Math.min(...tiny)}px text, under 2.6% of the 1080px short side (28px)`);
    }
  }
  return warnings;
}
