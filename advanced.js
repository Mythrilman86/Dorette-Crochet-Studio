/* Dorette Crochet Studio 1.4.0 advanced pattern helpers. Offline, pure, dependency-free. */
(()=>{'use strict';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function compose(project){const cells=project.cells.slice(),n=cells.length;
 for(const layer of project.layers||[]){if(layer.visible===false)continue;
  for(const [index,color] of layer.entries||[])if(Number.isInteger(index)&&index>=0&&index<n&&Number.isInteger(color)&&color>=0&&color<project.palette.length)cells[index]=color;
 }return cells;
}
function grayscale(values,n){n=clamp(Math.round(n)||3,2,5);const palette=Array.from({length:n},(_,i)=>{const v=Math.round(25+(230*i/(n-1)));return {hex:'#'+v.toString(16).padStart(2,'0').repeat(3),name:i===0?'Black':i===n-1?'White':`Gray ${i}`,symbol:'ABCDE'[i]};});
 const cells=values.map(rgb=>{const lum=rgb[0]*.299+rgb[1]*.587+rgb[2]*.114;return clamp(Math.round((lum-25)*(n-1)/230),0,n-1);});return {palette,cells};}
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
function mirrorPoints(points,cols,rows,mode){const map=new Map();for(const [i,color] of points){const x=i%cols,y=Math.floor(i/cols);map.set(i,color);if(mode.includes('h'))map.set(y*cols+(cols-1-x),color);if(mode.includes('v'))map.set((rows-1-y)*cols+x,color);if(mode==='hv')map.set((rows-1-y)*cols+(cols-1-x),color);}return [...map];}
window.DoretteAdvanced=Object.freeze({compose,grayscale,cleanup,audit,gauge,mirrorPoints,getComponents});
})();
