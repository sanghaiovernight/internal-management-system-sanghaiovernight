import {cookies} from 'next/headers'
import {NextResponse} from 'next/server'
import {SESSION_COOKIE,validSession} from '@/lib/auth-session'
export async function GET(){
 const valid=validSession((await cookies()).get(SESSION_COOKIE)?.value)
 return NextResponse.json({ok:valid},{status:valid?200:401,headers:{'Cache-Control':'no-store'}})
}
