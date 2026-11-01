'use client'
import {useRef,useState} from 'react'
export default function LoginForm(){
 const [pin,setPin]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const lock=useRef(false)
 return <form onSubmit={async event=>{
  event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('')
  try{
   const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})})
   const result=await response.json()
   if(!response.ok)throw new Error(result.error??'Chưa đăng nhập được. Hãy thử lại.')
   window.location.replace('/')
  }catch(error){setError(error instanceof Error?error.message:'Không kết nối được máy chủ. Hãy thử lại.');setPin('')}
  finally{lock.current=false;setBusy(false)}
 }}><label className="block text-sm font-semibold" htmlFor="internal-pin">Mã PIN nội bộ</label><input id="internal-pin" name="pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={64} required disabled={busy} value={pin} onChange={event=>setPin(event.target.value.replace(/\D/g,''))} className="mt-2 h-12 w-full rounded-xl border border-line px-4 text-lg tracking-[0.25em] outline-none focus:border-brand focus:ring-2 focus:ring-amber-100"/>{error&&<p role="alert" className="mt-3 text-sm text-danger-ink">{error}</p>}<button disabled={busy||!pin} type="submit" className="mt-5 min-h-12 w-full rounded-xl bg-brand px-4 py-3 font-bold text-white hover:bg-brand-hover disabled:opacity-50">{busy?'Đang mở phiên...':'Vào hệ thống'}</button></form>
}
