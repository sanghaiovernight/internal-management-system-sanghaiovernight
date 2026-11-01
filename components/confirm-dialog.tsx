'use client'

import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Options = { title: string; description: string; confirmLabel?: string }
const ConfirmContext = createContext<(options: Options) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmContext)
export function ConfirmDialog({ title, description, confirmLabel = 'Xóa', onResolve }: Options & { onResolve: (value: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { document.body.style.overflow = oldOverflow; previous?.focus() }
  }, [])
  return createPortal(<div data-testid="confirm-backdrop" className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onResolve(false) }}>
    <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} className="w-full max-w-md rounded-2xl bg-surface p-6 text-ink shadow-2xl" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onResolve(false) }
      if (event.key === 'Tab') {
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
        const first = buttons[0], last = buttons.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }}>
      <h2 id={`${id}-title`} className="text-xl font-bold">{title}</h2><p id={`${id}-description`} className="mt-3 break-words text-sm leading-6 text-subtle">{description}</p>
      <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => onResolve(false)} className="rounded-xl bg-inset px-5 py-2.5 font-semibold text-subtle">Hủy</button><button type="button" onClick={() => onResolve(true)} className="rounded-xl bg-red-600 px-5 py-2.5 font-semibold text-white hover:bg-red-700">{confirmLabel}</button></div>
    </div>
  </div>,document.body)
}
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<Options | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)
  useEffect(() => () => { resolver.current?.(false) }, [])
  const confirm = (next: Options) => {
    if (resolver.current) return Promise.resolve(false)
    setOptions(next)
    return new Promise<boolean>((resolve) => { resolver.current = resolve })
  }
  const resolve = (value: boolean) => { const callback = resolver.current; resolver.current = null; setOptions(null); callback?.(value) }
  return <ConfirmContext.Provider value={confirm}>{children}{options && <ConfirmDialog {...options} onResolve={resolve} />}</ConfirmContext.Provider>
}
