const {waitForBrowserPort} = require('./browser-port.cjs');
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
    const port = await waitForBrowserPort(edge, profile);
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

    for (let i = 0; i < 50; i++) {
      if (await evaluate("!!window.editorProbe?.('active')").catch(() => false)) break;
      await delay(100);
    }
    await call('Page.enable');
    await call('Emulation.setDeviceMetricsOverride', {
      width: 1100,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false
    });
    await evaluate(
      "window.editorProbe(\"active.palette=[{hex:'#fffdf9',name:'Cream',symbol:'A'},{hex:'#6d4c9f',name:'Purple',symbol:'B'},{hex:'#ce9558',name:'Amber',symbol:'C'}];active.name='Practice colorwork';active.notes='Synthetic guide example';for(let r=0;r<active.rows;r++)for(let c=0;c<active.cols;c++)active.cells[r*active.cols+c]=(Math.floor(r/8)+Math.floor(c/8))%active.palette.length;active.converted=true;invalidateChartCache();refreshInspector();fitChart();requestDraw()\")"
    );
    const screenshots = {};
    async function snap(name, action) {
      if (action) await evaluate(action);
      await delay(500);
      const image = await call('Page.captureScreenshot', { format: 'png' });
      screenshots[name] = image.result.data;
    }
    await snap('workspace');
    await snap(
      'projects',
      "document.querySelector('#toggleProjects').dataset.hidden='0';window.editorProbe('refreshWorkspaceLayout()')"
    );
    await snap('personalization', "document.querySelector('#configurePersonalized').click()");
    await evaluate("document.querySelector('#personalizedDialog').close()");
    await snap(
      'editing',
      "window.editorProbe(\"revealSettingsSection(document.querySelector('#textInput').closest('.settings-section'))\");document.querySelector('#textInput').scrollIntoView({block:'center'})"
    );
    await evaluate('window.scrollTo(0,0)');
    await snap(
      'motif',
      "document.querySelector('#presetMotif').nextElementSibling.click();window.editorProbe('requestDraw()')"
    );
    await evaluate("window.editorProbe('clearMotifPreview()')");
    await snap('crochet', "document.querySelector('#crochetView').click()");
    await evaluate(
      "document.querySelector('#crochetView').click();window.editorProbe('v16DrawTexture()')"
    );
    await snap('preview', "document.querySelector('#textureSimulated').click()");
    await evaluate("document.querySelector('#crochetImageViewer').close()");
    await snap('exports', "document.querySelector('#previewExport').click()");
    await evaluate("document.querySelector('#exportPreviewDialog').close()");
    await snap('annotations', "window.editorProbe(\"selected={col:5,row:5};revealSettingsSection(document.querySelector('#annotationsPanel'))\");document.querySelector('#annotationText').value='Synthetic stitch reminder';document.querySelector('#addAnnotation').click();document.querySelector('#annotationText').scrollIntoView({block:'center'})");
    await snap('scanner',"document.querySelector('#openStitchStudio').click()");
    await evaluate("document.querySelector('#stitchStudio').close()");
    await snap(
      'health',
      "document.querySelector('.reliability-drawer').open=true;document.querySelector('.reliability-drawer').scrollIntoView()"
    );
    await snap('diagnostics', "document.querySelector('#diagnosticsSupport').click()");
    await evaluate("document.querySelector('#diagnosticsDialog').close()");
    await snap('about', "document.querySelector('#aboutStudio').click()");
    await evaluate("document.querySelector('#aboutStudioDialog').close()");
    await call('Page.navigate', { url: url + '/written-pattern.html' });
    await delay(500);
    await snap('written');
    const chapters = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../docs/guide-chapters.json'), 'utf8')
    );
    const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const guidePages = chapters
      .map(
        ([id, title, paragraphs, image], i) =>
          '<section id="chapter-' +
          id +
          '"><h1>' +
          escape(title) +
          '</h1>' +
          paragraphs.map((p) => '<p>' + escape(p) + '</p>').join('') +
          '<img alt="Actual Studio candidate interface with synthetic data" src="data:image/png;base64,' +
          screenshots[image] +
          '"><p class="caption">Actual v2.6.0 interface. Synthetic data. Controls may rearrange on a phone.</p></section>'
      )
      .join('');
    const html =
      '<!doctype html><html><head><meta charset="utf-8"><title>Dee’s Crochet Studio User Guide</title><style>@page{size:A4;margin:16mm 16mm 18mm}body{font:11pt/1.4 Arial;color:#30243c}section{break-before:page}h1{font-size:23pt;color:#67469c}h2{color:#67469c}p{margin:10pt 0}img{display:block;width:100%;max-height:94mm;object-fit:contain;border:1px solid #d7cbe4}.caption{font-size:8pt;color:#756781}a{color:#59358d}li{margin:7pt 0}.cover{padding-top:38mm}section p{orphans:3;widows:3}</style></head><body><div class="cover"><h1>Dee’s Crochet Studio</h1><h2>User Experience & Personalization</h2><p>Version 2.6.0 user guide</p><p>Charts · Guided crochet · Written patterns · Local backups</p><p>Free, local and offline-capable. Keep external backups.</p></div><section><h1>Contents</h1><ol>' +
      chapters
        .map(([id, title]) => '<li><a href="#chapter-' + id + '">' + escape(title) + '</a></li>')
        .join('') +
      '</ol></section>' +
      guidePages +
      '</body></html>';
    fs.writeFileSync(path.join(__dirname, '../docs/user-guide.html'), html);
    const frame = await call('Page.getFrameTree');
    await call('Page.setDocumentContent', { frameId: frame.result.frameTree.frame.id, html });
    await evaluate('Promise.all([...document.images].map(image=>image.decode()))');
    const printed = await call('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font:9px Arial;width:100%;padding:0 16mm;color:#756781">Dee’s Crochet Studio 2.6.0 · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      generateDocumentOutline: true
    });
    if (printed.error) throw Error(JSON.stringify(printed.error));
    fs.writeFileSync(
      path.join(__dirname, '../Dorette-Crochet-Studio-User-Guide.pdf'),
      Buffer.from(printed.result.data, 'base64')
    );
    console.log(
      'Generated current guide from ' +
        Object.keys(screenshots).length +
        ' actual interface captures'
    );
    ws.close();
  } finally {
    edge.kill();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
