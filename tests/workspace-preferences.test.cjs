const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const window = {addEventListener() {}};
const el = {getContext:()=>({}),addEventListener(){}};
const app = readFileSync('app.js','utf8').replace(/^initialize\(\)\.catch.*$/m,
  'window.prefs = sanitizeWorkspacePreferences;');
vm.runInNewContext(app,{window,document:{getElementById:()=>el},structuredClone,TextEncoder,TextDecoder});

test('workspace preferences accept only supported portable settings',()=>{
  const prefs=window.prefs({version:1,sections:{order:['text','text',4],collapsed:[],favorites:['layers']},
    tools:{favorites:['Zoom'],recent:['A','B','C','D','E','F','G']},panels:{projects:true,settings:false},
    display:{mode:'beginner',numberScale:99,highContrast:true},chart:'dual',projects:[{id:'ignore'}]});
  assert.equal(prefs.sections.order.join(','),'text');
  assert.equal(prefs.tools.recent.length,6);
  assert.equal(prefs.display.numberScale,1);
  assert.equal(prefs.display.highContrast,true);
  assert.equal(prefs.panels.projects,true);
  assert.equal(prefs.chart,'dual');
  assert.equal(prefs.projects,undefined);
});

test('older backups and invalid preference blocks do not change layout',()=>{
  for(const value of [undefined,null,[],{}, {version:2,chart:'single'},{version:1,panels:{projects:'yes'},chart:'invalid'}]){
    assert.equal(window.prefs(value),null);
  }
});
