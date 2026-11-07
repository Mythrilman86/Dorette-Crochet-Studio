const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const setup=app.slice(app.indexOf('function setupServiceWorkerUpdates(){'),app.indexOf('function hookEvents(){'));
function harness(){
  const timers=new Set(), probes=[], listeners=new Map(), elements=new Map();
  const worker=name=>({name,postMessage(message,[port]){
    probes.push({worker:name,reply:port.peer.onmessage,timeout:[...timers].at(-1),port:port.peer});
  }});
  const serviceWorker={
    controller:worker('A'),
    addEventListener:(event,callback)=>listeners.set(event,callback),
    register:async()=>({addEventListener(){}})
  };
  const element=id=>{
    if(!elements.has(id))elements.set(id,{textContent:'',addEventListener(){}});
    return elements.get(id);
  };
  vm.runInNewContext(setup+'\nsetupServiceWorkerUpdates()',{
    $:element,window:{},location:{protocol:'https:'},navigator:{serviceWorker},
    setTimeout(callback){timers.add(callback);return callback;},
    clearTimeout(callback){timers.delete(callback);},
    MessageChannel:class{
      port1={close(){this.closed=true;}};
      port2={peer:this.port1};
    }
  });
  return {probes,timers,status:()=>element('offlineSetupStatus').textContent,
    change(name){serviceWorker.controller=worker(name);this.notify();},
    notify(){listeners.get('controllerchange')();}};
}
const reply=(probe,ready)=>probe.reply({data:{ready}});

test('a queued reply or timeout from the old controller cannot clear the new probe',async()=>{
  const h=harness();
  h.notify();
  await Promise.resolve();
  const [old]=h.probes;
  h.change('B');
  assert.equal(old.port.closed,true);
  assert.equal(h.timers.size,1);
  reply(old,true);
  old.timeout();
  h.notify();
  assert.equal(h.probes.length,2);
  assert.match(h.status(),/^Verifying/);
  reply(h.probes[1],true);
  assert.match(h.status(),/^Ready/);
  assert.equal(h.timers.size,0);
  assert.ok(h.probes.every(p=>p.port.closed));
});

test('expired replies are ignored, negative responses stay unready, and retries are bounded',()=>{
  const h=harness();
  h.notify();
  h.probes[0].timeout();
  reply(h.probes[0],true);
  assert.match(h.status(),/Retrying/);
  reply(h.probes[1],false);
  assert.match(h.status(),/incomplete/);
  assert.equal(h.timers.size,0);

  h.change('B');
  for(let index=2;index<5;index++)h.probes[index].timeout();
  assert.equal(h.probes.length,5);
  assert.match(h.status(),/could not be verified/);
  reply(h.probes[4],true);
  assert.match(h.status(),/could not be verified/);
  assert.equal(h.timers.size,0);
  assert.ok(h.probes.every(p=>p.port.closed));
});
