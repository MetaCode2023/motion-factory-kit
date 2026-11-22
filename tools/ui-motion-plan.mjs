import { z } from 'zod';

import { compileLayout } from '../kit/ui-motion-layout.mjs';
export { recipeVersion,mapTarget,placeCallout,shotState,intersects } from '../kit/ui-motion-layout.mjs';
const rect=z.object({x:z.number().finite(),y:z.number().finite(),w:z.number().positive().finite(),h:z.number().positive().finite()}).strict();
const normalized=rect.refine(r=>r.x>=0&&r.y>=0&&r.x+r.w<=1.00000001&&r.y+r.h<=1.00000001,'rectangle must fit normalized source');
const locator=z.object({selector:z.string().min(1),matches:z.number().int().nonnegative(),bounds:normalized.optional()}).strict();
const schema=z.object({version:z.literal(1),id:z.string().regex(/^[a-z0-9-]+$/),aspect:z.enum(['9:16','16:9']),
  fps:z.literal(30),theme:z.enum(['editorial','glass']),accent:z.string().regex(/^#[a-fA-F0-9]{6}$/),
  font:z.enum(['Bahnschrift','Barlow']),
  shots:z.array(z.object({id:z.string().min(1),start:z.number().nonnegative().optional(),
    source:z.object({path:z.string().min(1),width:z.number().int().positive(),height:z.number().int().positive()}).strict(),
    target:z.object({name:z.string().min(1),bounds:normalized.optional(),locator:locator.optional()}).strict(),
    copy:z.object({chapter:z.string().min(1).max(100).optional(),headline:z.tuple([z.string().min(1),z.string().min(1)]),callout:z.string().min(1).max(100),caption:z.string().max(100).optional()}).strict(),
    cue:z.number().nonnegative(),move:z.number().positive().max(1),hold:z.number().positive(),
    transition:z.object({kind:z.enum(['chapter','cut']),duration:z.number().nonnegative().max(.5)}).strict(),
    treatment:z.enum(['spotlight','callout']),fit:z.enum(['contain','cover']),framing:normalized.optional(),
    fallback:z.enum(['review','context']),
    accessibility:z.object({reducedMotion:z.boolean(),minTargetPixels:z.number().positive()}).strict(),
    protected:z.array(normalized)
  }).strict()).min(1).max(30)
}).strict();

export function validateManifest(m) {
  schema.parse(m);
  if(new Set(m.shots.map(s=>s.id)).size!==m.shots.length)throw new Error('shot IDs must be unique');
  for(const s of m.shots)for(const v of [s.start??0,s.cue,s.move,s.hold,s.transition.duration])
    if(Math.abs(v*m.fps-Math.round(v*m.fps))>1e-7)throw new Error(`${s.id}: times must align to ${m.fps}fps frames`);
  return m;
}
export const compileManifest=manifest=>compileLayout(validateManifest(manifest));
export function planDiff(a,b,path='') {
  if(JSON.stringify(a)===JSON.stringify(b))return [];
  if(a&&b&&typeof a==='object'&&typeof b==='object')return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>planDiff(a[k],b[k],path?`${path}.${k}`:k));
  return [{path,before:a,after:b}];
}
export function reviseHold(manifest,id,seconds) {
  const next=structuredClone(manifest),s=next.shots.find(s=>s.id===id);
  if(!s)throw new Error(`Unknown shot: ${id}`);
  s.hold+=seconds;compileManifest(next);return next;
}
