export function sameOriginRequest(request:{headers:Headers;url:string}){
 if(request.headers.get('sec-fetch-site')==='cross-site')return false
 const origin=request.headers.get('origin');if(!origin)return true
 try{
  const requestUrl=new URL(request.url),host=request.headers.get('host')??requestUrl.host
  const protocol=request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()??requestUrl.protocol.slice(0,-1)
  return new URL(origin).origin===`${protocol}://${host}`
 }catch{return false}
}
