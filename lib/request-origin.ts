export function sameOriginRequest(request:{headers:Headers;url:string}){
 const site=request.headers.get('sec-fetch-site')
 // Fetch Metadata is set by browsers and cannot be supplied by cross-origin JS.
 if(site==='cross-site'||site==='same-site')return false
 const origin=request.headers.get('origin');if(!origin)return true
 try{
  const source=new URL(origin)
  if(!['http:','https:'].includes(source.protocol)||source.origin!==origin)return false
  // A reverse proxy can rewrite Host/protocol. Browser-confirmed same-origin
  // requests remain same-origin even when their internal server URL differs.
  if(site==='same-origin')return true
  const first=(value:string|null)=>value?.split(',')[0]?.trim()
  const requestUrl=new URL(request.url)
  const host=first(request.headers.get('x-forwarded-host'))||request.headers.get('host')||requestUrl.host
  const protocol=first(request.headers.get('x-forwarded-proto'))||requestUrl.protocol.slice(0,-1)
  return source.origin===`${protocol}://${host}`
 }catch{return false}
}

// Next.js requires absolute redirect URLs; use the public forwarded origin,
// rather than the internal server URL, to keep installed PWAs in their scope.
export function publicRequestOrigin(request:{headers:Headers;url:string}){
 const original=new URL(request.url)
 const first=(value:string|null)=>value?.split(',')[0]?.trim()
 const host=first(request.headers.get('x-forwarded-host'))||request.headers.get('host')||original.host
 const protocol=first(request.headers.get('x-forwarded-proto'))||original.protocol.slice(0,-1)
 try{
  if(protocol!=='http'&&protocol!=='https')return original.origin
  const url=new URL(`${protocol}://${host}`)
  if(url.username||url.password||url.host!==host.toLowerCase()||url.pathname!=='/')return original.origin
  return url.origin
 }catch{return original.origin}
}
