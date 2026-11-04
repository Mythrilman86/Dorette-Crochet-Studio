/* Dorette Studio 1.5 — offline pattern-engine additions; no server or third-party code. */
(()=>{'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const idx=(p,c,r)=>(p.rows-r)*p.cols+(c-1);
function gridAxis(image,axis){
 const {width:w,height:h,data}=image,extent=axis==='x'?w:h,span=axis==='x'?h:w;
 const line=new Float64Array(extent);
 // Favor continuous ink across the image rather than individual art details.
 const step=Math.max(1,Math.floor(span/80));let samples=0;
 for(let b=Math.floor(span*.09);b<span*.91;b+=step){samples++;
  for(let a=0;a<extent;a++){
   const i=(axis==='x'?(b*w+a):(a*w+b))*4;
   const lum=.299*data[i]+.587*data[i+1]+.114*data[i+2];
   line[a]+=lum<155?1:0;
  }
 }
 for(let a=0;a<extent;a++)line[a]/=Math.max(1,samples);
 const peaks=[];
 for(let a=0;a<extent;){
  if(line[a]<=.52){a++;continue;}
  const start=a;
  while(a<extent&&line[a]>.52)a++;
  peaks.push(Math.round((start+a-1)/2));
 }
 if(peaks.length<3)return {count:0,confidence:0,lines:[]};
 const diffs=peaks.slice(1).map((p,i)=>p-peaks[i]).filter(v=>v>=3).sort((a,b)=>a-b);
 if(!diffs.length)return {count:0,confidence:0,lines:peaks};
 const period=diffs[Math.floor(diffs.length/2)],consistent=diffs.filter(d=>Math.abs(d-period)<=Math.max(2,period*.22)).length;
 const confidence=consistent/Math.max(1,diffs.length);
 const count=Math.round((peaks[peaks.length-1]-peaks[0])/period);
 return {count:confidence>.54&&count>=2&&count<=300?count:0,confidence,lines:peaks,period};
}
function detectGrid(img){const c=document.createElement('canvas'),max=1000,scale=Math.min(1,max/Math.max(img.width,img.height));c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0,c.width,c.height);const data=g.getImageData(0,0,c.width,c.height);return {columns:gridAxis(data,'x'),rows:gridAxis(data,'y'),scale};}
function backgroundRemove(img,tolerance=38,mode='corners',chosen=null){
 const max=1500,scale=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.width*scale));c.height=Math.max(1,Math.round(img.height*scale));const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0,c.width,c.height);
 const im=g.getImageData(0,0,c.width,c.height),d=im.data,w=c.width,h=c.height,n=w*h;
 const corner=[0,(w-1)*4,((h-1)*w)*4,(n-1)*4];
 const base=chosen||[0,1,2].map(k=>corner.reduce((sum,i)=>sum+d[i+k],0)/4);
 const seen=new Uint8Array(n),queue=new Int32Array(n);let head=0,tail=0;
 function enqueue(i){if(i<0||i>=n||seen[i])return;seen[i]=1;queue[tail++]=i;}
 if(mode==='all')for(let i=0;i<n;i++)enqueue(i);
 else{for(let x=0;x<w;x++){enqueue(x);enqueue((h-1)*w+x);}for(let y=0;y<h;y++){enqueue(y*w);enqueue(y*w+w-1);}}
 const dist2=tolerance*tolerance*3;
 while(head<tail){const i=queue[head++],at=i*4,dr=d[at]-base[0],dg=d[at+1]-base[1],db=d[at+2]-base[2];
  if(dr*dr+dg*dg+db*db>dist2)continue;
  d[at+3]=0;
  if(mode!=='all'){const x=i%w;if(x>0)enqueue(i-1);if(x<w-1)enqueue(i+1);if(i>=w)enqueue(i-w);if(i<n-w)enqueue(i+w);}
 }
 g.putImageData(im,0,0);return c.toDataURL('image/png');
}
function locateNote(note,project){
 const size=project.sectionSize||25;
 const section=note.scope==='section'
   ?Math.floor((note.row-1)/size)*Math.ceil(project.cols/size)+Math.floor((note.col-1)/size)+1
   :null;
 return {...note,section};
}
function remap(project,cols,rows,mode='canvas',anchor='center'){
 if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<1||rows<1||cols>200||rows>300)throw Error('Choose 1–200 columns and 1–300 rows.');
 const fromCols=project.cols,fromRows=project.rows,total=cols*rows,newCells=Array(total).fill(0),newDone=Array(total).fill(0),newRows=Array(rows).fill(0),map=new Map();
 const offsets={left:0,right:cols-fromCols,top:0,bottom:rows-fromRows,center:Math.floor((cols-fromCols)/2)};
 const dx=anchor==='right'?offsets.right:anchor==='left'?0:offsets.center;
 const dy=anchor==='top'||anchor==='right'?rows-fromRows:anchor==='bottom'||anchor==='left'?0:Math.floor((rows-fromRows)/2);
 for(let row=1;row<=fromRows;row++)for(let col=1;col<=fromCols;col++){
  const newC=mode==='scale'?Math.floor((col-.5)*cols/fromCols)+1:col+dx;
  const newR=mode==='scale'?Math.floor((row-.5)*rows/fromRows)+1:row+dy;
  if(newC<1||newC>cols||newR<1||newR>rows)continue;
  const oldI=(fromRows-row)*fromCols+col-1,newI=(rows-newR)*cols+newC-1;
  newCells[newI]=project.cells[oldI];newDone[newI]=Number(!!(project.done[oldI]||project.rowDone?.[row-1]));map.set(oldI,newI);
 }
 if(mode==='scale'){for(let r=1;r<=rows;r++)for(let c=1;c<=cols;c++){
   const oldC=clamp(Math.floor((c-.5)*fromCols/cols)+1,1,fromCols),oldR=clamp(Math.floor((r-.5)*fromRows/rows)+1,1,fromRows);
   const oldI=(fromRows-oldR)*fromCols+oldC-1,newI=(rows-r)*cols+c-1;newCells[newI]=project.cells[oldI];newDone[newI]=Number(!!(project.done[oldI]||project.rowDone?.[oldR-1]));
  }
 }
 const layers=(project.layers||[]).map(l=>{
   const entries=[];
   if(mode==='scale'){
    const src=new Map(l.entries);
    for(let r=1;r<=rows;r++)for(let c=1;c<=cols;c++){
      const oldC=clamp(Math.floor((c-.5)*fromCols/cols)+1,1,fromCols),oldR=clamp(Math.floor((r-.5)*fromRows/rows)+1,1,fromRows);
      const v=src.get((fromRows-oldR)*fromCols+oldC-1);if(v!==undefined)entries.push([(rows-r)*cols+c-1,v]);
    }
   }else for(const [i,v] of l.entries){const m=map.get(i);if(m!==undefined)entries.push([m,v]);}
   const source=mode==='canvas'&&entries.length===l.entries.length&&l.source&&
     l.source.col+dx>=1&&l.source.col+dx<=cols&&l.source.row+dy>=1&&l.source.row+dy<=rows
     ?{...l.source,col:l.source.col+dx,row:l.source.row+dy}:null;
   return {...l,entries,source};
 });
 for(let r=1;r<=rows;r++){const oldR=mode==='scale'?clamp(Math.floor((r-.5)*fromRows/rows)+1,1,fromRows):r-dy;
  if(oldR>=1&&oldR<=fromRows&&(mode==="scale"||(dx<=0&&dx+fromCols>=cols)))newRows[r-1]=project.rowDone?.[oldR-1]||0;
 }
 const annotations=(project.annotations||[]).flatMap(note=>{
  const row=mode==='scale'?Math.floor((note.row-.5)*rows/fromRows)+1:note.row+dy;
  let col=mode==='scale'?Math.floor((note.col-.5)*cols/fromCols)+1:note.col+dx;
  if(note.scope==='row')col=clamp(col,1,cols);
  if(row<1||row>rows||col<1||col>cols)return [];
  return [locateNote({...note,col,row},{cols,sectionSize:project.sectionSize})];
 });
 return {cols,rows,cells:newCells,done:newDone,rowDone:newRows,layers,annotations};
}
function sections(p,size){size=clamp(Number(size)||25,5,100);const out=[];
 for(let r0=1;r0<=p.rows;r0+=size)for(let c0=1;c0<=p.cols;c0+=size){const c1=Math.min(p.cols,c0+size-1),r1=Math.min(p.rows,r0+size-1);let complete=0;
  for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)if(p.rowDone?.[r-1]||p.done?.[idx(p,c,r)])complete++;
  out.push({id:out.length+1,c0,c1,r0,r1,done:complete,total:(c1-c0+1)*(r1-r0+1)});
 }return out;
}
function diagonal(p){const out=[];
 for(let sum=0;sum<p.cols+p.rows-1;sum++){
  const cells=[];
  for(let r=1;r<=p.rows;r++){const c=sum-(r-1)+1;if(c>=1&&c<=p.cols)cells.push({col:c,row:r});}
  if(sum%2===1)cells.reverse();out.push(...cells);
 }return out;
}
function analyze(p){const composed=window.DoretteAdvanced?window.DoretteAdvanced.compose(p):p.cells;
 const examples=[],rowStats=[],floatCandidates=[];let transitions=0;for(let row=1;row<=p.rows;row++){
  const ordered=[];for(let col=1;col<=p.cols;col++)ordered.push({col,color:composed[idx(p,col,row)]});
  let changes=0;for(let i=1;i<ordered.length;i++)if(ordered[i].color!==ordered[i-1].color){changes++;transitions++;}
  rowStats.push({row,changes});
  for(let k=1;k<ordered.length-1;k++)if(ordered[k].color!==ordered[k-1].color&&ordered[k-1].color===ordered[k+1].color)examples.push({row,col:ordered[k].col,from:ordered[k].color,to:ordered[k-1].color});
  const byColor=new Map();for(let k=0;k<ordered.length;k++){
   const color=ordered[k].color,prev=byColor.get(color);
   if(prev!==undefined&&k-prev>8&&floatCandidates.length<120)floatCandidates.push({row,color,from:prev+1,to:k+1,span:k-prev-1});
   byColor.set(color,k);
  }
 }
 return {transitions,rowStats:rowStats.sort((a,b)=>b.changes-a.changes),examples:examples.slice(0,200),isolatedCount:examples.length,floatCandidates};
}
function colorDistance(a,b){const rgb=v=>[1,3,5].map(i=>parseInt(v.slice(i,i+2),16));const x=rgb(a),y=rgb(b);return Math.sqrt(x.reduce((sum,v,i)=>sum+(v-y[i])**2,0));}
function svg(p,{cell=12,numbers=true,legend=true,sections:sectionSize=0}={}){
 const cells=window.DoretteAdvanced?window.DoretteAdvanced.compose(p):p.cells;
 const gutter=numbers?40:8,bottom=legend?Math.max(56,p.palette.length*16+16):8,W=gutter*2+p.cols*cell,H=gutter*2+p.rows*cell+bottom;
 const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 let lines=[`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,`<rect width="100%" height="100%" fill="#fff"/>`];
 for(let r=0;r<p.rows;r++){let c=0;while(c<p.cols){let e=c+1;while(e<p.cols&&cells[r*p.cols+e]===cells[r*p.cols+c])e++;lines.push(`<rect x="${gutter+c*cell}" y="${gutter+r*cell}" width="${(e-c)*cell}" height="${cell}" fill="${esc(p.palette[cells[r*p.cols+c]].hex)}"/>`);c=e;}}
 for(let c=0;c<=p.cols;c++)lines.push(`<path d="M ${gutter+c*cell} ${gutter} v ${p.rows*cell}" stroke="#000" stroke-opacity=".16" stroke-width=".5"/>`);
 for(let r=0;r<=p.rows;r++)lines.push(`<path d="M ${gutter} ${gutter+r*cell} h ${p.cols*cell}" stroke="#000" stroke-opacity=".16" stroke-width=".5"/>`);
 if(sectionSize){for(let c=sectionSize;c<p.cols;c+=sectionSize)lines.push(`<path d="M ${gutter+c*cell} ${gutter} v ${p.rows*cell}" stroke="#7653aa" stroke-width="2"/>`);for(let r=sectionSize;r<p.rows;r+=sectionSize)lines.push(`<path d="M ${gutter} ${gutter+(p.rows-r)*cell} h ${p.cols*cell}" stroke="#7653aa" stroke-width="2"/>`);}
 if(numbers){const every=Math.max(1,Math.ceil(15/cell));for(let c=1;c<=p.cols;c++)if(c===1||c===p.cols||c%every===0)lines.push(`<text x="${gutter+(c-.5)*cell}" y="${gutter-10}" font-size="10" text-anchor="middle">${c}</text>`);for(let r=1;r<=p.rows;r++)if(r===1||r===p.rows||r%every===0)lines.push(`<text x="${gutter-6}" y="${gutter+(p.rows-r+.5)*cell+3}" font-size="10" text-anchor="end">${r}</text>`);}
 if(legend){p.palette.forEach((c,i)=>{const y=gutter+p.rows*cell+18+i*16;lines.push(`<rect x="${gutter}" y="${y}" width="12" height="12" fill="${esc(c.hex)}"/><text x="${gutter+20}" y="${y+10}" font-size="11">${esc(c.symbol)} — ${esc(c.name)}</text>`);});}
 lines.push('</svg>');return lines.join('');
}
window.DoretteNext=Object.freeze({locateNote,detectGrid,backgroundRemove,remap,sections,diagonal,analyze,colorDistance,svg});
})();
