import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateFixtures } from '../tools/ui-motion-fixtures.mjs';
import { compileManifest,mapTarget } from '../tools/ui-motion-plan.mjs';
import { sceneDocument } from '../tools/render-ui-motion.mjs';
import { open } from '../engines/skia.mjs';
const sandbox={window:{M:{clamp:(v)=>Math.max(0,Math.min(1,v)),ease:{outCubic:p=>1-(1-p)**3}}}};
vm.runInNewContext(readFileSync(new URL('../kit/ui-motion.js',import.meta.url),'utf8'),sandbox);
test('explicit gaps do not start the next shot early',()=>{
  const shots=[{start:0,end:4},{start:5,end:9}];
  assert.equal(sandbox.window.UIMotion.activeShot(shots,4.5),0);
  assert.equal(sandbox.window.UIMotion.activeShot(shots,5),1);
});
test('runtime cue state matches deterministic frame and reduced motion behavior',()=>{
  const shot={start:4,end:8,cue:.8,move:.4,accessibility:{reducedMotion:false}};
  assert.equal(sandbox.window.UIMotion.state(shot,4.8-1/30).visible,false);
  assert.equal(sandbox.window.UIMotion.state(shot,4.8).visible,true);
  shot.accessibility.reducedMotion=true;assert.equal(sandbox.window.UIMotion.state(shot,4.8).progress,1);
});
test('scoped holds and internal target metadata leave unrelated source frames identical',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ui-preserve-beats-'));let a,b,c;
  try{await generateFixtures(dir,{font:'Barlow'});
    async function scene(stem,internalNames=false){const input=JSON.parse(await readFile(join(dir,stem+'.json'),'utf8'));if(internalNames)for(const s of input.shots)s.target.name='INTERNAL CAPTURE NOTE';const p=compileManifest(input);
      for(const s of p.shots){s.source.path=join(dir,s.source.path).replaceAll('\\','/');s.overview=mapTarget(s.source,s.target.bounds,s.viewport,'contain');}
      const path=join(dir,stem+(internalNames?'-internal':'')+'.html');await writeFile(path,sceneDocument(p));return open(path);}
    a=await scene('revision-before');b=await scene('revision-after');
    for(const t of [1.2,5.2])assert.ok(a.frame(t).equals(b.frame(t)),`unrelated beat changes at ${t}s`);
    c=await scene('revision-before',true);assert.ok(a.frame(1.2).equals(c.frame(1.2)),'internal target metadata must not leak into rendered text');
  }finally{await a?.close();await b?.close();await c?.close();await rm(dir,{recursive:true,force:true});}
});
