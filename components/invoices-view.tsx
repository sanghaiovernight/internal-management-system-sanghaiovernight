'use client'

import { useEffect, useState, useRef } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useConfirm } from './confirm-dialog'
import RefundDialog from './refund-dialog'
import { normalizeOrder, filterOrders, bankQr, hasBankDetails, parseVietnamDate, type ReceiptOrder, type ReceiptSettings } from '@/lib/receipts'
import { InvoiceDetail, InvoiceHistoryList } from './invoice-history'
import ThermalReceipt from './thermal-receipt'
const input = 'mt-1 w-full min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-900'
type Props = {onAdjusted:(order:ReceiptOrder,products:{id:string;stock:number;cost_price:number}[])=>void; settings:ReceiptSettings; pending:boolean; offline:boolean; orders:ReceiptOrder[]; loading:boolean; ordersError:boolean; onSave:(settings:ReceiptSettings)=>Promise<boolean>; onPrint:(order:ReceiptOrder,settings:ReceiptSettings)=>Promise<void> }
export default function InvoicesView({onAdjusted,settings,pending,offline,orders,loading,ordersError,onSave,onPrint}:Props) {
  const confirm=useConfirm()
  const [refundOpen,setRefundOpen]=useState(false)
  const mutation=useRef<{fingerprint:string;id:string}|null>(null)
  const lock=useRef(false)
  const [tab,setTab]=useState<'history'|'designer'>('history')
  const [draft,setDraft]=useState(settings)
  const [dirty,setDirty]=useState(false)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [date,setDate]=useState(''),[query,setQuery]=useState('')
  const [selected,setSelected]=useState<ReceiptOrder|null>(null)
  useEffect(()=>{ if(!dirty) setDraft(settings) },[settings,dirty])
  function edit<K extends keyof ReceiptSettings>(key:K,value:ReceiptSettings[K]){setDirty(true);setDraft((current)=>({...current,[key]:value}))}
  const sample:ReceiptOrder={id:'sample',receipt_no:'IN-THU',created_at:'2026-11-01T05:00:00Z',payment_method:'Tiền mặt',items:[{name:'Cà phê sữa',quantity:2,price:25000},{name:'Bánh mì',quantity:1,price:20000}],subtotal:70000,discount:5000,total:65000,cash_received:100000,change_due:35000,qr_url:typeof window!=='undefined'?bankQr(65000,'IN-THU',draft):null}
  async function print(order:ReceiptOrder,template:ReceiptSettings){if(busy)return;setBusy(true);setMessage('');try{await onPrint(order,template)}catch{setMessage('Chưa mở được bản in hoặc chưa tải được QR. Hóa đơn đã lưu không bị thay đổi; hãy thử in lại.')}finally{setBusy(false)}}
  async function adjust(action:'void'|'refund',quantities:{line_id:string;quantity:number}[]) {
    if(!selected||lock.current)return
    lock.current=true;setBusy(true);setMessage('')
    const fingerprint=JSON.stringify([selected.id,selected.version,action,quantities])
    if(mutation.current?.fingerprint!==fingerprint)mutation.current={fingerprint,id:crypto.randomUUID()}
    try{
      const {data,error}=await getSupabaseClient().rpc('pos_adjust_order',{p_order_id:selected.id,p_action:action,p_quantities:quantities,p_request_id:mutation.current.id,p_expected_version:selected.version??0})
      if(error)throw new Error(error.message)
      const order=normalizeOrder(data.order)
      onAdjusted(order,data.products);setSelected(order);setRefundOpen(false);mutation.current=null
      setMessage(action==='void'?'Đã hủy hóa đơn và hoàn tồn kho hàng bán lẻ.':'Đã lưu trả hàng và cập nhật tồn kho.')
    }catch(error){setMessage(error instanceof Error?error.message:'Không lưu được hoàn hàng.')}
    finally{lock.current=false;setBusy(false)}
  }
  async function voidOrder(){
    if(!selected||busy)return
    if(await confirm({title:'Hủy hóa đơn?',description:`Hóa đơn ${selected.receipt_no} sẽ đổi sang Đã hủy. Chỉ số lượng hàng bán lẻ còn lại trong hóa đơn được hoàn về kho; hàng đã trả trước đó không được cộng lần nữa.`,confirmLabel:'Hủy hóa đơn'}))await adjust('void',[])
  }
  return <section className="min-w-0 space-y-4"><h1 className="text-2xl font-bold">Hóa đơn & Mẫu in</h1><div className="flex flex-wrap gap-2">{([['history','Lịch sử hóa đơn'],['designer','Thiết kế mẫu in']] as const).map(([key,label])=><button type="button" key={key} onClick={()=>{setTab(key);setMessage('')}} className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab===key?'bg-amber-600 text-white':'bg-stone-100 text-stone-600'}`}>{label}</button>)}</div>
    {message&&<p role="status" className="break-words rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
    {tab==='designer'?<><p className="text-sm text-stone-500">{pending?'Mẫu đang lưu trên thiết bị, chưa đồng bộ. Nhấn Lưu mẫu hóa đơn để thử đồng bộ lại.':offline?'Đang dùng mẫu lưu trên thiết bị vì chưa kết nối được máy chủ.':'Mẫu dùng chung cho các lần thanh toán tiếp theo.'}</p><div className="grid min-w-0 gap-5 lg:grid-cols-2"><form className="min-w-0 space-y-3 rounded-2xl border bg-white p-4 text-stone-900" onSubmit={async(event)=>{event.preventDefault();if(busy)return;setBusy(true);try{const synced=await onSave(draft);setDirty(false);setMessage(synced?'Đã lưu mẫu hóa đơn lên máy chủ.':'Đã lưu mẫu trên thiết bị. Chưa đồng bộ máy chủ; hãy lưu lại khi có kết nối.')}catch{setMessage('Chưa lưu được mẫu hóa đơn. Vui lòng thử lại.')}finally{setBusy(false)}}}>
      {([['store_name','Tên cửa hàng'],['subtitle','Dòng mô tả phụ'],['address','Địa chỉ'],['phone','Số điện thoại'],['wifi_name','Tên Wifi'],['wifi_password','Mật khẩu Wifi'],['footer','Lời cảm ơn cuối bill'],['bank_name','Tên Ngân hàng (Mã viết tắt, VD: MB, VCB)'],['bank_account','Số tài khoản'],['bank_owner','Tên chủ tài khoản']] as const).map(([key,label])=><label key={key} className="block text-sm font-semibold">{label}<input required={key==='store_name'} maxLength={500} value={draft[key]} onChange={(event)=>edit(key,event.target.value)} className={input}/></label>)}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.show_qr} onChange={(event)=>edit('show_qr',event.target.checked)}/>Hiển thị mã QR chuyển khoản trên bill</label><label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.auto_print} onChange={(event)=>edit('auto_print',event.target.checked)}/>Tự động in khi thanh toán</label>
      {draft.show_qr&&!hasBankDetails(draft)&&<p className="text-xs text-amber-700">Vui lòng nhập đủ mã ngân hàng, số tài khoản và tên chủ tài khoản để hiển thị QR.</p>}
      <div className="flex flex-wrap gap-2"><button disabled={busy} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white">Lưu mẫu hóa đơn</button><button type="button" disabled={busy} onClick={()=>void print(sample,draft)} className="rounded-xl bg-stone-100 px-4 py-2 text-sm font-semibold">In thử mẫu này</button></div>
    </form><div className="min-w-0 overflow-x-auto rounded-2xl bg-stone-200 p-3" aria-label="Xem trước mẫu hóa đơn"><div className="mx-auto w-fit shadow-lg"><ThermalReceipt order={sample} settings={draft}/></div></div></div></>:<>
      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2"><label className="block w-full min-w-0 text-sm">Ngày thanh toán<input aria-label="Ngày thanh toán" type="text" inputMode="numeric" placeholder="dd/MM/yyyy" maxLength={10} aria-describedby="invoice-date-help" value={date} onChange={(event)=>{setDate(event.target.value);setSelected(null)}} className={input}/></label><label className="block w-full min-w-0 text-sm">Tìm hóa đơn<input aria-label="Tìm hóa đơn" placeholder="Mã đơn hoặc tên món" value={query} onChange={(event)=>{setQuery(event.target.value);setSelected(null)}} className={input}/></label></div>
      {ordersError&&<p role="alert" className="text-sm text-red-600">Chưa tải được hóa đơn từ máy chủ. Hãy kiểm tra kết nối rồi tải lại.</p>}
      <p id="invoice-date-help" className="text-xs text-stone-500">Nhập ngày theo định dạng dd/MM/yyyy, ví dụ 01/11/2026. Để trống để xem tất cả.</p>
      {parseVietnamDate(date)===null?<p role="alert" className="text-sm text-red-600">Ngày không hợp lệ. Hãy nhập dd/MM/yyyy.</p>:<><InvoiceHistoryList orders={filterOrders(orders,parseVietnamDate(date)??'',query)} onSelect={setSelected}/>{!filterOrders(orders,parseVietnamDate(date)??'',query).length&&<p className="text-sm text-stone-500">{loading?'Đang tải hóa đơn...':'Không có hóa đơn phù hợp.'}</p>}</>}
      {selected&&refundOpen&&<RefundDialog order={selected} busy={busy} message={message} onClose={()=>{if(!busy)setRefundOpen(false)}} onSave={(quantities)=>void adjust('refund',quantities)}/>}
      {selected&&!refundOpen&&<InvoiceDetail order={selected} settings={selected.receipt_settings??settings} busy={busy} message={message} onVoid={()=>void voidOrder()} onRefund={()=>{setMessage('');setRefundOpen(true)}} onClose={()=>{setSelected(null);setMessage('')}} onPrint={()=>void print(selected,selected.receipt_settings??settings)}/>}

    </>}
  </section>
}
