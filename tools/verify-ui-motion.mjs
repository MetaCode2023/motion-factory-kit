import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Canvas, loadImage, FontLibrary } from 'skia-canvas';
import { compileManifest, mapTarget } from './ui-motion-plan.mjs';
import { command, sceneDocument } from './render-ui-motion.mjs';
import { open } from '../engines/skia.mjs';

export function sampleFrames(plan){
  return plan.shots.flatMap(s=>{
    const cue=s.start+s.cue,readable=cue+s.move,holdEnd=s.end-s.transition.duration;
    return [['setup',s.start],['before-cue',cue-1/plan.fps],['cue',cue],['during-move',cue+3/plan.fps],['readable',readable],
      ['hold-mid',(readable+holdEnd)/2],['hold-end',holdEnd-1/plan.fps],['transition-mid',holdEnd+s.transition.duration/2]].map(([state,time])=>({shot:s.id,state,frame:Math.max(0,Math.min(Math.round(plan.duration*plan.fps)-1,Math.round(time*plan.fps)))}));
  });
}
export function meanPixelError(a,b){
  if(a.length!==b.length||a.length%4)throw new Error('Pixel dimensions differ');
  let total=0;for(let i=0;i<a.length;i+=4)for(let c=0;c<3;c++)total+=Math.abs(a[i+c]-b[i+c]);
  return total/(a.length/4*3);
}
const pixels=image=>{const c=new Canvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,image.width,image.height).data;};
export async function verifyStudy(manifestPath,output,{directory=dirname(output)}={}){
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')),plan=compileManifest(manifest),id=output.split(/[\\/]/).at(-1).replace(/\.mp4$/,'');
  for(const s of plan.shots){s.source.path=resolve(dirname(manifestPath),s.source.path).replaceAll('\\','/');const bounds=s.target.bounds??s.target.locator.bounds;s.overview=mapTarget(s.source,bounds,s.viewport,'contain');}
  if(plan.font==='Barlow')FontLibrary.use('Barlow',resolve(dirname(fileURLToPath(import.meta.url)),'../fonts/barlow-latin-500-normal.woff2'));
  const samples=sampleFrames(plan),framesDir=join(directory,'frames',id);await mkdir(framesDir,{recursive:true});
  const selected=[...new Set(samples.map(s=>s.frame))].sort((a,b)=>a-b);
  const temp=await mkdtemp(join(directory,'.verify-'));
  let engine;
  try{
    const scene=join(temp,'scene.html');await writeFile(scene,sceneDocument(plan));engine=await open(scene);
    await command('ffmpeg',['-v','error','-i',output,'-vf',`select='${selected.map(f=>`eq(n,${f})`).join('+')}'`,'-fps_mode','vfr','-y',join(temp,'%03d.png')]);
    const results=[];
    for(const sample of samples){
      const decoded=await loadImage(join(temp,String(selected.indexOf(sample.frame)+1).padStart(3,'0')+'.png'));
      const expected=await loadImage(await engine.still(sample.frame/plan.fps));
      const actualPixels=pixels(decoded),error=meanPixelError(actualPixels,pixels(expected));
      let bestOffset=0,bestError=error;
      if(sample.state==='during-move')for(const offset of [-2,-1,1,2]){
        const shifted=await loadImage(await engine.still((sample.frame+offset)/plan.fps));
        const shiftedError=meanPixelError(actualPixels,pixels(shifted));if(shiftedError<bestError){bestError=shiftedError;bestOffset=offset;}
      }
      const pass=error<4&&Math.abs(bestOffset)<=1;
      const file=`${sample.shot}-${sample.state}-${sample.frame}.png`;
      await copyFile(join(temp,String(selected.indexOf(sample.frame)+1).padStart(3,'0')+'.png'),join(framesDir,file));
      results.push({...sample,time:sample.frame/plan.fps,error:Number(error.toFixed(4)),bestOffset,pass,file:`frames/${id}/${file}`});
    }
    const thumbW=plan.aspect==='9:16'?180:320,thumbH=Math.round(thumbW*plan.height/plan.width),cols=8,pad=8,label=44;
    const sheet=new Canvas(cols*(thumbW+pad)+pad,plan.shots.length*(thumbH+label+pad)+pad),c=sheet.getContext('2d');
    c.fillStyle='#22262c';c.fillRect(0,0,sheet.width,sheet.height);
    for(let i=0;i<results.length;i++){
      const r=results[i],x=pad+(i%cols)*(thumbW+pad),y=pad+Math.floor(i/cols)*(thumbH+label+pad);
      c.drawImage(await loadImage(join(directory,r.file)),x,y,thumbW,thumbH);
      c.font=`13px "${plan.font}"`;c.fillStyle='#f0eee7';c.fillText(`${r.shot} / ${r.state}`,x,y+thumbH+17);c.fillStyle=r.pass?'#acdfbe':'#ffc885';c.fillText(`${r.time.toFixed(3)}s · frame ${r.frame} · ${r.pass?'pass':'REVIEW'}`,x,y+thumbH+35);
    }
    await writeFile(join(directory,id+'.contact.png'),await sheet.toBuffer('png'));
    const verification={version:1,date:new Date().toISOString(),id,render:output,checks:results.every(r=>r.pass)?'pass':'needs revision',
      method:'Actual decoded MP4 frames compared against deterministic scene samples; during-move best offset searched across ±2 frames and required within ±1 frame.',
      limitations:['This pixel check verifies encoded frame timing against the compiled scene, not independent human creative approval.','Sound listening remains a separate review.'],samples:results};
    await writeFile(join(directory,id+'.verification.json'),JSON.stringify(verification,null,2)+'\n');return verification;
  }finally{await engine?.close();await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const r=await verifyStudy(resolve(process.argv[2]),resolve(process.argv[3]));console.log(JSON.stringify({id:r.id,checks:r.checks,samples:r.samples.length,maxError:Math.max(...r.samples.map(s=>s.error)),offsets:r.samples.filter(s=>s.state==='during-move').map(s=>s.bestOffset)}));if(r.checks!=='pass')process.exitCode=1;}
  catch(e){console.error(e.stack);process.exitCode=1;}
}
