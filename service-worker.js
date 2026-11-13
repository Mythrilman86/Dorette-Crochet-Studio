importScripts('./assets/pdfjs/offline-files.js');
const CACHE = 'dorette-crochet-v2.7.1-stage-a-b34-e86b40c027269daeec2d';
const FILES = ['./release-notes.html','./cartoon.js','./cartoon-worker.js','./control-feedback.css','./assets/image-formats.mjs','./assets/image-import.mjs','./assets/image-import-worker.mjs','./assets/publisher/contrast.mjs',"./pattern-publish.html","./assets/publisher/layout.mjs","./assets/publisher/images.mjs","./assets/publisher/ui.mjs","./assets/publisher/worker.js","./assets/publisher/publish.css","./assets/publisher/vendor/pdfmake.min.js","./assets/publisher/fonts/vfs_fonts.js","./assets/publisher/fonts/coverage.json",'./assets/creator/polish.mjs','./assets/creator/optimize.mjs','./assets/creator/optimize-worker.mjs','./pattern-creator.html','./pattern-creator.css','./assets/creator/model.mjs','./assets/creator/store.mjs','./assets/creator/backup.mjs','./assets/creator/ui.mjs','./diagnostics.js','./experience.js','./assets/header-icon.png',...self.writtenPdfFiles,'./written-pattern.html','./written-pattern.css','./assets/written-pattern.mjs','./assets/written-backup.mjs','./updates.js','./release-config.js','./stitch-studio.css','./stitch-library.js','./stitch-match.js','./stitch-studio.js','./','./index.html','./styles.css?v=1.8.1-chart-first','./app.js?v=1.8.1','./pattern-tools.js?v=1.8.1','./advanced.js?v=1.8.1','./next-features.js?v=1.8.1','./pdf-export.js?v=1.8.1','./help.js?v=1.8.1','./reliability.js?v=1.8.1','./pdf-worker.js?v=1.8.1','./image-worker.js?v=1.8.1','./studio-ops.js?v=1.8.1','./Dorette-Crochet-Studio-User-Guide.pdf','./manifest.webmanifest','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png'];
async function installOfflineFiles(){
  // Origin-wide lock: scopes can share CacheStorage. Never claim a live legacy cache.
  if(!self.navigator?.locks)throw Error('Offline installation requires safe cache locking');
  return self.navigator.locks.request('studio-cache:'+CACHE,async()=>{
  const ownerURL=new URL('./__studio_cache_owner__',self.registration.scope).href;
  const token=crypto.randomUUID(),started=Date.now();let completed=0,stage='claim';
  let cache,owned=false,readOnly=false;
  async function owner(){try{return await (await cache.match(ownerURL))?.json();}catch{return null;}}
  function ours(record){return record?.protocol===1&&record.scope===self.registration.scope&&typeof record.token==='string'&&/^[a-f0-9-]{36}$/.test(record.token);}
  async function mark(state){await cache.put(ownerURL,new Response(JSON.stringify({protocol:1,scope:self.registration.scope,token,state}),{headers:{'Content-Type':'application/json'}}));}
  async function diagnostic(state,category='none'){
    // Only fixed categories and bounded counters leave the worker; no URLs or error text.
    try{for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))if(client.url?.startsWith(self.registration.scope))client.postMessage({type:'STUDIO_OFFLINE_DIAGNOSTIC',state,stage,category,elapsed:Math.min(600,Math.floor((Date.now()-started)/1000)),completed,total:FILES.length});}catch{}
  }
  try{
    cache=await caches.open(CACHE);
    const existing=await cache.keys(),previous=await owner();
    if(existing.length){
      if(!ours(previous)||!['partial','complete'].includes(previous.state))throw Error('CACHE_OWNERSHIP');
      if(previous.state==='complete')readOnly=true;
      // A complete install never retains a partial marker. The lock excludes live attempts.
      else{await caches.delete(CACHE);cache=await caches.open(CACHE);}
    }
    if(!readOnly){await mark('partial');owned=true;}stage='download';await diagnostic('started');
  async function store(file){
    for(let attempt=0;attempt<3;attempt++){
      try{
        const request=new Request(file,{cache:'reload'});
        const response=await fetch(request);
        if(!response.ok)throw Error('HTTP '+response.status);
        if(readOnly){
          const prior=await cache.match(request);
          if(!prior)throw Error('CACHE_CONTENT_MISMATCH');
          const [a,b]=await Promise.all([prior.arrayBuffer(),response.arrayBuffer()]);
          const bytes=new Uint8Array(a),expected=new Uint8Array(b);
          if(bytes.length!==expected.length||!bytes.every((value,index)=>value===expected[index]))throw Error('CACHE_CONTENT_MISMATCH');
        }else await cache.put(request,response);
        completed++;
        return;
      }catch(error){
        if(error.message==='CACHE_CONTENT_MISMATCH')throw error;
        if(attempt===2)throw Error(error.message==='CACHE_CONTENT_MISMATCH'?'CACHE_CONTENT_MISMATCH':error.message.startsWith('HTTP ')?'NETWORK':error.name==='QuotaExceededError'?'QUOTA':'FETCH_OR_WRITE');
        await new Promise(resolve=>setTimeout(resolve,250*2**attempt));
      }
    }
  }
    for(let i=0;i<FILES.length;i+=6){
      const results=await Promise.allSettled(FILES.slice(i,i+6).map(store));
      const failed=results.find(result=>result.status==='rejected');
      if(failed)throw failed.reason;
    }
    stage='verify';
    const urls=new Set((await cache.keys()).map(request=>request.url));
    if(!FILES.every(file=>urls.has(new URL(file,self.registration.scope).href)))throw Error('INCOMPLETE');
    if(!readOnly)await mark('complete');stage='complete';await diagnostic('complete');
  }catch(error){
    if(owned){const record=await owner();if(ours(record)&&record.token===token&&record.state==='partial')await caches.delete(CACHE);}
    await diagnostic('failed',['CACHE_OWNERSHIP','CACHE_CONTENT_MISMATCH','NETWORK','QUOTA','FETCH_OR_WRITE','INCOMPLETE'].includes(error.message)?error.message:'STORAGE');
    console.error('Offline installation failed');
    throw error;
  }
  });
}
self.addEventListener('install',event=>event.waitUntil(installOfflineFiles()));
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('dorette-crochet-') && k !== CACHE).map(k => caches.delete(k)))), self.clients.claim()]));
});
self.addEventListener('fetch', event => {
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  // Serve a consistent release while a newer service worker waits for approval.
  const url=new URL(event.request.url);
  const scope=new URL(self.registration.scope);
  const relative='./'+url.pathname.slice(scope.pathname.length)+url.search;
  const shellNavigation=event.request.mode==='navigate'&&
    (url.pathname===scope.pathname||url.pathname===scope.pathname+'index.html');
  if(!shellNavigation&&!FILES.includes(relative))return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    const cached=await cache.match(shellNavigation?'./index.html':event.request);
    return cached||fetch(event.request);
  }));
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
  if(event.data?.type==='CHECK_OFFLINE'&&event.ports[0]){
    event.waitUntil((async()=>{
      const cache=await caches.open(CACHE);
      const urls=new Set((await cache.keys()).map(request=>request.url));
      const ready=FILES.every(file=>urls.has(new URL(file,self.registration.scope).href));
      event.ports[0].postMessage({ready});
    })().catch(()=>event.ports[0].postMessage({ready:false})));
  }
});
