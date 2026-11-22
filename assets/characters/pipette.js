// Pipette is an original Xovion lab assistant. The shell, proportions and colors are fixed.
(() => {
  const { drawJoint } = window.MotionSimulation;
  const poses = {
    neutral: { arm: 0.3 },
    point: { arm: 1.42, gaze: 7, lean: 0.06 },
    inspect: { arm: 1.03, gaze: 8, lean: 0.15, eye: 0.62, nod: 0.1 },
    relieved: { arm: 0.4, gaze: 0, lean: -0.04, eye: 0.75, nod: -0.08 },
    blink: { arm: 0.3, eye: 0.08 },
  };
  const shell='#b5eadb', ink='#102832', visor='#1f4149', light='#b1ffe5', copper='#ffba87';
  function rectangle(ctx,x,y,w,h,r,color){
    ctx.fillStyle=color; M.roundRect(ctx,x,y,w,h,r);ctx.fill();
  }
  function circle(ctx,x,y,r,color){
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
  }
  function draw(ctx, { x, y, scale = 1, pose, t = 0 }){
    ctx.save();
    try {
      ctx.translate(x,y);ctx.scale(scale,scale);
      ctx.fillStyle='#07192370';
      ctx.beginPath();ctx.ellipse(0,7,62,13,0,0,Math.PI*2);ctx.fill();
      rectangle(ctx,-45,-17,35,20,8,ink);
      rectangle(ctx,10,-17,35,20,8,ink);
      drawJoint(ctx,{y:-18,angle:pose.lean},()=>{
        rectangle(ctx,-49,-88,98,92,35,ink);
        rectangle(ctx,-43,-84,86,76,31,shell);
        rectangle(ctx,-26,-58,52,28,12,visor);
        circle(ctx,-11,-44,4,copper);circle(ctx,3,-44,4,light);circle(ctx,16,-44,3,'#88afb1');
        drawJoint(ctx,{x:40,y:-68,angle:-pose.arm},()=>{
          rectangle(ctx,-9,-4,18,47,9,'#87c4b8');
          drawJoint(ctx,{y:39,angle:-0.2*pose.arm},()=>{
            rectangle(ctx,-8,-2,16,35,8,shell);
            circle(ctx,0,30,9,copper);
          });
        });
        drawJoint(ctx,{y:-88,angle:pose.nod},()=>{
          rectangle(ctx,-59,-75,118,72,29,ink);
          rectangle(ctx,-55,-74,110,64,25,shell);
          rectangle(ctx,-46,-64,92,43,17,visor);
          for(const x of [-19,19])rectangle(ctx,x+pose.gaze-5,-49,10,15*pose.eye,4,light);
          const flicker=1+0.8*Math.sin(t*4);
          rectangle(ctx,-3,-97,6,23,3,'#80b8ad');
          circle(ctx,0,-98,5+flicker,copper);
          rectangle(ctx,51,-50,9,17,4,copper);
        });
      });
    } finally { ctx.restore(); }
  }
  window.Pipette = { poses, draw };
})();
