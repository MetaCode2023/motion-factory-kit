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
