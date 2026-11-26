const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
function safety(){
 const txs=[];class Storage{setItem(){if(this.fail)throw Error('QuotaExceeded');}removeItem(){if(this.fail)throw Error('Storage unavailable');}}class DB{transaction(){if(this.fail)throw Error('Transaction unavailable');const handlers={};const tx={addEventListener:(n,f)=>handlers[n]=f,handlers};txs.push(tx);return tx;}}
 const nodes=[{tagName:'MAIN',inert:false},{tagName:'SECTION',id:'studioUpdateProgress',inert:false}];
 const context={window:{},Storage,IDBDatabase:DB,document:{body:{children:nodes}}};vm.runInNewContext(fs.readFileSync(path.join(root,'update-safety.js'),'utf8'),context);
 return {s:context.window.StudioUpdateSafety,Storage,DB,txs,nodes};
}
test('unknown storage subsystem fails closed',async()=>{const h=safety();assert.equal(await h.s.ready(),false);});
test('guards save before granting readiness and reject failures',async()=>{const h=safety();let saved=false;h.s.register('chart',async()=>{saved=true;return true;});assert.equal(await h.s.ready(),true);assert.ok(saved);h.s.register('creator',()=>false);assert.equal(await h.s.ready(),false);h.s.register('creator',()=>{throw Error('save');});assert.equal(await h.s.ready(),false);});
test('in-flight IndexedDB writes block and successful completion releases',async()=>{const h=safety();h.s.register('chart',()=>true);new h.DB().transaction('projects','readwrite');assert.equal(await h.s.ready(),false);h.txs[0].handlers.complete();assert.equal(await h.s.ready(),true);});
test('aborted write remains blocking rather than discarding in-memory work',async()=>{const h=safety();h.s.register('chart',()=>true);new h.DB().transaction('projects','readwrite');h.txs[0].handlers.abort();assert.equal(await h.s.ready(),false);});
test('localStorage failure caught by original UI still blocks updates',async()=>{const h=safety();h.s.register('chart',()=>true);const s=new h.Storage();s.fail=true;try{s.setItem('layout','fictional');}catch{}assert.equal(await h.s.ready(),false);});
test('readonly transactions do not block; freeze preserves preexisting inert state',async()=>{const h=safety();h.s.register('chart',()=>true);new h.DB().transaction('projects','readonly');assert.equal(await h.s.ready(),true);h.s.freeze(true);assert.equal(h.nodes[0].inert,true);assert.equal(h.nodes[1].inert,false);h.s.freeze(false);assert.equal(h.nodes[0].inert,false);});
function worker(clientCount=1,complete=true){
 const events={},keys=['index.html'];let activated=0,posted;
 const source=fs.readFileSync(path.join(root,'service-worker.js'),'utf8').replace(/const FILES = \[[\s\S]*?\];/,'const FILES=["./index.html"];');
 const context={importScripts(){},self:{registration:{scope:'https://studio.invalid/'},addEventListener:(n,f)=>events[n]=f,clients:{matchAll:async()=>Array.from({length:clientCount},(_,i)=>({id:''+i,url:'https://studio.invalid/'})),claim:async()=>{}},skipWaiting:async()=>activated++},caches:{open:async()=>({keys:async()=>complete?[{url:'https://studio.invalid/index.html'}]:[],match:async()=>({json:async()=>({web:{version:'2.7.2',notes:'Fictional release notes'}})})})},URL,console};vm.runInNewContext(source,context);
 return {async message(type,sourceId='0'){let wait;events.message({data:{type},source:{id:sourceId},ports:[{postMessage:r=>posted=r}],waitUntil:p=>wait=p});await wait;return {activated,posted};}};
}
test('worker permits a single consenting source with complete cache',async()=>{assert.equal((await worker().message('STUDIO_ACTIVATE')).activated,1);});
test('worker refuses another window, missing source and incomplete cache',async()=>{for(const h of [worker(2),worker(1,false)])assert.equal((await h.message('STUDIO_ACTIVATE')).activated,0);assert.equal((await worker().message('STUDIO_ACTIVATE','unknown')).activated,0);});
test('old user-click activation bridge retains sole-client/cache checks',async()=>{assert.equal((await worker().message('SKIP_WAITING')).activated,1);assert.equal((await worker(2).message('SKIP_WAITING')).activated,0);});
test('worker reports only count/source recognition, no URLs or project data',async()=>{const {posted}=await worker(2).message('STUDIO_CLIENTS');assert.deepEqual(JSON.parse(JSON.stringify(posted)),{count:2,sourceKnown:true});});
test('waiting worker describes its own cached release without fetching stale active metadata',async()=>{const {posted}=await worker().message('STUDIO_RELEASE');assert.equal(posted.version,'2.7.2');assert.equal(posted.notes,'Fictional release notes');});
function companion(){const row={id:'fictional',label:'Row1',note:'Saved',page:1},elements={note:{value:'Saved'},label:{value:'Row1'},pdf:{files:[]}};const context={current:()=>row,pattern:{instructions:[row]},draft:{...row},pendingImportTitle:false,$:id=>elements[id]};const source=fs.readFileSync(path.join(root,'assets/written-pattern.mjs'),'utf8');vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function writtenUnsaved(){'),source.indexOf("window.StudioUpdateSafety?.register('companion'")),context);return {context,elements,dirty:()=>vm.runInContext('writtenUnsaved()',context)};}
test('Companion saved selected marker does not cause a needless leave warning',()=>assert.equal(companion().dirty(),false));
test('Companion new marker, unsaved note and renamed marker remain protected',()=>{for(const field of ['draft','note','label']){const h=companion();if(field==='draft')h.context.draft={page:1,box:{x:1}};else h.elements[field].value='Unsaved';assert.equal(h.dirty(),true);}});
test('Companion pending import title/file remain protected',()=>{const h=companion();h.context.pendingImportTitle=true;assert.equal(h.dirty(),true);h.context.pendingImportTitle=false;h.elements.pdf.files=[{}];assert.equal(h.dirty(),true);});

test('failed preference removal and transaction creation fail closed',async()=>{for(const kind of ['remove','transaction']){const h=safety();h.s.register('chart',()=>true);if(kind==='remove'){const s=new h.Storage();s.fail=true;assert.throws(()=>s.removeItem('layout'));}else{const db=new h.DB();db.fail=true;assert.throws(()=>db.transaction('projects','readwrite'));}assert.equal(await h.s.ready(),false);}});

// Execute the actual shipped Creator registration with fictional state and controlled saves.
function creatorGuard(overrides={}) {
 const source=fs.readFileSync(path.join(root,'assets/creator/ui.mjs'),'utf8');
 const lines=source.split('\n').filter(line=>line.startsWith("window.StudioUpdateSafety?.register('creator',"));
 assert.equal(lines.length,1);
 let guard,saveCalls=0;
 const state={busy:false,dirty:false,pendingImages:new Map(),chain:Promise.resolve(),
   save:async()=>{saveCalls++;},...overrides,
   window:{StudioUpdateSafety:{register(name,fn){assert.equal(name,'creator');guard=fn;}}}};
 vm.runInNewContext(lines[0],state);
 assert.equal(typeof guard,'function');
 return {state,guard,calls:()=>saveCalls};
}
test('actual Creator update guard refuses busy state without saving',async()=>{
 const h=creatorGuard({busy:true});assert.equal(await h.guard(),false);assert.equal(h.calls(),0);
});
test('actual Creator update guard awaits both saving and its write chain',async()=>{
 let saved,writeDone;const order=[];
 const save=new Promise(r=>saved=r),chain=new Promise(r=>writeDone=r);
 const h=creatorGuard({dirty:true,chain,save:async()=>{order.push('save');await save;h.state.dirty=false;}});
 let settled=false;const ready=h.guard().then(value=>{settled=true;return value;});
 await Promise.resolve();assert.deepEqual(order,['save']);assert.equal(settled,false);
 saved();await new Promise(r=>setImmediate(r));assert.equal(settled,false);
 writeDone();assert.equal(await ready,true);
});
test('actual Creator update guard rejects remaining dirty work, new busy state and pending images',async()=>{
 for(const overrides of [{dirty:true},{pendingImages:new Map([['fictional',{}]])}]){
  assert.equal(await creatorGuard(overrides).guard(),false);
 }
 const h=creatorGuard();h.state.save=async()=>{h.state.busy=true;};assert.equal(await h.guard(),false);
});
test('actual Creator update guard propagates save and write-chain errors',async()=>{
 await assert.rejects(creatorGuard({save:async()=>{throw Error('fictional save failed');}}).guard(),/save failed/);
 const h=creatorGuard({chain:Promise.resolve().then(()=>{throw Error('fictional write failed');})});
 await assert.rejects(h.guard(),/write failed/);
});
