import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, mapTarget, placeCallout, compileManifest, reviseHold, planDiff, shotState } from '../tools/ui-motion-plan.mjs';

export function example() {
  return { version: 1, id: 'test', aspect: '9:16', fps: 30, theme: 'editorial', accent: '#ee302b', font: 'Bahnschrift',
    shots: [{ id: 'chart', source: { path: 'chart.png', width: 1000, height: 500 },
      target: { name: 'trend', bounds: { x: .1, y: .2, w: .3, h: .2 } },
      copy: { headline: ['FIND', 'THE SIGNAL.'], callout: 'TREND' },
      cue: .8, move: .4, hold: 2.4, transition: { kind: 'chapter', duration: .4 },
      treatment: 'spotlight', fit: 'contain', fallback: 'review', accessibility: { reducedMotion: false, minTargetPixels: 18 }, protected: [] }] };
}
test('v1 validates exact copy and rejects unsupported code/data and invalid geometry', () => {
  const m = example(); assert.deepEqual(validateManifest(m), m);
  for (const mutate of [m => m.version=2, m => m.shots[0].target.bounds.w=NaN,
    m => m.shots[0].target.bounds.x=.9, m => m.shots[0].cue=-1,
    m => m.shots[0].copy.callout='', m => m.shots[0].draw='eval()',
    m => m.shots[0].cue=.81, m => m.shots[0].source.width=0,
    m => m.shots[0].target.name='', m => m.shots[0].transition.kind='unknown']) {
    const bad=structuredClone(m); mutate(bad); assert.throws(()=>validateManifest(bad));
  }
});
test('normalized target accounts for contain letterboxing and cover crop offsets', () => {
  const source={width:1000,height:500}, viewport={x:20,y:40,w:600,h:600}, bounds={x:.1,y:.2,w:.3,h:.2};
  assert.deepEqual(mapTarget(source,bounds,viewport,'contain').target,{x:80,y:250,w:180,h:60});
  assert.deepEqual(mapTarget(source,bounds,viewport,'cover').target,{x:-160,y:160,w:360,h:120});
});
test('callout is clamped, avoids target/caption and fails when no safe placement exists', () => {
  const safe={x:20,y:20,w:680,h:1000}, target={x:500,y:800,w:180,h:90}, caption={x:20,y:920,w:680,h:100};
  const b=placeCallout(target,{w:260,h:70},safe,[caption]);
  assert.ok(b.x>=safe.x && b.x+b.w<=700 && b.y+b.h<=920);
  assert.equal(placeCallout(target,{w:260,h:70},safe,[safe]),null);
});
test('missing, ambiguous, clipped and tiny targets require review, explicit rectangle resolves ambiguity', () => {
  for (const change of [s=>delete s.target.bounds, s=>{delete s.target.bounds;s.target.locator={selector:'#button',matches:2};},
    s=>s.target.bounds={x:.1,y:.2,w:.001,h:.001}]) {
    const m=example();change(m.shots[0]); const c=compileManifest(m);assert.equal(c.shots[0].status,'review');
  }
  const m=example();m.shots[0].target.locator={selector:'#button',matches:2};assert.equal(compileManifest(m).shots[0].status,'ready');
  m.shots[0].fit='cover'; m.shots[0].target.bounds={x:0,y:.1,w:.01,h:.1};assert.equal(compileManifest(m).shots[0].status,'review');
});
test('capture locator requires exactly one resolved rectangle', () => {
  const m=example(); delete m.shots[0].target.bounds;
  m.shots[0].target.locator={selector:'[data-id=trend]',matches:1,bounds:{x:.1,y:.2,w:.3,h:.2}};
  assert.equal(compileManifest(m).shots[0].status,'ready');
});
test('hold revision preserves source, copy, target, cue and unrelated absolute beats', () => {
  const m=example();m.shots.push({...structuredClone(m.shots[0]),id:'next',start:5});
  const revised=reviseHold(m,'chart',1);
  assert.equal(revised.shots[0].hold,m.shots[0].hold+1);
  assert.equal(planDiff(m,revised).length,1);
  assert.equal(planDiff(m,revised)[0].path,'shots.0.hold');
  assert.equal(compileManifest(revised).shots[1].start,5);
  assert.throws(()=>reviseHold(m,'chart',2),/overlap/);
});
test('cue and readable states land exactly on the intended frames; hold remains still', () => {
  const s=compileManifest(example()).shots[0];
  assert.equal(shotState(s,s.cue-1/30).visible,false);
  assert.equal(shotState(s,s.cue).visible,true);
  assert.equal(shotState(s,s.cue+s.move).progress,1);
  assert.deepEqual(shotState(s,2),shotState(s,3));
});
test('aspect recompose shares normalized target, while protected layout changes placement', () => {
  const a=example(), b=structuredClone(a);b.aspect='16:9';
  const ca=compileManifest(a),cb=compileManifest(b);
  assert.deepEqual(ca.shots[0].target,cb.shots[0].target);
  assert.notDeepEqual(ca.shots[0].mapped,cb.shots[0].mapped);
});
