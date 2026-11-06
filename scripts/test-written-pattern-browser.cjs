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
      el('label').value='Round 4';await el('commit').onclick();await el('setCurrent').onclick();
      const tx=IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction=function(stores,mode){
        if(this.name==='dee-written-patterns'&&mode==='readwrite')throw new DOMException('Simulated storage exhaustion','QuotaExceededError');
        return tx.call(this,stores,mode);
      };
      el('note').value='Failed write fixture';
      try{await el('saveNote').onclick();}finally{IDBDatabase.prototype.transaction=tx;}
      if(!el('status').textContent.includes('Could not save'))throw Error('Failed write appeared saved');
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
    const backup=await evaluate(`(async()=>{
      const el=id=>document.getElementById(id);
      el('rangeFirst').value=40;el('rangeLast').value=41;
      await el('addRange').onclick();
      el('instructions').selectedIndex=1;await el('setCurrent').onclick();
      await el('completeNext').onclick();
      if(!el('working').textContent.includes('Row 41'))throw Error('Did not advance');
      await el('undoComplete').onclick();
      if(!el('working').textContent.includes('Row 40'))throw Error('Did not return on undo');
      el('label').value='Round 4';await el('commit').onclick();
      if([...el('instructions').options].filter(o=>o.text.includes('Round 4')).length!==2)throw Error('Duplicate label overwrote marker');
      el('label').value='Rows 40–41';await el('commit').onclick();
      el('instructions').selectedIndex=0;await el('setCurrent').onclick();
      Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false});
      let archive;
      URL.createObjectURL=value=>{archive=value;return 'blob:fixture';};
      HTMLAnchorElement.prototype.click=()=>{};
      const exportFile=async omit=>{
        el('omitPdf').checked=omit;
        await el('exportBackup').onclick();await el('saveBackup').onclick();
        if(!archive)throw Error(el('status').textContent);
        return Array.from(new Uint8Array(await archive.arrayBuffer()));
      };
      return {full:await exportFile(false),metadata:await exportFile(true)};
    })()`);
    await call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    const cleared=await call('Storage.clearDataForOrigin',{origin:url,storageTypes:'all'});
    assert.equal(cleared.error,undefined,'disposable site storage cleared');
    await call('Page.navigate',{url:url+'/written-pattern.html'});
    for(let i=0;i<60;i++){
      await delay(100);
      if(await evaluate("document.readyState==='complete'&&!!document.querySelector('#restoreBackup')?.onclick").catch(()=>false))break;
    }
    const restored=await evaluate(`(async()=>{
      const el=id=>document.getElementById(id);
      const attach=(id,data,name)=>{
        const transfer=new DataTransfer();transfer.items.add(new File([data],name));
        el(id).files=transfer.files;
      };
      if(el('patterns').options.length)throw Error('Storage was not clean');
      window.confirm=()=>true;
      const full=new Uint8Array(${JSON.stringify(backup.full)});
      const bad=full.slice();bad[bad.length-1]^=1;
      attach('backupFile',bad,'bad.deewritten');
      await el('restoreBackup').onclick();
      if(!el('status').textContent.includes('checksum')||el('patterns').options.length)throw Error('Corruption was not rejected atomically');
      attach('backupFile',full,'full.deewritten');await el('restoreBackup').onclick();
      if(el('patterns').options.length!==1||el('note').value!=='Use the smaller hook'||!el('complete').textContent.includes('Undo'))throw Error(el('status').textContent);
      const first=el('patterns').value;
      attach('backupFile',new Uint8Array(${JSON.stringify(backup.metadata)}),'metadata.deewritten');
      await el('restoreBackup').onclick();
      if(el('patterns').options.length!==1||!el('status').textContent.includes('exact original'))throw Error('Missing original accepted');
      attach('pdf',${JSON.stringify(source)},'original.pdf');
      await el('restoreBackup').onclick();
      if(el('patterns').options.length!==2||el('patterns').value===first||el('note').value!=='Use the smaller hook')throw Error(el('status').textContent);
      return true;
    })()`);
    assert.equal(restored,true);
    const downloads=path.join(profile,'downloads');
    fs.mkdirSync(downloads);
    const downloadBehavior=await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
    assert.equal(downloadBehavior.error,undefined);
    const downloadReady=await evaluate(`(async()=>{
      const el=id=>document.getElementById(id);
      if(!el('saveBackup').disabled||!el('shareBackup').disabled)throw Error('Unprepared backup actions enabled');
      Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
      let rejectShare,shares=0;
      Object.defineProperty(navigator,'share',{configurable:true,value:()=>{
        shares++;
        return new Promise((_,reject)=>{rejectShare=reject;});
      }});
      await el('exportBackup').onclick();
      if(el('saveBackup').disabled||el('shareBackup').disabled)throw Error('Prepared backup actions unavailable');
      el('shareBackup').click();
      if(!el('shareBackup').hasAttribute('aria-busy')||el('exportBackup').getAttribute('aria-disabled')!=='true')throw Error('Busy feedback missing');
      el('shareBackup').click();
      if(shares!==1)throw Error('Duplicate share started');
      rejectShare(new DOMException('Permission denied','NotAllowedError'));
      await new Promise(resolve=>setTimeout(resolve,0));
      if(!el('status').textContent.includes('Choose Download Backup')||el('saveBackup').disabled)throw Error('Sharing did not offer download recovery');
      el('saveBackup').scrollIntoView({block:'center'});
      el('saveBackup').focus();
      return shares===1&&document.activeElement===el('saveBackup');
    })()`);
    assert.equal(downloadReady,true);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32,text:' '});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
    let downloaded;
    for(let i=0;i<50;i++){
      downloaded=fs.readdirSync(downloads).find(name=>name.endsWith('.deewritten'));
      if(downloaded)break;
      await delay(100);
    }
    assert.ok(downloaded,'keyboard activation creates an actual download after sharing fails. Status: '+
      await evaluate("document.querySelector('#status').textContent")+'; files: '+fs.readdirSync(downloads).join(', '));
    assert.ok(fs.statSync(path.join(downloads,downloaded)).size>0);
    assert.match(await evaluate("document.querySelector('#status').textContent"),/Check Downloads or Files/);
    for(const [width,height] of [[320,640],[430,932],[820,1180],[1180,820],[1366,900]]){
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      assert.equal(await evaluate(`[...document.querySelectorAll('button')].every(button=>{
        const r=button.getBoundingClientRect();
        return !r.width||(r.left>=0&&r.right<=innerWidth&&button.scrollWidth<=button.clientWidth+2);
      })`),true,'buttons fit viewport '+width+' × '+height);
    }
    console.log('PASS PDF import, marker identity, Complete & Next, offline reopening, backup corruption rejection, and clean-storage restore with PDF or reattachment');
    console.log('PASS busy feedback, duplicate-share guard, denied-sharing fallback, and actual keyboard-triggered backup download');
    ws.close();
  } finally { edge.kill(); server.close(); }
})().catch(error=>{ console.error(error); process.exit(1)});







