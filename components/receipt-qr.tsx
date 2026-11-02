'use client'

import { useEffect, useState } from 'react'
import { plainReceiptQr } from '@/lib/plain-receipt-qr'

export default function ReceiptQr({ url, preparedSrc }: { url: string; preparedSrc?: string }) {
  const [result, setResult] = useState<{ url: string; src?: string; failed?: boolean } | null>(null)
  useEffect(() => {
    if (preparedSrc) return
    let active = true
    plainReceiptQr(url).then(
      src => { if (active) setResult({ url, src }) },
      () => { if (active) setResult({ url, failed: true }) },
    )
    return () => { active = false }
  }, [url, preparedSrc])
  const current = result?.url === url ? result : null
  const src = preparedSrc || current?.src
  if (current?.failed) return <p role="alert">Không tải được QR. Hãy thử in lại.</p>
  return <div className="receipt-qr-frame" aria-busy={!src}>
    {src ? <img className="receipt-qr" src={src} alt="QR chuyển khoản" /> : <span>Đang tải QR…</span>}
  </div>
}
