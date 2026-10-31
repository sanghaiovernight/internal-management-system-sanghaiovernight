export const DEFAULT_CATEGORIES = ['Đồ đóng gói', 'Mì & Cơm', 'Gà & Ăn vặt', 'Đồ uống']

export function categoryList(...groups: string[][]): string[] {
  const labels = new Map<string, string>()
  for (const name of groups.flat()) {
    const label = name.trim().replace(/\s+/g, ' ')
    if (label) labels.set(label.toLocaleLowerCase('vi-VN'), label)
  }
  return [...labels.values()].sort((a, b) => a.localeCompare(b, 'vi-VN'))
}

export function matchesProduct(product: { name: string; barcode?: string }, query: string) {
  const value = query.trim().toLocaleLowerCase('vi-VN')
  return product.name.toLocaleLowerCase('vi-VN').includes(value) || (product.barcode ?? '').toLocaleLowerCase('vi-VN').includes(value)
}

export function receiptCost(quantity: string | number, total: string | number) {
  const qty = Number(quantity)
  const amount = Number(total)
  if (String(quantity).trim() === '' || String(total).trim() === '' || !Number.isSafeInteger(qty) || qty <= 0 || !Number.isFinite(amount) || amount < 0) {
    throw new Error('Nhập số lượng nguyên dương và tổng tiền không âm.')
  }
  return { quantity: qty, total: amount, costPrice: amount / qty }
}

export function metricLabel(value: number, metric: 'count' | 'revenue' | 'average') {
  return metric === 'count' ? `${Math.round(value).toLocaleString('vi-VN')} lượt` : `${Math.round(value).toLocaleString('vi-VN')}đ`
}
