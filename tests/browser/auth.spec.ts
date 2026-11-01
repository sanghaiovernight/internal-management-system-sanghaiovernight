import {test,expect,chromium} from '@playwright/test'
const PIN='83917264'
const COOKIE='sanghai_pos_session'
async function login(page:import('@playwright/test').Page){const response=await page.request.post('/api/auth/login',{data:{pin:PIN}});expect(response.status()).toBe(200);return response}

test('private pages redirect to PIN login and private APIs reject absent and forged sessions',async({page})=>{
 const redirect=await page.request.get('/',{maxRedirects:0,headers:{'X-Forwarded-Host':'public-shop.example','X-Forwarded-Proto':'https'}})
 expect(redirect.status()).toBe(307);expect(redirect.headers().location).toBe('https://public-shop.example/login')
 await page.goto('/');await expect(page).toHaveURL(/\/login$/)
 await expect(page.getByRole('heading',{name:'Sanghai Overnight POS'})).toBeVisible()
 expect((await page.request.get('/api/auth/session')).status()).toBe(401)
 expect((await page.request.get('/api/private-probe')).status()).toBe(401)
 await page.context().addCookies([{name:COOKIE,value:'forged',url:'http://127.0.0.1:3000'}])
 await page.goto('/');await expect(page).toHaveURL(/\/login$/)
 expect((await page.request.get('/api/auth/session')).status()).toBe(401)
})
test('wrong PIN never sets session; correct login sets a 90-day HttpOnly cookie',async({page})=>{
 await page.goto('/login')
 await page.getByLabel('Mã PIN nội bộ').fill('00000000');await page.getByRole('button',{name:'Vào hệ thống'}).click()
 await expect(page.locator('form').getByRole('alert')).toHaveText('Mã PIN không đúng.')
 expect((await page.context().cookies()).find(cookie=>cookie.name===COOKIE)).toBeUndefined()
 const response=await login(page)
 expect(response.headers()['cache-control']).toBe('no-store')
 expect(response.headers()['set-cookie']).toContain('Max-Age=7776000')
 const cookie=(await page.context().cookies()).find(cookie=>cookie.name===COOKIE)!
 expect(cookie.httpOnly).toBe(true);expect(cookie.sameSite).toBe('Lax');expect(cookie.path).toBe('/')
 expect(cookie.expires-Date.now()/1000).toBeGreaterThan(89*24*60*60)
 expect(await page.evaluate(()=>document.cookie)).not.toContain(COOKIE)
 expect((await page.request.get('/api/auth/session')).status()).toBe(200)
})
test('login/logout reject cross-origin posts and malformed bodies',async({page})=>{
 expect((await page.request.post('/api/auth/login',{headers:{Origin:'https://untrusted.example'},data:{pin:PIN}})).status()).toBe(403)
 expect((await page.request.post('/api/auth/login',{data:Buffer.from('not-json'),headers:{'Content-Type':'application/json'}})).status()).toBe(400)
 await login(page)
 expect((await page.request.post('/api/auth/logout',{headers:{Origin:'https://untrusted.example'}})).status()).toBe(403)
 expect((await page.request.get('/api/auth/session')).status()).toBe(200)
 expect((await page.request.post('/api/auth/logout')).status()).toBe(200)
 expect((await page.request.get('/api/auth/session')).status()).toBe(401)
 await page.goto('/');await expect(page).toHaveURL(/\/login$/)
})
test('the login form opens POS and lock button clears private caches and closes other tabs',async({page})=>{
 await page.route('https://**/*',route=>route.fulfill({contentType:'application/json',body:'[]'}))
 await page.goto('/login');await page.getByLabel('Mã PIN nội bộ').fill(PIN);await page.getByRole('button',{name:'Vào hệ thống'}).click()
 await expect(page.getByRole('button',{name:'Khóa phiên',exact:true})).toBeVisible()
 const other=await page.context().newPage();await other.route('https://**/*',route=>route.fulfill({contentType:'application/json',body:'[]'}));await other.goto('/')
 await expect(other.getByRole('button',{name:'Khóa phiên',exact:true})).toBeVisible()
 await page.evaluate(()=>localStorage.setItem('pos-stock-imports:test','private receipt'))
 await page.getByRole('button',{name:'Khóa phiên',exact:true}).click()
 await expect(page).toHaveURL(/\/login$/);await expect(other).toHaveURL(/\/login$/)
 expect(await page.evaluate(()=>localStorage.getItem('pos-stock-imports:test'))).toBeNull()
 expect((await page.request.get('/api/auth/session')).status()).toBe(401)
 await page.goto('/');await expect(page).toHaveURL(/\/login$/)
})
test('manifest, crisp PNG icons and mobile webapp metadata are public before login',async({page})=>{
 const response=await page.request.get('/manifest.webmanifest');expect(response.status()).toBe(200)
 const manifest=await response.json()
 const alias=await page.request.get('/manifest.json');expect(alias.status()).toBe(200);expect(await alias.json()).toEqual(manifest)
 for(const asset of ['/sw.js','/apple-touch-icon.png','/placeholder.jpg','/placeholder.svg','/icon.svg','/icon-light-32x32.png','/apple-icon.png']){
  const resource=await page.request.get(asset,{maxRedirects:0});expect(resource.status(),asset).toBe(200);expect(resource.headers().location).toBeUndefined()
 }
 expect(manifest.icons).toEqual([{src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}])
 expect(manifest).toMatchObject({name:'Sanghai Overnight POS',short_name:'Sanghai POS',start_url:'/',scope:'/',display:'standalone',display_override:['standalone','fullscreen'],background_color:'#faf7f2',theme_color:'#d97706'})
 for(const size of [192,512]){const icon=await page.request.get(`/icon-${size}.png`);expect(icon.status()).toBe(200);expect(icon.headers()['content-type']).toContain('image/png');const png=await icon.body();expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(png.readUInt32BE(16)).toBe(size);expect(png.readUInt32BE(20)).toBe(size)}
 await page.goto('/login')
 await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href','/manifest.webmanifest')
 await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content','yes')
 await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content','Sanghai POS')
 await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content',/width=device-width.*initial-scale=1.*maximum-scale=1.*user-scalable=no/)
 await page.setViewportSize({width:393,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await page.evaluate(()=>navigator.serviceWorker.ready)
 const cdp=await page.context().newCDPSession(page)
 const installability=await cdp.send('Page.getInstallabilityErrors')
 // Chrome intentionally disables installation in the incognito test context.
 expect(installability.installabilityErrors.filter(error=>error.errorId!=='in-incognito')).toEqual([])
})
test('network-only worker removes old shell caches and passes protected requests through authentication',async({page})=>{
 await page.goto('/manifest.webmanifest')
 await page.evaluate(async()=>{const cache=await caches.open('sanghai-pos-shell-v1');await cache.put('/old-cached-page',new Response('old shell'))})
 await page.goto('/login')
 await page.evaluate(()=>navigator.serviceWorker.ready)
 await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true)
 expect(await page.evaluate(async()=> (await caches.keys()).filter(key=>key.startsWith('sanghai-pos-shell-')))).toEqual([])
 expect(await page.evaluate(async()=> (await fetch('/api/auth/session')).status)).toBe(401)
 await page.goto('/');await expect(page).toHaveURL(/\/login$/)
 expect(await page.evaluate(async()=> (await caches.keys()).filter(key=>key.startsWith('sanghai-pos-shell-')))).toEqual([])
})

test('login and logout accept trusted forwarded HTTPS host while rejecting cross-site requests',async({page})=>{
 const headers={Origin:'https://pos.shop.example','X-Forwarded-Host':'pos.shop.example','X-Forwarded-Proto':'https'}
 const response=await page.request.post('/api/auth/login',{headers,data:{pin:PIN}})
 expect(response.status()).toBe(200)
 expect((await page.request.get('/api/auth/session')).status()).toBe(200)
 expect((await page.request.post('/api/auth/logout',{headers:{...headers,'Sec-Fetch-Site':'cross-site'}})).status()).toBe(403)
 expect((await page.request.post('/api/auth/logout',{headers})).status()).toBe(200)
 expect((await page.request.get('/api/auth/session')).status()).toBe(401)
})


test('normal Chrome profile accepts the standalone manifest without installability errors',async({baseURL})=>{
 const context=await chromium.launchPersistentContext(test.info().outputPath('normal-chrome-profile'),{headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']})
 try{
  const page=await context.newPage();await page.goto(`${baseURL}/login`)
  await page.evaluate(()=>navigator.serviceWorker.ready)
  const cdp=await context.newCDPSession(page)
  const manifest=await cdp.send('Page.getAppManifest')
  expect(manifest.url).toBe(`${baseURL}/manifest.webmanifest`)
  expect(manifest.errors).toEqual([])
  expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([])
 }finally{await context.close()}
})
