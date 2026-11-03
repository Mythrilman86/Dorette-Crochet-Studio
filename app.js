/* Dorette Crochet Studio — vanilla JS, local-first, zero external dependencies.
   Data model: cells in top-to-bottom row-major order, rowDone indexed from BOTTOM (index 0 = Row 1).
   All project data lives in IndexedDB; exported ZIPs contain portable JSON and embedded reference images. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const CELL = 23, M = 57, MAX_COLS = 200, MAX_ROWS = 300;
const DB_NAME = 'dorette-crochet-studio', DB_VERSION = 1;
const SYMBOLS = 'ABCDEFGHIJKL';
const DEFAULT_COLORS = [{hex:'#fffdf9',name:'Background',symbol:'A'}];
const refs = {};
let db = null, memoryOnly = false, projects = new Map(), activeId = null, active = null;
let selected = null, undoStack = [], saveTimer = null, writeChain = Promise.resolve();
let toastTimer = null, referenceImg = null, referenceSrc = '', canvasWidth = 800, canvasHeight = 480;
const view = {scale:1, x:0, y:0}, pointers = new Map();
let gesture = {dragged:false,wasMulti:false,lastDist:0,totalTravel:0};
let drawingPending = false;
const canvas = $('chartCanvas'), ctx = canvas.getContext('2d', {alpha:false});

function uid() { return crypto.randomUUID ? crypto.randomUUID() : 'p-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2); }
function blankProject(name, cols, rows) {
  return {id:uid(),name:name.trim()||'Untitled Chart', cols,rows, cells:Array(cols*rows).fill(0),
    done:Array(cols*rows).fill(0), rowDone:Array(rows).fill(0), palette:DEFAULT_COLORS.map(c=>({...c})),
    referenceImage:null,opacity:0.35,converted:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
function clamp(n,min,max) {return Math.min(max,Math.max(min,n));}
function validDimensions(cols,rows) {return Number.isInteger(cols)&&Number.isInteger(rows)&&cols>=1&&cols<=MAX_COLS&&rows>=1&&rows<=MAX_ROWS;}
function indexFor(col,row) { return (active.rows-row)*active.cols+(col-1); }
function format(n) {return n.toLocaleString('en-US');}
function toast(msg) {const t=$('toast'); t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3300);}
function status(msg,error=false) {const el=$('saveStatus');el.textContent=msg;el.style.color=error?'#b35269':'#537e64';}

async function openDatabase() {
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{if (!req.result.objectStoreNames.contains('projects'))req.result.createObjectStore('projects',{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
    req.onblocked=()=>reject(new Error('Database upgrade blocked by another tab'));
  });
}
function dbRequest(storeType,action) {
  return new Promise((resolve,reject)=>{
    if (!db) return reject(new Error('Local database unavailable'));
    const tx=db.transaction('projects',storeType), store=tx.objectStore('projects');
    let result;
    try {result=action(store);}catch(e){reject(e);return;}
    tx.oncomplete=()=>resolve(result?.result);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error('Storage transaction aborted'));
  });
}
async function loadProjects(){return dbRequest('readonly',store=>store.getAll());}
function queueWrite(project) {
  if (memoryOnly) {status('Storage blocked — export backups',true);return Promise.resolve();}
  const copy=structuredClone(project);
  writeChain=writeChain.catch(()=>{}).then(()=>dbRequest('readwrite',store=>store.put(copy)));
  writeChain.then(()=>status('✓ Saved on this device')).catch(e=>{status('Save failed — export a backup',true);toast('Unable to save locally: '+e.message);});
  return writeChain;
}
function scheduleSave(){
  if (!active) return;
  active.updatedAt=new Date().toISOString();
  status(memoryOnly?'Storage blocked — export backups':'Saving…',memoryOnly);
  const id=active.id;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{saveTimer=null;const project=projects.get(id);if(project)queueWrite(project);},420);
}
function flushSave(){
  if(saveTimer){clearTimeout(saveTimer);saveTimer=null;if(active)queueWrite(active);}
}
function refreshProjectList(){
  const list=$('projectList');list.replaceChildren();
  $('projectCount').textContent=projects.size;
  [...projects.values()].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).forEach(p=>{
    const b=document.createElement('button');b.type='button';b.className='project-item'+(p.id===activeId?' active':'');
    const title=document.createElement('strong');title.textContent=p.name;
    const dims=document.createElement('small');dims.textContent=`${p.cols} × ${p.rows} stitches`;
    b.append(title,dims);b.addEventListener('click',()=>selectProject(p.id));list.append(b);
  });
}
function selectProject(id) {
  flushSave(); activeId=id;active=projects.get(id);selected=null;undoStack=[];
  try {localStorage.setItem('dorette-active-project',id);}catch{}
  syncImage();refreshProjectList();refreshInspector();fitChart();
}
function refreshInspector(){
  if (!active)return;
  $('workspaceTitle').textContent=active.name;$('projectName').value=active.name;
  $('chartSubtitle').textContent=`${active.cols} columns × ${active.rows} rows • Row 1 begins at the bottom`;
  $('colsInput').value=active.cols;$('rowsInput').value=active.rows;
  $('imageOpacity').value=Math.round(active.opacity*100);$('opacityText').textContent=Math.round(active.opacity*100)+'%';
  $('convertPhoto').disabled=!active.referenceImage;$('removeImage').disabled=!active.referenceImage;
  updateSelection();updateProgress();updateLegend();requestDraw();
}
function snapshot() {
  if(!active)return;
  undoStack.push({name:active.name,cols:active.cols,rows:active.rows,cells:active.cells.slice(),done:active.done.slice(),
    rowDone:active.rowDone.slice(),palette:active.palette.map(p=>({...p})),referenceImage:active.referenceImage,
    opacity:active.opacity,converted:active.converted});
  if(undoStack.length>30)undoStack.shift();
  $('undoButton').disabled=false;
}
function undo(){
  const previous=undoStack.pop();if(!previous||!active)return;
  Object.assign(active,previous);
  if(selected&&(selected.col>active.cols||selected.row>active.rows))selected=null;
  $('undoButton').disabled=undoStack.length===0;
  syncImage();scheduleSave();refreshInspector();toast('Last change undone');
}
function updateSelection(){
  if(!selected){$('selectedCell').textContent='Tap any square to begin';$('markStitch').disabled=true;$('markRow').disabled=true;$('paintStitch').disabled=true;return;}
  const i=indexFor(selected.col,selected.row),d=!!active.done[i]||!!active.rowDone[selected.row-1];
  $('selectedCell').textContent=`Row ${selected.row} · Column ${selected.col} ${d?'· Complete':''}`;
  $('markStitch').disabled=false;$('markRow').disabled=false;$('paintStitch').disabled=false;
  $('markStitch').textContent=d?'↶ Unmark stitch':'✓ Mark stitch';
  $('markRow').textContent=active.rowDone[selected.row-1]?'↶ Unmark row':'✓ Mark row';
}
function updateProgress(){
  if(!active)return;
  let done=0;
  for(let i=0;i<active.done.length;i++){
    const fromTop=Math.floor(i/active.cols),row=active.rows-fromTop;
    if(active.done[i]||active.rowDone[row-1])done++;
  }
  const total=active.cols*active.rows,pct=Math.round(done/total*100);
  $('progressText').textContent=`${format(done)} / ${format(total)} stitches`;
  $('progressPercent').textContent=pct+'%';$('progressBar').style.width=pct+'%';
}
function updateLegend(){
  if(!active)return;
  const counts=active.palette.map(()=>0);
  active.cells.forEach(i=>{if(Number.isInteger(i)&&i>=0&&i<counts.length)counts[i]++;});
  $('totalColors').textContent=active.palette.length;
  const colorSelect=$('paintColor'),current=Number(colorSelect.value);
  colorSelect.replaceChildren();
  active.palette.forEach((c,i)=>{const o=document.createElement('option');o.value=i;o.textContent=c.symbol+' · '+c.name+' ('+c.hex+')';colorSelect.append(o);});
  colorSelect.value=String(current>=0&&current<active.palette.length?current:0);
  $('addYarnColor').disabled=active.palette.length>=12;
  const legend=$('legend');legend.replaceChildren();
  active.palette.forEach((c,i)=>{
    const item=document.createElement('div');item.className='legend-row';
    const sw=document.createElement('span');sw.className='swatch';sw.style.background=c.hex;
    const symbol=document.createElement('span');symbol.className='symbol';symbol.textContent=c.symbol;
    const name=document.createElement('span');name.className='legend-name';name.textContent=c.name+' '+c.hex;
    const count=document.createElement('strong');count.className='legend-count';count.textContent=format(counts[i]);
    item.append(sw,symbol,name,count);legend.append(item);
  });
}
function markStitch(){
  if(!selected||!active)return;
  const i=indexFor(selected.col,selected.row);snapshot();
  if(active.rowDone[selected.row-1]){
    // Expand the completed row into individual stitch flags, then unmark the selected stitch.
    const topRow=active.rows-selected.row;
    for(let c=0;c<active.cols;c++)active.done[topRow*active.cols+c]=1;
    active.rowDone[selected.row-1]=0;active.done[i]=0;
  } else active.done[i]=active.done[i]?0:1;
  scheduleSave();updateSelection();updateProgress();requestDraw();
}
function markRow(){
  if(!selected||!active)return;
  snapshot();active.rowDone[selected.row-1]=active.rowDone[selected.row-1]?0:1;
  scheduleSave();updateSelection();updateProgress();requestDraw();
}
function paintStitch(){
  if(!selected||!active)return;
  const color=Number($('paintColor').value),i=indexFor(selected.col,selected.row);
  if(!Number.isInteger(color)||color<0||color>=active.palette.length)return;
  if(active.cells[i]===color&&active.converted)return;
  snapshot();active.cells[i]=color;active.converted=true;
  scheduleSave();updateLegend();requestDraw();
}
function addYarnColor(){
  if(!active||active.palette.length>=12){toast('Up to 12 yarn colors are supported.');return;}
  const hex=$('newHex').value;
  snapshot();const index=active.palette.length;
  active.palette.push({hex,name:'Yarn color '+(index+1),symbol:SYMBOLS[index]});
  scheduleSave();updateLegend();$('paintColor').value=String(index);toast('New yarn color added. Select a stitch to paint it.');
}
function editDimensions(){
  const cols=Number($('colsInput').value),rows=Number($('rowsInput').value);
  if(!validDimensions(cols,rows)){toast('Columns must be 1–200 and rows 1–300.');return;}
  if(cols===active.cols&&rows===active.rows){toast('The dimensions have not changed.');return;}
  const old=active;
  if(!confirm(`Resize from ${old.cols} × ${old.rows} to ${cols} × ${rows}? Stitches outside the new dimensions will be removed. Row 1 stays at the bottom.`))return;
  snapshot();
  const newCells=Array(cols*rows).fill(0),newDone=Array(cols*rows).fill(0),newRows=Array(rows).fill(0);
  for(let r=1;r<=Math.min(rows,old.rows);r++){
    newRows[r-1]=old.rowDone[r-1]||0;
    for(let c=1;c<=Math.min(cols,old.cols);c++){
      const oldI=(old.rows-r)*old.cols+(c-1),newI=(rows-r)*cols+(c-1);
      newCells[newI]=old.cells[oldI];newDone[newI]=old.done[oldI];
    }
  }
  Object.assign(active,{cols,rows,cells:newCells,done:newDone,rowDone:newRows});
  if(selected&&(selected.col>cols||selected.row>rows))selected=null;
  scheduleSave();refreshInspector();fitChart();toast('Dimensions updated; Row 1 remains at the bottom.');
}
function syncImage(){
  const src=active?.referenceImage||'';
  if(src===referenceSrc)return;
  referenceSrc=src;referenceImg=null;
  if(!src){requestDraw();return;}
  const img=new Image();img.onload=()=>{if(referenceSrc===src){referenceImg=img;requestDraw();}};
  img.onerror=()=>toast('Unable to load the reference image');img.src=src;
}
function imageContainRect(img, bx,by,bw,bh){
  const ratio=Math.min(bw/img.width,bh/img.height),w=img.width*ratio,h=img.height*ratio;
  return {x:bx+(bw-w)/2,y:by+(bh-h)/2,w,h};
}
function requestDraw(){if(!drawingPending){drawingPending=true;requestAnimationFrame(()=>{drawingPending=false;draw();});}}
function resizeCanvas(){
  const rect=$('canvasWrap').getBoundingClientRect();canvasWidth=Math.max(100,rect.width);canvasHeight=Math.max(100,rect.height);
  const dpr=Math.min(devicePixelRatio||1,2),w=Math.round(canvasWidth*dpr),h=Math.round(canvasHeight*dpr);
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  requestDraw();
}
function boardWidth(){return active?active.cols*CELL+M*2:700;}
function boardHeight(){return active?active.rows*CELL+M*2:700;}
function fitChart(){
  if(!active)return;
  view.scale=clamp(Math.min((canvasWidth-30)/boardWidth(),(canvasHeight-30)/boardHeight()),.12,3.5);
  centerView();
}
function centerView(){
  view.x=(canvasWidth-boardWidth()*view.scale)/2;
  view.y=(canvasHeight-boardHeight()*view.scale)/2;
  updateZoomText();requestDraw();
}
function setZoom(scale,anchorX=canvasWidth/2,anchorY=canvasHeight/2){
  scale=clamp(scale,.12,5);
  const worldX=(anchorX-view.x)/view.scale,worldY=(anchorY-view.y)/view.scale;
  view.scale=scale;view.x=anchorX-worldX*scale;view.y=anchorY-worldY*scale;
  updateZoomText();requestDraw();
}
function updateZoomText(){$('zoomValue').textContent=Math.round(view.scale*100)+'%';}
function screenToStitch(sx,sy){
  if(!active)return null;
  const x=(sx-view.x)/view.scale-M,y=(sy-view.y)/view.scale-M;
  if(x<0||y<0||x>=active.cols*CELL||y>=active.rows*CELL)return null;
  return {col:Math.floor(x/CELL)+1,row:active.rows-Math.floor(y/CELL)};
}
function draw(){
  const dpr=Math.min(devicePixelRatio||1,2);
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#ede7f2';ctx.fillRect(0,0,canvasWidth,canvasHeight);
  if(!active)return;
  const s=view.scale,cols=active.cols,rows=active.rows,bw=cols*CELL,bh=rows*CELL;
  ctx.save();ctx.translate(view.x,view.y);ctx.scale(s,s);
  ctx.fillStyle='#fff';ctx.fillRect(M-42,M-42,bw+84,bh+84);
  const minCol=clamp(Math.floor(((-view.x/s)-M)/CELL),0,cols),maxCol=clamp(Math.ceil(((canvasWidth-view.x)/s-M)/CELL),0,cols);
  const minRow=clamp(Math.floor(((-view.y/s)-M)/CELL),0,rows),maxRow=clamp(Math.ceil(((canvasHeight-view.y)/s-M)/CELL),0,rows);
  if(referenceImg&&active.opacity>0&&!active.converted){
    const ir=imageContainRect(referenceImg,M,M,bw,bh);ctx.save();ctx.globalAlpha=active.opacity;ctx.drawImage(referenceImg,ir.x,ir.y,ir.w,ir.h);ctx.restore();
  }
  if(active.converted){
    for(let r=minRow;r<maxRow;r++)for(let c=minCol;c<maxCol;c++){
      const i=r*cols+c, color=active.palette[active.cells[i]]||DEFAULT_COLORS[0];
      ctx.fillStyle=color.hex;ctx.fillRect(M+c*CELL,M+r*CELL,CELL,CELL);
    }
    if(referenceImg&&active.opacity>0){
      const ir=imageContainRect(referenceImg,M,M,bw,bh);ctx.save();ctx.globalAlpha=active.opacity*.2;ctx.drawImage(referenceImg,ir.x,ir.y,ir.w,ir.h);ctx.restore();
    }
  }
  if(selected){
    ctx.fillStyle='rgba(124,89,206,.21)';
    ctx.fillRect(M+(selected.col-1)*CELL,M,CELL,bh);
    ctx.fillRect(M,M+(rows-selected.row)*CELL,bw,CELL);
  }
  for(let r=minRow;r<maxRow;r++){
    const rowNum=rows-r, rowMarked=active.rowDone[rowNum-1];
    for(let c=minCol;c<maxCol;c++){
      const i=r*cols+c;if(!active.done[i]&&!rowMarked)continue;
      const cx=M+c*CELL,cy=M+r*CELL;
      ctx.fillStyle='rgba(56,159,108,.34)';ctx.fillRect(cx+1,cy+1,CELL-2,CELL-2);
      if(CELL*s>=14){ctx.font='bold 13px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#176544';ctx.fillText('✓',cx+CELL/2,cy+CELL/2);}
    }
  }
  // Every grid boundary continues through the row/column-number margins.
  ctx.strokeStyle='#9c8ea7';ctx.lineWidth=0.75/s;ctx.beginPath();
  for(let c=minCol;c<=maxCol;c++){
    const x=M+c*CELL;ctx.moveTo(x,M-35);ctx.lineTo(x,M+bh+35);
  }
  for(let r=minRow;r<=maxRow;r++){
    const y=M+r*CELL;ctx.moveTo(M-35,y);ctx.lineTo(M+bw+35,y);
  }
  ctx.stroke();
  ctx.strokeStyle='#6d578e';ctx.lineWidth=1.8/s;ctx.strokeRect(M,M,bw,bh);
  if(active.converted && CELL*s>=16){
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 12px system-ui';
    for(let r=minRow;r<maxRow;r++)for(let c=minCol;c<maxCol;c++){
      const i=r*cols+c,rowNum=rows-r;
      if(active.done[i]||active.rowDone[rowNum-1])continue;
      const color=active.palette[active.cells[i]]||DEFAULT_COLORS[0];
      const rHex=parseInt(color.hex.slice(1,3),16),gHex=parseInt(color.hex.slice(3,5),16),bHex=parseInt(color.hex.slice(5,7),16);
      ctx.fillStyle=(rHex*.299+gHex*.587+bHex*.114)>145?'#312b3d':'#fff';
      ctx.fillText(color.symbol,M+(c+.5)*CELL,M+(r+.5)*CELL);
    }
  }
  if(selected){
    const x=M+(selected.col-1)*CELL,y=M+(rows-selected.row)*CELL;
    ctx.strokeStyle='#6133c8';ctx.lineWidth=2.8/s;ctx.strokeRect(x+1/s,y+1/s,CELL-2/s,CELL-2/s);
  }
  // At large zoom, show EVERY number. At fit-scale, space labels to keep them legible.
  const interval=Math.max(1,Math.ceil(15/(CELL*s)));
  const fontWorld=clamp(10/s,9,21);ctx.font=`bold ${fontWorld}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';
  const highlightedX=selected?.col-1, highlightedY=selected?rows-selected.row:-1;
  for(let c=minCol;c<maxCol;c++){
    if(c%interval!==0&&c!==highlightedX&&c!==cols-1)continue;
    const x=M+(c+.5)*CELL,num=String(c+1),chosen=c===highlightedX;
    if(chosen){ctx.fillStyle='#e9dcff';ctx.fillRect(x-11,M-34,22,20);ctx.fillRect(x-11,M+bh+14,22,20);}
    ctx.fillStyle=chosen?'#5f32bb':'#695b77';ctx.fillText(num,x,M-24);ctx.fillText(num,x,M+bh+24);
  }
  for(let r=minRow;r<maxRow;r++){
    const row=rows-r,chosen=r===highlightedY;
    if((row-1)%interval!==0&&!chosen&&row!==rows)continue;
    const y=M+(r+.5)*CELL,num=String(row);
    if(chosen){ctx.fillStyle='#e9dcff';ctx.fillRect(M-35,y-10,27,20);ctx.fillRect(M+bw+8,y-10,27,20);}
    ctx.fillStyle=chosen?'#5f32bb':'#695b77';ctx.fillText(num,M-22,y);ctx.fillText(num,M+bw+22,y);
  }
  ctx.restore();
}

canvas.addEventListener('pointerdown',ev=>{
  if(ev.button!==0&&ev.pointerType==='mouse')return;
  canvas.setPointerCapture(ev.pointerId);pointers.set(ev.pointerId,{x:ev.offsetX,y:ev.offsetY});
  if(pointers.size===1)gesture={dragged:false,wasMulti:false,lastDist:0,totalTravel:0};
  if(pointers.size===2){const ps=[...pointers.values()];gesture.wasMulti=true;gesture.lastDist=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);}
});
canvas.addEventListener('pointermove',ev=>{
  const prev=pointers.get(ev.pointerId);if(!prev)return;
  pointers.set(ev.pointerId,{x:ev.offsetX,y:ev.offsetY});
  if(pointers.size>=2){
    const ps=[...pointers.values()],dist=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);
    const midX=(ps[0].x+ps[1].x)/2,midY=(ps[0].y+ps[1].y)/2;
    if(gesture.lastDist>2)setZoom(view.scale*dist/gesture.lastDist,midX,midY);
    gesture.lastDist=dist;gesture.wasMulti=true;gesture.dragged=true;
  } else {
    const dx=ev.offsetX-prev.x,dy=ev.offsetY-prev.y;
    gesture.totalTravel+=(Math.abs(dx)+Math.abs(dy));
    if(gesture.totalTravel>5&&ev.buttons!==0){gesture.dragged=true;view.x+=dx;view.y+=dy;requestDraw();}
  }
});
function endPointer(ev){
  if(!pointers.has(ev.pointerId))return;
  if(pointers.size===1&&!gesture.dragged&&!gesture.wasMulti){
    const cell=screenToStitch(ev.offsetX,ev.offsetY);
    if(cell){selected=cell;updateSelection();requestDraw();if($('paintMode').checked)paintStitch();}
  }
  pointers.delete(ev.pointerId);if(pointers.size===0)gesture.lastDist=0;
}
canvas.addEventListener('pointerup',endPointer);canvas.addEventListener('pointercancel',ev=>pointers.delete(ev.pointerId));
canvas.addEventListener('wheel',ev=>{ev.preventDefault();const rect=canvas.getBoundingClientRect();setZoom(view.scale*(ev.deltaY<0?1.13:.885),ev.clientX-rect.left,ev.clientY-rect.top);},{passive:false});
canvas.addEventListener('keydown',ev=>{
  if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='z'){ev.preventDefault();undo();return;}
  if(!active)return;
  if(ev.key===' '&&selected){ev.preventDefault();markStitch();return;}
  const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};
  if(moves[ev.key]){ev.preventDefault();const [dc,dr]=moves[ev.key];selected={col:clamp((selected?.col||1)+dc,1,active.cols),row:clamp((selected?.row||1)+dr,1,active.rows)};updateSelection();requestDraw();}
});
window.addEventListener('keydown',ev=>{if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){ev.preventDefault();undo();}});

async function normalizeImage(file){
  if(!file.type.startsWith('image/'))throw new Error('Choose an image file.');
  if(file.size>15*1024*1024)throw new Error('Image is too large (15 MB maximum).');
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();img.src=url;await img.decode();
    const scale=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));
    const out=document.createElement('canvas');out.width=Math.max(1,Math.round(img.naturalWidth*scale));out.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const oc=out.getContext('2d');oc.fillStyle='#ffffff';oc.fillRect(0,0,out.width,out.height);oc.drawImage(img,0,0,out.width,out.height);
    // PNG keeps crisp chart lines; photographic input is resized and compressed for manageable backups.
    const usePng=file.type==='image/png'&&file.size<=2*1024*1024;
    return out.toDataURL(usePng?'image/png':'image/jpeg',.88);
  } finally {URL.revokeObjectURL(url);}
}
async function importImage(file){
  if(!file||!active)return;
  const id=active.id;
  try{
    status('Processing image…');const data=await normalizeImage(file);
    if(!projects.has(id)||active.id!==id){toast('Project changed; image import canceled.');return;}
    snapshot();active.referenceImage=data;active.converted=false;
    active.palette=DEFAULT_COLORS.map(c=>({...c}));active.cells.fill(0);
    active.opacity=.35;syncImage();scheduleSave();refreshInspector();toast('Image added below the grid. Check dimensions before converting.');
  }catch(e){toast('Image import failed: '+e.message);status('Image import failed',true);}
}
function hexRGB(rgb){return '#'+rgb.map(v=>Math.round(clamp(v,0,255)).toString(16).padStart(2,'0')).join('');}
function distSq(a,b){return (a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;}
async function convertImage(){
  if(!active?.referenceImage||!referenceImg){toast('Import an image first.');return;}
  const n=Number($('paletteSize').value),cols=active.cols,rows=active.rows,img=referenceImg;
  try{
    status('Converting image…');
    // Four rendered pixels per stitch: sample the center region, reducing grid-line contamination.
    const sampling=document.createElement('canvas');sampling.width=cols*4;sampling.height=rows*4;
    const sc=sampling.getContext('2d',{willReadFrequently:true});sc.fillStyle='#fff';sc.fillRect(0,0,sampling.width,sampling.height);
    const ir=imageContainRect(img,0,0,sampling.width,sampling.height);sc.drawImage(img,ir.x,ir.y,ir.w,ir.h);
    const pixels=sc.getImageData(0,0,sampling.width,sampling.height).data;
    const values=[];
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      let rr=0,gg=0,bb=0;
      for(let dy=1;dy<=2;dy++)for(let dx=1;dx<=2;dx++){
        const j=((r*4+dy)*sampling.width+(c*4+dx))*4;rr+=pixels[j];gg+=pixels[j+1];bb+=pixels[j+2];
      }
      values.push([rr/4,gg/4,bb/4]);
    }
    const sampleStep=Math.max(1,Math.floor(values.length/3500));
    const samples=values.filter((_,i)=>i%sampleStep===0);
    const centers=[samples[0]||[255,255,255]];
    // Deterministic farthest-first initialization; improve using k-means.
    for(let k=1;k<n;k++){
      let best=samples[0],farthest=-1;
      for(const v of samples){let d=Infinity;for(const c of centers)d=Math.min(d,distSq(v,c));if(d>farthest){farthest=d;best=v;}}
      centers.push([...best]);
    }
    for(let iteration=0;iteration<9;iteration++){
      const sums=Array.from({length:n},()=>[0,0,0,0]);
      for(const v of samples){let near=0,best=Infinity;centers.forEach((center,k)=>{const d=distSq(v,center);if(d<best){best=d;near=k;}});
        const s=sums[near];s[0]+=v[0];s[1]+=v[1];s[2]+=v[2];s[3]++;}
      for(let k=0;k<n;k++)if(sums[k][3])centers[k]=sums[k].slice(0,3).map(z=>z/sums[k][3]);
    }
    const clustered=values.map(v=>{let near=0,best=Infinity;centers.forEach((center,k)=>{const d=distSq(v,center);if(d<best){best=d;near=k;}});return near;});
    // Keep only colors actually represented, sorted by frequency for a practical legend.
    const used=Array(n).fill(0);clustered.forEach(i=>used[i]++);
    const order=used.map((count,i)=>({i,count})).filter(v=>v.count>0).sort((a,b)=>b.count-a.count);
    const indices=new Map(order.map((v,i)=>[v.i,i]));
    snapshot();active.palette=order.map((v,i)=>({hex:hexRGB(centers[v.i]),name:'Yarn color '+(i+1),symbol:SYMBOLS[i]}));
    active.cells=clustered.map(i=>indices.get(i));active.converted=true;active.opacity=0;
    scheduleSave();refreshInspector();toast(`Created a ${cols} × ${rows} chart with ${active.palette.length} colors. Verify the result.`);
  }catch(e){toast('Conversion failed: '+e.message);status('Conversion failed',true);}
}

// Portable ZIP implementation (STORE / method 0, with CRC-32). No CDN or network dependencies.
const textEncoder=new TextEncoder(),textDecoder=new TextDecoder();
const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let x=i;for(let k=0;k<8;k++)x=x&1?0xedb88320^(x>>>1):x>>>1;t[i]=x>>>0;}return t;})();
function crc32(buf){let v=0xffffffff;for(let i=0;i<buf.length;i++)v=CRC_TABLE[(v^buf[i])&255]^(v>>>8);return (v^0xffffffff)>>>0;}
function concatBytes(parts){const size=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(size);let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}return out;}
function makeZip(files){
  const locals=[],central=[];let offset=0;
  for(const [filename,body] of Object.entries(files)){
    const name=textEncoder.encode(filename),bytes=typeof body==='string'?textEncoder.encode(body):body,crc=crc32(bytes);
    const h=new Uint8Array(30+name.length),dv=new DataView(h.buffer);
    dv.setUint32(0,0x04034b50,true);dv.setUint16(4,20,true);dv.setUint16(6,0,true);dv.setUint16(8,0,true);
    dv.setUint32(14,crc,true);dv.setUint32(18,bytes.length,true);dv.setUint32(22,bytes.length,true);dv.setUint16(26,name.length,true);h.set(name,30);
    const c=new Uint8Array(46+name.length),cd=new DataView(c.buffer);
    cd.setUint32(0,0x02014b50,true);cd.setUint16(4,20,true);cd.setUint16(6,20,true);cd.setUint16(10,0,true);
    cd.setUint32(16,crc,true);cd.setUint32(20,bytes.length,true);cd.setUint32(24,bytes.length,true);cd.setUint16(28,name.length,true);
    cd.setUint32(42,offset,true);c.set(name,46);
    locals.push(h,bytes);central.push(c);offset+=h.length+bytes.length;
  }
  const directory=concatBytes(central),end=new Uint8Array(22),dv=new DataView(end.buffer);
  dv.setUint32(0,0x06054b50,true);dv.setUint16(8,central.length,true);dv.setUint16(10,central.length,true);
  dv.setUint32(12,directory.length,true);dv.setUint32(16,offset,true);
  return concatBytes([...locals,directory,end]);
}
function readZip(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files={};let i=0,count=0;
  while(i+30<=bytes.length&&view.getUint32(i,true)===0x04034b50){
    if(++count>12)throw new Error('Too many files in backup');
    const flags=view.getUint16(i+6,true),method=view.getUint16(i+8,true);
    if(flags!==0||method!==0)throw new Error('Unsupported ZIP: use a backup exported by this app');
    const checksum=view.getUint32(i+14,true),len=view.getUint32(i+18,true),size=view.getUint32(i+22,true);
    const nameLen=view.getUint16(i+26,true),extraLen=view.getUint16(i+28,true),start=i+30+nameLen+extraLen;
    if(len!==size||len>45*1024*1024||start+len>bytes.length)throw new Error('Corrupt or oversized ZIP entry');
    const name=textDecoder.decode(bytes.subarray(i+30,i+30+nameLen)),content=bytes.subarray(start,start+len);
    if(crc32(content)!==checksum)throw new Error('Backup integrity check failed (CRC-32)');
    files[name]=content;i=start+len;
  }
  return files;
}
function backupPayload(items){return {app:'dorette-crochet-studio',version:1,exportedAt:new Date().toISOString(),projects:items};}
function slug(name){return (name||'crochet-chart').trim().replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,45)||'crochet-chart';}
function download(blob,name){const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportBackup(all=false){
  flushSave();const items=all?[...projects.values()]:[active];
  if(!items.length)return;
  const payload=JSON.stringify(backupPayload(items));
  const readme=`Dorette Crochet Studio backup\nExported: ${new Date().toISOString()}\nProjects: ${items.length}\n\nRestore using the Restore backup button inside Dorette Crochet Studio.\nThis ZIP includes backup.json with project data, progress, yarn colors, and any embedded reference images.\nDo not extract or modify the ZIP before restoring. Store a copy in Google Drive.\n`;
  const bytes=makeZip({'README.txt':readme,'backup.json':payload});
  const date=new Date().toISOString().slice(0,10);
  const filename=`Dorette-${all?'All-Projects':slug(active.name)}-${date}.zip`;
  download(new Blob([bytes],{type:'application/zip'}),filename);
  toast(`Backup downloaded (${items.length} project${items.length===1?'':'s'}). Upload the ZIP to Google Drive.`);
}
function validateBackup(p){
  if(!p||typeof p!=='object'||!validDimensions(p.cols,p.rows))throw new Error('Invalid grid dimensions in backup');
  const size=p.cols*p.rows;
  if(typeof p.name!=='string'||p.name.length>120)throw new Error('Invalid project name');
  if(!Array.isArray(p.cells)||p.cells.length!==size||!Array.isArray(p.done)||p.done.length!==size||!Array.isArray(p.rowDone)||p.rowDone.length!==p.rows)throw new Error('Invalid stitch or progress data');
  if(!Array.isArray(p.palette)||p.palette.length<1||p.palette.length>12)throw new Error('Invalid yarn palette');
  if(p.palette.some(c=>!c||typeof c.hex!=='string'||!/^#[0-9a-f]{6}$/i.test(c.hex)||typeof c.name!=='string'||c.name.length>80||typeof c.symbol!=='string'||c.symbol.length>3))throw new Error('Invalid palette colors');
  if(p.cells.some(v=>!Number.isInteger(v)||v<0||v>=p.palette.length)||p.done.some(v=>v!==0&&v!==1)||p.rowDone.some(v=>v!==0&&v!==1))throw new Error('Invalid stitch values');
  if(p.referenceImage!==null&&p.referenceImage!==undefined&&(typeof p.referenceImage!=='string'||p.referenceImage.length>22*1024*1024||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(p.referenceImage)))throw new Error('Invalid reference image');
  return {id:uid(),name:p.name.trim()+' (restored)',cols:p.cols,rows:p.rows,cells:p.cells.slice(),done:p.done.slice(),rowDone:p.rowDone.slice(),
    palette:p.palette.map(c=>({hex:c.hex,name:c.name,symbol:c.symbol})),referenceImage:p.referenceImage||null,
    opacity:clamp(Number(p.opacity)||0,0,1),converted:!!p.converted,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
async function restoreBackup(file){
  if(!file)return;
  if(file.size>50*1024*1024){toast('Backup too large (50 MB maximum).');return;}
  try{
    const bytes=new Uint8Array(await file.arrayBuffer());let payload;
    if(file.name.toLowerCase().endsWith('.json'))payload=JSON.parse(textDecoder.decode(bytes));
    else{
      const zip=readZip(bytes);
      if(!zip['backup.json'])throw new Error('ZIP does not contain backup.json');
      payload=JSON.parse(textDecoder.decode(zip['backup.json']));
    }
    if(payload?.app!=='dorette-crochet-studio'||payload?.version!==1||!Array.isArray(payload.projects)||payload.projects.length<1||payload.projects.length>100)throw new Error('Not a supported Dorette backup');
    const restored=payload.projects.map(validateBackup); // Check everything BEFORE changing existing data.
    for(const p of restored){projects.set(p.id,p);await queueWrite(p);}
    selectProject(restored[0].id);toast(`Restored ${restored.length} project${restored.length===1?'':'s'} as new copies.`);
  }catch(e){toast('Could not restore: '+e.message);}
}

async function removeActiveProject(){
  if(!active||!confirm(`Delete “${active.name}” from this device? Make a backup first. This cannot be undone.`))return;
  flushSave();const id=activeId;projects.delete(id);
  if(!memoryOnly){try{await writeChain.catch(()=>{});await dbRequest('readwrite',store=>store.delete(id));}catch(e){toast('Deletion could not be saved: '+e.message);}}
  if(projects.size===0){const p=blankProject('My First Chart',79,117);projects.set(p.id,p);queueWrite(p);}
  selectProject(projects.keys().next().value);toast('Project deleted from local storage.');
}
function hookEvents(){
  $('newProjectForm').addEventListener('submit',ev=>{
    ev.preventDefault();const cols=Number($('newCols').value),rows=Number($('newRows').value);
    if(!validDimensions(cols,rows)){toast('Choose 1–200 columns and 1–300 rows.');return;}
    const p=blankProject($('newName').value,cols,rows);projects.set(p.id,p);queueWrite(p);selectProject(p.id);
    $('newProjectDetails').open=false;toast('New crochet project created.');
  });
  $('projectName').addEventListener('change',()=>{
    if(!active)return;const name=$('projectName').value.trim();if(!name){$('projectName').value=active.name;return;}
    if(name===active.name)return;snapshot();active.name=name.slice(0,70);scheduleSave();refreshInspector();refreshProjectList();
  });
  $('applyDimensions').addEventListener('click',editDimensions);
  $('zoomIn').addEventListener('click',()=>setZoom(view.scale*1.27));$('zoomOut').addEventListener('click',()=>setZoom(view.scale/1.27));
  $('fitChart').addEventListener('click',fitChart);$('resetView').addEventListener('click',centerView);
  $('markStitch').addEventListener('click',markStitch);$('markRow').addEventListener('click',markRow);$('paintStitch').addEventListener('click',paintStitch);$('addYarnColor').addEventListener('click',addYarnColor);
  $('undoButton').addEventListener('click',undo);$('undoButton').disabled=true;
  $('imageFile').addEventListener('change',ev=>{importImage(ev.target.files[0]);ev.target.value='';});
  $('imageOpacity').addEventListener('input',ev=>{if(!active)return;active.opacity=Number(ev.target.value)/100;$('opacityText').textContent=ev.target.value+'%';requestDraw();scheduleSave();});
  $('convertPhoto').addEventListener('click',convertImage);
  $('removeImage').addEventListener('click',()=>{if(!active?.referenceImage)return;snapshot();active.referenceImage=null;active.opacity=0;syncImage();scheduleSave();refreshInspector();toast('Reference image removed.');});
  for(const id of ['exportProject'])$(id).addEventListener('click',()=>exportBackup(false));
  for(const id of ['exportAll','headerExport'])$(id).addEventListener('click',()=>exportBackup(true));
  for(const id of ['headerRestore','restoreProject'])$(id).addEventListener('click',()=>$('backupFile').click());
  $('backupFile').addEventListener('change',ev=>{restoreBackup(ev.target.files[0]);ev.target.value='';});
  $('deleteProject').addEventListener('click',removeActiveProject);
  new ResizeObserver(resizeCanvas).observe($('canvasWrap'));
  window.addEventListener('beforeunload',()=>flushSave());
}
async function initialize(){
  hookEvents();
  try {db=await openDatabase();const items=await loadProjects();items.forEach(p=>projects.set(p.id,p));}
  catch(e){memoryOnly=true;status('Browser storage blocked — backups only',true);toast('Local saving is unavailable. Keep backups and use a normal browser window.');}
  if(projects.size===0){const sample=blankProject('My First Chart',79,117);projects.set(sample.id,sample);await queueWrite(sample);}
  let preferred=null;try{preferred=localStorage.getItem('dorette-active-project');}catch{}
  resizeCanvas();selectProject(projects.has(preferred)?preferred:projects.keys().next().value);
  if(!memoryOnly)status('✓ Saved on this device');
  if('serviceWorker' in navigator && location.protocol.startsWith('http'))navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
}
initialize().catch(e=>{status('Unable to open workspace',true);toast(e.message);});
})();
