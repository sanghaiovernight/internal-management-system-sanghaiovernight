'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { refundPreview, type ReceiptOrder } from '@/lib/receipts'
export default function RefundDialog({order,busy,message,onClose,onSave}:{order:ReceiptOrder;busy:boolean;message:string;onClose:()=>void;onSave:(quantities:{line_id:string;quantity:number}[])=>void}) {
  const [quantities,setQuantities]=useState(order.items.map((item,index)=>({line_id:item.line_id??String(index+1),quantity:item.quantity})))
  const ref=useRef<HTMLDivElement>(null),id=useId()
  useEffect(()=>{const old=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';ref.current?.querySelector<HTMLButtonElement>('button')?.focus();return()=>{document.body.style.overflow=overflow;old?.focus()}},[])
  let total:number|null=null,refund:number|null=null
  try{const preview=refundPreview(order,quantities);total=preview.total;refund=preview.refund}catch{}
  return createPortal(<div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-3" onClick={(event)=>{if(event.target===event.currentTarget&&!busy)onClose()}}><div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="max-h-[90dvh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-5 text-stone-900" onKeyDown={(event)=>{
    if(event.key==='Escape'&&!busy){event.stopPropagation();onClose()}
    if(event.key==='Tab'){const list=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')??[]);if(event.shiftKey&&document.activeElement===list[0]){event.preventDefault();list.at(-1)?.focus()}else if(!event.shiftKey&&document.activeElement===list.at(-1)){event.preventDefault();list[0]?.focus()}}
  }}><div className="flex items-center justify-between"><h2 id={id} className="text-xl font-bold">Sửa / Trả hàng {order.receipt_no}</h2><button type="button" disabled={busy} onClick={onClose} className="rounded-lg bg-stone-100 px-3 py-2">Đóng</button></div><p className="my-3 text-sm text-stone-500">Giảm số lượng giữ lại. Chỉ phần vừa trả của hàng bán lẻ được cộng về kho. Tiền hoàn giữ tỷ lệ giảm giá ban đầu.</p>
    <form onSubmit={(event)=>{event.preventDefault();onSave(quantities)}}><fieldset disabled={busy} className="space-y-3">{order.items.map((item,index)=><label key={quantities[index].line_id} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm"><span className="min-w-0 break-words">{item.name}<span className="block text-xs text-stone-500">Hiện giữ {item.quantity} · Trả {Math.max(0,item.quantity-quantities[index].quantity)}</span></span><input aria-label={`Số lượng giữ lại ${item.name} dòng ${index+1}`} type="number" min="0" max={item.quantity} step="1" required value={Number.isNaN(quantities[index].quantity)?'':quantities[index].quantity} onChange={(event)=>setQuantities((current)=>current.map((row,i)=>i===index?{...row,quantity:event.target.value===''?NaN:Number(event.target.value)}:row))} className="w-20 shrink-0 rounded-lg border p-2"/></label>)}
    <p>Tổng bill sau trả: <b>{total==null?'—':`${total.toLocaleString('vi-VN')}đ`}</b></p><p>Tiền hoàn: <b>{refund==null?'—':`${refund.toLocaleString('vi-VN')}đ`}</b></p>
    {message&&<p role="status" className="text-sm text-amber-700">{message}</p>}
    <button type="submit" disabled={total===null||!quantities.some((row,i)=>row.quantity!==order.items[i].quantity)} className="w-full rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white disabled:opacity-40">{busy?'Đang lưu...':'Lưu trả hàng'}</button></fieldset></form>
  </div></div>,document.body)
}
