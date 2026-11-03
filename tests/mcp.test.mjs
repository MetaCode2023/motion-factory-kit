// The MCP server: it starts, lists its tools, and the quick tools answer. Plus the plan checker and
// transcript sidecars it relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { checkPlan } from '../tools/plans.mjs';
import { normalizeWords, parseCues, readSidecar, wordsFromCues } from '../tools/transcripts.mjs';

const server = new URL('../mcp/server.mjs', import.meta.url).pathname;

test('MCP server lists its tools and answers kit_overview, check_plan and render_still', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mfk-mcp-'));
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env, FOOTAGE_DIR: dir } }));
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ['kit_overview', 'footage_index', 'footage_check_plan', 'footage_write_plan', 'footage_build', 'review_feedback', 'review_page', 'make_video', 'render_still', 'look_at']) assert.ok(names.includes(n), n);
    const ov = JSON.parse((await client.callTool({ name: 'kit_overview', arguments: {} })).content[0].text);
    assert.ok(ov.templates.some((t) => t.name === 'rapid-list' && /Data keys/.test(t.about)));
    assert.ok(ov.blocks.street.includes('questionCard'));
    const chk = JSON.parse((await client.callTool({ name: 'footage_check_plan', arguments: { plan: { name: 'x', segments: [] } } })).content[0].text);
    assert.equal(chk.ok, false);
    assert.match(chk.errors[0], /footage_index/);
    const still = await client.callTool({ name: 'render_still', arguments: { scene: 'scenes/templates/meme-caption.html', t: 1 } });
    assert.equal(still.content[0].type, 'image');
    assert.equal(still.content[0].mimeType, 'image/png');
    const bad = await client.callTool({ name: 'look_at', arguments: { file: '../../etc/passwd' } });
    assert.ok(bad.isError || /outside the kit/.test(JSON.stringify(bad)), 'paths outside the kit are refused');
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan checker catches unknown clips, missing sentences and made-up tallies', () => {
  const clips = new Map([['C01', { id: 'C01', duration: 8, sentences: [{ n: 0, s: 0.2, e: 2 }, { n: 1, s: 2.4, e: 6 }] }]]);
  const good = checkPlan({ name: 'a', segments: [{ clip: 'C01', sentence: 0, question: true }, { clip: 'C01', sentence: 1 }] }, clips);
  assert.ok(good.ok, JSON.stringify(good));
  assert.ok(good.estimatedLength > 4 && good.estimatedLength < 6);
  const bad = checkPlan({ name: 'b c', segments: [{ clip: 'C09' }, { clip: 'C01', sentence: 5 }], tally: { options: [{ label: 'Yes' }] } }, clips);
  assert.equal(bad.ok, false);
  const all = bad.errors.join(' | ');
  for (const s of ['name', 'C09', 's5', 'tally']) assert.ok(all.includes(s), s);
});

test('transcripts from a sidecar: words.json, SRT with speakers, WebVTT voices', () => {
  assert.deepEqual(normalizeWords({ words: [{ text: 'Hi', start: 0.1, end: 0.3, speaker: 'A' }, { w: '', s: 1, e: 2 }] }), [{ w: 'Hi', s: 0.1, e: 0.3, sp: 'A' }]);
  const cues = parseCues('1\n00:00:01,000 --> 00:00:03,000\nWould you pay eight dollars?\n\n2\n00:00:03,500 --> 00:00:05,000\nNo way.\n');
  assert.equal(cues.length, 2);
  const w = wordsFromCues(cues);
  assert.equal(w.length, 7);
  assert.equal(w[0].s, 1);
  assert.ok(w[4].e <= 3 && w[5].s >= 3.5);
  const vtt = parseCues('WEBVTT\n\n00:01.000 --> 00:02.500\n<v Host>What do you drink?\n');
  assert.equal(vtt[0].sp, 'Host');
  const dir = mkdtempSync(join(tmpdir(), 'mfk-side-'));
  try {
    writeFileSync(join(dir, 'clip.mp4'), 'x');
    writeFileSync(join(dir, 'clip.srt'), '1\n00:00:00,500 --> 00:00:02,000\nHello there\n');
    assert.equal(readSidecar(join(dir, 'clip.mp4')).via, 'subtitles');
    writeFileSync(join(dir, 'clip.words.json'), JSON.stringify([{ w: 'Hello', s: 0.5, e: 0.9 }]));
    assert.equal(readSidecar(join(dir, 'clip.mp4')).via, 'sidecar');   // exact timings win over subtitles
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
