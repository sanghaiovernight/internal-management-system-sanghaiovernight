import {NextRequest,NextResponse} from 'next/server'
import {sameOriginRequest} from '@/lib/request-origin'
import {SESSION_COOKIE,cookieOptions} from '@/lib/auth-session'
export async function POST(request:NextRequest){
 if(!sameOriginRequest(request))return NextResponse.json({error:'Yêu cầu không hợp lệ.'},{status:403,headers:{'Cache-Control':'no-store'}})
 const response=NextResponse.json({ok:true},{headers:{'Cache-Control':'no-store'}})
 response.cookies.set(SESSION_COOKIE,'',{...cookieOptions(),maxAge:0})
 return response
}
