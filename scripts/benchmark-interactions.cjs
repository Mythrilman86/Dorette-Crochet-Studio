const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const cp = require('node:child_process'), assert = require('node:assert/strict');
const types = {'.js':'application/javascript','.html':'text/html','.css':'text/css','.png':'image/png'};
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  const file = path.resolve(__dirname, process.env.STUDIO_BENCH_ROOT || '../dist', '.'+(pathname === '/' ? '/index.html' : pathname));
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
      const results=[];
      for(const [cols,rows] of [[79,117],[120,165],[200,300]]){
        const chart=blankProject('Performance fixture',cols,rows);
        chart.palette.push({hex:'#112233',name:'Ink',symbol:'B'},{hex:'#aa3366',name:'Berry',symbol:'C'});
        chart.cells=chart.cells.map((_,i)=>Math.floor(i/11)%3);
        chart.done=chart.done.map((_,i)=>i%7===0?1:0);
        chart.notes='Sample blanket, yarn and gauge notes';
        chart.layers=[{id:'motif',name:'Lettering',type:'text',visible:true,locked:false,entries:[[42,1],[43,2]],source:{text:'HELLO',col:5,row:2,color:1,handEdited:true}}];
        const other=blankProject('Second project',20,20);
        projects.set(chart.id,chart);projects.set(other.id,other);
        const samples={},take=async(name,fn)=>{
          const start=performance.now();await fn();
          (samples[name]??=[]).push(performance.now()-start);
        };
        const heap=[];
        for(let i=0;i<60;i++){
          await take('switchAndOpen',()=>{selectProject(other.id);selectProject(chart.id);});
          await take('redraw',()=>draw());
          await take('panRedraw',()=>{view.x+=2;draw();});
          await take('zoom',()=>setZoom(i%2?1:1.1));
          await take('select',()=>{selected={col:3+i%30,row:5};updateSelection();});
          await take('paint',()=>brushSegment(selected,selected,{tool:'paint',color:(active.cells[indexFor(selected.col,selected.row)]+1)%3,snapshotted:false}));
          await take('undo',undo);
          await take('redo',redo);
          await take('progress',markStitch);
          await take('save',async()=>{await flushSave();await writeChain;});
          if(performance.memory&&i%5===0)heap.push(performance.memory.usedJSHeapSize);
        }
        const stats=Object.fromEntries(Object.entries(samples).map(([name,list])=>{
          list.sort((a,b)=>a-b);
          return [name,[list[29],list[56]]];
        }));
        results.push({cols,rows,stats,heap});
      }
      return results;
    })()`;
    console.log(JSON.stringify(await evaluate("window.editorProbe("+JSON.stringify(probe)+")")));
    ws.close();
  } finally { edge.kill(); server.close(); }
})().catch(error=>{ console.error(error); process.exit(1)});







