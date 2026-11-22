import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
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
