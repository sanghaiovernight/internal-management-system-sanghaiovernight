// Minimal network-only worker: never persist authenticated pages or POS data.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()))
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('sanghai-pos-shell-')).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))
})
self.addEventListener('fetch',event=>{
 if(new URL(event.request.url).origin!==self.location.origin)return
 event.respondWith(fetch(event.request,{cache:'no-store'}))
})
