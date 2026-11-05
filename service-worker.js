const CACHE = 'dorette-crochet-v2.1.0-unified';
const FILES = ['./updates.js','./release-config.js','./stitch-studio.css','./stitch-library.js','./stitch-match.js','./stitch-studio.js','./','./index.html','./styles.css?v=1.8.1-chart-first','./app.js?v=1.8.1','./pattern-tools.js?v=1.8.1','./advanced.js?v=1.8.1','./next-features.js?v=1.8.1','./pdf-export.js?v=1.8.1','./help.js?v=1.8.1','./reliability.js?v=1.8.1','./pdf-worker.js?v=1.8.1','./image-worker.js?v=1.8.1','./studio-ops.js?v=1.8.1','./Dorette-Crochet-Studio-User-Guide.pdf','./manifest.webmanifest','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(file => new Request(file, { cache: 'reload' })))));
});
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

self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
