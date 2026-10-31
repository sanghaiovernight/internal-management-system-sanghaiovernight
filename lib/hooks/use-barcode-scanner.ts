'use client'

import { useEffect, useRef } from 'react'

// Keyboard-wedge scanners terminate a fast sequence with Enter or Tab.
// Inputs are handled by the explicit scan/search fields, never globally intercepted.
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  const callback = useRef(onScan)
  callback.current = onScan
  useEffect(() => {
    if (!enabled) return
    let buffer = ''
    let lastAt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const reset = () => { buffer = ''; lastAt = 0 }
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"]') || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (buffer.length >= 2 && performance.now() - lastAt < 150) {
          event.preventDefault()
          callback.current(buffer.trim())
        }
        reset()
        return
      }
      if (event.key.length !== 1) { reset(); return }
      const now = performance.now()
      if (now - lastAt > 100) buffer = ''
      buffer += event.key
      lastAt = now
      clearTimeout(timer)
      timer = setTimeout(reset, 200)
    }
    window.addEventListener('keydown', keydown)
    return () => { clearTimeout(timer); window.removeEventListener('keydown', keydown) }
  }, [enabled])
}
