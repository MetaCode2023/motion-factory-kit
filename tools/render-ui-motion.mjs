import { readFile, writeFile, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';
import { compileManifest, mapTarget } from './ui-motion-plan.mjs';

const kitRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function command(exe,args){return new Promise((res,rej)=>{
  const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';
  child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
  child.on('error',rej);child.on('close',code=>code===0?res(out):rej(new Error(`${exe} exited ${code}: ${err.slice(-2000)}`)));
});}
export function sceneDocument(plan){
  const data=JSON.stringify(plan).replace(/</g,'\\u003c');
  return `<!doctype html><meta charset="utf-8"><title>UI motion recipe</title>\n<script src="${kitRoot.replaceAll('\\','/')}/kit/motion.js"></script>\n<script src="${kitRoot.replaceAll('\\','/')}/kit/fx.js"></script>\n<script src="${kitRoot.replaceAll('\\','/')}/kit/ui-motion.js"></script>\n<script>UIMotion.mount(${data});</script>`;
}
export async function renderStudy(manifest,{root=process.cwd(),output,jobs=2,audio,renderCommand=command}={}){
  const plan=compileManifest(manifest);
  const needsReview=plan.shots.filter(s=>s.status==='review'&&s.fallback==='review');
  if(needsReview.length)throw new Error('Target review required: '+needsReview.map(s=>s.id+': '+s.warnings.join(' ')).join('; '));
  // Context fallback cannot invent a location; rendering is refused when target mapping is unknown.
  if(plan.shots.some(s=>!s.mapped||!s.callout))throw new Error('Target review required: no reliable mapping or safe callout');
  if(plan.shots.some(s=>s.status==='review'))throw new Error('Context fallback is preview-only; provide explicit framing before export.');
  if(!FontLibrary.has(plan.font)){
    if(plan.font==='Barlow')FontLibrary.use('Barlow',join(kitRoot,'fonts/barlow-latin-500-normal.woff2'));
    else throw new Error('Bahnschrift unavailable. Explicitly choose licensed Barlow fallback in manifest.');
  }
  const measure=new Canvas(1,1).getContext('2d');
  for(const s of plan.shots){
    const check=(copy,size,width)=>{measure.font=`${size}px "${plan.font}"`;if(measure.measureText(copy).width>width)throw new Error(`${s.id}: exact copy cannot remain legible in this layout; shorten only with user direction or recompose.`);};
    check(s.copy.callout,plan.aspect==='9:16'?28:36,s.callout.w-50);
    for(const line of s.copy.headline)check(line,36,s.header.w);
    if(s.copy.chapter)check(s.copy.chapter,12,s.header.w);
    if(s.copy.caption)check(s.copy.caption,24,s.caption.w-40);
  }
  for(const s of plan.shots){
    const source=resolve(root,s.source.path);
    let image;try{image=await loadImage(source);}catch{throw new Error(`Missing or unreadable source: ${s.source.path}`);}
    if(image.width!==s.source.width||image.height!==s.source.height)throw new Error(`Source dimensions mismatch: ${s.source.path}`);
    s.source.path=source.replaceAll('\\','/');
    const bounds=s.target.bounds??s.target.locator.bounds;
    s.overview=mapTarget(s.source,bounds,s.viewport,'contain');
  }
  output=resolve(output??join(kitRoot,'out',manifest.id+'.mp4'));await mkdir(dirname(output),{recursive:true});
  const temp=await mkdtemp(join(dirname(output),'.ui-render-'));
  try{
    const scene=join(temp,'scene.html'),candidate=join(temp,'candidate.mp4');
    await writeFile(scene,sceneDocument(plan));
    await renderCommand(process.execPath,[join(kitRoot,'render.mjs'),scene,'--out',candidate,'--jobs',String(jobs),...(audio?['--audio',resolve(audio)]:[])]);
    const probe=JSON.parse(await command('ffprobe',['-v','error','-show_streams','-show_format','-of','json',candidate]));
    const video=probe.streams.find(s=>s.codec_type==='video');
    if(!video||video.width!==plan.width||video.height!==plan.height||video.avg_frame_rate!=='30/1'||Math.abs(Number(video.duration)-plan.duration)>1/plan.fps+.00001)throw new Error('Rendered dimensions, frame rate or duration do not match manifest');
    await command('ffmpeg',['-v','error','-i',candidate,'-f','null','-']);
    const bytes=await readFile(candidate),sha256=createHash('sha256').update(bytes).digest('hex');
    const receipt={version:1,id:plan.id,date:new Date().toISOString(),recipe:plan.recipeVersion,font:plan.font,sourceManifest:manifest,
      render:output,width:plan.width,height:plan.height,fps:plan.fps,duration:plan.duration,sha256,bytes:bytes.length,
      engineering:{decode:'pass',metadata:'pass'},creativeReview:'pending',modelAdvisory:'pending',humanApproval:'pending',
      shots:plan.shots.map(s=>({id:s.id,start:s.start,cue:s.start+s.cue,readable:s.start+s.cue+s.move,holdEnd:s.end-s.transition.duration,transitionEnd:s.end,
        mapped:s.mapped,callout:s.callout,status:s.status,warnings:s.warnings}))};
    await writeFile(join(temp,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    await rename(candidate,output);
    await rename(join(temp,'receipt.json'),output.replace(/\.mp4$/i,'.receipt.json'));
    return receipt;
  }finally{await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const args=process.argv.slice(2),opt=n=>args[args.indexOf(n)+1];
    if(!args[0])throw new Error('Usage: node tools/render-ui-motion.mjs manifest.json [--out path.mp4] [--audio path.wav]');
    const file=resolve(args[0]);const receipt=await renderStudy(JSON.parse(await readFile(file,'utf8')),{root:dirname(file),output:args.includes('--out')?opt('--out'):undefined,audio:args.includes('--audio')?opt('--audio'):undefined});
    console.log(JSON.stringify({id:receipt.id,render:receipt.render,duration:receipt.duration,font:receipt.font,decode:receipt.engineering.decode}));
  }catch(e){console.error(e.message);process.exitCode=1;}
}
