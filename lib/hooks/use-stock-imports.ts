'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { getSupabaseClient } from '@/lib/supabase/client'

export type StockImport = { id: string; product_id: string; product_name: string; quantity: number; unit_cost: number; total_cost: number; created_at: string; stock_before?: number; cost_before?: number; cost_after?: number; voided_at?: string | null; reversible?: boolean }
const cacheKey = () => `pos-stock-imports:${process.env.NEXT_PUBLIC_SUPABASE_URL}`
function store(rows: StockImport[]) { try { localStorage.setItem(cacheKey(), JSON.stringify(rows)) } catch {} }
export function useStockImports() {
  const [cached, setCached] = useState<StockImport[]>([])
  useEffect(() => {
    try { const rows = JSON.parse(localStorage.getItem(cacheKey()) ?? '[]'); if (Array.isArray(rows)) setCached(rows.filter((row) => row && typeof row.id === 'string' && typeof row.product_name === 'string' && Number.isFinite(Number(row.quantity)))) } catch {}
  }, [])
  const { data, error, isLoading, mutate } = useSWR<StockImport[]>('pos-stock-imports', async () => {
    const { data, error } = await getSupabaseClient().from('pos_stock_imports').select('*').order('created_at', { ascending: false }).limit(1000)
    if (error) throw error
    return (data ?? []) as StockImport[]
  }, { refreshInterval: 30000 })
  useEffect(() => { if (data) { setCached(data); store(data) } }, [data])
  const remember = async (receipt: StockImport) => {
    await mutate((current) => [receipt, ...(current ?? cached).filter((item) => item.id !== receipt.id)], { revalidate: false })
  }
  const forget = async (id: string) => { await mutate((current) => (current ?? cached).filter((row) => row.id !== id), { revalidate: false }) }
  return { imports: (data ?? cached).filter((row) => !row.voided_at), error, isLoading, usingCache: !data && cached.length > 0, remember, forget }
}
