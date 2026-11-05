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
let lastPenTouchAt=0;
function ignorePalmTouch(ev){if(ev.pointerType==='pen'){lastPenTouchAt=Date.now();return false;}return uiSettings().stylusOnly&&ev.pointerType==='touch'&&Date.now()-lastPenTouchAt<500;}

let drawingPending = false;
const EDIT_TOOLS = ['select','paint','erase','pick','pan','rect','bucket','area','paste'];
let editorTool = 'select', paintStroke = null;
const canvas = $('chartCanvas'), ctx = canvas.getContext('2d', {alpha:false});

function uid() { return crypto.randomUUID ? crypto.randomUUID() : 'p-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2); }
function blankProject(name, cols, rows) {
  return {id:uid(),name:name.trim()||'Untitled Chart', cols,rows, cells:Array(cols*rows).fill(0),
    done:Array(cols*rows).fill(0), rowDone:Array(rows).fill(0), palette:DEFAULT_COLORS.map(c=>({...c})),
    referenceImage:null,opacity:0.35,photoCrop:{...FULL_CROP},imagePlacement:'contain',conversionSettings:{...DEFAULT_CONVERSION},converted:false,workDirection:{first:'rtl',alternate:true},guide:{row:1,position:0},gauge:{swatchStitches:100,swatchYards:0,overage:10},yarnInfo:[],checkpoints:[],layers:[],technique:'rows',sectionSize:25,category:'Other',favorite:false,notes:'',versions:[],annotations:[],ui:{showProgress:true,patternLock:false,stylusOnly:false,largeTouch:false},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
}
function clamp(n,min,max) {return Math.min(max,Math.max(min,n));}
function validDimensions(cols,rows) {return Number.isInteger(cols)&&Number.isInteger(rows)&&cols>=1&&cols<=MAX_COLS&&rows>=1&&rows<=MAX_ROWS;}
function indexFor(col,row) { return (active.rows-row)*active.cols+(col-1); }
function format(n) {return n.toLocaleString('en-US');}
let renderRevision=0, composedCache=null, composedCacheRevision=-1, composedCacheProject=null;
function invalidateChartCache(){renderRevision++;composedCache=null;tileCache.clear();pixelPreviewCache=null;}
function composedCells(project=active){
  if(project===active&&composedCache&&composedCacheRevision===renderRevision&&composedCacheProject===active)return composedCache;
  const result=window.DoretteAdvanced.compose(project);
  if(project===active){composedCache=result;composedCacheRevision=renderRevision;composedCacheProject=active;}
  return result;
}
function compositeProject(project=active){return (project?.layers?.length)?{...project,cells:composedCells(project)}:project;}

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
function inCrochetView(){return document.body.classList.contains('crochet-view');}
function isPatternLocked(){return uiSettings().patternLock;}
function editBlocked(action='edit the chart'){
  if(studioReadOnly||!Ops.canWrite()){toast('This tab is read-only.');return true;}
  if(inCrochetView()){toast('Exit Crochet View to '+action+'.');return true;}
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
function status(msg,error=false){const el=$('saveStatus');el.textContent=msg;el.style.color=error?'#b35269':'#537e64';}
const invalidProjects=new Map();
const reliability=window.DoretteReliability;
const Ops=window.DoretteOps;
let reloadingProjects=false,majorCopyPending=false,pageClosing=null;
let studioReadOnly=false,storageRefreshTimer=0,runningImageJob=null,safeEditsEnabled=false;
const TILE_SIDE=24,MAX_CACHED_TILES=20;
const tileCache=new Map();
let pixelPreviewCache=null;

let savePhase='opening',lastSaveTime=null,lastSaveError='',writePending=0;
const failedWrites=new Map();
let drawSamples=0,drawTotal=0,drawLast=0;
function saveAlert(message){const el=$('saveAlert');if(!el)return;el.hidden=!message;$('saveAlertText').textContent=message||'';}
function setSavePhase(phase,error=''){
 savePhase=phase;
 if(phase==='saved'){lastSaveError='';saveAlert(invalidProjects.size?`${invalidProjects.size} invalid stored project(s) protected from edits. Open Studio Diagnostics.`:'');}
 if(phase==='failed'){lastSaveError=error||'Browser storage did not confirm the write';saveAlert('Save failed. Your latest edits may not be stored: '+lastSaveError+' · Export a project ZIP if possible.');}
 if(phase==='blocked'){lastSaveError=error||'Browser storage unavailable';saveAlert('Browser storage is unavailable. Projects may not survive closing this page. Export backups privately.');}
 const labels={opening:'Opening local storage…',unsaved:'● Unsaved changes',saving:'◌ Saving…',saved:lastSaveTime?`✓ Saved at ${lastSaveTime.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`:'✓ Saved on this device',failed:'⚠ Save failed',blocked:'⚠ Storage unavailable'};
 status(labels[phase]||phase,phase==='failed'||phase==='blocked');
 const detail=$('saveStateDetails');if(detail)detail.textContent=`${labels[phase]||phase}${writePending?` · ${writePending} pending write(s)`:''}`;
 const protectionSave=$('protectionSaveStatus');
 if(protectionSave)protectionSave.textContent=lastSaveTime?'Latest confirmed local save this session: '+lastSaveTime.toLocaleString():'No new local write confirmed this session.';
}
function needsSave(){return !!saveTimer||writePending>0||failedWrites.size>0||savePhase==='unsaved'||savePhase==='saving';}

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
    try {result=action(store);}catch(e){tx.abort();reject(e);return;}
    tx.oncomplete=()=>resolve(result?.result);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error('Storage transaction aborted'));
  });
}
const defaultCategories=['Other','Blankets','Garments','Gifts','Practice'];
const catalogId='studio:category-catalog';
const recycledProjects=new Map();
let customCategories=[], organizationBusy=false;

function normalizeCategory(value){
  if(typeof value!=='string')return '';
  const name=value.trim().replace(/\s+/g,' ').normalize('NFC');
  return name.length<=48&&/^[\p{L}\p{N}][\p{L}\p{M}\p{N} &()._’'-]*$/u.test(name)?name:'';
}
function categoryKey(name){return name.toLowerCase();}
function categoryCatalog(names){
  const catalog=new Map(defaultCategories.map(name=>[categoryKey(name),name]));
  for(const value of names){
    const name=normalizeCategory(value);
    if(name&&!catalog.has(categoryKey(name)))catalog.set(categoryKey(name),name);
  }
  return catalog;
}
function loadProjectRecords(items){
  const meta=items.find(record=>record?.id===catalogId);
  const catalog=categoryCatalog(Array.isArray(meta?.categories)?meta.categories:[]);
  recycledProjects.clear();
  for(const project of items){
    if(project?.id===catalogId)continue;
    const check=reliability.auditProject(project);
    if(!check.ok){invalidProjects.set(String(project?.id||'invalid-'+invalidProjects.size),{raw:project,check});continue;}
    const name=normalizeCategory(project.category)||'Other';
    if(!catalog.has(categoryKey(name)))catalog.set(categoryKey(name),name);
    project.category=catalog.get(categoryKey(name));
    (project.trashedAt&&!project.pinned?recycledProjects:projects).set(project.id,project);
  }
  customCategories=[...catalog.values()].slice(defaultCategories.length);
}
async function loadProjects(){return dbRequest('readonly',store=>store.getAll());}
async function organizeProjects(records,removed,categories,apply,{copies=false}={}){
  if(organizationBusy||studioReadOnly||!Ops.canWrite()||memoryOnly){
    toast('Project organization needs writable local storage. Try again when saving is available.');
    return false;
  }
  organizationBusy=true;
  const layout=document.querySelector('.layout');
  layout.inert=true;
  try{
    await flushSave();
    if(!Ops.canWrite())throw new Error('The editing lock was lost.');
    await dbRequest('readwrite',store=>{
      for(const record of records){
        if(copies)store.add(record);else store.put(record);
      }
      for(const id of removed)store.delete(id);
      if(categories)store.put({id:catalogId,categories});
    });
    if(categories)customCategories=categories;
    apply();
    refreshProjectList();
    return true;
  }catch(error){
    toast('Could not save project organization: '+error.message);
    return false;
  }finally{
    organizationBusy=false;
    layout.inert=false;
  }
}
function readProjectBackup(payload){
  const trash=payload?.organization?.recycleBin??[];
  const names=payload?.organization?.categories??[];
  if(payload?.app!=='dorette-crochet-studio'||payload.version!==1||
      !Array.isArray(payload.projects)||!Array.isArray(trash)||!Array.isArray(names)||
      payload.projects.length+trash.length<1||payload.projects.length+trash.length>1000||names.length>1000){
    throw new Error('Not a supported Dorette backup');
  }
  const catalog=categoryCatalog(customCategories.concat(names));
  function restore(record){
    const project=validateBackup(record);
    const key=categoryKey(project.category);
    if(!catalog.has(key))catalog.set(key,project.category);
    project.category=catalog.get(key);
    return project;
  }
  const restored=payload.projects.map(restore);
  const recycled=trash.map(record=>{
    if(record?.pinned===true)throw new Error('A pinned project cannot be restored into the Recycle Bin');
    return {...restore(record),trashedAt:new Date().toISOString()};
  });
  return {projects:restored,recycled,categories:[...catalog.values()].slice(defaultCategories.length)};
}
function refreshSaveState(){
 if(memoryOnly){setSavePhase('blocked');return;}
 if(failedWrites.size){setSavePhase('failed',failedWrites.values().next().value);return;}
 if(saveTimer){setSavePhase('unsaved');return;}
 setSavePhase(writePending?'saving':'saved');
}
function queueWrite(project){
 const id=project.id;
 const audit=reliability.auditProject(project);
 const copy=audit.ok?structuredClone(project):null;
 const result=writeChain.catch(()=>{}).then(()=>{
   if(memoryOnly)throw new Error('Local database unavailable');
   if(studioReadOnly||!Ops?.canWrite())throw new Error('Another tab owns the project editing lock');
   if(!audit.ok)throw new Error('Project validation: '+audit.errors[0]);
   return dbRequest('readwrite',store=>store.put(copy));
 });
 writePending++;
 writeChain=result;
 const complete=error=>{
   writePending--;
   if(error)failedWrites.set(id,error.message);
   else {failedWrites.delete(id);lastSaveTime=new Date();void captureRecovery(copy);}
   refreshSaveState();
 };
 result.then(()=>complete(),complete);
 refreshSaveState();
 return result;
}
let pendingSaveProjectId=null;
function scheduleSave(){
 if(!active)return;
 if(studioReadOnly||!Ops.canWrite()){failedWrites.set(active.id,'Editing ownership was lost before saving');refreshSaveState();return;}
 invalidateChartCache();queuePatternRender();
 active.updatedAt=new Date().toISOString();
 if(memoryOnly){failedWrites.set(active.id,'Local database unavailable');setSavePhase('blocked');return;}
 setSavePhase('unsaved');
 pendingSaveProjectId=active.id;clearTimeout(saveTimer);
 saveTimer=setTimeout(()=>{void flushSave().catch(()=>{});},420);
}
function flushSave(){
 if(saveTimer){
   clearTimeout(saveTimer);saveTimer=null;
   const project=projects.get(pendingSaveProjectId);pendingSaveProjectId=null;
   if(project)queueWrite(project).catch(()=>{});
   else refreshSaveState();
 }
 return writeChain;
}
const pinnedDeleteMessage='Cannot Delete Pinned Project. This project is pinned and protected from deletion. To delete it, you must unpin it first.';
function projectButton(label,action){
  const button=document.createElement('button');
  button.type='button';button.className='button ghost';button.textContent=label;
  button.addEventListener('click',action);
  return button;
}
async function changeProjectFlags(project,changes){
  if(projects.get(project.id)!==project)return;
  await organizeProjects([{...project,...changes}],[],null,()=>Object.assign(project,changes));
}
function deletionAllowed(project){
  if(!project.pinned)return true;
  alert(pinnedDeleteMessage);
  return false;
}
async function recycleProject(project){
  if(projects.get(project.id)!==project||!deletionAllowed(project))return;
  const record={...project,trashedAt:new Date().toISOString()};
  const replacement=projects.size===1?blankProject('My First Chart',79,117):null;
  const saved=await organizeProjects(replacement?[record,replacement]:[record],[],null,()=>{
    projects.delete(project.id);
    recycledProjects.set(project.id,record);
    if(replacement)projects.set(replacement.id,replacement);
    if(activeId===project.id)selectProject(projects.keys().next().value);
  });
  if(saved)toast('Moved to the Recycle Bin.');
}
async function restoreRecycled(project){
  return restoreRecycledProjects([project]);
}
async function restoreRecycledProjects(items){
  if(!items.length||items.some(project=>recycledProjects.get(project.id)!==project))return;
  const records=items.map(project=>{
    const {trashedAt,...record}=project;
    if(projects.has(record.id))record.id=uid();
    return record;
  });
  const saved=await organizeProjects(records,[],null,()=>{
    for(const project of items)recycledProjects.delete(project.id);
    for(const record of records)projects.set(record.id,record);
  });
  if(saved)toast('Restored '+records.length+' project(s) from the Recycle Bin.');
}
async function purgeRecycled(items){
  if(!items.length||items.some(project=>recycledProjects.get(project.id)!==project||!deletionAllowed(project)))return;
  const label=items.length===1?'“'+items[0].name+'”':items.length+' projects';
  if(!confirm('Permanently delete '+label+'? This cannot be undone.'))return;
  const ids=items.map(project=>project.id);
  const saved=await organizeProjects([],ids,null,()=>ids.forEach(id=>recycledProjects.delete(id)));
  if(saved)toast('Permanently deleted '+label+'.');
}
async function duplicateProject(project){
  if(projects.get(project.id)!==project)return;
  const copy=structuredClone(project);
  copy.id=uid();copy.name=(project.name.slice(0,65)+' copy');copy.pinned=false;
  copy.createdAt=copy.updatedAt=new Date().toISOString();
  const saved=await organizeProjects([copy],[],null,()=>{
    projects.set(copy.id,copy);
    selectProject(copy.id);
  },{copies:true});
  if(saved)toast('Project duplicated.');
}
function projectMenu(project){
  const menu=document.createElement('details');menu.className='project-menu';
  const toggle=document.createElement('summary');toggle.textContent='⋮';
  toggle.setAttribute('aria-label','Actions for '+project.name);
  menu.append(toggle);
  const actions=document.createElement('div');actions.className='project-menu-actions';menu.append(actions);
  function add(label,fn){
    actions.append(projectButton(label,()=>{
      menu.open=false;
      toggle.focus();
      fn();
    }));
  }
  add(project.pinned?'Unpin':'Pin',()=>changeProjectFlags(project,{pinned:!project.pinned}));
  add(project.favorite?'Remove from Favorites':'Add to Favorites',()=>changeProjectFlags(project,{favorite:!project.favorite}));
  add('Rename Project',()=>{
    const name=prompt('Rename project',project.name)?.trim().slice(0,70);
    if(name&&name!==project.name)changeProjectFlags(project,{name}).then(()=>{if(active===project)refreshInspector();});
  });
  add('Duplicate Project',()=>duplicateProject(project));
  add('Export Project',()=>exportBackup(false,false,project));
  add('Move to Recycle Bin',()=>recycleProject(project));
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.open=false;toggle.focus();}});
  return menu;
}
const recycleSelection=new Set();
let selectingRecycled=false;
function updateRecycleSelection(){
  for(const id of recycleSelection)if(!recycledProjects.has(id))recycleSelection.delete(id);
  $('toggleRecycleSelection').textContent=selectingRecycled?'Done selecting':'Select Projects';
  $('toggleRecycleSelection').setAttribute('aria-pressed',String(selectingRecycled));
  $('recycleSelectionControls').hidden=!selectingRecycled;
  $('recycleSelectionCount').textContent=recycleSelection.size+' selected';
  for(const id of ['restoreSelectedRecycled','purgeSelectedRecycled'])$(id).disabled=!recycleSelection.size||studioReadOnly;
}
function selectedRecycledProjects(){
  return [...recycledProjects.values()].filter(project=>recycleSelection.has(project.id));
}
function renderRecycleBin(){
  updateRecycleSelection();
  const list=$('projectBinList');list.replaceChildren();
  $('projectBinCount').textContent=recycledProjects.size;
  $('emptyProjectBin').disabled=!recycledProjects.size;
  for(const project of recycledProjects.values()){
    const row=document.createElement('div');row.className='project-bin-row';
    const name=document.createElement('strong');name.textContent=project.name;
    if(selectingRecycled){
      const label=document.createElement('label'),box=document.createElement('input');
      label.className='recycle-select-row';box.type='checkbox';box.checked=recycleSelection.has(project.id);
      box.onchange=()=>{if(box.checked)recycleSelection.add(project.id);else recycleSelection.delete(project.id);updateRecycleSelection();};
      label.append(box,name);row.append(label);
    }else row.append(name,projectButton('Restore Project',()=>restoreRecycled(project)),
      projectButton('Delete Permanently',()=>purgeRecycled([project])));
    list.append(row);
  }
}
const addCategoryValue=':add',manageCategoryValue=':manage';
function refreshCategorySelectors(){
  const categories=defaultCategories.concat(customCategories);
  for(const id of ['categoryFilter','projectCategory','newProjectCategory']){
    const select=$(id);
    const current=id==='projectCategory'?(active?.category||'Other'):select.value;
    const options=categories.map(name=>new Option(name,name));
    if(id==='categoryFilter')options.unshift(new Option('All categories',''));
    else options.push(new Option('Manage Categories…',manageCategoryValue),new Option('＋ Add New Category…',addCategoryValue));
    select.replaceChildren(...options);
    select.value=categories.includes(current)?current:(id==='categoryFilter'?'':'Other');
  }
}
let categoryEdit;
function showCategoryName({selector,project,oldName}={}){
  categoryEdit={selector,project,oldName};
  $('categoryNameTitle').textContent=oldName?'Rename category':'Add category';
  $('categoryNameSave').textContent=oldName?'Rename Category':'Add Category';
  $('categoryName').value=oldName||'';
  $('categoryNameError').textContent='';
  $('categoryNameDialog').showModal();
  $('categoryName').focus();
}
function categoryRecords(name){return [...projects.values(),...recycledProjects.values()].filter(project=>project.category===name);}
async function changeCategoryAssignments(records,name,categories){
  return organizeProjects(records.map(project=>({...project,category:name})),[],categories,()=>{
    for(const project of records)project.category=name;
    if(active)refreshInspector();
  });
}
function renderCategoryManager(){
  const list=$('categoryManagerList');list.replaceChildren();
  for(const name of defaultCategories.concat(customCategories)){
    const row=document.createElement('div');row.className='category-manager-row';
    const title=document.createElement('strong');const count=categoryRecords(name).length;
    title.textContent=name+' ('+count+')';row.append(title);
    if(customCategories.includes(name)){
      row.append(projectButton('Rename',()=>showCategoryName({oldName:name})));
      const replacement=document.createElement('select');
      replacement.setAttribute('aria-label','Reassign projects in '+name+' to');
      replacement.replaceChildren(...defaultCategories.concat(customCategories).filter(value=>value!==name).map(value=>new Option(value,value)));
      replacement.value='Other';
      if(count)row.append(replacement);
      row.append(projectButton('Delete',async()=>{
        if(!confirm(count?'Delete category “'+name+'” and move its '+count+' project(s) to “'+replacement.value+'”?':'Delete category “'+name+'”?'))return;
        if(await changeCategoryAssignments(categoryRecords(name),replacement.value,customCategories.filter(value=>value!==name)))renderCategoryManager();
      }));
    }
    list.append(row);
  }
}
function setupProjectOrganization(){
  $('toggleRecycleSelection').onclick=()=>{selectingRecycled=!selectingRecycled;recycleSelection.clear();renderRecycleBin();};
  $('selectVisibleRecycled').onclick=()=>{for(const id of recycledProjects.keys())recycleSelection.add(id);renderRecycleBin();};
  $('clearRecycledSelection').onclick=()=>{recycleSelection.clear();renderRecycleBin();};
  $('restoreSelectedRecycled').onclick=()=>void restoreRecycledProjects(selectedRecycledProjects());
  $('purgeSelectedRecycled').onclick=()=>void purgeRecycled(selectedRecycledProjects());
  $('emptyProjectBin').addEventListener('click',()=>purgeRecycled([...recycledProjects.values()]));
  for(const id of ['projectCategory','newProjectCategory']){
    const selector=$(id);
    selector.addEventListener('focus',()=>{selector.dataset.previous=selector.value;});
    selector.addEventListener('change',async()=>{
      const value=selector.value;
      const project=id==='projectCategory'?active:null;
      const previous=project?.category||selector.dataset.previous||'Other';
      if(value===addCategoryValue||value===manageCategoryValue){
        selector.value=[...selector.options].some(option=>option.value===previous)?previous:'Other';
        if(value===addCategoryValue)showCategoryName({selector,project});
        else {renderCategoryManager();$('categoryManager').showModal();}
      }else if(project){
        selector.value=previous;
        await changeCategoryAssignments([project],value,null);
      }else selector.dataset.previous=value;
    });
  }
  $('categoryManagerAdd').addEventListener('click',()=>showCategoryName());
  $('categoryNameCancel').addEventListener('click',()=>$('categoryNameDialog').close());
  $('categoryNameForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const {selector,project,oldName}=categoryEdit;
    const name=normalizeCategory($('categoryName').value);
    const error=$('categoryNameError');
    if(!name){error.textContent='Enter a category name of up to 48 characters using letters, numbers, spaces or common punctuation.';return;}
    const catalog=categoryCatalog(customCategories.filter(value=>value!==oldName));
    if(catalog.has(categoryKey(name))){error.textContent='A category with that name already exists.';return;}
    const next=oldName?customCategories.map(value=>value===oldName?name:value):customCategories.concat(name);
    const records=oldName?categoryRecords(oldName):project?[project]:[];
    $('categoryNameSave').disabled=true;
    try{
      if(!await changeCategoryAssignments(records,name,next)){error.textContent='The category could not be saved.';return;}
      if(selector){selector.value=name;selector.dataset.previous=name;}
      $('categoryNameDialog').close();
      if($('categoryManager').open)renderCategoryManager();
    }finally{$('categoryNameSave').disabled=false;}
  });
}

const bulkProjects=new Set();
let bulkMode=false;
function visibleBulkProjects(){
  const query=String($('projectSearch')?.value||'').toLowerCase(),filter=$('categoryFilter')?.value||'',only=$('onlyFavorites')?.checked;
  return [...projects.values()].filter(p=>p.name.toLowerCase().includes(query)||String(p.category||'Other').toLowerCase().includes(query)).filter(p=>(!filter||filter===(p.category||'Other'))&&(!only||p.favorite)).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
function updateBulkProjectControls(){
  $('bulkProjectControls').hidden=!bulkMode;
  $('toggleBulkProjects').textContent=bulkMode?'Done selecting':'Select Projects';
  $('toggleBulkProjects').setAttribute('aria-pressed',String(bulkMode));
  $('bulkProjectCount').textContent=bulkProjects.size+' selected';
  $('applyBulkProjects').disabled=!bulkProjects.size||studioReadOnly;
}
async function applyBulkProjectAction(){
  if(!bulkMode||organizationBusy)return;
  const selectedProjects=visibleBulkProjects().filter(p=>bulkProjects.has(p.id));
  if(!selectedProjects.length)return;
  const action=$('bulkProjectAction').value;
  if(action==='recycle'){
    if(selectedProjects.some(p=>p.pinned))return toast('Unpin the selected pinned projects before moving them to the Recycle Bin.');
    if(!confirm('Move '+selectedProjects.length+' selected project(s) to the Recycle Bin? You can restore them later.'))return;
    const records=selectedProjects.map(p=>({...p,trashedAt:new Date().toISOString()}));
    const replacement=records.length===projects.size?blankProject('My First Chart',79,117):null;
    await organizeProjects(replacement?[...records,replacement]:records,[],null,()=>{
      for(const record of records){projects.delete(record.id);recycledProjects.set(record.id,record);}
      if(replacement)projects.set(replacement.id,replacement);
      if(!projects.has(activeId))selectProject(projects.keys().next().value);
      bulkProjects.clear();
    });
    return;
  }
  const flags={pin:{pinned:true},unpin:{pinned:false},favorite:{favorite:true},unfavorite:{favorite:false}}[action];
  if(!flags)return;
  await organizeProjects(selectedProjects.map(p=>({...p,...flags})),[],null,()=>{
    for(const project of selectedProjects)Object.assign(project,flags);
    bulkProjects.clear();
  });
}
function refreshProjectList(){
  const list=$('projectList');list.replaceChildren();
  $('projectCount').textContent=projects.size;
  refreshCategorySelectors();
  renderRecycleBin();
  const groups = new Map();
  for(const [pin,label] of [[true,'Pinned projects'],[false,'Other projects']]){
    const group=document.createElement('section');group.className='project-group';group.hidden=true;
    const heading=document.createElement('h3');heading.textContent=label;group.append(heading);list.append(group);groups.set(pin,group);
  }
  const visible=visibleBulkProjects(),ids=new Set(visible.map(p=>p.id));
  for(const id of bulkProjects)if(!ids.has(id))bulkProjects.delete(id);
  updateBulkProjectControls();
  visible.forEach(p=>{
    const item=document.createElement('div');item.className='gallery-item'+(p.id===activeId?' active':'');
    const thumb=document.createElement('canvas');thumb.width=54;thumb.height=54;thumb.className='gallery-thumb';
    const g=thumb.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,54,54);
    const s=Math.min(54/p.cols,54/p.rows),ox=(54-p.cols*s)/2,oy=(54-p.rows*s)/2;
    const display=window.DoretteAdvanced.compose(p),usedW=p.cols*s,usedH=p.rows*s;
    // Sample at thumbnail pixel resolution, not once per source stitch. Large charts remain responsive.
    for(let y=Math.floor(oy);y<Math.ceil(oy+usedH);y++)for(let x=Math.floor(ox);x<Math.ceil(ox+usedW);x++){
      const col=clamp(Math.floor((x-ox)/s),0,p.cols-1),row=clamp(Math.floor((y-oy)/s),0,p.rows-1);
      const color=p.palette[display[row*p.cols+col]];g.fillStyle=color?.hex||'#fff';g.fillRect(x,y,1,1);
    }
    const choose=document.createElement('button');choose.type='button';choose.className='gallery-choose';
    const title=document.createElement('strong');title.textContent=(p.pinned?'📌 ':'')+p.name;
    const meta=document.createElement('small');meta.textContent=`${p.cols} × ${p.rows} · ${p.category||'Other'}`;
    choose.append(title,meta);choose.addEventListener('click',()=>selectProject(p.id));
    const fav=document.createElement('button');fav.type='button';fav.className='gallery-favorite';fav.textContent=p.favorite?'★':'☆';fav.title='Toggle favorite';fav.setAttribute('aria-label','Favorite '+p.name);
    fav.addEventListener('click',()=>changeProjectFlags(p,{favorite:!p.favorite}));
    if(bulkMode){
      const label=document.createElement('label');label.className='bulk-project-row';
      const box=document.createElement('input');box.type='checkbox';box.checked=bulkProjects.has(p.id);
      box.onchange=()=>{if(box.checked)bulkProjects.add(p.id);else bulkProjects.delete(p.id);updateBulkProjectControls();};
      label.append(box,thumb,title,meta);item.append(label);
    }else item.append(thumb,choose,fav,projectMenu(p));
    const group=groups.get(p.pinned===true);group.hidden=false;group.append(item);
  });
}

function selectProject(id) {
  if(!projects.has(id))return;
  if(runningImageJob)cancelImageJob();
  invalidateChartCache();
  v16ShapeProposal=null;
  clearColorProposal();
  $("grayTrio").replaceChildren();
  layerGesture=null;layerDragPreview=null;
  
  clearMotifPreview();
  flushSave();discardPreview(false); clearTextPreview(); lastText=null; $("textColor").value=''; activeId=id;active=projects.get(id);window.DorettePattern.ensure(active);selected=null;undoStack=[];redoStack=[];designHistoryLabels=[];redoHistoryLabels=[];areaSelection=null;
  $('undoButton').disabled=true;$('redoButton').disabled=true;renderDesignHistory();updateAreaStatus();
  try {localStorage.setItem('dorette-active-project',id);}catch{}
  $('paintTextLayer').checked=false;selectedLayerId=null;editingLayerId=null;pendingCleanup=null;nextColorProposal=null;syncImage();refreshProjectList();refreshInspector();fitChart();refreshNextPanels();
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
  updateSelection();updateProgress();updateDashboard();updateLegend();updateTabletControls();updateTextControls();renderLayers();refreshNextPanels();updatePdfEstimate();refreshPatternPanels();v16RestoreUI();requestDraw();
}
function undoState(){
  return {selection:selected?{...selected}:null,name:active.name,cols:active.cols,rows:active.rows,cells:active.cells.slice(),done:active.done.slice(),rowDone:active.rowDone.slice(),palette:active.palette.map(p=>({...p})),referenceImage:active.referenceImage,
    referenceMirrored:!!active.referenceMirrored,opacity:active.opacity,photoCrop:{...currentCrop()},imagePlacement:active.imagePlacement||'contain',conversionSettings:{...conversionSettings()},converted:active.converted,
    workDirection:{...active.workDirection},guide:{...active.guide},gauge:{...active.gauge},yarnInfo:structuredClone(active.yarnInfo),checkpoints:structuredClone(active.checkpoints),layers:structuredClone(active.layers||[]),technique:active.technique||'rows',diagonalIndex:active.diagonalIndex||0,sectionSize:active.sectionSize||25,notes:active.notes||'',annotations:structuredClone(active.annotations||[]),versions:(active.versions||[]).slice(),ui:{...uiSettings(active)}};
}
let designHistoryLabels=[],redoHistoryLabels=[];
let motifPreview=null;
let progressBrush=null, overviewStroke=null;
let lastText=null, editingText=null, placingText=false, editingLayerId=null, selectedLayerId=null, pendingCleanup=null, studioMode='edit';
function snapshot({keepProgress=false,label='Design edit'}={}){
  clearColorProposal();
  pendingCleanup=null;
  $("applyCleanup").disabled=true;
  // Progress Undo is independent of design Undo; do not discard it on ordinary edits.
  if(editingText)clearTextPreview();
  lastText=null;
  if(!active)return;
  undoStack.push(undoState());if(undoStack.length>30)undoStack.shift();
  designHistoryLabels.push(label);if(designHistoryLabels.length>30)designHistoryLabels.shift();
  redoStack=[];redoHistoryLabels=[];$('undoButton').disabled=false;$('redoButton').disabled=true;
  renderDesignHistory();
}
function restoreUndoState(state){
  clearColorProposal();
  clearMotifPreview();
  lastText=null;
  pendingCleanup=null;selectedLayerId=null;editingLayerId=null;
  discardPreview(false);clearTextPreview();
  const {category,favorite,selection,...chartState}=state;
  if(selection!==undefined)selected=selection;
  Object.assign(active,chartState);
  invalidateChartCache();window.DorettePattern.ensure(active);
  if(selected&&(selected.col>active.cols||selected.row>active.rows))selected=null;
  syncImage();scheduleSave();refreshInspector();refreshProjectList();
}
function canUseHistory(labels){return !inCrochetView()||(labels.at(-1)||'').startsWith('Progress:');}
function undo(){
  if(!active||!undoStack.length||!canUseHistory(designHistoryLabels)||(isPatternLocked()&&!/^(Progress:|Pattern lock)/.test(designHistoryLabels.at(-1)||'')&&editBlocked('undo chart edits')))return;
  redoStack.push(undoState());redoHistoryLabels.push(designHistoryLabels.pop()||'Design edit');restoreUndoState(undoStack.pop());
  $('undoButton').disabled=!undoStack.length;$('redoButton').disabled=false;renderDesignHistory();toast('Undone — use Redo to restore.');
}
function redo(){
  if(!active||!redoStack.length||!canUseHistory(redoHistoryLabels)||(isPatternLocked()&&!/^(Progress:|Pattern lock)/.test(redoHistoryLabels.at(-1)||'')&&editBlocked('redo chart edits')))return;
  undoStack.push(undoState());designHistoryLabels.push(redoHistoryLabels.pop()||'Design edit');restoreUndoState(redoStack.pop());
  $('undoButton').disabled=false;$('redoButton').disabled=!redoStack.length;renderDesignHistory();toast('Change redone.');
}
function updateSelection(){
  updateProgressUndo();
  const counts=completionCounts();
  if(inCrochetView()){renderCrochetProgress(counts.done,counts.total);renderFocusRowColors();}
  $("markRow").setAttribute("aria-pressed",String(progressBrush==="row"));
  $("markRow").textContent=progressBrush==="row"?"✓ Mark row mode on":"✓ Mark row";
  $("markStitch").setAttribute("aria-pressed",String(progressBrush==="mark"));
  $("markStitch").textContent=progressBrush==="mark"?"✓ Mark stitch mode on":"✓ Mark stitch";
  if(pendingConversion){$('selectedCell').textContent='Preview only — apply or discard to edit';$('markStitch').disabled=!!pendingConversion;$('markRow').disabled=!!pendingConversion;$('paintStitch').disabled=true;updateDashboard(counts);return;}
  if(!selected){$('selectedCell').textContent='Tap any square to begin';$('markStitch').disabled=!!pendingConversion;$('markRow').disabled=!!pendingConversion;$('paintStitch').disabled=true;updateDashboard(counts);return;}
  const i=indexFor(selected.col,selected.row),d=!!active.done[i]||!!active.rowDone[selected.row-1];
  $('jumpRow').value=selected.row;$('jumpCol').value=selected.col;
  $('selectedCell').textContent=`Row ${selected.row} · Column ${selected.col} ${d?'· Complete':''}`;
  $('instructionRow').value=selected.row;queuePatternRender();
  $('markStitch').disabled=false;$('markRow').disabled=false;$('paintStitch').disabled=false;


  updateDashboard(counts);
}
function completionCounts(project=active){
  if(!project)return {done:0,total:0,rowsDone:0};
  let done=0,rowsDone=0;
  const {cols,rows}=project;
  for(let row=0;row<rows;row++){
    if(project.rowDone[rows-row-1]){done+=cols;rowsDone++;continue;}
    const end=(row+1)*cols;
    for(let i=row*cols;i<end;i++)done+=project.done[i]?1:0;
  }
  return {done,total:cols*rows,rowsDone};
}
function updateProgress(){
  refreshSections();
  if(!active)return;
  const counts=completionCounts(active),{done,total}=counts,pct=Math.round(done/total*100);
  $('progressText').textContent=`${format(done)} / ${format(total)} stitches`;
  $('progressPercent').textContent=pct+'%';$('progressBar').style.width=pct+'%';
  updateDashboard(counts);
  if(inCrochetView()){renderCrochetProgress(done,total);renderFocusRowColors();}
}
function updateDashboard(counts=completionCounts()){
  if(!active)return;
  const {done,total,rowsDone}=counts;
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
  $('patternLockStatus').textContent=ui.patternLock?'Pattern Lock: Locked':'Pattern Lock: Unlocked';
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
  tc.add(new Option('Choose a letter yarn…',''));
  active.palette.forEach((c,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=`${c.symbol} · ${c.name}`;tc.append(o);});
  const black=active.palette.findIndex(c=>c.hex.toLowerCase()==='#000000');
  const fallback=active.palette.findIndex(c=>letterColorDistance(c,active.palette[0])>=65);
  tc.value=prev!==''&&active.palette[Number(prev)]?prev:black>=0?String(black):
    active.palette.length===SYMBOLS.length&&fallback>=0?String(fallback):'';
  updateTextColorStatus();
  if(textPreview)buildTextPreview();
}
function letterColorDistance(color,background){
  return Math.hypot(...[1,3,5].map(i=>parseInt(color.hex.slice(i,i+2),16)-parseInt(background.hex.slice(i,i+2),16)));
}
function updateTextColorStatus(){
  if(!active)return;
  const value=$('textColor').value,color=value===''?null:active.palette[Number(value)];
  $('textColorSwatch').style.backgroundColor=color?.hex||'';
  $('textColorStatus').textContent=!color?'Choose a letter yarn or add black.':letterColorDistance(color,active.palette[0])<65?'This yarn is close to the chart background. Choose a contrasting yarn for readable lettering.':'';
  const hasBlack=active.palette.some(c=>c.hex.toLowerCase()==='#000000');
  const add=$('addTextBlack');
  add.hidden=hasBlack;
  add.disabled=active.palette.length>=SYMBOLS.length||isPatternLocked()||!!pendingConversion;
  if(!hasBlack&&active.palette.length>=SYMBOLS.length)$('textColorStatus').textContent+=' The palette is full. Choose an existing yarn.';
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
  if(motifPreview)clearMotifPreview();
  if(textPreview&&tool!=="select"&&tool!=="pan")clearTextPreview();
  if(!EDIT_TOOLS.includes(tool))return;
  if(pendingConversion){toast('Apply or discard the preview before editing stitches.');return;}
  if((isPatternLocked()||inCrochetView()) && !['select','pan'].includes(tool)){editBlocked('use editing tools');return;}
  editorTool=tool;
  updateToolUI();updateTextControls();updateDashboard();
}
function selectPaintColor(index,activate=true){
  if(!active||pendingConversion||!Number.isInteger(index)||index<0||index>=active.palette.length)return;
  $('paintColor').value=String(index);
  if(activate&&!isPatternLocked()&&!inCrochetView())editorTool='paint';
  updateToolUI();
}
function updateLegend(){
  if(!active)return;
  const preview=pendingConversion?.projectId===active.id?pendingConversion:null;
  const palette=preview?.palette||active.palette, cells=preview?.cells||composedCells(active);
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
  for(const id of ['replaceFrom','replaceTo']){
    const select=$(id),was=select.value;select.replaceChildren();
    active.palette.forEach((p,i)=>select.add(new Option(`${p.symbol} · ${p.name}`,String(i))));
    if(active.palette[Number(was)])select.value=was;
  }
  renderLayers();
}
function updateProgressUndo(){
  $('undoProgress').disabled=!undoStack.length||!!pendingConversion||!canUseHistory(designHistoryLabels);
  $('redoProgress').disabled=!redoStack.length||!!pendingConversion||!canUseHistory(redoHistoryLabels);
}
function progressSnapshot(){snapshot({label:'Progress: crochet action'});}
function markStitch(){
  if(pendingConversion||!selected||!active||studioReadOnly)return;
  const i=indexFor(selected.col,selected.row);progressSnapshot();
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
  progressSnapshot();active.rowDone[selected.row-1]=active.rowDone[selected.row-1]?0:1;
  scheduleSave();updateSelection();updateProgress();requestDraw();
}
function symmetricIndexes(col,row){
 const mode=$('symmetryMode')?.value||'off',pts=[[col,row]];
 if(mode==='h'||mode==='hv')pts.push([active.cols+1-col,row]);
 if(mode==='v'||mode==='hv')pts.push([col,active.rows+1-row]);
 if(mode==='hv')pts.push([active.cols+1-col,active.rows+1-row]);
 return [...new Set(pts.map(([c,r])=>indexFor(c,r)))];
}
function paintStitch(){
 if(pendingConversion||!selected||!active||editBlocked('paint stitches'))return;
 brushSegment(selected,selected,{tool:'paint',color:Number($('paintColor').value),snapshotted:false});
}

function applyBrushCell(cell,stroke){
  if(!cell||!stroke||!active||pendingConversion)return false;
  if(stroke.tool==='row'){
    const start=(active.rows-cell.row)*active.cols,end=start+active.cols;
    const complete=!!active.rowDone[cell.row-1]||active.done.slice(start,end).every(Boolean);
    if(stroke.color?complete:!active.rowDone[cell.row-1]&&!active.done.slice(start,end).some(Boolean))return false;
    if(!stroke.snapshotted){progressSnapshot();stroke.snapshotted=true;}
    active.rowDone[cell.row-1]=stroke.color;
    active.done.fill(stroke.color,start,end);
    return true;
  }
  if(stroke.tool==='mark'){
    const index=indexFor(cell.col,cell.row),rowIndex=cell.row-1;
    if(Boolean(active.done[index]||active.rowDone[rowIndex])===Boolean(stroke.color))return false;
    if(!stroke.snapshotted){progressSnapshot();stroke.snapshotted=true;}
    if(active.rowDone[rowIndex]){
      const start=(active.rows-cell.row)*active.cols;
      active.done.fill(1,start,start+active.cols);
      active.rowDone[rowIndex]=0;
    }
    active.done[index]=stroke.color;
    selected=cell;
    return true;
  }
  if(isPatternLocked())return false;
  if($('paintTextLayer').checked)return paintTextLayerCell(cell,stroke);
  const color=stroke.tool==='erase'?0:stroke.color;
  if(!Number.isInteger(color)||color<0||color>=active.palette.length)return false;
  const indexes=symmetricIndexes(cell.col,cell.row);
  const visibleLayers=(active.layers||[]).filter(layer=>layer.visible!==false);
  stroke.painted??=new Set();
  let changed=false;
  for(const i of indexes){
    if(stroke.painted.has(i))continue;
    stroke.painted.add(i);
    const top=visibleLayers.findLast(layer=>layer.entries.some(([index])=>index===i));
    if(top?.type==='shape'){
      if(top.locked)continue;
      const entry=top.entries.findIndex(([index])=>index===i);
      if(stroke.tool!=='erase'&&top.entries[entry][1]===color)continue;
      if(!stroke.snapshotted){snapshot({label:'Edit shape stitches'});stroke.snapshotted=true;}
      if(stroke.tool==='erase')top.entries.splice(entry,1);
      else top.entries[entry][1]=color;
      changed=true;
    }else if(active.cells[i]!==color){
      if(!stroke.snapshotted){snapshot({label:'Paint stitches'});stroke.snapshotted=true;}
      active.cells[i]=color;changed=true;
    }
  }
  if(!changed)return false;
  active.converted=true;stroke.changed=true;return true;
}
function paintTextLayerCell(cell,stroke){
  const layer=chosenLayer();
  if(layer?.type!=='text'||layer.locked||layer.visible===false)return false;
  const color=stroke.color,erase=stroke.tool==='erase';
  if(!erase&&(!Number.isInteger(color)||color<0||color>=active.palette.length))return false;
  const index=indexFor(cell.col,cell.row);
  const entry=layer.entries.findIndex(([i])=>i===index);
  if(erase?entry<0:layer.entries[entry]?.[1]===color)return false;
  if(!stroke.snapshotted){snapshot({label:'Edit text stitches'});stroke.snapshotted=true;}
  if(erase)layer.entries.splice(entry,1);
  else if(entry<0)layer.entries.push([index,color]);
  else layer.entries[entry][1]=color;
  layer.source={...layer.source,handEdited:true};
  active.converted=true;stroke.changed=true;
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
  if(changed){scheduleSave();if(stroke.tool==="mark"||stroke.tool==="row")updateProgress();else{updateLegend();renderLayers();}}
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
async function mirrorChart(){
  if(!active||pendingConversion||editBlocked('mirror the chart'))return;
  if(!await safeMajorCopy('mirrored chart'))return;
  snapshot();
  clearTextPreview();
  const {cols,rows}=active;
  for(const stitches of [active.cells,active.done]){
    for(let row=0;row<rows;row++){
      const start=row*cols;
      for(let col=0;col<Math.floor(cols/2);col++){
        const left=start+col,right=start+cols-1-col;
        [stitches[left],stitches[right]]=[stitches[right],stitches[left]];
      }
    }
  }
  for(const layer of active.layers||[])layer.entries=layer.entries.map(([i,color])=>{
    const x=i%cols,y=Math.floor(i/cols);return [y*cols+(cols-1-x),color];
  });
  active.annotations=(active.annotations||[]).map(note=>note.scope==='row'?note:
    DoretteNext.locateNote({...note,col:cols+1-note.col},active));
  
  active.referenceMirrored=!active.referenceMirrored;
  if(selected)selected={...selected,col:cols+1-selected.col};
  active.guide.position=cols-1-active.guide.position;
  areaSelection=null;updateAreaStatus();
  scheduleSave();refreshInspector();
  toast('Chart mirrored left to right. Use Undo to restore it.');
}
let dimensionRequest=null;
function drawDimensionDiagram(old, cols, rows, columnEdge, rowEdge){
  const x=columnEdge==='left'?old.cols-cols:0,y=rowEdge==='top'?old.rows-rows:0;
  const left=Math.max(0,x),top=Math.max(0,y),right=Math.min(old.cols,x+cols),bottom=Math.min(old.rows,y+rows);
  const rect=(x,y,w,h)=>'M'+x+' '+y+'h'+w+'v'+h+'h'+(-w)+'Z';
  const oldRect=rect(0,0,old.cols,old.rows),newRect=rect(x,y,cols,rows),keep=rect(left,top,right-left,bottom-top);
  const diagram=$('dimensionDiagram'),minX=Math.min(0,x),minY=Math.min(0,y);
  const width=Math.max(old.cols,x+cols)-minX,height=Math.max(old.rows,y+rows)-minY;
  diagram.setAttribute('viewBox',[minX-1,minY-1,width+2,height+2].join(' '));
  for(const [part,path] of [['keep',keep],['remove',oldRect+keep],['add',newRect+keep],['outline',newRect]]){
    diagram.querySelector('.dimension-'+part).setAttribute('d',path);
  }
}
function editDimensions(){
  if(!active||pendingConversion||editBlocked('resize the chart'))return;
  const cols=Number($('colsInput').value),rows=Number($('rowsInput').value);
  if(!validDimensions(cols,rows))return toast('Columns must be 1–200 and rows 1–300.');
  if(cols===active.cols&&rows===active.rows)return toast('The dimensions have not changed.');
  const columnEdge=$('dimensionColumnEdge').value,rowEdge=$('dimensionRowEdge').value;
  const result=NF.resizeChartEdges(active,cols,rows,columnEdge,rowEdge);
  const describe=(delta,unit,edge)=>{
    if(!delta)return '';
    const count=Math.abs(delta),direction=delta>0?'Add':'Remove';
    return direction+' '+count+' '+unit+(count===1?'':'s')+(delta>0?' at the ':' from the ')+edge+'.';
  };
  $('dimensionChangeSummary').textContent=[active.cols+' × '+active.rows+' → '+cols+' × '+rows+'.',
    describe(rows-active.rows,'row',rowEdge),describe(cols-active.cols,'column',columnEdge)].filter(Boolean).join(' ');
  const {losses}=result;
  const lost=[losses.artwork&&'base artwork',losses.layers&&'layer stitches (such as lettering)',losses.progress&&'crochet progress'].filter(Boolean);
  $('dimensionChangeWarning').textContent=[
    lost.length?'This removes '+lost.join(', ')+'.':'',
    losses.notes?'Notes on removed lines will move to the nearest surviving stitch or row.':'',
    active.referenceImage?'The reference photo is kept and its overlay is hidden for alignment review.':'',
    rows!==active.rows&&rowEdge==='bottom'&&active.workDirection?.alternate!==false?'Renumbered rows may reverse working direction.':'',
    safeEditsEnabled?'The original is kept and Studio resizes a saved copy.':''
  ].filter(Boolean).join(' ');
  drawDimensionDiagram(active,cols,rows,columnEdge,rowEdge);
  dimensionRequest={project:active,revision:renderRevision,result};
  $('dimensionPreviewDialog').showModal();
}
async function confirmDimensions(){
  const request=dimensionRequest,point=selected&&{...selected};
  $('dimensionPreviewDialog').close();
  if(!request||request.project!==active||request.revision!==renderRevision||pendingConversion||editBlocked('resize the chart'))return;
  if(!await safeMajorCopy('resized chart')||editBlocked('resize the chart'))return;
  const {patch,position}=request.result;
  selected=point;
  snapshot({label:'Resize chart edges'});
  Object.assign(active,patch);
  selected=point&&position(point,true);
  areaSelection=null;clearMotifPreview();clearTextPreview();
  invalidateChartCache();scheduleSave();refreshInspector();fitChart();
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
  target.save();
  if(active?.referenceMirrored){
    target.translate(2*dest.x+dest.w,0);
    target.scale(-1,1);
  }
  target.drawImage(img,sx,sy,sw,sh,dest.x,dest.y,dest.w,dest.h);
  target.restore();
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
function syncTextDirection(){
  const vertical=$('textDirection').value==='vertical';
  $('textLayout').disabled=vertical;
  $('textWrap').disabled=vertical;
}
function previewTextConfig(){
  return {
    text:($('textInput').value||'').slice(0,40),
    angle:Number($('textAngle').value)||0,
    flip:$('flipText').checked,
    height:$('textScale').valueAsNumber,
    glyphWidth:$('textWidth').value === '' ? null : $('textWidth').valueAsNumber,
    proportional:$('textProportions').checked,
    direction:$('textDirection').value,
    col:clamp(Number($('textCol').value)||1,1,active?.cols||1),
    row:clamp(Number($('textRow').value)||1,1,active?.rows||1),
    color:clamp(Number($('textColor').value)||0,0,Math.max(0,(active?.palette.length||1)-1)),
    style:$('textStyle').value,letterSpacing:Number($('letterSpacing').value),layout:$('textLayout').value,wrap:Number($('textWrap').value)||0
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
  const vertical=config.direction==='vertical';
  if(!vertical&&config.wrap>0&&text.length>config.wrap){
    const chunks=[],words=text.split(/\s+/);let line='';
    for(const word of words){
      if(!line){line=word;continue;}
      if((line+' '+word).length<=config.wrap)line+=' '+word;
      else{chunks.push(line);line=word;}
    }
    if(line)chunks.push(line);
    const lines=chunks.flatMap(chunk=>chunk.length>config.wrap?chunk.match(new RegExp('.{1,'+config.wrap+'}','g')):[chunk]);
    if(lines.length>1){
      const glyphLines=lines.map(t=>rasterizeTextPattern({...config,text:t,wrap:0,angle:0,flip:false,layout:'straight'}));
      const w=Math.max(...glyphLines.map(g=>g.width)),gap=Math.max(1,Math.round(config.height*.4));
      const h=glyphLines.reduce((sum,g)=>sum+g.height,0)+gap*(glyphLines.length-1);
      const raw=[];let offset=0;
      for(const g of glyphLines){for(const cell of g.occupied)raw.push({x:cell.x,y:cell.y+offset});offset+=g.height+gap;}
      const angle=Number(config.angle)||0,sideways=angle===90||angle===270;
      const width=sideways?h:w,height=sideways?w:h;
      const rotated=raw.map(cell=>{
        let x=cell.x,y=cell.y;
        if(angle===90){[x,y]=[h-1-y,x];}
        if(angle===180){[x,y]=[w-1-x,h-1-y];}
        if(angle===270){[x,y]=[y,w-1-x];}
        if(config.flip)x=width-1-x;
        return {x,y};
      });
      return advancedLetterPreviewTransform({width,height,occupied:rotated,tooLarge:width>active.cols-config.col+1||height>config.row},config);
    }
  }

  const letters=Array.from(text.toUpperCase());
  const glyphs=letters.map(letter=>{
    const bits=stitchGlyphs[letter];
    if(!bits)return rasterizeSymbol(letter);
    const width=letter==='O'?4:3;
    const occupied=[];
    bits.forEach((row,y)=>{
      for(let x=0;x<width;x++)if(row & (1 << (width-1-x)))occupied.push({x,y});
    });
    if(config.style==='bold'){
      const added=[];for(const p of occupied){added.push(p);if(p.x+1<width)added.push({x:p.x+1,y:p.y});}
      return {width,height:5,occupied:added};
    }
    if(config.style==='outline'){
      const keys=new Set(occupied.map(p=>p.x+','+p.y));
      const outline=occupied.filter(p=>!(keys.has((p.x-1)+','+p.y)&&keys.has((p.x+1)+','+p.y)&&keys.has(p.x+','+(p.y-1))&&keys.has(p.x+','+(p.y+1))));
      return {width,height:5,occupied:outline};
    }
    return {width,height:5,occupied};
  });
  const gap=Math.max(0,Math.round(config.height/5)*(config.letterSpacing??1));
  let sourceWidth=0;
  const spans=glyphs.map(glyph=>{
    const width=config.glyphWidth??Math.max(1,Math.round(glyph.width*config.height/glyph.height));
    const span={glyph,width,start:sourceWidth,pixels:new Set(glyph.occupied.map(({x,y})=>y*glyph.width+x))};
    sourceWidth+=(vertical?config.height:width)+gap;
    return span;
  });
  sourceWidth-=gap;
  const sourceHeight=vertical?sourceWidth:config.height;
  if(vertical)sourceWidth=Math.max(...spans.map(span=>span.width));
  const sideways=config.angle===90||config.angle===270;
  const width=sideways?sourceHeight:sourceWidth;
  const height=sideways?sourceWidth:sourceHeight;
  const availableWidth=active.cols-config.col+1,availableHeight=config.row;
  const occupied=[];
  for(let y=0;y<Math.min(height,availableHeight);y++)for(let x=0;x<Math.min(width,availableWidth);x++){
    const rx=config.flip?width-1-x:x;
    let sx=rx,sy=y;
    if(config.angle===90){sx=y;sy=sourceHeight-1-rx;}
    if(config.angle===180){sx=sourceWidth-1-rx;sy=sourceHeight-1-y;}
    if(config.angle===270){sx=sourceWidth-1-y;sy=rx;}
    const axis=vertical?sy:sx;
    const span=spans.find(span=>axis>=span.start&&axis<span.start+(vertical?config.height:span.width));
    if(!span)continue;
    const {glyph}=span;
    // Keep the same stitch boundaries as unrotated lettering.
    const localX=vertical?sx-Math.floor((sourceWidth-span.width)/2):sx-span.start;
    const localY=vertical?sy-span.start:sy;
    if(localX<0||localX>=span.width||localY<0||localY>=config.height)continue;
    const gx=glyph.width<=span.width
      ?Math.ceil((localX+.5)*glyph.width/span.width)-1
      :Math.floor((localX+.5)*glyph.width/span.width);
    const gy=glyph.height<=config.height
      ?Math.ceil((localY+.5)*glyph.height/config.height)-1
      :Math.floor((localY+.5)*glyph.height/config.height);
    if(span.pixels.has(gy*glyph.width+gx))occupied.push({x,y});
  }
  return advancedLetterPreviewTransform({width,height,occupied,tooLarge:width>availableWidth||height>availableHeight},config);
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
  if($('textColor').value===''){
    feedback.textContent='Choose a letter yarn before previewing or applying text.';
    textPreview=null;requestDraw();return null;
  }
  const config=previewTextConfig();
  if(!Number.isInteger(config.height)||config.height<5||config.height>100){
    feedback.textContent='Enter a whole letter height from 5 to 100 stitches.';
    textPreview={...config,cells:[]};
    requestDraw();
    return textPreview;
  }
  if(config.glyphWidth!==null&&(!Number.isInteger(config.glyphWidth)||config.glyphWidth<1||config.glyphWidth>100)){
    feedback.textContent='Enter a whole letter width from 1 to 100 stitches, or leave it blank for automatic width.';
    textPreview={...config,cells:[]};requestDraw();return textPreview;
  }
  const mask=rasterizeTextPattern(config);
  if(!mask){textPreview=null;requestDraw();return null;}
  if(mask.tooLarge||mask.width>active.cols-config.col+1||mask.height>config.row||mask.occupied.some(pt=>config.col+pt.x>active.cols||config.row-pt.y<1)){
    feedback.textContent=`Text needs ${mask.width} × ${mask.height} stitches. Only ${active.cols-config.col+1} × ${config.row} are available here. Reduce the letter size, move the text, or use a larger chart.`;
  }else feedback.textContent=`Text size: ${mask.width} × ${mask.height} stitches.`;
  const cells=[];
  for(const pt of mask.occupied){
    const col=config.col+pt.x,row=config.row-pt.y;
    if(col>=1&&col<=active.cols&&row>=1&&row<=active.rows)cells.push({col,row});
  }
  textPreview={...config,width:mask.width,height:mask.height,cells,tooLarge:mask.tooLarge||mask.width>active.cols-config.col+1||mask.height>config.row};
  requestDraw();
  return textPreview;
}
function clearTextPreview(){
  editingLayerId=null;
  textPreview=null;editingText=null;placingText=false;
  $('placeText').setAttribute('aria-pressed','false');
  $('applyText').textContent='Apply text to chart';
  $('textFitStatus').textContent='';requestDraw();
}
function placeTextAt(cell){
  placingText=false;
  $('placeText').setAttribute('aria-pressed','false');
  $('textCol').value=cell.col;$('textRow').value=cell.row;
  buildTextPreview();
}
function editLastText(){
  if(!active||pendingConversion||editBlocked('edit lettering'))return;
  const selectedLayer=chosenLayer();
  const l=selectedLayer?.type==='text'?selectedLayer:[...(active.layers||[])].reverse().find(l=>l.type==='text');
  if(!l){toast('There is no editable text layer yet.');return;}
  if(l.locked){toast('Unlock this lettering in Editable Layers before editing it.');return;}
  selectedLayerId=l.id;renderLayers();$('layerEdit').click();
  $('textInput').focus();
}

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
  putTextOnLayer();
}

function nudgeText(dx,dy){
  $('textCol').value=String(clamp((Number($('textCol').value)||1)+dx,1,active.cols));
  $('textRow').value=String(clamp((Number($('textRow').value)||1)+dy,1,active.rows));
  if(textPreview)buildTextPreview();
}
function colorRasterForProject(colors){
 if(pixelPreviewCache?.revision===renderRevision&&pixelPreviewCache?.project===active)return pixelPreviewCache.canvas;
 const c=document.createElement('canvas');c.width=active.cols;c.height=active.rows;
 const g=c.getContext('2d',{alpha:false});
 for(let r=0;r<active.rows;r++)for(let col=0;col<active.cols;col++){
   const paletteIndex=colors[r*active.cols+col];g.fillStyle=active.palette[paletteIndex]?.hex||'#ffffff';g.fillRect(col,r,1,1);
 }
 pixelPreviewCache={revision:renderRevision,project:active,canvas:c};return c;
}
function tileForProject(tx,ty,colors){
 const key=renderRevision+':'+tx+':'+ty;
 const existing=tileCache.get(key);
 if(existing){tileCache.delete(key);tileCache.set(key,existing);return existing;}
 const c=document.createElement('canvas'),left=tx*TILE_SIDE,top=ty*TILE_SIDE;
 c.width=Math.min(TILE_SIDE,active.cols-left)*CELL;c.height=Math.min(TILE_SIDE,active.rows-top)*CELL;
 const g=c.getContext('2d',{alpha:false});
 for(let y=0;y<c.height/CELL;y++)for(let x=0;x<c.width/CELL;x++){
   g.fillStyle=active.palette[colors[(top+y)*active.cols+left+x]]?.hex||'#ffffff';g.fillRect(x*CELL,y*CELL,CELL,CELL);
 }
 tileCache.set(key,c);
 if(tileCache.size>MAX_CACHED_TILES)tileCache.delete(tileCache.keys().next().value);
 return c;
}
function drawCachedChartColors(g,s,cols,rows,colors,preview,minCol,maxCol,minRow,maxRow){
 if(preview||cols!==active.cols||rows!==active.rows){
   const palette=preview?.palette||active.palette;
   for(let row=minRow;row<maxRow;row++)for(let col=minCol;col<maxCol;col++){
     g.fillStyle=palette[colors[row*cols+col]]?.hex||'#fff';g.fillRect(M+col*CELL,M+row*CELL,CELL,CELL);
   }
   return;
 }
 g.save();g.imageSmoothingEnabled=false;
 if(s*CELL<5){
   g.drawImage(colorRasterForProject(colors),M,M,cols*CELL,rows*CELL);
 }else{
   const startX=Math.floor(minCol/TILE_SIDE),endX=Math.ceil(maxCol/TILE_SIDE);
   const startY=Math.floor(minRow/TILE_SIDE),endY=Math.ceil(maxRow/TILE_SIDE);
   for(let y=startY;y<endY;y++)for(let x=startX;x<endX;x++){
     const tile=tileForProject(x,y,colors);
     g.drawImage(tile,M+x*TILE_SIDE*CELL,M+y*TILE_SIDE*CELL);
   }
 }
 g.restore();
}
function drawScene(ctx,canvasWidth,canvasHeight,view){
  const dpr=Math.min(devicePixelRatio||1,2);
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#ede7f2';ctx.fillRect(0,0,canvasWidth,canvasHeight);
  if(!active)return;
  const s=view.scale,{cols,rows}=displayDimensions(),bw=cols*CELL,bh=rows*CELL;
  ctx.save();ctx.translate(view.x,view.y);ctx.scale(s,s);
  const labelMargin=Math.max(42,32*(Number(v16Prefs.numberScale)||1)/s);
  ctx.fillStyle='#fff';ctx.fillRect(M-labelMargin,M-labelMargin,bw+labelMargin*2,bh+labelMargin*2);
  const minCol=clamp(Math.floor(((-view.x/s)-M)/CELL),0,cols),maxCol=clamp(Math.ceil(((canvasWidth-view.x)/s-M)/CELL),0,cols);
  const minRow=clamp(Math.floor(((-view.y/s)-M)/CELL),0,rows),maxRow=clamp(Math.ceil(((canvasHeight-view.y)/s-M)/CELL),0,rows);
  if(referenceImg&&active.opacity>0&&!active.converted){
    ctx.save();ctx.globalAlpha=active.opacity;renderCroppedImage(ctx,referenceImg,M,M,bw,bh);ctx.restore();
  }
  const displayedConversion=pendingConversion?.projectId===active.id?pendingConversion:null;
  const composedColors=displayedConversion?.cells||composedCells(active);
  if(active.converted||displayedConversion||active.layers?.length){
    drawCachedChartColors(ctx,s,cols,rows,composedColors,displayedConversion,minCol,maxCol,minRow,maxRow);
    if(referenceImg&&active.opacity>0){
      ctx.save();ctx.globalAlpha=active.opacity*.2;renderCroppedImage(ctx,referenceImg,M,M,bw,bh);ctx.restore();
    }
  }
  if(motifPreview&&!pendingConversion){
    const {clip,col,row}=motifPreview;
    ctx.save();ctx.globalAlpha=.55;
    for(let y=0;y<clip.height&&row-y>=1;y++)for(let x=0;x<clip.width&&col+x<=cols;x++){
      ctx.fillStyle=clip.palette[clip.colors[y*clip.width+x]];
      ctx.fillRect(M+(col+x-1)*CELL+1,M+(rows-row+y)*CELL+1,CELL-2,CELL-2);
    }
    ctx.restore();
    ctx.strokeStyle='#6133c8';ctx.lineWidth=2/s;
    ctx.strokeRect(M+(col-1)*CELL,M+(rows-row)*CELL,Math.min(clip.width,cols-col+1)*CELL,Math.min(clip.height,row)*CELL);
  }
  if(document.body.classList.contains('crochet-view')&&!pendingConversion&&!active.guide.finished){
    const {row,position}=active.guide;
    const run=Pattern.runForPosition(compositeProject(active),row,position);
    const col=Pattern.colAt(active,row,position),end=Pattern.colAt(active,row,run.lastStep);
    const y=M+(rows-row)*CELL,x=M+(col-1)*CELL;
    ctx.fillStyle='#7251b233';
    ctx.fillRect(M+(Math.min(col,end)-1)*CELL,y,(Math.abs(col-end)+1)*CELL,CELL);
    ctx.strokeStyle='#3f2184';ctx.lineWidth=3/s;ctx.strokeRect(x,y,CELL,CELL);
  }
  if(textPreview&&!pendingConversion){
    drawTextPreviewOverlay(ctx,textPreview,cols,rows);
  }
  if(selected&&!pendingConversion){
    ctx.fillStyle=v16Prefs.highContrast?'rgba(94,34,175,.40)':'rgba(124,89,206,.21)';
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
  if($('spotlightMode')?.checked&&!displayedConversion){
    const focus=active.guide?.row||selected?.row||1,ry=rows-focus;
    ctx.fillStyle='rgba(29,18,43,.32)';
    if(ry>0)ctx.fillRect(M,M,bw,ry*CELL);
    if(ry<rows-1)ctx.fillRect(M,M+(ry+1)*CELL,bw,(rows-ry-1)*CELL);
  }
  if(pendingCleanup&&!displayedConversion){
    ctx.fillStyle='rgba(255,154,34,.42)';for(const [i] of pendingCleanup){const col=i%cols,row=Math.floor(i/cols);ctx.fillRect(M+col*CELL,M+row*CELL,CELL,CELL);}
  }
  if(nextColorProposal?.length&&!displayedConversion){ctx.fillStyle='rgba(255,188,51,.5)';for(const [i] of nextColorProposal){const col=i%cols,row=Math.floor(i/cols);ctx.fillRect(M+col*CELL,M+row*CELL,CELL,CELL);}}
  // Every grid boundary continues through the row/column-number margins.
  ctx.strokeStyle=v16Prefs.highContrast?'#241331':'#9c8ea7';ctx.lineWidth=(v16Prefs.highContrast?1.5:.75)/s;ctx.beginPath();
  for(let c=minCol;c<=maxCol;c++){
    const x=M+c*CELL;ctx.moveTo(x,M-35);ctx.lineTo(x,M+bh+35);
  }
  for(let r=minRow;r<=maxRow;r++){
    const y=M+r*CELL;ctx.moveTo(M-35,y);ctx.lineTo(M+bw+35,y);
  }
  ctx.stroke();
  ctx.strokeStyle=v16Prefs.highContrast?'#1b0e2e':'#6d578e';ctx.lineWidth=(v16Prefs.highContrast?2.5:1.8)/s;ctx.strokeRect(M,M,bw,bh);
  drawNextChartOverlays(ctx,cols,rows,s);
  v16DrawOverlays(ctx,cols,rows,s,minCol,maxCol,minRow,maxRow);
  if((active.converted||displayedConversion||active.layers?.length) && CELL*s>=(v16Prefs.symbols?9:16)){
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 12px system-ui';
    for(let r=minRow;r<maxRow;r++)for(let c=minCol;c<maxCol;c++){
      const i=r*cols+c,rowNum=rows-r;
      if(showProgressOverlay&&!displayedConversion&&(active.done[i]||active.rowDone[rowNum-1]))continue;
      const color=(displayedConversion?.palette||active.palette)[composedColors[i]]||DEFAULT_COLORS[0];
      const rHex=parseInt(color.hex.slice(1,3),16),gHex=parseInt(color.hex.slice(3,5),16),bHex=parseInt(color.hex.slice(5,7),16);
      ctx.fillStyle=(rHex*.299+gHex*.587+bHex*.114)>145?'#312b3d':'#fff';
      ctx.fillText(color.symbol,M+(c+.5)*CELL,M+(r+.5)*CELL);
    }
  }
  if(selected&&!pendingConversion){
    const x=M+(selected.col-1)*CELL,y=M+(rows-selected.row)*CELL;
    ctx.strokeStyle=v16Prefs.highContrast?'#1b0e2e':'#6133c8';ctx.lineWidth=(v16Prefs.highContrast?4:2.8)/s;ctx.strokeRect(x+1/s,y+1/s,CELL-2/s,CELL-2/s);
  }
  if(areaSelection&&!pendingConversion){
    const left=Math.min(areaSelection.start.col,areaSelection.end.col),right=Math.max(areaSelection.start.col,areaSelection.end.col);
    const bottom=Math.min(areaSelection.start.row,areaSelection.end.row),top=Math.max(areaSelection.start.row,areaSelection.end.row);
    const x=M+(left-1)*CELL,y=M+(rows-top)*CELL,w=(right-left+1)*CELL,h=(top-bottom+1)*CELL;
    ctx.fillStyle='rgba(135,81,205,.16)';ctx.fillRect(x,y,w,h);
    ctx.strokeStyle='#a04aea';ctx.lineWidth=2/s;ctx.setLineDash([6/s,3/s]);ctx.strokeRect(x,y,w,h);ctx.setLineDash([]);
  }
  // At large zoom, show EVERY number. At fit-scale, space labels to keep them legible.
  const numberScale=[1,1.5,2].includes(Number(v16Prefs.numberScale))?Number(v16Prefs.numberScale):1;
  const interval=Math.max(1,Math.ceil(15*numberScale/(CELL*s))),columnInterval=Math.max(1,Math.ceil(32*numberScale/(CELL*s)));
  const fontWorld=10*numberScale/s;ctx.font=`bold ${fontWorld}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';
  const highlightedX=selected&&!pendingConversion?selected.col-1:-1, highlightedY=selected&&!pendingConversion?rows-selected.row:-1;
  for(let c=minCol;c<maxCol;c++){
    if(c%columnInterval!==0&&c!==highlightedX&&c!==cols-1)continue;
    if(c!==highlightedX&&highlightedX>=0&&Math.abs(c-highlightedX)*CELL*s<28*numberScale)continue;
    if(c!==cols-1&&c!==highlightedX&&(cols-1-c)*CELL*s<28*numberScale)continue;
    const x=M+(c+.5)*CELL,num=String(c+1),chosen=c===highlightedX;
    if(chosen){ctx.fillStyle=v16Prefs.highContrast?'#29134d':'#e9dcff';ctx.fillRect(x-11*numberScale/s,M-22*numberScale/s,22*numberScale/s,20*numberScale/s);ctx.fillRect(x-11*numberScale/s,M+bh+2*numberScale/s,22*numberScale/s,20*numberScale/s);}
    ctx.fillStyle=chosen?(v16Prefs.highContrast?'#fff':'#5f32bb'):'#695b77';ctx.fillText(num,x,M-12*numberScale/s);ctx.fillText(num,x,M+bh+12*numberScale/s);
  }
  for(let r=minRow;r<maxRow;r++){
    const row=rows-r,chosen=r===highlightedY;
    if((row-1)%interval!==0&&!chosen&&row!==rows)continue;
    if(!chosen&&highlightedY>=0&&Math.abs(r-highlightedY)*CELL*s<13*numberScale)continue;
    const y=M+(r+.5)*CELL,num=String(row);
    if(chosen){ctx.fillStyle=v16Prefs.highContrast?'#29134d':'#e9dcff';ctx.fillRect(M-31*numberScale/s,y-10*numberScale/s,27*numberScale/s,20*numberScale/s);ctx.fillRect(M+bw+4*numberScale/s,y-10*numberScale/s,27*numberScale/s,20*numberScale/s);}
    ctx.fillStyle=chosen?(v16Prefs.highContrast?'#fff':'#5f32bb'):'#695b77';ctx.fillText(num,M-18*numberScale/s,y);ctx.fillText(num,M+bw+18*numberScale/s,y);
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
  const stamp=performance.now();
  drawScene(ctx,canvasWidth,canvasHeight,view);
  if(!active||$('overviewPane').hidden){drawLast=performance.now()-stamp;drawSamples++;drawTotal+=drawLast;return;}
  const rect=overviewCanvas.getBoundingClientRect(), w=Math.max(1,rect.width),h=Math.max(1,rect.height);
  const dpr=Math.min(devicePixelRatio||1,2);
  const pixelW=Math.round(w*dpr),pixelH=Math.round(h*dpr);
  if(overviewCanvas.width!==pixelW||overviewCanvas.height!==pixelH){overviewCanvas.width=pixelW;overviewCanvas.height=pixelH;}
  const dims=displayDimensions();
  const margin=64*(Number(v16Prefs.numberScale)||1);
  const s=Math.min((w-24)/boardWidth(),(h-24)/boardHeight(),Math.max(1,w-margin)/(dims.cols*CELL),Math.max(1,h-margin)/(dims.rows*CELL));
  overviewView={scale:s,x:(w-boardWidth()*s)/2,y:(h-boardHeight()*s)/2};
  const g=overviewCanvas.getContext('2d');drawScene(g,w,h,overviewView);
  if(!active)return;
  // Clip the working viewport rectangle to the chart board.
  const x=Math.max(0,-view.x/view.scale),y=Math.max(0,-view.y/view.scale);
  const right=Math.min(boardWidth(),(canvasWidth-view.x)/view.scale),bottom=Math.min(boardHeight(),(canvasHeight-view.y)/view.scale);
  if(right>x&&bottom>y){g.save();g.setTransform(dpr,0,0,dpr,0,0);g.strokeStyle='#d23f17';g.lineWidth=2;g.setLineDash([6,3]);g.strokeRect(overviewView.x+x*s,overviewView.y+y*s,(right-x)*s,(bottom-y)*s);g.restore();}
  drawLast=performance.now()-stamp;drawSamples++;drawTotal+=drawLast;
}
function makeMarkStroke(cell,pointerId){
  const complete=active.done[indexFor(cell.col,cell.row)]||active.rowDone[cell.row-1];
  const start=(active.rows-cell.row)*active.cols;
  const rowComplete=active.rowDone[cell.row-1]||active.done.slice(start,start+active.cols).every(Boolean);
  return {pointerId,tool:progressBrush,color:Number(!(progressBrush==='row'?rowComplete:complete)),first:cell,last:cell,snapshotted:false};
}
function navigateOverview(ev){
  if(!active||pendingConversion)return;
  const r=overviewCanvas.getBoundingClientRect(),v=overviewView;
  const wx=(ev.clientX-r.left-v.x)/v.scale,wy=(ev.clientY-r.top-v.y)/v.scale;
  const col=Math.floor((wx-M)/CELL)+1,row=active.rows-Math.floor((wy-M)/CELL);
  if(col<1||col>active.cols||row<1||row>active.rows)return;
  if(motifPreview){if(ev.type==='pointerdown')moveMotifPreview(col,row);return;}
  if(placingText){if(ev.type==="pointerdown")placeTextAt({col,row});return;}
  if(progressBrush){
    const cell={col,row};
    if(ev.type==="pointerdown"&&!overviewStroke)overviewStroke=makeMarkStroke(cell,ev.pointerId);
    if(overviewStroke?.pointerId===ev.pointerId){brushSegment(overviewStroke.last,cell,overviewStroke);overviewStroke.last=cell;}
    return;
  }
  selected={col,row};view.x=canvasWidth/2-wx*view.scale;view.y=canvasHeight/2-wy*view.scale;updateSelection();requestDraw();
}
overviewCanvas.addEventListener('pointerdown',ev=>{if(ignorePalmTouch(ev))return;overviewCanvas.setPointerCapture(ev.pointerId);navigateOverview(ev);});
overviewCanvas.addEventListener('pointermove',ev=>{if(ignorePalmTouch(ev))return;if(ev.buttons)navigateOverview(ev);});
for(const type of ['pointerup','pointercancel','lostpointercapture'])overviewCanvas.addEventListener(type,ev=>{if(overviewStroke?.pointerId===ev.pointerId)overviewStroke=null;});
overviewCanvas.addEventListener('keydown',ev=>{if(!active)return;const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};if(!moves[ev.key])return;ev.preventDefault();const [dc,dr]=moves[ev.key];selected={col:clamp((selected?.col||1)+dc,1,active.cols),row:clamp((selected?.row||1)+dr,1,active.rows)};view.x=canvasWidth/2-(M+(selected.col-.5)*CELL)*view.scale;view.y=canvasHeight/2-(M+(active.rows-selected.row+.5)*CELL)*view.scale;updateSelection();requestDraw();});

canvas.addEventListener('pointerdown',ev=>{
  if(ignorePalmTouch(ev))return;
  if(startLayerDrag(ev))return;
  if(ev.button!==0&&ev.pointerType==='mouse')return;
  canvas.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId,{x:ev.offsetX,y:ev.offsetY});
  if(pointers.size===1){
    areaStart=null;
    gesture={dragged:false,wasMulti:false,lastDist:0,lastMid:null,totalTravel:0};
    const cell=screenToStitch(ev.offsetX,ev.offsetY);
    const touchSafe=!!motifPreview||placingText||(uiSettings().stylusOnly&&ev.pointerType!=='pen');
    if(cell&&(editorTool==='rect'||editorTool==='area')&&!pendingConversion&&!touchSafe&&!progressBrush)areaStart=cell;
    paintStroke=cell&&(progressBrush||editorTool==='paint'||editorTool==='erase')&&!pendingConversion&&!placingText&&!motifPreview&&(progressBrush||!touchSafe)
      ?(progressBrush?makeMarkStroke(cell,ev.pointerId):{pointerId:ev.pointerId,tool:editorTool,color:Number($('paintColor').value),first:cell,last:cell,snapshotted:false,changed:false}):null;
  }
  if(pointers.size===2){
    paintStroke=null;areaStart=null; // two-finger pan/zoom must never leave accidental paint
    const ps=[...pointers.values()];gesture.wasMulti=true;
    gesture.lastDist=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);
    gesture.lastMid={x:(ps[0].x+ps[1].x)/2,y:(ps[0].y+ps[1].y)/2};
  }
});
canvas.addEventListener('pointermove',ev=>{
  if(ignorePalmTouch(ev))return;
  if(moveLayerDrag(ev))return;
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
  if(finishLayerDrag(ev))return;
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
      if(motifPreview){
        moveMotifPreview(cell.col,cell.row);
      }else if(placingText||(textPreview&&editorTool==="select"&&!progressBrush&&!isPatternLocked())){
        placeTextAt(cell);selected=cell;
      }else if(touchSafe){
        selected=cell;
      }else if(editorTool==='bucket'&&!pendingConversion){
        if(editBlocked('fill stitches')){}
        else {const target=Number($('paintColor').value),from=active.cells[indexFor(cell.col,cell.row)];
          if(from!==target){snapshot({label:'Fill connected region'});const n=window.DorettePattern.bucket(active,cell.col,cell.row,target);if(n){active.converted=true;scheduleSave();updateLegend();toast('Filled '+format(n)+' connected stitches.');}}}
      }else if(editorTool==='paste'&&!pendingConversion){
        if(editBlocked('paste stitches')){}
        else if(stitchClipboard)pasteClipboard(cell);
        else toast('Copy an area first.');
      }else if(editorTool==='pick'&&!pendingConversion){
        if(editBlocked('pick yarn colors')){}
        else {selected=cell;
          const color=active.cells[indexFor(cell.col,cell.row)];
          selectPaintColor(color,true);
          toast('Picked color '+active.palette[color].symbol+'; ready to paint.');}
      }else if(editorTool==='select'||editorTool==='pan')selected=cell;
      if(inCrochetView()&&!studioReadOnly&&selected===cell){
        active.guide={row:cell.row,position:Pattern.direction(active,cell.row)==='rtl'?active.cols-cell.col:cell.col-1,finished:false};
        scheduleSave();
      }
      updateSelection();requestDraw();
    }
  }

  paintStroke=null;areaStart=null;
  pointers.delete(ev.pointerId);
  if(pointers.size===0){gesture.lastDist=0;gesture.lastMid=null;}
}
canvas.addEventListener('pointerup',endPointer);
canvas.addEventListener('pointercancel',ev=>{if(layerGesture&&layerGesture.id===ev.pointerId){layerGesture=null;layerDragPreview=null;requestDraw();return;}paintStroke=null;areaStart=null;pointers.delete(ev.pointerId);});
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
  const paletteSize=$('paletteSize');
  if(!paletteSize.disabled)paletteSize.dataset.natural=paletteSize.value;
  paletteSize.disabled=s.mode!=='auto';
  paletteSize.value=s.mode==='print'?'4':s.mode==='grayscale'?$('grayCount').value:paletteSize.dataset.natural||'6';
  $('grayCount').disabled=s.mode!=='grayscale';
  $('paletteHelp').textContent=s.mode==='print'
    ? 'Print cleanup uses 4 yarn colors: dark, off-white, red and blue. Choose Natural image palette to adjust the number.'
    : s.mode==='grayscale'
      ? `Grayscale mode reduces the image to ${$('grayCount').value} shades between black and white.`
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
      ?window.DoretteAdvanced.grayscale(raster.values,Number($('grayCount').value)||3)
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
  $('applyConversion').textContent=safeEditsEnabled?'Apply to a separate copy':'Apply to current project';
  $('conversionPreview').hidden=false;
  updateLegend();updateSelection();updateChartSubtitle();fitChart();
  status('Preview only — no chart changes saved');
  toast('Preview ready. Zoom in to inspect small lettering.');
}
function sampledPhotoPixels(cols,rows){
 const sampling=document.createElement('canvas');sampling.width=cols*6;sampling.height=rows*6;
 const g=sampling.getContext('2d',{willReadFrequently:true});g.fillStyle='#fff';g.fillRect(0,0,sampling.width,sampling.height);
 renderCroppedImage(g,referenceImg,0,0,sampling.width,sampling.height);
 return g.getImageData(0,0,sampling.width,sampling.height).data;
}
function cancelImageJob(){
 if(!runningImageJob)return;
 runningImageJob.cancelled=true;
 clearTimeout(runningImageJob.timer);runningImageJob.worker?.terminate();runningImageJob.resolve?.(null);runningImageJob=null;
 $('backgroundJob').hidden=true;toast('Background operation cancelled. Your saved chart is unchanged.');
}
async function runImageJob(kind,data,fallback,label){
 if(runningImageJob)cancelImageJob();
 const box=$('backgroundJob'),progress=$('backgroundJobProgress');
 box.hidden=false;progress.value=0;$('backgroundJobLabel').textContent=label;
 const initialId=active?.id,revision=renderRevision;
 const settings=()=>JSON.stringify([$('paletteSize').value,$('grayCount').value,$('previewDimensions').value,$('cleanupThreshold').value,$('protectArea').checked,areaSelection]);
 const initialSettings=settings();
 const outdated=()=>active?.id!==initialId||renderRevision!==revision||settings()!==initialSettings;
 const session={cancelled:false,worker:null,resolve:null};
 runningImageJob=session;
 const finish=value=>{
   if(session.cancelled||runningImageJob!==session)return null;
   clearTimeout(session.timer);session.worker?.terminate();runningImageJob=null;box.hidden=true;
   if(outdated()){toast('Chart or settings changed. Discarded outdated results.');return null;}
   return value;
 };
 if(typeof Worker!=='undefined'&&/^https?:$/.test(location.protocol)){
   try{
     const result=await new Promise(resolve=>{
       session.resolve=resolve;
       const worker=new Worker('./image-worker.js?v=1.8.1');session.worker=worker;
       worker.onmessage=e=>{
         if(e.data?.type==='progress'){progress.value=e.data.percent||0;return;}
         resolve(e.data?.type==='done'?e.data.result:null);
       };
       worker.onerror=()=>resolve(null);worker.onmessageerror=()=>resolve(null);
       session.timer=setTimeout(()=>resolve(null),30000);
       worker.postMessage({kind,...data});
     });
     clearTimeout(session.timer);
     if(session.cancelled)return null;
     if(result!==null||outdated())return finish(result);
     session.worker?.terminate();session.worker=null;
   }catch(err){console.warn('Image worker unavailable, using in-page computation:',err);}
 }
 if(session.cancelled)return null;
 progress.value=35;
 await new Promise(resolve=>setTimeout(resolve,20));
 if(session.cancelled)return null;
 if(outdated())return finish(null);
 try{const answer=fallback();progress.value=100;return finish(answer);}
 catch(e){finish(null);throw e;}
}
async function buildConversionAsync(cols,rows){
 if(!active||!referenceImg||!validDimensions(cols,rows))throw Error('Valid image and dimensions required.');
 const s=conversionSettings();
 const data={pixels:sampledPhotoPixels(cols,rows),cols,rows,s,paletteSize:Number($('paletteSize').value),grayCount:Number($('grayCount').value)};
 const result=await runImageJob('convert',data,()=>buildConversion(cols,rows),'Converting image to stitches…');
 return result?{...result,cols,rows,projectId:active.id}:null;
}
async function convertImage(){
  if(!active?.referenceImage){requestSourcePhoto('preview a new stitch chart');return;}
  if(!referenceImg){toast('Source photo is loading. Try previewing again in a moment.');return;}
  try{
    const [cols,rows]=$('previewDimensions').value==='large'?[120,165]:[active.cols,active.rows];
    const result=await buildConversionAsync(cols,rows);
    if(result)previewResult(result);
  }catch(e){toast('Conversion failed: '+e.message);refreshSaveState();}
}

async function compareSizes(){
  if(!active?.referenceImage){requestSourcePhoto('compare chart sizes');return;}
  if(!referenceImg){toast('Source photo is loading. Try comparing again in a moment.');return;}
  try{
    const small=await buildConversionAsync(79,117);if(!small)return;
    const large=await buildConversionAsync(120,165);if(!large)return;
    comparisonResults={small,large};
    renderComparison($('compareSmallCanvas'),comparisonResults.small);
    renderComparison($('compareLargeCanvas'),comparisonResults.large);
    $('compareSmallLabel').textContent=`79 × 117 • 9,243 stitches • ${small.palette.length} colors`;
    $('compareLargeLabel').textContent=`120 × 165 • 19,800 stitches • ${large.palette.length} colors`;
    $('compareDialog').showModal();refreshSaveState();
  }catch(e){toast('Comparison failed: '+e.message);refreshSaveState();}
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
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=Object.create(null);let i=0,count=0;
  const entries=new Map();
  while(i+30<=bytes.length&&view.getUint32(i,true)===0x04034b50){
    if(++count>12)throw new Error('Too many files in backup');
    const flags=view.getUint16(i+6,true),method=view.getUint16(i+8,true);
    if(flags!==0||method!==0)throw new Error('Unsupported ZIP: use a backup exported by this app');
    const checksum=view.getUint32(i+14,true),len=view.getUint32(i+18,true),size=view.getUint32(i+22,true);
    const nameLen=view.getUint16(i+26,true),extraLen=view.getUint16(i+28,true),start=i+30+nameLen+extraLen;
    if(len!==size||len>45*1024*1024||start+len>bytes.length)throw new Error('Corrupt or oversized ZIP entry');
    const name=textDecoder.decode(bytes.subarray(i+30,i+30+nameLen)),content=bytes.subarray(start,start+len);
    if(crc32(content)!==checksum)throw new Error('Backup integrity check failed (CRC-32)');
    if(Object.hasOwn(files,name))throw new Error('Backup ZIP contains duplicate entries');
    entries.set(i,{name,checksum,len});
    files[name]=content;i=start+len;
  }
  const directoryStart=i;
  const invalidDirectory=()=>new Error('Backup ZIP directory is missing, incomplete, or inconsistent');
  while(i+46<=bytes.length&&view.getUint32(i,true)===0x02014b50){
    const nameLen=view.getUint16(i+28,true),extraLen=view.getUint16(i+30,true),commentLen=view.getUint16(i+32,true);
    const next=i+46+nameLen+extraLen+commentLen;
    const offset=view.getUint32(i+42,true),entry=entries.get(offset);
    if(next>bytes.length||!entry||view.getUint16(i+8,true)!==0||view.getUint16(i+10,true)!==0||
      view.getUint16(i+34,true)!==0||view.getUint32(i+16,true)!==entry.checksum||
      view.getUint32(i+20,true)!==entry.len||view.getUint32(i+24,true)!==entry.len||
      textDecoder.decode(bytes.subarray(i+46,i+46+nameLen))!==entry.name)throw invalidDirectory();
    entries.delete(offset);i=next;
  }
  if(entries.size||i+22>bytes.length||view.getUint32(i,true)!==0x06054b50||
    view.getUint32(i+4,true)!==0||view.getUint16(i+8,true)!==count||view.getUint16(i+10,true)!==count||
    view.getUint32(i+12,true)!==i-directoryStart||view.getUint32(i+16,true)!==directoryStart||
    i+22+view.getUint16(i+20,true)!==bytes.length)throw invalidDirectory();
  return files;
}
function backupPayload(items,organization){return {app:'dorette-crochet-studio',version:1,exportedAt:new Date().toISOString(),projects:items,...(organization?{organization}: {})};}
function slug(name){return (name||'crochet-chart').trim().replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,45)||'crochet-chart';}
async function download(blob,name){
  if(window.StudioMobile?.nativeFiles){
    try{
      const saved=await window.StudioMobile.save(blob,name);
      toast(saved?'File saved: '+name:'Export canceled.');
    }catch(error){toast('Could not save file: '+error.message);}
    return;
  }
  const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function pdfSettings(){
  return {paper:$('pdfPaper').value,orientation:$('pdfOrientation').value,
    extraPages:$('pdfExtraPages').checked,sectionSize:Number($('workSectionSize').value)||25,notes:[active?.notes||'',...(active?.annotations||[]).map(n=>`${v16NoteLocation(n)}: ${n.text}`)].filter(Boolean).join('\n').slice(0,1500),
    detail:$('pdfDetail').value,overlap:Number($('pdfOverlap').value),monochrome:$('pdfMonochrome').checked,completed:$('pdfCompleted').checked};
}
function updatePdfEstimate(){
  if(!active||!window.DorettePdf)return;
  try{
    const info=window.DorettePdf.plan(compositeProject(active),pdfSettings());
    $('pdfPages').textContent=`${info.pages} pages: 1 overview + 1 yarn legend + ${info.across*info.down} numbered sections${info.extraPages?' + checklist and notes':''} (${info.across} across × ${info.down} down). ${info.overlap?`Up to ${info.overlap} repeated stitches on shared edges, outside purple outline (reference only). May increase pages.`:'No repeated stitches.'}`;
  }catch(e){$('pdfPages').textContent='Cannot prepare the PDF: '+e.message;}
}
function runPdfJob(kind){
 if(!active||!window.DorettePdf)return toast('PDF engine not ready. Reload all app files.');
 const isWritten=kind==='written',button=$(isWritten?'exportWrittenPdf':'exportPdf');
 if(button.disabled)return;
 const checked=compositeProject(active),audit=reliability.auditExport(active,checked.cells);
 if(!audit.ok)return toast('Export stopped: '+audit.errors[0]);
 const project=structuredClone(checked),settings=pdfSettings(),filename=`${slug(active.name)}-${isWritten?'Written-Rows':'Crochet-Chart'}.pdf`;
 button.disabled=true;const originalText=button.textContent;button.textContent='Preparing PDF…';
 let finished=false,worker=null,timer=null,fallbackStarted=false;
 const done=(result,error)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   if(worker){worker.terminate();worker=null;}
   if(error){toast('PDF export failed: '+error.message);console.error(error);}
   else if(!reliability.verifyPdf(result.bytes))toast('PDF export failed a file signature check.');
   else {download(new Blob([result.bytes],{type:'application/pdf'}),filename);if(!window.StudioMobile?.nativeFiles)toast(`${result.pages}-page PDF downloaded. Saved chart unchanged.`);}
   button.disabled=false;button.textContent=originalText;
 };
 const fallback=()=>{
   if(fallbackStarted||finished)return;fallbackStarted=true;clearTimeout(timer);
   if(worker){worker.terminate();worker=null;}
   setTimeout(()=>{
   try{const result=isWritten?window.DorettePdf.buildWritten(project,settings):window.DorettePdf.build(project,settings);done(result,null);}
   catch(e){done(null,e);}
 },40);};
 if(typeof Worker==='undefined'||!/^https?:$/.test(location.protocol)){fallback();return;}
 try{
   worker=new Worker('./pdf-worker.js?v=1.8.1');
   worker.onmessage=ev=>{if(ev.data?.error||!reliability.verifyPdf(ev.data?.bytes))fallback();else done(ev.data,null);};
   worker.onerror=fallback;worker.onmessageerror=fallback;
   timer=setTimeout(fallback,30000);
   worker.postMessage({kind,project,settings});
 }catch(e){if(worker){worker.terminate();worker=null;}fallback();}
}
function exportPdf(){runPdfJob('chart');}
const workspacePreferenceKeys={
  sections:'studio.settings.layout.v1',tools:'studio.tool.shortcuts.v1',panels:'studio.panel.visibility.v1',
  display:'dorette-display-v16',chart:'dorette-chart-layout'
};
function sanitizeWorkspacePreferences(input){
  if(!input||typeof input!=='object'||input.version!==1)return null;
  const result={version:1};
  const strings=list=>Array.isArray(list)?[...new Set(list.filter(v=>typeof v==='string'&&v.length<=100))].slice(0,100):[];
  if(input.sections&&typeof input.sections==='object'&&!Array.isArray(input.sections)){
    const {order,collapsed,favorites}=input.sections;
    if([order,collapsed,favorites].every(Array.isArray))result.sections={order:strings(order),collapsed:strings(collapsed),favorites:strings(favorites)};
  }
  if(input.tools&&typeof input.tools==='object'){
    const {favorites,recent}=input.tools;
    if([favorites,recent].every(Array.isArray))result.tools={favorites:strings(favorites),recent:strings(recent).slice(0,6)};
  }
  if(input.panels&&typeof input.panels.projects==='boolean'&&typeof input.panels.settings==='boolean'){
    result.panels={projects:input.panels.projects,settings:input.panels.settings};
  }
  if(input.display&&['beginner','advanced'].includes(input.display.mode)){
    const d=input.display;
    result.display={mode:d.mode,highContrast:d.highContrast===true,cues:d.cues===true,symbols:d.symbols===true,ruler:d.ruler===true,numberScale:[1,1.5,2].includes(d.numberScale)?d.numberScale:1};
  }
  if(['single','dual'].includes(input.chart))result.chart=input.chart;
  return Object.keys(result).length>1?result:null;
}
function exportWorkspacePreferences(){
  const prefs={version:1};
  for(const [key,storageKey] of Object.entries(workspacePreferenceKeys)){
    try{
      const value=localStorage.getItem(storageKey);
      if(value!==null)prefs[key]=key==='chart'?value:JSON.parse(value);
    }catch{}
  }
  return sanitizeWorkspacePreferences(prefs);
}
async function restoreWorkspacePreferences(input){
  const preferences=sanitizeWorkspacePreferences(input);
  if(!preferences||!confirm('Restore workspace preferences from this backup? Choose Cancel to keep this device’s current layout. Your projects have already been restored.'))return;
  await flushSave();
  if(needsSave())return toast('Workspace preferences could not be applied while a save is pending.');
  writeStandaloneSettings(localStorage,preferences,Object.keys(workspacePreferenceKeys));
  location.reload();
}

const standaloneSettingsId='com.deescrochetstudio.app.settings';
const settingsBackupLimit=256*1024;
const settingsCategories={
  sections:'Section order, expansion and favorites',tools:'Favorite and recent tools',
  panels:'Panel visibility',display:'Appearance and accessibility',chart:'Single or Dual Chart',
  safeEdits:'Safe-copy editing default',phoneControls:'Phone Crochet View toolbar',
  lettering:'Saved lettering styles',references:'Favorite reference shortcuts'
};
const standaloneKeys={...workspacePreferenceKeys,safeEdits:'dorette-safe-edits-opt-in',
  phoneControls:'studio.phone.crochet-controls.expanded',lettering:'dorette-text-styles-v1',references:'studio.crochet.references'};
function normalizeSettingsCategories(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Missing settings categories.');
  const values=sanitizeWorkspacePreferences({...input,version:1})||{};
  delete values.version;
  const skipped=[];
  for(const [key,value] of Object.entries(input)){
    if(Object.hasOwn(values,key))continue;
    if((key==='safeEdits'||key==='phoneControls')&&typeof value==='boolean'){values[key]=value;continue;}
    if(key==='references'&&Array.isArray(value)){
      values[key]=[...new Set(value.filter(v=>['symbols','terms','hooks','guild','yarnspirations','images'].includes(v)))].slice(0,50);
      if(values[key].length<value.length)skipped.push(settingsCategories[key]);
      continue;
    }
    if(key==='lettering'&&Array.isArray(value)){
      const options={textStyle:/^(regular|bold|outline)$/,letterSpacing:/^[0-3]$/,textWrap:/^(0|8|12|16)$/,textLayout:/^(straight|diagonal|curve)$/,textAngle:/^(0|90|180|270)$/,textDirection:/^(horizontal|vertical)$/,textScale:/^\d{1,3}$/,textWidth:/^\d{0,3}$/};
      values[key]=[];
      for(const entry of value.slice(0,35)){
        if(!entry||typeof entry.id!=='string'||entry.id.length>85||typeof entry.name!=='string'||entry.name.length>60||!entry.options||typeof entry.options!=='object')continue;
        const safe={};
        for(const [id,v] of Object.entries(entry.options)){
          if(Object.hasOwn(options,id)&&typeof v==='string'&&options[id].test(v)&&
             (id!=='textScale'||Number(v)>=5&&Number(v)<=100)&&(id!=='textWidth'||v===''||Number(v)>=1&&Number(v)<=100))safe[id]=v;
        }
        if(Object.keys(safe).length)values[key].push({id:entry.id,name:entry.name,options:safe});
      }
      if(values[key].length<value.length||value.some(entry=>Object.keys(entry?.options||{}).some(id=>!Object.hasOwn(options,id))))skipped.push(settingsCategories[key]);
      continue;
    }
    skipped.push(Object.hasOwn(settingsCategories,key)?settingsCategories[key]:'Unrecognized category');
  }
  return {values,skipped:[...new Set(skipped)]};
}
function readStandaloneSettings(storage){
  const data={};
  for(const [key,stored] of Object.entries(standaloneKeys)){
    const raw=storage.getItem(stored);
    if(raw===null)continue;
    try{data[key]=key==='chart'?raw:JSON.parse(raw);}catch{}
  }
  return normalizeSettingsCategories({chart:'dual',safeEdits:false,phoneControls:false,...data}).values;
}
async function settingsDigest(value){
  if(!globalThis.crypto?.subtle?.digest)throw Error('SHA-256 is unavailable in this environment. Open Studio in the installed app or a secure browser page.');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function decodeSettingsFile(raw){
  if(!raw||raw.application!==standaloneSettingsId||raw.format!==1||typeof raw.studioVersion!=='string'||
     raw.studioVersion.length>30||typeof raw.exportedAt!=='string'||!Number.isFinite(Date.parse(raw.exportedAt)))throw Error('Choose a supported Dee’s Crochet Studio settings file.');
  if(raw.sha256==null)throw Error('The settings file is missing its SHA-256 checksum.');
  if(typeof raw.sha256!=='string'||!/^[0-9a-f]{64}$/i.test(raw.sha256))throw Error('The settings file has an invalid SHA-256 checksum.');
  if(raw.sha256.toLowerCase()!==await settingsDigest(raw.categories))throw Error('The settings file failed its integrity check. Export a fresh copy and try again.');
  const result=normalizeSettingsCategories(raw.categories);
  if(!Object.keys(result.values).length)throw Error('The file has no supported settings to import.');
  return result;
}
function writeStandaloneSettings(storage,values,selected){
  const changes=Object.entries(values).filter(([key])=>selected.includes(key)&&Object.hasOwn(standaloneKeys,key))
    .map(([key,value])=>[standaloneKeys[key],key==='chart'?value:JSON.stringify(value)]);
  const before=changes.map(([key])=>[key,storage.getItem(key)]),written=[];
  try{
    for(let i=0;i<changes.length;i++){storage.setItem(...changes[i]);written.push(before[i]);}
  }catch(error){
    // Restore only keys changed by this import. Free space from newly created keys first.
    for(const [key,value] of written)if(value===null)storage.removeItem(key);
    for(const [key,value] of written.reverse())if(value!==null)storage.setItem(key,value);
    throw error;
  }
}

function setupStandaloneSettings(){
  const dialog=$('settingsImportDialog'),input=$('settingsImportFile'),list=$('settingsImportCategories');
  const status=$('settingsImportStatus'),apply=$('applySettingsImport');
  let pending=null;
  $('exportStandaloneSettings').onclick=async()=>{
    try{
      const categories=readStandaloneSettings(localStorage);
      categories.sections??={order:[...settingsSections.keys()],collapsed:[],favorites:[]};
      categories.tools??={favorites:[],recent:[]};
      categories.panels??={projects:$('toggleProjects').dataset.hidden==='1',settings:$('toggleSettings').dataset.hidden==='1'};
      categories.display??=sanitizeWorkspacePreferences({version:1,display:v16Prefs})?.display||{mode:'advanced',highContrast:false,cues:false,symbols:false,ruler:false,numberScale:1};
      categories.lettering??=[];categories.references??=[];
      const file={application:standaloneSettingsId,format:1,studioVersion:window.StudioRelease.version,
        exportedAt:new Date().toISOString(),categories,sha256:await settingsDigest(categories)};
      await download(new Blob([JSON.stringify(file,null,2)+'\n'],{type:'application/json'}),
        'Dees-Crochet-Studio-Settings-'+file.exportedAt.slice(0,10)+'.json');
    }catch(error){toast('Could not export settings: '+error.message);}
  };
  $('importStandaloneSettings').onclick=()=>input.click();
  input.onchange=async()=>{
    const file=input.files?.[0];input.value='';
    if(!file)return;
    try{
      if(file.size>settingsBackupLimit)throw Error('Settings files must be 256 KB or smaller.');
      pending=await decodeSettingsFile(JSON.parse(await file.text()));
      list.replaceChildren();
      for(const key of Object.keys(pending.values)){
        const row=document.createElement('label'),box=document.createElement('input');
        row.className='toggle';box.type='checkbox';box.value=key;box.checked=key!=='safeEdits';
        row.append(box,settingsCategories[key]);list.append(row);
      }
      status.textContent=pending.skipped.length?'Skipped: '+pending.skipped.join(', ')+'.':'';
      dialog.showModal();
    }catch(error){toast('Could not open settings: '+error.message);}
  };
  apply.onclick=async()=>{
    if(!pending||apply.disabled)return;
    const selected=[...list.querySelectorAll('input:checked')].map(box=>box.value);
    if(!selected.length){status.textContent='Choose at least one category.';return;}
    const {values}=pending;apply.disabled=true;
    try{
      await flushSave();await writeChain;
      if(needsSave())throw Error('Finish saving the open project before importing settings.');
      if(!dialog.open)return;
      writeStandaloneSettings(localStorage,values,selected);
      alert('Imported '+selected.length+' settings categories. Studio will reopen with your new preferences.');
      location.reload();
    }catch(error){status.textContent='Settings import did not complete. '+error.message;}
    finally{apply.disabled=false;}
  };
}

async function exportBackup(all=false, share=false, project=active){
  let unconfirmed=false;
  try{await flushSave();await writeChain;}catch{unconfirmed=true;}
  const items=all?[...projects.values()]:[project];
  if(!items.length||!items[0])return;
  unconfirmed||=memoryOnly||!!saveTimer||writePending>0||items.some(p=>failedWrites.has(p.id))||
    (all&&[...recycledProjects.keys()].some(id=>failedWrites.has(id)));
  if(unconfirmed&&!confirm('Local saving has not confirmed all changes. Export a ZIP of the current in-memory project data for recovery?'))return;
  const bad=(all?items.concat([...recycledProjects.values()]):items).map(p=>({id:p.id,report:reliability.auditProject(p)})).find(v=>!v.report.ok);
  if(bad){toast('Backup stopped: invalid project ('+bad.report.errors[0]+'). Open Diagnostics.');return;}
  const data=backupPayload(items,all?{categories:customCategories,recycleBin:[...recycledProjects.values()]}:undefined);
  if(all&&$('includeWorkspacePreferences').checked){
    const preferences=exportWorkspacePreferences();
    if(preferences)data.workspace=preferences;
  }
  const payload=JSON.stringify(data);
  const readme=`Dorette Crochet Studio backup\nExported: ${new Date().toISOString()}\nProjects: ${items.length}\n\nRestore using the Restore backup button inside Dorette Crochet Studio.\nThis ZIP includes backup.json with project data, progress, yarn colors, and any embedded reference images.\nDo not extract or modify the ZIP before restoring. Store a copy in Google Drive.\n`;
  const bytes=makeZip({'README.txt':readme,'backup.json':payload});
  const date=new Date().toISOString().slice(0,10);
  const filename=`Dorette-${all?'All-Projects':slug(project.name)}-${date}.zip`;
  const blob=new Blob([bytes],{type:'application/zip'});
  if(share==='prepare'){
    preparedProtectionBackup={blob,filename,id:project.id,revision:project.updatedAt};
    $('savePreparedBackup').disabled=false;
    $('confirmProtectionBackup').disabled=true;
    $('protectionExportStatus').textContent='ZIP ready. Choose Save or Share ZIP, then verify the file in your chosen destination.';
    return;
  }
  if(share){
    const file=new File([blob],filename,{type:blob.type});
    try{
      if(window.StudioMobile?.nativeFiles){await window.StudioMobile.share(blob,filename);return;}
      if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file]});return;}
    }catch(error){
      if(error.name!=='AbortError')toast('Could not share the ZIP. Use Back up this project to save a copy.');
      return;
    }
  }
  download(blob,filename);
  if(!window.StudioMobile?.nativeFiles)toast('ZIP download requested. Verify the file in Downloads or Files.');
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
    pinned:p.pinned===true,referenceMirrored:p.referenceMirrored===true,opacity:clamp(Number(p.opacity)||0,0,1),photoCrop:currentCrop(p),imagePlacement:p.imagePlacement==='stretch'?'stretch':'contain',conversionSettings:conversionSettings(p),converted:!!p.converted,...safe,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
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
    const restored=readProjectBackup(payload);
    const preferenceNote=sanitizeWorkspacePreferences(payload.workspace)
      ? ' You can choose whether to import workspace preferences after restoring the projects.' : '';
    const preview=`Backup verified. Restore ${restored.projects.length} active project(s) and ${restored.recycled.length} Recycle Bin project(s) as new copies? Existing projects will be kept.${preferenceNote}`;
    if(!confirm(preview))return;
    const saved=await organizeProjects(restored.projects.concat(restored.recycled),[],restored.categories,()=>{
      for(const project of restored.projects)projects.set(project.id,project);
      for(const project of restored.recycled)recycledProjects.set(project.id,project);
      if(restored.projects.length)selectProject(restored.projects[0].id);
    },{copies:true});
    if(saved){
      toast('Restored '+(restored.projects.length+restored.recycled.length)+' project(s) as new copies.');
      await restoreWorkspacePreferences(payload.workspace);
    }
  }catch(e){toast('Could not restore: '+e.message);}
}

async function removeActiveProject(){if(active)await recycleProject(active);}
// v1.0 - All computations use SAVED project cells; preview pixels never alter them.
const Pattern=window.DorettePattern;
window.StudioCurrentRowHelp=()=>{
  if(!active)return null;
  const row=selected?.row||active.guide?.row||1;
  const direction=Pattern.direction(active,row)==='rtl'?'Right to left':'Left to right';
  const chart=compositeProject(active);
  return {row,direction,runs:Pattern.runs(chart,row).map(run=>({
    count:run.count,yarn:chart.palette[run.color]?.name||'Yarn '+(run.color+1)
  }))};
};
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
  const row=clamp(Math.round(Number($('instructionRow').value)||1),1,active.rows),runs=Pattern.runs(compositeProject(active),row);
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
  const currentRun=Pattern.runForPosition(compositeProject(active),row,clamp(step,0,active.cols-1));
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
  const results=Pattern.estimate(compositeProject(active)),valid=Number(active.gauge.swatchYards)>0&&Number(active.gauge.swatchStitches)>0;
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
  v16ShapeProposal=null;
  $('shapeInfo').textContent='Preview the current selection before applying a shape.';
  v16MeasureArea();
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
function renderCrochetProgress(done,total){
  const cell=selected;
  if(!active||!cell)return;
  if(done===undefined)({done,total}=completionCounts(active));
  const start=(active.rows-cell.row)*active.cols;
  const rowMarked=!!active.rowDone[cell.row-1];
  let rowCount=rowMarked?active.cols:0;
  if(!rowMarked)for(let col=0;col<active.cols;col++)rowCount+=active.done[start+col]?1:0;
  $('dockProgress').textContent=`Row ${cell.row}, column ${cell.col} · ${rowCount}/${active.cols} in row · ${format(done)}/${format(total)} total · ${format(total-done)} remaining`;
  $('dockToggleStitch').textContent=rowMarked||active.done[start+cell.col-1]?'Unmark stitch':'Mark stitch';
  $('dockToggleRow').textContent=rowMarked?'Clear row mark':'Mark row';
  $('dockToggleStitch').disabled=$('dockToggleRow').disabled=!!pendingConversion||studioReadOnly;
}
function renderFocusRowColors(){
  if(!active||!inCrochetView())return;
  const {row,col}=selected||{row:active.guide.row,col:Pattern.colAt(active,active.guide.row,active.guide.position)};
  const rtl=Pattern.direction(active,row)==='rtl',step=rtl?active.cols-col:col-1;
  const runs=Pattern.runs(compositeProject(active),row);
  const current=runs.findIndex(run=>step<=run.lastStep),run=runs[current],next=runs[current+1];
  const offset=(active.rows-row)*active.cols;
  const complete=active.rowDone[row-1]||active.done.slice(offset,offset+active.cols).every(Boolean);
  $('focusRowSummary').textContent=` · Row ${row} of ${active.rows} · ${rtl?'Right to Left':'Left to Right'} · ${complete?'Complete':'In progress'}`;
  $('focusRowRuns').replaceChildren(...runs.map((part,index)=>{
    const color=active.palette[part.color],chip=document.createElement('span'),swatch=document.createElement('span');
    chip.className='run-chip'+(index===current?' current':index===current+1?' upcoming':'');
    if(index===current)chip.setAttribute('aria-current','step');
    swatch.className='run-swatch';swatch.style.background=color.hex;swatch.setAttribute('aria-hidden','true');
    chip.append(swatch,`${part.count} × ${color.symbol} · ${color.name}${index===current?' (current)':index===current+1?' (next)':''}`);
    return chip;
  }));
  const color=active.palette[run.color],upcoming=next&&active.palette[next.color];
  $('focusRowChange').textContent=`Stitch ${step+1} of ${active.cols} · ${run.lastStep-step+1} left in ${color.symbol} (${color.name}). ${next?`Next: ${next.count} × ${upcoming.symbol} (${upcoming.name}) after stitch ${run.lastStep+1}.`:'No more color changes in this row.'}`;
  $('focusRowPrev').disabled=row===1;$('focusRowNext').disabled=row===active.rows;
}
function renderGuide(){
  if(!active||($('guideDialog').hidden&&!document.body.classList.contains('crochet-view')))return;
  Pattern.ensure(active);
  renderFocusRowColors();
  const {guide:g}=active,row=g.row,pos=g.position;
  const dir=Pattern.direction(active,row),runs=Pattern.runs(compositeProject(active),row),col=Pattern.colAt(active,row,pos),idx=Pattern.physicalIndex(active,col,row),run=Pattern.runForPosition(compositeProject(active),row,pos);
  const completed=!!active.done[idx]||!!active.rowDone[row-1];
  $('focusFirstDirection').value=active.workDirection.first;
  $('focusAlternateRows').checked=active.workDirection.alternate;
  $('focusHighContrast').checked=!!v16Prefs.highContrast;
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
  $('guideRun').disabled=!!g.finished;
  $('dockStitch').disabled=!!g.finished;
  $('dockRun').disabled=!!g.finished;
  $('dockStatus').textContent=g.finished?'Chart finished':`Row ${row} · ${active.palette[run.color].name} · ${run.lastStep-pos+1} left in run`;
  $('phoneCrochetSummary').textContent=g.finished?'Chart finished':`Row ${row} · ${active.palette[run.color].name} · ${run.lastStep-pos+1} left`;
  const phoneControl=$('phoneCrochetControls');
  phoneControl.setAttribute('aria-label',(phoneControl.getAttribute('aria-expanded')==='true'?'Collapse':'Expand')+' crochet controls · '+$('phoneCrochetSummary').textContent);
  $('guideRun').textContent=g.finished?'Color run complete':`Complete color run (${run.lastStep-pos+1})`;
  $('guidePrevRow').disabled=row===1;$('guideNextRow').disabled=row===active.rows;
}
function focusGuideCell(){
  const g=active.guide;
  selected={row:g.row,col:Pattern.colAt(active,g.row,g.position)};
  const gx=M+(selected.col-.5)*CELL,gy=M+(active.rows-selected.row+.5)*CELL;
  if(gx*view.scale+view.x<20||gx*view.scale+view.x>canvasWidth-20||gy*view.scale+view.y<20||gy*view.scale+view.y>canvasHeight-20){view.x=canvasWidth/2-gx*view.scale;view.y=canvasHeight/2-gy*view.scale;}
  $('instructionRow').value=g.row;updateSelection();requestDraw();renderRowSequence();renderGuide();
}
function guideNext(wholeRun=false){
  if(!active||pendingConversion)return;
  const g=active.guide;if(g.finished)return;
  const end=wholeRun?Pattern.runForPosition(compositeProject(active),g.row,g.position).lastStep:g.position;
  progressSnapshot();
  for(let step=g.position;step<=end;step++){
    active.done[Pattern.physicalIndex(active,Pattern.colAt(active,g.row,step),g.row)]=1;
  }
  g.position=end;
  if(g.position<active.cols-1)g.position++;
  else if(g.row<active.rows){g.row++;g.position=0;}
  else g.finished=true;
  scheduleSave();updateProgress();focusGuideCell();
}
function guideBack(){
  if(!active||pendingConversion)return;
  progressSnapshot();
  const g=active.guide;g.finished=false;
  if(g.position>0)g.position--;else if(g.row>1){g.row--;g.position=active.cols-1;}
  scheduleSave();focusGuideCell();
}
function guideChangeRow(n){
  if(!active||pendingConversion)return;
  progressSnapshot();
  const g=active.guide;g.row=clamp(g.row+n,1,active.rows);g.position=0;g.finished=false;
  scheduleSave();focusGuideCell();
}
function exportWrittenPdf(){runPdfJob('written');}
function v16ValidateVersions(p){
  const arr=p.versions??[];
  if(!Array.isArray(arr)||arr.length>V16_MAX_VERSIONS)throw Error('Invalid saved project version history');
  return arr.map(entry=>{
    if(!entry||typeof entry.label!=='string'||entry.label.length>70||typeof entry.at!=='string'||!entry.data)throw Error('Invalid saved design version');
    const d=entry.data;
    if(!validDimensions(d.cols,d.rows)||!Array.isArray(d.cells)||d.cells.length!==d.cols*d.rows||
      !Array.isArray(d.done)||d.done.length!==d.cells.length||!Array.isArray(d.rowDone)||d.rowDone.length!==d.rows||
      !Array.isArray(d.palette)||d.palette.length<1||d.palette.length>12||
      d.palette.some(c=>!c||!/^#[0-9a-f]{6}$/i.test(c.hex)||typeof c.name!=='string'||c.name.length>80||typeof c.symbol!=='string'||c.symbol.length>3)||
      d.cells.some(x=>!Number.isInteger(x)||x<0||x>=d.palette.length)||d.done.some(x=>x!==0&&x!==1)||d.rowDone.some(x=>x!==0&&x!==1))throw Error('Invalid saved version chart data');
    const layers=validateLayers({...d, layers:d.layers||[]});
    return {id:String(entry.id||uid()).slice(0,80),label:entry.label,at:entry.at.slice(0,40),data:{cols:d.cols,rows:d.rows,cells:d.cells.slice(),done:d.done.slice(),rowDone:d.rowDone.slice(),palette:structuredClone(d.palette),layers,annotations:v16ValidateNotes(d),converted:!!d.converted}};
  });
}
function v16ValidateNotes(p){
  const arr=p.annotations??[];
  if(!Array.isArray(arr)||arr.length>V16_MAX_NOTES)throw Error('Invalid saved stitch notes');
  return arr.map(n=>{
    if(!n||!['stitch','row','section'].includes(n.scope)||!Number.isInteger(n.row)||n.row<1||n.row>300||
      !Number.isInteger(n.col)||n.col<1||n.col>200||typeof n.text!=='string'||n.text.length>280)throw Error('Invalid stitch note');
    return {id:String(n.id||uid()).slice(0,80),scope:n.scope,row:clamp(n.row,1,p.rows),col:clamp(n.col,1,p.cols),section:Number.isInteger(n.section)?n.section:null,text:n.text,at:String(n.at||'').slice(0,40)};
  });
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
  const savedVersions=v16ValidateVersions(p),savedNotes=v16ValidateNotes(p);
  const safe={workDirection:{first:direction.first==='ltr'?'ltr':'rtl',alternate:direction.alternate!==false},
    guide:{row:clamp(Math.round(Number(guide.row)||1),1,p.rows),position:clamp(Math.round(Number(guide.position)||0),0,p.cols-1),finished:!!guide.finished},
    gauge:{swatchStitches:Math.max(1,Number(gauge.swatchStitches)||100),swatchYards:Math.max(0,Number(gauge.swatchYards)||0),overage:clamp(Number(gauge.overage)||0,0,100)},
    yarnInfo:structuredClone(info),checkpoints:structuredClone(checkpoints),layers:validateLayers(p),technique:['rows','tapestry','single','c2c'].includes(p.technique)?p.technique:'rows',diagonalIndex:clamp(Math.floor(Number(p.diagonalIndex)||0),0,p.cols*p.rows-1),sectionSize:[20,25,30,40].includes(p.sectionSize)?p.sectionSize:25,category:normalizeCategory(p.category)||'Other',favorite:!!p.favorite,notes:String(p.notes||'').slice(0,1500),versions:savedVersions,annotations:savedNotes,ui:{showProgress:ui.showProgress!==false,patternLock:!!ui.patternLock,stylusOnly:!!ui.stylusOnly,largeTouch:!!ui.largeTouch}};
  return safe;
}
let guideHiddenBeforeFocus;
function setFocusGuide(open){
  $('guideDialog').hidden=!open;
  $('focusGuideDetails').setAttribute('aria-expanded',String(open));
  if(open)renderGuide();
}
function setupPhoneCrochetControls(){
  const key='studio.phone.crochet-controls.expanded',button=$('phoneCrochetControls');
  function apply(expanded){
    button.setAttribute('aria-expanded',String(expanded));
    button.setAttribute('aria-label',(expanded?'Collapse':'Expand')+' crochet controls · '+$('phoneCrochetSummary').textContent);
    document.body.classList.toggle('phone-crochet-expanded',expanded);
  }
  let expanded=false;
  try{expanded=localStorage.getItem(key)==='true';}catch{}
  apply(expanded);
  button.onclick=()=>{
    expanded=!expanded;
    apply(expanded);
    try{localStorage.setItem(key,String(expanded));}catch{}
  };
}
function setCrochetView(enabled){
  if(enabled&&(!active||pendingConversion))return toast('Finish the chart preview before opening Crochet View.');
  if(enabled===inCrochetView())return;
  document.body.classList.toggle('crochet-view',enabled);
  const nav=$('appNavigation');
  if(enabled)document.querySelector('.crochet-view-actions').append(nav);
  else document.querySelector('.topbar').insertBefore(nav,document.querySelector('.header-right'));
  $('focusGuideDetails').hidden=!enabled;
  $('focusGuideSettings').hidden=!enabled;
  void updateWakeLock();
  $('crochetView').setAttribute('aria-pressed',String(enabled));
  $('crochetView').textContent=enabled?'Exit Crochet View':'Crochet View';
  if(enabled&&active&&!pendingConversion){
    progressBrush=null;
    areaSelection=null;
    setTool('select');
    clearTextPreview();
    guideHiddenBeforeFocus=$('guideDialog').hidden;
    setFocusGuide(document.body.classList.contains('unpinned-dock'));
    resizeCanvas();
    focusGuideCell();
    $('crochetView').focus({preventScroll:true});
  }else{
    $('guideDialog').hidden=guideHiddenBeforeFocus;
    $('crochetView').focus({preventScroll:true});
  }
}

const motifKey='dorette-motifs-v1';
let motifs=[];
try{motifs=JSON.parse(localStorage.getItem(motifKey)||'[]');if(!Array.isArray(motifs))motifs=[];}catch{}
function renderMotifs(){
  $('motifChoice').replaceChildren(...motifs.map(m=>new Option(m.name,m.id)));
  for(const id of ['loadMotif','rotateMotif','flipMotif','deleteMotif'])$(id).disabled=!motifs.length;
}
function saveMotifs(next){
  try{localStorage.setItem(motifKey,JSON.stringify(next));}
  catch{return toast('Could not save the motif library on this device.');}
  motifs=next;renderMotifs();
}
function chosenMotif(){return motifs.find(m=>m.id===$('motifChoice').value);}
function clearMotifPreview(){
  motifPreview=null;
  $('motifPreviewTools').hidden=true;
  requestDraw();
}
function moveMotifPreview(col,row){
  if(!motifPreview||!active)return;
  motifPreview.col=clamp(col,1,active.cols);motifPreview.row=clamp(row,1,active.rows);
  const {clip}=motifPreview;
  $('motifStatus').textContent=`Column ${motifPreview.col} · Row ${motifPreview.row} · ${clip.width} × ${clip.height} stitches`;
  requestDraw();
}
function placeMotif(rotation=false,flip=false){
  const m=chosenMotif();
  if(!active||!m||pendingConversion||editBlocked('place a motif'))return;
  progressBrush=null;updateSelection();
  const clip=structuredClone(m.clip);
  if(rotation||flip){
    const width=rotation?clip.height:clip.width,height=rotation?clip.width:clip.height;
    const colors=Array.from({length:width*height},(_,i)=>{
      const x=i%width,y=Math.floor(i/width);
      return rotation?clip.colors[(clip.height-1-x)*clip.width+y]:clip.colors[y*clip.width+width-1-x];
    });
    saveMotifs(motifs.map(item=>item.id===m.id?{...m,clip:{...clip,width,height,colors}}:item));
    $('motifChoice').value=m.id;
  }
  const anchor=motifPreview||selected||{col:1,row:active.rows};
  clearTextPreview();
  setTool('select');
  motifPreview={clip:structuredClone(chosenMotif().clip),col:anchor.col,row:anchor.row};
  $('motifPreviewTools').hidden=false;
  moveMotifPreview(anchor.col,anchor.row);
  toast('Tap either chart to place the preview, then choose Apply motif.');
}
function pasteClipboard(cell,clip=stitchClipboard){
  if(clip.isMotif){
    if(cell.col+clip.width-1>active.cols||cell.row-clip.height+1<1)return toast('The motif does not fit here.');
    const used=new Set(clip.colors.map(i=>clip.palette[i]));
    const missing=[...used].filter(hex=>!active.palette.some(color=>color.hex.toLowerCase()===hex.toLowerCase()));
    if(active.palette.length+missing.length>SYMBOLS.length)return toast('This motif needs more yarn colors than the chart can hold.');
    snapshot();
    for(const hex of missing){
      const i=active.palette.length;
      active.palette.push({hex,name:'Motif yarn '+(i+1),symbol:SYMBOLS[i]});
    }
  }else snapshot();
  const changed=Pattern.paste(active,clip,cell.col,cell.row);
  if(changed||clip.isMotif){
    active.converted=true;scheduleSave();refreshInspector();
    toast('Pasted '+format(changed)+' stitches.');
  }else toast('No matching colors or space at this position.');
  return true;
}
function hookPatternEvents(){
  $('startHere').addEventListener('click',()=>{
    if(!active||!selected||pendingConversion)return toast('Select a stitch first.');
    const {row,col}=selected;
    progressSnapshot();
    active.guide={row,position:Pattern.direction(active,row)==='rtl'?active.cols-col:col-1,finished:false};
    scheduleSave();setCrochetView(true);
  });
  $('dockStitch').addEventListener('click',()=>guideNext());
  $('dockRun').addEventListener('click',()=>guideNext(true));
  $('dockToggleStitch').addEventListener('click',markStitch);
  $('dockToggleRow').addEventListener('click',markRow);
  $('undoProgress').addEventListener('click',undo);
  $('redoProgress').addEventListener('click',redo);
  $('goToCell').addEventListener('submit',ev=>{
    ev.preventDefault();
    if(!active||pendingConversion)return;
    const row=Number($('jumpRow').value),col=Number($('jumpCol').value);
    if(!Number.isInteger(row)||!Number.isInteger(col)||row<1||row>active.rows||col<1||col>active.cols){
      return toast('Enter a row from 1 to '+active.rows+' and a column from 1 to '+active.cols+'.');
    }
    selected={row,col};
    view.x=canvasWidth/2-(M+(col-.5)*CELL)*view.scale;
    view.y=canvasHeight/2-(M+(active.rows-row+.5)*CELL)*view.scale;
    updateSelection();requestDraw();
  });
  for(const [id,dx,dy] of [['motifUp',0,1],['motifDown',0,-1],['motifLeft',-1,0],['motifRight',1,0]]){
    $(id).addEventListener('click',()=>{if(motifPreview)moveMotifPreview(motifPreview.col+dx,motifPreview.row+dy);});
  }
  $('cancelMotif').addEventListener('click',clearMotifPreview);
  $('applyMotif').addEventListener('click',()=>{
    if(!motifPreview||pendingConversion||editBlocked('apply a motif'))return;
    applyMotifLayer();
  });
  $('crochetView').addEventListener('click',()=>setCrochetView(!document.body.classList.contains('crochet-view')));
  $('resumeCrochet').addEventListener('click',()=>setCrochetView(true));
  $('focusGuideDetails').addEventListener('click',()=>setFocusGuide($('guideDialog').hidden));
  window.addEventListener('keydown',ev=>{
    if(ev.key==='Escape'&&inCrochetView()&&!document.querySelector('dialog[open]'))setCrochetView(false);
  });
  $('saveMotif').addEventListener('click',()=>{
    if(!active||pendingConversion||!areaSelection)return toast('Select an area to save as a motif.');
    if(motifs.length>=30)return toast('The motif library holds up to 30 motifs.');
    const name=prompt('Name this motif:','New motif')?.trim().slice(0,60);
    if(!name)return;
    const {start,end}=areaSelection;
    const id=uid();
    saveMotifs([...motifs,{id,name,clip:Pattern.copyArea(compositeProject(active),start.col,start.row,end.col,end.row)}]);
    $('motifChoice').value=id;
  });
  $('loadMotif').addEventListener('click',()=>placeMotif());
  $('rotateMotif').addEventListener('click',()=>placeMotif(true));
  $('flipMotif').addEventListener('click',()=>placeMotif(false,true));
  $('deleteMotif').addEventListener('click',()=>{
    const m=chosenMotif();
    if(m&&confirm('Remove “'+m.name+'” from this device’s motif library?'))saveMotifs(motifs.filter(item=>item.id!==m.id));
  });
  renderMotifs();
  const changeDirection=(key,value)=>{
    if(!active||pendingConversion||studioReadOnly||active.workDirection[key]===value)return;
    const guide=active.guide;
    const col=Pattern.colAt(active,guide.row,guide.position);
    snapshot({label:'Progress: row direction'});
    active.workDirection[key]=value;
    $('rowFirstDirection').value=active.workDirection.first;
    $('rowAlternate').checked=active.workDirection.alternate;
    guide.position=Pattern.direction(active,guide.row)==='rtl'?active.cols-col:col-1;
    scheduleSave();renderRowSequence();renderGuide();requestDraw();
  };
  for(const id of ['rowFirstDirection','focusFirstDirection']){
    $(id).addEventListener('change',ev=>changeDirection('first',ev.target.value==='ltr'?'ltr':'rtl'));
  }
  for(const id of ['rowAlternate','focusAlternateRows']){
    $(id).addEventListener('change',ev=>changeDirection('alternate',ev.target.checked));
  }
  $('focusHighContrast').addEventListener('change',ev=>{
    $('highContrastGrid').checked=ev.target.checked;
    $('highContrastGrid').dispatchEvent(new Event('change'));
  });
  $('instructionRow').addEventListener('change',ev=>setInstructionRow(ev.target.value));
  $('rowPrev').addEventListener('click',()=>setInstructionRow(Number($('instructionRow').value)-1));
  $('rowNext').addEventListener('click',()=>setInstructionRow(Number($('instructionRow').value)+1));
  $('rowMarkDone').addEventListener('click',()=>{
    const row=Number($('instructionRow').value);progressSnapshot();active.rowDone[row-1]=active.rowDone[row-1]?0:1;
    scheduleSave();updateSelection();updateProgress();renderRowSequence();requestDraw();
  });
  $('openGuide').addEventListener('click',()=>{if(pendingConversion)return toast('Apply or discard the current chart preview first.');
    $('guideDialog').hidden=false;focusGuideCell();});
  $('closeGuide').addEventListener('click',()=>{
    if(inCrochetView()){setFocusGuide(false);$('focusGuideDetails').focus();}
    else $('guideDialog').hidden=true;
  });
  $('guideNext').addEventListener('click',()=>guideNext());$('guideRun').addEventListener('click',()=>guideNext(true));$('guidePrev').addEventListener('click',guideBack);
  $('guidePrevRow').addEventListener('click',()=>guideChangeRow(-1));$('guideNextRow').addEventListener('click',()=>guideChangeRow(1));
  for(const [field,key,min,max] of [['gaugeStitches','swatchStitches',1,100000],['gaugeYards','swatchYards',0,100000],['gaugeOverage','overage',0,100]]){
    $(field).addEventListener('change',()=>{let value=Number($(field).value);if(!Number.isFinite(value))value=min;value=clamp(value,min,max);snapshot();active.gauge[key]=value;$(field).value=value;scheduleSave();renderInventoryEstimates();});
  }
  $('copyArea').addEventListener('click',()=>{
    if(!areaSelection)return toast('Use Select area to drag across the desired stitches first.');
    const {start,end}=areaSelection;stitchClipboard=Pattern.copyArea(compositeProject(active),start.col,start.row,end.col,end.row);
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
    snapshot();Object.assign(active,{cols:cp.cols,rows:cp.rows,cells:cp.cells.slice(),done:cp.done.slice(),rowDone:cp.rowDone.slice(),palette:structuredClone(cp.palette),yarnInfo:structuredClone(cp.yarnInfo||[]),layers:structuredClone(cp.layers||[]),converted:true,referenceMirrored:cp.referenceMirrored===true});
    
    active.annotations=(cp.annotations||active.annotations||[]).filter(note=>note.row<=active.rows&&note.col<=active.cols).map(note=>DoretteNext.locateNote(note,active));
    active.guide={row:1,position:0};active.diagonalIndex=0;
    Pattern.ensure(active);areaSelection=null;selected=null;scheduleSave();refreshInspector();fitChart();toast('Snapshot restored; Undo is available.');
  });
}

// 1.4.0 new creative tools; all local and included in portable project ZIPs.
function validateLayers(p){
 const ls=Array.isArray(p.layers)?p.layers:[];
 if(ls.length>80)throw Error('Too many editable layers in project');
 for(const l of ls){if(!l||typeof l.name!=='string'||l.name.length>80||!Array.isArray(l.entries)||l.entries.length>p.cols*p.rows||
   l.entries.some(e=>!Array.isArray(e)||e.length!==2||!Number.isInteger(e[0])||e[0]<0||e[0]>=p.cols*p.rows||!Number.isInteger(e[1])||e[1]<0||e[1]>=p.palette.length))throw Error('Invalid editable layer in backup');}
 return ls.map(l=>({id:String(l.id||uid()).slice(0,85),name:l.name.slice(0,80),type:['text','shape'].includes(l.type)?l.type:'motif',visible:l.visible!==false,locked:!!l.locked,entries:l.entries.map(e=>e.slice()),source:l.source&&typeof l.source==='object'?structuredClone(l.source):null}));
}
function setLayerAndRefresh(layer,index=null){
 if(isPatternLocked()||pendingConversion)return toast('Unlock the chart and finish the preview before editing layers.');
 if(index===null&&(active.layers||[]).length>=80)return toast('The chart already has 80 layers.');
 snapshot();if(!Array.isArray(active.layers))active.layers=[];
 if(index!==null)active.layers[index]=layer;else active.layers.push(layer);
 selectedLayerId=layer.id;active.converted=true;pendingCleanup=null;scheduleSave();refreshInspector();requestDraw();
}
function chosenLayer(){return active?.layers?.find(l=>l.id===selectedLayerId)||null;}
function renderLayers(){
 const box=$('layerList');if(!box||!active)return;box.replaceChildren();
 const list=active.layers||[];
 if(!list.length){const p=document.createElement('p');p.className='muted';p.textContent='No editable layers yet. Apply text or a reusable motif to create one.';box.append(p);}
 for(let i=list.length-1;i>=0;i--){
  const l=list[i],line=document.createElement('div');line.className='layer-line'+(l.id===selectedLayerId?' selected':'');
  const choose=document.createElement('button');choose.type='button';choose.textContent=l.id===selectedLayerId?'●':'○';choose.title='Select layer';choose.setAttribute('aria-label','Select '+l.name);choose.setAttribute('aria-pressed',String(l.id===selectedLayerId));
  choose.onclick=()=>{selectedLayerId=l.id;renderLayers();};
  const label=document.createElement('div');label.innerHTML='';const strong=document.createElement('strong');strong.textContent=l.name;
  const small=document.createElement('small');small.textContent=`${l.type} · ${l.entries.length} stitches`;label.append(strong,small);label.onclick=choose.onclick;
  const visible=document.createElement('button');visible.type='button';visible.textContent=l.visible===false?'◯':'◉';visible.title=l.visible===false?'Show layer':'Hide layer';visible.setAttribute('aria-label',visible.title);
  visible.onclick=()=>{if(editBlocked('change layer visibility'))return;snapshot();l.visible=l.visible===false?true:false;scheduleSave();renderLayers();updateLegend();requestDraw();};
  const locked=document.createElement('button');locked.type='button';locked.className='layer-lock-state';locked.textContent=l.locked?'Layer locked':'Layer unlocked';locked.title=l.locked?'Unlock layer':'Lock layer';locked.setAttribute('aria-label',locked.textContent+' · '+locked.title+' '+l.name);locked.setAttribute('aria-pressed',String(!!l.locked));locked.disabled=isPatternLocked();
  locked.onclick=()=>{if(editBlocked('lock a layer'))return;snapshot();l.locked=!l.locked;scheduleSave();renderLayers();};
  line.append(choose,label,visible,locked);box.append(line);
 }
 const l=chosenLayer();
 const layerBrush=$('paintTextLayer');
 const brushAvailable=l?.type==='text'&&!l.locked&&l.visible!==false&&!isPatternLocked();
 layerBrush.disabled=!brushAvailable&&!layerBrush.checked;
 $('quickTextLayer').disabled=!list.some(layer=>layer.type==='text')||isPatternLocked();
 $('quickTextLayer').setAttribute('aria-pressed',String(layerBrush.checked));
 $('chartPaintTarget').textContent=isPatternLocked()?'Pattern Lock: Locked':layerBrush.checked
   ?(brushAvailable?'Paint / Erase: '+l.name:'Text layer painting paused'):'Paint / Erase: chart';
 $('layerInfo').textContent=l?`${l.name} (${l.type}): ${l.visible===false?'hidden':'visible'}, ${l.locked?'locked':'editable'}.`:'Select a layer to modify it.';
 if(layerBrush.checked)$('layerInfo').textContent+=!brushAvailable?' Layer painting paused. Turn it off to paint the chart.':' Paint and Erase affect only this text layer.';
 for(const id of ['layerUp','layerDown','layerEdit','layerDuplicate','layerFlatten','layerDelete','layerMoveUp','layerMoveLeft','layerMoveRight','layerMoveDown'])$(id).disabled=!l||isPatternLocked();
}
function shiftLayer(l,dx,dy){
 const bounds=layerBounds(l);
 if(!bounds)return;
 dx=clamp(dx,1-bounds.left,active.cols-bounds.right);
 dy=clamp(dy,1-bounds.bottom,active.rows-bounds.top);
 const map=[];for(const [i,c] of l.entries){const x=i%active.cols,y=Math.floor(i/active.cols),nx=x+dx,ny=y-dy;
  if(nx>=0&&nx<active.cols&&ny>=0&&ny<active.rows)map.push([ny*active.cols+nx,c]);}
 l.entries=map;
 if(l.source&&typeof l.source.col==='number'){l.source.col=clamp(l.source.col+dx,1,active.cols);l.source.row=clamp(l.source.row+dy,1,active.rows);}
}
function putTextOnLayer(){
 if(!active||pendingConversion||editBlocked('apply text'))return;
 const preview=buildTextPreview();if(!preview||preview.tooLarge||!preview.cells.length)return toast($('textFitStatus').textContent||'Preview text before applying.');
 const replace=editingLayerId?(active.layers||[]).findIndex(l=>l.id===editingLayerId):-1;
 const previous=active.layers?.[replace];
 if(editingLayerId&&(!previous||previous.locked))return toast('Select an unlocked text layer before updating it.');
 if((!previous||previous.source?.color!==preview.color)&&letterColorDistance(active.palette[preview.color],active.palette[0])<65&&
   !confirm('This letter yarn may blend into the chart background. Apply it anyway?'))return;
 const config=previewTextConfig();
 let entries=preview.cells.map(cell=>[indexFor(cell.col,cell.row),preview.color]);
 if(previous?.source?.handEdited){
   const old=previous.source;
   const changesShape=['text','angle','flip','height','glyphWidth','direction','style','letterSpacing','layout','wrap']
     .some(key=>(old[key]??null)!==(config[key]??null));
   if(changesShape){
     if(!confirm('Changing the lettering shape replaces hand-painted and erased stitches. Continue?'))return;
   }else{
     const dx=config.col-old.col,dy=config.row-old.row;
     entries=[];
     for(const [index,color] of previous.entries){
       const col=index%active.cols+1+dx,row=active.rows-Math.floor(index/active.cols)+dy;
       if(col<1||col>active.cols||row<1||row>active.rows)return toast('Move the edited stitches inside the chart.');
       entries.push([indexFor(col,row),color===old.color?config.color:color]);
     }
     config.handEdited=true;
   }
 }
 const layer={id:previous?.id??uid(),name:'Text: '+preview.text.slice(0,40),type:'text',visible:previous?.visible??true,locked:false,entries,source:config};
 setLayerAndRefresh(layer,replace>=0?replace:null);
 editingLayerId=null;lastText={config:{...previewTextConfig()},original:new Map()};$('editLastText').disabled=false;
 clearTextPreview();$('textColor').value='';updateTextControls();toast('Text saved as a separate editable layer.');
}
function applyMotifLayer(){
 if(!active||!motifPreview||pendingConversion||editBlocked('apply motif'))return;
 const {clip,col,row}=motifPreview;
 if(col+clip.width-1>active.cols||row-clip.height+1<1)return toast('Motif does not fit. Move it inside the chart.');
 const missing=[...new Set(clip.colors.map(i=>clip.palette?.[i]))].filter(hex=>hex&&!active.palette.some(p=>p.hex.toLowerCase()===hex.toLowerCase()));
 if(active.palette.length+missing.length>12)return toast('This motif needs more than the available 12 yarn colors.');
 snapshot();for(const hex of missing)active.palette.push({hex,name:'Motif yarn '+(active.palette.length+1),symbol:SYMBOLS[active.palette.length]});
 const entries=[];for(let dy=0;dy<clip.height;dy++)for(let dx=0;dx<clip.width;dx++){
  const hex=clip.palette?.[clip.colors[dy*clip.width+dx]],index=active.palette.findIndex(p=>p.hex.toLowerCase()===String(hex).toLowerCase());
  if(index>=0)entries.push([indexFor(col+dx,row-dy),index]);
 }
 const l={id:uid(),name:'Motif: '+(chosenMotif()?.name||'Saved motif'),type:'motif',visible:true,locked:false,entries,source:null};
 active.layers.push(l);selectedLayerId=l.id;active.converted=true;clearMotifPreview();scheduleSave();refreshInspector();toast('Motif saved as editable layer.');
}
function advancedLetterPreviewTransform(mask,config){
 if(!mask||config.direction==='vertical'||!['diagonal','curve'].includes(config.layout))return mask;
 const height=mask.height,amp=Math.max(1,Math.round(config.height*.3)),width=mask.width;
 const mapped=mask.occupied.map(p=>({x:p.x,y:p.y+Math.round(config.layout==='diagonal'?((p.x/Math.max(1,width-1))*amp):amp*(1-Math.pow(2*p.x/Math.max(1,width-1)-1,2)))}));
 return {...mask,height:height+amp,occupied:mapped};
}
function setStudioMode(mode){
 studioMode=mode;document.body.dataset.studioMode=mode;
 const classify=(el,names)=>names.some(name=>el.querySelector(`[id="${name}"]`));
 document.querySelectorAll('.inspector-section').forEach(el=>{
  const txt=el.textContent.toLowerCase();el.classList.toggle('always-section',el.id==='sizePanel'||el.id==='annotationsPanel'||txt.includes('save & back up'));
  el.classList.toggle('create-section',el.id==='yarnLibraryPanel'||el.id==='layerPanel'||el.id==='texturePanel'||txt.includes('image to chart')||txt.includes('crochet mode')||txt.includes('text to chart')||txt.includes('yarn color legend'));
  el.classList.toggle('edit-section',el.id==='patternHealth'||el.id==='layerPanel'||['versionHistoryPanel','measurementPanel','shapesPanel','texturePanel'].includes(el.id)||txt.includes('yarn color legend')||txt.includes('text to chart')||txt.includes('yarn inventory')||txt.includes('printable pdf')||txt.includes('stitch progress')||txt.includes('crochet mode')||txt.includes('project dashboard'));
  el.classList.toggle('crochet-section',txt.includes('stitch progress')||txt.includes('crochet mode')||txt.includes('printable pdf')||txt.includes('yarn inventory'));
 });
 for(const [m,id] of [['create','modeCreate'],['edit','modeEdit'],['crochet','modeCrochet']])$(id).setAttribute('aria-pressed',String(mode===m));
 setCrochetView(mode==='crochet');requestAnimationFrame(resizeCanvas);
}
let yarnLibrary=[];try{yarnLibrary=JSON.parse(localStorage.getItem('dorette-yarn-library-v1')||'[]');if(!Array.isArray(yarnLibrary))yarnLibrary=[];}catch{}
function renderYarnLibrary(){const choice=$('yarnLibrarySelect');choice.replaceChildren();for(const c of yarnLibrary){const option=new Option(`${c.name} · ${c.hex}`,c.id);choice.add(option);} }
function saveYarnLibrary(){try{localStorage.setItem('dorette-yarn-library-v1',JSON.stringify(yarnLibrary));}catch(e){toast('Could not store yarn library locally.');}renderYarnLibrary();}
function showSize(){if(!active)return;const values=['sizeSwatchCols','sizeSwatchRows','sizeSwatchWidth','sizeSwatchHeight'].map(id=>Number($(id).value));const g=window.DoretteAdvanced.gauge(active.cols,active.rows,...values);$('sizeResult').textContent=g?`Estimated finished size: ${g.width.toFixed(1)} × ${g.height.toFixed(1)} ${$('sizeUnit').value}`:'Enter positive swatch dimensions to calculate the result.';}
function protectedCleanupCells(){if(!$('protectArea').checked||!areaSelection)return [];const out=[],a=areaSelection;for(let r=Math.min(a.start.row,a.end.row);r<=Math.max(a.start.row,a.end.row);r++)for(let c=Math.min(a.start.col,a.end.col);c<=Math.max(a.start.col,a.end.col);c++)out.push(indexFor(c,r));return out;}
function qualityCheck(){if(!active)return;const r=window.DoretteAdvanced.audit(active),el=$('qualityResults');el.replaceChildren();
 const notices=[`${r.singles} isolated single-stitch color islands.`,`${r.blocks} small color islands (3 stitches or fewer).`,`${r.transitions} horizontal yarn changes across the chart.`,`${r.emptyRows} rows contain only background color.`,`${r.edges} outer-edge cells use a different yarn from the background.`,`${r.usedColors} yarn colors are actually used.`];
 for(const msg of notices){const p=document.createElement('p');p.textContent=msg;el.append(p);}
 const clipped=(active.layers||[]).filter(l=>!l.entries.length);if(clipped.length){const p=document.createElement('p');p.textContent=`Review ${clipped.length} empty or clipped layers.`;el.append(p);}
}
const tutorialSteps=[
 ['Choose a workspace','Create for importing photos, text and motifs. Edit for colors, layers and quality checks. Crochet for guided progress.','CREATE  →  EDIT  →  CROCHET'],
 ['Photo to crochet chart','Import a picture, crop it, choose Natural or grayscale colors, preview the stitches, and apply only when satisfied.','PHOTO  →  PREVIEW  →  YARN GRID'],
 ['Layers and lettering','Type text, adjust font style and spacing, then apply to a new layer. Select a layer to reorder, hide, duplicate or flatten it.','TEXT  +  MOTIF  =  LAYERS'],
 ['Smart cleanup','Select any artwork needing protection, preview the small-area fixes, and apply only after checking the orange highlights.','PREVIEW FIRST  ✓'],
 ['Crochet with confidence','Use Guided Mode, Row Spotlight and the progress brush. Pattern lock prevents accidental recoloring.','ROW 1  •  STITCH 1  ✓'],
 ['Design versions and stitch notes','In Edit, save a named version before redesigning. Add notes to stitches, rows or work sections. Saved versions can be restored as a NEW project.','SAVE  →  COMPARE  →  RESTORE'],
 ['Drawing and measuring','Use Select area, then preview lines, borders and circles. Measure the selected rectangle using your real swatch gauge.','SELECT  →  PREVIEW  →  APPLY'],
 ['Visual options','Switch Beginner or Advanced, increase number sizes, add high-contrast grids and yarn shape cues, or preview simulated stitches.','EASIER TO SEE  •  EASIER TO USE'],
 ['Share safely','Download a project ZIP using Back up all, and keep private backups. The program ZIP is not the project backup.','BACK UP  →  GOOGLE DRIVE']
];
let tutorialIndex=0;
function renderTutorial(){const [title,desc,visual]=tutorialSteps[tutorialIndex],el=$('tutorialContent');el.replaceChildren();
 const head=document.createElement('h3');head.textContent=`${tutorialIndex+1}/${tutorialSteps.length} · ${title}`;
 const p=document.createElement('p');p.textContent=desc;
 const v=document.createElement('div');v.className='tour-visual';v.textContent=visual;
 el.append(head,p,v);$('tutorialPrev').disabled=tutorialIndex===0;$('tutorialNext').textContent=tutorialIndex===tutorialSteps.length-1?'Finish':'Next →';}
let structurePreview=null;
function previewChartStructure(){
 const action=$('chartStructureAction').value;
 const axis=['above','below','delete-row'].includes(action)?'row':'column';
 const insert=!action.startsWith('delete'), line=axis==='row'?selected.row:selected.col;
 const at=line+(['above','right'].includes(action)?1:0);
 structurePreview={axis,at,insert};
 const label=axis==='row'?'Row':'Column',apply=$('applyChartStructure');
 try{
   const {patch,nonempty}=NF.editChartLine(active,axis,at,insert);
   const messages=[`${label} ${at} · ${active.cols} × ${active.rows} → ${patch.cols} × ${patch.rows}.`];
   if(nonempty)messages.push('This line contains artwork or progress that will be removed.');
   if(!insert&&active.annotations?.some(n=>(axis==='row'?n.row:n.col)===at&&(axis==='row'||n.scope!=='row')))messages.push('Reminders on the removed line move to the nearest remaining line.');
   if(axis==='row'&&active.workDirection?.alternate!==false)messages.push('Shifted rows may reverse working direction because their row numbers change.');
   if(active.referenceImage)messages.push('The reference photo is kept but hidden because its alignment needs review.');
   if(safeEditsEnabled)messages.push('Studio will edit a separate saved copy.');
   $('chartStructurePreview').textContent=messages.join(' ');apply.disabled=false;
 }catch(error){$('chartStructurePreview').textContent=error.message;apply.disabled=true;}
 requestDraw();
}
async function applyChartStructure(){
 if(!structurePreview||pendingConversion||editBlocked('change chart structure'))return;
 const {axis,at,insert}=structurePreview,point=selected&&{...selected};
 const dialog=$('chartStructureDialog'),button=$('applyChartStructure');
 button.disabled=true;dialog.close();
 if(!await safeMajorCopy('before chart structure change')||editBlocked('change chart structure'))return;
 const {patch,position}=NF.editChartLine(active,axis,at,insert);
 selected=point;
 snapshot({label:(insert?'Insert ':'Delete ')+axis});
 Object.assign(active,patch);
 selected=point&&position(point,true);
 areaSelection=null;clearMotifPreview();clearTextPreview();
 invalidateChartCache();scheduleSave();refreshInspector();fitChart();
}
function hookAdvanced(){
 $('openChartStructure').onclick=()=>{
   if(!active||pendingConversion||editBlocked('change chart structure'))return;
   if(!selected)return toast('Select a stitch to choose its row and column.');
   $('chartStructureDialog').showModal();previewChartStructure();
 };
 $('chartStructureAction').onchange=previewChartStructure;
 $('chartStructureDialog').addEventListener('close',()=>{structurePreview=null;requestDraw();});
 $('applyChartStructure').onclick=()=>void applyChartStructure().catch(error=>toast(error.message));
 for(const [id,delta] of [['focusRowPrev',-1],['focusRowNext',1]])$(id).onclick=()=>{
   if(studioReadOnly||pendingConversion)return;
   const row=clamp((selected?.row??active.guide.row)+delta,1,active.rows);
   active.guide={row,position:0,finished:false};scheduleSave();focusGuideCell();
 };
 $('quickTextLayer').onclick=()=>{
   const mode=$('paintTextLayer');
   if(mode.checked){mode.checked=false;renderLayers();return;}
   const index=selected?indexFor(selected.col,selected.row):-1;
   const text=(active.layers||[]).filter(l=>l.type==='text'&&l.visible!==false);
   const layer=text.findLast(l=>l.entries.some(([i])=>i===index))||text.find(l=>l.id===selectedLayerId)||text.at(-1);
   if(!layer)return toast('Show a text layer before painting it.');
   selectedLayerId=layer.id;renderLayers();
   if(layer.locked){$('layerPanel').scrollIntoView({block:'nearest'});return toast('Unlock this text layer to paint or erase it.');}
   clearTextPreview();mode.checked=true;setTool('paint');renderLayers();
 };

 for(const [mode,id] of [['create','modeCreate'],['edit','modeEdit'],['crochet','modeCrochet']])$(id).addEventListener('click',()=>setStudioMode(mode));
 $('spotlightMode').addEventListener('change',()=>requestDraw());
 $('grayCount').addEventListener('change',()=>{if(pendingConversion)discardPreview();updateConversionControls();});
 $('compareGrays').addEventListener('click',()=>{
  if(!active?.referenceImage||!referenceImg)return toast('Import a photo first.');
  const [cols,rows]=[$('previewDimensions').value==='large'?120:active.cols,$('previewDimensions').value==='large'?165:active.rows],s=conversionSettings(),raster=rasterizeToCells(referenceImg,cols,rows,s);
  comparisonResults={small:{...window.DoretteAdvanced.grayscale(raster.values,2),cols,rows,projectId:active.id},large:{...window.DoretteAdvanced.grayscale(raster.values,4),cols,rows,projectId:active.id}};
  renderComparison($('compareSmallCanvas'),comparisonResults.small);renderComparison($('compareLargeCanvas'),comparisonResults.large);
  $('compareSmallLabel').textContent='2 grayscale yarn colors';$('compareLargeLabel').textContent='4 grayscale yarn colors';
  $('compareDialog').showModal();
 });
 $('replaceEverywhere').addEventListener('click',async()=>{
  if(!active||editBlocked('replace yarn colors')||pendingConversion)return;
  const from=Number($('replaceFrom').value),to=Number($('replaceTo').value);if(from===to)return toast('Choose two different yarn colors.');
  if(!safeEditsEnabled&&!confirm('Replace this yarn color throughout the current project, including layers? Undo is available.'))return;
  if(!await safeMajorCopy('color replacement'))return;
  snapshot();let n=0;active.cells=active.cells.map(v=>{if(v===from){n++;return to;}return v;});
  for(const l of active.layers||[])l.entries=l.entries.map(([i,c])=>{if(c===from){n++;return [i,to];}return [i,c];});
  scheduleSave();updateLegend();requestDraw();toast(`Replaced ${n} color assignments. Undo is available.`);
 });
 for(const id of ['sizeSwatchCols','sizeSwatchRows','sizeSwatchWidth','sizeSwatchHeight','sizeUnit'])$(id).addEventListener('input',showSize);
 $('previewCleanup').addEventListener('click',async()=>{
  if(pendingConversion)return toast('Finish the image preview before cleanup.');
  const cols=active.cols,rows=active.rows,cells=active.cells.slice(),limit=Number($('cleanupThreshold').value),protectedIndices=protectedCleanupCells();
  try{
   const changes=await runImageJob('cleanup',{cells,cols,rows,limit,protectedIndices},()=>window.DoretteAdvanced.cleanup(cells,cols,rows,limit,protectedIndices),'Finding isolated stitch colors…');
   if(!changes)return;
   pendingCleanup=changes;
   $('cleanupInfo').textContent=`Proposed fixes: ${pendingCleanup.length} base-grid stitches. Orange areas show changes, protected area is left alone.`;
   $('applyCleanup').disabled=pendingCleanup.length===0;requestDraw();
  }catch(e){toast('Cleanup preview failed: '+e.message);}
 });
 $('applyCleanup').addEventListener('click',async()=>{if(!pendingCleanup?.length||pendingConversion||editBlocked('clean up the pattern'))return;
  const proposal=pendingCleanup;
  if(!safeEditsEnabled&&!confirm(`Apply ${proposal.length} proposed stitch changes to the current project? Undo is available.`))return;
  if(!await safeMajorCopy('pattern cleanup'))return;
  snapshot();for(const [i,c] of proposal)active.cells[i]=c;toast(`Cleaned ${proposal.length} stitches. Undo remains available.`);
  pendingCleanup=null;$('applyCleanup').disabled=true;scheduleSave();updateLegend();requestDraw();
 });
 $('runQualityCheck').addEventListener('click',qualityCheck);
 $('repeatSelection').addEventListener('click',()=>{
  if(!active||!areaSelection||editBlocked('repeat stitches'))return toast('Select an area first.');
  const {start,end}=areaSelection,clip=Pattern.copyArea(compositeProject(active),start.col,start.row,end.col,end.row);
  const n=clamp(Number($('repeatCount').value)||2,1,12),horizontal=$('repeatDirection').value==='horizontal';
  const x=Math.min(start.col,end.col),top=Math.max(start.row,end.row);snapshot();let count=0;
  for(let copy=1;copy<=n;copy++){const col=x+(horizontal?copy*clip.width:0),row=top-(horizontal?0:copy*clip.height);count+=Pattern.paste(active,clip,col,row);}
  active.converted=true;scheduleSave();updateLegend();requestDraw();toast(`Repeated the selection ${n} times; ${count} stitches changed.`);
 });
 $('saveLibraryYarn').addEventListener('click',()=>{const i=Number($('paintColor').value),c=active.palette[i];if(!c)return;
  if(yarnLibrary.length>=120)return toast('Your yarn library is full.');const id=uid();yarnLibrary.push({...c,id,info:structuredClone(active.yarnInfo?.[i]||{}),swatch:structuredClone(active.gauge||{})});saveYarnLibrary();$('yarnLibrarySelect').value=id;toast('Yarn saved for reuse in this browser.');});
 $('useLibraryYarn').addEventListener('click',()=>{if(editBlocked('use yarn library'))return;const c=yarnLibrary.find(c=>c.id===$('yarnLibrarySelect').value);if(!c)return;
  const existing=active.palette.findIndex(p=>p.hex===c.hex);if(existing>=0){selectPaintColor(existing,true);return toast('Existing yarn selected.');}
  if(active.palette.length>=12)return toast('This chart already uses 12 yarn colors.');snapshot();active.palette.push({hex:c.hex,name:c.name,symbol:SYMBOLS[active.palette.length]});active.yarnInfo??=[];active.yarnInfo[active.palette.length-1]=structuredClone(c.info||{});scheduleSave();updateLegend();toast('Saved yarn added to this chart.');});
 $('removeLibraryYarn').addEventListener('click',()=>{yarnLibrary=yarnLibrary.filter(c=>c.id!==$('yarnLibrarySelect').value);saveYarnLibrary();});
 for(const [id,delta] of [['layerUp',1],['layerDown',-1]])$(id).addEventListener('click',()=>{const a=active.layers||[],i=a.findIndex(l=>l.id===selectedLayerId),j=i+delta;if(i<0||j<0||j>=a.length||editBlocked('reorder layers'))return;snapshot();[a[i],a[j]]=[a[j],a[i]];scheduleSave();renderLayers();requestDraw();});
 for(const [id,dx,dy] of [['layerMoveUp',0,1],['layerMoveDown',0,-1],['layerMoveLeft',-1,0],['layerMoveRight',1,0]]){
  $(id).addEventListener('click',()=>{
    const layer=chosenLayer(),bounds=layerBounds(layer);
    if(!bounds||layer.locked||pendingConversion||editBlocked('move the layer'))return;
    if(bounds.left+dx<1||bounds.right+dx>active.cols||bounds.bottom+dy<1||bounds.top+dy>active.rows)return toast('The layer is at the chart edge.');
    snapshot({label:'Move layer'});shiftLayer(layer,dx,dy);
    scheduleSave();renderLayers();updateLegend();requestDraw();
  });
 }
 $('layerDuplicate').addEventListener('click',()=>{const l=chosenLayer();if(!l||editBlocked('duplicate layers'))return;const copy=structuredClone(l);copy.id=uid();copy.name=l.name+' copy';shiftLayer(copy,1,-1);setLayerAndRefresh(copy);});
 $('layerDelete').addEventListener('click',()=>{const l=chosenLayer();if(!l||l.locked||editBlocked('delete layers'))return;snapshot();active.layers=active.layers.filter(x=>x!==l);selectedLayerId=null;scheduleSave();renderLayers();updateLegend();requestDraw();});
 $('layerFlatten').addEventListener('click',()=>{const l=chosenLayer();if(!l||l.locked||editBlocked('flatten a layer'))return;snapshot();for(const [i,c] of l.entries)active.cells[i]=c;active.layers=active.layers.filter(x=>x!==l);selectedLayerId=null;active.converted=true;scheduleSave();refreshInspector();toast('Layer flattened into the base chart.');});
 $('layerEdit').addEventListener('click',()=>{const l=chosenLayer();if(!l||l.locked||editBlocked('edit a layer'))return;
  if(l.type==='shape')return toast('Use Paint or Erase on the shape, or move it with the layer arrows.');
  if(l.type!=='text')return toast('Move motif layers with the arrows; duplicate or flatten them as needed.');
  editingLayerId=l.id;
  $('textDirection').value=l.source?.direction||'horizontal';syncTextDirection();
  $('textWidth').value=l.source?.glyphWidth??'';
  $('textProportions').checked=l.source?.proportional!==false;
  $('paintTextLayer').checked=false;
  for(const [key,id] of [['text','textInput'],['angle','textAngle'],['height','textScale'],['col','textCol'],['row','textRow'],['color','textColor'],['style','textStyle'],['letterSpacing','letterSpacing'],['layout','textLayout'],['wrap','textWrap']])if(l.source?.[key]!==undefined)$(id).value=l.source[key];
  $('flipText').checked=!!l.source?.flip;$('applyText').textContent='Update selected text layer';updateTextColorStatus();buildTextPreview();
 });
 $('paintTextLayer').addEventListener('change',renderLayers);
 const textHeight=$('textScale'),textWidth=$('textWidth');
 for(const field of [textHeight,textWidth]){
   field.addEventListener('focus',()=>{field.dataset.before=field.value;});
   field.addEventListener('input',()=>{
     if($('textProportions').checked){
       const previous=Number(field.dataset.before);
       const value=field.valueAsNumber;
       if(Number.isInteger(value)&&value>=Number(field.min)&&value<=100){
         if(field===textHeight&&previous>=5&&textWidth.value){
           textWidth.value=clamp(Math.round(textWidth.valueAsNumber*value/previous),1,100);
         }else if(field===textWidth){
           const reference=previous>0?previous:Math.max(1,Math.round(textHeight.valueAsNumber*3/5));
           textHeight.value=clamp(Math.round(textHeight.valueAsNumber*value/reference),5,100);
         }
         field.dataset.before=field.value;
       }
     }
     if($('textInput').value.trim())buildTextPreview();
   });
 }
 $('textDirection').addEventListener('change',syncTextDirection);
 for(const id of ['textStyle','letterSpacing','textLayout','textWrap','textDirection','textProportions'])$(id).addEventListener('change',()=>{if($('textInput').value.trim())buildTextPreview();});
 $('centerText').addEventListener('click',()=>{const cfg=previewTextConfig(),mask=rasterizeTextPattern(cfg);if(!mask)return;$('textCol').value=clamp(Math.floor((active.cols-mask.width)/2)+1,1,active.cols);$('textRow').value=clamp(Math.floor((active.rows+mask.height)/2),1,active.rows);buildTextPreview();});
 $('autoFitText').addEventListener('click',()=>{if(!areaSelection)return toast('Select an area to fit text inside first.');const area=areaSelection,left=Math.min(area.start.col,area.end.col),top=Math.max(area.start.row,area.end.row),width=Math.abs(area.start.col-area.end.col)+1,height=Math.abs(area.start.row-area.end.row)+1;
  $('textCol').value=left;$('textRow').value=top;
  let ok=false;for(let h=Math.min(100,height);h>=5;h--){$('textScale').value=h;const mask=rasterizeTextPattern(previewTextConfig());if(mask&&!mask.tooLarge&&mask.width<=width&&mask.height<=height){ok=true;break;}}
  buildTextPreview();toast(ok?'Text fitted inside the selected area.':'The selected area is too small for this lettering.');});
 $('quickTutorial').addEventListener('click',()=>{tutorialIndex=0;renderTutorial();$('tutorialDialog').showModal();});
 $('tutorialPrev').addEventListener('click',()=>{tutorialIndex=Math.max(0,tutorialIndex-1);renderTutorial();});
 $('tutorialNext').addEventListener('click',()=>{if(tutorialIndex===tutorialSteps.length-1)$('tutorialDialog').close();else {tutorialIndex++;renderTutorial();}});
 $('closeTutorial').addEventListener('click',()=>$('tutorialDialog').close());
 renderYarnLibrary();setStudioMode('edit');
}

// v1.5.0 additional controls. Project-specific values are stored in the existing project object.
let nextColorProposal=null, layerGesture=null, layerDragPreview=null, wakeLock=null, galleryRefreshTimer=null;
const NF=window.DoretteNext;
function layerBounds(l){
  if(!l?.entries?.length)return null;
  const cols=l.entries.map(([i])=>i%active.cols+1),rows=l.entries.map(([i])=>active.rows-Math.floor(i/active.cols));
  return {left:Math.min(...cols),right:Math.max(...cols),top:Math.max(...rows),bottom:Math.min(...rows)};
}
function refreshNextPanels(){
  if(!active)return;
  if($('projectCategory'))$('projectCategory').value=active.category||'Other';
  if($('projectNotes')&&document.activeElement!==$('projectNotes'))$('projectNotes').value=active.notes||'';
  if($('techniquePreset'))$('techniquePreset').value=active.technique||'rows';
  if($('workSectionSize'))$('workSectionSize').value=String(active.sectionSize||25);
  refreshSections();renderDiagonalInfo();
}
function refreshSections(){
 if(!active||!$('workSectionSelect'))return;
 const box=$('workSectionSelect'),old=Number(box.value)||1,items=NF.sections(active,active.sectionSize||25);
 box.replaceChildren();for(const item of items){const op=document.createElement('option');op.value=item.id;op.textContent=`${item.id} · C${item.c0}–${item.c1}, R${item.r0}–${item.r1} (${Math.round(item.done/item.total*100)}%)`;box.append(op);}
 box.value=String(Math.min(items.length,old));const selected=items[Number(box.value)-1];
 $('sectionProgress').textContent=selected?`${selected.done}/${selected.total} stitches done in section ${selected.id} · ${items.length} sections total`:'';
}
function navigateSection(){const sec=NF.sections(active,active.sectionSize||25)[Number($('workSectionSelect').value)-1];if(!sec)return;
 selected={col:Math.floor((sec.c0+sec.c1)/2),row:Math.floor((sec.r0+sec.r1)/2)};
 view.x=canvasWidth/2-(M+(selected.col-.5)*CELL)*view.scale;
 view.y=canvasHeight/2-(M+(active.rows-selected.row+.5)*CELL)*view.scale;
 updateSelection();requestDraw();refreshSections();
}
function completeSection(){if(!active||pendingConversion)return;
 const sec=NF.sections(active,active.sectionSize||25)[Number($('workSectionSelect').value)-1];if(!sec)return;
 const complete=sec.done===sec.total;
 progressSnapshot();
 for(let r=sec.r0;r<=sec.r1;r++)for(let c=sec.c0;c<=sec.c1;c++){
  if(active.rowDone[r-1]){
   const top=active.rows-r;for(let col=0;col<active.cols;col++)active.done[top*active.cols+col]=1;
   active.rowDone[r-1]=0;
  }
  active.done[indexFor(c,r)]=complete?0:1;
 }
 scheduleSave();updateProgress();refreshSections();requestDraw();toast(complete?'Section progress cleared.':'Section marked complete.');
}
function renderDiagonalInfo(){if(!active||!$('diagonalStatus'))return;
 const isC2C=active.technique==='c2c';
 $('diagonalNext').disabled=!isC2C;$('diagonalBack').disabled=!isC2C;
 $('techniqueHint').textContent=isC2C?'C2C preview follows the chart diagonally, one graph cell per move. It does NOT provide complete C2C block-stitch construction instructions.':active.technique==='tapestry'?'Tapestry crochet keeps row-by-row color groups; consider your yarn-carrying method and floats.':'Follow the underlying stitch instructions for your yarn and crochet technique.';
 if(!isC2C){$('diagonalStatus').textContent='Row-based crochet progression selected.';return;}
 const pos=NF.diagonal(active),step=Number(active.diagonalIndex)||0,cell=pos[Math.min(step,pos.length-1)];
 $('diagonalStatus').textContent=`Diagonal chart step ${Math.min(step+1,pos.length)}/${pos.length} · Row ${cell.row}, column ${cell.col}`;
}
function diagonalMove(direction){
 if(!active||active.technique!=='c2c'||pendingConversion)return;
 const path=NF.diagonal(active),current=clamp(Math.round(Number(active.diagonalIndex)||0),0,path.length-1),cell=path[current];
 if(direction!==0)progressSnapshot();
 if(direction>0)active.done[indexFor(cell.col,cell.row)]=1;
 active.diagonalIndex=clamp(current+direction,0,path.length-1);
 const next=path[active.diagonalIndex];selected={...next};
 view.x=canvasWidth/2-(M+(next.col-.5)*CELL)*view.scale;view.y=canvasHeight/2-(M+(active.rows-next.row+.5)*CELL)*view.scale;
 scheduleSave();updateSelection();updateProgress();renderDiagonalInfo();requestDraw();
}
function drawNextChartOverlays(g,cols,rows,s){
 if(!active||pendingConversion)return;
 const sectionSize=active.sectionSize||25,stroke='#9156ba';g.lineWidth=2/s;g.strokeStyle=stroke;g.setLineDash([6/s,5/s]);
 for(let c=sectionSize;c<cols;c+=sectionSize){g.beginPath();g.moveTo(M+c*CELL,M);g.lineTo(M+c*CELL,M+rows*CELL);g.stroke();}
 for(let r=sectionSize;r<rows;r+=sectionSize){g.beginPath();g.moveTo(M,M+(rows-r)*CELL);g.lineTo(M+cols*CELL,M+(rows-r)*CELL);g.stroke();}
 g.setLineDash([]);
 if(structurePreview&&$('chartStructureDialog').open){
   const {axis,at,insert}=structurePreview,row=axis==='row';
   const x=M+(row?0:at-1)*CELL,y=M+(row?rows-at+(insert?1:0):0)*CELL;
   g.fillStyle=insert?'#176dba':'#b42933';
   if(insert)g.fillRect(x,y,row?cols*CELL:4/s,row?4/s:rows*CELL);
   else{g.save();g.globalAlpha=.38;g.fillRect(x,y,row?cols*CELL:CELL,row?CELL:rows*CELL);g.restore();}
 }
 if($('dragLayerOnChart')?.checked){const l=chosenLayer(),b=layerBounds(l);if(l&&b&&l.visible!==false){
  const p=layerDragPreview||b,x=M+(p.left-1)*CELL,y=M+(rows-p.top)*CELL,w=(p.right-p.left+1)*CELL,h=(p.top-p.bottom+1)*CELL;
  g.strokeStyle='#e66727';g.lineWidth=3/s;g.strokeRect(x,y,w,h);g.fillStyle='#e66727';g.fillRect(x+w-7/s,y-7/s,14/s,14/s);
 }}
}
function startLayerDrag(ev){
 if(!active||!['select','pan'].includes(editorTool)||progressBrush||placingText||motifPreview||document.body.classList.contains('crochet-view')||!$('dragLayerOnChart')?.checked||isPatternLocked()||pendingConversion)return false;
 const layer=chosenLayer(),bounds=layerBounds(layer),cell=screenToStitch(ev.offsetX,ev.offsetY);
 if(!layer||!bounds||layer.locked||layer.visible===false||!cell)return false;
 const inside=cell.col>=bounds.left&&cell.col<=bounds.right&&cell.row>=bounds.bottom&&cell.row<=bounds.top;
 if(!inside)return false;
 const resize=(Math.abs(cell.col-bounds.right)<=1&&Math.abs(cell.row-bounds.top)<=1);
 layerGesture={id:ev.pointerId,layerId:layer.id,projectId:active.id,start:cell,current:cell,bounds:{...bounds},resize};
 layerDragPreview={...bounds};canvas.setPointerCapture(ev.pointerId);ev.preventDefault();return true;
}
function moveLayerDrag(ev){
 if(!layerGesture||layerGesture.id!==ev.pointerId)return false;
 const cell=screenToStitch(ev.offsetX,ev.offsetY)||layerGesture.current;layerGesture.current=cell;
 const g=layerGesture,dx=cell.col-g.start.col,dy=cell.row-g.start.row;
 if(g.resize)layerDragPreview={...g.bounds,right:clamp(g.bounds.right+dx,g.bounds.left,active.cols),top:clamp(g.bounds.top+dy,g.bounds.bottom,active.rows)};
 else{
  const x=clamp(dx,1-g.bounds.left,active.cols-g.bounds.right);
  const y=clamp(dy,1-g.bounds.bottom,active.rows-g.bounds.top);
  layerDragPreview={left:g.bounds.left+x,right:g.bounds.right+x,top:g.bounds.top+y,bottom:g.bounds.bottom+y};
 }
 requestDraw();ev.preventDefault();return true;
}
function finishLayerDrag(ev){
 if(!layerGesture||layerGesture.id!==ev.pointerId)return false;
 const gesture=layerGesture,layer=chosenLayer(),p=layerDragPreview;layerGesture=null;layerDragPreview=null;
 if(!layer||!p||layer.id!==gesture.layerId||active.id!==gesture.projectId||layer.locked||isPatternLocked()){requestDraw();return true;}
 const dx=p.left-gesture.bounds.left,dy=p.top-gesture.bounds.top;
 if(!gesture.resize&&dx===0&&dy===0){requestDraw();return true;}
 if(gesture.resize&&p.right===gesture.bounds.right&&p.top===gesture.bounds.top){requestDraw();return true;}
 snapshot();
 if(gesture.resize){
  const b=gesture.bounds,oldW=b.right-b.left+1,oldH=b.top-b.bottom+1,newW=p.right-p.left+1,newH=p.top-p.bottom+1;
  const old=new Map(layer.entries),entries=new Map();
  for(let nr=p.bottom;nr<=p.top;nr++)for(let nc=p.left;nc<=p.right;nc++){
   const oc=b.left+Math.min(oldW-1,Math.floor((nc-p.left+.5)*oldW/newW)),or=b.bottom+Math.min(oldH-1,Math.floor((nr-p.bottom+.5)*oldH/newH));
   const value=old.get(indexFor(oc,or));if(value!==undefined)entries.set(indexFor(nc,nr),value);
  }
  layer.entries=[...entries];layer.source=null; // raster resized layers remain editable, but text metadata no longer matches
 }else shiftLayer(layer,dx,dy);
 scheduleSave();renderLayers();updateLegend();requestDraw();toast(gesture.resize?'Layer resized as stitches.':'Layer moved.');return true;
}
function currentRenderedImage(){if(!referenceImg)return null;return referenceImg;}
async function handleGridDetection(){
 const img=currentRenderedImage();if(!img)return toast('Import a reference image first.');
 const crop=currentCrop(),c=document.createElement('canvas');
 const cw=img.width*(crop.right-crop.left),ch=img.height*(crop.bottom-crop.top);
 const scale=Math.min(1,1000/Math.max(cw,ch));
 c.width=Math.max(1,Math.round(cw*scale));c.height=Math.max(1,Math.round(ch*scale));
 const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,img.width*crop.left,img.height*crop.top,cw,ch,0,0,c.width,c.height);
 const pixels=g.getImageData(0,0,c.width,c.height).data;
 try{
   const found=await runImageJob('grid',{pixels,width:c.width,height:c.height},()=>NF.detectGrid(c),'Inspecting chart grid…');
   if(!found)return;
   const cols=found.columns.count,rows=found.rows.count;
   if(cols>0&&cols<=200)$('gridCols').value=cols;if(rows>0&&rows<=300)$('gridRows').value=rows;
   $('gridResult').textContent=`Suggested: ${cols||'unknown'} columns (${Math.round(found.columns.confidence*100)}% line regularity), ${rows||'unknown'} rows (${Math.round(found.rows.confidence*100)}% line regularity). Counts are estimates, not verified. Check visible square boundaries and edit the fields before using.`;
 }catch(e){toast('Grid detection failed: '+e.message);}
}

function straightenReference(){
 if(!active?.referenceImage||!referenceImg)return toast('Import an image first.');
 const deg=Number($('gridRotation').value)||0;if(Math.abs(deg)<.01)return toast('Select a rotation correction first.');
 if(!confirm(`Rotate the SOURCE image by ${deg} degrees? Chart stitches will not be changed; Undo will restore the old source.`))return;
 const w=referenceImg.width,h=referenceImg.height,angle=deg*Math.PI/180,
  sizeW=Math.ceil(Math.abs(w*Math.cos(angle))+Math.abs(h*Math.sin(angle))),sizeH=Math.ceil(Math.abs(h*Math.cos(angle))+Math.abs(w*Math.sin(angle)));
 const c=document.createElement('canvas');c.width=sizeW;c.height=sizeH;
 const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,sizeW,sizeH);g.translate(sizeW/2,sizeH/2);g.rotate(angle);g.drawImage(referenceImg,-w/2,-h/2);
 const data=c.toDataURL("image/png");if(data.length>22*1024*1024)return toast("The updated source image is too large for a project backup.");
 snapshot();active.referenceImage=data;active.photoCrop={...FULL_CROP};discardPreview(false);syncImage();scheduleSave();requestDraw();toast('Reference source rotated; grid count can now be rechecked.');
}
async function removeBackgroundFromSource(){
 if(!referenceImg||!active)return toast('Import an image first.');
 if(!confirm('Remove similarly colored background regions connected to the photo edges? Original chart colors will stay unchanged. Undo can restore the image.'))return;
 const source=referenceImg,tolerance=Number($('bgTolerance').value)||35;
 try{const result=NF.backgroundRemove(source,tolerance);
  if(result.length>22*1024*1024)throw Error('Resulting image is too large.');
  if(!await safeMajorCopy('background cleanup'))return;snapshot();active.referenceImage=result;active.photoCrop={...FULL_CROP};discardPreview(false);syncImage();scheduleSave();toast('Background cleaned around the edges. Preview the conversion before applying.');
 }catch(e){toast('Background removal failed: '+e.message);}
}
async function isolateSubjectCrop(){
 if(!referenceImg||!active)return toast('Import and crop an image first.');
 const crop=currentCrop(),w=Math.round(referenceImg.width*(crop.right-crop.left)),h=Math.round(referenceImg.height*(crop.bottom-crop.top));
 if(w<5||h<5)return toast('Select a larger subject crop.');
 if(!confirm('Keep only the rectangular crop selected in the image? This changes the reference image, but not the saved stitch colors. Undo is available.'))return;
 const c=document.createElement('canvas');c.width=w;c.height=h;
 c.getContext('2d').drawImage(referenceImg,referenceImg.width*crop.left,referenceImg.height*crop.top,referenceImg.width*(crop.right-crop.left),referenceImg.height*(crop.bottom-crop.top),0,0,w,h);
 if(!await safeMajorCopy('subject crop'))return;snapshot();active.referenceImage=c.toDataURL('image/png');active.photoCrop={...FULL_CROP};discardPreview(false);syncImage();scheduleSave();toast('Kept the selected subject rectangle. You can now remove similar edge background colors.');
}
async function verifyGridDimensions(){
 if(!active||pendingConversion||editBlocked("apply a detected grid size"))return;
 const cols=Number($('gridCols').value),rows=Number($('gridRows').value);
 if(!validDimensions(cols,rows))return toast('Choose a valid 1–200 by 1–300 grid.');
 if(!confirm(`Use ${cols} columns and ${rows} rows? This resizes the current chart using nearest-cell canvas mapping. Back up your important project first.`))return;
 if(!await safeMajorCopy('detected grid'))return;
 snapshot();Object.assign(active,NF.remap(active,cols,rows,'canvas','center'));clearTextPreview();selected=null;areaSelection=null;active.guide={row:1,position:0};active.diagonalIndex=0;scheduleSave();refreshInspector();fitChart();toast('Verified grid size applied. Inspect the result carefully.');
}
async function doAdvancedResize(){
 if(!active||editBlocked('resize the chart'))return;
 const cols=Number($('colsInput').value),rows=Number($('rowsInput').value);
 if(!validDimensions(cols,rows))return toast('Choose chart dimensions from 1–200 columns and 1–300 rows.');
 const mode=$('resizeMode').value,anchor=$('resizeAnchor').value;
 if(!confirm(`${mode==='scale'?'Scale all stitch cells':'Expand or crop without stretching'} to ${cols} × ${rows}, anchored ${anchor}? Cropped cells cannot be recovered except through Undo or a backup.`))return;
 if(!await safeMajorCopy('advanced resize'))return;
 snapshot();Object.assign(active,NF.remap(active,cols,rows,mode,anchor));clearTextPreview();selected=null;areaSelection=null;
 active.guide={row:1,position:0};active.diagonalIndex=0;scheduleSave();refreshInspector();fitChart();toast('Advanced resize applied. Undo remains available.');
}
function plotGrayTrio(){
 if(!referenceImg)return toast('Import a photo first.');
 const dims=[$('previewDimensions').value==='large'?120:active.cols,$('previewDimensions').value==='large'?165:active.rows],raster=rasterizeToCells(referenceImg,dims[0],dims[1],conversionSettings());
 const host=$('grayTrio'),projectId=active.id,source=active.referenceImage;host.replaceChildren();
 for(const n of [2,3,4]){
  const d=NF?window.DoretteAdvanced.grayscale(raster.values,n):null;
  if(!d)continue;const wrapper=document.createElement('div');wrapper.className='gray-card';
  const name=document.createElement('strong');name.textContent=`${n} grayscale yarns`;
  const canvas=document.createElement('canvas');canvas.width=dims[0];canvas.height=dims[1];canvas.style.maxWidth='100%';
  const g=canvas.getContext('2d'),pixels=g.createImageData(canvas.width,canvas.height);
  d.cells.forEach((value,i)=>{const color=parseInt(d.palette[value].hex.slice(1,3),16);pixels.data.set([color,color,color,255],i*4);});g.putImageData(pixels,0,0);
  const use=document.createElement('button');use.type='button';use.className='button ghost';use.textContent='Preview on chart';use.addEventListener('click',()=>{if(active.id!==projectId||active.referenceImage!==source)return toast('Run the comparison again for this photo.');previewResult({...d,cols:dims[0],rows:dims[1],projectId});});
  wrapper.append(name,canvas,use);host.append(wrapper);
 }
}
function colorChangeAudit(){
 if(!active)return;const results=NF.analyze(active),worst=results.rowStats.slice(0,5).map(r=>`Row ${r.row}: ${r.changes} changes`).join('; ');
 $('colorAnalysis').textContent=`${results.transitions} horizontal yarn transitions; ${results.isolatedCount} possible single-stitch reversals. ${results.floatCandidates.length} possible long between-use yarn spans (8+ intervening chart cells, not a verified carry). Busiest rows: ${worst||'none'}. Your technique may require these changes; review before applying.`;
}
function previewColorChanges(){
 if(!active||pendingConversion)return;const data=NF.analyze(active),layered=new Set((active.layers||[]).filter(l=>l.visible!==false).flatMap(l=>l.entries.map(([i])=>i)));
 nextColorProposal=data.examples.filter(e=>!layered.has(indexFor(e.col,e.row))).slice(0,200).map(e=>[indexFor(e.col,e.row),e.to]);
 $('applyColorSuggestion').disabled=!nextColorProposal.length;
 $('colorAnalysis').textContent=`Previewing ${nextColorProposal.length} possible isolated stitches; only BASE chart cells will be changed. Keep detailed lettering and photos protected by declining if these colors matter.`;
 requestDraw();
}
function clearColorProposal(){
 nextColorProposal=null;
 $('applyColorSuggestion').disabled=true;
}
async function applyColorChanges(){if(!nextColorProposal?.length||pendingConversion||editBlocked('apply yarn simplifications'))return;
 const proposal=nextColorProposal;
 if(!await safeMajorCopy('color simplification'))return;
 snapshot();for(const [i,c] of proposal)active.cells[i]=c;
 toast(proposal.length+' isolated stitches simplified. Undo is available.');scheduleSave();refreshInspector();requestDraw();
}
function navigateQualityProblem(){
 if(!active)return;const r=NF.analyze(active).rowStats.slice(0,8),host=$('qualityNavigation');host.replaceChildren();
 for(const issue of r){const b=document.createElement('button');b.type='button';b.className='button ghost';b.textContent=`Inspect row ${issue.row}: ${issue.changes} changes`;
  b.onclick=()=>{selected={col:Math.ceil(active.cols/2),row:issue.row};view.x=canvasWidth/2-(M+(selected.col-.5)*CELL)*view.scale;view.y=canvasHeight/2-(M+(active.rows-selected.row+.5)*CELL)*view.scale;updateSelection();requestDraw();};host.append(b);
 }
}
function exportChartImage(kind){
 if(!active)return;
 const audit=reliability.auditExport(active,composedCells(active));
 if(!audit.ok){toast('Export blocked: '+audit.errors[0]);return;}const options={cell:Number($('imageExportScale').value)||12,numbers:$('imageExportNumbers').checked,legend:$('imageExportNumbers').checked,sections:Number(active.sectionSize)||25};
 const svg=NF.svg(active,options),file=slug(active.name)+'-Chart';
 if(kind==='svg'){download(new Blob([svg],{type:'image/svg+xml'}),file+'.svg');return;}
 const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
  if(c.width*c.height>60e6){toast('PNG export too large; choose a smaller scale.');URL.revokeObjectURL(img.src);return;}
  c.getContext('2d').drawImage(img,0,0);c.toBlob(blob=>{if(blob)download(blob,file+'.png');else toast('Unable to generate PNG.');URL.revokeObjectURL(img.src);},'image/png');};
 img.onerror=()=>toast('PNG preview failed. Try SVG export.');img.src=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
}
function matchSelectedYarn(){
 const color=active?.palette?.[Number($('paintColor').value)],host=$('matchYarnResult');if(!color)return;
 if(!yarnLibrary.length){host.textContent='Your saved yarn library is empty.';return;}
 const list=yarnLibrary.map(c=>({...c,dist:NF.colorDistance(c.hex,color.hex)})).sort((a,b)=>a.dist-b.dist).slice(0,3);
 host.textContent='Approximate digital color matches (NOT verified yarn matches): '+list.map(c=>`${c.name} ${c.hex} (difference ${c.dist.toFixed(0)})`).join('; ')+'. Actual yarn dye lots, lighting and screen colors can differ.';
}
let wakeRequest=0;
async function updateWakeLock(){
 const ticket=++wakeRequest;
 const enabled=$('keepAwake')?.checked&&document.visibilityState==='visible'&&document.body.classList.contains('crochet-view');
 if(!enabled){
  const previous=wakeLock;wakeLock=null;
  try{await previous?.release();}catch{}
  return;
 }
 if(wakeLock&&!wakeLock.released)return;
 if(!navigator.wakeLock){$('keepAwake').checked=false;return toast('This browser does not support screen wake lock.');}
 try{
  const lock=await navigator.wakeLock.request('screen');
  if(ticket!==wakeRequest){await lock.release();return;}
  wakeLock=lock;
 }catch{
  if(ticket!==wakeRequest)return;
  toast('Screen wake lock was blocked. Check browser permissions.');$('keepAwake').checked=false;
 }
}
function refreshWorkspaceLayout(){
 const split=Number($('chartSplit').value)||50;
 if(document.activeElement!==$('chartSplitNumber'))$('chartSplitNumber').value=split;document.documentElement.style.setProperty('--dorette-overview-share',split+'fr');document.documentElement.style.setProperty('--dorette-working-share',(100-split)+'fr');
 document.body.classList.toggle('hide-settings',$('toggleSettings').dataset.hidden==='1');document.body.classList.toggle('hide-projects',$('toggleProjects').dataset.hidden==='1');
 $('toggleProjects').textContent=$('toggleProjects').dataset.hidden==='1'?'Show Projects':'Hide Projects';
 $('toggleSettings').textContent=$('toggleSettings').dataset.hidden==='1'?'Show Settings':'Hide Settings';
 document.body.classList.toggle('unpinned-dock',!$('pinCrochetDock').checked);
 requestDraw();
}
const textFavoritesKey='dorette-text-styles-v1';
let textFavorites=[];
try{textFavorites=JSON.parse(localStorage.getItem(textFavoritesKey)||'[]');if(!Array.isArray(textFavorites))textFavorites=[];}catch{}
function refreshTextFavorites(){const sel=$('textStyleFavorite'),old=sel.value;sel.replaceChildren();for(const item of textFavorites){const op=new Option(item.name,item.id);sel.append(op);}if(textFavorites.some(x=>x.id===old))sel.value=old;}
function saveTextFavorite(){
 const name=prompt('Name this lettering style (example: Bold 20-stitch initials):','My lettering style');if(name===null)return;
 if(textFavorites.length>=35)return toast('You have 35 saved styles. Remove one first.');
 const fields=['textStyle','letterSpacing','textWrap','textLayout','textAngle','textScale','textDirection','textWidth'],options={};
 for(const id of fields)options[id]=$(id).value;
 const item={id:uid(),name:name.slice(0,60),options};textFavorites.push(item);
 try{localStorage.setItem(textFavoritesKey,JSON.stringify(textFavorites));}catch{toast('Unable to save lettering styles in this browser.');}
 refreshTextFavorites();$('textStyleFavorite').value=item.id;toast('Lettering style saved in this browser.');
}
function loadTextFavorite(){const item=textFavorites.find(x=>x.id===$('textStyleFavorite').value);if(!item)return;
 for(const [id,value] of Object.entries(item.options))if($(id))$(id).value=value;
 if(textPreview)buildTextPreview();toast('Lettering style applied. Preview before adding it to the chart.');
}
function deleteTextFavorite(){const id=$('textStyleFavorite').value;textFavorites=textFavorites.filter(x=>x.id!==id);
 try{localStorage.setItem(textFavoritesKey,JSON.stringify(textFavorites));}catch{}
 refreshTextFavorites();toast('Lettering style removed.');
}
function centerTextInArea(){
 if(!areaSelection)return toast('Use Select area to choose a space for the lettering first.');
 const c=previewTextConfig(),mask=rasterizeTextPattern(c);if(!mask)return toast('Type lettering first.');
 const left=Math.min(areaSelection.start.col,areaSelection.end.col),right=Math.max(areaSelection.start.col,areaSelection.end.col),top=Math.max(areaSelection.start.row,areaSelection.end.row),bottom=Math.min(areaSelection.start.row,areaSelection.end.row),w=right-left+1,h=top-bottom+1;
 if(mask.width>w||mask.height>h)return toast('The lettering is larger than this area. Use Auto-fit first.');
 $('textCol').value=String(left+Math.floor((w-mask.width)/2));$('textRow').value=String(top-Math.floor((h-mask.height)/2));
 buildTextPreview();toast('Lettering centered in the selected chart area.');
}
function hookNextEvents(){
  refreshTextFavorites();
  $('saveTextFavorite').addEventListener('click',saveTextFavorite);$('applyTextFavorite').addEventListener('click',loadTextFavorite);$('deleteTextFavorite').addEventListener('click',deleteTextFavorite);$('centerSelectionText').addEventListener('click',centerTextInArea);
 for(const id of ['projectSearch','categoryFilter','onlyFavorites'])$(id).addEventListener('input',refreshProjectList);
 setupProjectOrganization();
 $('projectNotes').addEventListener('change',e=>{if(!active)return;snapshot();active.notes=e.target.value.slice(0,1500);scheduleSave();});
 $('duplicateProject').addEventListener('click',()=>{if(active)duplicateProject(active);});
 $('techniquePreset').addEventListener('change',e=>{if(!active)return;snapshot();active.technique=e.target.value;active.diagonalIndex=0;scheduleSave();renderDiagonalInfo();});
 $('diagonalNext').addEventListener('click',()=>diagonalMove(1));$('diagonalBack').addEventListener('click',()=>diagonalMove(-1));
 $('workSectionSize').addEventListener('change',e=>{if(!active)return;snapshot({label:'Change work sections'});active.sectionSize=Number(e.target.value);scheduleSave();refreshSections();updatePdfEstimate();requestDraw();});
 $('workSectionSelect').addEventListener('change',refreshSections);$('goSection').addEventListener('click',navigateSection);$('markSection').addEventListener('click',completeSection);
 $('detectGrid').addEventListener('click',handleGridDetection);
 $('gridRotation').addEventListener('input',e=>$('gridRotationValue').textContent=e.target.value+'°');
 $('applyRotation').addEventListener('click',straightenReference);$('useGrid').addEventListener('click',verifyGridDimensions);
 $('removeBackground').addEventListener('click',removeBackgroundFromSource);$('isolateSubjectCrop').addEventListener('click',isolateSubjectCrop);
 $('smartResize').addEventListener('click',doAdvancedResize);
 $('compareGrayTrio').addEventListener('click',plotGrayTrio);
 $('analyzeColorChanges').addEventListener('click',colorChangeAudit);
 $('previewColorSuggestion').addEventListener('click',previewColorChanges);$('applyColorSuggestion').addEventListener('click',applyColorChanges);
 $('runQualityCheck').addEventListener('click',()=>setTimeout(navigateQualityProblem,50));
 $('fitLayerArea').addEventListener('click',()=>{
  const layer=chosenLayer();if(!layer||layer.locked||!areaSelection||editBlocked('fit layer'))return toast('Select a layer and a chart area first.');
  const b=layerBounds(layer),{start,end}=areaSelection,area={left:Math.min(start.col,end.col),right:Math.max(start.col,end.col),bottom:Math.min(start.row,end.row),top:Math.max(start.row,end.row)};
  if(!b)return;const old=new Map(layer.entries),entries=new Map(),oldW=b.right-b.left+1,oldH=b.top-b.bottom+1,newW=area.right-area.left+1,newH=area.top-area.bottom+1;
  for(let row=area.bottom;row<=area.top;row++)for(let col=area.left;col<=area.right;col++){
    const c=b.left+Math.min(oldW-1,Math.floor((col-area.left+.5)*oldW/newW)),r=b.bottom+Math.min(oldH-1,Math.floor((row-area.bottom+.5)*oldH/newH)),color=old.get(indexFor(c,r));
    if(color!==undefined)entries.set(indexFor(col,row),color);
  }
  snapshot({label:'Resize editable layer'});layer.entries=[...entries];layer.source=null;scheduleSave();renderLayers();updateLegend();requestDraw();toast('Layer fitted to selection (stitch-based nearest-neighbor scale).');
 });
 $('matchYarn').addEventListener('click',matchSelectedYarn);
 $('exportPng').addEventListener('click',()=>exportChartImage('png'));$('exportSvg').addEventListener('click',()=>exportChartImage('svg'));
 $('keepAwake').addEventListener('change',updateWakeLock);
 document.addEventListener('visibilitychange',updateWakeLock);
 $('chartSplit').addEventListener('input',()=>{
  $('chartSplitNumber').value=$('chartSplit').value;
  refreshWorkspaceLayout();
 });
 $('pinCrochetDock').addEventListener('input',refreshWorkspaceLayout);
 const splitNumber=$('chartSplitNumber');
 splitNumber.addEventListener('input',()=>{
  if(splitNumber.validity.valid&&splitNumber.value!==''){
   $('chartSplit').value=splitNumber.value;
   refreshWorkspaceLayout();
  }
 });
 splitNumber.addEventListener('change',()=>{
  const value=splitNumber.valueAsNumber;
  if(Number.isFinite(value))$('chartSplit').value=clamp(Math.round(value),25,75);
  splitNumber.value=$('chartSplit').value;
  refreshWorkspaceLayout();
 });
 splitNumber.addEventListener('blur',()=>{splitNumber.value=$('chartSplit').value;});
 for(const [id,flag] of [['toggleSettings','hide-settings'],['toggleProjects','hide-projects']])$(id).addEventListener('click',()=>{const b=$(id);b.dataset.hidden=b.dataset.hidden==='1'?'0':'1';refreshWorkspaceLayout();});
 refreshWorkspaceLayout();
}

// v1.6.0: project milestones, annotations, accessibility, measurements, shapes and previews.
// New project data is additive. The existing IndexedDB and project ZIP envelope remain version 1.
const V16_PREF_KEY='dorette-display-v16';
const V16_MAX_VERSIONS=8, V16_MAX_NOTES=200;
let v16ShapeProposal=null;
let v16Prefs=(()=>{try{return {...{mode:'advanced',highContrast:false,cues:false,symbols:false,numberScale:1,ruler:false},...JSON.parse(localStorage.getItem(V16_PREF_KEY)||'{}')};}catch{return {mode:'advanced',highContrast:false,cues:false,symbols:false,numberScale:1,ruler:false};}})();
function v16SavePrefs(){try{localStorage.setItem(V16_PREF_KEY,JSON.stringify(v16Prefs));}catch{toast('Display preferences cannot be saved in this browser.');}}
function v16ApplyPrefs(){
  const beginner=v16Prefs.mode==='beginner';
  document.body.classList.toggle('beginner-mode',beginner);
  if(beginner&&active&&!['select','paint','erase','pan'].includes(editorTool))setTool('select');
  if(beginner&&motifPreview)clearMotifPreview();
  document.body.classList.toggle('accessible-contrast',!!v16Prefs.highContrast);
  $('skillMode').value=v16Prefs.mode==='beginner'?'beginner':'advanced';
  $('highContrastGrid').checked=!!v16Prefs.highContrast;
  $('colorCueMode').checked=!!v16Prefs.cues;
  $('alwaysSymbols').checked=!!v16Prefs.symbols;
  $('showMeasurementRuler').checked=!!v16Prefs.ruler;
  $('numberScale').value=['1','1.5','2'].includes(String(v16Prefs.numberScale))?String(v16Prefs.numberScale):'1';
  requestDraw();
}
function v16VersionPayload(p){
  return {cols:p.cols,rows:p.rows,cells:p.cells.slice(),done:p.done.slice(),rowDone:p.rowDone.slice(),
    palette:structuredClone(p.palette),layers:structuredClone(p.layers||[]),annotations:structuredClone(p.annotations||[]),converted:!!p.converted};
}
function v16DisplayCells(p){return window.DoretteAdvanced.compose(p);}
function v16PaintMini(canvas,project){
  const g=canvas.getContext('2d',{alpha:false}),w=canvas.width,h=canvas.height;
  g.fillStyle='#fff';g.fillRect(0,0,w,h);
  if(!project?.cells?.length||!project.cols||!project.rows)return;
  const values=v16DisplayCells(project),scale=Math.min((w-8)/project.cols,(h-8)/project.rows),ox=(w-project.cols*scale)/2,oy=(h-project.rows*scale)/2;
  // Pixel output sampling caps work for large 200 x 300 patterns.
  for(let py=Math.max(0,Math.floor(oy));py<Math.min(h,Math.ceil(oy+project.rows*scale));py++)for(let px=Math.max(0,Math.floor(ox));px<Math.min(w,Math.ceil(ox+project.cols*scale));px++){
    const c=clamp(Math.floor((px-ox)/scale),0,project.cols-1),r=clamp(Math.floor((py-oy)/scale),0,project.rows-1);
    g.fillStyle=project.palette[values[r*project.cols+c]]?.hex||'#fff';g.fillRect(px,py,1,1);
  }
}
function v16RefreshVersions(){
  if(!active)return;
  const choice=$('versionChoice'),previous=choice.value;
  choice.replaceChildren();
  const versions=active.versions||[];
  if(!versions.length)choice.add(new Option('No versions saved',''));
  versions.forEach((v,i)=>choice.add(new Option(`${v.label} · ${new Date(v.at).toLocaleDateString()} · ${v.data.cols}×${v.data.rows}`,String(i))));
  if(versions.length)choice.value=previous!==''&&versions[Number(previous)]?previous:'0';
  $('compareVersion').disabled=!versions.length;$('restoreVersion').disabled=!versions.length;
  $('versionCompare').hidden=true;
}
function v16SaveVersion(){
  if(!active||pendingConversion)return toast('Finish or discard the temporary conversion preview first.');
  const label=String($('versionName').value||'').trim()||`Design ${new Date().toLocaleDateString()}`;
  snapshot({label:'Save design version'});
  active.versions??=[];
  active.versions.unshift({id:uid(),label:label.slice(0,70),at:new Date().toISOString(),data:v16VersionPayload(active)});
  if(active.versions.length>V16_MAX_VERSIONS)active.versions.length=V16_MAX_VERSIONS;
  scheduleSave();v16RefreshVersions();$('versionChoice').value='0';toast('Named version saved inside this project and its project-backup ZIP.');
}
function v16ChosenVersion(){return active?.versions?.[Number($('versionChoice').value)]||null;}
function v16CompareVersion(){
  const v=v16ChosenVersion();if(!v)return toast('Save a version first.');
  v16PaintMini($('savedVersionPreview'),v.data);v16PaintMini($('currentVersionPreview'),active);
  let changed=0;
  const a=v16DisplayCells(v.data),b=v16DisplayCells(active),w=Math.max(v.data.cols,active.cols),h=Math.max(v.data.rows,active.rows);
  for(let r=1;r<=h;r++)for(let c=1;c<=w;c++){
    const old=r<=v.data.rows&&c<=v.data.cols?v.data.palette[a[(v.data.rows-r)*v.data.cols+c-1]]?.hex:null;
    const now=r<=active.rows&&c<=active.cols?active.palette[b[(active.rows-r)*active.cols+c-1]]?.hex:null;
    if(old!==now)changed++;
  }
  $('versionCompare').hidden=false;
  $('versionDiff').textContent=`${format(changed)} different or added/removed stitch positions across the compared chart dimensions. This is a color-and-placement comparison, not a yarn usage estimate.`;
}
function v16RestoreVersion(){
  const v=v16ChosenVersion();if(!v)return;
  if(!confirm(`Create a NEW project from saved version “${v.label}”? The current project will remain unchanged.`))return;
  flushSave();
  const data=structuredClone(v.data),copy=structuredClone(active);
  Object.assign(copy,data);
  copy.id=uid();copy.name=`${active.name} — ${v.label}`.slice(0,70);
  copy.createdAt=new Date().toISOString();copy.updatedAt=copy.createdAt;
  copy.versions=[];
  copy.annotations=(data.annotations||[]).map(note=>DoretteNext.locateNote(note,copy));
  copy.yarnInfo=data.palette.map(color=>{
    const index=active.palette.findIndex(yarn=>yarn.hex.toLowerCase()===color.hex.toLowerCase());
    return structuredClone(active.yarnInfo?.[index]||{});
  });
  copy.guide={row:1,position:0,finished:false};copy.diagonalIndex=0;
  copy.checkpoints=[];
  projects.set(copy.id,copy);queueWrite(copy);selectProject(copy.id);
  toast('Saved version restored as a separate project; the original remains untouched.');
}
function v16NoteLocation(note){
  if(note.scope==='section')return `Section ${DoretteNext.locateNote(note,active).section} · R${note.row}, C${note.col}`;
  if(note.scope==='row')return `Row ${note.row}`;
  return `R${note.row}, C${note.col}`;
}
function v16RefreshNotes(){
  if(!active)return;
  const host=$('annotationList');host.replaceChildren();
  const notes=active.annotations||[];
  if(!notes.length){const msg=document.createElement('span');msg.className='muted';msg.textContent='No reminders yet.';host.append(msg);return;}
  notes.slice().reverse().forEach(note=>{
    const row=document.createElement('div');row.className='v16-note';
    const jump=document.createElement('button');jump.type='button';jump.className='button ghost';
    jump.textContent=`${v16NoteLocation(note)}: ${note.text}`;
    jump.title='Go to this note on the chart';
    jump.addEventListener('click',()=>{
      selected={row:clamp(note.row,1,active.rows),col:clamp(note.col,1,active.cols)};
      view.x=canvasWidth/2-(M+(selected.col-.5)*CELL)*view.scale;
      view.y=canvasHeight/2-(M+(active.rows-selected.row+.5)*CELL)*view.scale;
      updateSelection();requestDraw();
    });
    const del=document.createElement('button');del.type='button';del.className='button ghost v16-remove';del.textContent='Remove';
    del.setAttribute('aria-label',`Remove note at ${v16NoteLocation(note)}`);
    del.addEventListener('click',()=>{snapshot({label:'Remove reminder'});active.annotations=active.annotations.filter(x=>x.id!==note.id);scheduleSave();v16RefreshNotes();requestDraw();updatePdfEstimate();});
    row.append(jump,del);host.append(row);
  });
}
function v16AddNote(){
  if(!active)return;
  const text=String($('annotationText').value||'').trim();if(!text)return toast('Type a reminder first.');
  if((active.annotations||[]).length>=V16_MAX_NOTES)return toast('This project already has 200 reminders. Remove one to add another.');
  const scope=$('annotationScope').value;
  if(scope!=='section'&&!selected)return toast('Select a stitch or row before attaching a reminder.');
  let col=selected?.col||1,row=selected?.row||1,section=null;
  if(scope==='section'){
    const sec=window.DoretteNext.sections(active,active.sectionSize||25)[Number($('workSectionSelect')?.value||1)-1];
    if(sec){col=sec.c0;row=sec.r0;section=sec.id;}
  }
  snapshot({label:'Add reminder'});
  active.annotations??=[];
  active.annotations.push({id:uid(),scope,col,row,section,text:text.slice(0,280),at:new Date().toISOString()});
  $('annotationText').value='';scheduleSave();v16RefreshNotes();requestDraw();updatePdfEstimate();
  toast('Reminder attached to the project.');
}
function v16MeasureArea(){
  if(!active||!areaSelection)return $('measurementResult').textContent='Choose Select area, then drag across stitches before measuring.';
  const a=areaSelection,w=Math.abs(a.start.col-a.end.col)+1,h=Math.abs(a.start.row-a.end.row)+1;
  const fields=['sizeSwatchCols','sizeSwatchRows','sizeSwatchWidth','sizeSwatchHeight'].map(id=>Number($(id).value));
  let desc=`${w} columns × ${h} rows = ${format(w*h)} stitches in the selected rectangular area.`;
  const gauge=window.DoretteAdvanced.gauge(w,h,...fields);
  if(gauge)desc+=` Approx. ${gauge.width.toFixed(2)} × ${gauge.height.toFixed(2)} ${$('sizeUnit').value} from the measured swatch.`;
  $('measurementResult').textContent=desc;
}
function v16ShapeCells(){
  if(!areaSelection||!active)return null;
  const a=areaSelection,left=Math.min(a.start.col,a.end.col),right=Math.max(a.start.col,a.end.col),
    bottom=Math.min(a.start.row,a.end.row),top=Math.max(a.start.row,a.end.row);
  const kind=$('shapeKind').value,w=right-left+1,h=top-bottom+1,positions=[];
  if(kind==='line'){
    let x=a.start.col,y=a.start.row,dx=Math.abs(a.end.col-x),dy=Math.abs(a.end.row-y),sx=x<a.end.col?1:-1,sy=y<a.end.row?1:-1,err=dx-dy;
    for(let count=0;count<Math.max(w,h)*2+2;count++){
      positions.push([x,y]);if(x===a.end.col&&y===a.end.row)break;
      const e2=2*err;if(e2>-dy){err-=dy;x+=sx;}if(e2<dx){err+=dx;y+=sy;}
    }
  }else{
    const ellipse=kind.includes('ellipse')||kind.includes('circle'),fill=kind.startsWith('filled'),circle=kind.includes('circle');
    const rx=(circle?Math.min(w,h):w)/2,ry=(circle?Math.min(w,h):h)/2,cx=(left+right)/2,cy=(bottom+top)/2;
    const inside=(col,row)=>((col-cx)/rx)**2+((row-cy)/ry)**2<=1;
    for(let row=bottom;row<=top;row++)for(let col=left;col<=right;col++){
      if(!ellipse){
        if(fill||row===bottom||row===top||col===left||col===right)positions.push([col,row]);
      }else if(inside(col,row)&&(fill||!inside(col-1,row)||!inside(col+1,row)||!inside(col,row-1)||!inside(col,row+1))){
        positions.push([col,row]);
      }
    }
  }
  return [...new Map(positions.map(([c,r])=>[`${c},${r}`,indexFor(c,r)])).values()];
}
function v16PreviewShape(){
  if(pendingConversion)return toast('Finish or discard the image conversion preview first.');
  const values=v16ShapeCells();if(!values?.length){v16ShapeProposal=null;requestDraw();return toast('Use Select area and drag the shape boundaries first.');}
  v16ShapeProposal=values;
  $('shapeInfo').textContent=`Preview: ${format(values.length)} stitches. Press Apply shape to paint with the currently selected yarn.`;
  requestDraw();
}
function v16ApplyShape(){
  if(!active||pendingConversion||editBlocked('draw a shape'))return;
  const values=v16ShapeCells();if(!values?.length)return toast('Select an area before drawing a shape.');
  const color=Number($('paintColor').value);if(!Number.isInteger(color)||!active.palette[color])return toast('Select a yarn color.');
  if((active.layers||[]).length>=80)return toast('The chart already has 80 layers.');
  const name=$('shapeKind').selectedOptions[0].textContent;
  setLayerAndRefresh({id:uid(),name,type:'shape',visible:true,locked:false,source:null,entries:values.map(i=>[i,color])});
  v16ShapeProposal=null;
  setTool('select');
  $('shapeInfo').textContent='Shape added as a layer. Use the layer arrows to move it, or Paint and Erase to edit its stitches.';
}
function liftShape(){
  if(!active||pendingConversion||editBlocked('lift shape stitches')||!areaSelection)return toast('Select an area containing the shape first.');
  if((active.layers||[]).length>=80)return toast('The chart already has 80 layers.');
  const color=Number($('paintColor').value);
  if(!color)return toast('Choose the shape’s yarn color first.');
  const {start,end}=areaSelection,entries=[];
  for(let row=Math.min(start.row,end.row);row<=Math.max(start.row,end.row);row++){
    for(let col=Math.min(start.col,end.col);col<=Math.max(start.col,end.col);col++){
      const i=indexFor(col,row);
      if(active.cells[i]===color)entries.push([i,color]);
    }
  }
  if(!entries.length)return toast('No base stitches match that yarn in the selected area.');
  snapshot({label:'Lift shape stitches'});
  for(const [i] of entries)active.cells[i]=0;
  const layer={id:uid(),name:'Lifted shape',type:'shape',visible:true,locked:false,source:null,entries};
  (active.layers??=[]).push(layer);selectedLayerId=layer.id;setTool('select');
  scheduleSave();refreshInspector();
  toast('Selected yarn stitches are now a movable shape layer.');
}
function v16DrawTexture(){
  if(!active)return;
  const source=v16DisplayCells(active),cols=active.cols,rows=active.rows,pixel=Math.max(3,Math.min(18,Math.floor(600/Math.max(cols,rows))));
  const a=$('textureOriginal'),b=$('textureSimulated');a.width=b.width=cols*pixel;a.height=b.height=rows*pixel;
  const ac=a.getContext('2d',{alpha:false}),bc=b.getContext('2d',{alpha:false});
  const density=$('textureDensity').value,shade=density==='high'?.24:density==='low'?.10:.17;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const col=active.palette[source[r*cols+c]]?.hex||'#fff',x=c*pixel,y=r*pixel;
    ac.fillStyle=bc.fillStyle=col;ac.fillRect(x,y,pixel,pixel);bc.fillRect(x,y,pixel,pixel);
    if(pixel>=3){bc.strokeStyle=`rgba(0,0,0,${shade})`;bc.lineWidth=Math.max(.5,pixel/8);bc.beginPath();
      bc.ellipse(x+pixel*.5,y+pixel*.56,pixel*.42,pixel*.23,0,Math.PI*.12,Math.PI*1.05);bc.stroke();
      bc.strokeStyle=`rgba(255,255,255,${Math.min(.65,shade*2)})`;bc.beginPath();bc.moveTo(x+pixel*.26,y+pixel*.25);bc.quadraticCurveTo(x+pixel*.53,y+pixel*.12,x+pixel*.76,y+pixel*.33);bc.stroke();
    }
  }
}
function v16DrawOverlays(g,cols,rows,s,minCol=0,maxCol=cols,minRow=0,maxRow=rows){
  if(!active||pendingConversion)return;
  if(v16ShapeProposal?.length){g.fillStyle='rgba(233,120,36,.48)';for(const i of v16ShapeProposal){g.fillRect(M+(i%cols)*CELL+1,M+Math.floor(i/cols)*CELL+1,CELL-2,CELL-2);}}
  if(v16Prefs.ruler){
    g.strokeStyle='#3a2558';g.lineWidth=1.3/s;g.beginPath();
    for(let c=0;c<=cols;c+=5){const x=M+c*CELL;g.moveTo(x,M-40);g.lineTo(x,M-(c%10===0?21:29));}
    for(let row=0;row<=rows;row+=5){const y=M+row*CELL;g.moveTo(M-40,y);g.lineTo(M-(row%10===0?21:29),y);}
    g.stroke();
  }
  for(const note of active.annotations||[]){
    if(note.row<1||note.row>rows||note.col<1||note.col>cols)continue;
    const c=note.scope==='row'?0:note.col-1,r=rows-note.row,
      x=M+c*CELL+CELL*.76,y=M+r*CELL+CELL*.21;
    g.fillStyle='#f59b25';g.strokeStyle='#523060';g.lineWidth=.8/s;
    g.beginPath();g.arc(x,y,CELL*.15,0,Math.PI*2);g.fill();g.stroke();
  }
  if(v16Prefs.cues){
    const pixels=CELL*s;if(pixels>=8){
      const viewW=g.canvas?.width||0,viewH=g.canvas?.height||0;
      const items=v16DisplayCells(active),palette=active.palette;
      const minC=minCol,maxC=maxCol,minR=minRow,maxR=maxRow;
      for(let r=minR;r<maxR;r++)for(let c=minC;c<maxC;c++){
        const i=r*cols+c,color=items[i];if(color===0)continue;
        const x=M+c*CELL,y=M+r*CELL,pattern=color%4;
        const hex=palette[color]?.hex||'#ffffff';
        const luma=.299*parseInt(hex.slice(1,3),16)+.587*parseInt(hex.slice(3,5),16)+.114*parseInt(hex.slice(5,7),16);
        g.strokeStyle=g.fillStyle=luma<140?'#ffffff':'#2e2455';g.lineWidth=1.25/s;
        if(pattern===0){g.beginPath();g.moveTo(x+5,y+CELL-5);g.lineTo(x+CELL-5,y+5);g.stroke();}
        if(pattern===1){g.beginPath();g.arc(x+CELL/2,y+CELL/2,2.5/s,0,2*Math.PI);g.fill();}
        if(pattern===2){g.strokeRect(x+CELL*.29,y+CELL*.29,CELL*.42,CELL*.42);}
        if(pattern===3){g.beginPath();g.moveTo(x+CELL*.2,y+CELL*.5);g.lineTo(x+CELL*.8,y+CELL*.5);g.stroke();}
      }
    }
  }
}
function v16RestoreUI(){
  v16ShapeProposal=null;
  v16RefreshVersions();v16RefreshNotes();v16ApplyPrefs();
}
function v16Hook(){
  for(const [id,key] of [['skillMode','mode'],['highContrastGrid','highContrast'],['colorCueMode','cues'],['alwaysSymbols','symbols'],['numberScale','numberScale'],['showMeasurementRuler','ruler']]){
    $(id).addEventListener('change',()=>{v16Prefs[key]=['mode','numberScale'].includes(key)?$(id).value:$(id).checked;v16SavePrefs();v16ApplyPrefs();});
  }
  $('saveVersion').addEventListener('click',v16SaveVersion);
  $('compareVersion').addEventListener('click',v16CompareVersion);
  $('restoreVersion').addEventListener('click',v16RestoreVersion);
  $('addAnnotation').addEventListener('click',v16AddNote);
  $('measureArea').addEventListener('click',v16MeasureArea);
  $('previewShape').addEventListener('click',v16PreviewShape);
  $('applyShape').addEventListener('click',v16ApplyShape);
  $('liftShape').addEventListener('click',liftShape);
  $('renderTexture').addEventListener('click',v16DrawTexture);
  $('shapeKind').addEventListener('change',()=>{v16ShapeProposal=null;requestDraw();});
  v16ApplyPrefs();
}

function renderDesignHistory(){
 const panel=$('designHistory');if(!panel)return;panel.replaceChildren();
 const count=designHistoryLabels.length;
 for(const label of designHistoryLabels.slice(-8).reverse()){
   const line=document.createElement('div');line.className='history-line';line.textContent='↶ '+label;panel.append(line);
 }
 if(!count){const hint=document.createElement('small');hint.className='muted';hint.textContent='No design edits in this session.';panel.append(hint);}
  $('historyUndo').disabled=!undoStack.length;$('historyRedo').disabled=!redoStack.length;updateProgressUndo();
}
function diagnosticsPayload(){return reliability.makeDiagnostics({
 version:'1.8.1',saveState:savePhase,pendingWrites:writePending+(saveTimer?1:0),projectCount:projects.size,
 activeProject:active,renderMetrics:{lastDrawMs:Number(drawLast.toFixed(1)),averageDrawMs:drawSamples?Number((drawTotal/drawSamples).toFixed(1)):0},
 });}
function showDiagnostics(){
 const host=$('diagnosticSummary');if(!host)return;
 const report=diagnosticsPayload();
 host.textContent=JSON.stringify({...report,quarantinedProjects:invalidProjects.size,quarantinedChecks:[...invalidProjects.values()].map(x=>x.check)},null,2);
}
function setTabReadOnly(writable){
 studioReadOnly=!writable||reloadingProjects;
 document.body.classList.toggle('dorette-readonly',studioReadOnly);
 $('tabLockBanner').hidden=!studioReadOnly;
 if(studioReadOnly){$('tabLockMessage').textContent='Another browser tab or window is editing projects on this device. Close it, then retry here. No changes can be saved from this tab.';status('Read-only — another tab is editing',true);}
 else refreshSaveState();
}
async function updateStorageIndicator(){
 const host=$('storageInfo');if(!host||!Ops)return;
 const summary=await Ops.inspectStorage(projects.values());
 const used=Ops.formatSize(summary.used),quota=Ops.formatSize(summary.quota);
 const estimate=Ops.formatSize(summary.totalEstimate);
 const ratio=summary.ratio===null?'unknown':Math.round(summary.ratio*100)+'%';
 host.textContent=`Browser storage: ${used} of ${quota} (${ratio}). Approx. project payload: ${estimate}. ${summary.large.map(p=>p.name+': '+Ops.formatSize(p.bytes)).join(' · ')}`;
 if(summary.warning){$('storageInfo').classList.add('storage-danger');host.textContent+=' · Storage may be nearly full. Check the save status. If a save fails, export a private project ZIP, free space outside Studio, then use Retry saving.';}
 else host.classList.remove('storage-danger');
}
async function safeMajorCopy(reason){
 if(!active||studioReadOnly||!Ops.canWrite())return false;
 if(!safeEditsEnabled)return true;
 if(memoryOnly||majorCopyPending){toast('A separate copy could not be started. Check local saving and try again.');return false;}
 const source=active,revision=renderRevision;
 majorCopyPending=true;
 let copy=null;
 try{
   await flushSave().catch(()=>{});
   if(active!==source||renderRevision!==revision)return false;
   if(failedWrites.has(source.id))throw Error('Save the original project before making a copy.');
   copy=structuredClone(source);
   copy.id=uid();copy.name=(source.name+' — '+reason+' copy').slice(0,70);
   copy.createdAt=copy.updatedAt=new Date().toISOString();
   await queueWrite(copy);
   projects.set(copy.id,copy);
   if(active!==source||renderRevision!==revision||studioReadOnly||!Ops.canWrite()){
     refreshProjectList();toast('Copy saved. Open it to continue editing.');return false;
   }
   selectProject(copy.id);
   toast('Working in a saved separate copy.');
   return true;
 }catch(e){
   if(copy)failedWrites.delete(copy.id);
   refreshSaveState();toast('Copy could not be saved: '+e.message);
   return false;
 }finally{majorCopyPending=false;}
}
function renderExportPreview(){
 if(!active||$('exportPreviewDialog').open)return;
 const model=compositeProject(active),check=reliability.auditExport(active,model.cells);
 if(!check.ok){$('exportConsistency').textContent='Export data check failed: '+check.errors[0];return;}
 const view=$('exportPreviewCanvas'),scale=Math.max(1,Math.min(4,Math.floor(460/Math.max(active.cols,active.rows))));
 view.width=Math.max(1,Math.round(active.cols*scale));view.height=Math.max(1,Math.round(active.rows*scale));
 const ctx=view.getContext('2d',{willReadFrequently:true,alpha:false});
 for(let r=0;r<active.rows;r++)for(let c=0;c<active.cols;c++){
   const col=model.palette[model.cells[r*active.cols+c]]?.hex||'#fff';ctx.fillStyle=col;ctx.fillRect(c*scale,r*scale,Math.ceil(scale),Math.ceil(scale));
 }
 // Compare deterministic points with the authoritative composited model.
 let sampled=0,matched=0;
 for(let i=0;i<Math.min(100,model.cells.length);i++){
   const index=Math.floor(i*(model.cells.length-1)/Math.max(1,Math.min(100,model.cells.length)-1));
   const c=index%active.cols,r=Math.floor(index/active.cols),x=Math.min(view.width-1,Math.floor((c+.5)*scale)),y=Math.min(view.height-1,Math.floor((r+.5)*scale));
   const px=ctx.getImageData(x,y,1,1).data,expected=model.palette[model.cells[index]].hex;
   const rgb='#'+[px[0],px[1],px[2]].map(v=>v.toString(16).padStart(2,'0')).join('');
   if(rgb.toLowerCase()===expected.toLowerCase())matched++;sampled++;
 }
 const message=`${model.cols} × ${model.rows} stitches; ${model.palette.length} yarn colors. ${matched}/${sampled} sampled preview pixels match the composited chart. Printable PDF, PNG, SVG and written instructions use the saved chart model. Actual page layout should be checked separately.`;
 $('exportPreviewReport').textContent=message;
 $('exportConsistency').textContent=matched===sampled?'✓ Preview colors match saved chart data.':'⚠ Preview needs review before export.';
 $('exportPreviewDialog').showModal();
}
const settingsLayoutKey='studio.settings.layout.v1';
let settingsSections=new Map();
function revealSettingsSection(section){
  if(!section)return;
  $('toggleSettings').dataset.hidden='0';refreshWorkspaceLayout();
  if(getComputedStyle(section).display==='none'){
    const mode=['edit','create','crochet'].find(name=>section.classList.contains(name+'-section'));
    if(mode)setStudioMode(mode);
    if(getComputedStyle(section).display==='none')section.classList.add('settings-revealed');
  }
  section.querySelector('.settings-section-toggle')?.setAttribute('aria-expanded','true');
  section.classList.remove('settings-collapsed');
  section.dispatchEvent(new Event('settings-open'));
}
function setupAppNavigation(){
  const nav=$('appNavigation'),categories=$('appMenuCategories'),toggle=$('appMenuToggle');
  const visibilityKey='studio.panel.visibility.v1';
  let visibility={};
  try{visibility=JSON.parse(localStorage.getItem(visibilityKey))||{};}catch{}
  const projects=$('toggleProjects'),settings=$('toggleSettings');
  projects.dataset.hidden=(visibility.projects??matchMedia('(max-width:920px)').matches)?'1':'0';
  settings.dataset.hidden=visibility.settings===true?'1':'0';
  refreshWorkspaceLayout();
  const persist=()=>{
    try{localStorage.setItem(visibilityKey,JSON.stringify({projects:projects.dataset.hidden==='1',settings:settings.dataset.hidden==='1'}));}catch{}
  };
  for(const button of [projects,settings])button.addEventListener('click',persist);
  $('collapseProjects').onclick=()=>{projects.click();projects.focus();};
  function close(focus=false){
    const trigger=nav.querySelector('details[open] > summary');
    nav.querySelectorAll('details[open]').forEach(details=>details.open=false);
    nav.classList.remove('menu-open');toggle.setAttribute('aria-expanded','false');
    if(focus)(toggle.getClientRects().length?toggle:trigger)?.focus();
  }
  toggle.onclick=()=>{if(nav.classList.contains('menu-open'))close();else{nav.classList.add('menu-open');toggle.setAttribute('aria-expanded','true');}};
  $('headerFindTool').onclick=()=>{close();$('openCommandSearch').click();};
  function go(id,action){
    const node=id==='guidePdf'?document.querySelector('.guide-link'):$(id);if(!node)return;
    if(inCrochetView()&&['toggleProjects','toggleSettings'].includes(id)){
      setStudioMode('edit');
      if(node.dataset.hidden==='1')node.click();
      const target=id==='toggleSettings'?$('customizeSettings'):$('projectSearch');
      target.scrollIntoView({block:'center'});target.focus({preventScroll:true});
      return;
    }
    if(inCrochetView()&&(node.closest('.inspector,.sidebar,.stitch-editor')||['undoButton','redoButton','editLastText','quickTextLayer','openChartStructure'].includes(id)))return toast('Exit Crochet View to use this command. Your crochet progress stays saved.');
    if(action){
      if(node.disabled){
        const reasons={undoButton:'There is no chart change to undo.',redoButton:'There is no chart change to redo.',
          editLastText:'Add and select an editable text layer first.',
          quickTextLayer:isPatternLocked()?'Unlock Pattern Lock before painting a text layer.':'Add and select an editable text layer first.'};
        return toast(reasons[id]||'Open an editable project and select a stitch or layer first.');
      }
      node.click();return;
    }
    const section=node.closest('.settings-section');
    if(section)revealSettingsSection(section);
    if(node.closest('.sidebar')){projects.dataset.hidden='0';refreshWorkspaceLayout();}
    for(let el=node;el;el=el.parentElement)if(el.tagName==='DETAILS')el.open=true;
    if(id==='imageFile'){node.click();return;}
    node.scrollIntoView({block:'center'});if(node.tabIndex<0)node.tabIndex=-1;node.focus({preventScroll:true});
  }
  const menu={
    File:[['New Project','newName'],['Open Project','projectSearch'],['Print / Export PDF','exportPdf',true],['Share Project','shareProject',true],['Back Up This Project','exportProject',true],['Back Up All Projects','exportAll',true],['Restore Backup','restoreProject',true],['Save Snapshot','saveCheckpoint',true]],
    Edit:[['Select','toolSelect',true],['Paint','toolPaint',true],['Erase','toolErase',true],['Undo','undoButton',true],['Redo','redoButton',true],['Edit Lettering','editLastText',true],['Text Layer Paint / Erase','quickTextLayer',true],['Rows & Columns','openChartStructure',true],['Editable Layers','layerList']],
    View:[['Single Chart','singleChart',true],['Dual Chart','dualChart',true],['Crochet View','crochetView',true],['Show / Hide Projects','toggleProjects',true],['Show / Hide Settings','toggleSettings',true],['Zoom In','zoomIn',true],['Zoom Out','zoomOut',true],['Fit Chart','fitChart',true],['Center Chart','resetView',true]],
    Tools:[['Text to Chart','textInput'],['Image to Chart','imageFile'],['Stitch Scanner','openStitchStudio',true],['Yarn Palette','legend'],['Finished Size Calculator','sizePanel'],['Smart Cleanup & Quality','patternHealth']],
    Help:[['Find a Tool','openCommandSearch',true],['Guided Tutorial','quickTutorial',true],['User Guide PDF','guidePdf',true],['About Studio','studioBuildBadge']]
  };
  for(const [label,commands] of Object.entries(menu)){
    const detail=document.createElement('details'),summary=document.createElement('summary'),items=document.createElement('div');
    summary.textContent=label;items.className='app-menu-items';
    summary.onclick=()=>{for(const other of categories.querySelectorAll('details[open]'))if(other!==detail)other.open=false;};
    for(const [name,id,action] of commands){
      if(id!=='guidePdf'&&!$(id))continue;
      const button=document.createElement('button');button.type='button';button.className='button ghost';button.textContent=name;
      button.onclick=()=>{close(true);go(id,action);};items.append(button);
    }
    detail.append(summary,items);categories.append(detail);
  }
  window.StudioHandleBack=()=>{
    const modal=[...document.querySelectorAll('dialog[open]')].filter(dialog=>dialog.matches(':modal')).at(-1);
    if(modal){
      if(modal.dispatchEvent(new Event('cancel',{cancelable:true})))modal.close();
      return true;
    }
    if($('settingsJump').open){$('settingsJump').open=false;$('settingsJump').querySelector('summary').focus();return true;}
    if(nav.classList.contains('menu-open')||nav.querySelector('details[open]')){close(true);return true;}
    if(matchMedia('(max-width:920px)').matches&&!inCrochetView()&&projects.dataset.hidden!=='1'){
      projects.click();projects.focus();return true;
    }
    return false;
  };
  document.addEventListener('pointerdown',e=>{if(!nav.contains(e.target))close();});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&(nav.classList.contains('menu-open')||nav.querySelector('details[open]'))){e.preventDefault();close(true);}
  });
}

function setupSettingsLayout(){
  const inspector=document.querySelector('.inspector'),jump=$('jumpSettings');
  const sections=[...inspector.querySelectorAll(':scope > .inspector-section,:scope > .settings-card')];
  const make=(tag,cls,label)=>{
    const el=document.createElement(tag);el.className=cls;el.textContent=label;
    if(tag==='button')el.type='button';
    return el;
  };
  let saved={};
  try{saved=JSON.parse(localStorage.getItem(settingsLayoutKey))||{};}catch{}
  const strings=value=>Array.isArray(value)?value.filter(v=>typeof v==='string'):[];
  const collapsed=new Set(strings(saved.collapsed)),favorites=new Set(strings(saved.favorites));
  const defaults=[];
  let order=[];
  function persist(){
    try{localStorage.setItem(settingsLayoutKey,JSON.stringify({order,collapsed:[...collapsed],favorites:[...favorites]}));}catch{}
  }
  function navigate(section){
    revealSettingsSection(section);
    const heading=section.querySelector('.settings-section-toggle');
    heading.scrollIntoView({block:'center'});heading.focus({preventScroll:true});
    heading.classList.add('settings-highlight');
    setTimeout(()=>heading.classList.remove('settings-highlight'),1400);
  }
  function renderShortcuts(){
    jump.replaceChildren();
    const host=$('favoriteSettings');host.replaceChildren();
    for(const key of order){
      const section=settingsSections.get(key),label=section.dataset.settingsLabel;
      const entry=make('button','button ghost',label);
      entry.onclick=()=>{jump.closest('details').open=false;navigate(section);};jump.append(entry);
      if(favorites.has(key)){
        const shortcut=make('button','button ghost',label);
        shortcut.onclick=()=>navigate(section);host.append(shortcut);
      }
    }
    if(host.children.length){
      const title=make('strong','muted','Favorite Settings');
      host.prepend(title);
    }
  }
  function renderOrder(){
    for(const key of order)inspector.append(settingsSections.get(key));
    renderShortcuts();
  }
  function move(key,to,focus){
    const from=order.indexOf(key);
    if(to<0||to>=order.length||from===to)return;
    order.splice(from,1);order.splice(to,0,key);
    renderOrder();persist();focus?.focus({preventScroll:true});
    $('settingsLayoutStatus').textContent=settingsSections.get(key).dataset.settingsLabel+' moved to position '+(to+1)+' of '+order.length+'.';
  }
  for(const section of sections){
    const original=section.querySelector(':scope > .section-title,:scope > .inspector-heading,:scope > .eyebrow,:scope > summary');
    if(!original)continue;
    const raw=(original.querySelector('h2,.eyebrow')||original).textContent.trim();
    const label=raw===raw.toUpperCase()?raw.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()).replace(/\bPdf\b/g,'PDF'):raw;
    const key=section.dataset.settingsKey||section.id||raw.toLowerCase().replace(/[^a-z0-9]+/g,'-');
    section.dataset.settingsLabel=label;section.dataset.settingsKey=key;
    section.classList.add('settings-section');original.classList.add('settings-original-heading');
    if(section.tagName==='DETAILS')section.open=true;
    settingsSections.set(key,section);defaults.push(key);
    const head=make('div','settings-section-header','');
    const toggle=make('button','settings-section-toggle',label);
    function setOpen(open){
      section.classList.toggle('settings-collapsed',!open);toggle.setAttribute('aria-expanded',String(open));
      if(open)collapsed.delete(key);else collapsed.add(key);
    }
    setOpen(!collapsed.has(key));
    toggle.onclick=()=>{setOpen(section.classList.contains('settings-collapsed'));persist();};
    section.addEventListener('settings-open',()=>{setOpen(true);persist();});
    const star=make('button','settings-favorite','');
    function renderStar(){
      const starred=favorites.has(key);
      star.textContent=starred?'★':'☆';star.setAttribute('aria-pressed',String(starred));
      star.setAttribute('aria-label',(starred?'Remove favorite: ':'Favorite: ')+label);
    }
    renderStar();
    star.onclick=()=>{if(favorites.has(key))favorites.delete(key);else favorites.add(key);renderStar();renderShortcuts();persist();};
    const controls=make('div','settings-reorder','');
    for(const [label,delta] of [['Up',-1],['Down',1]]){
      const button=make('button','',delta<0?'↑':'↓');button.setAttribute('aria-label','Move '+raw+' '+label.toLowerCase());
      button.onclick=()=>move(key,order.indexOf(key)+delta,button);controls.append(button);
    }
    const grip=make('button','settings-grip','↕');grip.setAttribute('aria-label','Drag '+label+' to reorder');
    let drag=null;
    function track(){
      if(!drag)return;
      const bounds=inspector.getBoundingClientRect(),heading=inspector.querySelector('.settings-navigation').getBoundingClientRect();
      const top=Math.max(bounds.top,heading.bottom,0),bottom=Math.min(bounds.bottom,innerHeight);
      const zone=Math.min(48,(bottom-top)/4);
      if(zone>0){
        const speed=drag.y<top+zone?-Math.min(16,(top+zone-drag.y)/3):drag.y>bottom-zone?Math.min(16,(drag.y-bottom+zone)/3):0;
        if(speed)inspector.scrollTop+=speed;
      }
      const x=Math.max(bounds.left+2,Math.min(bounds.right-2,drag.x));
      const y=Math.max(top+1,Math.min(bottom-1,drag.y));
      let target=null;
      if(drag.x>=bounds.left&&drag.x<=bounds.right&&bottom>top){
        target=document.elementFromPoint(x,y)?.closest('.settings-section');
        if(!target){
          let distance=Infinity;
          for(const candidate of settingsSections.values()){
            const rect=candidate.getBoundingClientRect();
            if(rect.bottom<=top||rect.top>=bottom)continue;
            const gap=Math.max(rect.top-y,y-rect.bottom,0);
            if(gap<distance){target=candidate;distance=gap;}
          }
        }
      }
      if(target!==drag.target){
        drag.target?.classList.remove('settings-drop-before','settings-drop-after');
        drag.target=target;
        const from=order.indexOf(key),to=order.indexOf(target?.dataset.settingsKey);
        if(to>=0&&to!==from)target.classList.add(to<from?'settings-drop-before':'settings-drop-after');
        $('settingsLayoutStatus').textContent=label+' · position '+(from+1)+' of '+order.length+(to>=0&&to!==from?' → '+(to+1):'');
      }
      drag.frame=requestAnimationFrame(track);
    }
    function finish(commit){
      if(!drag)return;
      cancelAnimationFrame(drag.frame);
      const target=drag.target;drag=null;
      section.classList.remove('settings-dragging');
      target?.classList.remove('settings-drop-before','settings-drop-after');
      $('settingsLayoutStatus').textContent=order.length+' sections · Drag or use Up and Down.';
      const to=order.indexOf(target?.dataset.settingsKey);
      if(commit&&to>=0&&to!==order.indexOf(key)){
        move(key,to,grip);
        section.scrollIntoView({block:'nearest'});
        if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
          section.animate([{transform:'translateY(-6px)',opacity:.75},{transform:'translateY(0)',opacity:1}],{duration:160});
        }
      }
    }
    grip.onpointerdown=e=>{
      if(e.button!==0||drag)return;
      grip.setPointerCapture(e.pointerId);
      drag={id:e.pointerId,x:e.clientX,y:e.clientY,target:null};
      section.classList.add('settings-dragging');
      $('settingsLayoutStatus').textContent=label+' · position '+(order.indexOf(key)+1)+' of '+order.length;
      track();
    };
    grip.onpointermove=e=>{if(drag?.id===e.pointerId){drag.x=e.clientX;drag.y=e.clientY;}};
    grip.onpointerup=e=>{if(drag?.id===e.pointerId){cancelAnimationFrame(drag.frame);drag.x=e.clientX;drag.y=e.clientY;track();finish(true);}};
    grip.onpointercancel=grip.onlostpointercapture=()=>finish(false);
    controls.append(grip);head.append(toggle,star,controls);section.prepend(head);
  }
  order=[...new Set([...strings(saved.order).filter(key=>settingsSections.has(key)),...defaults])];
  renderOrder();
  const chooser=$('settingsJump');
  document.addEventListener('pointerdown',event=>{if(!chooser.contains(event.target))chooser.open=false;});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&chooser.open){event.preventDefault();chooser.open=false;chooser.querySelector('summary').focus();}
  });
  const customize=$('customizeSettings'),reset=$('resetSettingsOrder'),status=$('settingsLayoutStatus');
  customize.onclick=()=>{
    const editing=inspector.classList.toggle('settings-customizing');
    customize.textContent=editing?'Done':'Customize Layout';customize.setAttribute('aria-pressed',String(editing));
    reset.hidden=status.hidden=!editing;
    status.textContent=editing?order.length+' sections · Drag or use Up and Down.':'';
  };
  reset.onclick=()=>{order=defaults.slice();renderOrder();persist();status.textContent='Default section order restored.';};
}
function setupCommandPalette(){
 const commands=[
  ['New project','#newName','Edit','Start a blank chart','create start crochet project'],
  ['Recycle Bin','#projectBin','Edit','Find and restore deleted projects','where deleted project trash recover'],
  ['Chart dimensions','#colsInput','Edit','Resize from the top, bottom, left or right edge','remove rows from bottom make chart bigger add remove columns resize'],
  ['Rows & Columns','#openChartStructure','Edit','Insert or delete a line at the selected stitch','add a row insert delete column middle'],
  ['Edit lettering','#editLastText','Edit','Select a text layer to change its wording','change a word edit existing text letters'],
  ['Paint or erase lettering','#quickTextLayer','Edit','Select an unlocked text layer to paint or erase its stitches','erase a letter paint text layer'],
  ['Layer lock','#layerList','Edit','Find the lock control on the desired editable layer','protect text layer'],
  ['Crochet View','#crochetView','Crochet','Open the focused chart and current-row instructions','full screen focus progress'],
  ['Row Color Instructions','#crochetView','Crochet','Open Crochet View to follow yarn changes by row','show yarn colors color sequence colorwork'],
  ['Yarn Palette','#legend','Edit','See and manage chart yarn colors','show yarn colors color palette legend'],
  ['Stitch Scanner','#openStitchStudio','Edit','Open the offline symbol scanner and stitch reference','identify scan crochet symbol'],
  ['Back up all projects','#exportAll','Edit','Save a ZIP of your projects','save all my projects export backup'],
  ['Restore backup','#restoreProject','Edit','Import saved ZIP project copies','import zip restore'],
  ['Share project','#shareProject','Edit','Share a ZIP copy of the current project','send project zip'],
  ['Show or hide Projects','#toggleProjects','Edit','Give the chart more space or show the library','hide projects sidebar show project workspace'],
  ['Customize Layout','#customizeSettings','Edit','Rearrange whole Settings sections','rearrange settings move reorder workspace'],
  ['Zoom chart','#zoomIn','Edit','Make the chart appear larger without changing dimensions','make chart bigger magnify'],
  ['Guided tutorial','#quickTutorial','Edit','Find an introduction to the Studio','help tutorial learn'],
  ['Import photo','#imageFile','Create'],['Grayscale conversion','#conversionMode','Create'],['Detect imported grid','#detectGrid','Create'],
  ['Background cleanup','#removeBackground','Create'],['Advanced chart resize','#smartResize','Edit'],['Editable layers','#layerPanel','Edit'],
  ['Text and lettering','#textInput','Create'],['Yarn color replacement','#replaceEverywhere','Edit'],['Shapes','#shapeKind','Edit'],
  ['Undo and redo','#undoButton','Edit'],['Pattern lock','#patternLock','Edit'],['Guided crochet','#openGuide','Crochet'],
  ['Go to row and column','#goToCell','Crochet'],['Work sections','#workSectionSelect','Crochet'],
  ['Printable PDF','#exportPdf','Edit','Print or save the chart as a PDF','print my chart export PDF'],['Written instructions PDF','#exportWrittenPdf','Edit'],['PNG image export','#exportPng','Edit'],
  ['Project backup','#exportAll','Edit'],['Project integrity','#runIntegrityCheck','Edit'],['Storage usage','#refreshStorage','Edit'],
  ['Export preview','#previewExport','Edit'],['Project gallery','#projectSearch','Edit']
 ];
 for(const section of settingsSections.values()){
   const heading=section.querySelector('.settings-section-toggle');
   heading.id='settings-heading-'+section.dataset.settingsKey;
   commands.push([section.dataset.settingsLabel,'#'+heading.id,'Edit','Open this Settings section']);
 }
 const results=$('commandResults'),query=$('commandQuery'),dialog=$('commandDialog');
 const toolKey='studio.tool.shortcuts.v1';
 let shortcuts={};
 try{shortcuts=JSON.parse(localStorage.getItem(toolKey))||{};}catch{}
 const known=new Set(commands.map(([label])=>label));
 const clean=list=>Array.isArray(list)?list.filter(label=>known.has(label)):[];
 const favoriteTools=new Set(clean(shortcuts.favorites));
 let recentTools=clean(shortcuts.recent).slice(0,6);
 function saveTools(){
   try{localStorage.setItem(toolKey,JSON.stringify({favorites:[...favoriteTools],recent:recentTools}));}catch{}
 }
 let jumping=false;
 function update(){
  results.replaceChildren();
  const q=query.value.trim().toLowerCase(),words=q.match(/[a-z0-9]+/g)||[];
  const score=([label,,mode,description='',aliases=''])=>{
    const title=label.toLowerCase(),all=[title,aliases.toLowerCase(),description.toLowerCase(),mode.toLowerCase()].join(' ');
    if(!words.length)return 1;
    const hits=words.filter(word=>all.includes(word)).length;
    if(!hits)return 0;
    return (title.includes(q)?60:0)+(aliases.toLowerCase().includes(q)?45:0)+hits*8+words.filter(word=>title.includes(word)).length*3;
  };
  function add([label,selector,mode,description='']){
   const node=document.querySelector(selector);if(!node)return;
   const row=document.createElement('div');row.className='command-entry';
   const btn=document.createElement('button');btn.type='button';btn.className='command-result';
   const name=document.createElement('strong');name.textContent=label;
   const where=document.createElement('small');where.textContent=mode+(description?' · '+description:'');
   btn.append(name,where);
   btn.onclick=()=>{
    jumping=true;dialog.close();setStudioMode(mode.toLowerCase());
    const section=node.closest('.settings-section');
    if(section)revealSettingsSection(section);
    if(node.closest('.sidebar')){$('toggleProjects').dataset.hidden='0';refreshWorkspaceLayout();}
    for(let el=node;el;el=el.parentElement)if(el.tagName==='DETAILS')el.open=true;
    recentTools=[label,...recentTools.filter(item=>item!==label)].slice(0,6);saveTools();
    if(node.id==='imageFile'){node.click();return;}
    node.scrollIntoView({behavior:'auto',block:'center'});
    if(node.tabIndex<0)node.tabIndex=-1;
    node.focus({preventScroll:true});node.classList.add('settings-highlight');
    setTimeout(()=>node.classList.remove('settings-highlight'),1400);
    if(node.disabled)toast(description||'This tool needs an active project or selection.');
   };
   const star=document.createElement('button');star.type='button';star.className='command-star';
   const render=()=>{const on=favoriteTools.has(label);star.textContent=on?'★':'☆';star.setAttribute('aria-pressed',String(on));star.setAttribute('aria-label',(on?'Remove favorite: ':'Favorite: ')+label);};
   render();
   star.onclick=()=>{
     if(favoriteTools.has(label))favoriteTools.delete(label);else favoriteTools.add(label);
     saveTools();render();
     for(const other of results.querySelectorAll('.command-star'))if(other!==star&&other.dataset.tool===label){
       other.textContent=star.textContent;for(const attr of ['aria-pressed','aria-label'])other.setAttribute(attr,star.getAttribute(attr));
     }
   };
   star.dataset.tool=label;row.append(btn,star);results.append(row);
  }
  function group(title,list){
   if(!list.length)return;
   const heading=document.createElement('h3');heading.textContent=title;results.append(heading);
   list.forEach(add);
  }
  const ranked=commands.map(command=>({command,score:score(command)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score).map(item=>item.command);
  if(!q){
    group('Favorite Tools',commands.filter(([label])=>favoriteTools.has(label)));
    group('Recently Used',recentTools.map(label=>commands.find(command=>command[0]===label)).filter(Boolean));
  }
  group(q?'Search results':'Search All Tools',q?ranked.slice(0,20):ranked);
  if(!ranked.length){const msg=document.createElement('p');msg.textContent='No matching Studio tools.';results.append(msg);}
 }
 function open(){if(dialog.open)return;jumping=false;dialog.showModal();query.value='';update();query.focus();}
 $('openCommandSearch').addEventListener('click',open);
 $('closeCommandSearch').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();dialog.close();}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){const controls=[...results.querySelectorAll('button')];if(!controls.length)return;const n=controls.indexOf(document.activeElement);if(n>=0){e.preventDefault();controls[(n+(e.key==='ArrowDown'?1:-1)+controls.length)%controls.length].focus();}else if(e.key==='ArrowDown'){e.preventDefault();controls[0].focus();}}});
 dialog.addEventListener('close',()=>{if(!jumping)$('openCommandSearch').focus({preventScroll:true});});
 query.addEventListener('input',update);
 query.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();dialog.close();return;}if(e.key==='Enter'){const first=results.querySelector('button');if(first){e.preventDefault();first.click();}}});
 window.addEventListener('keydown',e=>{if(!inCrochetView()&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();open();}});
}
function setupPolishTools(){
 // Read-only tabs remain viewable, but design, progress and backup UI actions cannot write.
 const blockReadonly=e=>{
   if(!studioReadOnly)return;
   const target=e.target.closest?.('button, input, select, textarea, summary, a');
   if(!target||target.closest('#tabLockBanner')||target.classList.contains('gallery-choose')||(target.tagName==='A'&&target.hasAttribute('download')&&target.protocol==='blob:')||['headerExport','exportProject','shareProject','exportAll','singleChart','dualChart','fitChart','zoomIn','zoomOut','resetView'].includes(target.id))return;
   e.preventDefault();e.stopImmediatePropagation();
   toast('This tab is read-only. Close the editing tab, then choose Retry editing.');
 };
 document.addEventListener('click',blockReadonly,true);
 document.addEventListener('change',blockReadonly,true);
 document.addEventListener('submit',e=>{if(studioReadOnly){e.preventDefault();e.stopImmediatePropagation();}},true);
 document.addEventListener('pointerdown',e=>{if(studioReadOnly&&(e.target===canvas||e.target===overviewCanvas)){e.preventDefault();e.stopImmediatePropagation();}},true);
 window.addEventListener('keydown',e=>{
   if(!studioReadOnly)return;
   if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())||(e.target===canvas&&e.key===' ')){e.preventDefault();e.stopImmediatePropagation();}
 },true);
 $('cancelBackgroundJob').addEventListener('click',cancelImageJob);
 safeEditsEnabled=(()=>{try{return localStorage.getItem(standaloneKeys.safeEdits)==='true';}catch{return false;}})();
 $('safeEdits').checked=safeEditsEnabled;
   $('safeEdits').addEventListener('change',e=>{safeEditsEnabled=e.target.checked;try{localStorage.setItem(standaloneKeys.safeEdits,String(safeEditsEnabled));}catch{}
     if(pendingConversion)$('applyConversion').textContent=safeEditsEnabled?'Apply to a separate copy':'Apply to current project';
   });
 $('retryEditing').addEventListener('click',retryEditing);
 $('refreshStorage').addEventListener('click',updateStorageIndicator);
 $('previewExport').addEventListener('click',renderExportPreview);
 $('closeExportPreview').addEventListener('click',()=>$('exportPreviewDialog').close());
 $('exportPreviewDialog').addEventListener('close',()=>$('previewExport').focus({preventScroll:true}));
 setupCommandPalette();
 updateStorageIndicator();
 storageRefreshTimer=setInterval(()=>{if(!document.hidden)updateStorageIndicator();},90000);
}
const recoveryLimit=3,recoveryInterval=120000,recoverySizeLimit=8*1024*1024;
let recoveryDb,preparedProtectionBackup=null;
const protectionKey='studio-independent-backup-v1';
function protectionPreference(key){
 try{return localStorage.getItem(key);}catch{return null;}
}
function setProtectionPreference(key,value){
 try{localStorage.setItem(key,value);return true;}catch{return false;}
}
function openRecovery(){
 return recoveryDb??=new Promise((resolve,reject)=>{
   const request=indexedDB.open('dorette-studio-local-recovery',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('history');
   request.onsuccess=()=>resolve(request.result);
   request.onerror=()=>reject(request.error);
 });
}
async function recoveryRecords(project){
 const database=await openRecovery();
 return new Promise((resolve,reject)=>{
   const tx=database.transaction('history',project?'readwrite':'readonly'),store=tx.objectStore('history');
   const request=store.get('recent');let records=[];
   request.onsuccess=()=>{
     records=Array.isArray(request.result)?request.result:[];
     if(!project||!Ops.canWrite())return;
     const now=Date.now(),latest=records.find(record=>record.project?.id===project.id);
     if(latest&&(latest.project.updatedAt===project.updatedAt||now-latest.at<recoveryInterval))return;
     if(JSON.stringify(project).length*2>recoverySizeLimit)return;
     records=[{at:now,project},...records].slice(0,recoveryLimit);
     store.put(records,'recent');
   };
   tx.oncomplete=()=>resolve(records);
   tx.onerror=()=>reject(tx.error);
   tx.onabort=()=>reject(tx.error||Error('Local recovery write aborted'));
 });
}
async function captureRecovery(project){
 try{await recoveryRecords(project);if($('protectionDrawer')?.open)await renderProtection();}
 catch{/* Recovery storage is best effort. The primary project save already committed. */}
}
async function renderProtection(){
 const status=$('protectionStatus'),list=$('localRecoveryList');
 let confirmed=null;
 try{confirmed=JSON.parse(protectionPreference(protectionKey));}catch{}
 const matches=confirmed?.id===active?.id&&!!confirmed;
 const changed=!matches||confirmed.revision!==active?.updatedAt;
 status.textContent=matches?`Last external ZIP you confirmed: ${new Date(confirmed.at).toLocaleString()}. ${changed?'Project changed since that ZIP.':'Project revision matches that ZIP.'}`:'No external ZIP confirmation for this project.';
 const days=Number($('backupReminderDays').value),now=Date.now();
 $('backupReminder').hidden=!active||!days||!changed||
   now<Number(protectionPreference('studio-backup-snooze'))||
   (matches&&now-confirmed.at<days*86400000);
 try{
   const records=(await recoveryRecords()).filter(r=>r.project?.id===active?.id);
   list.replaceChildren();
   $('localRecoveryStatus').textContent=records.length?'Latest local snapshot: '+new Date(records[0].at).toLocaleString():'No local snapshot for this project yet.';
   for(const record of records){
     list.append(projectButton('Restore local snapshot from '+new Date(record.at).toLocaleString(),async()=>{
       if(record.project.id!==active?.id||!reliability.auditProject(record.project).ok)return toast('This local snapshot failed validation or belongs to another project.');
       if(!confirm('Restore this local snapshot as a separate project? The current project will be kept.'))return;
       const copy=structuredClone(record.project);
       copy.id=uid();copy.name=copy.name.slice(0,100)+' (recovered)';copy.pinned=false;
       copy.createdAt=copy.updatedAt=new Date().toISOString();
       await organizeProjects([copy],[],null,()=>{projects.set(copy.id,copy);selectProject(copy.id);},{copies:true});
     }));
   }
 }catch{$('localRecoveryStatus').textContent='Local recovery storage is unavailable.';}
}
async function refreshPersistence(request=false){
 const storage=navigator.storage,status=$('persistenceStatus'),button=$('requestPersistence');
 button.disabled=true;
 if(typeof storage?.persisted!=='function'||typeof storage?.persist!=='function'){
   status.textContent='Persistent storage is unavailable in this browser. Keep independent ZIP backups.';return;
 }
 try{
   const granted=await storage.persisted()||(request&&await storage.persist());
   if(request||granted)setProtectionPreference('studio-persistence-result',granted?'granted':'denied');
   const denied=protectionPreference('studio-persistence-result')==='denied';
   status.textContent=granted?'Persistent storage granted. Clearing website data still removes local projects and snapshots.':
     denied?'Persistent storage was declined. Keep independent ZIP backups.':'Persistent storage is not granted. You can request it here.';
   button.disabled=granted;
 }catch{status.textContent='Could not check persistent storage. Keep independent ZIP backups.';button.disabled=false;}
}
function setupProjectProtection(){
 $('protectionRestore').onclick=()=>$('backupFile').click();
 $('protectionDrawer').addEventListener('toggle',()=>{if($('protectionDrawer').open){void renderProtection();void refreshPersistence();}});
 $('requestPersistence').onclick=()=>void refreshPersistence(true);
 const days=$('backupReminderDays');
 days.value=protectionPreference('studio-backup-reminder-days')??'7';
 days.onchange=()=>{setProtectionPreference('studio-backup-reminder-days',days.value);void renderProtection();};
 $('snoozeBackupReminder').onclick=()=>{setProtectionPreference('studio-backup-snooze',String(Date.now()+86400000));$('backupReminder').hidden=true;};
 $('prepareProtectionBackup').onclick=()=>{
   preparedProtectionBackup=null;
   $('savePreparedBackup').disabled=$('confirmProtectionBackup').disabled=true;
   $('protectionExportStatus').textContent='';
   void exportBackup(false,'prepare');
 };
 $('savePreparedBackup').onclick=async()=>{
   const backup=preparedProtectionBackup;if(!backup)return;
   const {blob,filename}=backup;
   try{
     const file=new File([blob],filename,{type:blob.type});
     if(window.StudioMobile?.nativeFiles){
       if(!await window.StudioMobile.save(blob,filename))return;
     }else if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file]});
     else await download(blob,filename);
     if(preparedProtectionBackup!==backup)return;
     $('protectionExportStatus').textContent='Open your destination and check that the ZIP is there. Studio cannot verify the file on your behalf.';
     $('confirmProtectionBackup').disabled=false;
   }catch(error){if(error.name!=='AbortError')$('protectionExportStatus').textContent='Could not save or share: '+error.message;}
 };
 $('confirmProtectionBackup').onclick=()=>{
   const backup=preparedProtectionBackup;if(!backup)return;
   if(!setProtectionPreference(protectionKey,JSON.stringify({id:backup.id,revision:backup.revision,at:Date.now()}))){
     $('protectionExportStatus').textContent='Studio could not record your confirmation.';return;
   }
   $('confirmProtectionBackup').disabled=true;
   $('protectionExportStatus').textContent='Recorded your confirmation that the ZIP was saved outside Studio.';
   void renderProtection();
 };
}
function setupReliabilityTools(){
 const run=$('runIntegrityCheck');if(!run)return;
 run.addEventListener('click',()=>{showDiagnostics();const r=active?reliability.auditProject(active):null;
   $('integrityStatus').textContent=!r?'No project selected':r.ok?'✓ Project data structure is valid. This does not replace project backups.':`⚠ ${r.errors.length} validation issue(s): ${r.errors.join('; ')}`;
 });
 $('copyDiagnostic').addEventListener('click',async()=>{
   const body=JSON.stringify(diagnosticsPayload(),null,2);
   try{await navigator.clipboard.writeText(body);toast('Privacy-safe diagnostics copied.');}
   catch{const b=new Blob([body],{type:'application/json'});download(b,'Dorette-Diagnostics.json');toast('Diagnostics downloaded instead of copied.');}
 });
 $('exportInvalid').addEventListener('click',()=>{
   if(!invalidProjects.size)return toast('No invalid stored projects were found.');
   const payload={format:'dorette-raw-recovery',version:1,reason:'Preserve these original bytes for inspection, NOT for normal Restore',records:[...invalidProjects.values()].map(v=>v.raw)};
   download(new Blob([JSON.stringify(payload)],{type:'application/json'}),'Dorette-Quarantined-Projects-RAW.json');
   toast('Original invalid records exported. Keep the file private; do not use it with Restore.');
 });
 $('retrySave').addEventListener('click',()=>{if(memoryOnly)return toast('Local storage is blocked. Use private project backups.');flushSave();const ids=new Set([...failedWrites.keys(),activeId]);for(const id of ids){const p=projects.get(id);if(p)queueWrite(p);}});
 $('historyUndo').addEventListener('click',undo);$('historyRedo').addEventListener('click',redo);
 renderDesignHistory();showDiagnostics();
}
window.StudioBeforeUpdate = async () => {
 await flushSave();
 await writeChain;
 return !needsSave() && !memoryOnly;
};
function setupServiceWorkerUpdates(){
 if(window.Capacitor?.isNativePlatform()||!('serviceWorker' in navigator)||!location.protocol.startsWith('http'))return;
 let installingUpdate=false,registration=null;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
   if(installingUpdate&&!needsSave())location.reload();
   else if(installingUpdate)toast('Update installed. Finish saving, then reload to open it.');
   installingUpdate=false;
 });
 function readyUpdate(reg){if(!reg?.waiting||!navigator.serviceWorker.controller)return;
   $('updateAvailable').hidden=false;
   $('updateAvailableText').textContent='A newer Studio version is ready. Save your changes before applying the update.';
 }
 navigator.serviceWorker.register('./service-worker.js').then(reg=>{
   registration=reg;readyUpdate(reg);
   reg.addEventListener('updatefound',()=>{const w=reg.installing;if(!w)return;
     w.addEventListener('statechange',()=>{if(w.state==='installed')readyUpdate(reg);});
   });
 }).catch(e=>{console.warn('Service worker registration unavailable:',e.message);});
 $('checkUpdates').addEventListener('click',async()=>{
   if(!navigator.onLine)return toast('Connect to the internet to check for an update.');
   if(!registration)return toast('Update service is not ready yet.');
   try{await registration.update();readyUpdate(registration);if(!registration.waiting)toast('Update check complete. No ready update detected.');}
   catch(e){toast('Update check failed: '+e.message);}
 });
 $('installReadyUpdate').addEventListener('click',async()=>{
   if(!registration?.waiting)return toast('There is no update ready to install.');
   flushSave();try{await writeChain;if(needsSave()){toast('Saving is still in progress. Try again.');return;}}
   catch{toast('Save failed. Export a private project backup before updating.');return;}
   if(memoryOnly||failedWrites.size)return toast('Save your projects before applying the update.');
   installingUpdate=true;registration.waiting?.postMessage({type:'SKIP_WAITING'});
 });
}

function hookEvents(){
  hookNextEvents();
  $('newProjectForm').addEventListener('submit',ev=>{
    ev.preventDefault();const presets={square:[50,50],blanket:[120,165],border:[120,24],initials:[40,30]},dims=presets[$('projectTemplate').value]||[Number($('newCols').value),Number($('newRows').value)],cols=dims[0],rows=dims[1];
    if(!validDimensions(cols,rows)){toast('Choose 1–200 columns and 1–300 rows.');return;}
    const p=blankProject($('newName').value,cols,rows);p.category=$('newProjectCategory').value||'Other';projects.set(p.id,p);queueWrite(p);selectProject(p.id);
    $('newProjectDetails').open=false;toast('New crochet project created.');
  });
  $('projectName').addEventListener('change',()=>{
    if(!active)return;const name=$('projectName').value.trim();if(!name){$('projectName').value=active.name;return;}
    if(name===active.name)return;snapshot({label:'Rename project'});active.name=name.slice(0,70);scheduleSave();refreshInspector();refreshProjectList();
  });
  $('applyDimensions').addEventListener('click',editDimensions);
  $('confirmDimensions').onclick=()=>void confirmDimensions().catch(error=>toast(error.message));
  $('dimensionPreviewDialog').addEventListener('close',()=>{dimensionRequest=null;});
  $('zoomIn').addEventListener('click',()=>setZoom(view.scale*1.27));$('zoomOut').addEventListener('click',()=>setZoom(view.scale/1.27));
  $('fitChart').addEventListener('click',fitChart);$('resetView').addEventListener('click',centerView);$('mirrorChart').addEventListener('click',mirrorChart);
  for(const [id,mode] of [['markStitch','mark'],['markRow','row']]){
    $(id).addEventListener('click',()=>{
      if(!active||pendingConversion)return;
      clearTextPreview();
      progressBrush=progressBrush===mode?null:mode;
      overviewStroke=null;
      if(progressBrush&&!uiSettings().showProgress){
        active.ui={...uiSettings(),showProgress:true};
        updateTabletControls();scheduleSave();requestDraw();
      }
      updateSelection();
      toast(progressBrush?'Tap or drag to mark or unmark '+(mode==='row'?'rows.':'stitches.'):'Marking mode off.');
    });
  }
  $('paintStitch').addEventListener('click',paintStitch);$('addYarnColor').addEventListener('click',addYarnColor);
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
    const resized=result.cols!==active.cols||result.rows!==active.rows;
    if(!confirm(safeEditsEnabled?'Apply the photo conversion to a new project copy? The current project will be kept.':
      `Replace the chart artwork and yarn palette in the current project with the ${result.cols} × ${result.rows} photo conversion? Editable layers and yarn inventory will be cleared.${resized?' Crochet progress and guide position will reset. Notes outside the new dimensions will move to the nearest stitch.':' Existing stitch progress will be kept.'} Undo is available.`))return;
    if(safeEditsEnabled){
      const fresh=blankProject(`${active.name} — converted ${result.cols}x${result.rows}`,result.cols,result.rows);
      fresh.referenceImage=active.referenceImage;fresh.referenceMirrored=!!active.referenceMirrored;fresh.photoCrop={...currentCrop()};
      fresh.imagePlacement=active.imagePlacement;fresh.conversionSettings={...conversionSettings()};
      fresh.palette=result.palette.map(c=>({...c}));fresh.cells=result.cells.slice();fresh.converted=true;fresh.opacity=0;
      projects.set(fresh.id,fresh);queueWrite(fresh);selectProject(fresh.id);
      toast(`Created ${result.cols} × ${result.rows} conversion as a NEW project. The original is untouched.`);
    }else{
      snapshot({label:'Apply photo conversion'});
      if(resized){
        active.cols=result.cols;active.rows=result.rows;
        active.done=Array(result.cols*result.rows).fill(0);active.rowDone=Array(result.rows).fill(0);
        active.guide={row:1,position:0};active.diagonalIndex=0;selected=null;areaSelection=null;
        active.annotations=(active.annotations||[]).map(note=>({...note,
          ...(note.col===undefined?{}:{col:clamp(note.col,1,result.cols)}),
          ...(note.row===undefined?{}:{row:clamp(note.row,1,result.rows)})}));
      }
      active.palette=result.palette.map(c=>({...c}));active.cells=result.cells.slice();active.layers=[];selectedLayerId=null;active.yarnInfo=[];active.converted=true;active.opacity=0;
      clearTextPreview();$('textColor').value='';discardPreview(false);scheduleSave();refreshInspector();if(resized)fitChart();
      toast('Conversion applied to the current project. Review fine text and colors.');
    }
  });
  $('cancelConversion').addEventListener('click',()=>{discardPreview();refreshSaveState();toast('Preview discarded; original project unchanged.');});
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
  for(const id of ['pdfPaper','pdfOrientation','pdfDetail','pdfOverlap','pdfMonochrome','pdfCompleted','pdfExtraPages'])$(id).addEventListener('change',updatePdfEstimate);
  $('exportPdf').addEventListener('click',exportPdf);
  $('exportWrittenPdf').addEventListener('click',exportWrittenPdf);
  $('showProgressOverlay').addEventListener('change',ev=>{if(!active)return;snapshot();active.ui={...uiSettings(),showProgress:ev.target.checked};scheduleSave();updateTabletControls();requestDraw();});
  $('patternLock').addEventListener('change',ev=>{if(!active)return;snapshot({label:'Pattern lock'});active.ui={...uiSettings(),patternLock:ev.target.checked};if(ev.target.checked&&['paint','erase','pick','rect','bucket','area','paste'].includes(editorTool))editorTool='select';scheduleSave();updateTabletControls();updateToolUI();renderLayers();toast(ev.target.checked?'Pattern lock enabled. Editing tools are now protected.':'Pattern lock disabled. Stitch editing is available again.');});
  $('stylusOnly').addEventListener('change',ev=>{if(!active)return;snapshot();active.ui={...uiSettings(),stylusOnly:ev.target.checked};scheduleSave();updateTabletControls();toast(ev.target.checked?'Stylus mode on: finger touches only pan/select.':'Stylus mode off: touch editing restored.');});
  $('largeTouch').addEventListener('change',ev=>{if(!active)return;snapshot();active.ui={...uiSettings(),largeTouch:ev.target.checked};scheduleSave();updateTabletControls();});
  $('textColor').addEventListener('change',()=>{updateTextColorStatus();buildTextPreview();});
  $('addTextBlack').addEventListener('click',()=>{
    if(!active||editBlocked('add black yarn')||pendingConversion||active.palette.length>=SYMBOLS.length||
      active.palette.some(c=>c.hex.toLowerCase()==='#000000'))return;
    snapshot();const index=active.palette.length;
    active.palette.push({hex:'#000000',name:'Black',symbol:SYMBOLS[index]});
    updateLegend();updateTextControls();$('textColor').value=String(index);updateTextColorStatus();buildTextPreview();scheduleSave();
  });
  for(const id of ['textInput','textAngle','textScale','textCol','textRow','textColor','flipText']){
    $(id).addEventListener('input',()=>{if(textPreview)buildTextPreview();});
  }
  for(const [id,step] of [['rotateTextLeft',-90],['rotateTextRight',90]]){
    $(id).addEventListener('click',()=>{
      $('textAngle').value=(previewTextConfig().angle+step+360)%360;
      buildTextPreview();
    });
  }
  $('textAngle').addEventListener('change',()=>{$('textAngle').value=previewTextConfig().angle;});
  $('previewText').addEventListener('click',()=>{if(!active)return;const preview=buildTextPreview();if(preview?.cells?.length)toast(`Previewing text across ${preview.width} × ${preview.height} cells.`);else if(!$('textFitStatus').textContent)toast('Type some text first.');});
  $('clearTextPreview').addEventListener('click',()=>{clearTextPreview();toast('Text preview cleared.');});
  $('applyText').addEventListener('click',applyTextPreview);
  $('editLastText').addEventListener('click',editLastText);
  $('newLettering').addEventListener('click',()=>{
    clearTextPreview();$('textInput').value='';$('textColor').value='';updateTextControls();$('textInput').focus();
  });
  $('placeText').addEventListener('click',()=>{
    if(!active||pendingConversion||editBlocked('place text'))return;
    progressBrush=false;updateSelection();
    placingText=true;
    $('placeText').setAttribute('aria-pressed',String(placingText));
    if(placingText)$('textFitStatus').textContent='Tap a square to set the top-left corner.';
    else if(textPreview)buildTextPreview();
    else $('textFitStatus').textContent='';
  });
  $('textLeft').addEventListener('click',()=>nudgeText(-1,0));
  $('textRight').addEventListener('click',()=>nudgeText(1,0));
  $('textUp').addEventListener('click',()=>nudgeText(0,1));
  $('textDown').addEventListener('click',()=>nudgeText(0,-1));
  hookPatternEvents();hookAdvanced();
  $('shareProject').addEventListener('click',()=>{
    if(window.StudioMobile?.nativeFiles){void exportBackup(false,true);return;}
    const drawer=$('protectionDrawer');drawer.open=true;drawer.scrollIntoView({block:'nearest'});
    void exportBackup(false,'prepare');
  });
  for(const id of ['exportProject'])$(id).addEventListener('click',()=>exportBackup(false));
  for(const id of ['exportAll','headerExport'])$(id).addEventListener('click',()=>exportBackup(true));
  for(const id of ['headerRestore','restoreProject'])$(id).addEventListener('click',()=>$('backupFile').click());
  $('backupFile').addEventListener('change',ev=>{restoreBackup(ev.target.files[0]);ev.target.value='';});
  $('deleteProject').addEventListener('click',removeActiveProject);
  new ResizeObserver(resizeCanvas).observe($('canvasWrap'));
  new ResizeObserver(requestDraw).observe(overviewCanvas);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&saveTimer)void flushSave().catch(()=>{});
  });
  window.addEventListener('pagehide',()=>{pageClosing=Promise.resolve(flushSave()).then(()=>Ops.release(),()=>Ops.release());});
  window.addEventListener('pageshow',ev=>{if(ev.persisted)void retryEditing();});
  window.addEventListener('beforeunload',ev=>{if(needsSave()){flushSave();ev.preventDefault();ev.returnValue='';}});
}
async function retryEditing(){
 if(reloadingProjects)return;
 if(needsSave())return toast('This tab has unsaved changes. Export a backup before reopening it.');
 reloadingProjects=true;
 try{
   await pageClosing;
   if(!await Ops.acquire())return toast('The other Studio tab is still editing. Close it first, then retry.');
   const preferred=activeId;
   const items=await loadProjects();
   projects.clear();invalidProjects.clear();
   loadProjectRecords(items);
   reloadingProjects=false;setTabReadOnly(true);
   if(!projects.size){
     const p=blankProject('My First Chart',79,117);projects.set(p.id,p);await queueWrite(p);
   }
   selectProject(projects.has(preferred)?preferred:projects.keys().next().value);
 }catch(e){Ops.release();toast('Could not reopen editing: '+e.message);}
 finally{reloadingProjects=false;setTabReadOnly(Ops.canWrite());}
}
async function initialize(){
  document.body.classList.toggle('native-android',window.Capacitor?.getPlatform()==='android');
  await Ops.init(setTabReadOnly);
  hookEvents();v16Hook();
  $('singleChart').addEventListener('click',()=>setChartLayout('single'));
  $('dualChart').addEventListener('click',()=>setChartLayout('dual'));
  let chartLayout='dual';try{chartLayout=localStorage.getItem('dorette-chart-layout')||'dual';}catch{}
  setChartLayout(chartLayout,false);
  try{
    db=await openDatabase();const items=await loadProjects();
    loadProjectRecords(items);
  }catch(e){memoryOnly=true;setSavePhase('blocked',e.message);toast('Local saving is unavailable. Keep private backups in a normal browser window.');}
  if(projects.size===0){const sample=blankProject('My First Chart',79,117);projects.set(sample.id,sample);if(!memoryOnly&&!studioReadOnly)await queueWrite(sample).catch(()=>{});}
  let preferred=null;try{preferred=localStorage.getItem('dorette-active-project');}catch{}
  resizeCanvas();selectProject(projects.has(preferred)?preferred:projects.keys().next().value);
  if(!memoryOnly&&!needsSave())setSavePhase('saved');
  if(invalidProjects.size)saveAlert(`${invalidProjects.size} stored project(s) failed validation. Originals remain untouched. Open Studio Diagnostics to export the raw record.`);
  setupReliabilityTools();
  setupProjectProtection();
  setupServiceWorkerUpdates();
  setupSettingsLayout();
  setupPolishTools();
  setupAppNavigation();
  setupPhoneCrochetControls();
  setupStandaloneSettings();
  $('toggleBulkProjects').onclick=()=>{bulkMode=!bulkMode;bulkProjects.clear();refreshProjectList();};
  $('selectVisibleProjects').onclick=()=>{for(const project of visibleBulkProjects())bulkProjects.add(project.id);refreshProjectList();};
  $('clearBulkProjects').onclick=()=>{bulkProjects.clear();refreshProjectList();};
  $('applyBulkProjects').onclick=()=>void applyBulkProjectAction();
  if(studioReadOnly)setTabReadOnly(false);
}
initialize().catch(e=>{status('Unable to open workspace',true);toast(e.message);});
})();
