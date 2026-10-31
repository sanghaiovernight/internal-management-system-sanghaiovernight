'use client'

import { forwardRef, useImperativeHandle, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import type { ReceiptOrder, ReceiptSettings } from '@/lib/receipts'
import ThermalReceipt from './thermal-receipt'
export type ReceiptPrinterHandle = { print: (order: ReceiptOrder, settings: ReceiptSettings) => Promise<void> }
const ReceiptPrinter = forwardRef<ReceiptPrinterHandle>(function ReceiptPrinter(_,ref) {
  const [job,setJob] = useState<{order:ReceiptOrder;settings:ReceiptSettings}|null>(null)
  useImperativeHandle(ref,()=>({ print:async(order,settings)=>{
    flushSync(()=>setJob({order,settings}))
    await document.fonts?.ready
    const area = document.getElementById('receipt-print-area')!
    await Promise.all(Array.from(area.querySelectorAll('img')).map((image)=>Promise.race([
      image.decode(), new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Không tải được QR để in. Hóa đơn vẫn được lưu; hãy thử in lại.')),8000))
    ])))
    await new Promise<void>((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
    window.print()
  }}),[])
  return job && createPortal(<div id="receipt-print-area"><style>{`@media print { @page { margin: 0; size: ${job.settings.paper_width}mm auto; } }`}</style><ThermalReceipt order={job.order} settings={job.settings}/></div>,document.body)
})
export default ReceiptPrinter
