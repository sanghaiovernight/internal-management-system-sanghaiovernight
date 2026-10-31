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

export const FALLBACK_CATEGORY = 'Chưa phân loại'

type StockProduct = { id?: string; name?: string; is_imported?: boolean | null; stock?: number; costPrice?: number; cost_price?: number; price?: number }

// is_imported is authoritative: neither category labels nor zero stock imply a product type.
export function isRetail(product: StockProduct) { return product.is_imported === true }
export function isLowStock(product: StockProduct) { return isRetail(product) && (product.stock ?? 0) <= 5 }
export function movingAverageCost(stock: number, cost: number, quantity: number, total: number) {
  const currentStock = Math.max(0, stock || 0)
  return Math.round((currentStock * (cost || 0) + total) / (currentStock + quantity))
}
export function stockProblem(lines: { id: string; quantity: number }[], products: StockProduct[]): string | null {
  if (!lines.length) return 'Giỏ hàng đang trống.'
  const quantities = new Map<string, number>()
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) return 'Số lượng trong giỏ không hợp lệ.'
    quantities.set(line.id, (quantities.get(line.id) ?? 0) + line.quantity)
  }
  for (const [id, quantity] of quantities) {
    const product = products.find((item) => item.id === id)
    if (!product) return 'Một mặt hàng trong giỏ đã bị xóa. Hãy bỏ mặt hàng đó khỏi giỏ.'
    if (isRetail(product) && quantity > Math.max(0, product.stock ?? 0)) return `${product.name}: chỉ còn ${Math.max(0, product.stock ?? 0)} sản phẩm trong kho.`
  }
  return null
}
