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
    ...(process.env.STUDIO_TEST_HEADFUL ? [] : ['--headless=new']),'--disable-gpu','--no-first-run','--remote-debugging-port=0',
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
    console.log(await evaluate('window.editorProbe('+JSON.stringify(fs.readFileSync(path.join(__dirname,'build25-studio-scenario.txt'),'utf8'))+')'));
    for(const width of [390,1024,1600]){await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});assert.equal(await evaluate("(()=>{const a=document.querySelector('.workspace-link').getBoundingClientRect(),b=document.querySelector('#openPatternCreator').getBoundingClientRect();return a.right<=b.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1})()"),true,'navigation links remain distinct');}
    await call('Page.navigate',{url:url+'/pattern-creator.html'});for(let i=0;i<100;i++){if(await evaluate("document.querySelector('#saveState')?.textContent.includes('ready')").catch(()=>false))break;await delay(100);}
    console.log(await evaluate('window.creatorProbe('+JSON.stringify(fs.readFileSync(path.join(__dirname,'build25-creator-scenario.txt'),'utf8'))+')'));
    await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await call('Emulation.setTouchEmulationEnabled',{enabled:false});assert.equal(await evaluate("matchMedia('(hover:hover)').matches"),true,'desktop test requires a hover-capable pointer');
    await evaluate("scrollTo({top:0,behavior:'instant'})");await delay(150);
    const bounds=await evaluate("(()=>{const r=document.querySelector('#retrySave').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});await delay(150);const normal=await evaluate("getComputedStyle(document.querySelector('#retrySave')).backgroundColor");
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',...bounds});await delay(160);const hover=await evaluate("getComputedStyle(document.querySelector('#retrySave')).backgroundColor");assert.notEqual(normal,hover,'hover visible: '+JSON.stringify(await evaluate("({hoverCapability:matchMedia('(hover:hover)').matches,hovered:document.querySelector('#retrySave').matches(':hover'),active:document.activeElement?.id,rect:document.querySelector('#retrySave').getBoundingClientRect().toJSON()})")));
    await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...bounds});await delay(150);assert.notEqual(await evaluate("getComputedStyle(document.querySelector('#retrySave')).backgroundColor"),hover,'pressed visible');await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...bounds});
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineStyle!=='none'"),true,'keyboard focus visible');
    for(const [width,height]of [[390,844],[1024,768],[1440,900]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});for(const scale of [1,1.5,2]){await evaluate('document.documentElement.style.fontSize='+JSON.stringify(String(scale*100)+'%'));assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+3'),true,'responsive at enlarged text');}await evaluate("document.documentElement.style.fontSize='100%'");}
    ws.close();
  } finally { edge.kill(); server.close(); }
})().catch(error=>{ console.error(error); process.exit(1)});







