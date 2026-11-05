const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function engine(file) {
  const source = readFileSync(file, 'utf8').replace(/^initialize\(\)\.catch.*$/m,
    'window.backupApi = { makeZip, readZip, backupPayload, validateBackup, readProjectBackup, DB_NAME, DB_VERSION };');
  const window = { addEventListener() {} };
  const element = { getContext: () => ({}), addEventListener() {} };
  vm.runInNewContext(source, {
    window, document: { getElementById: () => element },
    TextEncoder, TextDecoder, structuredClone, crypto
  });
  return window.backupApi;
}

test('legacy ZIP projects round-trip between website and mobile', () => {
  const web = engine(process.env.STUDIO_BASELINE_APP || 'dist/app.js');
  const mobile = engine('mobile/www/app.js');
  const project = {
    id: 'legacy', name: 'Legacy chart', cols: 2, rows: 1,
    cells: [0, 1], done: [1, 0], rowDone: [0], notes: 'Keep this note',
    palette: [{ hex: '#ffffff', name: 'White', symbol: 'A' }, { hex: '#ff0000', name: 'Red', symbol: 'B' }]
  };
  const data = web.makeZip({ 'backup.json': JSON.stringify(web.backupPayload([project])) });
  const unpack = (app, zip) => JSON.parse(new TextDecoder().decode(app.readZip(zip)['backup.json']));
  const payload = unpack(mobile, data);
  assert.equal(payload.app, 'dorette-crochet-studio');
  assert.equal(payload.version, 1);
  const restored = mobile.validateBackup(payload.projects[0]);
  assert.equal(restored.name, 'Legacy chart (restored)');
  assert.notEqual(restored.id, project.id);
  assert.equal(JSON.stringify(restored.cells), JSON.stringify(project.cells));
  assert.equal(JSON.stringify(restored.done), JSON.stringify(project.done));
  assert.equal(restored.notes, project.notes);
  const returned = mobile.makeZip({ 'backup.json': JSON.stringify(mobile.backupPayload([restored])) });
  assert.equal(unpack(web, returned).projects[0].name, restored.name);
  assert.equal(mobile.DB_NAME, web.DB_NAME);
  assert.equal(mobile.DB_VERSION, web.DB_VERSION);
  data[41] ^= 1;
  assert.throws(() => mobile.readZip(data), /integrity check failed/);
});

test('organization backups preserve pins, favorites, custom categories and recycle data', () => {
  const {backupPayload, readProjectBackup} = engine('dist/app.js');
  const chart = {
    id:'existing', name:'Sample', cols:1, rows:1, cells:[0], done:[1], rowDone:[1],
    palette:[{hex:'#ffffff',name:'White',symbol:'A'}], notes:'Keep this note',
    category:'  Winter   gifts ', favorite:true, pinned:true
  };
  const payload = backupPayload([chart], {
    categories:['Winter gifts','WINTER GIFTS','blankets','Unused'],
    recycleBin:[{...chart,pinned:false,favorite:false,trashedAt:'2026-11-04T00:00:00Z'}]
  });
  const restored = readProjectBackup(payload);
  assert.deepEqual(Array.from(restored.categories), ['Winter gifts','Unused']);
  assert.equal(restored.projects[0].category, 'Winter gifts');
  assert.equal(restored.projects[0].pinned, true);
  assert.equal(restored.projects[0].favorite, true);
  assert.equal(restored.recycled[0].pinned, false);
  assert.equal(restored.recycled[0].favorite, false);
  assert.equal(restored.recycled[0].done[0], 1);
  assert.equal(restored.recycled[0].notes, chart.notes);
  assert.notEqual(restored.recycled[0].id, restored.projects[0].id);
  assert.notEqual(restored.projects[0].id, chart.id);
  assert.throws(() => readProjectBackup(backupPayload([chart], {recycleBin:[chart]})), /pinned project/);
});
