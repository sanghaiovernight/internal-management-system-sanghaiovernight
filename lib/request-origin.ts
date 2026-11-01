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
