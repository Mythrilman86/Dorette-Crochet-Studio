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
const FULL_CROP = Object.freeze({left:0,top:0,right:1,bottom:1});
const DEFAULT_CONVERSION = Object.freeze({mode:'print',brightness:0,contrast:24,whiteThreshold:151,colorSensitivity:33,detail:58});
const PRINT_PALETTE = Object.freeze([
  {hex:'#221d25',name:'Dark background',symbol:'A'},
  {hex:'#f5f1e9',name:'Light lettering / stripes',symbol:'B'},
  {hex:'#da4852',name:'Flag red',symbol:'C'},
  {hex:'#303f86',name:'Flag blue',symbol:'D'}
]);
const GRAYSCALE_PALETTE = Object.freeze([
  {hex:'#1f1f1f',name:'Black',symbol:'A'},
  {hex:'#9b9b9b',name:'Gray',symbol:'B'},
  {hex:'#f5f5f5',name:'White',symbol:'C'}
]);
const refs = {};
let db = null, memoryOnly = false, projects = new Map(), activeId = null, active = null;
let selected = null, undoStack = [], redoStack = [], areaSelection = null, areaStart = null, stitchClipboard = null, patternRenderTimer = null, saveTimer = null, writeChain = Promise.resolve();
let toastTimer = null, referenceImg = null, referenceSrc = '', canvasWidth = 800, canvasHeight = 480;
let pendingConversion = null, cropPreviewRect = null, cropGesture = null, comparisonResults = null, textPreview = null;
const view = {scale:1, x:0, y:0}, pointers = new Map();
let gesture = {dragged:false,wasMulti:false,lastDist:0,totalTravel:0};
let drawingPending = false;
const EDIT_TOOLS = ['select','paint','erase','pick','pan','rect','bucket','area','paste'];
let editorTool = 'select', paintStroke = null;
const canvas = $('chartCanvas'), ctx = canvas.getContext('2d', {alpha:false});

function uid() { return crypto.randomUUID ? crypto.randomUUID() : 'p-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2); }
function blankProject(name, cols, rows) {
  return {id:uid(),name:name.trim()||'Untitled Chart', cols,rows, cells:Array(cols*rows).fill(0),
    done:Array(cols*rows).fill(0), rowDone:Array(rows).fill(0), palette:DEFAULT_COLORS.map(c=>({...c})),
    referenceImage:null,opacity:0.35,photoCrop:{...FULL_CROP},imagePlacement:'contain',conversionSettings:{...DEFAULT_CONVERSION},converted:false,workDirection:{first:'rtl',alternate:true},guide:{row:1,position:0},gauge:{swatchStitches:100,swatchYards:0,overage:10},yarnInfo:[],checkpoints:[],ui:{showProgress:true,patternLock:false,stylusOnly:false,largeTouch:false},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
function clamp(n,min,max) {return Math.min(max,Math.max(min,n));}
function validDimensions(cols,rows) {return Number.isInteger(cols)&&Number.isInteger(rows)&&cols>=1&&cols<=MAX_COLS&&rows>=1&&rows<=MAX_ROWS;}
function indexFor(col,row) { return (active.rows-row)*active.cols+(col-1); }
function format(n) {return n.toLocaleString('en-US');}
function currentCrop(p=active){
  const c=p?.photoCrop;
  if(!c||!Number.isFinite(c.left)||!Number.isFinite(c.top)||!Number.isFinite(c.right)||!Number.isFinite(c.bottom)||c.right-c.left<.08-1e-9||c.bottom-c.top<.08-1e-9)return {...FULL_CROP};
  return {left:clamp(c.left,0,.92),top:clamp(c.top,0,.92),right:clamp(c.right,.08,1),bottom:clamp(c.bottom,.08,1)};
}
function discardPreview(redraw=true){
  const resized=!!pendingConversion && active && (pendingConversion.cols!==active.cols || pendingConversion.rows!==active.rows);
  pendingConversion=null;comparisonResults=null;
  const box=$('conversionPreview');if(box)box.hidden=true;
  if(active){updateSelection();updateLegend();updateChartSubtitle();}
  if(redraw){if(resized)fitChart();else requestDraw();}
}
function conversionSettings(p=active){
  const s=p?.conversionSettings||{};
  const mode=s.mode==='auto'||s.mode==='grayscale'?s.mode:'print';
  return {...DEFAULT_CONVERSION,...s,mode};
}
function uiSettings(p=active){
  const u=p?.ui||{};
  return {showProgress:u.showProgress!==false,patternLock:!!u.patternLock,stylusOnly:!!u.stylusOnly,largeTouch:!!u.largeTouch};
}
function isPatternLocked(){return uiSettings().patternLock;}
function editBlocked(action='edit the chart'){
  if(!isPatternLocked())return false;
  toast('Unlock Pattern lock to '+action+'.');
  return true;
}
function displayDimensions(){
  const preview=pendingConversion?.projectId===active?.id?pendingConversion:null;
  return {cols:preview?.cols??active?.cols??79,rows:preview?.rows??active?.rows??117};
}
function updateChartSubtitle(){
  if(!active)return;
  const d=displayDimensions(),preview=!!pendingConversion;
  $('chartSubtitle').textContent=`${d.cols} columns × ${d.rows} rows • Row 1 begins at the bottom${preview?' • PREVIEW ONLY':''}`;
}
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
  queuePatternRender();
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
  flushSave();discardPreview(false); textPreview=null; activeId=id;active=projects.get(id);window.DorettePattern.ensure(active);selected=null;undoStack=[];redoStack=[];areaSelection=null;
  $('undoButton').disabled=true;$('redoButton').disabled=true;updateAreaStatus();
  try {localStorage.setItem('dorette-active-project',id);}catch{}
  syncImage();refreshProjectList();refreshInspector();fitChart();
}
function updateReferenceActions(){
  if(!active)return;
  const hasSource=!!active.referenceImage;
  // Preview and Compare are *actions* even when source photo is missing:
  // they guide the user into reattaching it rather than appearing broken.
  $('convertPhoto').disabled=false;
  $('compareSizes').disabled=false;
  $('convertPhoto').textContent=hasSource?'Preview stitches':'Add photo to preview';
  $('compareSizes').textContent=hasSource?'Compare 79 × 117 vs 120 × 165':'Add photo to compare sizes';
  $('removeImage').disabled=!hasSource;
  const notice=$('sourcePhotoNotice');
  notice.hidden=hasSource;
  if(!hasSource){
    notice.textContent=active.converted||active.cells.some(v=>v!==0)
      ? 'This project has saved stitch colors, but no source photograph is attached. To create a new conversion, select the original photo again. Your stitch colors and completed progress will be kept until you explicitly apply a new chart.'
      : 'To turn a picture into stitches, import the original photograph. You can also tap “Add photo to preview” below.';
  }
}
function requestSourcePhoto(action){
  toast(`Select the original photo to ${action}. Existing stitch colors will stay unchanged.`);
  $('imageFile').click();
}
function refreshInspector(){
  if (!active)return;
  $('workspaceTitle').textContent=active.name;$('projectName').value=active.name;
  updateChartSubtitle();
  $('colsInput').value=active.cols;$('rowsInput').value=active.rows;
  $('imageOpacity').value=Math.round(active.opacity*100);$('opacityText').textContent=Math.round(active.opacity*100)+'%';
  updateReferenceActions();
  updateCropControls();updateConversionControls();
  updateSelection();updateProgress();updateDashboard();updateLegend();updateTabletControls();updateTextControls();updatePdfEstimate();refreshPatternPanels();requestDraw();
}
function undoState(){
  return {name:active.name,cols:active.cols,rows:active.rows,cells:active.cells.slice(),done:active.done.slice(),rowDone:active.rowDone.slice(),palette:active.palette.map(p=>({...p})),referenceImage:active.referenceImage,
    opacity:active.opacity,photoCrop:{...currentCrop()},imagePlacement:active.imagePlacement||'contain',conversionSettings:{...conversionSettings()},converted:active.converted,
    workDirection:{...active.workDirection},guide:{...active.guide},gauge:{...active.gauge},yarnInfo:structuredClone(active.yarnInfo),checkpoints:structuredClone(active.checkpoints),ui:{...uiSettings(active)}};
}
function snapshot(){
  if(!active)return;
  undoStack.push(undoState());if(undoStack.length>30)undoStack.shift();
  redoStack=[];$('undoButton').disabled=false;$('redoButton').disabled=true;
}
function restoreUndoState(state){
  discardPreview(false);clearTextPreview();Object.assign(active,state);window.DorettePattern.ensure(active);
  if(selected&&(selected.col>active.cols||selected.row>active.rows))selected=null;
  syncImage();scheduleSave();refreshInspector();refreshProjectList();
}
function undo(){
  if(!active||!undoStack.length||editBlocked("undo changes"))return;
  redoStack.push(undoState());restoreUndoState(undoStack.pop());
  $('undoButton').disabled=!undoStack.length;$('redoButton').disabled=false;toast('Undone — use Redo to restore.');
}
function redo(){
  if(!active||!redoStack.length||editBlocked("redo changes"))return;
  undoStack.push(undoState());restoreUndoState(redoStack.pop());
  $('undoButton').disabled=false;$('redoButton').disabled=!redoStack.length;toast('Change redone.');
}
function updateSelection(){
  if(pendingConversion){$('selectedCell').textContent='Preview only — apply or discard to edit';$('markStitch').disabled=true;$('markRow').disabled=true;$('paintStitch').disabled=true;updateDashboard();return;}
  if(!selected){$('selectedCell').textContent='Tap any square to begin';$('markStitch').disabled=true;$('markRow').disabled=true;$('paintStitch').disabled=true;updateDashboard();return;}
  const i=indexFor(selected.col,selected.row),d=!!active.done[i]||!!active.rowDone[selected.row-1];
  $('selectedCell').textContent=`Row ${selected.row} · Column ${selected.col} ${d?'· Complete':''}`;
  $('instructionRow').value=selected.row;queuePatternRender();
  $('markStitch').disabled=false;$('markRow').disabled=false;$('paintStitch').disabled=false;
  $('markStitch').textContent=d?'↶ Unmark stitch':'✓ Mark stitch';
  $('markRow').textContent=active.rowDone[selected.row-1]?'↶ Unmark row':'✓ Mark row';
  updateDashboard();
}
function completionCounts(project=active){
  if(!project)return {done:0,total:0,rowsDone:0};
  let done=0;
  for(let i=0;i<project.done.length;i++){
    const fromTop=Math.floor(i/project.cols),row=project.rows-fromTop;
    if(project.done[i]||project.rowDone[row-1])done++;
  }
  return {done,total:project.cols*project.rows,rowsDone:project.rowDone.filter(Boolean).length};
}
function updateProgress(){
  if(!active)return;
  const {done,total}=completionCounts(active),pct=Math.round(done/total*100);
  $('progressText').textContent=`${format(done)} / ${format(total)} stitches`;
  $('progressPercent').textContent=pct+'%';$('progressBar').style.width=pct+'%';
  updateDashboard();
}
function updateDashboard(){
  if(!active)return;
  const {done,total,rowsDone}=completionCounts(active);
  $('dashCompleted').textContent=format(done);
  $('dashRemaining').textContent=format(Math.max(0,total-done));
  $('dashRows').textContent=`${rowsDone} / ${active.rows}`;
  $('dashColors').textContent=String(active.palette.length);
  $('dashLastCell').textContent=selected?`R${selected.row} · C${selected.col}`:'None';
  const g=active.guide||{row:1,position:0};
  $('dashGuide').textContent=`Row ${g.row} · Stitch ${g.position+1}`;
}
function updateTabletControls(){
  if(!active)return;
  const ui=uiSettings();
  $('patternLock').checked=ui.patternLock;
  $('stylusOnly').checked=ui.stylusOnly;
  $('largeTouch').checked=ui.largeTouch;
  $('showProgressOverlay').checked=ui.showProgress;
  document.body.classList.toggle('large-touch',ui.largeTouch);
}
function updateTextControls(){
  if(!active)return;
  const maxCol=active.cols,maxRow=active.rows;
  $('textCol').max=String(maxCol);
  $('textRow').max=String(maxRow);
  const tc=$('textColor'),prev=tc.value;
  tc.replaceChildren();
  active.palette.forEach((c,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=`${c.symbol} · ${c.name}`;tc.append(o);});
  tc.value=prev!==''&&active.palette[Number(prev)]?prev:$('paintColor').value||'0';
  if(textPreview)buildTextPreview();
}
function updateToolUI(){
  const preview = !!pendingConversion, locked=isPatternLocked();
  for(const tool of EDIT_TOOLS){
    const button=$('tool'+tool[0].toUpperCase()+tool.slice(1));
    button.classList.toggle('active',editorTool===tool);
    button.setAttribute('aria-pressed',String(editorTool===tool));
    button.disabled=preview || (locked && !['select','pan'].includes(tool));
  }
  const hints={
    select:'Select a stitch to highlight its row and column. Drag to move the chart.',
    paint:'Tap or drag over stitches to paint with the selected yarn color. One Undo reverses the entire stroke.',
    erase:'Tap or drag to restore the first yarn color (background). One Undo reverses the entire stroke.',
    pick:'Tap a stitch to sample its color, then paint with that color.',
    pan:'Drag to move the chart; pinch or use +/- to zoom.',
    rect:'Drag from one corner to another to paint a filled rectangle with the selected color.',
    bucket:'Tap a region to replace connected stitches of the same color.',
    area:'Drag across the chart to select an area, then Copy or Fill it.',
    paste:'Tap the target top-left square to paste the copied colors; color matches use hex values.'
  };
  $('editorHint').textContent=preview?'Preview only — apply or discard the conversion before editing individual stitches.':locked?'Pattern lock is on. Progress tools still work, but stitch-color editing is blocked until you unlock it.':hints[editorTool];
  canvas.style.cursor=editorTool==='pan'?'grab':editorTool==='pick'?'copy':'crosshair';
  const chosen=Number($('paintColor').value);
  for(const chip of $('quickPalette').querySelectorAll('button')){
    chip.setAttribute('aria-pressed',String(editorTool==='paint'&&Number(chip.dataset.index)===chosen));
    chip.classList.toggle('chosen',editorTool==='paint'&&Number(chip.dataset.index)===chosen);
    chip.disabled=preview||locked;
  }
  $('paintStitch').disabled=preview||!selected||locked;
  $('addYarnColor').disabled=!!preview||active.palette.length>=12||locked;
  $('fillArea').disabled=locked||preview;
  $('copyArea').disabled=preview;
  $('saveCheckpoint').disabled=preview;
  $('restoreCheckpoint').disabled=active.checkpoints?.length===0;
  $('applyText').disabled=locked||preview;
}
function setTool(tool){
  if(!EDIT_TOOLS.includes(tool))return;
  if(pendingConversion){toast('Apply or discard the preview before editing stitches.');return;}
  if(isPatternLocked() && !['select','pan'].includes(tool)){editBlocked('use editing tools');return;}
  editorTool=tool;
  updateToolUI();updateTextControls();updateDashboard();
}
function selectPaintColor(index,activate=true){
  if(!active||pendingConversion||!Number.isInteger(index)||index<0||index>=active.palette.length)return;
  $('paintColor').value=String(index);
  if(activate && !isPatternLocked())editorTool='paint';
  $('textColor').value=String(index);
  updateToolUI();
}
function updateLegend(){
  if(!active)return;
  const preview=pendingConversion?.projectId===active.id?pendingConversion:null;
  const palette=preview?.palette||active.palette, cells=preview?.cells||active.cells;
  const counts=palette.map(()=>0);
  cells.forEach(i=>{if(Number.isInteger(i)&&i>=0&&i<counts.length)counts[i]++;});
  $('totalColors').textContent=palette.length;
  const colorSelect=$('paintColor'),current=Number(colorSelect.value);
  colorSelect.replaceChildren();
  palette.forEach((c,i)=>{const o=document.createElement('option');o.value=i;o.textContent=c.symbol+' · '+c.name+' ('+c.hex+')';colorSelect.append(o);});
  colorSelect.value=String(current>=0&&current<palette.length?current:0);
  $('addYarnColor').disabled=!!preview||active.palette.length>=12;
  const quickPalette=$('quickPalette');quickPalette.replaceChildren();
  palette.forEach((color,index)=>{
    const chip=document.createElement('button');chip.type='button';chip.className='yarn-chip';
    chip.dataset.index=String(index);chip.style.setProperty('--yarn',color.hex);
    const rgb=[1,3,5].map(pos=>parseInt(color.hex.slice(pos,pos+2),16));
    const lightness=rgb[0]*.299+rgb[1]*.587+rgb[2]*.114;
    if(lightness>156){chip.style.color='#362b44';chip.style.textShadow='none';}
    chip.title=`${color.symbol}: ${color.name} (${color.hex}) — ${format(counts[index])} stitches`;
    chip.setAttribute('aria-label',`Paint with ${color.name}, color ${color.symbol}`);
    chip.textContent=color.symbol;chip.addEventListener('click',()=>selectPaintColor(index));
    quickPalette.append(chip);
  });
  const legend=$('legend');legend.replaceChildren();
  palette.forEach((c,i)=>{
    const item=document.createElement('div');item.className='legend-row';
    const sw=document.createElement('span');sw.className='swatch';sw.style.background=c.hex;
    const symbol=document.createElement('span');symbol.className='symbol';symbol.textContent=c.symbol;
    const name=document.createElement('span');name.className='legend-name';name.textContent=c.name+' '+c.hex;
    const count=document.createElement('strong');count.className='legend-count';count.textContent=format(counts[i]);
    item.append(sw,symbol,name,count);legend.append(item);
  });
  updateToolUI();
}
function markStitch(){
  if(pendingConversion||!selected||!active)return;
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
  if(pendingConversion||!selected||!active)return;
  snapshot();active.rowDone[selected.row-1]=active.rowDone[selected.row-1]?0:1;
  scheduleSave();updateSelection();updateProgress();requestDraw();
}
function paintStitch(){
  if(pendingConversion||!selected||!active||editBlocked('paint stitches'))return;
  const color=Number($('paintColor').value),i=indexFor(selected.col,selected.row);
  if(!Number.isInteger(color)||color<0||color>=active.palette.length)return;
  if(active.cells[i]===color)return;
  snapshot();active.cells[i]=color;active.converted=true;
  scheduleSave();updateLegend();requestDraw();
}
function applyBrushCell(cell,stroke){
  if(!cell||!stroke||!active||pendingConversion||isPatternLocked())return false;
  const color=stroke.tool==='erase'?0:stroke.color;
  if(!Number.isInteger(color)||color<0||color>=active.palette.length)return false;
  const i=indexFor(cell.col,cell.row);
  if(active.cells[i]===color)return false;
  if(!stroke.snapshotted){snapshot();stroke.snapshotted=true;}
  active.cells[i]=color;
  active.converted=true;
  stroke.changed=true;
  return true;
}
function brushSegment(from,to,stroke){
  if(!from||!to||!stroke)return;
  // Grid-space Bresenham traversal prevents gaps during fast finger/stylus movement.
  let x=from.col,y=from.row;const x1=to.col,y1=to.row;
  const dx=Math.abs(x1-x),dy=Math.abs(y1-y),sx=x<x1?1:-1,sy=y<y1?1:-1;
  let error=dx-dy,changed=false;
  while(true){changed=applyBrushCell({col:x,row:y},stroke)||changed;
    if(x===x1&&y===y1)break;
    const e2=2*error;
    if(e2>-dy){error-=dy;x+=sx;}
    if(e2<dx){error+=dx;y+=sy;}
  }
  selected=to;
  if(changed){scheduleSave();updateLegend();}
  updateSelection();requestDraw();
}
function addYarnColor(){
  if(pendingConversion||editBlocked('add yarn colors'))return;
  if(!active||active.palette.length>=12){toast('Up to 12 yarn colors are supported.');return;}
  const hex=$('newHex').value;
  snapshot();const index=active.palette.length;
  active.palette.push({hex,name:'Yarn color '+(index+1),symbol:SYMBOLS[index]});
  scheduleSave();updateLegend();updateTextControls();renderYarnInventory();$('paintColor').value=String(index);toast('New yarn color added. Select a stitch to paint it.');
}
function editDimensions(){
  if(!active||editBlocked("resize the chart"))return;
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
  window.DorettePattern.ensure(active);active.guide.row=clamp(active.guide.row,1,rows);active.guide.position=clamp(active.guide.position,0,cols-1);
  discardPreview(false);scheduleSave();refreshInspector();fitChart();toast('Dimensions updated; Row 1 remains at the bottom.');
}
function syncImage(){
  const src=active?.referenceImage||'';
  if(src===referenceSrc)return;
  referenceSrc=src;referenceImg=null;
  if(!src){drawCropPreview();requestDraw();return;}
  const img=new Image();img.onload=()=>{if(referenceSrc===src){referenceImg=img;drawCropPreview();updateCropStats();requestDraw();}};
  img.onerror=()=>toast('Unable to load the reference image');img.src=src;
}
function imageContainRect(img, bx,by,bw,bh){
  const ratio=Math.min(bw/img.width,bh/img.height),w=img.width*ratio,h=img.height*ratio;
  return {x:bx+(bw-w)/2,y:by+(bh-h)/2,w,h};
}
function renderCroppedImage(target,img,x,y,w,h){
  const crop=currentCrop(),sx=crop.left*img.width,sy=crop.top*img.height;
  const sw=(crop.right-crop.left)*img.width,sh=(crop.bottom-crop.top)*img.height;
  let dest={x,y,w,h};
  if(active?.imagePlacement!=='stretch')dest=imageContainRect({width:sw,height:sh},x,y,w,h);
  target.drawImage(img,sx,sy,sw,sh,dest.x,dest.y,dest.w,dest.h);
  return dest;
}
function updateCropControls(){
  const panel=$('photoCropPanel');if(!panel||!active)return;
  panel.hidden=!active.referenceImage;
  const c=currentCrop();
  for(const [id,value] of Object.entries({cropLeft:c.left,cropRight:1-c.right,cropTop:c.top,cropBottom:1-c.bottom})){
    const percent=String(Math.round(value*100));
    $(id).value=percent;
    // Keep the current typing session intact; update it on commit/blur.
    if(document.activeElement!==$(id+'Number'))$(id+'Number').value=percent;
  }
  $('imagePlacement').value=active.imagePlacement==='stretch'?'stretch':'contain';
  updateCropStats();drawCropPreview();
}
function updateCropStats(){
  if(!active||!referenceImg)return;
  const c=currentCrop(),w=(c.right-c.left)*referenceImg.width,h=(c.bottom-c.top)*referenceImg.height;
  const chartRatio=active.cols/active.rows,cropRatio=w/h;
  const delta=Math.round(Math.abs(1-chartRatio/cropRatio)*100);
  $('cropStats').textContent=active.imagePlacement==='stretch'
    ? `The cropped artwork will fill all ${active.cols} × ${active.rows} cells. Its shape may be stretched (${delta}% approximate aspect-ratio difference).`
    : `Artwork proportions preserved. The chart may have blank margins (${delta}% approximate aspect-ratio difference).`;
}
function drawCropPreview(){
  const cv=$('cropPreview');if(!cv)return;
  const g=cv.getContext('2d'),W=cv.width,H=cv.height;
  g.fillStyle='#f4f0f7';g.fillRect(0,0,W,H);cropPreviewRect=null;
  if(!referenceImg||!active?.referenceImage)return;
  const ir=imageContainRect(referenceImg,10,10,W-20,H-20);cropPreviewRect=ir;
  g.drawImage(referenceImg,ir.x,ir.y,ir.w,ir.h);
  const c=currentCrop(),x=ir.x+c.left*ir.w,y=ir.y+c.top*ir.h,w=(c.right-c.left)*ir.w,h=(c.bottom-c.top)*ir.h;
  g.fillStyle='rgba(21,13,33,.57)';
  g.fillRect(ir.x,ir.y,ir.w,y-ir.y);g.fillRect(ir.x,y,x-ir.x,h);
  g.fillRect(x+w,y,(ir.x+ir.w)-(x+w),h);g.fillRect(ir.x,y+h,ir.w,(ir.y+ir.h)-(y+h));
  g.strokeStyle='#fff';g.lineWidth=4;g.strokeRect(x,y,w,h);g.strokeStyle='#6c3ab0';g.lineWidth=2;g.strokeRect(x,y,w,h);
  for(const [px,py] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]]){
    g.fillStyle='#fff';g.fillRect(px-7,py-7,14,14);g.strokeStyle='#6c3ab0';g.lineWidth=2;g.strokeRect(px-7,py-7,14,14);
  }
}
function setCropEdge(edge,value){
  if(!active)return;
  const c=currentCrop();const min=.08;
  if(edge==='left')c.left=clamp(value,0,c.right-min);
  if(edge==='right')c.right=clamp(value,c.left+min,1);
  if(edge==='top')c.top=clamp(value,0,c.bottom-min);
  if(edge==='bottom')c.bottom=clamp(value,c.top+min,1);
  active.photoCrop=c;discardPreview(false);scheduleSave();updateCropControls();requestDraw();
}
function requestDraw(){if(!drawingPending){drawingPending=true;requestAnimationFrame(()=>{drawingPending=false;draw();});}}
function resizeCanvas(){
  const rect=$('canvasWrap').getBoundingClientRect(),oldWidth=canvasWidth,oldHeight=canvasHeight;
  canvasWidth=Math.max(100,rect.width);canvasHeight=Math.max(100,rect.height);
  // Preserve the stitch under the viewport center when layout or orientation changes.
  if(active){view.x+=(canvasWidth-oldWidth)/2;view.y+=(canvasHeight-oldHeight)/2;}
  const dpr=Math.min(devicePixelRatio||1,2),w=Math.round(canvasWidth*dpr),h=Math.round(canvasHeight*dpr);
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  requestDraw();
}
function boardWidth(){return active?displayDimensions().cols*CELL+M*2:700;}
function boardHeight(){return active?displayDimensions().rows*CELL+M*2:700;}
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
  if(pendingConversion)return null;
  const x=(sx-view.x)/view.scale-M,y=(sy-view.y)/view.scale-M;
  if(x<0||y<0||x>=active.cols*CELL||y>=active.rows*CELL)return null;
  return {col:Math.floor(x/CELL)+1,row:active.rows-Math.floor(y/CELL)};
}
function previewTextConfig(){
  return {
    text:($('textInput').value||'').slice(0,40),
    orientation:$('textOrientation').value==='vertical'?'vertical':'horizontal',
    height:$('textScale').valueAsNumber,
    col:clamp(Number($('textCol').value)||1,1,active?.cols||1),
    row:clamp(Number($('textRow').value)||1,1,active?.rows||1),
    color:clamp(Number($('textColor').value)||0,0,Math.max(0,(active?.palette.length||1)-1))
  };
}
const stitchGlyphs={
  "0": [7, 5, 5, 5, 7],
  "1": [2, 6, 2, 2, 7],
  "2": [7, 1, 2, 4, 7],
  "3": [7, 1, 3, 1, 7],
  "4": [5, 5, 7, 1, 1],
  "5": [7, 4, 6, 1, 7],
  "6": [7, 4, 6, 5, 7],
  "7": [7, 1, 1, 1, 1],
  "8": [7, 5, 7, 5, 7],
  "9": [7, 5, 7, 1, 7],
  "A": [2, 5, 7, 5, 5],
  "B": [6, 5, 6, 5, 6],
  "C": [3, 1, 1, 1, 3],
  "D": [6, 5, 5, 5, 6],
  "E": [7, 4, 6, 4, 7],
  "F": [7, 4, 6, 4, 4],
  "G": [3, 4, 5, 5, 3],
  "H": [5, 5, 7, 5, 5],
  "I": [7, 2, 2, 2, 7],
  "J": [1, 1, 1, 5, 2],
  "K": [5, 5, 6, 5, 5],
  "L": [4, 4, 4, 4, 7],
  "M": [5, 7, 7, 5, 5],
  "N": [5, 7, 7, 7, 5],
  "O": [15, 9, 9, 9, 15],
  "P": [6, 5, 6, 4, 4],
  "Q": [7, 5, 5, 7, 3],
  "R": [6, 5, 6, 5, 5],
  "S": [3, 4, 6, 1, 6],
  "T": [7, 2, 2, 2, 2],
  "U": [5, 5, 5, 5, 7],
  "V": [5, 5, 5, 5, 2],
  "W": [5, 5, 7, 7, 5],
  "X": [5, 5, 2, 5, 5],
  "Y": [5, 5, 2, 2, 2],
  "Z": [7, 1, 2, 4, 7],
  " ": [0, 0, 0, 0, 0],
  "!": [2, 2, 2, 0, 2],
  "?": [7, 1, 2, 0, 2],
  ".": [0, 0, 0, 0, 2],
  "-": [0, 0, 7, 0, 0]
};
function rasterizeTextPattern(config){
  const text=String(config.text||'').trim();
  if(!text)return null;
  const letters=Array.from(text.toUpperCase());
  const vertical=config.orientation==='vertical';
  const glyphs=letters.map(letter=>{
    const bits=stitchGlyphs[letter];
    if(!bits)return rasterizeSymbol(letter);
    const width=letter==='O'?4:3;
    const occupied=[];
    bits.forEach((row,y)=>{
      for(let x=0;x<width;x++)if(row & (1 << (width-1-x)))occupied.push({x,y});
    });
    return {width,height:5,occupied};
  });
  const gap=Math.round(config.height/5);
  const widths=glyphs.map(glyph=>Math.max(1,Math.round(glyph.width*config.height/glyph.height)));
  const width=vertical?Math.max(...widths):widths.reduce((sum,w)=>sum+w,0)+gap*(glyphs.length-1);
  const height=vertical?glyphs.length*(config.height+gap)-gap:config.height;
  if(width>active.cols-config.col+1||height>config.row)return {width,height,tooLarge:true};
  const occupied=[];
  let offset=0;
  glyphs.forEach((glyph,index)=>{
    const width=widths[index];
    const source=new Set(glyph.occupied.map(({x,y})=>y*glyph.width+x));
    if(glyph.height>config.height){
      for(let row=0;row<config.height;row++)for(let col=0;col<width;col++){
        const x=Math.floor((col+.5)*glyph.width/width),y=Math.floor((row+.5)*glyph.height/config.height);
        if(source.has(y*glyph.width+x))occupied.push({x:col+(vertical?0:offset),y:row+(vertical?index*(config.height+gap):0)});
      }
      offset+=width+gap;
      return;
    }
    for(const {x,y} of glyph.occupied){
      const left=Math.round(x*width/glyph.width),right=Math.round((x+1)*width/glyph.width);
      const top=Math.round(y*config.height/glyph.height),bottom=Math.round((y+1)*config.height/glyph.height);
      for(let row=top;row<bottom;row++)for(let col=left;col<right;col++){
        occupied.push({x:col+(vertical?0:offset),y:row+(vertical?index*(config.height+gap):0)});
      }
    }
    offset+=width+gap;
  });
  return {width,height,occupied};
}
function rasterizeSymbol(text){
  const cellPx=1, fontSize=40, pad=8;
  const off=document.createElement('canvas'),g=off.getContext('2d');
  g.font=`900 ${fontSize}px system-ui, sans-serif`;
  const lines=[text];
  const widths=lines.map(line=>Math.ceil(g.measureText(line).width));
  off.width=Math.max(8,Math.max(...widths)+pad*2);
  off.height=Math.max(8,lines.length*(fontSize+pad)+pad);
  const ctx2=off.getContext('2d');
  ctx2.clearRect(0,0,off.width,off.height);
  ctx2.font=`900 ${fontSize}px system-ui, sans-serif`;
  ctx2.fillStyle='#000';ctx2.textAlign='left';ctx2.textBaseline='top';
  lines.forEach((line,i)=>ctx2.fillText(line,pad,pad+i*(fontSize+pad/2)));
  const cols=Math.max(1,Math.ceil(off.width/cellPx)),rows=Math.max(1,Math.ceil(off.height/cellPx));
  const pixels=ctx2.getImageData(0,0,off.width,off.height).data,occupied=[];
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    let alpha=0,count=0;
    for(let y=r*cellPx;y<Math.min(off.height,(r+1)*cellPx);y++)for(let x=c*cellPx;x<Math.min(off.width,(c+1)*cellPx);x++){
      alpha+=pixels[(y*off.width+x)*4+3];count++;
    }
    if(count&&alpha/(count*255)>.18)occupied.push({x:c,y:r});
  }
  if(!occupied.length)return {width:3,height:5,occupied:[]};
  const left=Math.min(...occupied.map(p=>p.x)),top=Math.min(...occupied.map(p=>p.y));
  const right=Math.max(...occupied.map(p=>p.x)),bottom=Math.max(...occupied.map(p=>p.y));
  return {width:right-left+1,height:bottom-top+1,occupied:occupied.map(p=>({x:p.x-left,y:p.y-top}))};
}
function buildTextPreview(){
  if(!active)return null;
  const feedback=$('textFitStatus');
  feedback.textContent='';
  const config=previewTextConfig();
  if(!Number.isInteger(config.height)||config.height<5||config.height>100){
    feedback.textContent='Enter a whole letter height from 5 to 100 stitches.';
    textPreview={...config,cells:[]};
    requestDraw();
    return textPreview;
  }
  const mask=rasterizeTextPattern(config);
  if(!mask){textPreview=null;requestDraw();return null;}
  if(mask.tooLarge||mask.occupied.some(pt=>config.col+pt.x>active.cols||config.row-pt.y<1)){
    feedback.textContent=`Text needs ${mask.width} × ${mask.height} stitches. Only ${active.cols-config.col+1} × ${config.row} are available here. Reduce the height, move the text, or use a larger chart.`;
    textPreview={...config,cells:[]};
    requestDraw();
    return textPreview;
  }
  feedback.textContent=`Text size: ${mask.width} × ${mask.height} stitches.`;
  const cells=[];
  for(const pt of mask.occupied){
    const col=config.col+pt.x,row=config.row-pt.y;
    if(col>=1&&col<=active.cols&&row>=1&&row<=active.rows)cells.push({col,row});
  }
  textPreview={...config,width:mask.width,height:mask.height,cells};
  requestDraw();
  return textPreview;
}
function clearTextPreview(){textPreview=null;$('textFitStatus').textContent='';requestDraw();}
function drawTextPreviewOverlay(ctx,preview,cols,rows){
  const color=active.palette[preview.color]||active.palette[0]||DEFAULT_COLORS[0];
  ctx.save();
  ctx.fillStyle=color.hex+'88';
  for(const cell of preview.cells){
    const x=M+(cell.col-1)*CELL,y=M+(rows-cell.row)*CELL;
    ctx.fillRect(x+2,y+2,CELL-4,CELL-4);
  }
  ctx.strokeStyle='#6133c8';ctx.lineWidth=1.4/Math.max(.4,view.scale);
  if(preview.cells.length){
    const left=Math.min(...preview.cells.map(c=>c.col)),right=Math.max(...preview.cells.map(c=>c.col));
    const top=Math.max(...preview.cells.map(c=>c.row)),bottom=Math.min(...preview.cells.map(c=>c.row));
    ctx.setLineDash([6/Math.max(.4,view.scale),4/Math.max(.4,view.scale)]);
    ctx.strokeRect(M+(left-1)*CELL,M+(rows-top)*CELL,(right-left+1)*CELL,(top-bottom+1)*CELL);
    ctx.setLineDash([]);
  }
  ctx.restore();
}
function applyTextPreview(){
  if(!active||pendingConversion||editBlocked('apply text to the chart'))return;
  const preview=buildTextPreview();
  if(!preview||!preview.cells.length)return toast($('textFitStatus').textContent||'Enter some text first.');
  if(!preview.cells.some(cell=>active.cells[indexFor(cell.col,cell.row)]!==preview.color)){
    return toast('That text preview would not change any stitches.');
  }
  let changed=0; snapshot();
  for(const cell of preview.cells){
    const i=indexFor(cell.col,cell.row);
    if(active.cells[i]!==preview.color){active.cells[i]=preview.color;changed++;}
  }
  clearTextPreview();
  active.converted=true; scheduleSave(); updateLegend(); updateSelection(); requestDraw(); toast(`Applied ${changed} text stitches to the chart.`);
}
function nudgeText(dx,dy){
  $('textCol').value=String(clamp((Number($('textCol').value)||1)+dx,1,active.cols));
  $('textRow').value=String(clamp((Number($('textRow').value)||1)+dy,1,active.rows));
  if(textPreview)buildTextPreview();
}
function drawScene(ctx,canvasWidth,canvasHeight,view){
  const dpr=Math.min(devicePixelRatio||1,2);
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#ede7f2';ctx.fillRect(0,0,canvasWidth,canvasHeight);
  if(!active)return;
  const s=view.scale,{cols,rows}=displayDimensions(),bw=cols*CELL,bh=rows*CELL;
  ctx.save();ctx.translate(view.x,view.y);ctx.scale(s,s);
  const labelMargin=Math.max(42,32/s);
  ctx.fillStyle='#fff';ctx.fillRect(M-labelMargin,M-labelMargin,bw+labelMargin*2,bh+labelMargin*2);
  const minCol=clamp(Math.floor(((-view.x/s)-M)/CELL),0,cols),maxCol=clamp(Math.ceil(((canvasWidth-view.x)/s-M)/CELL),0,cols);
  const minRow=clamp(Math.floor(((-view.y/s)-M)/CELL),0,rows),maxRow=clamp(Math.ceil(((canvasHeight-view.y)/s-M)/CELL),0,rows);
  if(referenceImg&&active.opacity>0&&!active.converted){
    ctx.save();ctx.globalAlpha=active.opacity;renderCroppedImage(ctx,referenceImg,M,M,bw,bh);ctx.restore();
  }
  const displayedConversion=pendingConversion?.projectId===active.id?pendingConversion:null;
  if(active.converted||displayedConversion){
    const colorCells=displayedConversion?.cells||active.cells,colors=displayedConversion?.palette||active.palette;
    for(let r=minRow;r<maxRow;r++)for(let c=minCol;c<maxCol;c++){
      const i=r*cols+c, color=colors[colorCells[i]]||DEFAULT_COLORS[0];
      ctx.fillStyle=color.hex;ctx.fillRect(M+c*CELL,M+r*CELL,CELL,CELL);
    }
    if(referenceImg&&active.opacity>0){
      ctx.save();ctx.globalAlpha=active.opacity*.2;renderCroppedImage(ctx,referenceImg,M,M,bw,bh);ctx.restore();
    }
  }
  if(textPreview&&!pendingConversion){
    drawTextPreviewOverlay(ctx,textPreview,cols,rows);
  }
  if(selected&&!pendingConversion){
    ctx.fillStyle='rgba(124,89,206,.21)';
    ctx.fillRect(M+(selected.col-1)*CELL,M,CELL,bh);
    ctx.fillRect(M,M+(rows-selected.row)*CELL,bw,CELL);
  }
  const showProgressOverlay=uiSettings().showProgress!==false;
  for(let r=minRow;showProgressOverlay&&!displayedConversion&&r<maxRow;r++){
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
  if((active.converted||displayedConversion) && CELL*s>=16){
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 12px system-ui';
    for(let r=minRow;r<maxRow;r++)for(let c=minCol;c<maxCol;c++){
      const i=r*cols+c,rowNum=rows-r;
      if(showProgressOverlay&&!displayedConversion&&(active.done[i]||active.rowDone[rowNum-1]))continue;
      const color=(displayedConversion?.palette||active.palette)[(displayedConversion?.cells||active.cells)[i]]||DEFAULT_COLORS[0];
      const rHex=parseInt(color.hex.slice(1,3),16),gHex=parseInt(color.hex.slice(3,5),16),bHex=parseInt(color.hex.slice(5,7),16);
      ctx.fillStyle=(rHex*.299+gHex*.587+bHex*.114)>145?'#312b3d':'#fff';
      ctx.fillText(color.symbol,M+(c+.5)*CELL,M+(r+.5)*CELL);
    }
  }
  if(selected&&!pendingConversion){
    const x=M+(selected.col-1)*CELL,y=M+(rows-selected.row)*CELL;
    ctx.strokeStyle='#6133c8';ctx.lineWidth=2.8/s;ctx.strokeRect(x+1/s,y+1/s,CELL-2/s,CELL-2/s);
  }
  if(areaSelection&&!pendingConversion){
    const left=Math.min(areaSelection.start.col,areaSelection.end.col),right=Math.max(areaSelection.start.col,areaSelection.end.col);
    const bottom=Math.min(areaSelection.start.row,areaSelection.end.row),top=Math.max(areaSelection.start.row,areaSelection.end.row);
    const x=M+(left-1)*CELL,y=M+(rows-top)*CELL,w=(right-left+1)*CELL,h=(top-bottom+1)*CELL;
    ctx.fillStyle='rgba(135,81,205,.16)';ctx.fillRect(x,y,w,h);
    ctx.strokeStyle='#a04aea';ctx.lineWidth=2/s;ctx.setLineDash([6/s,3/s]);ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);
  }
  // At large zoom, show EVERY number. At fit-scale, space labels to keep them legible.
  const interval=Math.max(1,Math.ceil(15/(CELL*s))),columnInterval=Math.max(1,Math.ceil(32/(CELL*s)));
  const fontWorld=10/s;ctx.font=`bold ${fontWorld}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';
  const highlightedX=selected&&!pendingConversion?selected.col-1:-1, highlightedY=selected&&!pendingConversion?rows-selected.row:-1;
  for(let c=minCol;c<maxCol;c++){
    if(c%columnInterval!==0&&c!==highlightedX&&c!==cols-1)continue;
    if(c!==highlightedX&&highlightedX>=0&&Math.abs(c-highlightedX)*CELL*s<28)continue;
    if(c!==cols-1&&c!==highlightedX&&(cols-1-c)*CELL*s<28)continue;
    const x=M+(c+.5)*CELL,num=String(c+1),chosen=c===highlightedX;
    if(chosen){ctx.fillStyle='#e9dcff';ctx.fillRect(x-11/s,M-22/s,22/s,20/s);ctx.fillRect(x-11/s,M+bh+2/s,22/s,20/s);}
    ctx.fillStyle=chosen?'#5f32bb':'#695b77';ctx.fillText(num,x,M-12/s);ctx.fillText(num,x,M+bh+12/s);
  }
  for(let r=minRow;r<maxRow;r++){
    const row=rows-r,chosen=r===highlightedY;
    if((row-1)%interval!==0&&!chosen&&row!==rows)continue;
    const y=M+(r+.5)*CELL,num=String(row);
    if(chosen){ctx.fillStyle='#e9dcff';ctx.fillRect(M-31/s,y-10/s,27/s,20/s);ctx.fillRect(M+bw+4/s,y-10/s,27/s,20/s);}
    ctx.fillStyle=chosen?'#5f32bb':'#695b77';ctx.fillText(num,M-18/s,y);ctx.fillText(num,M+bw+18/s,y);
  }
  ctx.restore();
}

// Two projections of the same active project; no duplicate cells or progress.
const overviewCanvas = $('overviewCanvas');
let overviewView = {scale:1,x:0,y:0};
function setChartLayout(mode,remember=true){
  const single=mode==='single';
  $('chartViews').classList.toggle('single-chart',single);
  $('overviewPane').hidden=single;
  $('singleChart').setAttribute('aria-pressed',String(single));
  $('dualChart').setAttribute('aria-pressed',String(!single));
  if(remember){try{localStorage.setItem('dorette-chart-layout',single?'single':'dual');}catch{}}
  // ResizeObserver updates the existing working canvas; neither project nor zoom is reset.
  requestDraw();
}
function draw(){
  drawScene(ctx,canvasWidth,canvasHeight,view);
  if(!active||$('overviewPane').hidden)return;
  const rect=overviewCanvas.getBoundingClientRect(), w=Math.max(1,rect.width),h=Math.max(1,rect.height);
  const dpr=Math.min(devicePixelRatio||1,2);
  overviewCanvas.width=Math.round(w*dpr);overviewCanvas.height=Math.round(h*dpr);
  const dims=displayDimensions();
  const s=Math.min((w-24)/boardWidth(),(h-24)/boardHeight(),(w-64)/(dims.cols*CELL),(h-64)/(dims.rows*CELL));
  overviewView={scale:s,x:(w-boardWidth()*s)/2,y:(h-boardHeight()*s)/2};
  const g=overviewCanvas.getContext('2d');drawScene(g,w,h,overviewView);
  if(!active)return;
  // Clip the working viewport rectangle to the chart board.
  const x=Math.max(0,-view.x/view.scale),y=Math.max(0,-view.y/view.scale);
  const right=Math.min(boardWidth(),(canvasWidth-view.x)/view.scale),bottom=Math.min(boardHeight(),(canvasHeight-view.y)/view.scale);
  if(right>x&&bottom>y){g.save();g.setTransform(dpr,0,0,dpr,0,0);g.strokeStyle='#d23f17';g.lineWidth=2;g.setLineDash([6,3]);g.strokeRect(overviewView.x+x*s,overviewView.y+y*s,(right-x)*s,(bottom-y)*s);g.restore();}
}
function navigateOverview(ev){
  if(!active||pendingConversion)return;
  const r=overviewCanvas.getBoundingClientRect(),v=overviewView;
  const wx=(ev.clientX-r.left-v.x)/v.scale,wy=(ev.clientY-r.top-v.y)/v.scale;
  const col=Math.floor((wx-M)/CELL)+1,row=active.rows-Math.floor((wy-M)/CELL);
  if(col<1||col>active.cols||row<1||row>active.rows)return;
  selected={col,row};view.x=canvasWidth/2-wx*view.scale;view.y=canvasHeight/2-wy*view.scale;updateSelection();requestDraw();
}
overviewCanvas.addEventListener('pointerdown',ev=>{overviewCanvas.setPointerCapture(ev.pointerId);navigateOverview(ev);});
overviewCanvas.addEventListener('pointermove',ev=>{if(ev.buttons)navigateOverview(ev);});
overviewCanvas.addEventListener('keydown',ev=>{if(!active)return;const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};if(!moves[ev.key])return;ev.preventDefault();const [dc,dr]=moves[ev.key];selected={col:clamp((selected?.col||1)+dc,1,active.cols),row:clamp((selected?.row||1)+dr,1,active.rows)};view.x=canvasWidth/2-(M+(selected.col-.5)*CELL)*view.scale;view.y=canvasHeight/2-(M+(active.rows-selected.row+.5)*CELL)*view.scale;updateSelection();requestDraw();});

canvas.addEventListener('pointerdown',ev=>{
  if(ev.button!==0&&ev.pointerType==='mouse')return;
  canvas.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId,{x:ev.offsetX,y:ev.offsetY});
  if(pointers.size===1){
    areaStart=null;
    gesture={dragged:false,wasMulti:false,lastDist:0,lastMid:null,totalTravel:0};
    const cell=screenToStitch(ev.offsetX,ev.offsetY);
    const touchSafe=uiSettings().stylusOnly&&ev.pointerType!=='pen';
    if(cell&&(editorTool==='rect'||editorTool==='area')&&!pendingConversion&&!touchSafe)areaStart=cell;
    paintStroke=cell&&(editorTool==='paint'||editorTool==='erase')&&!pendingConversion&&!touchSafe
      ?{pointerId:ev.pointerId,tool:editorTool,color:Number($('paintColor').value),first:cell,last:cell,snapshotted:false,changed:false}:null;
  }
  if(pointers.size===2){
    paintStroke=null;areaStart=null; // two-finger pan/zoom must never leave accidental paint
    const ps=[...pointers.values()];gesture.wasMulti=true;
    gesture.lastDist=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);
    gesture.lastMid={x:(ps[0].x+ps[1].x)/2,y:(ps[0].y+ps[1].y)/2};
  }
});
canvas.addEventListener('pointermove',ev=>{
  const prev=pointers.get(ev.pointerId);if(!prev)return;
  pointers.set(ev.pointerId,{x:ev.offsetX,y:ev.offsetY});
  if(pointers.size>=2){
    const ps=[...pointers.values()],dist=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);
    const midX=(ps[0].x+ps[1].x)/2,midY=(ps[0].y+ps[1].y)/2;
    if(gesture.lastMid){view.x+=midX-gesture.lastMid.x;view.y+=midY-gesture.lastMid.y;}
    if(gesture.lastDist>2)setZoom(view.scale*dist/gesture.lastDist,midX,midY);
    else requestDraw();
    gesture.lastMid={x:midX,y:midY};gesture.lastDist=dist;
    gesture.wasMulti=true;gesture.dragged=true;return;
  }
  const dx=ev.offsetX-prev.x,dy=ev.offsetY-prev.y;
  gesture.totalTravel+=Math.hypot(dx,dy);
  if(paintStroke&&paintStroke.pointerId===ev.pointerId&&!gesture.wasMulti){
    if(gesture.totalTravel>5){
      gesture.dragged=true;
      const cell=screenToStitch(ev.offsetX,ev.offsetY);
      if(cell){brushSegment(paintStroke.last,cell,paintStroke);paintStroke.last=cell;}
    }
  }else if(gesture.totalTravel>5&&!gesture.wasMulti){
    gesture.dragged=true;
    if(areaStart){const end=screenToStitch(ev.offsetX,ev.offsetY);if(end){areaSelection={start:areaStart,end};updateAreaStatus();requestDraw();}}
    else{view.x+=dx;view.y+=dy;requestDraw();}
  }
});
function endPointer(ev){
  if(!pointers.has(ev.pointerId))return;
  if(pointers.size===1&&!gesture.wasMulti){
    const cell=screenToStitch(ev.offsetX,ev.offsetY),touchSafe=uiSettings().stylusOnly&&ev.pointerType!=='pen';
    if(paintStroke&&paintStroke.pointerId===ev.pointerId){
      if(!gesture.dragged)brushSegment(paintStroke.first,paintStroke.first,paintStroke);
      else if(cell)brushSegment(paintStroke.last,cell,paintStroke);
    }else if(areaStart){
      const last=cell||areaStart;areaSelection={start:areaStart,end:last};
      if(editorTool==='rect')applyAreaFill();else {updateAreaStatus();requestDraw();}
    }else if(!gesture.dragged&&cell){
      if(touchSafe){
        selected=cell;
      }else if(editorTool==='bucket'&&!pendingConversion){
        if(editBlocked('fill stitches')){}
        else {const target=Number($('paintColor').value),from=active.cells[indexFor(cell.col,cell.row)];
          if(from!==target){snapshot();const n=window.DorettePattern.bucket(active,cell.col,cell.row,target);if(n){active.converted=true;scheduleSave();updateLegend();toast('Filled '+format(n)+' connected stitches.');}}}
      }else if(editorTool==='paste'&&!pendingConversion){
        if(editBlocked('paste stitches')){}
        else if(stitchClipboard){snapshot();const n=window.DorettePattern.paste(active,stitchClipboard,cell.col,cell.row);if(n){active.converted=true;scheduleSave();updateLegend();toast('Pasted '+format(n)+' stitches.');}else toast('No matching colors or space at this position.');}
        else toast('Copy an area first.');
      }else if(editorTool==='pick'&&!pendingConversion){
        if(editBlocked('pick yarn colors')){}
        else {selected=cell;
          const color=active.cells[indexFor(cell.col,cell.row)];
          selectPaintColor(color,true);
          toast('Picked color '+active.palette[color].symbol+'; ready to paint.');}
      }else if(editorTool==='select'||editorTool==='pan')selected=cell;
      updateSelection();requestDraw();
    }
  }
  paintStroke=null;areaStart=null;
  pointers.delete(ev.pointerId);
  if(pointers.size===0){gesture.lastDist=0;gesture.lastMid=null;}
}
canvas.addEventListener('pointerup',endPointer);
canvas.addEventListener('pointercancel',ev=>{paintStroke=null;areaStart=null;pointers.delete(ev.pointerId);});
canvas.addEventListener('wheel',ev=>{ev.preventDefault();const rect=canvas.getBoundingClientRect();setZoom(view.scale*(ev.deltaY<0?1.13:.885),ev.clientX-rect.left,ev.clientY-rect.top);},{passive:false});
canvas.addEventListener('keydown',ev=>{
  if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='z'){ev.preventDefault();ev.stopPropagation();ev.shiftKey?redo():undo();return;}
  if(!active)return;
  if(ev.key===' '&&selected){ev.preventDefault();markStitch();return;}
  const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};
  if(moves[ev.key]){ev.preventDefault();const [dc,dr]=moves[ev.key];selected={col:clamp((selected?.col||1)+dc,1,active.cols),row:clamp((selected?.row||1)+dr,1,active.rows)};updateSelection();requestDraw();}
});
window.addEventListener('keydown',ev=>{if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){ev.preventDefault();ev.shiftKey?redo():undo();}});

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
    // Attaching or replacing a reference image is NON-DESTRUCTIVE.
    // Converted cells, custom yarn colors and completion flags are preserved.
    // Only Apply chart explicitly replaces a project's cell-color data.
    const keptColors=!!active.converted||active.cells.some(v=>v!==0);
    snapshot();discardPreview(false);active.referenceImage=data;
    active.photoCrop={...FULL_CROP};active.imagePlacement='contain';
    if(!keptColors)active.opacity=.35;
    syncImage();scheduleSave();refreshInspector();
    toast(keptColors
      ? 'Source photo attached. Your existing stitch colors and progress were kept. Crop, then preview the new version.'
      : 'Image loaded. Crop the artwork before previewing stitches.');
  }catch(e){toast('Image import failed: '+e.message);status('Image import failed',true);}
}
function hexRGB(rgb){return '#'+rgb.map(v=>Math.round(clamp(v,0,255)).toString(16).padStart(2,'0')).join('');}
function distSq(a,b){return (a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;}
function updateConversionControls(){
  if(!active)return;
  const s=conversionSettings();
  $('conversionMode').value=s.mode;
  for(const [id,k] of [['brightness','brightness'],['contrast','contrast'],['whiteThreshold','whiteThreshold'],['colorSensitivity','colorSensitivity'],['detailBoost','detail']]){
    $(id).value=s[k];
    if(document.activeElement!==$(id+'Number'))$(id+'Number').value=s[k];
  }
  $('paletteSize').disabled=s.mode==='print'||s.mode==='grayscale';
  $('paletteHelp').textContent=s.mode==='print'
    ? 'Print cleanup uses 4 yarn colors: dark, off-white, red and blue. No added gray shades.'
    : s.mode==='grayscale'
      ? 'Grayscale mode reduces the image to 3 yarn colors: black, gray and white.'
      : 'Natural palette mode uses your selected number of colors.';
}
function adjustRGB(r,g,b,s){
  const factor=1+s.contrast/100,offset=s.brightness*1.6;
  return [clamp((r-128)*factor+128+offset,0,255),clamp((g-128)*factor+128+offset,0,255),clamp((b-128)*factor+128+offset,0,255)];
}
function weightedBrightness(v){return v[0]*.299+v[1]*.587+v[2]*.114;}
// T-shirt graphic mode deliberately maps to the four actual print categories;
// photo lighting and shirt folds do not create extra yarn grays.
function printCategory(v,s){
  const [r,g,b]=v,max=Math.max(r,g,b),min=Math.min(r,g,b),chroma=max-min;
  const sensitivity=s.colorSensitivity;
  if(chroma>=sensitivity && r>g*1.12 && r>b*1.07 && (r-g)>sensitivity*.7)return 2;
  if(chroma>=sensitivity && b>g*1.04 && b>r*1.065 && (b-r)>sensitivity*.65)return 3;
  return weightedBrightness(v)>=s.whiteThreshold?1:0;
}
function cleanPrintCells(cells,cols,rows,s){
  // Subtle de-speckling: reject an isolated white pixel in an otherwise dark region;
  // protect small letter strokes by requiring every neighbor to be dark.
  if(s.detail>=75)return cells;
  const copy=cells.slice();
  for(let r=1;r<rows-1;r++)for(let c=1;c<cols-1;c++){
    const i=r*cols+c;if(cells[i]!==1)continue;
    let adjacent=0;
    for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){
      if(!dr&&!dc)continue;if(cells[(r+dr)*cols+c+dc]===1)adjacent++;
    }
    if(adjacent===0)copy[i]=0;
  }
  return copy;
}
function rasterizeToCells(img,cols,rows,s){
  const multiple=6;
  const sampling=document.createElement('canvas');sampling.width=cols*multiple;sampling.height=rows*multiple;
  const sc=sampling.getContext('2d',{willReadFrequently:true});sc.fillStyle='#fff';sc.fillRect(0,0,sampling.width,sampling.height);
  renderCroppedImage(sc,img,0,0,sampling.width,sampling.height);
  const pixels=sc.getImageData(0,0,sampling.width,sampling.height).data;
  const values=[],printCells=[];
  const coverage=multiple*multiple;
  const minCoverage=clamp(.38-s.detail*.0028,.09,.38);
  const minHueCoverage=clamp(.31-s.detail*.0018,.11,.31);
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    let rr=0,gg=0,bb=0;const frequency=[0,0,0,0];
    for(let dy=0;dy<multiple;dy++)for(let dx=0;dx<multiple;dx++){
      const i=((r*multiple+dy)*sampling.width+(c*multiple+dx))*4;
      const v=adjustRGB(pixels[i],pixels[i+1],pixels[i+2],s);
      rr+=v[0];gg+=v[1];bb+=v[2];
      if(s.mode==='print')frequency[printCategory(v,s)]++;
    }
    values.push([rr/coverage,gg/coverage,bb/coverage]);
    if(s.mode==='print'){
      let category=0;
      // Strong reds and blues are protected against neutral gray averages.
      if(frequency[2]/coverage>=minHueCoverage||frequency[3]/coverage>=minHueCoverage)
        category=frequency[2]>=frequency[3]?2:3;
      else if(frequency[1]/coverage>=minCoverage)category=1;
      else {
        // Avoid retaining very dark gray background noise.
        const avg=values[values.length-1];
        if(weightedBrightness(avg)>=s.whiteThreshold+12)category=1;
      }
      printCells.push(category);
    }
  }
  return {values,printCells};
}
function autoQuantize(values,n){
  const step=Math.max(1,Math.floor(values.length/3500)),samples=values.filter((_,i)=>i%step===0);
  const centers=[samples[0]||[255,255,255]];
  for(let k=1;k<n;k++){
    let best=samples[0],farthest=-1;
    for(const v of samples){let d=Infinity;for(const center of centers)d=Math.min(d,distSq(v,center));if(d>farthest){farthest=d;best=v;}}
    centers.push([...best]);
  }
  for(let iteration=0;iteration<9;iteration++){
    const sums=Array.from({length:n},()=>[0,0,0,0]);
    for(const v of samples){let near=0,best=Infinity;centers.forEach((center,k)=>{const d=distSq(v,center);if(d<best){best=d;near=k;}});
      const sum=sums[near];sum[0]+=v[0];sum[1]+=v[1];sum[2]+=v[2];sum[3]++;}
    for(let k=0;k<n;k++)if(sums[k][3])centers[k]=sums[k].slice(0,3).map(z=>z/sums[k][3]);
  }
  const clustered=values.map(v=>{let near=0,best=Infinity;centers.forEach((center,k)=>{const d=distSq(v,center);if(d<best){best=d;near=k;}});return near;});
  const used=Array(n).fill(0);clustered.forEach(i=>used[i]++);
  const order=used.map((count,i)=>({i,count})).filter(v=>v.count>0).sort((a,b)=>b.count-a.count);
  const indices=new Map(order.map((v,i)=>[v.i,i]));
  return {palette:order.map((v,i)=>({hex:hexRGB(centers[v.i]),name:'Yarn color '+(i+1),symbol:SYMBOLS[i]})),cells:clustered.map(i=>indices.get(i))};
}
function grayscaleQuantize(values){
  const cells=values.map(v=>{const b=weightedBrightness(v);return b<86?0:(b<170?1:2);});
  return {palette:GRAYSCALE_PALETTE.map(c=>({...c})),cells};
}
function buildConversion(cols,rows){
  if(!active||!referenceImg||!validDimensions(cols,rows))throw new Error('Valid photo and stitch dimensions required');
  const s=conversionSettings(),raster=rasterizeToCells(referenceImg,cols,rows,s);
  const data=s.mode==='print'
    ?{palette:PRINT_PALETTE.map(c=>({...c})),cells:cleanPrintCells(raster.printCells,cols,rows,s)}
    :s.mode==='grayscale'
      ?grayscaleQuantize(raster.values)
      :autoQuantize(raster.values,Number($('paletteSize').value));
  return {...data,cols,rows,projectId:active.id};
}
function renderComparison(canvasEl,result){
  const scale=4,cols=result.cols,rows=result.rows;
  canvasEl.width=cols*scale;canvasEl.height=rows*scale;
  const g=canvasEl.getContext('2d',{alpha:false});
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    g.fillStyle=result.palette[result.cells[row*cols+col]].hex;
    g.fillRect(col*scale,row*scale,scale,scale);
  }
}
function previewResult(result){
  pendingConversion=result;
  $('previewSummary').textContent=`Preview: ${result.cols} × ${result.rows} stitches · ${result.palette.length} colors`;
  $('applyConversion').textContent=result.cols!==active.cols||result.rows!==active.rows?'Create chart as new project':'Apply chart';
  $('conversionPreview').hidden=false;
  updateLegend();updateSelection();updateChartSubtitle();fitChart();
  status('Preview only — no chart changes saved');
  toast('Preview ready. Zoom in to inspect small lettering.');
}
function convertImage(){
  if(!active?.referenceImage){requestSourcePhoto('preview a new stitch chart');return;}
  if(!referenceImg){toast('Source photo is loading. Try previewing again in a moment.');return;}
  try{
    status('Converting image…');
    const [cols,rows]=$('previewDimensions').value==='large'?[120,165]:[active.cols,active.rows];
    previewResult(buildConversion(cols,rows));
  }catch(e){toast('Conversion failed: '+e.message);status('Conversion failed',true);}
}
function compareSizes(){
  if(!active?.referenceImage){requestSourcePhoto('compare chart sizes');return;}
  if(!referenceImg){toast('Source photo is loading. Try comparing again in a moment.');return;}
  try{
    status('Preparing comparison…');
    comparisonResults={small:buildConversion(79,117),large:buildConversion(120,165)};
    renderComparison($('compareSmallCanvas'),comparisonResults.small);
    renderComparison($('compareLargeCanvas'),comparisonResults.large);
    $('compareSmallLabel').textContent=`79 × 117 • 9,243 stitches • ${comparisonResults.small.palette.length} colors`;
    $('compareLargeLabel').textContent=`120 × 165 • 19,800 stitches • ${comparisonResults.large.palette.length} colors`;
    $('compareDialog').showModal();
    status('Comparison only — no chart changes saved');
  }catch(e){toast('Comparison failed: '+e.message);status('Comparison failed',true);}
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
function pdfSettings(){
  return {paper:$('pdfPaper').value,orientation:$('pdfOrientation').value,
    detail:$('pdfDetail').value,overlap:Number($('pdfOverlap').value),monochrome:$('pdfMonochrome').checked,completed:$('pdfCompleted').checked};
}
function updatePdfEstimate(){
  if(!active||!window.DorettePdf)return;
  try{
    const info=window.DorettePdf.plan(active,pdfSettings());
    $('pdfPages').textContent=`${info.pages} pages: 1 overview + 1 yarn legend + ${info.pages-2} numbered sections (${info.across} across × ${info.down} down). ${info.overlap?`Up to ${info.overlap} repeated stitches on shared edges, outside purple outline (reference only). May increase pages.`:'No repeated stitches.'}`;
  }catch(e){$('pdfPages').textContent='Cannot prepare the PDF: '+e.message;}
}
function exportPdf(){
  if(!active)return;
  if(!window.DorettePdf){toast('PDF export files are missing. Update all GitHub files.');return;}
  const button=$('exportPdf');
  if(button.disabled)return;
  button.disabled=true;button.textContent='Preparing PDF…';
  // Let the browser draw the busy state before doing the vector export.
  setTimeout(()=>{
    try{
      // Always export the SAVED project, never a temporary photo preview.
      const {bytes,pages}=window.DorettePdf.build(active,pdfSettings());
      download(new Blob([bytes],{type:'application/pdf'}),`${slug(active.name)}-Crochet-Chart.pdf`);
      toast(`${pages}-page PDF downloaded. Open it from Downloads.`);
    }catch(e){toast('PDF export failed: '+e.message);console.error(e);}
    finally{button.disabled=false;button.textContent='⇩ Download printable PDF';}
  },50);
}
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
  const safe=validatePatternExtras(p);
  return {id:uid(),name:p.name.trim()+' (restored)',cols:p.cols,rows:p.rows,cells:p.cells.slice(),done:p.done.slice(),rowDone:p.rowDone.slice(),
    palette:p.palette.map(c=>({hex:c.hex,name:c.name,symbol:c.symbol})),referenceImage:p.referenceImage||null,
    opacity:clamp(Number(p.opacity)||0,0,1),photoCrop:currentCrop(p),imagePlacement:p.imagePlacement==='stretch'?'stretch':'contain',conversionSettings:conversionSettings(p),converted:!!p.converted,...safe,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
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
// v1.0 - All computations use SAVED project cells; preview pixels never alter them.
const Pattern=window.DorettePattern;
function queuePatternRender(){
  clearTimeout(patternRenderTimer);
  patternRenderTimer=setTimeout(()=>{patternRenderTimer=null;renderRowSequence();renderGuide();renderInventoryEstimates();},100);
}
function refreshPatternPanels(){
  if(!active)return;
  Pattern.ensure(active);
  $('rowFirstDirection').value=active.workDirection.first;
  $('rowAlternate').checked=active.workDirection.alternate!==false;
  $('instructionRow').max=String(active.rows);
  $('instructionRow').value=String(clamp(Number($('instructionRow').value)||1,1,active.rows));
  $('gaugeStitches').value=active.gauge.swatchStitches;
  $('gaugeYards').value=active.gauge.swatchYards;
  $('gaugeOverage').value=active.gauge.overage;
  renderRowSequence();renderYarnInventory();renderCheckpoints();renderGuide();
}
function renderRowSequence(){
  if(!active)return;
  Pattern.ensure(active);
  const row=clamp(Math.round(Number($('instructionRow').value)||1),1,active.rows),runs=Pattern.runs(active,row);
  const dir=Pattern.direction(active,row)==='rtl'?'Right to left':'Left to right';
  $('rowRunSummary').textContent=`Row ${row} / ${active.rows} • ${dir} • ${active.cols} stitches • ${runs.length} color blocks${active.rowDone[row-1]?' • Complete':''}.`;
  const chips=$('rowRunChips');chips.replaceChildren();
  runs.forEach(run=>{
    const chip=document.createElement('span');chip.className='run-chip';
    const sw=document.createElement('span');sw.className='run-swatch';sw.style.background=active.palette[run.color].hex;
    const text=document.createElement('strong');text.textContent=`${run.count} ${active.palette[run.color].symbol} (${run.start}→${run.end})`;
    chip.append(sw,text);chips.append(chip);
  });
  const focus=$('rowRunFocus');
  let step=0;
  if(selected&&selected.row===row){
    step=Pattern.direction(active,row)==='rtl'?active.cols-selected.col:selected.col-1;
  } else if(active.guide?.row===row){
    step=active.guide.position||0;
  }
  const currentRun=Pattern.runForPosition(active,row,clamp(step,0,active.cols-1));
  const next=runs.find(r=>currentRun&&r.firstStep>currentRun.lastStep);
  focus.textContent=currentRun
    ? `At stitch ${clamp(step,0,active.cols-1)+1}, work ${currentRun.count-(clamp(step,0,active.cols-1)-currentRun.firstStep)} more stitch${currentRun.count-(clamp(step,0,active.cols-1)-currentRun.firstStep)===1?'':'es'} in ${active.palette[currentRun.color].symbol} (${active.palette[currentRun.color].name})${next?`, then change to ${next.count} × ${active.palette[next.color].symbol} (${active.palette[next.color].name}).`:'. No more color changes in this row.'}`
    : 'Select a stitch in this row or use Guided Crochet Mode to see the next color change.';
  $('rowPrev').disabled=row<=1;$('rowNext').disabled=row>=active.rows;
  $('rowMarkDone').textContent=active.rowDone[row-1]?'↶ Unmark this row':'✓ Mark this row complete';
}
function setInstructionRow(row){
  if(!active)return;
  const n=clamp(Math.round(Number(row)||1),1,active.rows);
  $('instructionRow').value=n;
  selected={row:n,col:Pattern.colAt(active,n,0)};
  updateSelection();renderRowSequence();requestDraw();
}
function renderYarnInventory(){
  if(!active)return;Pattern.ensure(active);
  const container=$('yarnInventoryRows');container.replaceChildren();
  active.palette.forEach((color,i)=>{
    const item=active.yarnInfo[i]||{},box=document.createElement('div');box.className='inventory-row';
    const head=document.createElement('strong');head.className='inventory-heading';head.textContent=`${color.symbol} — ${color.name} (${color.hex})`;
    box.append(head);
    const fields=[['brand','Brand / line','text'],['code','Yarn color code','text'],['dyeLot','Dye lot','text'],['ownedSkeins','Skeins already owned','number'],['skeinYards','Yards per skein','number']];
    fields.forEach(([key,label,type])=>{
      const wrap=document.createElement('label');wrap.textContent=label;
      const input=document.createElement('input');input.type=type;input.value=item[key]??'';input.dataset.index=i;input.dataset.key=key;
      if(type==='text')input.maxLength=70;
      if(type==='number'){input.min='0';input.max='100000';input.step=key==='ownedSkeins'?'1':'0.01';}
      input.addEventListener('change',()=>{
        const v=type==='number'?Math.max(0,Number(input.value)||0):input.value.trim().slice(0,70);
        if(!active.yarnInfo[i])active.yarnInfo[i]={};
        snapshot();active.yarnInfo[i][key]=v;scheduleSave();renderInventoryEstimates();
      });
      wrap.append(input);box.append(wrap);
    });
    const estimate=document.createElement('div');estimate.id=`yarnEstimate${i}`;estimate.className='estimate';box.append(estimate);container.append(box);
  });
  renderInventoryEstimates();
}
function renderInventoryEstimates(){
  if(!active)return;
  const results=Pattern.estimate(active),valid=Number(active.gauge.swatchYards)>0&&Number(active.gauge.swatchStitches)>0;
  results.forEach((r,i)=>{
    const div=$(`yarnEstimate${i}`);if(!div)return;
    div.textContent=valid?`${format(r.count)} stitches • approx. ${r.neededYards.toFixed(1)} yd with allowance${r.totalSkeins!==null?` • ${r.totalSkeins} total skeins • ${r.additional} more to buy`: ' • Enter yards per skein to calculate skeins'}`:`${format(r.count)} stitches • Yardage unavailable until you enter measured sample usage.`;
  });
  $('yarnEstimateSummary').textContent=valid?'Estimates assume similar yarn, stitch type and tension throughout the design. Make your own swatch for reliable planning.':'Do not use stitch counts alone to purchase yarn: enter the yards used in an actual sample swatch first.';
}
function renderCheckpoints(){
  if(!active)return;const sel=$('checkpointChoice'),previous=sel.value;
  sel.replaceChildren();
  if(!active.checkpoints.length){const o=document.createElement('option');o.value='';o.textContent='No saved snapshots';sel.append(o);}
  active.checkpoints.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=`${c.name} — ${c.at.slice(0,16).replace('T',' ')}`;sel.append(o);});
  if(active.checkpoints.some(c=>c.id===previous))sel.value=previous;
  $('restoreCheckpoint').disabled=active.checkpoints.length===0;
}
function updateAreaStatus(){
  const status=$('areaStatus');
  if(!areaSelection){status.textContent='Drag with Select area to choose stitches for Copy or Fill.';return;}
  const {start,end}=areaSelection;
  status.textContent=`Selected: columns ${Math.min(start.col,end.col)}–${Math.max(start.col,end.col)}, rows ${Math.min(start.row,end.row)}–${Math.max(start.row,end.row)}.`;
}
function applyAreaFill(){
  if(!active||pendingConversion||!areaSelection||editBlocked('fill an area'))return;
  const {start,end}=areaSelection,c=Number($('paintColor').value);
  if(!Number.isInteger(c)||c<0||c>=active.palette.length)return;
  const left=Math.min(start.col,end.col),right=Math.max(start.col,end.col),bottom=Math.min(start.row,end.row),top=Math.max(start.row,end.row);
  let wouldChange=false;
  for(let r=bottom;r<=top&&!wouldChange;r++)for(let col=left;col<=right;col++)if(active.cells[indexFor(col,r)]!==c){wouldChange=true;break;}
  if(!wouldChange){updateAreaStatus();return;}
  snapshot();const changed=Pattern.rectangle(active,start.col,start.row,end.col,end.row,c);
  active.converted=true;scheduleSave();updateLegend();requestDraw();toast(`${format(changed)} stitches filled as a rectangle.`);updateAreaStatus();
}
function renderGuide(){
  if(!active||$('guideDialog').hidden)return;
  Pattern.ensure(active);
  const {guide:g}=active,row=g.row,pos=g.position;
  const dir=Pattern.direction(active,row),runs=Pattern.runs(active,row),col=Pattern.colAt(active,row,pos),idx=Pattern.physicalIndex(active,col,row),run=Pattern.runForPosition(active,row,pos);
  const completed=!!active.done[idx]||!!active.rowDone[row-1];
  $('guideTitle').textContent=`Row ${row} of ${active.rows} — ${dir==='rtl'?'Right to left':'Left to right'}`;
  $('guideStatus').textContent=`Stitch ${pos+1} / ${active.cols} • Column ${col} • ${completed?'Already completed':'Not yet completed'}${g.finished?' • CHART FINISHED':''}`;
  $('guideCurrent').textContent=g.finished?'All stitches reached!':'Stitch '+(pos+1)+' — '+active.palette[run.color].symbol+' • '+active.palette[run.color].name+' ('+run.count+' consecutive)';
  const next=runs.find(r=>r.firstStep>run.lastStep);
  $('guideNextColor').textContent=next?`Next color change after stitch ${run.lastStep+1}: ${next.count} × ${active.palette[next.color].symbol} (${active.palette[next.color].name}).`:`${active.cols-pos} stitch${active.cols-pos===1?'':'es'} remain in this row. No more color changes.`;
  const stripe=$('guideRowStripe');stripe.replaceChildren();
  runs.forEach(r=>{
    const part=document.createElement('span');part.className='guide-run'+(r===run?' current':'');part.style.flex=String(r.count);part.style.background=active.palette[r.color].hex;
    part.title=`${r.count} × ${active.palette[r.color].symbol}`;stripe.append(part);
  });
  $('guidePrev').disabled=row===1&&pos===0;
  $('guideNext').disabled=!!g.finished;
  $('guidePrevRow').disabled=row===1;$('guideNextRow').disabled=row===active.rows;
}
function focusGuideCell(){
  const g=active.guide;
  selected={row:g.row,col:Pattern.colAt(active,g.row,g.position)};
  const gx=M+(selected.col-.5)*CELL,gy=M+(active.rows-selected.row+.5)*CELL;
  if(gx*view.scale+view.x<20||gx*view.scale+view.x>canvasWidth-20||gy*view.scale+view.y<20||gy*view.scale+view.y>canvasHeight-20){view.x=canvasWidth/2-gx*view.scale;view.y=canvasHeight/2-gy*view.scale;}
  $('instructionRow').value=g.row;updateSelection();requestDraw();renderRowSequence();renderGuide();
}
function guideNext(){
  if(!active||pendingConversion)return;
  const g=active.guide;if(g.finished)return;
  const idx=Pattern.physicalIndex(active,Pattern.colAt(active,g.row,g.position),g.row);
  if(!active.done[idx])active.done[idx]=1;
  if(g.position<active.cols-1)g.position++;
  else if(g.row<active.rows){g.row++;g.position=0;}
  else g.finished=true;
  scheduleSave();updateProgress();focusGuideCell();
}
function guideBack(){
  const g=active.guide;g.finished=false;
  if(g.position>0)g.position--;else if(g.row>1){g.row--;g.position=active.cols-1;}
  scheduleSave();focusGuideCell();
}
function guideChangeRow(n){
  const g=active.guide;g.row=clamp(g.row+n,1,active.rows);g.position=0;g.finished=false;
  scheduleSave();focusGuideCell();
}
function exportWrittenPdf(){
  if(!active||!window.DorettePdf?.buildWritten)return toast('Please install all Version 1.0 files, including the PDF exporter.');
  const btn=$('exportWrittenPdf');btn.disabled=true;btn.textContent='Building written instructions…';
  setTimeout(()=>{
    try{
      const {bytes,pages}=window.DorettePdf.buildWritten(active,pdfSettings());
      download(new Blob([bytes],{type:'application/pdf'}),`${slug(active.name)}-Written-Rows.pdf`);
      toast(`${pages}-page row-by-row PDF downloaded. Saved chart is unchanged.`);
    }catch(e){toast('Written export failed: '+e.message);console.error(e);}
    finally{btn.disabled=false;btn.textContent='⇩ Download written instructions PDF';}
  },50);
}
function validatePatternExtras(p){
  const direction=p.workDirection&&typeof p.workDirection==='object'?p.workDirection:{};
  const guide=p.guide&&typeof p.guide==='object'?p.guide:{};
  const gauge=p.gauge&&typeof p.gauge==='object'?p.gauge:{};
  const ui=p.ui&&typeof p.ui==='object'?p.ui:{};
  const info=Array.isArray(p.yarnInfo)?p.yarnInfo:[];
  if(info.length>12)throw Error('Too many yarn inventory records');
  for(const item of info){if(item&&typeof item==='object'){
    for(const k of ['brand','code','dyeLot'])if(item[k]!==undefined&&(typeof item[k]!=='string'||item[k].length>70))throw Error('Invalid yarn information');
    for(const k of ['skeinYards','ownedSkeins'])if(item[k]!==undefined&&(!Number.isFinite(Number(item[k]))||Number(item[k])<0||Number(item[k])>100000))throw Error('Invalid yarn quantity');
  }}
  const checkpoints=Array.isArray(p.checkpoints)?p.checkpoints:[];
  if(checkpoints.length>3)throw Error('Too many editing snapshots');
  for(const snap of checkpoints){
    if(!snap||!Number.isInteger(snap.cols)||!Number.isInteger(snap.rows)||snap.cols<1||snap.rows<1||snap.cols>200||snap.rows>300||
      !Array.isArray(snap.cells)||snap.cells.length!==snap.cols*snap.rows||
      !Array.isArray(snap.done)||snap.done.length!==snap.cells.length||!Array.isArray(snap.rowDone)||snap.rowDone.length!==snap.rows||
      !Array.isArray(snap.palette)||snap.palette.length<1||snap.palette.length>12||
      snap.cells.some(x=>!Number.isInteger(x)||x<0||x>=snap.palette.length)||
      snap.done.some(x=>x!==0&&x!==1)||snap.rowDone.some(x=>x!==0&&x!==1)||
      typeof snap.name!=='string'||snap.name.length>65)throw Error('Invalid saved snapshot');
  }
  const safe={workDirection:{first:direction.first==='ltr'?'ltr':'rtl',alternate:direction.alternate!==false},
    guide:{row:clamp(Math.round(Number(guide.row)||1),1,p.rows),position:clamp(Math.round(Number(guide.position)||0),0,p.cols-1),finished:!!guide.finished},
    gauge:{swatchStitches:Math.max(1,Number(gauge.swatchStitches)||100),swatchYards:Math.max(0,Number(gauge.swatchYards)||0),overage:clamp(Number(gauge.overage)||0,0,100)},
    yarnInfo:structuredClone(info),checkpoints:structuredClone(checkpoints),ui:{showProgress:ui.showProgress!==false,patternLock:!!ui.patternLock,stylusOnly:!!ui.stylusOnly,largeTouch:!!ui.largeTouch}};
  return safe;
}
function hookPatternEvents(){
  $('rowFirstDirection').addEventListener('change',ev=>{snapshot();active.workDirection.first=ev.target.value==='ltr'?'ltr':'rtl';scheduleSave();renderRowSequence();renderGuide();});
  $('rowAlternate').addEventListener('change',ev=>{snapshot();active.workDirection.alternate=ev.target.checked;scheduleSave();renderRowSequence();renderGuide();});
  $('instructionRow').addEventListener('change',ev=>setInstructionRow(ev.target.value));
  $('rowPrev').addEventListener('click',()=>setInstructionRow(Number($('instructionRow').value)-1));
  $('rowNext').addEventListener('click',()=>setInstructionRow(Number($('instructionRow').value)+1));
  $('rowMarkDone').addEventListener('click',()=>{
    const row=Number($('instructionRow').value);snapshot();active.rowDone[row-1]=active.rowDone[row-1]?0:1;
    scheduleSave();updateSelection();updateProgress();renderRowSequence();requestDraw();
  });
  $('openGuide').addEventListener('click',()=>{if(pendingConversion)return toast('Apply or discard the current chart preview first.');
    $('guideDialog').hidden=false;focusGuideCell();});
  $('closeGuide').addEventListener('click',()=>{$('guideDialog').hidden=true;});
  $('guideNext').addEventListener('click',guideNext);$('guidePrev').addEventListener('click',guideBack);
  $('guidePrevRow').addEventListener('click',()=>guideChangeRow(-1));$('guideNextRow').addEventListener('click',()=>guideChangeRow(1));
  for(const [field,key,min,max] of [['gaugeStitches','swatchStitches',1,100000],['gaugeYards','swatchYards',0,100000],['gaugeOverage','overage',0,100]]){
    $(field).addEventListener('change',()=>{let value=Number($(field).value);if(!Number.isFinite(value))value=min;value=clamp(value,min,max);snapshot();active.gauge[key]=value;$(field).value=value;scheduleSave();renderInventoryEstimates();});
  }
  $('copyArea').addEventListener('click',()=>{
    if(!areaSelection)return toast('Use Select area to drag across the desired stitches first.');
    const {start,end}=areaSelection;stitchClipboard=Pattern.copyArea(active,start.col,start.row,end.col,end.row);
    toast(`Copied ${stitchClipboard.width} × ${stitchClipboard.height} stitches. Choose Paste, then tap the destination's top-left stitch.`);
  });
  $('fillArea').addEventListener('click',applyAreaFill);
  $('saveCheckpoint').addEventListener('click',()=>{
    if(!active||pendingConversion)return;
    const name=prompt('Name this editing snapshot (up to three retained):','Before edits');if(name===null)return;
    snapshot();Pattern.makeCheckpoint(active,name);scheduleSave();renderCheckpoints();toast('Saved project snapshot in local storage and backups.');
  });
  $('restoreCheckpoint').addEventListener('click',()=>{
    if(!active||editBlocked('restore a snapshot'))return;
    const cp=active.checkpoints.find(c=>c.id===$('checkpointChoice').value);if(!cp)return;
    if(!confirm(`Restore “${cp.name}”? Current changes will be kept in Undo history. Save a ZIP backup too.`))return;
    snapshot();Object.assign(active,{cols:cp.cols,rows:cp.rows,cells:cp.cells.slice(),done:cp.done.slice(),rowDone:cp.rowDone.slice(),palette:structuredClone(cp.palette),yarnInfo:structuredClone(cp.yarnInfo||[]),converted:true});
    Pattern.ensure(active);areaSelection=null;selected=null;scheduleSave();refreshInspector();fitChart();toast('Snapshot restored; Undo is available.');
  });
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
  for(const tool of EDIT_TOOLS){$('tool'+tool[0].toUpperCase()+tool.slice(1)).addEventListener('click',()=>setTool(tool));}
  $('paintColor').addEventListener('change',()=>selectPaintColor(Number($('paintColor').value)));
  $('undoButton').addEventListener('click',undo);$('undoButton').disabled=true;
  $('redoButton').addEventListener('click',redo);$('redoButton').disabled=true;
  $('imageFile').addEventListener('change',ev=>{importImage(ev.target.files[0]);ev.target.value='';});
  for(const [id,edge,fromTrim] of [['cropLeft','left',false],['cropRight','right',true],['cropTop','top',false],['cropBottom','bottom',true]]){
    const slider=$(id),number=$(id+'Number');
    const updateFromPercent=pct=>setCropEdge(edge,fromTrim?1-pct/100:pct/100);
    slider.addEventListener('pointerdown',()=>snapshot());
    slider.addEventListener('input',ev=>updateFromPercent(Number(ev.target.value)));
    slider.addEventListener('change',ev=>updateFromPercent(Number(ev.target.value)));
    let snapshotted=false;
    number.addEventListener('focus',()=>{snapshotted=false;});
    number.addEventListener('input',()=>{
      // Blank/out-of-range input is allowed while typing, not committed.
      if(number.value.trim()==='')return;
      const pct=Number(number.value);
      if(!Number.isInteger(pct)||pct<0||pct>90)return;
      if(!snapshotted){snapshot();snapshotted=true;}
      updateFromPercent(pct);
    });
    number.addEventListener('change',()=>{
      const typed=number.value.trim();
      if(typed!==''){
        const pct=Number(typed);
        if(Number.isFinite(pct)){
          if(!snapshotted){snapshot();snapshotted=true;}
          updateFromPercent(Math.round(clamp(pct,0,90)));
        }
      }
      // Reflect the actual accepted value when the opposing trim limits it.
      number.value=slider.value;
    });
    number.addEventListener('blur',()=>{number.value=slider.value;snapshotted=false;});
  }
  $('resetCrop').addEventListener('click',()=>{if(!active?.referenceImage)return;snapshot();active.photoCrop={...FULL_CROP};discardPreview(false);scheduleSave();updateCropControls();requestDraw();});
  $('shirtCropPreset').addEventListener('click',()=>{if(!active?.referenceImage)return;snapshot();active.photoCrop={left:.20,top:.34,right:.80,bottom:.96};discardPreview(false);scheduleSave();updateCropControls();requestDraw();toast('Starting crop applied. Adjust corners to capture all of the design.');});
  $('imagePlacement').addEventListener('change',ev=>{if(!active)return;snapshot();active.imagePlacement=ev.target.value==='stretch'?'stretch':'contain';discardPreview(false);scheduleSave();updateCropControls();requestDraw();});
  $('cropPreview').addEventListener('pointerdown',ev=>{
    if(!active?.referenceImage||!cropPreviewRect)return;
    const cv=$('cropPreview'),rect=cv.getBoundingClientRect();
    const x=(ev.clientX-rect.left)*cv.width/rect.width,y=(ev.clientY-rect.top)*cv.height/rect.height;
    const ir=cropPreviewRect,c=currentCrop();
    const edges=[[c.left,c.top,'tl'],[c.right,c.top,'tr'],[c.left,c.bottom,'bl'],[c.right,c.bottom,'br']];
    const nearest=edges.map(([fx,fy,mode])=>({mode,dist:Math.hypot(ir.x+fx*ir.w-x,ir.y+fy*ir.h-y)})).sort((a,b)=>a.dist-b.dist)[0];
    const inside=x>=ir.x+c.left*ir.w&&x<=ir.x+c.right*ir.w&&y>=ir.y+c.top*ir.h&&y<=ir.y+c.bottom*ir.h;
    if(nearest.dist>25&&!inside)return;
    cropGesture={mode:nearest.dist<=25?nearest.mode:'move',startX:x,startY:y,original:c};
    snapshot();cv.setPointerCapture(ev.pointerId);ev.preventDefault();
  });
  $('cropPreview').addEventListener('pointermove',ev=>{
    if(!cropGesture||!active?.referenceImage||!cropPreviewRect)return;
    const cv=$('cropPreview'),rect=cv.getBoundingClientRect(),ir=cropPreviewRect;
    const x=(ev.clientX-rect.left)*cv.width/rect.width,y=(ev.clientY-rect.top)*cv.height/rect.height;
    const g=cropGesture,c={...g.original},min=.08;
    const dx=(x-g.startX)/ir.w,dy=(y-g.startY)/ir.h;
    if(g.mode==='move'){
      const mx=clamp(dx,-c.left,1-c.right),my=clamp(dy,-c.top,1-c.bottom);
      c.left+=mx;c.right+=mx;c.top+=my;c.bottom+=my;
    }else{
      if(g.mode.includes('l'))c.left=clamp(c.left+dx,0,c.right-min);
      if(g.mode.includes('r'))c.right=clamp(c.right+dx,c.left+min,1);
      if(g.mode.includes('t'))c.top=clamp(c.top+dy,0,c.bottom-min);
      if(g.mode.includes('b'))c.bottom=clamp(c.bottom+dy,c.top+min,1);
    }
    active.photoCrop=c;discardPreview(false);scheduleSave();updateCropControls();requestDraw();ev.preventDefault();
  });
  const endCropGesture=()=>{cropGesture=null;};
  $('cropPreview').addEventListener('pointerup',endCropGesture);
  $('cropPreview').addEventListener('pointercancel',endCropGesture);
  $('applyConversion').addEventListener('click',()=>{
    if(!active||pendingConversion?.projectId!==active.id||editBlocked("apply a photo conversion"))return;
    const result=pendingConversion;
    if(result.cols!==active.cols||result.rows!==active.rows){
      const fresh=blankProject(`${active.name} — ${result.cols}x${result.rows}`,result.cols,result.rows);
      fresh.referenceImage=active.referenceImage;fresh.photoCrop={...currentCrop()};
      fresh.imagePlacement=active.imagePlacement;fresh.conversionSettings={...conversionSettings()};
      fresh.palette=result.palette.map(c=>({...c}));fresh.cells=result.cells.slice();fresh.converted=true;fresh.opacity=0;
      projects.set(fresh.id,fresh);queueWrite(fresh);selectProject(fresh.id);
      toast(`Created ${result.cols} × ${result.rows} chart as a NEW project. The original is untouched.`);
    }else{
      snapshot();active.palette=result.palette.map(c=>({...c}));active.cells=result.cells.slice();active.yarnInfo=[];active.converted=true;active.opacity=0;
      discardPreview(false);scheduleSave();refreshInspector();toast('Converted chart applied and saved. Review fine text and colors.');
    }
  });
  $('cancelConversion').addEventListener('click',()=>{discardPreview();status(memoryOnly?'Storage blocked — export backups':'✓ Saved on this device',memoryOnly);toast('Preview discarded; original project unchanged.');});
  $('imageOpacity').addEventListener('input',ev=>{if(!active)return;active.opacity=Number(ev.target.value)/100;$('opacityText').textContent=ev.target.value+'%';requestDraw();scheduleSave();});
  $('convertPhoto').addEventListener('click',convertImage);
  $('compareSizes').addEventListener('click',compareSizes);
  $('closeCompare').addEventListener('click',()=>$('compareDialog').close());
  $('compareDialog').addEventListener('click',ev=>{if(ev.target===$('compareDialog'))$('compareDialog').close();});
  for(const [id,key] of [['compareUseSmall','small'],['compareUseLarge','large']]){
    $(id).addEventListener('click',()=>{
      if(!comparisonResults?.[key]||comparisonResults[key].projectId!==active.id)return;
      const result=comparisonResults[key];$('compareDialog').close();
      $('previewDimensions').value=key==='large'?'large':'current';previewResult(result);
    });
  }
  $('conversionMode').addEventListener('change',ev=>{
    if(!active)return;snapshot();active.conversionSettings={...conversionSettings(),mode:['auto','grayscale'].includes(ev.target.value)?ev.target.value:'print'};
    discardPreview(false);scheduleSave();updateConversionControls();requestDraw();
  });
  for(const [id,k] of [['brightness','brightness'],['contrast','contrast'],['whiteThreshold','whiteThreshold'],['colorSensitivity','colorSensitivity'],['detailBoost','detail']]){
    const slider=$(id),number=$(id+'Number');
    const commit=value=>{
      if(!active)return;
      const min=Number(slider.min),max=Number(slider.max);
      const v=Math.round(clamp(Number(value),min,max));
      if(!Number.isFinite(v))return;
      active.conversionSettings={...conversionSettings(),[k]:v};
      slider.value=v;number.value=v;
      discardPreview(false);scheduleSave();updateConversionControls();requestDraw();
    };
    slider.addEventListener('pointerdown',()=>snapshot());
    slider.addEventListener('input',ev=>commit(ev.target.value));
    number.addEventListener('change',ev=>{snapshot();commit(ev.target.value);});
    number.addEventListener('blur',()=>{number.value=conversionSettings()[k];});
  }
  $('printPreset').addEventListener('click',()=>{
    if(!active)return;snapshot();active.conversionSettings={...DEFAULT_CONVERSION};
    discardPreview(false);scheduleSave();updateConversionControls();toast('High-contrast print settings restored.');
  });
  $('removeImage').addEventListener('click',()=>{
    if(!active?.referenceImage)return;
    if(!confirm('Remove the source photo? Existing stitch colors will remain, but you will need to attach a photo again before previewing new conversions.'))return;
    snapshot();discardPreview(false);active.referenceImage=null;active.opacity=0;syncImage();scheduleSave();refreshInspector();
    toast('Reference photo removed. Existing stitched chart and progress remain unchanged.');
  });
  for(const id of ['pdfPaper','pdfOrientation','pdfDetail','pdfOverlap','pdfMonochrome','pdfCompleted'])$(id).addEventListener('change',updatePdfEstimate);
  $('exportPdf').addEventListener('click',exportPdf);
  $('exportWrittenPdf').addEventListener('click',exportWrittenPdf);
  $('showProgressOverlay').addEventListener('change',ev=>{if(!active)return;snapshot();active.ui={...uiSettings(),showProgress:ev.target.checked};scheduleSave();updateTabletControls();requestDraw();});
  $('patternLock').addEventListener('change',ev=>{if(!active)return;snapshot();active.ui={...uiSettings(),patternLock:ev.target.checked};if(ev.target.checked&&['paint','erase','pick','rect','bucket','area','paste'].includes(editorTool))editorTool='select';scheduleSave();updateTabletControls();updateToolUI();toast(ev.target.checked?'Pattern lock enabled. Editing tools are now protected.':'Pattern lock disabled. Stitch editing is available again.');});
  $('stylusOnly').addEventListener('change',ev=>{if(!active)return;snapshot();active.ui={...uiSettings(),stylusOnly:ev.target.checked};scheduleSave();updateTabletControls();toast(ev.target.checked?'Stylus mode on: finger touches only pan/select.':'Stylus mode off: touch editing restored.');});
  $('largeTouch').addEventListener('change',ev=>{if(!active)return;snapshot();active.ui={...uiSettings(),largeTouch:ev.target.checked};scheduleSave();updateTabletControls();});
  $('textColor').addEventListener('change',()=>{$('paintColor').value=$('textColor').value;updateToolUI();});
  for(const id of ['textInput','textOrientation','textScale','textCol','textRow','textColor']){
    $(id).addEventListener('input',()=>{if(textPreview)buildTextPreview();});
  }
  $('previewText').addEventListener('click',()=>{if(!active)return;const preview=buildTextPreview();if(preview?.cells?.length)toast(`Previewing text across ${preview.width} × ${preview.height} cells.`);else if(!$('textFitStatus').textContent)toast('Type some text first.');});
  $('clearTextPreview').addEventListener('click',()=>{clearTextPreview();toast('Text preview cleared.');});
  $('applyText').addEventListener('click',applyTextPreview);
  $('textLeft').addEventListener('click',()=>nudgeText(-1,0));
  $('textRight').addEventListener('click',()=>nudgeText(1,0));
  $('textUp').addEventListener('click',()=>nudgeText(0,1));
  $('textDown').addEventListener('click',()=>nudgeText(0,-1));
  hookPatternEvents();
  for(const id of ['exportProject'])$(id).addEventListener('click',()=>exportBackup(false));
  for(const id of ['exportAll','headerExport'])$(id).addEventListener('click',()=>exportBackup(true));
  for(const id of ['headerRestore','restoreProject'])$(id).addEventListener('click',()=>$('backupFile').click());
  $('backupFile').addEventListener('change',ev=>{restoreBackup(ev.target.files[0]);ev.target.value='';});
  $('deleteProject').addEventListener('click',removeActiveProject);
  new ResizeObserver(resizeCanvas).observe($('canvasWrap'));
  new ResizeObserver(requestDraw).observe(overviewCanvas);
  window.addEventListener('beforeunload',()=>flushSave());
}
async function initialize(){
  hookEvents();
  $('singleChart').addEventListener('click',()=>setChartLayout('single'));
  $('dualChart').addEventListener('click',()=>setChartLayout('dual'));
  let chartLayout='dual';try{chartLayout=localStorage.getItem('dorette-chart-layout')||'dual';}catch{}
  setChartLayout(chartLayout,false);
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
