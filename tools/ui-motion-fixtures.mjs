import { Canvas, FontLibrary } from 'skia-canvas';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ink='#1a1b1d',paper='#e9e6dc',muted='#66665e',accent='#ee302b';
export async function generateFixtures(directory,{font='Bahnschrift'}={}){
  if(!FontLibrary.has(font)){
    if(font!=='Barlow')throw new Error('Bahnschrift unavailable; explicitly request Barlow');
    FontLibrary.use('Barlow',join(root,'fonts/barlow-latin-500-normal.woff2'));
  }
  await mkdir(join(directory,'fixtures'),{recursive:true});
  function base(w,h,title){const canvas=new Canvas(w,h),c=canvas.getContext('2d');c.fillStyle=paper;c.fillRect(0,0,w,h);
    c.fillStyle=ink;c.fillRect(0,0,w,68);text(c,title,30,46,30,'#f0eee5');return {canvas,c};}
  function text(c,s,x,y,size=26,color=ink){c.font=`${size}px "${font}"`;c.fillStyle=color;c.fillText(s,x,y);}
  function rect(c,x,y,w,h,color,r=8){c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();}
  async function save(canvas,name){await writeFile(join(directory,'fixtures',name+'.png'),await canvas.toBuffer('png'));}
  {
    const {canvas,c}=base(1000,650,'Pulse / Activity');
    text(c,'Activity overview',42,125,36);text(c,'THIS WEEK',790,124,22,muted);
    for(const [i,label,value] of [[0,'SESSIONS','128'],[1,'COMPLETION','74%'],[2,'PREVIEWS','24']]){
      rect(c,42+i*315,158,292,96,'#d4d0c4');text(c,label,62+i*315,190,20,muted);text(c,value,62+i*315,231,34);}
    rect(c,70,280,860,260,'#f5f2e9');
    for(let i=0;i<5;i++){c.fillStyle='#d4d0c4';c.fillRect(70,290+i*57,860,1);}
    const points=[[85,510],[205,478],[325,492],[445,408],[565,425],[685,346],[805,318],[915,285]];
    c.strokeStyle=accent;c.lineWidth=5;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();
    for(const [x,y]of points){c.fillStyle=accent;c.beginPath();c.arc(x,y,5,0,Math.PI*2);c.fill();}
    text(c,'MON',75,582,20,muted);text(c,'SUN',875,582,20,muted);text(c,'Preview activity',42,628,24,muted);await save(canvas,'dashboard');
  }
  {
    const {canvas,c}=base(480,900,'Workspace');text(c,'Your review is ready',46,132,32);
    rect(c,48,185,384,260,'#d3cfc2');c.strokeStyle=accent;c.lineWidth=5;c.beginPath();c.arc(240,310,62,0,Math.PI*2);c.stroke();
    c.beginPath();c.moveTo(208,312);c.lineTo(233,338);c.lineTo(278,280);c.stroke();text(c,'Review ready',50,510,32);
    text(c,'3 scenes / 12 seconds',50,558,25,muted);rect(c,58,684,364,82,ink);
    text(c,'Open preview',125,736,30,'#f5f2e9');rect(c,160,842,160,5,'#aaa699');await save(canvas,'mobile');
  }
  {
    const {canvas,c}=base(1100,650,'Cut desk / Sequence 01');rect(c,350,100,400,195,'#252629');
    c.strokeStyle=accent;c.lineWidth=3;c.beginPath();c.arc(550,196,55,0,Math.PI*2);c.stroke();
    for(let i=0;i<3;i++){rect(c,44,330+i*82,1012,68,'#d0cbbf');text(c,['VIDEO','AUDIO','MUSIC'][i],56,370+i*82,19,muted);
      rect(c,165,344+i*82,825,40,'#b4afa4');}
    rect(c,528,426,198,42,accent);text(c,'ACTIVE',580,455,25,'#fff6ed');
    c.strokeStyle=ink;c.lineWidth=3;c.beginPath();c.moveTo(627,310);c.lineTo(627,585);c.stroke();
    text(c,'00:08',590,624,23,muted);await save(canvas,'editor');
  }
  {
    const {canvas,c}=base(1100,700,'Dispatch / Work queue');text(c,'Review queue',35,126,36);text(c,'FILTER',947,124,21,muted);
    for(let i=0;i<7;i++){
      const y=174+i*68;rect(c,25,y,1050,60,i%2?'#dedacf':'#f4f0e7');
      text(c,`0${i+1}`,42,y+39,23,muted);text(c,['Sequence A','Campaign cut','Portrait crop','Launch reel','Audio pass','Title cards','End frame'][i],110,y+39,27);
      text(c,'Studio',580,y+39,25,muted);rect(c,814,y+10,225,40,i===3?ink:'#cbc6ba');
      text(c,i===3?'Review now':'Queued',832,y+39,25,i===3?'#f5f2e9':muted);
    }await save(canvas,'table');
  }
  const accessibility={reducedMotion:false,minTargetPixels:18};
  const shot=(id,width,height,bounds,headline,callout)=>({id,source:{path:`fixtures/${id}.png`,width,height},target:{name:id,bounds},copy:{headline,callout},cue:.8,move:.4,hold:2.4,transition:{kind:'chapter',duration:.4},treatment:'spotlight',fit:'contain',fallback:'review',accessibility,protected:[]});
  const dashboard=shot('dashboard',1000,650,{x:.07,y:280/650,w:.86,h:260/650},['FIND','THE SIGNAL.'],'TREND');
  const mobile=shot('mobile',480,900,{x:58/480,y:684/900,w:364/480,h:82/900},['FOCUS','THE ACTION.'],'PRIMARY ACTION');
  mobile.framing={x:.04,y:.56,w:.92,h:.34};
  const editor=shot('editor',1100,650,{x:528/1100,y:426/650,w:198/1100,h:42/650},['FOLLOW','THE CUT.'],'ACTIVE CLIP');
  editor.framing={x:.24,y:.42,w:.72,h:.50};
  const m={version:1,id:'editorial',aspect:'9:16',fps:30,theme:'editorial',accent,font,shots:[dashboard,mobile,editor]};
  const write=async(name,data)=>writeFile(join(directory,name+'.json'),JSON.stringify(data,null,2)+'\n');
  await write('editorial',m);await write('glass',{...m,id:'glass',theme:'glass'});
  const table=shot('table',1100,700,{x:814/1100,y:388/700,w:225/1100,h:40/700},['FIND','THE NEXT STEP.'],'REVIEW NOW');
  table.framing={x:.42,y:.40,w:.58,h:.42};
  const held={...m,id:'held-out-table',shots:[{...table,hold:8.4}]};await write(held.id,held);
  const edge={...structuredClone(table),id:'edge-target',start:0,hold:2.4};edge.target.name='edge control';edge.copy.caption='Keep the selected row in view.';
  const near={...structuredClone(mobile),id:'caption-target',start:4};near.copy.caption='Open the preview to continue.';
  const close={...structuredClone(editor),id:'timeline',start:8};
  const recompose={...m,id:'recompose-portrait',shots:[edge,near,close]};await write(recompose.id,recompose);
  await write('recompose-landscape',{...recompose,id:'recompose-landscape',aspect:'16:9'});
  const before={...m,id:'hold-study',shots:[{...dashboard,hold:8.4}]};
  await write('revision-before',before);await write('revision-after',{...before,shots:[{...dashboard,hold:9.4}]});
  return m;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){await generateFixtures(resolve(process.argv[2]??join(root,'examples/ui-motion')),{font:process.argv.includes('--barlow')?'Barlow':'Bahnschrift'});console.log('Synthetic UI fixtures and manifests ready.');}
