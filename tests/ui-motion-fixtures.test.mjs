import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadImage } from 'skia-canvas';
import { generateFixtures } from '../tools/ui-motion-fixtures.mjs';
import { compileManifest } from '../tools/ui-motion-plan.mjs';
test('synthetic fixture generator writes matching source dimensions and renderable three-shot plan',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ui-fixtures-'));
  try{await generateFixtures(dir,{font:'Barlow'});const m=JSON.parse(await readFile(join(dir,'editorial.json'),'utf8'));
    const plan=compileManifest(m);assert.equal(plan.duration,12);assert.equal(plan.shots.length,3);
    for(const s of plan.shots){assert.equal(s.status,'ready');const img=await loadImage(join(dir,s.source.path));assert.equal(img.width,s.source.width);assert.equal(img.height,s.source.height);}
    assert.ok(plan.shots[1].mapped.target.w>450,'primary action must fill enough width for its original label to read on a phone');
  }finally{await rm(dir,{recursive:true,force:true});}
});
