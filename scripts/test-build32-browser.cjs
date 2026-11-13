const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.STUDIO_TEST_OUTPUT||'build32-evidence');
fs.mkdirSync(out,{recursive:true});
const mime={'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
 if(url.pathname==='/app.js'){
  res.end(fs.readFileSync(file,'utf8').replace(/^initialize\(\)\.catch/m,'window.editorProbe = source => eval(source);\ninitialize().catch'));return;
 }
 fs.createReadStream(file).pipe(res);
});

async function exercise(executable,name,origin){
 const browser=await chromium.launch({executablePath:executable,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1366,height:900},hasTouch:true,acceptDownloads:true,serviceWorkers:'block'});
  const external=[],errors=[];
  await context.route('**/*',route=>{
   if(!route.request().url().startsWith(origin+'/')){external.push(route.request().url());return route.abort();}
   return route.continue();
  });
  await context.addInitScript(()=>{
   const original=Worker.prototype.postMessage;
   window.conversionEvidence=null;
   Worker.prototype.postMessage=function(message,...rest){
    if(message.kind==='convert'){
     const input=message.pixels.slice();
     this.addEventListener('message',e=>{
      if(e.data?.type==='done')window.conversionEvidence={input,result:e.data.result};
     });
    }
    return original.call(this,message,...rest);
   };
  });
  const page=await context.newPage(),cdp=await context.newCDPSession(page);
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',d=>d.accept());
  await page.goto(origin);
  const probe=source=>page.evaluate(source=>editorProbe(source),source);
  const loc=id=>page.locator('#'+id);
  const click=id=>loc(id).evaluate(el=>el.click());
  const ready=()=>page.waitForFunction(()=>window.editorProbe&&editorProbe('!!active'));
  const reveal=()=>probe('revealSettingsSection($("imageFile").closest("[data-settings-key]"))');
  const field=(id,value,event='change')=>loc(id).evaluate((el,[value,event])=>{el.value=value;el.dispatchEvent(new Event(event,{bubbles:true}));},[value,event]);
  const wait=source=>page.waitForFunction(source=>editorProbe(source),source);
  const saved=()=>probe('JSON.stringify([active.id,active.cols,active.rows,active.cells,active.palette,active.done,active.rowDone])');
  const screenshot=async(id,description)=>{
   await reveal();await loc(id).screenshot({path:path.join(out,name+'-'+description+'.png')});
  };
  await ready();
  const baselineId=await probe('active.id');
  await field('newName','Synthetic portrait framing');await field('newCols','80');await field('newRows','110');
  await loc('newProjectForm').evaluate(form=>form.requestSubmit());await wait('active.cols===80&&active.rows===110');
  const data=await page.evaluate(()=>{
   const c=document.createElement('canvas');c.width=960;c.height=480;
   const g=c.getContext('2d');g.fillStyle='#b9a9c3';g.fillRect(0,0,960,480);
   g.fillStyle='#d29185';g.fillRect(0,0,110,480);g.fillStyle='#557e9b';g.fillRect(850,0,110,480);
   g.fillStyle='#2b2731';g.beginPath();g.arc(480,221,159,0,Math.PI*2);g.fill();
   g.fillStyle='#ffe0ba';g.beginPath();g.arc(480,235,127,0,Math.PI*2);g.fill();
   g.fillStyle='#26202a';g.beginPath();g.arc(431,223,14,0,Math.PI*2);g.arc(528,223,14,0,Math.PI*2);g.fill();
   g.strokeStyle='#864536';g.lineWidth=12;g.beginPath();g.arc(479,244,54,.25,Math.PI-.25);g.stroke();
   g.font='bold 38px sans-serif';g.fillText('EDGE TEXT',19,65);
   return c.toDataURL().split(',')[1];
  });
  const fixture={name:'synthetic-framing.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')};
  await loc('imageFile').setInputFiles(fixture);await wait('!!referenceImg&&referenceSrc===active.referenceImage');
  await reveal();await field('conversionMode','grayscale');await field('grayCount','12');
  assert.match(await loc('cropStats').textContent(),/80 × 110.*70 rows, 0 columns/);
  const full=await probe('currentCrop()'),unchanged=await saved(),projectId=await probe('active.id');
  if(name==='Edge')await screenshot('photoCropPanel','01-wide-before');
  await click('cropToFill');
  assert.deepEqual(await probe('currentCrop()'),full);
  assert.equal(await loc('cropFillReview').isVisible(),true);
  if(name==='Edge')await screenshot('photoCropPanel','02-proposed-crop');
  await click('cancelCropFill');assert.deepEqual(await probe('currentCrop()'),full);
  await field('imagePlacement','stretch');
  assert.match(await loc('cropStats').textContent(),/may stretch/);
  await click('cropToFill');await click('confirmCropFill');
  assert.equal(await probe('active.imagePlacement'),'contain');
  assert.match(await loc('cropStats').textContent(),/0 rows, 0 columns/);
  await click('undoPhotoCrop');assert.equal(await probe('active.imagePlacement'),'stretch');assert.deepEqual(await probe('currentCrop()'),full);
  await click('cropToFill');await click('confirmCropFill');
  const fill=await probe('currentCrop()');
  async function move(type,distance,corner=false,vertical=false){
   await loc('cropPreview').scrollIntoViewIfNeeded();
   const [x,y]=await probe(`(()=>{const e=$("cropPreview"),r=e.getBoundingClientRect(),g=cropPreviewRect,c=cropProposal?.crop||currentCrop();
    const x=${corner}?c.right:(c.left+c.right)/2,y=${corner}?c.bottom:(c.top+c.bottom)/2;
    return [r.left+(g.x+x*g.w)*r.width/e.width,r.top+(g.y+y*g.h)*r.height/e.height]})()`);
   const dx=vertical?0:distance,dy=vertical?distance:0;
   if(type==='touch'){
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   }else{
    await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,x,y,clickCount:1,pointerType:type});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:x+dx,y:y+dy,pointerType:type});
    await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',x:x+dx,y:y+dy,clickCount:1,pointerType:type});
   }
  }
  for(const type of ['mouse','touch','pen']){
   const prior=await probe('currentCrop()');await move(type,12);
   const next=await probe('currentCrop()');
   assert.ok(next.left>prior.left,type+' moved the crop');
   assert.ok(Math.abs((next.right-next.left)-(fill.right-fill.left))<1e-8);
  }
  await click('undoPhotoCrop');
  assert.deepEqual(await probe('currentCrop()'),full);
  const bounds=c=>[c.right-c.left,c.bottom-c.top];
  async function moveProposal(cols,rows,type,distance,vertical=false){
   const ratio=await probe('referenceImg.width/referenceImg.height');
   const before=await probe('cropProposal.crop'),[w,h]=bounds(before);
   await move(type,distance,false,vertical);
   assert.equal(await loc('cropFillReview').isVisible(),true,type+' keeps the proposal open');
   const after=await probe('cropProposal.crop'),[newW,newH]=bounds(after);
   assert.ok(vertical?after.top>before.top:after.left>before.left,type+' moved the proposal');
   assert.ok(Math.abs(w-newW)<1e-8&&Math.abs(h-newH)<1e-8);
   assert.ok(Math.abs(newW*ratio/newH-cols/rows)<1e-8);
   assert.ok(after.left>=0&&after.top>=0&&after.right<=1&&after.bottom<=1);
   assert.equal(Number(await loc('cropLeft').inputValue()),Math.round(after.left*100));
   return after;
  }
  await click('cropToFill');
  for(const type of ['mouse','touch','pen']){
   await moveProposal(80,110,type,10);
   assert.deepEqual(await probe('currentCrop()'),full);
  }
  if(name==='Edge')await screenshot('photoCropPanel','07-moved-unconfirmed-crop');
  await click('cancelCropFill');
  assert.deepEqual(await probe('currentCrop()'),full);
  assert.equal(await loc('cropLeft').inputValue(),'0');
  await click('cropToFill');
  const beforeResize=await probe('cropProposal.crop');
  await move('mouse',-10,true);
  const resized=await probe('cropProposal.crop');
  assert.ok(resized.right<beforeResize.right&&resized.left===beforeResize.left);
  await field('cropLeft','36','input');
  assert.equal(await probe('cropProposal.crop.left'),.36);
  assert.deepEqual(await probe('currentCrop()'),full);
  await click('resetCrop');assert.equal(await probe('cropProposal'),null);
  await click('cropToFill');
  const moved=await moveProposal(80,110,'mouse',16);
  await click('confirmCropFill');
  assert.deepEqual(await probe('currentCrop()'),moved);
  await click('undoPhotoCrop');assert.deepEqual(await probe('currentCrop()'),full);
  await click('cropToFill');await move('mouse',16);await click('confirmCropFill');
  assert.deepEqual(await probe('currentCrop()'),moved);
  assert.equal(await saved(),unchanged);
  async function preview(cols,rows){
   await click('convertPhoto');await wait(`pendingConversion?.cols===${cols}&&pendingConversion?.rows===${rows}`);
   assert.equal(await loc('photoStitchPair').isVisible(),true);
   assert.equal(await probe(`(()=>{
    const proof=window.conversionEvidence,p=pendingConversion,photo=$('framedPhoto'),chart=$('pairedStitches');
    const rgb=photo.getContext('2d').getImageData(0,0,photo.width,photo.height).data;
    const pixels=chart.getContext('2d').getImageData(0,0,chart.width,chart.height).data;
    return p.cells.length===${cols*rows}&&rgb.length===proof.input.length&&rgb.every((v,i)=>v===proof.input[i])&&
      p.cells.every((c,i)=>{
        const off=((Math.floor(i/p.cols)*4+2)*chart.width+(i%p.cols)*4+2)*4;
        const hex='#'+[pixels[off],pixels[off+1],pixels[off+2]].map(n=>n.toString(16).padStart(2,'0')).join('');
        return c===proof.result.cells[i]&&hex===p.palette[c].hex.toLowerCase();
      });
   })()`),true);
  }
  await preview(80,110);
  if(name==='Edge')await screenshot('conversionPreview','03-80x110-pair');
  await field('previewDimensions','large');
  assert.deepEqual(await probe('currentCrop()'),moved);
  assert.match(await loc('cropStats').textContent(),/120 × 165/);
  await wait('!pendingConversion');
  await click('resetCrop');await click('cropToFill');
  const largeCrop=await moveProposal(120,165,'pen',18);
  await click('confirmCropFill');assert.deepEqual(await probe('currentCrop()'),largeCrop);
  await preview(120,165);
  if(name==='Edge')await screenshot('conversionPreview','04-120x165-pair');
  for(const [width,height] of [[820,1080],[390,844]]){
   await page.setViewportSize({width,height});await reveal();
   assert.equal(await loc('conversionPreview').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
   assert.equal(await loc('photoStitchPair').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),width===390?1:2);
   if(name==='Edge')await screenshot('conversionPreview',width===390?'06-phone-pair':'05-tablet-pair');
  }
  await page.setViewportSize({width:1366,height:900});
  await click('cancelConversion');assert.equal(await saved(),unchanged);
  await field('previewDimensions','current');

  for(const change of [
   ()=>field('cropLeft','25','input'),()=>field('grayCount','8'),()=>field('conversionMode','auto'),
   ()=>field('previewDimensions','large'),()=>loc('imageFile').setInputFiles({...fixture,name:'replacement.png'}),
   ()=>probe(`selectProject(${JSON.stringify(baselineId)})`)
  ]){
   let release,started;
   const held=new Promise(ok=>{started=ok;});
   const delayed=route=>new Promise(ok=>{release=async()=>{try{await route.continue();}catch{}ok();};started();});
   await page.route('**/image-worker.js?*',delayed);
   await click('convertPhoto');await held;
   await change();await release();
   await wait('!runningImageJob&&!pendingConversion');
   assert.equal(await loc('conversionPreview').isVisible(),false);
   await page.unroute('**/image-worker.js?*',delayed);
  }
  await probe(`selectProject(${JSON.stringify(projectId)})`);await wait('!!referenceImg');
  await field('conversionMode','grayscale');await field('grayCount','12');await field('previewDimensions','large');
  await preview(120,165);
  const result=await probe('JSON.stringify([pendingConversion.cells,pendingConversion.palette])');
  assert.match(await loc('conversionPreviewHelp').textContent(),/changes its dimensions/);
  await click('applyConversion');await wait('!pendingConversion&&active.cols===120&&active.rows===165');
  assert.equal(await probe('JSON.stringify([active.cells,active.palette])'),result);
  await click('previewExport');
  assert.match(await loc('exportPreviewReport').textContent(),/100\/100/);
  await click('closeExportPreview');
  await probe('(async()=>{await flushSave();await writeChain})()');
  await page.reload();await ready();
  assert.equal(await probe('JSON.stringify([active.cells,active.palette])'),result);
  await click('duplicateProject');await wait('active.name.endsWith(" copy")');
  assert.equal(await probe('JSON.stringify([active.cells,active.palette])'),result);
  await click('patternLock');assert.equal(await probe('isPatternLocked()'),true);
  assert.equal(await probe(`JSON.stringify([projects.get(${JSON.stringify(projectId)}).cells,projects.get(${JSON.stringify(projectId)}).palette])`),result);
  const tall=await page.evaluate(async data=>{
   const source=new Image();source.src='data:image/png;base64,'+data;await source.decode();
   const canvas=document.createElement('canvas');canvas.width=480;canvas.height=960;
   const g=canvas.getContext('2d');g.translate(480,0);g.rotate(Math.PI/2);g.drawImage(source,0,0);
   return canvas.toDataURL().split(',')[1];
  },data);
  await field('newName','Tall photo and 79x117 chart');
  await field('newCols','79');await field('newRows','117');
  await loc('newProjectForm').evaluate(form=>form.requestSubmit());
  await wait('active.cols===79&&active.rows===117');
  await loc('imageFile').setInputFiles({...fixture,name:'tall-framing.png',buffer:Buffer.from(tall,'base64')});
  await wait('referenceImg?.width===480&&referenceImg?.height===960');await reveal();
  await field('previewDimensions','current');
  await click('cropToFill');
  const tallCrop=await moveProposal(79,117,'touch',14,true);
  await click('confirmCropFill');assert.deepEqual(await probe('currentCrop()'),tallCrop);
  await preview(79,117);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  return {name,browser:browser.version(),inputAndStitchPixels:'matched at 80x110, 120x165 and 79x117',staleCases:6,pointers:['mouse','touch','pen'],viewports:[1366,820,390],externalRequests:external.length};
 }finally{await browser.close();}
}
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 try{
  const origin='http://127.0.0.1:'+server.address().port,results=[];
  for(const [name,path] of [['Edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],['Chrome','C:/Program Files/Google/Chrome/Application/chrome.exe']]){
   results.push(await exercise(path,name,origin));console.log('PASS '+name);
  }
  fs.writeFileSync(path.join(out,'Build 32 Browser Results.json'),JSON.stringify(results,null,2));
 }finally{server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
