import {NextRequest,NextResponse} from 'next/server'
import {SESSION_COOKIE,validSession} from '@/lib/auth-session'
const publicPaths=new Set(['/login','/api/auth/login','/api/auth/logout','/manifest.webmanifest','/sw.js','/icons/pos.svg','/icons/pos-192.png','/icons/pos-512.png','/icons/apple-touch-icon.png','/favicon.ico','/icon.svg','/icon-light-32x32.png','/icon-dark-32x32.png','/apple-icon.png'])
export function proxy(request:NextRequest){
 const path=request.nextUrl.pathname
 if(publicPaths.has(path))return NextResponse.next()
 if(!validSession(request.cookies.get(SESSION_COOKIE)?.value)){
  const response=path.startsWith('/api/')?NextResponse.json({error:'Phiên đã khóa. Vui lòng đăng nhập.'},{status:401}):NextResponse.redirect(new URL('/login',request.url))
  response.headers.set('Cache-Control','no-store');return response
 }
 const response=NextResponse.next()
 response.headers.set('Cache-Control','private, no-store, max-age=0')
 return response
}
export const config={matcher:['/((?!_next/static|_next/image).*)']}
