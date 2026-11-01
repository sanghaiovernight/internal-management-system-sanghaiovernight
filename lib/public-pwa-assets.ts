export function publicPwaAsset(path:string){
 // Never let an API filename suffix bypass authentication.
 if(path.startsWith('/api/'))return false
 return path==='/manifest.json'||path==='/manifest.webmanifest'||path==='/sw.js'||path==='/favicon.ico'||/^\/(?:icon|apple-icon)/i.test(path)||/\.(?:png|jpe?g|webp|svg|ico)$/i.test(path)
}
