import {cookies} from 'next/headers'
import {redirect} from 'next/navigation'
import {SESSION_COOKIE,validSession} from '@/lib/auth-session'
import LoginForm from './pin-form'
export const dynamic='force-dynamic'
export default async function LoginPage(){
 if(validSession((await cookies()).get(SESSION_COOKIE)?.value))redirect('/')
 return <main className="flex min-h-dvh items-center justify-center bg-[#faf7f2] px-5 py-10 text-stone-900"><section className="w-full max-w-sm rounded-3xl border border-orange-100 bg-white p-7 shadow-xl shadow-orange-100/40"><img src="/icon-192.png" alt="Sanghai POS" width={64} height={64} className="mb-5 rounded-2xl"/><h1 className="text-2xl font-bold">Sanghai Overnight POS</h1><p className="mb-7 mt-2 text-sm text-stone-500">Dành cho thiết bị nội bộ cửa hàng.</p><LoginForm/></section></main>
}
