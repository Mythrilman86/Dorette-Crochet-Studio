const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.STUDIO_TEST_OUTPUT||'publication-test-output/build31');
fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');
  if(url.pathname==='/app.js'){
    res.end(fs.readFileSync(file,'utf8').replace(/^initialize\(\)\.catch/m,'window.editorProbe = source => eval(source);\ninitialize().catch'));return;
  }
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const browser=await chromium.launch({executablePath:process.env.STUDIO_TEST_BROWSER,headless:true,args:['--disable-extensions']});
  const ctx=await browser.newContext({viewport:{width:1366,height:768},hasTouch:true,acceptDownloads:true});
  const page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const results={browser:await browser.version(),interface:[],conversions:[]};
  const probe=s=>page.evaluate(s=>window.editorProbe(s),s);
  const ready=()=>page.waitForFunction(()=>window.editorProbe&&window.editorProbe('!!active'));
  const loc=id=>page.locator('#'+id);
  const data=()=>probe('JSON.stringify([active.id,active.cells,active.palette,active.done,active.rowDone,active.referenceImage])');
  const useImage=async(name,dir='cartoon')=>{
    await loc('imageFile').setInputFiles(path.join(root,'tests/fixtures',dir,name));
    await page.waitForFunction(()=>window.editorProbe('!!referenceImg && referenceSrc === active.referenceImage'));
  };
  const render=async(preset='balanced',tone='color',colors='6')=>{
    await loc('cartoonPreset').selectOption(preset);
    await loc('cartoonTone').selectOption(tone);
    await loc('cartoonColors').selectOption(colors);
    const start=performance.now();
    await loc('cartoonPreview').tap();
    await page.waitForFunction(()=>!document.getElementById('cartoonApply').disabled);
    return {preset,tone,requested:Number(colors),ms:Math.round(performance.now()-start),summary:await loc('cartoonStatus').textContent()};
  };
  try{
    await page.goto('http://127.0.0.1:'+server.address().port);await ready();
    const summary=page.locator('#chartTools > summary');
    await loc('toolPaint').tap();
    const previous=await probe('JSON.stringify([editorTool,$("paintColor").value,active.cells])');
    const before=(await loc('chartViews').boundingBox()).y;
    await summary.focus();await page.keyboard.press('Enter');
    assert.equal(await loc('toolPaint').isVisible(),false);
    assert.ok((await loc('chartViews').boundingBox()).y<before);
    assert.equal(await probe('JSON.stringify([editorTool,$("paintColor").value,active.cells])'),previous);
    await page.reload();await ready();
    assert.equal(await loc('chartTools').evaluate(e=>e.open),false);
    await summary.tap();assert.equal(await loc('saveCheckpoint').isVisible(),true);
    await probe('if($("toggleProjects").dataset.hidden!=="1")$("toggleProjects").click()');
    const configure=loc('configurePersonalized');
    await configure.tap();assert.equal(await configure.getAttribute('aria-expanded'),'true');
    const dialog=loc('personalizedDialog');
    const check=dialog.locator('input').first(),checked=await check.isChecked();
    await check.setChecked(!checked);
    await dialog.getByRole('button',{name:'Close',exact:true}).tap();
    await page.waitForFunction(()=>document.activeElement.id==='configurePersonalized');
    await configure.tap();assert.equal(await check.isChecked(),!checked);
    await dialog.getByRole('button',{name:'Close Personalized Interface'}).tap();
    await page.waitForFunction(()=>document.activeElement.id==='configurePersonalized');
    await configure.tap();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    await configure.tap();await dialog.getByRole('button',{name:'Restore Advanced'}).tap();assert.equal(await loc('skillMode').inputValue(),'advanced');
    for(const [w,h] of [[360,740],[800,1000],[1366,768]]){
      await page.setViewportSize({width:w,height:h});
      await configure.tap();
      assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      await dialog.screenshot({path:path.join(out,'personalized-'+w+'.png')});
      await dialog.getByRole('button',{name:'Close',exact:true}).tap();
      results.interface.push({viewport:w,dialogFits:true});
    }
    await loc('openStitchStudio').tap();assert.equal(await loc('openStitchStudio').getAttribute('aria-expanded'),'true');
    await page.keyboard.press('Escape');await page.waitForFunction(()=>document.getElementById('openStitchStudio').getAttribute('aria-expanded')==='false');
    await loc('modeCrochet').tap();assert.equal(await loc('modeCrochet').getAttribute('aria-pressed'),'true');
    await loc('crochetView').tap();
    await loc('modeCreate').tap();assert.equal(await loc('modeCreate').getAttribute('aria-pressed'),'true');
    await probe('revealSettingsSection($("imageFile").closest("[data-settings-key]"))');
    const fixtures=['glasses.jpg','shadows.jpg','astronaut.png','star.png','busy-background.jpg','low-resolution.png'];
    for(const name of fixtures){
      const old=await probe('active.referenceImage');
      await useImage(name);
      await page.waitForFunction(old=>window.editorProbe('active.referenceImage')!==old,old);
      await loc('openCartoon').tap();
      const saved=await data(),chartImages=[];
      for(const preset of ['simple','balanced','detailed']){
        const metric=await render(preset);
        const preview=await page.locator('.cartoon-previews').screenshot({path:path.join(out,name+'-'+preset+'.png')});
        chartImages.push(await loc('cartoonChart').evaluate(e=>e.toDataURL()));
        results.conversions.push({fixture:name,...metric});
      }
      assert.equal(new Set(chartImages).size,3,name+' presets differ');
      assert.equal(await data(),saved);
      if(name==='glasses.jpg'){
        await loc('cartoonGrid').uncheck();
        results.conversions.push({fixture:name,...await render('balanced','gray','12')});
        await page.locator('.cartoon-previews').screenshot({path:path.join(out,'glasses-gray-12.png')});
        await loc('cartoonCompareGray').tap();
        await loc('cartoonDirectChart').waitFor({state:'visible'});
        await loc('cartoonDirectChart').screenshot({path:path.join(out,'glasses-direct-gray-12.png')});
        await loc('cartoonReset').tap();assert.equal(await loc('cartoonApply').isDisabled(),true);
      }
      await loc('cartoonCancel').tap();assert.equal(await data(),saved);
    }
    const attached=await data();
    await loc('imageFile').setInputFiles(path.join(root,'tests/fixtures/image-import/truncated.jpg'));
    await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('Image import failed'));
    assert.equal(await data(),attached);
    await loc('previewDimensions').selectOption('large');await loc('openCartoon').tap();
    const beforeApply=await data();
    const large=await render('balanced','gray','12');assert.match(large.summary,/120 × 165 stitches/);
    results.conversions.push({fixture:'low-resolution.png',...large});
    await loc('cartoonPreview').tap();await loc('cartoonCancel').tap();
    assert.equal(await data(),beforeApply);
    await loc('openCartoon').tap();await render();
    await page.setViewportSize({width:360,height:740});
    assert.ok(await loc('cartoonDialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
    await loc('cartoonDialog').screenshot({path:path.join(out,'cartoon-phone.png')});
    await page.setViewportSize({width:1366,height:768});
    page.once('dialog',d=>d.dismiss());await loc('cartoonApply').tap();
    assert.equal(await data(),beforeApply);await loc('cancelConversion').tap();
    await loc('openCartoon').tap();await render();
    page.once('dialog',d=>d.accept());await loc('cartoonApply').tap();
    const afterApply=await data();assert.notEqual(afterApply,beforeApply);
    await probe('undo()');assert.equal(await data(),beforeApply);
    await probe('redo()');assert.equal(await data(),afterApply);
    await probe('(async()=>{await flushSave();await writeChain})()');
    const download=page.waitForEvent('download');
    await probe('exportBackup()');
    const backup=path.join(out,'cartoon-roundtrip.zip');
    await (await download).saveAs(backup);
    page.once('dialog',d=>d.accept());
    await page.evaluate(bytes=>window.editorProbe('restoreBackup(new File([Uint8Array.from('+JSON.stringify(bytes)+')],"cartoon.zip"))'),Array.from(fs.readFileSync(backup)));
    const artwork=s=>JSON.stringify(JSON.parse(s).slice(1));
    assert.equal(artwork(await data()),artwork(afterApply));
    const restored=await data();
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await ctx.setOffline(true);await page.reload();await ready();assert.equal(await data(),restored);
    await probe('setStudioMode("create");revealSettingsSection($("imageFile").closest("[data-settings-key]"))');
    await loc('openCartoon').tap();results.offline=await render();
    await loc('cartoonCancel').tap();
    const mouse=await browser.newContext({viewport:{width:1366,height:768}});
    const screen=await mouse.newPage();await screen.goto(page.url());
    await screen.waitForFunction(()=>window.editorProbe&&window.editorProbe('!!active'));
    const control=screen.locator('#openStitchStudio');
    await control.scrollIntoViewIfNeeded();
    const normal=await control.evaluate(e=>getComputedStyle(e).boxShadow);
    await control.hover();
    assert.notEqual(await control.evaluate(e=>getComputedStyle(e).boxShadow),normal);
    await control.screenshot({path:path.join(out,'scanner-hover.png')});
    const box=await control.boundingBox();await screen.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await screen.mouse.down();assert.notEqual(await control.evaluate(e=>getComputedStyle(e).filter),'none');
    await control.screenshot({path:path.join(out,'scanner-pressed.png')});
    await screen.mouse.up();await screen.locator('#stitchStudio').waitFor();
    await screen.screenshot({path:path.join(out,'scanner-expanded.png')});
    await screen.keyboard.press('Escape');
    await screen.keyboard.press('Tab');await screen.keyboard.press('Shift+Tab');
    await control.focus();
    assert.equal(await control.evaluate(e=>e.matches(':focus-visible')),true);
    await control.screenshot({path:path.join(out,'scanner-keyboard-focus.png')});
    await mouse.close();
    assert.deepEqual(errors,[]);
    results.applyUndoRedoOffline=true;
    fs.writeFileSync(path.join(out,'build31-results.json'),JSON.stringify(results,null,2));
    console.log('PASS Build 31 interface, real photos, 3 presets, grayscale 12, actual grid, cancellation, apply confirmation, undo, redo, persistence and offline worker');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
