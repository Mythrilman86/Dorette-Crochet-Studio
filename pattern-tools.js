/* Dorette Crochet Studio v1.0 — offline colorwork calculations and editing primitives. */
(() => {
 'use strict';
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 const direction=(project,row)=>{
   const cfg=project.workDirection||{};
   const first=cfg.first==='ltr'?'ltr':'rtl';
   return cfg.alternate!==false && row%2===0?(first==='rtl'?'ltr':'rtl'):first;
 };
 function physicalIndex(project,col,row){return (project.rows-row)*project.cols+(col-1);}
 function colAt(project,row,step){return direction(project,row)==='rtl'?project.cols-step:step+1;}
 function runs(project,row){
   if(!Number.isInteger(row)||row<1||row>project.rows)throw Error('Row out of range');
   const out=[];
   for(let step=0;step<project.cols;step++){
     const col=colAt(project,row,step),color=project.cells[physicalIndex(project,col,row)];
     if(!out.length||out[out.length-1].color!==color)out.push({color,count:1,start:col,end:col,firstStep:step,lastStep:step});
     else{const last=out[out.length-1];last.count++;last.end=col;last.lastStep=step;}
   }
   return out;
 }
 function runForPosition(project,row,position){
   return runs(project,row).find(r=>position>=r.firstStep&&position<=r.lastStep)||null;
 }
 function counts(project){const out=Array(project.palette.length).fill(0);for(const n of project.cells)if(out[n]!==undefined)out[n]++;return out;}
 function ensure(project){
   if(!project.workDirection||typeof project.workDirection!=='object')project.workDirection={first:'rtl',alternate:true};
   if(!project.guide||typeof project.guide!=='object')project.guide={row:1,position:0};
   project.guide.row=clamp(Math.round(Number(project.guide.row)||1),1,project.rows);
   project.guide.position=clamp(Math.round(Number(project.guide.position)||0),0,project.cols-1);
   if(!Array.isArray(project.yarnInfo))project.yarnInfo=[];
   if(!project.gauge||typeof project.gauge!=='object')project.gauge={swatchStitches:100,swatchYards:0,overage:10};
   if(!Array.isArray(project.checkpoints))project.checkpoints=[];
   return project;
 }
 function estimate(project){
   ensure(project);
   const cc=counts(project),g=project.gauge;
   const ss=Number(g.swatchStitches),yd=Number(g.swatchYards),ov=Number(g.overage);
   const rate=ss>0&&yd>0?yd/ss:0,extra=1+(Number.isFinite(ov)?clamp(ov,0,100):10)/100;
   return cc.map((count,i)=>{
     const info=project.yarnInfo[i]||{};
     const perSkein=Math.max(0,Number(info.skeinYards)||0);
     const owned=Math.max(0,Math.floor(Number(info.ownedSkeins)||0));
     const neededYards=rate?count*rate*extra:null;
     const totalSkeins=rate&&perSkein?Math.ceil(neededYards/perSkein):null;
     return {count,neededYards,totalSkeins,owned,additional:totalSkeins===null?null:Math.max(0,totalSkeins-owned)};
   });
 }
 function rectangle(project,c1,r1,c2,r2,color){
   const minC=clamp(Math.min(c1,c2),1,project.cols),maxC=clamp(Math.max(c1,c2),1,project.cols);
   const minR=clamp(Math.min(r1,r2),1,project.rows),maxR=clamp(Math.max(r1,r2),1,project.rows);
   let changed=0;
   for(let r=minR;r<=maxR;r++)for(let c=minC;c<=maxC;c++){
     const i=physicalIndex(project,c,r);if(project.cells[i]!==color){project.cells[i]=color;changed++;}
   }
   return changed;
 }
 function bucket(project,c,r,color){
   const start=physicalIndex(project,c,r),from=project.cells[start];if(from===color)return 0;
   const stack=[start],seen=new Uint8Array(project.cells.length),cols=project.cols,rows=project.rows;
   let changed=0;
   while(stack.length){const i=stack.pop();if(seen[i]||project.cells[i]!==from)continue;seen[i]=1;project.cells[i]=color;changed++;
     const x=i%cols,y=Math.floor(i/cols);
     if(x>0)stack.push(i-1);if(x<cols-1)stack.push(i+1);
     if(y>0)stack.push(i-cols);if(y<rows-1)stack.push(i+cols);
   }
   return changed;
 }
 function copyArea(project,c1,r1,c2,r2){
   const left=clamp(Math.min(c1,c2),1,project.cols),right=clamp(Math.max(c1,c2),1,project.cols);
   const bottom=clamp(Math.min(r1,r2),1,project.rows),top=clamp(Math.max(r1,r2),1,project.rows);
   const colors=[];
   for(let row=top;row>=bottom;row--)for(let col=left;col<=right;col++)colors.push(project.cells[physicalIndex(project,col,row)]);
   return {width:right-left+1,height:top-bottom+1,colors,palette:project.palette.map(c=>c.hex)};
 }
 function paste(project,clip,left,top){
   if(!clip||!Number.isInteger(clip.width)||!Number.isInteger(clip.height)||!Array.isArray(clip.colors))return 0;
   let changed=0;
   for(let dy=0;dy<clip.height;dy++)for(let dx=0;dx<clip.width;dx++){
     const col=left+dx,row=top-dy;if(col<1||row<1||col>project.cols||row>project.rows)continue;
     const clipColor=clip.colors[dy*clip.width+dx];
     // Color-index order may differ across projects: map by exact hex or skip colors not in target palette.
     const hex=clip.palette?.[clipColor],mapped=project.palette.findIndex(p=>p.hex.toLowerCase()===String(hex).toLowerCase());
     if(mapped<0)continue;
     const i=physicalIndex(project,col,row);if(project.cells[i]!==mapped){project.cells[i]=mapped;changed++;}
   }
   return changed;
 }
 function makeCheckpoint(project,name){
   ensure(project);
   const snap={id:Date.now()+'-'+Math.random().toString(36).slice(2,7),name:String(name||'Before editing').slice(0,65),at:new Date().toISOString(),cols:project.cols,rows:project.rows,cells:project.cells.slice(),palette:project.palette.map(c=>({...c})),done:project.done.slice(),rowDone:project.rowDone.slice(),yarnInfo:JSON.parse(JSON.stringify(project.yarnInfo))};
   project.checkpoints=[snap,...project.checkpoints].slice(0,3);return snap;
 }
 window.DorettePattern=Object.freeze({direction,physicalIndex,colAt,runs,runForPosition,counts,estimate,ensure,rectangle,bucket,copyArea,paste,makeCheckpoint});
})();
