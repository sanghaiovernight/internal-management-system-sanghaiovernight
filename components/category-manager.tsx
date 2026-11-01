'use client'

import { useState } from 'react'
import { useConfirm } from './confirm-dialog'
import { FALLBACK_CATEGORY } from '@/lib/catalog'

export default function CategoryManager({ categories, selected, onSelect, onCreate, onDelete }: {
  categories: string[]; selected: string; onSelect: (name: string) => void;
  onCreate: (name: string) => Promise<string>; onDelete: (name: string) => Promise<void>
}) {
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function remove(name: string) {
    if (busy || !await confirm({ title: `Xóa nhóm ${name}?`, description: `Các mặt hàng sẽ chuyển về “${FALLBACK_CATEGORY}”. Nhóm sẽ bị xóa khỏi bộ lọc ở tất cả các trang.`, confirmLabel: 'Xóa nhóm' })) return
    setBusy(true); setMessage('')
    try { await onDelete(name); if (selected === name) onSelect(''); setMessage(`Đã xóa nhóm “${name}”.`) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể xóa nhóm hàng.') }
    finally { setBusy(false) }
  }
  return <div className="mt-3 space-y-2">
    <div className="flex flex-wrap gap-1.5">
      <button type="button" onClick={() => onSelect('')} className={`rounded-full border px-3 py-1 text-xs ${!selected ? 'border-brand bg-brand text-white' : 'border-line bg-field text-field-ink'}`}>Tất cả</button>
      {categories.map((item) => <div key={item} className={`flex max-w-full items-center rounded-full border text-xs ${selected === item ? 'border-brand bg-brand text-white' : 'border-line bg-field text-field-ink'}`}>
        <button type="button" onClick={() => onSelect(item)} className="min-w-0 break-words px-3 py-1">{item}</button>
        {item !== FALLBACK_CATEGORY && <button type="button" disabled={busy} aria-label={`Xóa nhóm ${item}`} onClick={() => void remove(item)} className={`shrink-0 rounded-full px-2 py-1 disabled:opacity-40 ${selected===item?'text-white':'text-danger-ink'}`}>×</button>}
      </div>)}
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-full border border-dashed border-amber-400 px-3 py-1 text-xs text-accent-ink">+ Thêm nhóm</button>
    </div>
    {open && <form className="flex max-w-sm min-w-0 gap-2" onSubmit={async (event) => {
      event.preventDefault(); if (busy) return
      setBusy(true); setMessage('')
      try { const saved = await onCreate(name); setName(''); setOpen(false); setMessage(`Đã tạo nhóm “${saved}”.`) }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể tạo nhóm hàng.') }
      finally { setBusy(false) }
    }}><input autoFocus aria-label="Tên nhóm hàng mới" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder="Tên nhóm" className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm" /><button disabled={busy} className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm text-white">Tạo nhóm</button></form>}
    {message && <p role="status" className="break-words text-sm">{message}</p>}
  </div>
}
