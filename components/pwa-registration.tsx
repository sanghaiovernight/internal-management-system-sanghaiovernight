'use client'
import {useEffect} from 'react'
export default function PwaRegistration(){
 useEffect(()=>{
  if(!('serviceWorker' in navigator)||!window.isSecureContext)return
  const register=()=>{void navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{})}
  if(document.readyState==='complete')register();else window.addEventListener('load',register,{once:true})
  return()=>window.removeEventListener('load',register)
 },[])
 return null
}
