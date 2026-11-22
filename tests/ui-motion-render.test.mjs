import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderStudy, sceneDocument } from '../tools/render-ui-motion.mjs';
import { example } from './helpers/ui-motion-example.mjs';
import { compileManifest } from '../tools/ui-motion-plan.mjs';
import { Canvas } from 'skia-canvas';

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
test('encoder failure after staging preserves good output and cleans only its temporary directory',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ui-encoder-failure-'));
  try{const m=example(),canvas=new Canvas(1000,500);await writeFile(join(dir,'chart.png'),await canvas.toBuffer('png'));
    const output=join(dir,'good.mp4');await writeFile(output,'previous-good-output');
    await assert.rejects(()=>renderStudy(m,{root:dir,output,renderCommand:async()=>{throw new Error('simulated encoder failure');}}),/encoder failure/);
    assert.equal(await readFile(output,'utf8'),'previous-good-output');
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('source dimension mismatch is rejected before a renderer is invoked',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ui-dimensions-'));
  try{await writeFile(join(dir,'chart.png'),await new Canvas(10,10).toBuffer('png'));
    await assert.rejects(()=>renderStudy(example(),{root:dir,output:join(dir,'bad.mp4')}),/dimensions mismatch/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('long exact copy is flagged for review instead of silently shrinking below legible size',async()=>{
  const m=example();m.shots[0].copy.callout='This exact label is much too long to remain readable in the available space';
  await assert.rejects(()=>renderStudy(m,{root:'.',output:'unused.mp4'}),/copy.*legib/i);
});
