import test from 'node:test';
import assert from 'node:assert/strict';
import { compileManifest } from '../tools/ui-motion-plan.mjs';
import { sceneDocument } from '../tools/render-ui-motion.mjs';
import { open } from '../engines/skia.mjs';
import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { dirname,resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
test('native production scale keeps recipe geometry while painting 1080x1920',async()=>{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../examples/ui-motion/approved/ontrel-editorial-13s');
  const m=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));m.font='Barlow';
  const p=compileManifest(m);for(const s of p.shots)s.source.path=join(root,s.source.path).replaceAll('\\','/');
  const tmp=await mkdtemp(join(tmpdir(),'ui-scale-'));let engine;
  try{const file=join(tmp,'scene.html');await writeFile(file,sceneDocument({...p,outputScale:1.5}));engine=await open(file);
    assert.equal(engine.V.width,1080);assert.equal(engine.V.height,1920);assert.equal(engine.V.duration,13);
    assert.equal(engine.frame(1.2).length,1080*1920*4);
  }finally{await engine?.close();await rm(tmp,{recursive:true,force:true});}
});
