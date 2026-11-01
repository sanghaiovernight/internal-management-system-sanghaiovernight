const CACHE='sanghai-pos-shell-v1'
const ASSETS=['/icons/pos-192.png','/icons/pos-512.png','/icons/apple-touch-icon.png','/icons/pos.svg']
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()))})
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('sanghai-pos-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))})
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url)
 if(url.origin!==self.location.origin)return
 if(event.request.mode==='navigate'){
  // Never cache authenticated pages, cookies, orders or API responses.
  event.respondWith(fetch(event.request,{cache:'no-store'}).catch(()=>new Response('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sanghai POS</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#faf7f2;color:#292524;font-family:Arial,sans-serif"><main style="max-width:320px;padding:24px"><h1 style="color:#d97706">Sanghai POS</h1><h2>Chưa có kết nối mạng</h2><p>Kết nối Internet rồi tải lại để mở phiên và đồng bộ dữ liệu cửa hàng.</p><button onclick="location.reload()" style="background:#d97706;color:white;border:0;border-radius:12px;padding:14px 24px;font-size:16px">Thử lại</button></main></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})))
 }else if(ASSETS.includes(url.pathname)&&event.request.method==='GET')event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)))
})
