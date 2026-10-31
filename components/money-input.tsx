'use client'

import { useEffect, useState } from 'react'

export default function MoneyInput({ value, onChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft((current) => Number(current || 0) === value ? current : String(value)) }, [value])
  return <input {...props} type="text" inputMode="numeric" pattern="[0-9]*" value={draft} onChange={(event) => {
    const digits = event.target.value.replace(/\D/g, '')
    setDraft(digits); onChange(Number(digits))
  }} />
}
