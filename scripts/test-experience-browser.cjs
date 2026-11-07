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

    for (let i = 0; i < 50; i++) {
      if (await evaluate("!!window.editorProbe?.('active')").catch(() => false)) break;
      await delay(100);
    }
    const baseline = await evaluate("window.editorProbe('JSON.stringify(active)')");
    for (const width of [360, 640, 800, 1024, 1440]) {
      await call('Emulation.setDeviceMetricsOverride', {
        width,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false
      });
      await evaluate("document.querySelector('#dualChart').click()");
      const boxes = await evaluate(`(()=>{
        const r=id=>document.getElementById(id).getBoundingClientRect();
        const a=r('overviewCanvas'),b=r('chartCanvas'),p=document.querySelector('#yarnLibraryPanel');
        p.classList.add('settings-revealed');p.style.width='240px';p.style.maxWidth='100%';
        const y=r('yarnLibraryPanel'),button=r('useLibraryYarn');
        return {delta:Math.abs(a.top-b.top),overflow:button.right>y.right+1,checkbox:r('spotlightMode').width};
      })()`);
      if (width > 650) assert.ok(boxes.delta < 2, JSON.stringify(boxes));
      assert.equal(boxes.overflow, false);
      assert.equal(boxes.checkbox, 20);
    await evaluate("document.documentElement.style.fontSize='200%'");
    await delay(100);
    if(width>650)assert.ok(await evaluate("Math.abs(document.querySelector('#overviewCanvas').getBoundingClientRect().top-document.querySelector('#chartCanvas').getBoundingClientRect().top)<2"),'enlarged-text canvas alignment');
    await evaluate("document.documentElement.style.fontSize=''");

    }
    await evaluate(`(()=>{
      document.querySelector('#crochetView').click();
      const b=document.querySelector('#phoneCrochetControls');
      if(b.getAttribute('aria-expanded')==='true')b.click();
    })()`);
    assert.equal(
      await evaluate(
        "getComputedStyle(document.querySelector('#crochetProgressControls')).display"
      ),
      'none'
    );
    assert.equal(
      await evaluate(
        "getComputedStyle(document.querySelector('.crochet-compact-actions')).display"
      ),
      'flex'
    );
    await evaluate(
      "window.editorProbe('view.scale=1.7;view.x=-300;view.y=-200;selected={col:7,row:8};requestDraw()')"
    );
    await delay(80);
    await evaluate("document.querySelector('#compactCenter').click()");
    assert.equal(await evaluate("window.editorProbe('view.scale')"), 1.7);
    assert.equal(await evaluate("window.editorProbe('selected.col')"), 7);
    assert.equal(await evaluate("window.editorProbe('JSON.stringify(active)')"), baseline);
    await evaluate(`(()=>{
      const b=document.querySelector('#phoneCrochetControls');b.click();
      document.querySelector('.show-yarn-letters').click();
      window.editorProbe("active.converted=true;v16Prefs.symbols=true;view.scale=2");
      window.recordedText=[];
      const original=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.recordedText.push(text);return original.call(this,text,...args);};
      window.editorProbe('requestDraw()');
    })()`);
    await delay(150);
    assert.equal(await evaluate("window.editorProbe('v16Prefs.showYarnLetters')"), false);
    assert.equal(await evaluate("window.recordedText.includes('A')"), false);
    const transferred = await evaluate("window.editorProbe('exportWorkspacePreferences()')");
    assert.equal(transferred.display.showYarnLetters, false);
    await evaluate(
      "document.querySelector('#crochetView').click();document.querySelector('#aboutStudio').click()"
    );
    assert.equal(await evaluate("document.querySelector('#aboutStudioDialog').open"), true);
    await evaluate(
      "document.querySelector('#aboutStudioDialog').close();document.querySelector('#skillMode').value='personalized';document.querySelector('#skillMode').dispatchEvent(new Event('change'));document.querySelector('#configurePersonalized').click()"
    );
    await evaluate("document.querySelector('#personalizedDialog input[data-section]').click()");
    assert.equal(await evaluate("document.querySelectorAll('.personalized-hidden').length"), 1);

    const beforeHidingTool=await evaluate("window.editorProbe('JSON.stringify(active)')");
    await evaluate("document.querySelector('#toolPaint').click();if(document.querySelector('#toolPaint').getAttribute('aria-pressed')!=='true')throw Error('Painting was not active');document.querySelector('#personalizedDialog input[data-tool=painting]').click()");
    assert.equal(await evaluate("document.querySelector('#toolSelect').getAttribute('aria-pressed')"),'true');
    assert.equal(await evaluate("window.editorProbe('JSON.stringify(active)')"),beforeHidingTool);
    await evaluate("document.querySelector('#personalizedDialog').close()");
    const hidden = await evaluate(
      "document.querySelector('.personalized-hidden').dataset.settingsKey"
    );
    await evaluate(
      'window.editorProbe(' +
        JSON.stringify(
          'revealSettingsSection(settingsSections.get(' + JSON.stringify(hidden) + '))'
        ) +
        ')'
    );
    assert.notEqual(
      await evaluate("getComputedStyle(document.querySelector('.personalized-hidden')).display"),
      'none'
    );
    await evaluate(
      "document.querySelector('#openCommandSearch').click();const q=document.querySelector('#commandQuery');q.value='Paint stitches';q.dispatchEvent(new Event('input'))"
    );
    await evaluate(
      "[...document.querySelectorAll('.command-result')].find(b=>b.querySelector('strong').textContent==='Paint stitches').click()"
    );
    assert.equal(
      await evaluate(
        "document.querySelector('#toolPaint').classList.contains('settings-highlight')"
      ),
      true
    );
    await delay(1500);
    assert.equal(
      await evaluate(
        "document.querySelector('#toolPaint').classList.contains('settings-highlight')"
      ),
      true
    );
    await evaluate(
      "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"
    );
    assert.equal(
      await evaluate(
        "document.querySelector('#toolPaint').classList.contains('settings-highlight')"
      ),
      false
    );
    await evaluate(
      "document.querySelector('#sectionSort').value='az';document.querySelector('#sectionSort').dispatchEvent(new Event('change'))"
    );
    const labels = await evaluate(
      "[...document.querySelector('#jumpSettings').children].map(b=>b.textContent)"
    );
    assert.deepEqual(
      labels,
      labels.slice().sort((a, b) => a.localeCompare(b))
    );
    await evaluate(
      "document.querySelector('#skillMode').value='advanced';document.querySelector('#skillMode').dispatchEvent(new Event('change'))"
    );
    await evaluate(
      "window.editorProbe('v16DrawTexture()');document.querySelector('#textureSimulated').click()"
    );
    assert.equal(await evaluate("document.querySelector('#crochetImageViewer').open"), true);
    await evaluate(
      "document.querySelector('#crochetImageViewer').close();document.querySelector('#presetMotif').nextElementSibling.click()"
    );
    assert.equal(await evaluate("window.editorProbe('!!motifPreview')"), true);
    await evaluate("window.editorProbe('applyMotifLayer()')");
    assert.equal(await evaluate("window.editorProbe('active.layers.at(-1).type')"), 'motif');
    console.log(
      'PASS responsive controls, Crochet View collapse and Center, yarn visibility and backup, personalization, About, preview and original motif layer'
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
