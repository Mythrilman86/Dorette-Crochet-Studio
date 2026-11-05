const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const window = {};
for (const file of ['pattern-tools.js', 'next-features.js']) {
  vm.runInNewContext(readFileSync(file, 'utf8'), {window, structuredClone});
}
const {editChartLine} = window.DoretteNext;
const {physicalIndex, colAt, runs} = window.DorettePattern;
const fixture = () => ({
  cols:3, rows:3, cells:[1,2,1,2,1,2,1,1,2], done:[0,0,1,0,0,0,1,0,0], rowDone:[0,1,0],
  guide:{row:2,position:1}, workDirection:{first:'rtl',alternate:true},
  palette:[{}, {}, {}], sectionSize:25,
  layers:[{id:'letter',type:'text',locked:true,source:{text:'A',col:2,row:3},entries:[[1,2],[4,1],[8,2]]},
    {id:'motif',type:'motif',entries:[[0,1],[8,2]]}],
  annotations:[{id:'row',scope:'row',col:1,row:2},{id:'stitch',scope:'stitch',col:3,row:3},{id:'section',scope:'section',col:2,row:2}],
  notes:'Keep my notes', checkpoints:[{id:'cp'}], versions:[{id:'version'}], referenceImage:'photo', opacity:.5
});
const index = (p,c,r) => physicalIndex(p,c,r);
const plain = value => JSON.parse(JSON.stringify(value));

for (const axis of ['row','column']) {
  for (const insert of [true,false]) {
    test(`${insert?'insert':'delete'} ${axis} at both edges and the middle without resampling`, () => {
      for (const at of insert?[1,2,4]:[1,2,3]) {
        const p=fixture(), original=plain(p);
        const {patch,position,nonempty}=editChartLine(p,axis,at,insert);
        assert.deepEqual(p, original);
        assert.equal(patch.cells.length, patch.cols*patch.rows);
        assert.equal(patch.done.length, patch.cells.length);
        assert.equal(patch.rowDone.length, patch.rows);
        for(let row=1;row<=p.rows;row++)for(let col=1;col<=p.cols;col++){
          const mapped=position({row,col});
          const coordinate=axis==='row'?row:col;
          if(!insert&&coordinate===at){assert.equal(mapped,null);continue;}
          const expected=coordinate+(coordinate>=at?(insert?1:-1):0);
          assert.equal(mapped[axis==='row'?'row':'col'],expected);
          const old=index(p,col,row),next=index(patch,mapped.col,mapped.row);
          assert.equal(patch.cells[next],p.cells[old]);
          assert.equal(patch.done[next],p.rowDone[row-1]||p.done[old]);
        }
        if(insert){
          const span=axis==='row'?patch.cols:patch.rows;
          for(let i=1;i<=span;i++){
            const blank=index(patch,axis==='row'?i:at,axis==='row'?at:i);
            assert.equal(patch.cells[blank],0);
            assert.equal(patch.done[blank],0);
          }
        }else assert.equal(nonempty,true);
      }
    });
  }
}

test('column insertion keeps previous completed stitches, layers, notes and the guide coordinate', () => {
  const project=fixture();
  const {patch}=editChartLine(project,'column',2,true), updated={...project,...patch};
  assert.deepEqual(plain(patch.rowDone),[0,0,0]);
  assert.deepEqual(plain(patch.done.slice(4,8)),[1,0,1,1]);
  assert.deepEqual(plain(patch.layers[0].entries),[[2,2],[6,1],[11,2]]);
  assert.equal(patch.layers[0].source.handEdited,true);
  assert.equal(patch.layers[0].source.col,3);
  assert.equal(patch.layers[0].locked,true);
  assert.equal(patch.annotations[1].col,4);
  assert.equal(patch.annotations[2].section,1);
  assert.equal(colAt(updated,updated.guide.row,updated.guide.position),3);
  assert.equal(runs(updated,2).reduce((n,run)=>n+run.count,0),4);
  assert.equal(updated.referenceImage,'photo');
  assert.equal(updated.opacity,0);
  assert.equal(updated.notes,project.notes);
  assert.equal(updated.checkpoints,project.checkpoints);
  assert.equal(updated.versions,project.versions);
});

test('row deletion relocates reminders from the deleted row and recalculates alternating direction', () => {
  const project=fixture(), {patch}=editChartLine(project,'row',1,false);
  const updated={...project,...patch};
  assert.equal(updated.guide.row,1);
  assert.equal(colAt(updated,updated.guide.row,updated.guide.position),2);
  assert.equal(updated.annotations[0].row,1);
  assert.equal(updated.annotations[0].col,1);
  assert.throws(()=>editChartLine({...project,rows:1},'row',1,false),/limits/);
  assert.throws(()=>editChartLine({...project,cols:200},'column',200,true),/limits/);
});
