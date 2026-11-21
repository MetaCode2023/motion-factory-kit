import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Canvas} from 'skia-canvas';

const window={};
vm.runInNewContext(readFileSync(new URL('../kit/motion.js', import.meta.url),'utf8'), {window});
const {M}=window;

test('oversized stacks cannot paint past the content box',()=>{
  const canvas=new Canvas(1080,1920),ctx=canvas.getContext('2d');
  const result=M.stack(ctx,1,{x:70,y:800,w:1000,h:500},[
    {at:0,h:900,draw(c,x,y,w){c.fillStyle='#fff';c.fillRect(x-1000,y-1000,w+2000,3000);}}
  ]);
  assert.ok(result.scale<1);
  for (const [x,y] of [[950,900],[100,1500],[10,900],[100,750]])
    assert.equal(ctx.getImageData(x,y,1,1).data[3],0);
  assert.ok(ctx.getImageData(100,900,1,1).data[3]>0);
});

test('safeBox intersects all four boundaries and handles empty boxes',()=>{
  const b=M.safeBox({x:0,y:0,w:2000,h:2000});
  assert.deepEqual(JSON.parse(JSON.stringify(b)),{x:70,y:220,w:870,h:1220});
  assert.equal(M.stack(new Canvas(10,10).getContext('2d'),0,{x:1000,y:1500,w:10,h:10},[]).h,0);
});

test('a push draws exactly one opaque beat at every transition frame',()=>{
  const ctx=new Canvas(10,10).getContext('2d');
  for(let frame=0;frame<=24;frame++) {
    const calls=[];
    M.push(ctx,frame/60,0,()=>calls.push(['old',ctx.globalAlpha]),()=>calls.push(['new',ctx.globalAlpha]));
    assert.equal(calls.length,1,`frame ${frame}`);
    assert.equal(calls[0][1],1);
  }
});

test('the whiteboard simulation renders the same frames after seeking in either direction', async () => {
  const { open } = await import('../engines/skia.mjs');
  const scene = 'scenes/examples/whiteboard-simulation.html';
  const sequential = await open(scene);
  const randomAccess = await open(scene);
  const early = sequential.frame(0.25);
  const late = sequential.frame(4.125);
  assert.notDeepEqual(early, late);
  assert.deepEqual(randomAccess.frame(4.125), late);
  assert.deepEqual(randomAccess.frame(0.25), early);
  assert.deepEqual(randomAccess.frame(4.125), late);
});

test('camera paths preserve viewport framing and track a moving focus at any time', () => {
  vm.runInNewContext(readFileSync(new URL('../kit/fx.js', import.meta.url), 'utf8'), { window });
  const { FX } = window;
  const path = FX.cameraPath([
    { at: 0, focus: { x: 100, y: 50 } },
    { at: 2, focus: t => ({ x: 80 + 10 * t, y: 40 }), zoom: 2 },
    { at: 4, focus: t => ({ x: 80 + 10 * t, y: 40 }), zoom: 2 },
    { at: 6, focus: { x: 100, y: 50 } },
  ], { width: 200, height: 100 });
  const values = t => Object.values(path(t));
  assert.deepEqual(values(3), [2, -20, 20]);
  assert.deepEqual(values(1), [1.5, 7.5, 7.5]);
  assert.deepEqual(values(3), [2, -20, 20]);
  assert.deepEqual(values(-1), [1, 0, 0]);
  assert.deepEqual(values(7), [1, 0, 0]);
  assert.throws(() => FX.cameraPath([{ at: 2 }, { at: 2 }], { width: 200, height: 100 }), /increasing/);
});

test('one-take simulation frames match after jumping from the reveal back to impact', async () => {
  const { open } = await import('../engines/skia.mjs');
  const scene = await open('scenes/examples/whiteboard-one-take.html');
  assert.equal(scene.V.duration, 15);
  assert.deepEqual(Array.from(scene.V.cuts), []);
  const collision = scene.V.sfx[1].at;
  const frame = scene.frame(collision + 0.1);
  assert.notDeepEqual(scene.frame(14), frame);
  assert.deepEqual(scene.frame(collision + 0.1), frame);
});
