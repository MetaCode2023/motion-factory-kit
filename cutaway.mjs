import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const shortText = (max) => z.string().trim().min(1).max(max);
export const source = z.object({
  projectId: shortText(160),
  lineId: shortText(160),
  text: shortText(2000),
});
export const direction = z.object({
  title: shortText(36),
  subject: z.enum(['document', 'signal', 'growth', 'idea']),
  layout: z.enum(['center', 'stack']),
  palette: z.enum(['amber', 'teal', 'violet']),
});
const idSchema = z.uuid();
const writeJson = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2), { flag: 'wx' });
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function prepareCutaway(root, { line, options }) {
  const input = source.parse(line);
  const directions = z.array(direction).min(1).max(3).parse(options);
  const id = randomUUID();
  const folder = join(root, id);
  mkdirSync(root, { recursive: true });
  mkdirSync(folder);
  directions.forEach((data, index) => writeJson(join(folder, `option-${index + 1}.json`), data));
  writeJson(join(folder, 'draft.json'), { id, line: input, options: directions });
  return { id, folder };
}

function matchesLine(saved, current) {
  const line = source.parse(current);
  if (line.projectId !== saved.projectId || line.lineId !== saved.lineId) {
    throw new Error('This cutaway belongs to a different script line');
  }
  return line.text === saved.text;
}

export function cutawayStatus(root, { draftId, selectionId, currentLine }) {
  const folder = join(root, idSchema.parse(draftId));
  const selection = readJson(join(folder, `selection-${idSchema.parse(selectionId)}.json`));
  return { status: matchesLine(selection.line, currentLine) ? 'current' : 'stale', selection };
}

export function selectCutaway(root, { id, option, currentLine, feedback }) {
  const folder = join(root, idSchema.parse(id));
  const draft = readJson(join(folder, 'draft.json'));
  const line = source.parse(currentLine);
  if (!matchesLine(draft.line, line)) return { status: 'stale', line: draft.line };
  const selected = z.number().int().min(1).max(draft.options.length).parse(option);
  const render = readJson(join(folder, `option-${selected}.result.json`));
  if (!render.ok) return { status: 'needs_review', checks: render.checks };
  const selection = {
    id: randomUUID(),
    draftId: id,
    line,
    option: selected,
    direction: draft.options[selected - 1],
    video: render.video,
    preview: render.cuts,
    report: render.report,
    ...(feedback ? { feedback: shortText(1000).parse(feedback) } : {}),
    selectedAt: new Date().toISOString(),
  };
  const handoff = join(folder, `selection-${selection.id}.json`);
  const pending = handoff + '.pending';
  writeJson(pending, selection);
  renameSync(pending, handoff);
  return { status: 'selected', handoff, ...selection };
}

// Selection history is scoped to the requested project. Return directions and notes only.
export function cutawayPreferences(root, projectId) {
  const project = source.shape.projectId.parse(projectId);
  const selections = [];
  if (!existsSync(root)) return selections;
  for (const folder of readdirSync(root, { withFileTypes: true })) {
    if (!folder.isDirectory() || !idSchema.safeParse(folder.name).success) continue;
    const directory = join(root, folder.name);
    for (const name of readdirSync(directory)) {
      if (!/^selection-[a-f0-9-]+\.json$/.test(name)) continue;
      const { line, direction, feedback, selectedAt } = readJson(join(directory, name));
      if (line.projectId === project) selections.push({ direction, feedback, selectedAt });
    }
  }
  return selections.sort((a, b) => b.selectedAt.localeCompare(a.selectedAt)).slice(0, 10);
}
