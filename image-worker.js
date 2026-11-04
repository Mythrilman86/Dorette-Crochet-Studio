/* Dorette Crochet Studio v1.8.1 — offline conversion, grid analysis, cleanup worker.
   No network access. Cancel an operation by terminating this worker. */
(()=>{'use strict';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const rgbhex=a=>'#'+a.map(x=>Math.round(clamp(x,0,255)).toString(16).padStart(2,'0')).join('');
const weighted=v=>v[0]*.299+v[1]*.587+v[2]*.114;
const symbols='ABCDEFGHIJKL';
function adjust(r,g,b,s){const f=1+s.contrast/100,o=s.brightness*1.6;return [clamp((r-128)*f+128+o,0,255),clamp((g-128)*f+128+o,0,255),clamp((b-128)*f+128+o,0,255)];}
function printCat(v,s){const [r,g,b]=v,max=Math.max(r,g,b),min=Math.min(r,g,b),chroma=max-min,k=s.colorSensitivity;
 if(chroma>=k&&r>g*1.12&&r>b*1.07&&(r-g)>k*.7)return 2;
 if(chroma>=k&&b>g*1.04&&b>r*1.065&&(b-r)>k*.65)return 3;
 return weighted(v)>=s.whiteThreshold?1:0;
}
function quantize(values,n){
 const step=Math.max(1,Math.floor(values.length/3500)),samples=values.filter((_,i)=>i%step===0),centers=[samples[0]||[255,255,255]];
 const dist=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;
 for(let k=1;k<n;k++){let best=samples[0],far=-1;for(const v of samples){let d=Infinity;for(const c of centers)d=Math.min(d,dist(v,c));if(d>far){far=d;best=v;}}centers.push([...best]);}
 for(let k=0;k<9;k++){
  const sums=Array.from({length:n},()=>[0,0,0,0]);
  for(const v of samples){let near=0,d=Infinity;centers.forEach((c,i)=>{const t=dist(v,c);if(t<d){d=t;near=i;}});const sum=sums[near];sum[0]+=v[0];sum[1]+=v[1];sum[2]+=v[2];sum[3]++;}
  for(let i=0;i<n;i++)if(sums[i][3])centers[i]=sums[i].slice(0,3).map(x=>x/sums[i][3]);
 }
 const cluster=values.map(v=>{let near=0,d=Infinity;centers.forEach((c,i)=>{const t=dist(v,c);if(t<d){d=t;near=i;}});return near;});
 const counts=Array(n).fill(0);cluster.forEach(i=>counts[i]++);
 const order=counts.map((count,i)=>({i,count})).filter(x=>x.count).sort((a,b)=>b.count-a.count),map=new Map(order.map((o,i)=>[o.i,i]));
 return {palette:order.map((x,i)=>({hex:rgbhex(centers[x.i]),name:'Yarn color '+(i+1),symbol:symbols[i]})),cells:cluster.map(i=>map.get(i))};
}
function convert({pixels,cols,rows,s,paletteSize,grayCount}){
 const multiple=6,values=[],printCells=[],coverage=multiple*multiple,minCoverage=clamp(.38-s.detail*.0028,.09,.38),minHue=clamp(.31-s.detail*.0018,.11,.31),width=cols*multiple;
 for(let row=0;row<rows;row++){
  for(let col=0;col<cols;col++){
   let rr=0,gg=0,bb=0;const frequency=[0,0,0,0];
   for(let dy=0;dy<multiple;dy++)for(let dx=0;dx<multiple;dx++){
    const i=((row*multiple+dy)*width+(col*multiple+dx))*4,v=adjust(pixels[i],pixels[i+1],pixels[i+2],s);
    rr+=v[0];gg+=v[1];bb+=v[2];if(s.mode==='print')frequency[printCat(v,s)]++;
   }
   const avg=[rr/coverage,gg/coverage,bb/coverage];values.push(avg);
   if(s.mode==='print'){
    let category=0;
    if(frequency[2]/coverage>=minHue||frequency[3]/coverage>=minHue)category=frequency[2]>=frequency[3]?2:3;
    else if(frequency[1]/coverage>=minCoverage)category=1;
    else if(weighted(avg)>=s.whiteThreshold+12)category=1;
    printCells.push(category);
   }
  }
  if(row%25===0)postMessage({type:'progress',percent:Math.round(65*(row+1)/rows)});
 }
 if(s.mode==='print'){
  const cells=printCells.slice();
  if(s.detail<75)for(let r=1;r<rows-1;r++)for(let c=1;c<cols-1;c++){
   const i=r*cols+c;if(printCells[i]!==1)continue;
   let adjacent=0;for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(!dr&&!dc)continue;if(printCells[(r+dr)*cols+c+dc]===1)adjacent++;}
   if(!adjacent)cells[i]=0;
  }
  return {palette:[{hex:'#221d25',name:'Dark background',symbol:'A'},{hex:'#f5f1e9',name:'Light lettering / stripes',symbol:'B'},{hex:'#da4852',name:'Flag red',symbol:'C'},{hex:'#303f86',name:'Flag blue',symbol:'D'}],cells};
 }
 if(s.mode==='grayscale'){
  const n=clamp(grayCount||3,2,5),palette=Array.from({length:n},(_,i)=>{const v=Math.round(25+230*i/(n-1)),hex='#'+v.toString(16).padStart(2,'0').repeat(3);return {hex,name:i===0?'Black':i===n-1?'White':'Gray '+i,symbol:symbols[i]};});
  return {palette,cells:values.map(rgb=>clamp(Math.round((weighted(rgb)-25)*(n-1)/230),0,n-1))};
 }
 return quantize(values,clamp(paletteSize||6,2,12));
}
function gridAxis(image,axis){
 const {width:w,height:h,data}=image,extent=axis==='x'?w:h,span=axis==='x'?h:w,line=new Float64Array(extent);
 const step=Math.max(1,Math.floor(span/80));let samples=0;
 for(let b=Math.floor(span*.09);b<span*.91;b+=step){samples++;for(let a=0;a<extent;a++){
  const i=(axis==='x'?(b*w+a):(a*w+b))*4;const lum=.299*data[i]+.587*data[i+1]+.114*data[i+2];line[a]+=lum<155?1:0;
 }}
 for(let a=0;a<extent;a++)line[a]/=Math.max(1,samples);
 const peaks=[];for(let a=0;a<extent;){if(line[a]<=.52){a++;continue;}const start=a;while(a<extent&&line[a]>.52)a++;peaks.push(Math.round((start+a-1)/2));}
 if(peaks.length<3)return {count:0,confidence:0,lines:[]};
 const diffs=peaks.slice(1).map((p,i)=>p-peaks[i]).filter(v=>v>=3).sort((a,b)=>a-b);
 if(!diffs.length)return {count:0,confidence:0,lines:peaks};
 const period=diffs[Math.floor(diffs.length/2)],consistent=diffs.filter(d=>Math.abs(d-period)<=Math.max(2,period*.22)).length;
 const confidence=consistent/Math.max(1,diffs.length),count=Math.round((peaks.at(-1)-peaks[0])/period);
 return {count:confidence>.54&&count>=2&&count<=300?count:0,confidence,lines:peaks,period};
}
function grid({pixels,width,height}){return {columns:gridAxis({width,height,data:pixels},'x'),rows:gridAxis({width,height,data:pixels},'y'),scale:1};}
function cleanup({cells,cols,rows,limit,protectedIndices}){
 const seen=new Uint8Array(cells.length),protect=new Set(protectedIndices||[]),changes=[];
 for(let i=0;i<cells.length;i++){
  if(seen[i])continue;const source=cells[i],stack=[i],group=[];seen[i]=1;
  while(stack.length){const j=stack.pop();group.push(j);const x=j%cols,y=Math.floor(j/cols);
   for(const k of [x>0?j-1:-1,x<cols-1?j+1:-1,y>0?j-cols:-1,y<rows-1?j+cols:-1])if(k>=0&&!seen[k]&&cells[k]===source){seen[k]=1;stack.push(k);}
  }
  if(group.length>limit&&group.length!==1)continue;
  if(group.some(k=>protect.has(k)))continue;
  const counts=new Map();for(const j of group){const x=j%cols,y=Math.floor(j/cols);
   for(const k of [x>0?j-1:-1,x<cols-1?j+1:-1,y>0?j-cols:-1,y<rows-1?j+cols:-1])if(k>=0&&cells[k]!==source)counts.set(cells[k],(counts.get(cells[k])||0)+1);
  }
  const replacement=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0];if(replacement!==undefined)for(const j of group)changes.push([j,replacement]);
 }
 return changes;
}
self.onmessage=e=>{
 try{
  const d=e.data||{};if(!['convert','grid','cleanup'].includes(d.kind))throw Error('Unsupported job');
  const result=d.kind==='convert'?convert(d):d.kind==='grid'?grid(d):cleanup(d);
  self.postMessage({type:'done',result});
 }catch(err){self.postMessage({type:'error',error:String(err.message||err)});}
};
})();
