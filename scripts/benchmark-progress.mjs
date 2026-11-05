import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';

function counter(source) {
  const start=source.indexOf('function completionCounts(');
  const end=source.indexOf('function updateProgress(',start);
  return new Function(source.slice(start,end)+'\nreturn completionCounts;')();
}
function measure(fn,chart) {
  for(let i=0;i<150;i++)fn(chart);
  const runs=[];
  for(let trial=0;trial<7;trial++){
    const start=performance.now();
    for(let i=0;i<500;i++)fn(chart);
    runs.push((performance.now()-start)/500);
  }
  return runs.sort((a,b)=>a-b)[3];
}
const baseline=process.argv[2]||'fad0ecfeb487804550fe72df693ce5a5a2843d56';
const old=counter(execFileSync('git',['show',baseline+':app.js'],{encoding:'utf8'}));
const current=counter(readFileSync('app.js','utf8'));
for(const [cols,rows] of [[79,117],[120,165],[200,300]]){
  for(const completed of [false,true]){
    const chart={cols,rows,done:Array.from({length:cols*rows},(_,i)=>+(i%5===0)),
      rowDone:Array.from({length:rows},(_,i)=>+(completed&&i%2===0))};
    assert.deepEqual(current(chart),old(chart));
    console.log(JSON.stringify({cols,rows,completed,baselineMs:measure(old,chart),currentMs:measure(current,chart)}));
  }
}
