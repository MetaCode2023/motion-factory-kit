import { z } from 'zod';

export const recipeVersion='ui-motion-v1';
const rect=z.object({x:z.number().finite(),y:z.number().finite(),w:z.number().positive().finite(),h:z.number().positive().finite()}).strict();
const normalized=rect.refine(r=>r.x>=0&&r.y>=0&&r.x+r.w<=1.00000001&&r.y+r.h<=1.00000001,'rectangle must fit normalized source');
const locator=z.object({selector:z.string().min(1),matches:z.number().int().nonnegative(),bounds:normalized.optional()}).strict();
const schema=z.object({version:z.literal(1),id:z.string().regex(/^[a-z0-9-]+$/),aspect:z.enum(['9:16','16:9']),
  fps:z.literal(30),theme:z.enum(['editorial','glass']),accent:z.string().regex(/^#[a-fA-F0-9]{6}$/),
  font:z.enum(['Bahnschrift','Barlow']),
  shots:z.array(z.object({id:z.string().min(1),start:z.number().nonnegative().optional(),
    source:z.object({path:z.string().min(1),width:z.number().int().positive(),height:z.number().int().positive()}).strict(),
    target:z.object({name:z.string().min(1),bounds:normalized.optional(),locator:locator.optional()}).strict(),
    copy:z.object({headline:z.tuple([z.string().min(1),z.string().min(1)]),callout:z.string().min(1).max(100),caption:z.string().max(100).optional()}).strict(),
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
export function mapTarget(source,bounds,viewport,fit='contain',framing={x:0,y:0,w:1,h:1}) {
  const crop={x:framing.x*source.width,y:framing.y*source.height,w:framing.w*source.width,h:framing.h*source.height};
  const scale=(fit==='cover'?Math.max:Math.min)(viewport.w/crop.w,viewport.h/crop.h);
  const image={x:viewport.x+(viewport.w-crop.w*scale)/2-crop.x*scale,
    y:viewport.y+(viewport.h-crop.h*scale)/2-crop.y*scale,w:source.width*scale,h:source.height*scale};
  const target={x:image.x+bounds.x*image.w,y:image.y+bounds.y*image.h,w:bounds.w*image.w,h:bounds.h*image.h};
  return {image,target,scale};
}
export const intersects=(a,b,gap=12)=>a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;
const inside=(a,b)=>a.x>=b.x-.01&&a.y>=b.y-.01&&a.x+a.w<=b.x+b.w+.01&&a.y+a.h<=b.y+b.h+.01;
export function placeCallout(target,size,safe,obstacles=[],preferred) {
  if(size.w>safe.w||size.h>safe.h)return null;
  const candidates=[preferred,{x:target.x,y:target.y+target.h+60},{x:target.x,y:target.y-size.h-60},
    {x:target.x-size.w-60,y:target.y},{x:target.x+target.w+60,y:target.y}].filter(Boolean);
  // Scan empty bands only if the natural connector locations are blocked.
  for(let y=safe.y;y<=safe.y+safe.h-size.h;y+=24)for(let x=safe.x;x<=safe.x+safe.w-size.w;x+=32)candidates.push({x,y});
  for(const c of candidates){const b={x:Math.max(safe.x,Math.min(c.x,safe.x+safe.w-size.w)),
    y:Math.max(safe.y,Math.min(c.y,safe.y+safe.h-size.h)),...size};
    if(![target,...obstacles].some(o=>intersects(b,o)))return b;}
  return null;
}
export function shotState(s,t) {
  const local=t-s.start,visible=local>=s.cue&&local<s.end-s.start;
  const linear=Math.max(0,Math.min(1,(local-s.cue)/s.move));
  return {visible,progress:s.accessibility.reducedMotion?(visible?1:0):1-(1-linear)**3};
}
export function compileManifest(manifest) {
  const m=structuredClone(validateManifest(manifest)),portrait=m.aspect==='9:16';
  const width=portrait?720:1280,height=portrait?1280:720;
  const safe=portrait?{x:60,y:145,w:600,h:960}:{x:64,y:60,w:1152,h:600};
  let end=0;
  const shots=m.shots.map((s,index)=>{
    const start=s.start??end;
    if(start<end-1e-7)throw new Error(`${s.id}: overlap with previous shot`);
    const shotEnd=Math.round((start+s.cue+s.move+s.hold+s.transition.duration)*m.fps)/m.fps;end=shotEnd;
    const mobile=s.source.height>s.source.width*1.3;
    const viewport=portrait?(mobile?{x:60,y:380,w:600,h:620}:{x:60,y:470,w:600,h:450}):{x:530,y:145,w:670,h:420};
    const bounds=s.target.bounds??(s.target.locator?.matches===1?s.target.locator.bounds:null);
    const warnings=[];
    if(!bounds)warnings.push('Target missing or ambiguous; supply explicit normalized bounds or a unique capture locator.');
    const mapped=bounds?mapTarget(s.source,bounds,viewport,s.fit,s.framing):null;
    if(mapped&&!inside(mapped.target,viewport))warnings.push('Target is clipped by source framing or crop.');
    if(mapped&&Math.min(mapped.target.w,mapped.target.h)<s.accessibility.minTargetPixels)warnings.push('Target too small; supply a tighter source framing.');
    const protectedRegions=s.protected.map(r=>({x:r.x*width,y:r.y*height,w:r.w*width,h:r.h*height}));
    const header=portrait?{x:60,y:145,w:600,h:200}:{x:64,y:100,w:420,h:240};
    const caption=s.copy.caption?(portrait?{x:60,y:1040,w:600,h:65}:{x:530,y:600,w:670,h:50}):null;
    if(mapped&&protectedRegions.some(r=>intersects(mapped.target,r)))warnings.push('Target intersects a protected region; recompose source framing.');
    const size=portrait?{w:Math.min(560,Math.max(240,s.copy.callout.length*20+54)),h:76}:{w:Math.min(400,Math.max(220,s.copy.callout.length*16+48)),h:84};
    const callout=mapped?placeCallout(mapped.target,size,safe,[header,...protectedRegions,...(caption?[caption]:[])],portrait?{x:60,y:940}:{x:64,y:390}):null;
    if(!callout&&mapped)warnings.push('No callout position clear of target and protected regions.');
    return {...s,index,start,end:shotEnd,viewport,header,caption,protectedRegions,mapped,callout,status:warnings.length?'review':'ready',warnings};
  });
  return {...m,recipeVersion,width,height,safe,duration:end,shots};
}
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
