const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const window={};for(const p of ['pattern-tools.js','next-features.js'])vm.runInNewContext(fs.readFileSync(p,'utf8'),{window,structuredClone});
const n=window.DoretteNext;
function fixture(cols,rows){return {cols,rows,cells:Array(cols*rows).fill(1),done:Array(cols*rows).fill(0),rowDone:Array(rows).fill(0),palette:[{},{}],guide:{row:2,position:1},workDirection:{first:'rtl',alternate:true},layers:[],annotations:[]};}
for(const [cols,rows] of [[79,117],[120,165],[200,300]])test(`viewport anchors survive structural edits on ${cols}x${rows}`,()=>{
 const p=fixture(cols,rows),original=JSON.stringify(p),cell=20,margin=35;
 for(const scale of [.12,1,2.5,5])for(const [width,height] of [[360,640],[1000,650]]){
  const center={col:Math.floor(cols/2),row:Math.floor(rows/2)},dx=2.25,dy=-3.75;
  const view={scale,x:width/2-(margin+(center.col-.5)*cell+dx)*scale,y:height/2-(margin+(rows-center.row+.5)*cell+dy)*scale};
  const anchor=n.captureChartViewport(p,view,width,height,cell,margin);
  const operations=[];
  for(const axis of ['row','column'])for(const insert of [true,false])for(const at of [1,axis==='row'?center.row:center.col,axis==='row'?rows:cols]){
   if(insert&&(axis==='row'?rows===300:cols===200))continue;
   operations.push(n.editChartLine(p,axis,at,insert));
  }
  for(const columnEdge of ['left','right'])for(const rowEdge of ['top','bottom'])for(const delta of [-3,3])if(cols+delta<=200&&rows+delta<=300)operations.push(n.resizeChartEdges(p,cols+delta,rows+delta,columnEdge,rowEdge));
  for(const result of operations){
   const next={...p,...result.patch},v=n.restoreChartViewport(anchor,next,result.position,width,height,cell,margin),mapped=result.position(center,true);
   assert.equal(v.scale,scale);
   assert.ok(Math.abs((margin+(mapped.col-.5)*cell+dx)*v.scale+v.x-width/2)<1e-8,'mapped artwork x stays fixed');
   assert.ok(Math.abs((margin+(next.rows-mapped.row+.5)*cell+dy)*v.scale+v.y-height/2)<1e-8,'mapped artwork y stays fixed');
  }
 }
 assert.equal(JSON.stringify(p),original,'viewport code does not mutate original data');
});
test('off-chart viewport and final-edge deletion use bounded surviving stitch with retained offset',()=>{
 const p=fixture(3,3),view={scale:5,x:900,y:-900};const a=n.captureChartViewport(p,view,360,640,20,35);
 const r=n.resizeChartEdges(p,1,1,'left','bottom'),v=n.restoreChartViewport(a,{...p,...r.patch},r.position,360,640,20,35);
 assert.equal(v.scale,5);assert.ok(Number.isFinite(v.x)&&Number.isFinite(v.y));
});
