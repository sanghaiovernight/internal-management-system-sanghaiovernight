export type ReceiptSettings = {
  store_name: string; subtitle: string; address: string; phone: string; wifi_name: string; wifi_password: string;
  footer: string; paper_width: 80 | 58; show_qr: boolean; auto_print: boolean
}
export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = { store_name: 'SangHai Overnight', subtitle: 'Convenience & F&B', address: '', phone: '', wifi_name: '', wifi_password: '', footer: 'Cảm ơn quý khách. Hẹn gặp lại!', paper_width: 80, show_qr: false, auto_print: false }
export type ReceiptItem = { id?: string; name: string; quantity: number; price: number | null; note?: string }
export type ReceiptOrder = { id: string; receipt_no: string; created_at: string; payment_method: string; items: ReceiptItem[]; subtotal: number; discount: number; total: number; cash_received: number | null; change_due: number | null; receipt_settings?: ReceiptSettings | null; qr_url?: string | null }
export function receiptSettings(value: unknown): ReceiptSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const result = { ...DEFAULT_RECEIPT_SETTINGS }
  for (const key of ['store_name','subtitle','address','phone','wifi_name','wifi_password','footer'] as const) if (typeof v[key] === 'string') result[key] = (v[key] as string).slice(0,500)
  result.paper_width = v.paper_width === 58 ? 58 : 80
  result.show_qr = v.show_qr === true; result.auto_print = v.auto_print === true
  return result
}
export function receiptItems(value: unknown): ReceiptItem[] {
  let raw = value
  if (typeof raw === 'string') { try { raw = JSON.parse(raw) } catch { return [{ name: raw as string, quantity: 1, price: null }] } }
  if (!Array.isArray(raw)) return []
  return raw.filter((row) => row && typeof row.name === 'string' && Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0).map((row) => ({ id: row.id, name: row.name, quantity: Number(row.quantity), price: row.price != null && Number.isFinite(Number(row.price)) ? Number(row.price) : null, note: typeof row.note === 'string' ? row.note : '' }))
}
export function normalizeOrder(row: Record<string, any>): ReceiptOrder {
  return { id: String(row.id), receipt_no: String(row.receipt_no || row.id).slice(0,100), created_at: row.created_at, payment_method: row.payment_method, items: receiptItems(row.items), subtotal: Number(row.subtotal ?? row.total), discount: Number(row.discount ?? 0), total: Number(row.total), cash_received: row.cash_received == null ? null : Number(row.cash_received), change_due: row.change_due == null ? null : Number(row.change_due), receipt_settings: row.receipt_settings ? receiptSettings(row.receipt_settings) : null, qr_url: typeof row.qr_url === 'string' && row.qr_url.startsWith('https://img.vietqr.io/image/') ? row.qr_url : null }
}
export const vietnamDay = (value: string) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))
export function filterOrders(orders: ReceiptOrder[], date: string, query: string) {
  const q = query.trim().toLocaleLowerCase('vi-VN')
  return orders.filter((order) => (!date || vietnamDay(order.created_at) === date) && (!q || `${order.receipt_no} ${order.items.map((item)=>item.name).join(' ')}`.toLocaleLowerCase('vi-VN').includes(q)))
}
export function bankQr(total: number, code: string): string | null {
  try {
    const bank = JSON.parse(localStorage.getItem('vietqr-config') || '{}')
    if (!/^[A-Za-z0-9]+$/.test(bank.bankId) || !/^\d{1,30}$/.test(bank.accountNo)) return null
    return `https://img.vietqr.io/image/${bank.bankId}-${bank.accountNo}-compact2.png?amount=${total}&addInfo=${encodeURIComponent(code)}&accountName=${encodeURIComponent(bank.accountName || '')}`
  } catch { return null }
}
