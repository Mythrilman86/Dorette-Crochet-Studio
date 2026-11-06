import {getDocument,GlobalWorkerOptions} from './pdfjs/pdf.min.mjs';
import {makeWrittenBackup,readWrittenBackup,maxPdfBytes} from './written-backup.mjs';

const $=id=>document.getElementById(id);
const assets=new URL('./pdfjs/',import.meta.url).href;
GlobalWorkerOptions.workerSrc=assets+'pdf.worker.min.mjs';
let db,pattern,pdf,page=1,draft=null,drag=null,opening=0,rendering=null,renderId=0,saving=false,saveChain=Promise.resolve();
let preparedBackup=null,backupGeneration=0;
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
async function render(target,position=null){
 const generation=++renderId,document=pdf;
 if(!document)return;
 if(rendering){rendering.cancel();await rendering.promise.catch(()=>{});}
 if(generation!==renderId||document!==pdf)return;
 page=Math.max(1,Math.min(document.numPages,target));
 $('page').value=page;$('page').max=document.numPages;
 const pdfPage=await document.getPage(page);
 if(generation!==renderId||document!==pdf)return;
 const base=pdfPage.getViewport({scale:1});
 const scale=Math.min(2200/Math.max(base.width,base.height),Math.max(100,$('viewport').clientWidth)/base.width*Number($('zoom').value));
 const view=pdfPage.getViewport({scale});
 const canvas=$('canvas');
 canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
 rendering=pdfPage.render({canvas,canvasContext:canvas.getContext('2d'),viewport:view});
 try{await rendering.promise;}
 catch(error){if(error.name!=='RenderingCancelledException')throw error;}
 finally{if(generation===renderId)rendering=null;}
 if(generation!==renderId)return;
 drawHighlight();
 $('viewport').scrollTop=position?canvas.height*position.y:0;
 $('viewport').scrollLeft=position?canvas.width*position.x:0;
 pdfPage.cleanup();
}
const current=()=>pattern?.instructions.find(entry=>entry.id===pattern.current);
function updateControls(){
 const row=current();
 $('title').textContent=pattern.name;
 $('working').textContent=(row?`Working on ${row.label} · ${row.page===null?'No PDF location mapped':'PDF page '+row.page}`:'Working position not set')+
  ` · ${pattern.instructions.filter(entry=>entry.done).length} completed`;
 $('instructions').replaceChildren(...pattern.instructions.map((entry,index)=>new Option(
  `${index+1}. ${entry.label}${entry.page===null?'':' · PDF page '+entry.page}`,entry.id)));
 $('instructions').value=row?.id||'';
 $('note').value=row?.note||'';
 $('saveNote').disabled=$('complete').disabled=!row;
 $('complete').textContent=row?.done?'Undo current completion':'Mark current instruction complete';
 $('completeNext').disabled=!row||row.done;
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
function run(action){
 return async()=>{try{if(!db)throw Error('Local pattern storage is still opening.');await action();}catch(error){say(error.message||'The operation failed.');}};
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
 await openPattern(entry.id);await refreshLibrary();$('pdf').value='';
});
$('open').onclick=run(()=>openPattern($('patterns').value));
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
for(const [id,delta] of [['previous',-1],['next',1]])$(id).onclick=run(()=>render(page+delta));
$('page').onchange=run(()=>render(Number($('page').value)||1));
$('zoom').onchange=run(()=>render(page));
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
 const viewport=$('viewport'),canvas=$('canvas');
 const position={x:viewport.scrollLeft/canvas.width,y:viewport.scrollTop/canvas.height};
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
 await save({...pattern,current:id});await resume();
});
$('addRange').onclick=run(async()=>{
 const first=Number($('rangeFirst').value),last=Number($('rangeLast').value),type=$('rangeType').value;
 if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first||last>9999||last-first+1+pattern.instructions.length>300)throw Error('Enter a valid range with at most 300 total markers.');
 const rows=Array.from({length:last-first+1},(_,i)=>({id:crypto.randomUUID(),label:type+' '+(first+i),page:null,position:{x:0,y:0},box:null,note:'',done:false}));
 await save({...pattern,current:pattern.current||rows[0].id,instructions:[...pattern.instructions,...rows]});
});
$('saveNote').onclick=run(()=>updateCurrent({note:$('note').value}));
$('complete').onclick=run(()=>updateCurrent({done:!current()?.done}));
$('completeNext').onclick=run(async()=>{
 const row=current();if(!row||row.done)return;
 const index=pattern.instructions.indexOf(row);
 await save({...pattern,lastCompletion:row.id,current:pattern.instructions[index+1]?.id||row.id,
  instructions:pattern.instructions.map(entry=>entry.id===row.id?{...entry,done:true}:entry)});
 await resume();
});
$('undoComplete').onclick=run(async()=>{
 const id=pattern.lastCompletion;if(!id)return;
 await save({...pattern,lastCompletion:null,current:id,instructions:pattern.instructions.map(row=>row.id===id?{...row,done:false}:row)});
 await resume();
});
function invalidateBackup(){
 preparedBackup=null;$('saveBackup').disabled=true;return ++backupGeneration;
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
 say('Backup ready. Save or share it, then verify the file outside Studio.');
});
$('saveBackup').onclick=run(async()=>{
 const file=preparedBackup;if(!file)return;
 if(window.StudioMobile?.nativeFiles){
  if(!await window.StudioMobile.save(file,file.name))return;
 }else if(navigator.canShare?.({files:[file]})){
  try{await navigator.share({files:[file]});}catch(error){if(error.name==='AbortError')return;throw error;}
 }else{
  const url=URL.createObjectURL(file),link=document.createElement('a');
  link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
 say('Check that the backup exists in Downloads or Files. Studio cannot verify that destination.');
});
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
});
const paper=$('paper');
function point(event){
 const r=paper.getBoundingClientRect(),clamp=n=>Math.min(1,Math.max(0,n));
 return {x:clamp((event.clientX-r.left)/r.width),y:clamp((event.clientY-r.top)/r.height)};
}
$('region').onclick=()=>{paper.classList.add('mapping');say('Drag around the instructions to mark the area.');};
paper.onpointerdown=event=>{
 if(!paper.classList.contains('mapping'))return;
 drag=point(event);paper.setPointerCapture(event.pointerId);
};
paper.onpointermove=event=>{
 if(!drag)return;
 const end=point(event);
 draft={page,box:{x:Math.min(drag.x,end.x),y:Math.min(drag.y,end.y),w:Math.abs(drag.x-end.x),h:Math.abs(drag.y-end.y)}};
 drawHighlight();
};
paper.onpointerup=paper.onpointercancel=()=>{drag=null;paper.classList.remove('mapping');};
init.then(async database=>{
 db=database;await refreshLibrary();
 const id=localStorage.getItem('dee-current-written-pattern');
 if(id&&[...$('patterns').options].some(option=>option.value===id))await openPattern(id);
}).catch(error=>say('Local pattern storage is unavailable: '+error.message));
