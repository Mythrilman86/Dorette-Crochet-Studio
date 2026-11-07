const {waitForBrowserPort} = require('./browser-port.cjs');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const cp = require('node:child_process'), assert = require('node:assert/strict');
const types = {'.js':'application/javascript','.mjs':'application/javascript','.html':'text/html','.css':'text/css','.png':'image/png'};
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  const file = path.join(__dirname, '../dist', pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  if(pathname==='/assets/creator/ui.mjs'){res.end(fs.readFileSync(file,'utf8').replace('(async()=>{try{store=',"window.creatorProbe=source=>eval(source);\n(async()=>{try{store="));return;}
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
    await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('dorette-crochet-studio');r.onsuccess=()=>{const tx=r.result.transaction('projects','readwrite'),store=tx.objectStore('projects'),q=store.getAll();q.onsuccess=()=>{const p=q.result.find(p=>p.cols);p.name='Synthetic colorwork';p.notes='Private untouched chart note';p.pinned=true;p.palette=[{hex:'#fffdf9',name:'Background',symbol:'A'},{hex:'#6d4ba5',name:'Purple',symbol:'B'},{hex:'#d782a4',name:'Rose',symbol:'C'}];p.cells=Array.from({length:p.cols*p.rows},(_,i)=>{const x=i%p.cols,y=Math.floor(i/p.cols);return x>12&&x<66&&y>12&&y<104?((Math.floor(x/5)+Math.floor(y/5))%2?1:2):0});p.cells[2]=1;p.layers=[{id:'text-layer',type:'text',visible:true,entries:[[2,2]],source:{text:'Synthetic'}}];p.done[0]=1;p.rowDone[1]=1;p.favorite=true;p.category='Creator source category';p.annotations=[{id:'source-note',scope:'stitch',row:1,col:1,text:'Keep annotation'}];store.put(p);store.put({...structuredClone(p),id:'recycled-fixture',name:'Recycled fixture',trashedAt:new Date().toISOString(),pinned:false});store.put({id:'studio:category-catalog',categories:['Creator source category']});};tx.oncomplete=()=>resolve(true);tx.onabort=()=>reject(tx.error);};})`);
    await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('dee-written-patterns',1);r.onupgradeneeded=()=>{r.result.createObjectStore('patterns',{keyPath:'id'});r.result.createObjectStore('documents');};r.onsuccess=()=>{const tx=r.result.transaction(['patterns','documents'],'readwrite');tx.objectStore('patterns').put({id:'companion-sentinel',name:'Keep companion',note:'Independent private data'});tx.objectStore('documents').put(new Blob(['Original synthetic companion bytes']),'companion-sentinel');tx.oncomplete=()=>resolve(true);tx.onabort=()=>reject(tx.error);};})`);
    const chartBefore=await evaluate(`new Promise(resolve=>{const r=indexedDB.open('dorette-crochet-studio');r.onsuccess=()=>{const q=r.result.transaction('projects').objectStore('projects').getAll();q.onsuccess=()=>resolve(q.result)}})`);
    await call('Page.navigate',{url:url+'/pattern-creator.html'});
    for(let i=0;i<100;i++){if(await evaluate("document.querySelector('#saveState')?.textContent.includes('ready')").catch(()=>false))break;await delay(100);}
    assert.match(await evaluate("document.querySelector('#saveState').textContent"),/ready/);
    const probe=fs.readFileSync(path.join(__dirname,'creator-browser-scenario.txt'),'utf8');
    console.log(await evaluate('window.creatorProbe('+JSON.stringify(probe)+')'));
    const chartAfter=await evaluate(`new Promise(resolve=>{const r=indexedDB.open('dorette-crochet-studio');r.onsuccess=()=>{const q=r.result.transaction('projects').objectStore('projects').getAll();q.onsuccess=()=>resolve(q.result)}})`);
    assert.deepEqual(chartAfter,chartBefore,'all original Studio records untouched');
    assert.equal(await evaluate(`new Promise(resolve=>{const r=indexedDB.open('dee-written-patterns',1);r.onsuccess=()=>{const tx=r.result.transaction(['patterns','documents']),p=tx.objectStore('patterns').get('companion-sentinel'),d=tx.objectStore('documents').get('companion-sentinel');tx.oncomplete=async()=>resolve(p.result.name==='Keep companion'&&await d.result.text()==='Original synthetic companion bytes');};})`),true,'Written Companion metadata and document bytes unchanged');
    for(const [width,height]of [[390,844],[1280,800],[1440,900]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+2'),true,'no horizontal page overflow');}
    await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,'../../studio270-stage-a-authoring.png'),Buffer.from(shot.result.data,'base64'));
    await call('Network.enable');await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await call('Page.reload');
    for(let i=0;i<80;i++){if(await evaluate("document.querySelector('#saveState')?.textContent.includes('ready')").catch(()=>false))break;await delay(100);}
    assert.match(await evaluate("document.querySelector('#saveState').textContent"),/ready/);
    console.log(await evaluate("window.creatorProbe(\"(async()=>{const list=await store.list();await open(list.find(d=>d.meta.title.includes('restored')).id);const b=await bundle();if(!b.images.length||!b.snapshots.length)throw Error('offline assets missing');return 'PASS offline Creator restart, image bytes and frozen snapshots';})()\")"));
    ws.close();
  } finally { edge.kill(); server.close(); }
})().catch(error=>{ console.error(error); process.exit(1)});







