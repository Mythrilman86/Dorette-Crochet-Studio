const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function editor() {
  const code = readFileSync('app.js', 'utf8').replace(/^initialize\(\)\.catch.*$/m,
    'active = {cols:79,rows:117}; window.rasterize = rasterizeTextPattern;');
  const window = {addEventListener() {}};
  const element = {getContext: () => ({}), addEventListener() {}};
  vm.runInNewContext(code, {window, document:{getElementById: () => element}, structuredClone, TextEncoder, TextDecoder});
  return window.rasterize;
}

test('vertical lettering stacks upright glyphs without changing legacy horizontal sizing', () => {
  const rasterize = editor();
  const config = {text:'HELLO', height:5, col:1, row:117, angle:0, letterSpacing:1};
  const horizontal = rasterize(config);
  assert.equal(horizontal.width, 20);
  assert.equal(horizontal.height, 5);
  const vertical = rasterize({...config, direction:'vertical'});
  assert.equal(vertical.width, 4);
  assert.equal(vertical.height, 29);
  assert.equal(vertical.occupied.filter(point => point.y === 0).map(point => point.x).join(','), '0,2');
  assert.equal(vertical.occupied.filter(point => point.y === 6).map(point => point.x).join(','), '0,1,2');
  const rotated = rasterize({...config, direction:'vertical', angle:90});
  assert.equal(rotated.width, 29);
  assert.equal(rotated.height, 4);
});

test('per-letter width and height are independent and placement detects overflow', () => {
  const rasterize = editor();
  const config = {text:'HO', glyphWidth:7, height:6, col:1, row:117, angle:0, letterSpacing:0};
  const horizontal = rasterize(config);
  const vertical = rasterize({...config, direction:'vertical'});
  assert.equal(horizontal.width, 14);
  assert.equal(horizontal.height, 6);
  assert.equal(vertical.width, 7);
  assert.equal(vertical.height, 12);
  assert.equal(rasterize({...config, direction:'vertical', row:11}).tooLarge, true);
  assert.equal(rasterize({...config, col:68}).tooLarge, true);
});

