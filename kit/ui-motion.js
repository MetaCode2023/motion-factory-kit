// Fixed, deterministic painter. Plans are validated data, never generated renderer code.
(() => {
  const M=window.M;
  function box(c,b,fill,r=8,stroke){c.beginPath();M.roundRect(c,b.x,b.y,b.w,b.h,r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=2;c.stroke();}}
  function type(c,text,x,y,size,color,font,maxWidth){
    c.font=`${size}px "${font}"`;c.textBaseline='alphabetic';c.textAlign='left';
    while(c.measureText(text).width>maxWidth&&size>12){size-=1;c.font=`${size}px "${font}"`;}
    c.fillStyle=color;c.fillText(text,x,y);
  }
  const mixRect=(a,b,p)=>({x:M.lerp(a.x,b.x,p),y:M.lerp(a.y,b.y,p),w:M.lerp(a.w,b.w,p),h:M.lerp(a.h,b.h,p)});
  function background(c,p,s){
    const light=p.theme==='editorial'&&s.index%2===1;
    const base=light?'#eeeade':'#111214';
    c.fillStyle=base;c.fillRect(0,0,p.width,p.height);
    if(p.theme==='glass'){
      const gradient=c.createLinearGradient(0,0,p.width,p.height);
      gradient.addColorStop(0,'#121823');gradient.addColorStop(.52,'#263a46');gradient.addColorStop(1,'#191c2d');
      c.fillStyle=gradient;c.fillRect(0,0,p.width,p.height);
      // Lighting is steady during the evidence hold.
      const g=c.createRadialGradient(p.width*.8,p.height*.48,20,p.width*.8,p.height*.48,p.width*.75);
      g.addColorStop(0,'rgba(152,179,190,.16)');g.addColorStop(1,'rgba(152,179,190,0)');c.fillStyle=g;c.fillRect(0,0,p.width,p.height);
    }
    return {ink:light?'#161719':'#f2efe5',muted:light?'#53534e':'#a5a6a2',line:light?'#cac8bd':'#37393a',light};
  }
  function shot(c,t,p,s,images){
    const colors=background(c,p,s),portrait=p.aspect==='9:16',time=t-s.start;
    const headerX=portrait?60:64,headerY=portrait?200:155;
    const headerW=portrait?600:420;
    if(p.theme==='glass')window.FX.glass(c,headerX-18,headerY-59,headerW+36,portrait?202:210,{radius:20,blur:16,tint:'rgba(233,243,250,.055)',border:'rgba(234,244,251,.18)',shadow:false});
    type(c,'FIELD NOTES / INTERFACES',60,portrait?88:65,14,colors.muted,p.font,360);
    c.fillStyle=colors.line;c.fillRect(60,portrait?116:85,p.width-120,1);
    if(s.copy.chapter)type(c,s.copy.chapter,headerX,headerY-20,16,colors.muted,p.font,headerW);
    // Opening copy is already present; subsequent second lines arrive as one clean mask.
    type(c,s.copy.headline[0],headerX,headerY+61,portrait?88:76,p.accent,p.font,headerW);
    const rise=s.accessibility.reducedMotion?1:M.prog(time,0,.4);
    c.save();c.beginPath();c.rect(headerX,headerY+72,headerW,90);c.clip();
    type(c,s.copy.headline[1],headerX,headerY+133+28*(1-rise),portrait?64:52,colors.ink,p.font,headerW);c.restore();
    const v=s.viewport,img=images[s.index];
    if(p.theme==='glass')window.FX.glass(c,v.x-18,v.y-18,v.w+36,v.h+36,{radius:22,blur:18,tint:'rgba(233,243,250,.065)',border:'rgba(234,244,251,.24)',shadow:false});
    const state=window.UIMotion.state(s,t);
    const initial=s.overview??s.mapped;
    const image=mixRect(initial.image,s.mapped.image,state.progress);
    const target=mixRect(initial.target,s.mapped.target,state.progress);
    const drawImage=()=>c.drawImage(img,image.x,image.y,image.w,image.h);
    c.save();c.beginPath();M.roundRect(c,v.x,v.y,v.w,v.h,8);c.clip();
    drawImage();
    if(state.visible&&s.treatment==='spotlight'){
      c.fillStyle=`rgba(12,14,18,${.48*state.progress})`;c.fillRect(v.x,v.y,v.w,v.h);
      c.save();c.beginPath();c.rect(target.x-3,target.y-3,target.w+6,target.h+6);c.clip();drawImage();c.restore();
    }
    c.restore();
    box(c,v,null,8,colors.line);
    if(state.visible){
      const alpha=state.progress;c.save();c.globalAlpha=alpha;
      // Four brackets leave the real source pixels fully visible.
      c.strokeStyle=p.accent;c.lineWidth=3;
      const b={x:target.x-6,y:target.y-6,w:target.w+12,h:target.h+12},len=Math.min(22,b.h/3);
      for(const [x,y,dx,dy] of [[b.x,b.y,1,1],[b.x+b.w,b.y,-1,1],[b.x,b.y+b.h,1,-1],[b.x+b.w,b.y+b.h,-1,-1]]){
        c.beginPath();c.moveTo(x+dx*len,y);c.lineTo(x,y);c.lineTo(x,y+dy*len);c.stroke();}
      const label=s.callout;
      const anchor={x:Math.max(target.x,Math.min(label.x+label.w/2,target.x+target.w)),y:label.y>target.y+target.h?target.y+target.h:target.y};
      const end={x:Math.max(label.x+16,Math.min(anchor.x,label.x+label.w-16)),y:label.y>anchor.y?label.y:label.y+label.h};
      c.strokeStyle=p.accent;c.lineWidth=2;c.beginPath();c.moveTo(anchor.x,anchor.y);c.lineTo(end.x,end.y);c.stroke();
      c.fillStyle=p.accent;c.beginPath();c.arc(anchor.x,anchor.y,4,0,Math.PI*2);c.fill();
      // Opaque ink substrate protects label contrast in both material treatments.
      if(p.theme==='glass')window.FX.glass(c,label.x-5,label.y-5,label.w+10,label.h+10,{radius:15,blur:14,tint:'rgba(230,244,250,.07)',shadow:false});
      box(c,label,colors.light?'#17191c':'#eeebe2',8);
      c.fillStyle=p.accent;c.fillRect(label.x+16,label.y+20,4,label.h-40);
      type(c,s.copy.callout,label.x+34,label.y+label.h*.66,portrait?34:46,colors.light?'#f2efe5':'#181a1c',p.font,label.w-50);
      c.restore();
    }
    if(s.caption){box(c,s.caption,colors.light?'#17191c':'#eeebe2',8);type(c,s.copy.caption,s.caption.x+20,s.caption.y+43,portrait?28:44,colors.light?'#f2efe5':'#181a1c',p.font,s.caption.w-40);}
    // Quiet chapter spine carries the accent through each composition.
    const py=portrait?1170:680;c.fillStyle=colors.line;c.fillRect(60,py,p.width-120,2);
    const chapter=(s.index+M.clamp((t-s.start)/(s.end-s.start)))/p.shots.length;
    c.fillStyle=p.accent;c.fillRect(60,py,(p.width-120)*chapter,2);
  }
  window.UIMotion={
    activeShot(shots,t){let index=0;for(let i=1;i<shots.length;i++)if(t>=shots[i].start)index=i;return index;},
    state(s,t){const cue=s.start+s.cue,visible=t>=cue-1e-9&&t<s.end-1e-9;const q=M.clamp((t-cue)/s.move);return {visible,progress:s.accessibility.reducedMotion?(visible?1:0):M.ease.outCubic(q)};},
    mount(plan){
      M.fonts([`400 40px "${plan.font}"`]);
      const images=plan.shots.map(s=>M.image(s.source.path));
      M.setup({width:plan.width,height:plan.height,fps:plan.fps,duration:plan.duration,cuts:plan.shots.slice(1).map(s=>s.start),background:'#111214',
        draw(c,t){
          const index=window.UIMotion.activeShot(plan.shots,t);
          const s=plan.shots[index],transitionAt=(plan.shots[index+1]?.start??s.end)-s.transition.duration;
          if(t>=transitionAt&&index<plan.shots.length-1&&s.transition.kind==='chapter'&&!s.accessibility.reducedMotion){
            const progress=M.clamp((t-transitionAt)/s.transition.duration);
            shot(c,Math.min(t,transitionAt),plan,s,images);
            c.save();c.beginPath();c.rect(0,0,plan.width*M.ease.inOutCubic(progress),plan.height);c.clip();
            shot(c,plan.shots[index+1].start,plan,plan.shots[index+1],images);c.restore();
            c.fillStyle=plan.accent;c.fillRect(plan.width*M.ease.inOutCubic(progress)-2,0,4,plan.height);
          }else shot(c,t,plan,s,images);
        }});
    }
  };
})();
