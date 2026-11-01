import {createHmac,randomBytes,timingSafeEqual,createHash} from 'node:crypto'
export const SESSION_COOKIE='sanghai_pos_session'
export const SESSION_SECONDS=90*24*60*60
export function internalPin(){return process.env.POS_INTERNAL_PIN?.trim()||'44448888'}
const key=()=>`sanghai-pos-session:v1:${process.env.POS_SESSION_SECRET??''}:${internalPin()}`
export function pinMatches(value:unknown){
 if(typeof value!=='string'||value.length>64)return false
 const digest=(text:string)=>createHash('sha256').update(text).digest()
 return timingSafeEqual(digest(value),digest(internalPin()))
}
export function createSession(now=Math.floor(Date.now()/1000)){
 const payload=Buffer.from(JSON.stringify({v:1,iat:now,exp:now+SESSION_SECONDS,nonce:randomBytes(16).toString('base64url')})).toString('base64url')
 return `${payload}.${createHmac('sha256',key()).update(payload).digest('base64url')}`
}
export function validSession(token:string|undefined,now=Math.floor(Date.now()/1000)){
 if(!token||token.length>512)return false
 try{
  const parts=token.split('.');if(parts.length!==2||!parts.every(part=>/^[A-Za-z0-9_-]+$/.test(part)))return false
  const expected=createHmac('sha256',key()).update(parts[0]).digest(),actual=Buffer.from(parts[1],'base64url')
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return false
  const data=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'))
  return data.v===1&&Number.isSafeInteger(data.iat)&&Number.isSafeInteger(data.exp)&&data.iat<=now+60&&data.exp>now&&data.exp-data.iat===SESSION_SECONDS&&typeof data.nonce==='string'&&/^[A-Za-z0-9_-]{22}$/.test(data.nonce)
 }catch{return false}
}
export const cookieOptions=()=>({httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax' as const,path:'/',maxAge:SESSION_SECONDS})
