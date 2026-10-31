'use client'

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ReceiptText, X } from 'lucide-react'
import type { ReceiptOrder, ReceiptSettings } from '@/lib/receipts'
import ThermalReceipt from './thermal-receipt'

export function InvoiceHistoryList({ orders, onSelect }: { orders:ReceiptOrder[];onSelect:(order:ReceiptOrder)=>void }) {
  return <div className="min-w-0 rounded-2xl border border-[#E7DED3] bg-white p-4 dark:bg-[#1C1714]">
    <div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold">Lịch sử hóa đơn</h2><p className="mt-1 text-xs text-stone-500">Các bill đã thanh toán</p></div><ReceiptText className="text-amber-600"/></div>
    <div className="space-y-2">{orders.map((order)=><button key={order.id} type="button" onClick={()=>onSelect(order)} className="grid w-full min-w-0 gap-2 rounded-xl bg-[#FFFCF8] p-3 text-left text-sm hover:bg-amber-50 dark:bg-[#1A1512] sm:grid-cols-[minmax(100px,1fr)_minmax(0,1.5fr)_auto_auto] sm:items-center">
      <div className="min-w-0"><p className="truncate font-bold" title={order.receipt_no}>{order.receipt_no}</p><p className="text-xs text-stone-500">{new Date(order.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</p></div>
      <p className="min-w-0 truncate text-stone-500" title={order.items.map((item)=>`${item.name} × ${item.quantity}`).join(', ')}>{order.items.map((item)=>`${item.name} × ${item.quantity}`).join(', ') || 'Không có chi tiết món hợp lệ'}</p>
      <strong className="text-amber-600 sm:text-right">{order.total.toLocaleString('vi-VN')}đ</strong><span className="text-xs font-semibold text-stone-500 sm:text-right">{order.payment_method}</span>
    </button>)}</div>
  </div>
}
export function InvoiceDetail({order,settings,busy,onClose,onPrint}:{order:ReceiptOrder;settings:ReceiptSettings;busy:boolean;onClose:()=>void;onPrint:()=>void}) {
  const ref=useRef<HTMLDivElement>(null),id=useId()
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden'
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return()=>{document.body.style.overflow=overflow;previous?.focus()}
  },[])
  return createPortal(<div data-testid="invoice-backdrop" className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-3" onClick={(event)=>{if(event.target===event.currentTarget&&!busy)onClose()}}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 text-stone-900 shadow-2xl" onKeyDown={(event)=>{
      if(event.key==='Escape'&&!busy){event.stopPropagation();onClose()}
      if(event.key==='Tab'){const list=Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);if(event.shiftKey&&document.activeElement===list[0]){event.preventDefault();list.at(-1)?.focus()}else if(!event.shiftKey&&document.activeElement===list.at(-1)){event.preventDefault();list[0]?.focus()}}
    }}>
      <div className="mb-3 flex items-start justify-between gap-2"><h2 id={id} className="break-all text-lg font-bold">Chi tiết hóa đơn {order.receipt_no}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Đóng chi tiết hóa đơn" className="rounded-lg bg-stone-100 p-2"><X className="size-4"/></button></div>
      <button type="button" disabled={busy} onClick={onPrint} className="mb-3 w-full rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white">In lại hóa đơn</button>
      <div className="overflow-x-auto rounded-xl bg-stone-200 p-2"><div className="mx-auto w-fit"><ThermalReceipt order={order} settings={settings}/></div></div>
    </div>
  </div>,document.body)
}
