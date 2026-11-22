import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadImage, Canvas } from 'skia-canvas';
import { generateFixtures } from '../tools/ui-motion-fixtures.mjs';
import { compileManifest } from '../tools/ui-motion-plan.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('synthetic fixture generator writes matching source dimensions and renderable three-shot plan',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ui-fixtures-'));
  try{await generateFixtures(dir,{font:'Barlow'});const m=JSON.parse(await readFile(join(dir,'editorial.json'),'utf8'));
    const plan=compileManifest(m);assert.equal(plan.duration,12);assert.equal(plan.shots.length,3);
    for(const s of plan.shots){assert.equal(s.status,'ready');const img=await loadImage(join(dir,s.source.path));assert.equal(img.width,s.source.width);assert.equal(img.height,s.source.height);}
    assert.ok(plan.shots[1].mapped.target.w>450,'primary action must fill enough width for its original label to read on a phone');
    const held=compileManifest(JSON.parse(await readFile(join(dir,'held-out-table.json'),'utf8')));
    assert.ok(held.shots[0].mapped.target.w>350,'held-out control must read without relying on the callout');
    const editor=await loadImage(join(dir,'fixtures/editor.png')),c=new Canvas(1100,650).getContext('2d');c.drawImage(editor,0,0);
    const labelPixels=c.getImageData(540,430,35,34).data;let readableInk=0;
    for(let i=0;i<labelPixels.length;i+=4)if(labelPixels[i]>230&&labelPixels[i+1]>210&&labelPixels[i+2]>200)readableInk++;
    assert.ok(readableInk>30,'editor label must sit to the left of the playhead instead of being crossed by it');
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('fixture CLI accepts explicit fallback flag before output directory',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ui-cli-'));
  try{const output=join(dir,'output'),script=fileURLToPath(new URL('../tools/ui-motion-fixtures.mjs',import.meta.url));
    const run=spawnSync(process.execPath,[script,'--barlow',output],{cwd:dir,encoding:'utf8'});assert.equal(run.status,0,run.stderr);
    assert.equal(JSON.parse(await readFile(join(output,'editorial.json'),'utf8')).font,'Barlow');
  }finally{await rm(dir,{recursive:true,force:true});}
});
