const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const source=readFileSync('app.js','utf8');
const code=source.slice(source.indexOf('const workspacePreferenceKeys'),source.indexOf('function setupStandaloneSettings()'));
const api=vm.runInNewContext(code+'\n({normalizeSettingsCategories,readStandaloneSettings,decodeSettingsFile,settingsDigest,writeStandaloneSettings})',{crypto,TextEncoder});

test('standalone settings are allowlisted and validate the checksum offline',async()=>{
  const categories={chart:'single',phoneControls:true,sections:{order:['text-to-chart','layerPanel'],collapsed:['layerPanel'],favorites:[]},unexpected:{project:'private'}};
  const sha256=await api.settingsDigest(categories);
  const payload={application:'com.deescrochetstudio.app.settings',format:1,studioVersion:'2.3.3',exportedAt:'2026-11-05T00:00:00Z',categories,sha256};
  const {values,skipped}=await api.decodeSettingsFile(payload);
  assert.equal(values.chart,'single');
  assert.equal(values.sections.order.join(','),'text-to-chart,layerPanel');
  assert.equal(values.unexpected,undefined);
  assert.equal(skipped[0],'Unrecognized category');
  await assert.rejects(api.decodeSettingsFile({...payload,categories:{chart:'dual'}}),/integrity/);
  await assert.rejects(api.decodeSettingsFile({...payload,application:'unrelated'}),/supported/);
});

test('selected categories import without touching project keys or unselected preferences',()=>{
  const map=new Map([['dorette-active-project','private'],['dorette-chart-layout','dual']]);
  const storage={getItem:key=>map.get(key)??null,setItem:(key,v)=>map.set(key,v)};
  api.writeStandaloneSettings(storage,{chart:'single',phoneControls:true},['phoneControls']);
  assert.equal(map.get('studio.phone.crochet-controls.expanded'),'true');
  assert.equal(map.get('dorette-chart-layout'),'dual');
  assert.equal(map.get('dorette-active-project'),'private');
});

test('write failure rolls back previously applied preference keys',()=>{
  const map=new Map([['dorette-chart-layout','dual']]);
  const storage={getItem:key=>map.get(key)??null,removeItem:key=>map.delete(key),
    setItem(key,v){if(key==='dorette-safe-edits-opt-in')throw Error('quota');map.set(key,v);}};
  assert.throws(()=>api.writeStandaloneSettings(storage,{chart:'single',phoneControls:true,safeEdits:false},['chart','phoneControls','safeEdits']),/quota/);
  assert.deepEqual([...map],[['dorette-chart-layout','dual']]);
});

test('missing, null, malformed and mismatched checksums leave preferences untouched',async()=>{
  const categories={chart:'single'};
  const file={application:'com.deescrochetstudio.app.settings',format:1,studioVersion:'2.3.4',exportedAt:'2026-11-05T00:00:00Z',categories};
  const values=new Map([['dorette-chart-layout','dual']]);
  const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  async function apply(raw){
    const {values}=await api.decodeSettingsFile(raw);
    api.writeStandaloneSettings(storage,values,['chart']);
  }
  await assert.rejects(apply(file),/missing.*checksum/i);
  await assert.rejects(apply({...file,sha256:null}),/missing.*checksum/i);
  for(const sha256 of ['',42,'g'.repeat(64),'a'.repeat(63)]){
    await assert.rejects(apply({...file,sha256}),/invalid.*checksum/i);
  }
  await assert.rejects(apply({...file,sha256:'0'.repeat(64)}),/integrity/i);
  assert.deepEqual([...values],[['dorette-chart-layout','dual']]);
  await apply({...file,sha256:await api.settingsDigest(categories)});
  assert.equal(values.get('dorette-chart-layout'),'single');
});

test('checksum generation fails closed when SHA-256 is unavailable',async()=>{
  const digest=vm.runInNewContext(code+'\nsettingsDigest',{TextEncoder});
  await assert.rejects(digest({chart:'dual'}),/SHA-256 is unavailable/);
});
