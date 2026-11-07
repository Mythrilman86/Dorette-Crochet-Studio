const http = require('node:http'),
  fs = require('node:fs'),
  path = require('node:path');
const cp = require('node:child_process'),
  assert = require('node:assert/strict');
const types = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.png': 'image/png'
};
let transientFailure = false;
let persistentFailure = process.env.STUDIO_PERSISTENT_FAILURE === '1';
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/assets/pdfjs/pdf.worker.min.mjs' && (persistentFailure || !transientFailure)) {
    transientFailure = true;
    res.writeHead(503).end();
    return;
  }
  const file = path.join(__dirname, '../dist', pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  if (pathname === '/written-pattern.html') {
    const setup = `<script>
      const originalOpen=IDBFactory.prototype.open;
      IDBFactory.prototype.open=function(name,...args){
        const request=originalOpen.call(this,name,...args);
        if(name==='dee-written-patterns'&&!sessionStorage.getItem('studio-test-held-open')){
          sessionStorage.setItem('studio-test-held-open','1');
          Object.defineProperty(request,'onsuccess',{
            set(handler){request.addEventListener('success',event=>{
              window.releaseTestPatternStorage=()=>{delete window.releaseTestPatternStorage;handler.call(request,event);};
            });}
          });
        }
        return request;
      };
    </script>`;
    res.end(fs.readFileSync(file, 'utf8').replace('</head>', setup + '</head>'));
    return;
  }
  if (pathname === '/app.js') {
    const source = fs.readFileSync(file, 'utf8').replace(
      /^initialize\(\)\.catch/m,
      `
      window.editorProbe = source => eval(source);
      window.offlineChecks = 0;
      const post = ServiceWorker.prototype.postMessage;
      ServiceWorker.prototype.postMessage = function(message, ports){
        if(message.type==='CHECK_OFFLINE'&&++window.offlineChecks===1){
          ports[0].close();return;
        }
        return post.call(this,message,ports);
      };
      initialize().catch`
    );
    res.end(source);
    return;
  }
  fs.createReadStream(file).pipe(res);
});
const browser = process.env.STUDIO_TEST_BROWSER;
if (!browser) throw Error('Set STUDIO_TEST_BROWSER to the Chromium or Edge executable path.');
const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'studio-backup-test-'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const edge = cp.spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      'about:blank'
    ],
    { windowsHide: true }
  );
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 80 && !fs.existsSync(portFile); i++) await delay(250);
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const ws = new WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((ok, fail) => {
      ws.onopen = ok;
      ws.onerror = fail;
    });
    const pending = new Map();
    let id = 0;
    ws.onmessage = (message) => {
      const data = JSON.parse(message.data);
      if (!pending.has(data.id)) return;
      pending.get(data.id)(data);
      pending.delete(data.id);
    };
    const call = (method, params = {}) =>
      new Promise((resolve) => {
        pending.set(++id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const { result, error } = await call('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      if (error || result.exceptionDetails)
        throw Error(JSON.stringify(error || result.exceptionDetails));
      return result.result.value;
    };
    await call('Page.navigate', { url });
    if (persistentFailure) {
      for (let i = 0; i < 80; i++) {
        if (
          await evaluate(
            "document.querySelector('#offlineSetupStatus')?.textContent.includes('retry')"
          )
        )
          break;
        await delay(200);
      }
      assert.equal(
        await evaluate(
          "document.querySelector('#offlineSetupStatus')?.textContent.includes('retry') && !navigator.serviceWorker.controller"
        ),
        true
      );
      persistentFailure = false;
      await evaluate("document.querySelector('#checkUpdates').click()");
    }
    for (let i = 0; i < 80; i++) {
      if (await evaluate('!!navigator.serviceWorker?.controller')) break;
      await delay(200);
    }
    assert.equal(
      await evaluate('!!navigator.serviceWorker?.controller'),
      true,
      'offline cache installed'
    );
    assert.equal(transientFailure, true, 'first precache request encountered HTTP 503');
    for (let i = 0; i < 50; i++) {
      if (
        await evaluate(
          "document.querySelector('#offlineSetupStatus')?.textContent.startsWith('Ready for offline use')"
        )
      )
        break;
      await delay(100);
    }
    assert.equal(
      await evaluate(
        "document.querySelector('#offlineSetupStatus').textContent.startsWith('Ready for offline use')"
      ),
      true
    );
    assert.equal(
      await evaluate('window.offlineChecks'),
      2,
      'readiness recovers after its first reply is lost'
    );

    const results = await evaluate(`(async()=>{
      const pdfjs=await import('./assets/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc='./assets/pdfjs/pdf.worker.min.mjs';
      const d=await pdfjs.getDocument({data:await(await fetch('./Dorette-Crochet-Studio-User-Guide.pdf')).arrayBuffer()}).promise;
      const metadata={pages:d.numPages,outline:await d.getOutline(),items:[],sheets:[]};
      let sheet,g;
      for(let n=1;n<=d.numPages;n++){
        const page=await d.getPage(n),text=(await page.getTextContent()).items.map(i=>i.str).join(' ');
        metadata.items.push({page:n,text,links:(await page.getAnnotations()).filter(a=>a.subtype==='Link').length});
        if((n-1)%4===0){sheet=document.createElement('canvas');sheet.width=1000;sheet.height=1416;g=sheet.getContext('2d');g.fillStyle='white';g.fillRect(0,0,1000,1416);}
        const v=page.getViewport({scale:500/page.getViewport({scale:1}).width});
        const c=document.createElement('canvas');c.width=v.width;c.height=v.height;
        await page.render({canvas:c,canvasContext:c.getContext('2d'),viewport:v}).promise;
        g.drawImage(c,((n-1)%2)*500,Math.floor(((n-1)%4)/2)*708);
        if(n%4===0||n===d.numPages)metadata.sheets.push(sheet.toDataURL().split(',')[1]);
      }
      return metadata;
    })()`);
    const directory = path.join(__dirname, '../../studio260-guide-review');
    fs.mkdirSync(directory, { recursive: true });
    for (const [i, data] of results.sheets.entries())
      fs.writeFileSync(
        path.join(directory, 'sheet-' + (i + 1) + '.png'),
        Buffer.from(data, 'base64')
      );
    delete results.sheets;
    fs.writeFileSync(path.join(directory, 'inspection.json'), JSON.stringify(results, null, 2));
    console.log('Guide pages', results.pages, 'top bookmarks', results.outline?.length);
    ws.close();
  } finally {
    edge.kill();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
