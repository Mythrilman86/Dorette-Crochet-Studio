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
    const probe=`(async()=>{
      const ok=(v,message)=>{if(!v)throw Error(message);};
      const disk=()=>dbRequest('readonly',store=>store.getAll());
      const count=async()=> (await disk()).filter(p=>p.cols).length;
      const before=await count(),id=active.id;
      localStorage.setItem('dorette-safe-edits','true');
      ok(!$('safeEdits').checked&&!safeEditsEnabled,'copy default');
      const paint=$('paintColor').value;
      $('textInput').value='HI';$('textCol').value='2';$('textRow').value='20';
      $('addTextBlack').click();
      ok(active.palette[Number($('textColor').value)].hex==='#000000','black selected');
      ok($('paintColor').value===paint,'paint unchanged');
      $('applyText').click();
      ok(active.layers.length===1,'text applied');
      const layer=active.layers[0].id;
      $('editLastText').click();
      ok(editingLayerId===layer,'existing lettering selected');
      $('textColor').value='0';$('textColor').dispatchEvent(new Event('change'));
      ok($('paintColor').value===paint,'letter color independent');
      $('applyText').click();
      ok(active.layers.length===1&&active.layers[0].id===layer&&active.layers[0].source.color===0,'lettering updated in place');
      undo();
      ok(active.layers[0].source.color===1,'undo restores original text color');
      window.confirm=()=>true;
      pendingConversion={projectId:id,cols:18,rows:24,palette:active.palette,cells:Array(18*24).fill(1)};
      $('applyConversion').click();
      await flushSave();await writeChain;
      ok(active.id===id&&active.cols===18&&active.done.length===432,'dimension-changing conversion in place');
      ok(await count()===before,'routine edits add no records');
      undo();await flushSave();await writeChain;
      ok(active.layers[0].id===layer,'undo conversion restores lettering');
      await duplicateProject(active);await writeChain;
      ok(await count()===before+1,'explicit duplicate adds exactly one record');
      return 'PASS independent color, editable lettering, in-place conversion, undo and persisted project count';
    })()`;
    console.log(await evaluate("window.editorProbe("+JSON.stringify(probe)+")"));
    ws.close();
  } finally { edge.kill(); server.close(); }
})().catch(error=>{ console.error(error); process.exit(1)});







