import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderStudy, sceneDocument } from '../tools/render-ui-motion.mjs';
import { example } from './ui-motion.test.mjs';
import { compileManifest } from '../tools/ui-motion-plan.mjs';

test('render failure reports the missing asset and preserves the previous good output',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ui-atomic-'));
  try {
    const output=join(dir,'good.mp4');await writeFile(output,'previous-good-output');
    await assert.rejects(()=>renderStudy(example(),{root:dir,output}),/source.*chart.png/i);
    assert.equal(await readFile(output,'utf8'),'previous-good-output');
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('unresolved targets fail before rendering and keep previous outputs intact',async()=>{
  const m=example();delete m.shots[0].target.bounds;
  await assert.rejects(()=>renderStudy(m,{root:'.',output:'unused.mp4'}),/review.*chart/i);
});
test('scene embeds exact copy as data and cannot introduce script tags from manifest strings',()=>{
  const m=example();m.shots[0].copy.callout='</script><script>bad()</script>';
  const html=sceneDocument(compileManifest(m));
  assert.ok(!html.includes('<script>bad()'));
  assert.ok(html.includes('\\u003c/script>'));
});
