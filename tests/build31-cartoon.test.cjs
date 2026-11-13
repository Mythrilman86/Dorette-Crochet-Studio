const test=require('node:test'),assert=require('node:assert/strict');
require('../cartoon.js');
const {convert,metrics}=globalThis.StudioCartoon;
function fixture(){
  const width=120,height=144,pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const face=(x-60)**2/36**2+(y-71)**2/49**2<1;
    const eye=face&&y>=56&&y<=60&&(Math.abs(x-47)<7||Math.abs(x-73)<7);
    const mouth=face&&y>88&&y<93&&Math.abs(x-60)<13;
    const noise=((x*17+y*29+x*y*3)%45)-22;
    const rgb=eye?[22,17,19]:mouth?[127,36,51]:face?[192+noise+y/4,119+noise,76+noise]:[53+noise,86+noise,130+noise];
    pixels.set([...rgb,255],(y*width+x)*4);
  }
  return {width,height,pixels,cols:40,rows:48};
}
test('Cartoon preserves input and produces distinct presets at real stitch resolution',()=>{
  const input=fixture(),before=input.pixels.slice();
  const charts=['simple','balanced','detailed'].map(preset=>convert({...input,settings:{preset,colors:6}}));
  assert.deepEqual(input.pixels,before);
  for(const chart of charts){
    assert.equal(chart.cells.length,40*48);
    assert.ok(chart.palette.length<=6);
    assert.equal(new Set(chart.cells).size,chart.palette.length);
    assert.equal(chart.metrics.rowChanges.length,48);
    const eye=chart.palette[chart.cells[19*40+15]].hex;
    const cheek=chart.palette[chart.cells[23*40+15]].hex;
    assert.notEqual(eye,cheek);
  }
  assert.notDeepEqual(charts[0].cells,charts[1].cells);
  assert.notDeepEqual(charts[1].cells,charts[2].cells);
});
test('Cartoon grayscale respects 12-yarn model cap and rejects unsafe dimensions',()=>{
  const input=fixture(),result=convert({...input,settings:{colors:15,gray:true}});
  assert.equal(result.palette.length,12);
  for(const {hex} of result.palette)assert.match(hex,/^#([0-9a-f]{2})\1\1$/);
  assert.throws(()=>convert({...input,width:9000}),/Invalid cartoon/);
});
test('Crochet quality metrics count 4-neighbor regions and rows bottom first',()=>{
  const result=metrics([1,0,1,0,0,0,0,0,0],3,3);
  assert.equal(result.isolated,2);
  assert.deepEqual(result.rowChanges,[0,0,2]);
  assert.equal(result.tinyPercent,200/9);
});
