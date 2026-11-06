const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const cp = require('node:child_process'), assert = require('node:assert/strict');
const types = {'.js':'application/javascript','.mjs':'application/javascript','.html':'text/html','.css':'text/css','.png':'image/png'};
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
    for(let i=0;i<80;i++){
      if(await evaluate('!!navigator.serviceWorker?.controller'))break;
      await delay(200);
    }
    assert.equal(await evaluate('!!navigator.serviceWorker?.controller'),true,'offline cache installed');
    await call('Page.navigate',{url:url+'/written-pattern.html'});
    for(let i=0;i<50;i++){
      if(await evaluate("!!document.querySelector('#add')?.onclick").catch(()=>false))break;
      await delay(100);
    }
    const pdfObjects=[
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 5 0 R >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 5 0 R >>',
      '<< /Length 24 >>\nstream\n0 0 0 rg 20 20 50 50 re f\nendstream'
    ];
    let source='%PDF-1.4\n';
    const offsets=pdfObjects.map((obj,index)=>{
      const offset=source.length;
      source+=(index+1)+' 0 obj\n'+obj+'\nendobj\n';
      return offset;
    });
    const xref=source.length;
    source+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+
      'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
    const result=await evaluate(`(async()=>{
      const el=id=>document.getElementById(id);
      el('name').value='Synthetic instructions';
      const invalid=new DataTransfer();
      invalid.items.add(new File(['invalid'],'broken.pdf',{type:'application/pdf'}));
      el('pdf').files=invalid.files;
      await el('add').onclick();
      if(!el('status').textContent.includes('valid PDF header')||el('patterns').options.length)throw Error('Invalid PDF was accepted');
      const transfer=new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(source)}],'fixture.pdf',{type:'application/pdf'}));
      el('pdf').files=transfer.files;
      await el('add').onclick();
      if(el('reader').hidden)throw Error(el('status').textContent);
      const canvas=el('canvas'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      if(!pixels.some((value,index)=>index%4===0&&value<100&&pixels[index+3]===255))throw Error('PDF page did not render its test artwork');
      el('label').value='Round 4';await el('commit').onclick();
      el('note').value='Use the smaller hook';await el('saveNote').onclick();
      await el('complete').onclick();
      await el('next').onclick();
      if(el('page').value!=='2'||!el('working').textContent.includes('Round 4'))throw Error('Browsing changed working marker');
      await el('resume').onclick();
      return el('page').value==='1'&&el('canvas').width>0&&el('complete').textContent.includes('Undo');
    })()`);
    assert.equal(result,true);
    await call('Network.enable');
    await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await call('Page.reload');
    let reopened=false;
    for(let i=0;i<60;i++){
      await delay(150);
      reopened=await evaluate("document.querySelector('#note')?.value==='Use the smaller hook' && document.querySelector('#working')?.textContent.includes('Round 4') && document.querySelector('#complete')?.textContent.includes('Undo')").catch(()=>false);
      if(reopened)break;
    }
    assert.equal(reopened,true,'offline reload preserves saved working position and notes');
    console.log('PASS synthetic PDF import and rendering, separate browsing, completion, note, and offline reopen');
    ws.close();
  } finally { edge.kill(); server.close(); }
})().catch(error=>{ console.error(error); process.exit(1)});







