const assert=require('node:assert/strict');
const test=require('node:test');
global.self=globalThis;
require('../advanced.js');
const {cropToFill,photoPlacement}=DoretteAdvanced;
const full={left:0,top:0,right:1,bottom:1};
for(const [name,w,h,crop,cols,rows] of [
 ['wide',1600,900,full,80,110],
 ['tall',900,1600,full,120,165],
 ['matching',800,1100,full,80,110],
 ['fractional off-center',1267,811,{left:.12,top:.038,right:.854,bottom:.923},79,117],
 ['square',1024,1500,full,60,60],
 ['minimum grid',40,50,full,1,1],
 ['maximum grid',1260,940,full,200,300],
 ['rotated source dimensions',811,1267,full,79,117]
]){
 test('Crop to Fill '+name,()=>{
  const box=cropToFill(crop,w,h,cols,rows);
  assert.ok(box);
  assert.ok(box.left>=crop.left-1e-9&&box.right<=crop.right+1e-9&&box.top>=crop.top-1e-9&&box.bottom<=crop.bottom+1e-9);
  assert.ok(Math.abs((box.left+box.right)-(crop.left+crop.right))<1e-9);
  assert.ok(Math.abs((box.top+box.bottom)-(crop.top+crop.bottom))<1e-9);
  const cw=(box.right-box.left)*w,ch=(box.bottom-box.top)*h;
  assert.ok(Math.abs(cw/ch-cols/rows)<1e-9);
  const area=photoPlacement(cw,ch,cols,rows);
  assert.ok(Math.abs(area.x)<1e-9&&Math.abs(area.y)<1e-9);
 });
}
test('unrepresentable narrow crops safely keep the existing frame',()=>{
 assert.equal(cropToFill(full,900,900,1,300),null);
 assert.equal(cropToFill({left:.2,right:.28,top:.3,bottom:.38},900,900,80,110),null);
});
test('legacy stretch and contain geometry retains centered proportions and margins',()=>{
 assert.deepEqual(photoPlacement(800,400,80,110),{x:0,y:35,w:80,h:40});
 assert.deepEqual(photoPlacement(800,400,80,110,true),{x:0,y:0,w:80,h:110});
 assert.deepEqual(photoPlacement(400,800,120,165),{x:18.75,y:0,w:82.5,h:165});
});
