const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

test('project restore verifies ZIP bytes, previews, and only writes on confirmation',async()=>{
  const source=readFileSync('app.js','utf8');
  const preview=[],messages=[],writes=[],preferences=[];
  const project={id:'copy',cells:[1,0],done:[1,0]};
  const workspace={layout:'fixture'};
  let accept=false;
  const context=vm.createContext({
    textEncoder:new TextEncoder(),textDecoder:new TextDecoder(),project,workspace,
    projects:new Map(),recycledProjects:new Map(),selectProject(){},
    readProjectBackup:()=>({projects:[project],recycled:[],categories:[]}),
    sanitizeWorkspacePreferences:value=>value,
    restoreWorkspacePreferences:value=>preferences.push(value.layout),
    toast:message=>messages.push(message),
    confirm:message=>{preview.push(message);return accept;},
    organizeProjects:async(items,removed,categories,apply,options)=>{
      assert.equal(options.copies,true);
      writes.push(items[0]);apply();return true;
    }
  });
  vm.runInContext(source.slice(source.indexOf('const CRC_TABLE'),source.indexOf('function backupPayload'))+
    source.slice(source.indexOf('async function restoreBackup('),source.indexOf('async function removeActiveProject')),context);
  const bytes=vm.runInContext("makeZip({'backup.json':JSON.stringify({workspace})})",context);
  const run=bytes=>{
    context.file={size:bytes.length,name:'fixture.zip',arrayBuffer:async()=>bytes.buffer};
    return vm.runInContext('restoreBackup(file)',context);
  };
  const corrupt=bytes.slice();
  corrupt[41]^=1;
  await run(corrupt);
  assert.match(messages.pop(),/CRC-32/);
  assert.equal(preview.length,0);
  const badDirectory=bytes.slice();
  new DataView(badDirectory.buffer).setUint32(badDirectory.length-6,0,true);
  const trailing=new Uint8Array(bytes.length+1);
  trailing.set(bytes);
  for(const malformed of [bytes.slice(0,-1),bytes.slice(0,-22),badDirectory,trailing]){
    await run(malformed);
    assert.match(messages.pop(),/ZIP directory/);
  }
  assert.equal(preview.length,0);
  assert.equal(writes.length,0);
  await run(bytes);
  assert.match(preview[0],/1 active project.*0 Recycle Bin.*Existing projects will be kept/);
  assert.equal(writes.length,0);
  assert.equal(preferences.length,0);
  accept=true;
  await run(bytes);
  assert.deepEqual(writes,[project]);
  assert.deepEqual(preferences,['fixture']);
  assert.equal(context.projects.get('copy'),project);
});
