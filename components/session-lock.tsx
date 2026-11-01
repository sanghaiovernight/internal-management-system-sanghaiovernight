'use client'
import {useEffect,useState} from 'react'
import {LockKeyhole} from 'lucide-react'
function discardPrivateCache(){
 try{for(const key of Object.keys(localStorage))if(key.startsWith('pos-stock-imports:')||key.startsWith('receipt-settings:')||key==='vietqr-config')localStorage.removeItem(key);sessionStorage.clear()}catch{}
}
export default function SessionLock({disabled=false}:{disabled?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 useEffect(()=>{
  let active=true
  const leave=()=>{discardPrivateCache();window.location.replace('/login')}
  const check=()=>{void fetch('/api/auth/session',{cache:'no-store'}).then(response=>{if(active&&response.status===401)leave()}).catch(()=>{})}
  const onShow=(event:PageTransitionEvent)=>{if(event.persisted)window.location.reload()}
  const onStorage=(event:StorageEvent)=>{if(event.key==='pos-session-locked')leave()}
  window.addEventListener('focus',check);window.addEventListener('pageshow',onShow);window.addEventListener('storage',onStorage)
  const timer=setInterval(check,60000)
  return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',check);window.removeEventListener('pageshow',onShow);window.removeEventListener('storage',onStorage)}
 },[])
 return <div className="ml-auto flex min-w-0 items-center"><button type="button" disabled={disabled||busy} onClick={async()=>{
  if(busy)return;setBusy(true);setError('')
  try{const response=await fetch('/api/auth/logout',{method:'POST'});if(!response.ok)throw new Error();try{localStorage.setItem('pos-session-locked',String(Date.now()))}catch{}discardPrivateCache();window.location.replace('/login')}
  catch{setBusy(false);setError('Chưa khóa được phiên. Hãy kiểm tra kết nối rồi thử lại.')}
 }} className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold text-subtle hover:bg-tint hover:text-accent-ink disabled:opacity-40"><LockKeyhole className="size-4"/>{busy?'Đang khóa...':'Khóa phiên'}</button>{error&&<p role="alert" className="max-w-48 text-xs text-danger-ink">{error}</p>}</div>
}
