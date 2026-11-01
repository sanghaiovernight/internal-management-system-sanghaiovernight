'use client'
import {useEffect,useRef,useState} from 'react'
import {getSupabaseClient} from '@/lib/supabase/client'
import {compressProductImage,imageDataUrl,productImageSource} from '@/lib/product-images'
import ProductPhoto from './product-photo'
export default function ProductImageEditor({value,onChange,onBusy}:{value:string;onChange:(value:string)=>void;onBusy:(busy:boolean)=>void}){
 const [message,setMessage]=useState(''),[working,setWorking]=useState(false)
 const active=useRef(true)
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
 async function upload(file:File){
  setWorking(true);onBusy(true);setMessage('Đang nén và tải ảnh...')
  try {
   const blob=await compressProductImage(file)
   if(!active.current)return
   const storage=getSupabaseClient().storage.from('product-images'),path=`products/${crypto.randomUUID()}.webp`
   let image:string,stored=false
   try {const {error}=await storage.upload(path,blob,{contentType:blob.type,upsert:false,cacheControl:'31536000'});if(error)throw error;image=storage.getPublicUrl(path).data.publicUrl;stored=true}
   catch {image=await imageDataUrl(blob)}
   if(active.current){onChange(image);setMessage(stored?'Đã tải ảnh. Nhấn Lưu để gắn ảnh vào mặt hàng.':'Không tải được lên Storage. Ảnh nén sẽ được lưu cùng mặt hàng khi nhấn Lưu.')}
  }catch(error){if(active.current)setMessage(error instanceof Error?error.message:'Không xử lý được ảnh.')}
  finally{if(active.current){setWorking(false);onBusy(false)}}
 }
 return <div className="min-w-0 space-y-2"><p className="text-sm font-semibold">Ảnh sản phẩm</p>
  <label className="block text-xs">Chọn ảnh từ thiết bị<input aria-label="Chọn ảnh sản phẩm" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" disabled={working} className="mt-1 block w-full min-w-0 text-xs" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void upload(file)}}/></label>
  <label className="block text-xs">Hoặc dán URL ảnh<input aria-label="URL ảnh sản phẩm" type="text" inputMode="url" placeholder="https://..." value={value.startsWith('data:')?'':value} disabled={working} onChange={event=>{onChange(event.target.value);setMessage('')}} className="mt-1 w-full min-w-0 rounded-lg border border-line px-3 py-2 text-sm"/></label>
  {value&&<div className="flex items-center gap-3"><div className="size-24 shrink-0 overflow-hidden rounded-xl bg-inset"><ProductPhoto src={productImageSource(value)} alt="Xem trước ảnh sản phẩm" className="size-full object-cover" fallback={<span className="block p-2 text-xs text-subtle">Chưa tải được ảnh</span>}/></div><button type="button" disabled={working} onClick={()=>{onChange('');setMessage('')}} className="rounded-lg bg-danger-soft px-3 py-2 text-xs font-semibold text-danger-ink">Xóa ảnh</button></div>}
  {message&&<p role="status" className="break-words text-xs text-accent-ink">{message}</p>}
 </div>
}
