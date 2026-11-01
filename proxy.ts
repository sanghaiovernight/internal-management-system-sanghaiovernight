import {NextRequest,NextResponse} from 'next/server'
import {SESSION_COOKIE,validSession} from '@/lib/auth-session'
import {publicRequestOrigin} from '@/lib/request-origin'
import {publicPwaAsset} from '@/lib/public-pwa-assets'
const publicPaths=new Set(['/login','/api/auth/login','/api/auth/logout'])
export function proxy(request:NextRequest){
 const path=request.nextUrl.pathname
 if(publicPaths.has(path)||publicPwaAsset(path))return NextResponse.next()
 if(!validSession(request.cookies.get(SESSION_COOKIE)?.value)){
  const response=path.startsWith('/api/')?NextResponse.json({error:'Phiên đã khóa. Vui lòng đăng nhập.'},{status:401}):NextResponse.redirect(new URL('/login',publicRequestOrigin(request)))
  response.headers.set('Cache-Control','no-store');return response
 }
 const response=NextResponse.next()
 response.headers.set('Cache-Control','private, no-store, max-age=0')
 return response
}
export const config={matcher:['/((?!_next/static|_next/image).*)']}
