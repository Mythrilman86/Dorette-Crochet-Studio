const test = require('node:test');
const assert = require('node:assert/strict');
const {stitchEntries, searchStitches} = require('../stitch-library.js');
const {inkMask, components, normalizedMask, rankSymbols, matchConfidence, adjustScanPixels, sameScanRegion} = require('../stitch-match.js');

test('search respects terminology when an abbreviation changes meaning', () => {
  assert.equal(searchStitches('dc', 'us').find(entry => entry.id === 'dc').us, 'Double crochet');
  assert.ok(searchStitches('dc', 'uk').some(entry => entry.id === 'sc'));
  assert.ok(!searchStitches('dc', 'uk').some(entry => entry.id === 'dc'));
  assert.ok(searchStitches('  HALF TREBLE  ').some(entry => entry.id === 'hdc'));
  assert.equal(searchStitches('missing stitch').length, 0);
  assert.equal(new Set(stitchEntries.map(entry => entry.id)).size, stitchEntries.length);
});

test('blank, transparent, and low-contrast crops do not produce ink', () => {
  for (const rgba of [[0,0,0,0,255,255,255,255], [100,100,100,255,115,115,115,255]]) {
    assert.deepEqual([...inkMask(rgba, 2, 1)], [0,0]);
  }
});

test('disconnected symbols keep their positions, including diagonal strokes', () => {
  const mask = new Uint8Array(100);
  for (let i = 0; i < 5; i++) {
    mask[i * 10 + i] = 1;
    mask[i * 10 + 9] = 1;
  }
  assert.deepEqual(components(mask, 10, 10), [
    {x:0,y:0,w:5,h:5,area:5}, {x:9,y:0,w:1,h:5,area:5}
  ]);
});

test('shape ranking deduplicates variants and abstains on a tie', () => {
  const mask = Uint8Array.from([0,1,0,1,1,1,0,1,0]);
  const box = {x:0,y:0,w:3,h:3};
  const match = normalizedMask(mask, 3, box);
  const blank = new Uint8Array(match.length);
  const scores = rankSymbols(mask, 3, box, [
    {id:'sc',pixels:blank}, {id:'ch',pixels:blank}, {id:'sc',pixels:match}
  ]);
  assert.deepEqual(scores, [{id:'sc',score:1},{id:'ch',score:0}]);
  assert.equal(matchConfidence(scores), 'Clear shape match');
  assert.equal(matchConfidence([{score:.9},{score:.88}]), 'Uncertain');
  assert.equal(matchConfidence([]), 'Uncertain');
});

test('local contrast can recover a faint foreground and preserves transparency', () => {
  const pixels = Uint8ClampedArray.from([95,95,95,255,125,125,125,255,0,0,0,0]);
  assert.deepEqual([...inkMask(pixels.subarray(0,8), 2, 1)], [0,0]);
  adjustScanPixels(pixels, 5, 100);
  assert.deepEqual([...inkMask(pixels.subarray(0,8), 2, 1)], [1,0]);
  assert.equal(pixels[11], 0);
});

test('rescans recognize an existing box without swallowing adjacent regions', () => {
  const box = {x:10,y:10,w:15,h:20};
  assert.equal(sameScanRegion(box, {x:11,y:11,w:14,h:18}), true);
  assert.equal(sameScanRegion(box, {x:24,y:11,w:14,h:18}), false);
});

test('illustrated encyclopedia additions are searchable by terminology and category', () => {
  assert.equal(searchStitches('increase', 'uk', 'Shaping')[0].id, 'inc');
  assert.equal(searchStitches('bobble', 'both', 'Foundations').length, 0);
  for (const id of ['inc','v-st','bobble','mr']) {
    const entry = stitchEntries.find(item => item.id === id);
    assert.ok(entry.path && entry.steps.length >= 2 && entry.example);
  }
});

test('downsampling keeps one-pixel strokes between sample centers', () => {
  const width=120;
  const mask=new Uint8Array(width*width);
  for(let y=0;y<width-1;y++)mask[y*width+y+1]=1;
  const normalized=normalizedMask(mask,width,{x:0,y:0,w:width,h:width},true);
  const rows=Array.from({length:32},(_,y)=>normalized.slice(y*32,(y+1)*32));
  assert.ok(rows.filter(row=>row.some(Boolean)).length>=24);
});
