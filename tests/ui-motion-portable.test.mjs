import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileManifest } from '../tools/ui-motion-plan.mjs';
import { compileLayout } from '../kit/ui-motion-layout.mjs';
test('browser layout matches the validated Node plan for the approved real editor example',()=>{
  const root=new URL('../examples/ui-motion/approved/ontrel-editorial-13s/',import.meta.url);
  const bytes=readFileSync(new URL('manifest.json',root)),m=JSON.parse(bytes),approval=JSON.parse(readFileSync(new URL('approval.json',root)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),approval.manifestSha256);
  assert.equal(approval.status,'human-approved');assert.equal(approval.artifact.duration,13);
  assert.deepEqual(compileLayout(m),compileManifest(m));
});
