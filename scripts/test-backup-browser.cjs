const {waitForBrowserPort} = require('./browser-port.cjs');
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
    const port = await waitForBrowserPort(edge, profile);
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
      const ok=(value,label)=>{if(!value)throw Error(label);};
      const build=(name,pinned)=>{
        const p=blankProject(name,10,10);
        Object.assign(p,{pinned,category:'Fixture category',notes:'Cotton sample',guide:{row:2,position:3}});
        p.palette.push({hex:'#112233',name:'Ink',symbol:'B'});
        p.cells[13]=1;p.done[13]=1;p.rowDone[0]=1;
        p.layers=[{id:'text',name:'HELLO',type:'text',visible:true,locked:false,entries:[[14,1]],source:{text:'HELLO',col:5,row:2,color:1,handEdited:true}}];
        const history={cols:p.cols,rows:p.rows,cells:p.cells,done:p.done,rowDone:p.rowDone,palette:p.palette,layers:p.layers,converted:true};
        p.checkpoints=[{...history,id:'cp',name:'Previous',at:p.createdAt}];
        return p;
      };
      const originals=[build('Alpha',true),build('Beta',false),build('Gamma',false),build('Trash',false)];
      const trash=originals[3];trash.trashedAt=trash.createdAt;
      const previousIds=[...projects.keys(),...recycledProjects.keys()];
      ok(await organizeProjects(originals,previousIds,['Fixture category'],()=>{
        projects.clear();recycledProjects.clear();
        for(const p of originals.slice(0,3))projects.set(p.id,p);
        recycledProjects.set(trash.id,trash);
        selectProject(originals[0].id);
      }), 'seed saved');
      let blob;download=value=>{blob=value;};
      await exportBackup(true);
      ok(blob,'real export');
      const archive=readZip(new Uint8Array(await blob.arrayBuffer()));
      const payload=JSON.parse(textDecoder.decode(archive['backup.json']));
      ok(JSON.stringify(payload.projects.map(p=>p.id))===JSON.stringify(originals.slice(0,3).map(p=>p.id)),'exact active export IDs');
      ok(payload.organization.recycleBin.length===1&&payload.organization.recycleBin[0].id===trash.id,'exact recycled export ID');
      const file=new File([blob],'fixture.zip');
      const disk=()=>dbRequest('readonly',store=>store.getAll());
      const before=JSON.stringify(await disk());
      window.confirm=msg=>{ok(msg.includes('3 active project(s) and 1 Recycle Bin'),'preview counts '+msg);return false;};
      await restoreBackup(file);
      ok(JSON.stringify(await disk())===before,'canceled restore');
      const corrupt=new Uint8Array(await blob.arrayBuffer());corrupt[corrupt.length-1]^=1;
      window.confirm=()=>{throw Error('Invalid ZIP reached confirmation');};
      await restoreBackup(new File([corrupt],'bad.zip'));
      ok(JSON.stringify(await disk())===before,'corrupt restore');
      window.confirm=()=>true;
      const realRequest=dbRequest;
      dbRequest=(mode,action)=>realRequest(mode,store=>{const result=action(store);if(mode==='readwrite')store.transaction.abort();return result;});
      try{await restoreBackup(file);}finally{dbRequest=realRequest;}
      ok(JSON.stringify(await disk())===before,'aborted transaction rollback');
      await restoreBackup(file);
      const rows=await disk();
      const priorRows=JSON.parse(before);
      ok(rows.length===priorRows.length+originals.length,'exact number of restored copies');
      for(const old of originals){
        ok(JSON.stringify(rows.find(p=>p.id===old.id))===JSON.stringify(priorRows.find(p=>p.id===old.id)),old.name+' original unchanged');
        const copy=rows.find(p=>p.name===old.name+' (restored)');
        ok(copy&&copy.id!==old.id,'copy '+old.name);
        for(const field of ['cols','rows','cells','done','rowDone','palette','notes','guide','category','pinned','checkpoints']){
          if(field==='guide'){ok(copy.guide.row===old.guide.row&&copy.guide.position===old.guide.position,'guide');continue;}
          ok(JSON.stringify(copy[field])===JSON.stringify(old[field]),old.name+' '+field);
        }
        ok(copy.layers[0].source.text==='HELLO'&&copy.layers[0].entries[0][0]===14,'editable text');
        ok(Boolean(copy.trashedAt)===Boolean(old.trashedAt),'Recycle Bin membership');
      }
      return 'PASS production ZIP export, preview, cancel, corruption rejection, IndexedDB rollback, and copy integrity';
    })()`;
    console.log(await evaluate("window.editorProbe("+JSON.stringify(probe)+")"));
    ws.close();
  } finally { edge.kill(); server.close(); }
})().catch(error=>{ console.error(error); process.exit(1)});






