const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

test('crochet toolbar defaults to expanded and saves only its own preference', () => {
  const values=new Map(),attributes=new Map(),classes=new Map();
  const button={setAttribute:(name,value)=>attributes.set(name,value)};
  const source=readFileSync('app.js','utf8');
  const code=source.slice(source.indexOf('function setupPhoneCrochetControls()'),source.indexOf('function setCrochetView('));
  const context=vm.createContext({
    $:id=>id==='phoneCrochetControls'?button:{textContent:'Row 11 · Blue · 1 left'},
    localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},
    document:{body:{classList:{toggle:(name,value)=>classes.set(name,value)}}}
  });
  vm.runInContext(code+'\nsetupPhoneCrochetControls();',context);
  assert.equal(attributes.get('aria-expanded'),'true');
  button.onclick();
  assert.equal(attributes.get('aria-expanded'),'false');
  assert.equal(classes.get('phone-crochet-expanded'),false);
  assert.equal(values.size,1);
  assert.match(attributes.get('aria-label'),/Expand.*Row 11/);
  vm.runInContext('setupPhoneCrochetControls();',context);
  assert.equal(attributes.get('aria-expanded'),'false');
  button.onclick();
  assert.equal(attributes.get('aria-expanded'),'true');
});
