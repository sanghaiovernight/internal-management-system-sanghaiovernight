'use client'

import { useState } from 'react'

export default function CategoryManager({ onCreate }: { onCreate: (name: string) => Promise<string> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  return <form className="flex min-w-0 flex-wrap items-start gap-2" onSubmit={async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setMessage('')
    try { const saved = await onCreate(name); setName(''); setMessage(`Đã có nhóm “${saved}” trong bộ lọc các trang.`) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Không thể tạo nhóm hàng.') }
    finally { setBusy(false) }
  }}>
    <input aria-label="Tên nhóm hàng mới" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required placeholder="Tên nhóm hàng mới" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm" />
    <button disabled={busy} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Đang lưu...' : 'Tạo nhóm'}</button>
    {message && <p role="status" className="w-full break-words text-sm">{message}</p>}
  </form>
}
