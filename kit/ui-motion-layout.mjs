// Shared browser/Node layout. Input must be validated before use.
export const recipeVersion='ui-motion-v1';
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
  const cue=s.start+s.cue,visible=t>=cue-1e-9&&t<s.end-1e-9;
  const linear=Math.max(0,Math.min(1,(t-cue)/s.move));
  return {visible,progress:s.accessibility.reducedMotion?(visible?1:0):1-(1-linear)**3};
}
export function compileLayout(manifest) {
  const m=structuredClone(manifest),portrait=m.aspect==='9:16';
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
    const size=portrait?{w:Math.min(560,Math.max(240,s.copy.callout.length*20+54)),h:76}:{w:420,h:92};
    const callout=mapped?placeCallout(mapped.target,size,safe,[header,...protectedRegions,...(caption?[caption]:[])],portrait?{x:60,y:940}:{x:64,y:390}):null;
    if(!callout&&mapped)warnings.push('No callout position clear of target and protected regions.');
    return {...s,index,start,end:shotEnd,viewport,header,caption,protectedRegions,mapped,callout,status:warnings.length?'review':'ready',warnings};
  });
  return {...m,recipeVersion,width,height,safe,duration:end,shots};
}
