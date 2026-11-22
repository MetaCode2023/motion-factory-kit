import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleFrames, meanPixelError } from '../tools/verify-ui-motion.mjs';
test('verification samples both sides of each cue and readable hold plus transition midpoint',()=>{
  const samples=sampleFrames({fps:30,duration:12,shots:[{id:'one',start:0,cue:.8,move:.4,end:4,transition:{duration:.4}}]});
  for(const frame of [0,23,24,27,36,72,107,114])assert.ok(samples.some(s=>s.frame===frame),`missing frame ${frame}`);
});
test('pixel comparison rejects shape mismatches and measures visible differences',()=>{
  assert.equal(meanPixelError(new Uint8Array([0,0,0,255]),new Uint8Array([0,0,0,255])),0);
  assert.equal(meanPixelError(new Uint8Array([0,0,0,255]),new Uint8Array([30,0,0,255])),10);
  assert.throws(()=>meanPixelError(new Uint8Array(4),new Uint8Array(8)),/dimensions/);
});
