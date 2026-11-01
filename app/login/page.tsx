import {cookies} from 'next/headers'
import {redirect} from 'next/navigation'
import {SESSION_COOKIE,validSession} from '@/lib/auth-session'
import ThemeToggle from '@/components/theme-toggle'
import LoginForm from './pin-form'
export const dynamic='force-dynamic'
export default async function LoginPage(){
 if(validSession((await cookies()).get(SESSION_COOKIE)?.value))redirect('/')
 return <main className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-10 text-ink"><section className="w-full max-w-sm rounded-3xl border border-line bg-surface p-7 shadow-xl shadow-orange-100/40"><div className="mb-5 flex items-center justify-between gap-3"><img src="/icon-192.png" alt="Sanghai POS" width={64} height={64} className="rounded-2xl"/><ThemeToggle/></div><h1 className="text-2xl font-bold">Sanghai Overnight POS</h1><p className="mb-7 mt-2 text-sm text-subtle">Dành cho thiết bị nội bộ cửa hàng.</p><LoginForm/></section></main>
}
