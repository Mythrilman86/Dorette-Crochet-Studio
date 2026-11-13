/* Dorette Crochet Studio 1.4.0 advanced pattern helpers. Offline, pure, dependency-free. */
(()=>{'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function compose(project){const cells=project.cells.slice(),n=cells.length;
 for(const layer of project.layers||[]){if(layer.visible===false)continue;
  for(const [index,color] of layer.entries||[])if(Number.isInteger(index)&&index>=0&&index<n&&Number.isInteger(color)&&color>=0&&color<project.palette.length)cells[index]=color;
 }return cells;
}
function grayscale(values,n,options={}){
 n=clamp(Math.round(Number(n))||6,2,12);
 const number=(key,fallback,min,max)=>clamp(Number.isFinite(Number(options[key]))?Number(options[key]):fallback,min,max);
 const width=Math.max(1,Math.round(number('width',values.length||1,1,60000))),height=Math.ceil(values.length/width);
 let tone=Float64Array.from(values,rgb=>clamp(Number(rgb[0])*.2126+Number(rgb[1])*.7152+Number(rgb[2])*.0722,0,255));
 const histogram=data=>{const h=new Float64Array(256);for(const v of data)h[Math.round(clamp(v,0,255))]++;return h;};
 const percentile=(h,f)=>{let count=0;for(let i=0;i<256;i++){count+=h[i];if(count>=Math.max(1,tone.length*f))return i;}return 255;};
 const hist=histogram(tone),low=percentile(hist,.005),high=percentile(hist,.995);
 const balance=options.autoBalance!==false&&high-low>=40;
 const brightness=number('brightness',0,-50,50)*1.6,contrast=2**(number('contrast',0,-50,80)/100),gamma=2**(-number('midtones',0,-50,50)/100),shadows=number('shadows',15,0,60)/100,highlights=number('highlights',0,-50,50)/100;
 tone=Float64Array.from(tone,v=>{let x=clamp(balance?(v-low)*255/(high-low):v,0,255)/255;x=x**gamma;x+=shadows*2*x*(1-x)**2+highlights*x*x*(1-x);return clamp((x*255-128)*contrast+128+brightness,0,255);});
 const smoothing=number('smoothing',0,0,2),edge=number('edge',0,0,100)/100;
 if((smoothing||edge)&&width>1&&height>1){const original=tone,filtered=new Float64Array(tone.length);
  for(let i=0;i<tone.length;i++){const x=i%width,y=Math.floor(i/width);let sum=0,weight=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy,j=yy*width+xx;if(xx<0||xx>=width||yy<0||yy>=height||j>=tone.length)continue;const w=(dx===0&&dy===0?4:1)*Math.exp(-Math.abs(original[j]-original[i])/(smoothing===2?40:22));sum+=original[j]*w;weight+=w;}filtered[i]=sum/weight;}
  tone=Float64Array.from(original,(v,i)=>clamp((smoothing?filtered[i]:v)+edge*1.8*(v-filtered[i]),0,255));
 }
 const h=histogram(tone),centers=[percentile(h,.5)];
 for(let k=1;k<n;k++){let best=0,score=0;for(let v=0;v<256;v++){if(!h[v])continue;const cost=h[v]*Math.min(...centers.map(c=>(v-c)**2));if(cost>score){score=cost;best=v;}}if(!score)break;centers.push(best);}n=centers.length;centers.sort((a,b)=>a-b);
 // Fit grayscale yarns to this image's tonal distribution instead of fixed thresholds.
 for(let iteration=0;iteration<12;iteration++){const sums=Array(n).fill(0),counts=Array(n).fill(0);for(let v=0;v<256;v++){if(!h[v])continue;let nearest=0;for(let k=1;k<n;k++)if(Math.abs(v-centers[k])<Math.abs(v-centers[nearest]))nearest=k;sums[nearest]+=v*h[v];counts[nearest]+=h[v];}for(let k=0;k<n;k++)if(counts[k])centers[k]=sums[k]/counts[k];centers.sort((a,b)=>a-b);}
 const levels=[...new Set(centers.map(v=>Math.round(v)))];
 const palette=levels.map((v,i)=>({hex:'#'+v.toString(16).padStart(2,'0').repeat(3),name:v<=12?'Black':v>=245?'White':`Gray ${i+1} (${v})`,symbol:'ABCDEFGHIJKL'[i]}));
 const nearest=v=>{let k=0;for(let j=1;j<levels.length;j++)if(Math.abs(v-levels[j])<Math.abs(v-levels[k]))k=j;return k;};
 const cells=Array(tone.length),work=Float64Array.from(tone);for(let y=0;y<height;y++){const reverse=options.dither===true&&y%2===1;for(let a=0;a<width;a++){const x=reverse?width-1-a:a,i=y*width+x;if(i>=work.length)continue;const k=nearest(work[i]);cells[i]=k;if(options.dither){const e=work[i]-levels[k],dir=reverse?-1:1;for(const [dx,dy,w]of [[dir,0,7],[-dir,1,3],[0,1,5],[dir,1,1]]){const xx=x+dx,j=(y+dy)*width+xx;if(xx>=0&&xx<width&&j<work.length)work[j]+=e*w/16;}}}}
 return {palette,cells};
}
function wheelZoomStep(state,event,now){
 const delta=Number(event.deltaY);if(!Number.isFinite(delta)||delta===0||(!event.ctrlKey&&Math.abs(Number(event.deltaX)||0)>Math.abs(delta)))return 0;
 const direction=delta<0?1:-1;
 if(!Number.isFinite(state.lastEvent)||now-state.lastEvent>180||direction!==state.direction){state.steps=0;state.amount=0;state.lastStep=-Infinity;}
 state.lastEvent=now;state.direction=direction;
 if(state.steps>=3)return 0;
 state.amount+=Math.min(40,Math.abs(delta)*(event.deltaMode===1?16:event.deltaMode===2?400:1));
 if(state.amount<16)return 0;
 state.amount=0;if(now-state.lastStep<100)return 0;
 state.lastStep=now;state.steps++;return direction*10;
}
function getComponents(cells,cols,rows){const seen=new Uint8Array(cells.length),components=[];
 for(let i=0;i<cells.length;i++){if(seen[i])continue;const color=cells[i],stack=[i],group=[];seen[i]=1;
  while(stack.length){const j=stack.pop();group.push(j);const x=j%cols,y=Math.floor(j/cols);
   for(const k of [x>0?j-1:-1,x<cols-1?j+1:-1,y>0?j-cols:-1,y<rows-1?j+cols:-1])if(k>=0&&!seen[k]&&cells[k]===color){seen[k]=1;stack.push(k);}}
  components.push({color,indices:group});
 }return components;
}
function cleanup(cells,cols,rows,limit=2,protectedIndices=[]){const protectedSet=new Set(protectedIndices),changes=[];
 const components=getComponents(cells,cols,rows);for(const group of components){if(group.indices.length>limit && group.indices.length!==1)continue;
  if(group.indices.some(i=>protectedSet.has(i)))continue;
  const neighbors=new Map();for(const i of group.indices){const x=i%cols,y=Math.floor(i/cols);
    for(const j of [x>0?i-1:-1,x<cols-1?i+1:-1,y>0?i-cols:-1,y<rows-1?i+cols:-1])if(j>=0&&cells[j]!==group.color)neighbors.set(cells[j],(neighbors.get(cells[j])||0)+1);
  }
  const replacement=[...neighbors].sort((a,b)=>b[1]-a[1])[0]?.[0];if(replacement!==undefined)for(const i of group.indices)changes.push([i,replacement]);
 }return changes;
}
function audit(project){const cells=compose(project),cols=project.cols,rows=project.rows;
 let singles=0,blocks=0,transitions=0,edges=0,emptyRows=0;
 const comp=getComponents(cells,cols,rows);for(const g of comp){if(g.indices.length===1)singles++;if(g.indices.length<=3)blocks++;}
 for(let y=0;y<rows;y++){let allBase=true;for(let x=0;x<cols;x++){const i=y*cols+x;if(cells[i]!==0)allBase=false;if(x&&cells[i]!==cells[i-1])transitions++;}if(allBase)emptyRows++;}
 for(let x=0;x<cols;x++)if(cells[x]!==0||cells[(rows-1)*cols+x]!==0)edges++;
 return {singles,blocks,transitions,edges,emptyRows,usedColors:new Set(cells).size};
}
function gauge(cols,rows,stitches,rowsPerSwatch,swatchWidth,swatchHeight){if(![cols,rows,stitches,rowsPerSwatch,swatchWidth,swatchHeight].every(v=>Number(v)>0))return null;
 return {width:cols*swatchWidth/stitches,height:rows*swatchHeight/rowsPerSwatch};}
// Largest target-shaped rectangle inside the existing crop.
function cropToFill(crop,width,height,cols,rows){
 const x=(crop.left+crop.right)/2,y=(crop.top+crop.bottom)/2;
 const ratio=cols*height/(rows*width);
 const w=Math.min(crop.right-crop.left,(crop.bottom-crop.top)*ratio),h=w/ratio;
 if(!Number.isFinite(w)||!Number.isFinite(h)||w<.08-1e-9||h<.08-1e-9)return null;
 return {left:x-w/2,top:y-h/2,right:x+w/2,bottom:y+h/2};
}
function photoPlacement(sourceWidth,sourceHeight,cols,rows,stretch=false){
 const scale=Math.min(cols/sourceWidth,rows/sourceHeight);
 const w=stretch?cols:sourceWidth*scale,h=stretch?rows:sourceHeight*scale;
 return {x:(cols-w)/2,y:(rows-h)/2,w,h};
}
function mirrorPoints(points,cols,rows,mode){const map=new Map();for(const [i,color] of points){const x=i%cols,y=Math.floor(i/cols);map.set(i,color);if(mode.includes('h'))map.set(y*cols+(cols-1-x),color);if(mode.includes('v'))map.set((rows-1-y)*cols+x,color);if(mode==='hv')map.set((rows-1-y)*cols+(cols-1-x),color);}return [...map];}
(typeof window!=='undefined'?window:self).DoretteAdvanced=Object.freeze({compose,grayscale,wheelZoomStep,cleanup,audit,gauge,mirrorPoints,getComponents,cropToFill,photoPlacement});
})();
