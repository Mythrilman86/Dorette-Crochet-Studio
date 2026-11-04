const CACHE = 'dorette-crochet-v1.7.2';
const FILES = ['./','./index.html','./styles.css?v=1.7.2','./app.js?v=1.7.2','./pattern-tools.js?v=1.7.2','./advanced.js?v=1.7.2','./next-features.js?v=1.7.2','./pdf-export.js?v=1.7.2','./help.js?v=1.7.2','./reliability.js?v=1.7.2','./pdf-worker.js?v=1.7.2','./Dorette-Crochet-Studio-User-Guide.pdf','./manifest.webmanifest','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
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
