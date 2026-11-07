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
      const ok=(v,message)=>{if(!v)throw Error(message);};
      const disk=()=>dbRequest('readonly',store=>store.getAll());
      const count=async()=> (await disk()).filter(p=>p.cols).length;
      const before=await count(),id=active.id;
      localStorage.setItem('dorette-safe-edits','true');
      ok(!$('safeEdits').checked&&!safeEditsEnabled,'copy default');
      const paint=$('paintColor').value;
      $('textInput').value='HI';$('textCol').value='2';$('textRow').value='20';
      ok($('textColor').value===''&&active.palette.length===1,'missing black does not change palette');
      $('applyText').click();ok(active.layers.length===0,'no implicit background lettering');
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
      window.confirm=()=>false;
      $('applyText').click();ok(active.layers[0].source.color===1,'low contrast requires consent');
      window.confirm=()=>true;
      $('applyText').click();
      ok(active.layers.length===1&&active.layers[0].id===layer&&active.layers[0].source.color===0,'lettering updated in place');
      undo();
      ok(active.layers[0].source.color===1,'undo restores original text color');
      $('newLettering').click();ok($('textColor').value==='1','new lettering resets to black');
      const image=document.createElement('canvas');image.width=image.height=32;
      const ctx=image.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,32,32);ctx.fillStyle='#161616';ctx.fillRect(8,8,16,16);
      const png=await new Promise(resolve=>image.toBlob(resolve));
      await importImage(new File([png],'conversion-fixture.png',{type:'image/png'}));
      for(let i=0;i<40&&!referenceImg;i++)await new Promise(resolve=>setTimeout(resolve,50));
      ok(referenceImg,'real PNG imported');
      $('previewDimensions').value='current';
      const original=JSON.stringify(active.cells);
      await convertImage();ok(pendingConversion?.cols===active.cols,'same-size conversion preview');
      $('cancelConversion').click();ok(!pendingConversion&&JSON.stringify(active.cells)===original,'cancel keeps artwork');
      await convertImage();$('applyConversion').click();
      ok(active.id===id&&active.converted,'same-size conversion applies in place');undo();
      $('previewDimensions').value='large';
      await convertImage();ok(pendingConversion?.cols===120,'larger conversion preview');
      $('applyConversion').click();
      await flushSave();await writeChain;
      ok(active.id===id&&active.cols===120&&active.done.length===19800,'dimension-changing conversion in place');
      ok(await count()===before,'routine edits add no records');
      undo();await flushSave();await writeChain;
      ok(active.layers[0].id===layer,'undo conversion restores lettering');
      const originalPalette=active.palette;
      active.palette=Array.from({length:12},(_,i)=>({hex:i===11?'#112233':'#fffdf9',name:'Test yarn '+i,symbol:SYMBOLS[i]}));
      $('newLettering').click();
      ok($('textColor').value==='11'&&$('addTextBlack').disabled,'full palette selects contrasting yarn');
      active.palette[11].hex='#fffdf9';$('newLettering').click();
      ok($('textColor').value==='','full low-contrast palette requires a choice');
      active.palette=originalPalette;updateLegend();updateTextControls();
      $('safeEdits').checked=true;$('safeEdits').dispatchEvent(new Event('change'));
      ok(localStorage.getItem(standaloneKeys.safeEdits)==='true','new opt-in persisted');
      await convertImage();ok(pendingConversion,'opt-in conversion preview');
      $('applyConversion').click();await flushSave();await writeChain;
      ok(active.id!==id&&await count()===before+1,'opt-in conversion creates exactly one copy');
      $('safeEdits').checked=false;$('safeEdits').dispatchEvent(new Event('change'));
      await duplicateProject(active);await writeChain;
      ok(await count()===before+2,'explicit duplicate adds exactly one record');

      $('safeEdits').checked=false;$('safeEdits').dispatchEvent(new Event('change'));
      let cases=0;
      for(const layout of ['single','dual']){
       setChartLayout(layout,false);resizeCanvas();
       for(const axis of ['row','column'])for(const add of [true,false]){
        selected={col:20,row:30};setZoom(2.5);view.x=-500;view.y=-700;
        const old=structuredClone(active),point={...selected};
        const center={col:Math.max(1,Math.min(active.cols,Math.floor(((canvasWidth/2-view.x)/view.scale-M)/CELL)+1)),row:Math.max(1,Math.min(active.rows,active.rows-Math.floor(((canvasHeight/2-view.y)/view.scale-M)/CELL)))};
        const before={x:(M+(center.col-.5)*CELL)*view.scale+view.x,y:(M+(active.rows-center.row+.5)*CELL)*view.scale+view.y};
        const at=axis==='row'?point.row:point.col,result=NF.editChartLine(old,axis,at,add);
        structurePreview={axis,at,insert:add};await applyChartStructure();
        const mapped=result.position(center,true),selection=result.position(point,true);
        ok(view.scale===2.5,'structural zoom unchanged');
        ok(Math.abs((M+(mapped.col-.5)*CELL)*view.scale+view.x-before.x)<.001,'structural visual x preserved');
        ok(Math.abs((M+(active.rows-mapped.row+.5)*CELL)*view.scale+view.y-before.y)<.001,'structural visual y preserved');
        ok(selected.col===selection.col&&selected.row===selection.row,'selection follows structural mapping');
        const after=JSON.stringify(active.cells);undo();ok(JSON.stringify(active.cells)===JSON.stringify(old.cells),'structural undo artwork');redo();ok(JSON.stringify(active.cells)===after,'structural redo artwork');undo();cases++;
       }
       for(const columnEdge of ['left','right'])for(const rowEdge of ['top','bottom'])for(const delta of [-1,1]){
        selected={col:20,row:30};setZoom(3);view.x=-550;view.y=-750;
        const anchor=NF.captureChartViewport(active,view,canvasWidth,canvasHeight,CELL,M),old=structuredClone(active);
        const result=NF.resizeChartEdges(active,active.cols+delta,active.rows+delta,columnEdge,rowEdge);
        const expected=NF.restoreChartViewport(anchor,{...active,...result.patch},result.position,canvasWidth,canvasHeight,CELL,M);
        dimensionRequest={project:active,revision:renderRevision,result};await confirmDimensions();
        ok(view.scale===3&&Math.abs(view.x-expected.x)<.001&&Math.abs(view.y-expected.y)<.001,'edge resize preserves mapped visual anchor');
        undo();ok(JSON.stringify(active.cells)===JSON.stringify(old.cells),'edge resize undo artwork');cases++;
       }
      }
      await flushSave();await writeChain;
      ok((await disk()).find(p=>p.id===active.id).cols===active.cols,'structure dimensions persisted');
      console.log('PASS '+cases+' real structural and edge-resize operations preserve visual anchors, scale, selection and Undo/Redo');
      return 'PASS independent color, editable lettering, in-place conversion, undo, persisted project count and '+cases+' structural viewport operations';
    })()`;
    console.log(await evaluate("window.editorProbe("+JSON.stringify(probe)+")"));
    ws.close();
  } finally { edge.kill(); server.close(); }
})().catch(error=>{ console.error(error); process.exit(1)});







