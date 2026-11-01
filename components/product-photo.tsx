'use client'
import {useState,type ReactNode} from 'react'
import {productImageSource} from '@/lib/product-images'
export default function ProductPhoto({src,alt,className,fallback=null}:{src?:string;alt:string;className?:string;fallback?:ReactNode}){
 const [failed,setFailed]=useState('')
 const source=productImageSource(src??'')
 return source&&failed!==source?<img src={source} alt={alt} className={className} loading="lazy" decoding="async" onError={()=>setFailed(source)}/>:fallback
}
