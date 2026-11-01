'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import type { IScannerControls } from '@zxing/browser'

export function CameraScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const scan = useRef(onScan)
  scan.current = onScan
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    let controls: IScannerControls | undefined
    const videoElement = video.current
    const previousFocus = document.activeElement as HTMLElement | null
    closeButton.current?.focus()
    async function start() {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera cần kết nối HTTPS và trình duyệt hỗ trợ camera. Bạn có thể nhập mã hoặc dùng máy quét cầm tay.')
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (cancelled || !video.current) return
        const reader = new BrowserMultiFormatReader()
        controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video.current, (result, _error, currentControls) => {
          if (!result || cancelled) return
          cancelled = true
          currentControls.stop()
          scan.current(result.getText().trim())
        })
        if (cancelled) controls.stop()
      } catch (error) {
        if (!cancelled) setError(error instanceof Error && error.message.includes('HTTPS') ? error.message : 'Không mở được camera. Hãy cấp quyền camera, kiểm tra camera có đang được dùng, hoặc nhập mã bằng máy quét cầm tay.')
      }
    }
    void start()
    return () => {
      cancelled = true
      controls?.stop()
      const stream = videoElement?.srcObject as MediaStream | null
      stream?.getTracks().forEach((track) => track.stop())
      previousFocus?.focus()
    }
  }, [])
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-labelledby="scanner-title" className="w-full max-w-md rounded-2xl bg-surface p-4 text-ink" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key === 'Tab') { event.preventDefault(); closeButton.current?.focus() }
    }}>
      <div className="mb-3 flex items-center justify-between"><h2 id="scanner-title" className="font-bold">Quét Barcode / QR</h2><button ref={closeButton} type="button" onClick={onClose} aria-label="Đóng camera" className="rounded-lg p-2"><X /></button></div>
      <video ref={video} muted playsInline className="aspect-video w-full rounded-xl bg-black object-cover" />
      <p className="mt-3 text-sm">Đưa mã Barcode hoặc QR của sản phẩm vào khung hình.</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger-ink">{error}</p>}
    </div>
  </div>
}

export function ScanButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-field-line px-3 py-2 text-sm font-semibold text-accent-ink"><Camera className="size-4" /> Quét mã</button>
}
