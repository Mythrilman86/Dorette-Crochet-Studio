const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const cp = require('node:child_process'), assert = require('node:assert/strict');
const types = {'.js':'application/javascript','.html':'text/html','.css':'text/css','.png':'image/png'};
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  const file = path.join(__dirname, '../dist', pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  if (pathname==='/app.js') {
    const source=fs.readFileSync(file,'utf8').replace(/^initialize\(\)\.catch/m,'window.editorProbe = source => eval(source);\ninitialize().catch');
    res.end(source);return;
  }
  fs.createReadStream(file).pipe(res);
});
const browser = process.env.STUDIO_TEST_BROWSER;
if (!browser) throw Error('Set STUDIO_TEST_BROWSER to the Chromium or Edge executable path.');
const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'studio-backup-test-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const edge = cp.spawn(browser, [
    '--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0',
    '--user-data-dir='+profile,'about:blank'
  ], {windowsHide:true});
  try {
    const portFile = path.join(profile,'DevToolsActivePort');
    for (let i=0; i<80 && !fs.existsSync(portFile); i++) await delay(250);
    const port = fs.readFileSync(portFile,'utf8').split('\n')[0].trim();
    const pages = await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    const ws = new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
    await new Promise((ok, fail)=>{ ws.onopen=ok; ws.onerror=fail; });
    const pending = new Map();
    let id=0;
    ws.onmessage = message => {
      const data=JSON.parse(message.data);
      if (!pending.has(data.id)) return;
      pending.get(data.id)(data);
      pending.delete(data.id);
    };
    const call = (method,params={}) => new Promise(resolve=>{
      pending.set(++id, resolve); ws.send(JSON.stringify({id,method,params}));
    });
    const evaluate = async expression => {
      const {result,error} = await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if (error || result.exceptionDetails) throw Error(JSON.stringify(error || result.exceptionDetails));
      return result.result.value;
    };
    await call('Page.navigate',{url});
    for(let i=0;i<60;i++) {
      if(await evaluate('!!navigator.serviceWorker?.controller && !!document.querySelector("#stitchEntries details")')) break;
      await delay(250);
    }
    assert.equal(await evaluate('!!navigator.serviceWorker.controller'),true);
    await call('Network.enable');
    await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    const probe=`(async()=>{
      const ok=(v,m)=>{if(!v)throw Error(m);};
      const storage=navigator.storage;
      const persisted=storage.persisted,persist=storage.persist;
      let requests=0;
      storage.persisted=async()=>false;storage.persist=async()=>{requests++;return false;};
      await refreshPersistence(true);await refreshPersistence();
      ok(requests===1&&$('persistenceStatus').textContent.includes('declined'),'denial does not repeat request');
      storage.persist=undefined;await refreshPersistence();
      ok($('persistenceStatus').textContent.includes('unavailable'),'unsupported browser remains usable');
      storage.persisted=persisted;storage.persist=persist;
      const original=active;
      original.notes='Recovery fixture';original.done[0]=1;
      scheduleSave();
      const committed=Date.now;
      try{
        Date.now=()=>committed()+180000;
        await flushSave();
        for(let i=0;i<40;i++){
          if((await recoveryRecords()).some(r=>r.project.notes==='Recovery fixture'))break;
          await new Promise(resolve=>setTimeout(resolve,25));
        }
      }finally{Date.now=committed;}
      const record=(await recoveryRecords()).find(r=>r.project.notes==='Recovery fixture');
      ok(record?.project.done[0]===1,'snapshot contains saved progress');
      $('protectionDrawer').open=true;await renderProtection();
      window.confirm=()=>false;
      $('localRecoveryList').lastElementChild.click();
      ok(projects.size===1,'cancel restore creates no project');
      window.confirm=()=>true;
      $('localRecoveryList').firstElementChild.click();
      for(let i=0;i<40&&projects.size===1;i++)await new Promise(resolve=>setTimeout(resolve,25));
      ok(projects.size===2&&projects.get(original.id)===original,'restore creates one separate copy');
      ok(active.id!==original.id&&active.notes===original.notes&&active.done[0]===1,'restored copy retains notes and progress');
      active.notes='Pending export fixture';scheduleSave();
      await exportBackup(false,'prepare');
      const zip=readZip(new Uint8Array(await preparedProtectionBackup.blob.arrayBuffer()));
      ok(JSON.parse(textDecoder.decode(zip['backup.json'])).projects[0].notes==='Pending export fixture','backup waits for pending save');
      ok(!protectionPreference(protectionKey),'preparing does not confirm external backup');
      const realRequest=dbRequest;
      dbRequest=(mode,fn)=>mode==='readwrite'?Promise.reject(Error('simulated quota')):realRequest(mode,fn);
      try{
        active.notes='Unsaved emergency fixture';scheduleSave();
        let warning=false;
        window.confirm=message=>{warning=message.includes('in-memory');return false;};
        await exportBackup(false,'prepare');
        ok(warning&&failedWrites.has(active.id),'failed write requires explicit emergency export consent');
      }finally{dbRequest=realRequest;}
      return 'PASS offline snapshot restore-as-copy, pending-save ZIP and failed-save warning';
    })()`;
    console.log(await evaluate("window.editorProbe("+JSON.stringify(probe)+")"));
    ws.close();
  } finally { edge.kill(); server.close(); }
})().catch(error=>{ console.error(error); process.exit(1)});







