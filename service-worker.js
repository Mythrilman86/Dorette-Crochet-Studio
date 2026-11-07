importScripts('./assets/pdfjs/offline-files.js');
const CACHE = 'dorette-crochet-v2.6.0-development';
const FILES = ['./diagnostics.js','./experience.js','./assets/header-icon.png',...self.writtenPdfFiles,'./written-pattern.html','./written-pattern.css','./assets/written-pattern.mjs','./assets/written-backup.mjs','./updates.js','./release-config.js','./stitch-studio.css','./stitch-library.js','./stitch-match.js','./stitch-studio.js','./','./index.html','./styles.css?v=1.8.1-chart-first','./app.js?v=1.8.1','./pattern-tools.js?v=1.8.1','./advanced.js?v=1.8.1','./next-features.js?v=1.8.1','./pdf-export.js?v=1.8.1','./help.js?v=1.8.1','./reliability.js?v=1.8.1','./pdf-worker.js?v=1.8.1','./image-worker.js?v=1.8.1','./studio-ops.js?v=1.8.1','./Dorette-Crochet-Studio-User-Guide.pdf','./manifest.webmanifest','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png'];
async function installOfflineFiles(){
  const cache=await caches.open(CACHE);
  async function store(file){
    for(let attempt=0;attempt<3;attempt++){
      try{
        const request=new Request(file,{cache:'reload'});
        const response=await fetch(request);
        if(!response.ok)throw Error('HTTP '+response.status);
        await cache.put(request,response);
        return;
      }catch(error){
        if(attempt===2)throw Error('Offline setup failed for '+file+': '+error.message);
        await new Promise(resolve=>setTimeout(resolve,250*2**attempt));
      }
    }
  }
  try{
    for(let i=0;i<FILES.length;i+=6){
      const results=await Promise.allSettled(FILES.slice(i,i+6).map(store));
      const failed=results.find(result=>result.status==='rejected');
      if(failed)throw failed.reason;
    }
  }catch(error){
    await caches.delete(CACHE);
    console.error(error.message);
    throw error;
  }
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
