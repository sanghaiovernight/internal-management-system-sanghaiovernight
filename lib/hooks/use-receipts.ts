'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { getSupabaseClient } from '@/lib/supabase/client'
import { DEFAULT_RECEIPT_SETTINGS, receiptSettings, normalizeOrder, type ReceiptSettings, type ReceiptOrder } from '@/lib/receipts'
const key = (name: string) => `${name}:${process.env.NEXT_PUBLIC_SUPABASE_URL}`
export function useReceiptSettings() {
  const [local, setLocal] = useState<ReceiptSettings>(DEFAULT_RECEIPT_SETTINGS)
  const [pending, setPending] = useState(false)
  const [ready,setReady] = useState(false)
  useEffect(() => {
    try { const cached = JSON.parse(localStorage.getItem(key('receipt-settings')) || 'null'); if (cached) { setLocal(receiptSettings(cached.settings)); setPending(cached.pending === true) } } catch {}
    setReady(true)
  }, [])
  const { data, error, mutate } = useSWR('receipt-settings', async () => {
    const { data, error } = await getSupabaseClient().from('pos_receipt_settings').select('*').eq('id','default').maybeSingle()
    if (error) throw error
    return receiptSettings(data)
  }, { refreshInterval: 30000 })
  useEffect(() => { if (ready && data && !pending) { setLocal(data); try { localStorage.setItem(key('receipt-settings'),JSON.stringify({settings:data,pending:false})) } catch {} } },[data,pending,ready])
  async function save(settings: ReceiptSettings) {
    const cleaned = receiptSettings(settings)
    setLocal(cleaned); setPending(true)
    let stored = false
    try { localStorage.setItem(key('receipt-settings'),JSON.stringify({settings:cleaned,pending:true})); stored = true } catch {}
    const { error } = await getSupabaseClient().from('pos_receipt_settings').upsert({id:'default',...cleaned})
    if (error) { if (!stored) throw new Error('Không lưu được mẫu trên thiết bị hoặc máy chủ.'); return false }
    setPending(false)
    try { localStorage.setItem(key('receipt-settings'),JSON.stringify({settings:cleaned,pending:false})) } catch {}
    await mutate(cleaned,{revalidate:false})
    return true
  }
  return { settings: pending ? local : data ?? local, pending, offline: !!error, ready, save }
}
export function useOrders() {
  const { data, error, isLoading, mutate } = useSWR<ReceiptOrder[]>('pos-orders', async () => {
    // Fetch all pages so searching/filtering is not limited to the first 1000 bills.
    const rows: ReceiptOrder[] = []
    for (let start = 0; ; start += 500) {
      const { data, error } = await getSupabaseClient().from('pos_orders').select('*').order('created_at',{ascending:false}).order('id',{ascending:false}).range(start,start+499)
      if (error) throw error
      rows.push(...(data ?? []).map((row)=>normalizeOrder(row)))
      if (!data || data.length < 500) return rows
    }
  })
  const remember = (order: ReceiptOrder) => mutate((current) => [order,...(current ?? []).filter((row)=>row.id!==order.id)],{revalidate:false})
  return { orders: data ?? [], error, isLoading, remember }
}
