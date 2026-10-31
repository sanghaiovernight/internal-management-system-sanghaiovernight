'use client'

import useSWR from 'swr'
import { getSupabaseClient } from '@/lib/supabase/client'
import { categoryList, FALLBACK_CATEGORY } from '@/lib/catalog'

export function useCategories(products: { category?: string }[]) {
  const db = getSupabaseClient()
  const { data, error, mutate } = useSWR('pos-categories', async () => {
    const { data, error } = await db.from('pos_categories').select('name').order('name')
    if (error) throw error
    return (data ?? []).map((row) => String(row.name))
  }, { refreshInterval: 30000 })
  const categories = categoryList([FALLBACK_CATEGORY], data ?? [], products.map((product) => product.category ?? ''))
  async function createCategory(value: string) {
    const name = value.trim().replace(/\s+/g, ' ')
    if (!name || name.length > 80) throw new Error('Tên nhóm phải có từ 1 đến 80 ký tự.')
    const existing = categories.find((item) => item.toLocaleLowerCase('vi-VN') === name.toLocaleLowerCase('vi-VN'))
    if (existing) return existing
    const { error } = await db.from('pos_categories').insert({ name })
    if (error) throw new Error(`Không lưu được nhóm hàng: ${error.message}`)
    await mutate((current) => categoryList(current ?? [], [name]), { revalidate: false })
    return name
  }
  async function deleteCategory(name: string) {
    if (name === FALLBACK_CATEGORY) throw new Error('Không thể xóa nhóm mặc định.')
    const { error } = await db.rpc('pos_delete_category', { p_name: name })
    if (error) throw new Error(`Không xóa được nhóm hàng: ${error.message}`)
    await mutate((current) => (current ?? []).filter((item) => item !== name), { revalidate: false })
  }
  return { categories, createCategory, deleteCategory, categoryError: error }
}
