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
