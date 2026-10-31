'use client'

import { useRef,useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import type {Product} from '@/lib/product'
import {MAX_QUANTITY,MAX_MONEY,formatNumber,stocktakePlan,type StocktakeDraft,type StocktakeSheet} from '@/lib/stocktake'
import BoundedNumberInput from './bounded-number-input'
type Props={products:Product[];visibleProducts:Product[];onSaved:(rows:{id:string;stock:number;cost_price:number}[],sheet:StocktakeSheet)=>void}
export default function StocktakeEditor({products,visibleProducts,onSaved}:Props) {
  const [drafts,setDrafts]=useState<Record<string,StocktakeDraft>>({}),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const lock=useRef(false),attempt=useRef<{fingerprint:string;id:string}|null>(null)
  const plan=stocktakePlan(products,drafts)
  function editActual(product:Product,actual:string){setDrafts((current)=>{const next={...current};if(actual===''){delete next[product.id];return next}next[product.id]={...(current[product.id]??{stock:product.stock??0,cost:product.costPrice??0,retail:product.is_imported===true,unitCost:''}),actual};return next});setMessage('')}
  async function save(){
    if(lock.current||plan.errors.length||!plan.lines.length)return
    lock.current=true;setBusy(true);setMessage('')
    const fingerprint=JSON.stringify(plan.lines)
    if(attempt.current?.fingerprint!==fingerprint)attempt.current={fingerprint,id:crypto.randomUUID()}
    try{
      const {data,error}=await getSupabaseClient().rpc('pos_complete_stock_check',{p_request_id:attempt.current.id,p_lines:plan.lines})
      if(error)throw new Error(error.message)
      onSaved(data.products,data.sheet);setDrafts({});attempt.current=null;setMessage(`Đã hoàn thành phiếu kiểm kho ${data.sheet.check_no}.`)
    }catch(error){setMessage(error instanceof Error?error.message:'Chưa lưu được phiếu kiểm kho. Vui lòng thử lại.')}
    finally{lock.current=false;setBusy(false)}
  }
  return <div className="min-w-0 space-y-3 pb-44"><h2 className="text-lg font-bold">Tạo Phiếu Kiểm Kho</h2><p className="text-sm text-stone-500">Chỉ nhập các món cần kiểm. Bỏ trống nghĩa là không thay đổi tồn. Phiếu chốt tất cả các dòng đã nhập, kể cả dòng đang ẩn bởi bộ lọc.</p>
    {message&&<p role="status" className="break-words rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
    {plan.errors.length>0&&<p role="alert" className="break-words rounded-lg bg-red-50 p-3 text-sm text-red-700">{plan.errors.join(' ')}</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-3">{visibleProducts.map((product)=>{
      const draft=drafts[product.id],stock=draft?.stock??product.stock??0,actual=draft?.actual??'',delta=actual===''?0:Number(actual)-stock
      const needsCost=delta>0&&(draft?.retail??product.is_imported===true)
      return <article key={product.id} data-testid="stocktake-row" className="grid min-w-0 gap-3 rounded-2xl border bg-white p-4 text-stone-900 sm:grid-cols-2"><div className="min-w-0"><p className="break-words font-semibold">{product.name}</p><p className="break-all text-xs text-stone-500">Tồn trên máy: {formatNumber(stock)}</p><p className={`mt-2 text-sm font-semibold ${delta<0?'text-red-600':delta>0?'text-emerald-700':'text-stone-500'}`}>Chênh lệch: {delta>0?'+':''}{formatNumber(delta)}</p></div>
        <div className="min-w-0 space-y-2"><label className="block text-xs">Tồn thực tế<BoundedNumberInput aria-label={`Tồn thực tế ${product.name}`} value={actual} onValue={(value)=>editActual(product,value)} max={MAX_QUANTITY} placeholder="Bỏ trống = không đổi" className="mt-1 w-full min-w-0 rounded-lg border p-2 text-sm"/></label>
        {needsCost&&<label className="block text-xs font-semibold text-amber-800">Giá vốn / đơn vị phần tăng (bắt buộc)<BoundedNumberInput aria-label={`Giá vốn phần tăng ${product.name}`} value={draft?.unitCost??''} onValue={(unitCost)=>setDrafts((current)=>({...current,[product.id]:{...current[product.id],unitCost}}))} max={MAX_MONEY} required placeholder="Nhập giá vốn, có thể bằng 0" className="mt-1 w-full min-w-0 rounded-lg border border-amber-300 p-2 text-sm"/></label>}</div>
      </article>
    })}</fieldset>
    {!visibleProducts.length&&<p className="text-sm text-stone-500">Không có mặt hàng phù hợp bộ lọc.</p>}
    <footer data-testid="stocktake-footer" className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-stone-900 shadow-xl"><div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap gap-4 text-sm"><p>Tổng chênh lệch tăng: <b className="break-all text-emerald-700">{formatNumber(plan.increase)}</b></p><p>Tổng chênh lệch giảm: <b className="break-all text-red-600">{formatNumber(plan.decrease)}</b></p><p>{formatNumber(plan.changedCount)} mặt hàng</p></div><button type="button" disabled={busy||!!plan.errors.length||!plan.lines.length} onClick={()=>void save()} className="rounded-xl bg-amber-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">{busy?'Đang lưu phiếu...':'Hoàn thành kiểm kho'}</button></div></footer>
  </div>
}
