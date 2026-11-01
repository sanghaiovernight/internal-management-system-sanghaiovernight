import {NextRequest,NextResponse} from 'next/server'
import {sameOriginRequest} from '@/lib/request-origin'
import {createHash} from 'node:crypto'
import {SESSION_COOKIE,createSession,cookieOptions,pinMatches} from '@/lib/auth-session'
import {retryAfter,recordFailure,clearFailures} from '@/lib/login-throttle'
export const runtime='nodejs'
export async function POST(request:NextRequest){
 const headers={'Cache-Control':'no-store'}
 if(!sameOriginRequest(request))return NextResponse.json({error:'Yêu cầu không hợp lệ.'},{status:403,headers})
 const identity=createHash('sha256').update(request.headers.get('x-vercel-forwarded-for')??request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()??'local').digest('hex')
 const retry=retryAfter(identity)
 if(retry)return NextResponse.json({error:'Bạn đã nhập sai nhiều lần. Vui lòng thử lại sau.'},{status:429,headers:{...headers,'Retry-After':String(retry)}})
 if(Number(request.headers.get('content-length')??0)>1024)return NextResponse.json({error:'Yêu cầu quá lớn.'},{status:413,headers})
 let pin:unknown
 try{const text=await request.text();if(text.length>1024)throw new Error();pin=JSON.parse(text).pin}catch{return NextResponse.json({error:'Vui lòng nhập mã PIN.'},{status:400,headers})}
 if(!pinMatches(pin)){recordFailure(identity);return NextResponse.json({error:'Mã PIN không đúng.'},{status:401,headers})}
 clearFailures(identity)
 const response=NextResponse.json({ok:true},{headers})
 response.cookies.set(SESSION_COOKIE,createSession(),cookieOptions())
 return response
}
