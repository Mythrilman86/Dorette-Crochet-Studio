/* Offline cartoon preparation. Smooth across similar colors, then fit the yarn palette to stitches. */
(function(root){
'use strict';
const presets={
  simple:{passes:4,range:55,detail:.13,outline:.18,cleanup:4},
  balanced:{passes:2,range:36,detail:.38,outline:.29,cleanup:2},
  detailed:{passes:1,range:24,detail:.68,outline:.39,cleanup:1}
};
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const luma=(r,g,b)=>.2126*r+.7152*g+.0722*b;
const distance=(a,b)=>.28*(a[0]-b[0])**2+.55*(a[1]-b[1])**2+.17*(a[2]-b[2])**2;
const hex=rgb=>'#'+rgb.map(v=>clamp(Math.round(v),0,255).toString(16).padStart(2,'0')).join('');
function options(input={}){
  const p=Object.hasOwn(presets,input.preset)?presets[input.preset]:presets.balanced;
  const value=(key,min,max)=>Number.isFinite(input[key])?clamp(input[key],min,max):p[key];
  return {passes:p.passes,range:value('range',12,75),detail:value('detail',0,1),outline:value('outline',0,.65),cleanup:Math.round(value('cleanup',0,6)),colors:Number.isFinite(input.colors)?clamp(Math.round(input.colors),2,12):6,gray:input.gray===true};
}
function simplify(pixels,width,height,o,progress){
  const count=width*height;
  let image=new Float32Array(count*3),next=new Float32Array(count*3);
  for(let i=0;i<count;i++)for(let c=0;c<3;c++)image[i*3+c]=pixels[i*4+c];
  for(let pass=0;pass<o.passes;pass++){
    const radius=pass%2+1;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*3;
      let r=image[i]*3,g=image[i+1]*3,b=image[i+2]*3,weight=3;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const xx=x+dx*radius,yy=y+dy*radius;
        if(xx<0||xx>=width||yy<0||yy>=height)continue;
        const j=(yy*width+xx)*3;
        const delta=Math.max(Math.abs(image[i]-image[j]),Math.abs(image[i+1]-image[j+1]),Math.abs(image[i+2]-image[j+2]));
        const w=Math.max(0,1-delta/o.range);
        r+=image[j]*w;g+=image[j+1]*w;b+=image[j+2]*w;weight+=w;
      }
      next[i]=r/weight;next[i+1]=g/weight;next[i+2]=b/weight;
    }
    [image,next]=[next,image];
    progress(12+Math.round(36*(pass+1)/o.passes));
  }
  const preview=new Uint8ClampedArray(count*4),edges=new Float32Array(count);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x,i=p*3;
    const a=(y*width+Math.max(0,x-1))*3,b=(y*width+Math.min(width-1,x+1))*3;
    const c=(Math.max(0,y-1)*width+x)*3,d=(Math.min(height-1,y+1)*width+x)*3;
    const edge=Math.hypot(image[b]-image[a],image[b+1]-image[a+1],image[b+2]-image[a+2],image[d]-image[c],image[d+1]-image[c+1],image[d+2]-image[c+2])/Math.sqrt(3);
    edges[p]=clamp((edge-23)/85,0,1);
    const gray=luma(image[i],image[i+1],image[i+2]);
    const neighbor=(luma(image[a],image[a+1],image[a+2])+luma(image[b],image[b+1],image[b+2])+luma(image[c],image[c+1],image[c+2])+luma(image[d],image[d+1],image[d+2]))/4;
    const originalGray=o.gray?luma(pixels[p*4],pixels[p*4+1],pixels[p*4+2]):0;
    for(let channel=0;channel<3;channel++){
      const soft=o.gray?gray:image[i+channel];
      const original=o.gray?originalGray:pixels[p*4+channel];
      const tone=soft+(original-soft)*o.detail;
      // Darken the darker side of a structural boundary to avoid outlining both sides.
      preview[p*4+channel]=tone*(1-o.outline*edges[p]*clamp((neighbor-gray+4)/30,0,1));
    }
    preview[p*4+3]=255;
  }
  return {preview,edges};
}
function stitchSamples(preview,edges,width,height,cols,rows){
  const values=[],salience=[];
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const x0=Math.floor(col*width/cols),x1=Math.floor((col+1)*width/cols);
    const y0=Math.floor(row*height/rows),y1=Math.floor((row+1)*height/rows);
    let r=0,g=0,b=0,n=0,edge=0;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const i=y*width+x;
      r+=preview[i*4];g+=preview[i*4+1];b+=preview[i*4+2];edge+=edges[i];n++;
    }
    values.push([r/n,g/n,b/n]);salience.push(edge/n);
  }
  return {values,salience};
}
function quantize(values,salience,count,detail){
  const centers=[values[Math.floor(values.length/2)].slice()];
  const nearestDistance=new Float64Array(values.length).fill(Infinity);
  while(centers.length<count){
    let best=0,score=-1;
    const last=centers.at(-1);
    for(let i=0;i<values.length;i++){
      nearestDistance[i]=Math.min(nearestDistance[i],distance(values[i],last));
      const weight=nearestDistance[i]*(.6+salience[i]*detail);
      if(weight>score){score=weight;best=i;}
    }
    if(score<8)break;
    centers.push(values[best].slice());
  }
  const assign=value=>{
    let best=0,score=Infinity;
    for(let k=0;k<centers.length;k++){
      const error=distance(value,centers[k]);
      if(error<score){best=k;score=error;}
    }
    return best;
  };
  for(let pass=0;pass<8;pass++){
    const sums=centers.map(()=>[0,0,0,0]);
    for(let i=0;i<values.length;i++){
      const rgb=values[i],sum=sums[assign(rgb)],weight=1+salience[i]*detail;
      for(let c=0;c<3;c++)sum[c]+=rgb[c]*weight;
      sum[3]+=weight;
    }
    sums.forEach((sum,k)=>{if(sum[3])centers[k]=sum.slice(0,3).map(v=>v/sum[3]);});
  }
  return {centers,cells:values.map(assign)};
}
function neighbors(i,cols,rows){
  const x=i%cols,y=Math.floor(i/cols);
  return [x?i-1:-1,x+1<cols?i+1:-1,y?i-cols:-1,y+1<rows?i+cols:-1];
}
function components(cells,cols,rows,visit){
  const seen=new Uint8Array(cells.length);
  for(let i=0;i<cells.length;i++){
    if(seen[i])continue;
    const group=[i];seen[i]=1;
    for(let p=0;p<group.length;p++)for(const j of neighbors(group[p],cols,rows)){
      if(j>=0&&!seen[j]&&cells[j]===cells[i]){seen[j]=1;group.push(j);}
    }
    visit(group,cells[i]);
  }
}
function cleanup(cells,centers,salience,cols,rows,o){
  const result=cells.slice();
  if(!o.cleanup)return result;
  components(cells,cols,rows,(group,color)=>{
    if(group.length>o.cleanup)return;
    const edge=group.reduce((n,i)=>n+salience[i],0)/group.length;
    if(edge>.35-o.detail*.22)return;
    const adjacent=new Map();
    for(const i of group)for(const j of neighbors(i,cols,rows)){
      if(j>=0&&cells[j]!==color)adjacent.set(cells[j],(adjacent.get(cells[j])||0)+1);
    }
    let best=color,score=Infinity;
    for(const [candidate,border] of adjacent){
      const cost=distance(centers[candidate],centers[color])/(1+border*.55);
      if(cost<score){best=candidate;score=cost;}
    }
    // Keep high-contrast flecks when they could be meaningful features.
    if(score>1800*(1-o.detail*.65))return;
    for(const i of group)result[i]=best;
  });
  return result;
}
function metrics(cells,cols,rows){
  let isolated=0,tinyRegions=0,tinyStitches=0;
  components(cells,cols,rows,group=>{
    if(group.length===1)isolated++;
    if(group.length<=3){tinyRegions++;tinyStitches+=group.length;}
  });
  const rowChanges=Array(rows).fill(0);
  for(let i=0;i<cells.length;i++)if(i%cols&&cells[i]!==cells[i-1])rowChanges[rows-1-Math.floor(i/cols)]++;
  return {isolated,tinyRegions,tinyPercent:100*tinyStitches/cells.length,rowChanges,averageChanges:rowChanges.reduce((a,b)=>a+b,0)/rows};
}
function flattenTones(preview,centers,detail){
  const strength=.86-detail*.42, rgb=[0,0,0];
  for(let i=0;i<preview.length;i+=4){
    rgb[0]=preview[i];rgb[1]=preview[i+1];rgb[2]=preview[i+2];
    let nearest=centers[0],error=Infinity;
    for(const tone of centers){
      const d=distance(rgb,tone);
      if(d<error){nearest=tone;error=d;}
    }
    for(let c=0;c<3;c++)preview[i+c]=rgb[c]+(nearest[c]-rgb[c])*strength;
  }
}
function convert({pixels,width,height,cols,rows,settings},progress=()=>{}){
  if(![width,height,cols,rows].every(Number.isInteger)||cols<1||rows<1||cols>200||rows>300||width<cols||height<rows||width>480||height>480||pixels?.length!==width*height*4)throw Error('Invalid cartoon image or chart size.');
  const o=options(settings);
  const {preview,edges}=simplify(pixels,width,height,o,progress);
  const {values,salience}=stitchSamples(preview,edges,width,height,cols,rows);
  const {centers,cells:raw}=quantize(values,salience,o.colors,o.detail);
  progress(82);
  flattenTones(preview,centers,o.detail);
  const cells=cleanup(raw,centers,salience,cols,rows,o);
  const palette=[],byHex=new Map();
  const mapped=cells.map(i=>{
    const color=hex(centers[i]);
    if(!byHex.has(color)){
      const n=palette.length;
      byHex.set(color,n);palette.push({hex:color,name:(o.gray?'Gray ':'Yarn ')+(n+1),symbol:'ABCDEFGHIJKL'[n]});
    }
    return byHex.get(color);
  });
  return {cols,rows,width,height,preview,palette,cells:mapped,metrics:metrics(mapped,cols,rows),beforeCleanup:metrics(raw,cols,rows)};
}
root.StudioCartoon=Object.freeze({convert,options,metrics});
})(typeof self!=='undefined'?self:globalThis);
