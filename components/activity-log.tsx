'use client'

import {useStockChecks} from '@/lib/hooks/use-stock-checks'
import {formatNumber} from '@/lib/stocktake'
import { useStockImports } from '@/lib/hooks/use-stock-imports'
import { shortDocumentNumber,formatVietnamTimestamp } from '@/lib/document-numbers'
import type { ReceiptOrder } from '@/lib/receipts'
export default function ActivityLog({ orders,ordersError }: {orders:ReceiptOrder[];ordersError:boolean}) {
  const {checks,error:checkError,isLoading:checksLoading}=useStockChecks()
  const {allImports:imports,error,isLoading}=useStockImports()
  const events=[...checks.map((sheet)=>({id:`check-${sheet.id}`,at:sheet.created_at,type:'Kiểm kho',description:`${sheet.check_no} - ${sheet.lines.map((line)=>`${line.name}: ${formatNumber(Number(line.stock_before))} → ${formatNumber(Number(line.stock_after))}`).join(', ')}`})),...imports.map((row)=>({id:`import-${row.id}`,at:row.created_at,type:'Nhập hàng',description:`${row.product_name}: +${row.quantity} · Phiếu ${shortDocumentNumber('PN',row.created_at,row.receipt_no)}${row.voided_at?' (đã hoàn tác)':''}`})),...orders.filter((row)=>row.status==='voided'||row.status==='refunded').flatMap((order)=>(order.activity_events?.length?order.activity_events:[{id:order.id,action:order.status==='voided'?'void':'refund',created_at:order.updated_at??order.created_at,receipt_no:order.receipt_no,items:[],refund_amount:0}]).map((event)=>({id:event.id,at:event.created_at,type:event.action==='void'?'Hủy bill':'Sửa bill',description:`${shortDocumentNumber('HD',order.created_at,order.receipt_no,order.activity_receipt_no)}: ${event.items.map((item)=>`${item.name} trả ${item.quantity}`).join(', ')||'Đã cập nhật trạng thái hóa đơn'} · Hoàn ${Number(event.refund_amount).toLocaleString('vi-VN')}đ`})))] .sort((a,b)=>new Date(b.at).getTime()-new Date(a.at).getTime())
  return <section className="space-y-4"><h1 className="text-2xl font-bold">Nhật ký hoạt động</h1>{(error||ordersError||checkError)&&<p role="alert" className="text-sm text-amber-700">Chưa tải đầy đủ nhật ký từ máy chủ. Hãy kiểm tra kết nối.</p>}<ol className="space-y-3 border-l-2 border-amber-200 pl-4">{events.map((event)=><li key={event.id} className="rounded-2xl border bg-white p-4 text-stone-900"><p className="text-xs text-stone-500">{formatVietnamTimestamp(event.at)}</p><h2 className="my-1 font-bold text-amber-700">{event.type}</h2><p className="break-words text-sm">{event.description}</p></li>)}</ol>{!events.length&&<p className="text-sm text-stone-500">{isLoading||checksLoading?'Đang tải nhật ký...':'Chưa có hoạt động.'}</p>}</section>
}
