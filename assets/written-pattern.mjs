import {getDocument,GlobalWorkerOptions} from './pdfjs/pdf.min.mjs';
import {makeWrittenBackup,readWrittenBackup,maxPdfBytes} from './written-backup.mjs';

const $=id=>document.getElementById(id);
const assets=new URL('./pdfjs/',import.meta.url).href;
GlobalWorkerOptions.workerSrc=assets+'pdf.worker.min.mjs';
let db,pattern,pdf,page=1,draft=null,drag=null,opening=0,rendering=null,renderId=0,saving=false,saveChain=Promise.resolve();
let preparedBackup=null,backupGeneration=0,operationPending=false;
const say=message=>{$('status').textContent=message;};
const init=new Promise((resolve,reject)=>{
 const req=indexedDB.open('dee-written-patterns',1);
 req.onupgradeneeded=()=>{
  req.result.createObjectStore('patterns',{keyPath:'id'});
  req.result.createObjectStore('documents');
 };
 req.onsuccess=()=>resolve(req.result);
 req.onerror=()=>reject(req.error);
});
function transaction(stores,mode,action){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(stores,mode);
  let request;
  try{request=action(tx);}catch(error){tx.abort();reject(error);return;}
  tx.oncomplete=()=>resolve(request?.result);
  tx.onabort=()=>reject(tx.error||Error('Storage transaction aborted'));
 });
}
async function loadPdf(data){
 const task=getDocument({data,isEvalSupported:false,enableXfa:false,
  cMapUrl:assets+'cmaps/',cMapPacked:true,standardFontDataUrl:assets+'standard_fonts/',
  wasmUrl:assets+'wasm/',iccUrl:assets+'iccs/',maxImageSize:16_000_000});
 try{return await task.promise;}
 catch(error){await task.destroy().catch(()=>{});throw error;}
}
async function refreshLibrary(){
 const records=await transaction(['patterns'],'readonly',tx=>tx.objectStore('patterns').getAll());
 $('patterns').replaceChildren(...records.map(p=>new Option(p.name,p.id)));
 if(pattern)$('patterns').value=pattern.id;
}
function drawHighlight(){
 const box=draft?.page===page?draft.box:null;
 const h=$('highlight');
 h.hidden=!box;
 if(box)for(const [key,value] of Object.entries({left:box.x,top:box.y,width:box.w,height:box.h}))h.style[key]=100*value+'%';
}
let pageAspect=0;
const viewport=$('viewport'),paper=$('paper');
const fitWidth=()=>Math.max(100,viewport.clientWidth);
function sizePage(zoom){
 const width=fitWidth()*zoom,canvas=$('canvas');
 canvas.style.width=width+'px';canvas.style.height=width*pageAspect+'px';
}
function scrollPosition(){
 return {x:viewport.scrollLeft/(paper.offsetWidth||1),y:viewport.scrollTop/(paper.offsetHeight||1)};
}
async function render(target,position=null,anchor={x:0,y:0}){
 const generation=++renderId,document=pdf;
 if(!document)return;
 if(rendering){rendering.cancel();await rendering.promise.catch(()=>{});}
 if(generation!==renderId||document!==pdf)return;
 page=Math.max(1,Math.min(document.numPages,target));
 $('page').value=page;$('page').max=document.numPages;
 $('previous').disabled=page===1;$('next').disabled=page===document.numPages;
 const pdfPage=await document.getPage(page);
 if(generation!==renderId||document!==pdf)return;
 const base=pdfPage.getViewport({scale:1});
 pageAspect=base.height/base.width;
 const zoom=Number($('zoom').value);
 const scale=Math.min(2200/Math.max(base.width,base.height),fitWidth()/base.width*zoom);
 const view=pdfPage.getViewport({scale});
 const canvas=$('canvas');
 canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
 sizePage(zoom);
 rendering=pdfPage.render({canvas,canvasContext:canvas.getContext('2d'),viewport:view});
 try{await rendering.promise;}
 catch(error){if(error.name!=='RenderingCancelledException')throw error;}
 finally{if(generation===renderId)rendering=null;}
 if(generation!==renderId)return;
 drawHighlight();
 viewport.scrollTop=position?paper.offsetHeight*position.y-anchor.y:0;
 viewport.scrollLeft=position?paper.offsetWidth*position.x-anchor.x:0;
 pdfPage.cleanup();
}
const current=()=>pattern?.instructions.find(entry=>entry.id===pattern.current);
function updateControls(){
 const row=current();
 $('title').textContent=pattern.name;
 $('working').textContent=(row?`Working on ${row.label} · ${row.page===null?'No PDF location mapped':'PDF page '+row.page}`:'Working position not set')+
  ` · ${pattern.instructions.filter(entry=>entry.done).length} completed`;
 $('instructions').replaceChildren(...pattern.instructions.map((entry,index)=>new Option(
  `${index+1}. ${entry.label}${entry.page===null?'':' · PDF page '+entry.page}${entry.id===row?.id?' · Working':''}${entry.done?' · Completed':''}`,entry.id)));
 $('instructions').value=row?.id||'';
 $('note').value=row?.note||'';
 $('saveNote').disabled=$('complete').disabled=!row;
 $('complete').textContent=row?.done?'Undo current completion':'Mark current instruction complete';
 $('completeNext').disabled=!row||row.done||pattern.instructions.at(-1)===row;
 $('undoComplete').disabled=!pattern.lastCompletion;
}
async function resume(){
 const row=current();
 draft=row?structuredClone(row):null;
 $('label').value=row?.label||'';
 await render(row?.page||page,row?.box||row?.position);
}
async function openPattern(id){
 const token=++opening;
 await saveChain.catch(()=>{});
 const [meta,blob]=await Promise.all([
  transaction(['patterns'],'readonly',tx=>tx.objectStore('patterns').get(id)),
  transaction(['documents'],'readonly',tx=>tx.objectStore('documents').get(id))
 ]);
 if(!meta||!blob)throw Error('This pattern or its original PDF is missing.');
 const doc=await loadPdf(new Uint8Array(await blob.arrayBuffer()));
 if(token!==opening){await doc.loadingTask.destroy();return;}
 if(pdf){renderId++;rendering?.cancel();await pdf.loadingTask.destroy();}
 if(token!==opening){await doc.loadingTask.destroy();return;}
 pattern=meta;pdf=doc;$('reader').hidden=false;
 page=1;invalidateBackup();
 localStorage.setItem('dee-current-written-pattern',id);
 updateControls();await resume();say('Opened local pattern.');
}
async function save(next){
 if(saving)throw Error('A progress save is still in progress. Try again shortly.');
 const previous=pattern;
 const revision=previous.revision||0;
 next.revision=revision+1;
 saving=true;
 const write=transaction(['patterns'],'readwrite',tx=>{
  const store=tx.objectStore('patterns'),request=store.get(next.id);
  request.onsuccess=()=>{
   if(!request.result||(request.result.revision||0)!==revision){tx.abort();return;}
   store.put(next);
  };
 });
 saveChain=write;
 try{
  await write;
  if(pattern===previous){pattern=next;invalidateBackup();updateControls();}
  say('Working position and progress saved on this device.');
 }catch(error){throw Error('Could not save pattern progress. Reopen the pattern if another tab changed it. '+error.message);}
 finally{saving=false;}
}
function updateCurrent(changes){
 const row=current();if(!row)return;
 return save({...pattern,instructions:pattern.instructions.map(entry=>entry.id===row.id?{...entry,...changes}:entry)});
}
function run(action,processing='Working…'){
 return async event=>{
  if(operationPending)return;
  const control=event?.currentTarget;
  const controls=[...document.querySelectorAll('button:not(:disabled)')];
  operationPending=true;
  controls.forEach(button=>button.setAttribute('aria-disabled','true'));
  control?.setAttribute('aria-busy','true');
  say(processing);
  try{
   if(!db)throw Error('Local pattern storage is still opening.');
   await action();
   if($('status').textContent===processing)say('Ready.');
  }catch(error){say(error.message||'The operation failed.');}
  finally{
   operationPending=false;
   controls.forEach(button=>button.removeAttribute('aria-disabled'));
   control?.removeAttribute('aria-busy');
  }
 };
}
$('add').onclick=run(async()=>{
 const file=$('pdf').files[0],name=$('name').value.trim();
 if(!name||!file)throw Error('Enter a project name and select a PDF.');
 if(!/\.pdf$/i.test(file.name)||file.size>maxPdfBytes||!file.size)throw Error('Choose a PDF up to 20 MiB.');
 const header=new TextDecoder().decode(await file.slice(0,1024).arrayBuffer());
 if(!header.includes('%PDF-'))throw Error('This file does not have a valid PDF header.');
 let doc;
 try{doc=await loadPdf(new Uint8Array(await file.arrayBuffer()));}
 catch{throw Error('This PDF could not be opened. Check that it is valid and does not require a password.');}
 try{if(doc.numPages>300)throw Error('This prototype supports up to 300 PDF pages.');}
 finally{await doc.loadingTask.destroy();}
 const entry={id:crypto.randomUUID(),name,instructions:[],current:null};
 await transaction(['patterns','documents'],'readwrite',tx=>{
  tx.objectStore('patterns').add(entry);tx.objectStore('documents').add(file,entry.id);
 });
 await openPattern(entry.id);await refreshLibrary();$('pdf').value='';say('PDF imported successfully.');
},'Importing PDF…');
$('open').onclick=run(()=>openPattern($('patterns').value),'Opening pattern…');
$('remove').onclick=run(async()=>{
 const id=$('patterns').value;
 if(!id||!confirm('Remove this local pattern, its stored PDF, and its progress? Keep your original file outside Studio.'))return;
 await saveChain.catch(()=>{});
 await transaction(['patterns','documents'],'readwrite',tx=>{
  tx.objectStore('patterns').delete(id);tx.objectStore('documents').delete(id);
 });
 if(pattern?.id===id){
  opening++;renderId++;rendering?.cancel();await pdf.loadingTask.destroy();
  pattern=pdf=null;invalidateBackup();$('reader').hidden=true;localStorage.removeItem('dee-current-written-pattern');
 }
 await refreshLibrary();say('Pattern removed from this device.');
});
for(const [id,delta] of [['previous',-1],['next',1]])$(id).onclick=run(()=>render(page+delta),'Rendering PDF page…');
$('page').onchange=run(()=>render(Number($('page').value)||1),'Rendering PDF page…');
$('zoom').onchange=run(()=>render(page,scrollPosition()),'Rendering PDF page…');
$('resume').onclick=run(resume);
$('inspect').onclick=run(async()=>{
 const row=pattern.instructions.find(entry=>entry.id===$('instructions').value);
 if(!row)return;
 draft=structuredClone(row);$('label').value=row.label;
 if(row.page!==null)await render(row.page,row.box||row.position);
 else drawHighlight();
});
function marker(existing){
 const label=$('label').value.trim();
 if(!label)throw Error('Enter a row, round, or section label.');
 const position=scrollPosition();
 return {id:existing?.id||crypto.randomUUID(),label,page,position,
  box:draft?.page===page?draft.box:null,note:existing?.note||'',done:existing?.done||false};
}
$('commit').onclick=run(async()=>{
 if(pattern.instructions.length>=300)throw Error('This prototype supports up to 300 instruction markers.');
 const row=marker();
 await save({...pattern,instructions:[...pattern.instructions,row]});
 $('instructions').value=row.id;
 draft=row;drawHighlight();
});
$('editMarker').onclick=run(async()=>{
 const existing=pattern.instructions.find(row=>row.id===$('instructions').value);
 if(!existing)throw Error('Choose an instruction to update.');
 if(!confirm(`Update the selected marker “${existing.label}” to this PDF location?`))return;
 const row=marker(existing);
 await save({...pattern,instructions:pattern.instructions.map(entry=>entry.id===row.id?row:entry)});
 $('instructions').value=row.id;
 draft=row;drawHighlight();
});
$('setCurrent').onclick=run(async()=>{
 const id=$('instructions').value;if(!pattern.instructions.some(row=>row.id===id))return;
 await save({...pattern,current:id});await resume();say('Working position saved: '+current().label+'.');
},'Saving working position…');
$('addRange').onclick=run(async()=>{
 const first=Number($('rangeFirst').value),last=Number($('rangeLast').value),type=$('rangeType').value;
 if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first||last>9999||last-first+1+pattern.instructions.length>300)throw Error('Enter a valid range with at most 300 total markers.');
 const existing=new Set(pattern.instructions.map(row=>row.label.trim().toLowerCase()));
 const overlap=Array.from({length:last-first+1},(_,i)=>type+' '+(first+i)).filter(label=>existing.has(label.toLowerCase()));
 if(overlap.length&&!confirm(`${overlap.length} instruction label(s) already exist in this range. Add separate duplicate markers anyway?`))return;
 const rows=Array.from({length:last-first+1},(_,i)=>({id:crypto.randomUUID(),label:type+' '+(first+i),page:null,position:{x:0,y:0},box:null,note:'',done:false}));
 await save({...pattern,current:pattern.current||rows[0].id,instructions:[...pattern.instructions,...rows]});
});
$('saveNote').onclick=run(async()=>{await updateCurrent({note:$('note').value});say('Note saved.');},'Saving note…');
$('complete').onclick=run(()=>updateCurrent({done:!current()?.done}));
$('completeNext').onclick=run(async()=>{
 const row=current();if(!row||row.done)return;
 const index=pattern.instructions.indexOf(row);
 await save({...pattern,lastCompletion:row.id,current:pattern.instructions[index+1]?.id||row.id,
  instructions:pattern.instructions.map(entry=>entry.id===row.id?{...entry,done:true}:entry)});
 await resume();say(row.label+' completed. '+(current()?.id===row.id?'This was the final instruction.':'Now working on '+current().label+'.'));
},'Saving completion…');
$('undoComplete').onclick=run(async()=>{
 const id=pattern.lastCompletion;if(!id)return;
 await save({...pattern,lastCompletion:null,current:id,instructions:pattern.instructions.map(row=>row.id===id?{...row,done:false}:row)});
 await resume();
});
function invalidateBackup(){
 preparedBackup=null;$('saveBackup').disabled=$('shareBackup').disabled=true;
 $('backupHelp').textContent='Prepare a backup to enable Download Backup. Sharing is available on supported devices.';
 return ++backupGeneration;
}
function canShareBackup(file){
 if(window.StudioMobile?.nativeFiles)return true;
 try{return !!(navigator.share&&navigator.canShare?.({files:[file]}));}catch{return false;}
}
$('omitPdf').onchange=invalidateBackup;
$('exportBackup').onclick=run(async()=>{
 const token=invalidateBackup();
 await saveChain.catch(()=>{});
 const entry=pattern,omit=$('omitPdf').checked;
 const [saved,original]=await Promise.all([
  transaction(['patterns'],'readonly',tx=>tx.objectStore('patterns').get(entry.id)),
  transaction(['documents'],'readonly',tx=>tx.objectStore('documents').get(entry.id))
 ]);
 if(!saved||(saved.revision||0)!==(entry.revision||0))throw Error('This pattern changed in another tab. Reopen it before backing up.');
 const blob=await makeWrittenBackup(saved,original,omit);
 if(token!==backupGeneration||pattern!==entry)return;
 const name=entry.name.replace(/[^a-z0-9_-]+/gi,'-').slice(0,60)||'pattern';
 preparedBackup=new File([blob],name+'.deewritten',{type:blob.type});
 $('saveBackup').disabled=false;
 $('shareBackup').disabled=!canShareBackup(preparedBackup);
 $('backupHelp').textContent=$('shareBackup').disabled?'Download Backup is ready. File sharing is unavailable here.':'Choose Download Backup or Share Backup.';
 say('Backup prepared. '+$('backupHelp').textContent);
},'Preparing backup…');
$('saveBackup').onclick=run(async()=>{
 const file=preparedBackup;if(!file)return;
 if(window.StudioMobile?.nativeFiles){
  if(!await window.StudioMobile.save(file,file.name)){say('Save canceled. The backup is still ready to download.');return;}
 }else{
  const url=URL.createObjectURL(file),link=document.createElement('a');
  link.href=url;link.download=file.name;document.body.append(link);
  try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 }
 say('Download requested. Check Downloads or Files for '+file.name+'. If no file appears, check the browser’s download permissions and try again.');
},'Starting download…');
$('shareBackup').onclick=run(async()=>{
 const file=preparedBackup;if(!file)return;
 if(!canShareBackup(file)){say('File sharing is unavailable. Choose Download Backup instead.');return;}
 try{
  if(window.StudioMobile?.nativeFiles)await window.StudioMobile.share(file,file.name);
  else await navigator.share({files:[file]});
 }
 catch(error){
  say(error.name==='AbortError'?'Sharing canceled. You can still choose Download Backup.':'Sharing could not open or was denied. Choose Download Backup instead.');
  return;
 }
 say('Check Files or your selected destination to verify the backup.');
},'Opening file sharing…');
$('restoreBackup').onclick=run(async()=>{
 const {project,pdf:original}=await readWrittenBackup($('backupFile').files[0],$('pdf').files[0]);
 const doc=await loadPdf(new Uint8Array(await original.arrayBuffer()));
 try{
  if(doc.numPages>300||project.instructions.some(row=>row.page>doc.numPages))throw Error('Backup markers do not match the document page count.');
 }finally{await doc.loadingTask.destroy();}
 if(!confirm(`Restore “${project.name}” with ${project.instructions.length} instruction marker(s) as a new copy?`))return;
 const entry={...project,id:crypto.randomUUID(),name:project.name.slice(0,88)+' (restored)'};
 await transaction(['patterns','documents'],'readwrite',tx=>{
  tx.objectStore('patterns').add(entry);tx.objectStore('documents').add(original,entry.id);
 });
 await openPattern(entry.id);await refreshLibrary();say('Restored as a separate written-pattern project.');
},'Restoring backup…');
let pinch=null,multiTouch=false,markPointer=null,originalDraft=null,resizeTimer;
function touchGeometry(touches){
 const [a,b]=touches,r=viewport.getBoundingClientRect();
 return {distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),
  x:(a.clientX+b.clientX)/2-r.left,y:(a.clientY+b.clientY)/2-r.top};
}
function setZoomChoice(zoom){
 const select=$('zoom'),custom=select.querySelector('[data-pinch]');
 if(custom)custom.remove();
 const value=String(zoom);
 if(![...select.options].some(option=>option.value===value)){
  const option=new Option(Math.round(zoom*100)+'%',value);option.dataset.pinch='';select.add(option);
 }
 select.value=value;
}
viewport.addEventListener('touchstart',event=>{
 if(event.touches.length<2||!pdf||!pageAspect||operationPending)return;
 event.preventDefault();
 if(pinch)return;
 multiTouch=true;
 if(drag){draft=originalDraft;drawHighlight();}
 drag=null;markPointer=null;endMarking();
 const at=touchGeometry(event.touches);
 pinch={...at,zoom:Number($('zoom').value),
  position:{x:(viewport.scrollLeft+at.x)/paper.offsetWidth,y:(viewport.scrollTop+at.y)/paper.offsetHeight}};
},{passive:false});
viewport.addEventListener('touchmove',event=>{
 if(!multiTouch)return;
 event.preventDefault();
 if(!pinch||event.touches.length!==2)return;
 const at=touchGeometry(event.touches);
 const zoom=Math.round(Math.max(1,Math.min(3,pinch.zoom*at.distance/Math.max(1,pinch.distance)))*100)/100;
 setZoomChoice(zoom);sizePage(zoom);
 viewport.scrollLeft=paper.offsetWidth*pinch.position.x-at.x;
 viewport.scrollTop=paper.offsetHeight*pinch.position.y-at.y;
},{passive:false});
function finishPinch(event){
 if(!multiTouch)return;
 if(pinch&&event.touches.length<2){
  pinch=null;
  void render(page,scrollPosition()).catch(error=>say(error.message));
 }
 if(!event.touches.length)multiTouch=false;
}
viewport.addEventListener('touchend',finishPinch);
viewport.addEventListener('touchcancel',finishPinch);
new ResizeObserver(()=>{
 if(!pdf||pinch||$('reader').hidden)return;
 clearTimeout(resizeTimer);
 resizeTimer=setTimeout(()=>{if(!pinch)void render(page,scrollPosition()).catch(error=>say(error.message));},120);
}).observe(viewport);
function endMarking(){
 paper.classList.remove('mapping');$('region').setAttribute('aria-pressed','false');
}
function point(event){
 const r=paper.getBoundingClientRect(),clamp=n=>Math.min(1,Math.max(0,n));
 return {x:clamp((event.clientX-r.left)/r.width),y:clamp((event.clientY-r.top)/r.height)};
}
$('region').onclick=()=>{
 if(operationPending)return;
 const enabled=paper.classList.toggle('mapping');
 $('region').setAttribute('aria-pressed',String(enabled));
 say(enabled?'Drag around the instructions to mark the area.':'Instruction marking canceled.');
};
paper.onpointerdown=event=>{
 if(!paper.classList.contains('mapping')||multiTouch||markPointer!==null)return;
 markPointer=event.pointerId;originalDraft=draft;
 drag=point(event);paper.setPointerCapture(event.pointerId);
};
paper.onpointermove=event=>{
 if(!drag||multiTouch||markPointer!==event.pointerId)return;
 const end=point(event);
 draft={page,box:{x:Math.min(drag.x,end.x),y:Math.min(drag.y,end.y),w:Math.abs(drag.x-end.x),h:Math.abs(drag.y-end.y)}};
 drawHighlight();
};
paper.onpointerup=event=>{
 if(!drag||markPointer!==event.pointerId)return;
 drag=null;markPointer=null;endMarking();
 say('Instruction area ready. Add a marker or update the selected marker to keep it.');
};
paper.onpointercancel=event=>{
 if(markPointer!==event.pointerId)return;
 drag=null;markPointer=null;draft=originalDraft;endMarking();drawHighlight();
};
say('Opening local pattern storage…');
init.then(async database=>{
 db=database;await refreshLibrary();
 say('Local pattern storage is ready.');
 const id=localStorage.getItem('dee-current-written-pattern');
 try{
  if(id&&[...$('patterns').options].some(option=>option.value===id))await openPattern(id);
 }finally{$('patternLibrary').disabled=false;}
}).catch(error=>say('Local pattern storage is unavailable: '+error.message));
