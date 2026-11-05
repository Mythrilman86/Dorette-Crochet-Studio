const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

test('flushing a debounced save writes the project that requested it',async()=>{
  const source=readFileSync('app.js','utf8');
  const start=source.indexOf('let pendingSaveProjectId=');
  const end=source.indexOf('const pinnedDeleteMessage',start);
  const first={id:'first'}, second={id:'second'}, writes=[];
  const context=vm.createContext({active:first,projects:new Map([[first.id,first],[second.id,second]]),
    studioReadOnly:false,Ops:{canWrite:()=>true},memoryOnly:false,failedWrites:new Map(),
    saveTimer:null,writeChain:Promise.resolve(),invalidateChartCache(){},queuePatternRender(){},
    setSavePhase(){},refreshSaveState(){},clearTimeout(){},setTimeout:()=>1,
    queueWrite:project=>{writes.push(project.id);return Promise.resolve();}});
  vm.runInContext(source.slice(start,end)+'\nscheduleSave();',context);
  context.active=second;
  await vm.runInContext('flushSave()',context);
  assert.deepEqual(writes,['first']);
  await vm.runInContext('flushSave()',context);
  assert.deepEqual(writes,['first']);
});

test('failed queued save retains the confirmed record and retry writes the latest snapshot',async()=>{
  const source=readFileSync('app.js','utf8');
  const start=source.indexOf('function queueWrite('),end=source.indexOf('let pendingSaveProjectId=',start);
  const project={id:'chart',cells:[1],done:[0]};
  const failures=new Map();
  let disk={id:'chart',cells:[0],done:[0]},abort=true;
  const context=vm.createContext({project,structuredClone,writeChain:Promise.resolve(),writePending:0,
    memoryOnly:false,studioReadOnly:false,Ops:{canWrite:()=>true},reliability:{auditProject:()=>({ok:true})},
    failedWrites:failures,lastSaveTime:null,refreshSaveState(){},
    dbRequest:async(type,callback)=>{assert.equal(type,'readwrite');callback({put(copy){
      if(abort)throw Error('simulated quota failure');disk=copy;
    }});}});
  await assert.rejects(vm.runInContext(source.slice(start,end)+'\nqueueWrite(project)',context),/quota/);
  assert.equal(disk.cells[0],0);
  assert.match(failures.get('chart'),/quota/);
  project.cells[0]=2;project.done[0]=1;abort=false;
  await vm.runInContext('queueWrite(project)',context);
  assert.deepEqual(disk.cells,[2]);assert.deepEqual(disk.done,[1]);
  assert.equal(failures.size,0);
});
