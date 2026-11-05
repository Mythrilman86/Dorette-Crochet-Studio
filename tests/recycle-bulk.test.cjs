const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function engine(confirmed){
  const window={addEventListener() {}};
  const element={getContext:()=>({}),addEventListener() {}};
  const code=readFileSync('app.js','utf8').replace(/^initialize\(\)\.catch.*$/m,
    'window.api={projects,recycledProjects,restoreRecycledProjects,purgeRecycled, useTransaction: fn=>{organizeProjects=fn;}, notices:[]};toast=message=>window.api.notices.push(message);');
  vm.runInNewContext(code,{window,document:{getElementById:()=>element},TextEncoder,TextDecoder,structuredClone,crypto,confirm:confirmed});
  return window.api;
}

test('bulk restore commits once and preserves both project records',async()=>{
  const app=engine(()=>false);
  const originals=['a','b'].map(id=>({id,name:'Same name',trashedAt:'earlier',layers:[{entries:[[1,2]]}],notes:'Keep',done:[1,0]}));
  for(const p of originals)app.recycledProjects.set(p.id,p);
  let transactions=0;
  app.useTransaction(async(records,removed,categories,apply)=>{
    transactions++;assert.equal(records.length,2);assert.equal(removed.length,0);apply();return true;
  });
  await app.restoreRecycledProjects(originals);
  assert.equal(transactions,1);
  assert.equal(app.recycledProjects.size,0);
  for(const {trashedAt,...record} of originals)assert.deepEqual(JSON.parse(JSON.stringify(app.projects.get(record.id))),record);
});

test('bulk purge requires consent and a failed transaction keeps the bin intact',async()=>{
  let accept=false;
  const app=engine(message=>{assert.match(message,/2 projects.*cannot be undone/i);return accept;});
  const records=['a','b'].map(id=>({id,name:id}));
  for(const p of records)app.recycledProjects.set(p.id,p);
  let transactions=0;
  app.useTransaction(async()=>{transactions++;return false;});
  await app.purgeRecycled(records);
  assert.equal(transactions,0);
  accept=true;
  await app.purgeRecycled(records);
  assert.equal(transactions,1);
  assert.equal(app.recycledProjects.size,2);
});
