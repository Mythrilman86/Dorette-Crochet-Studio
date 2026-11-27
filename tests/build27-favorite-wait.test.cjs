const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../scripts/test-build27-browser.cjs'),'utf8');
const helper=source.slice(source.indexOf('async function waitForSavedFavorite('),source.indexOf('const server=http.createServer('));
async function check(overrides={}) {
 const id='fictional-favorite',state={activeId:id,organizationBusy:false,studioReadOnly:false,memoryOnly:false,canWrite:true,failedWrites:0,favorite:true,...overrides.state};
 const saved={id,favorite:true,...overrides.saved};let dbReads=0,options;
 const context={window:{editorProbe:expression=>{
  if(expression.startsWith('({activeId'))return state;
  assert.equal(expression,'dbRequest("readonly",store=>store.get("fictional-favorite"))');
  dbReads++;if(overrides.readError)throw Error('fictional database error');return Promise.resolve(saved);
 }}};
 vm.createContext(context);vm.runInContext(helper+';globalThis.wait=waitForSavedFavorite;',context);
 const page={waitForFunction:async(fn,arg,opts)=>{options=opts;assert.equal(arg,id);const ready=await fn(arg);if(!ready)throw Error('bounded wait did not reach persisted condition');}};
 await context.wait(page,id,1234);assert.equal(options.timeout,1234);return {dbReads};
}
test('Favorite wait requires correct memory and persisted identity with bounded timeout',async()=>assert.equal((await check()).dbReads,1));
test('Favorite wait rejects missing persistence even when in-memory favorite is true',async()=>{
 await assert.rejects(check({saved:{favorite:false}}),/persisted condition/);
 await assert.rejects(check({saved:{id:'wrong-project'}}),/persisted condition/);
});
test('Favorite wait rejects incomplete operation, wrong active project and save-lock errors',async()=>{
 for(const state of [{favorite:false},{organizationBusy:true},{activeId:'wrong-project'},{studioReadOnly:true},{memoryOnly:true},{canWrite:false},{failedWrites:1}])await assert.rejects(check({state}),/persisted condition/);
});
test('Favorite wait does not conceal database read failure',async()=>await assert.rejects(check({readError:true}),/database error/));
