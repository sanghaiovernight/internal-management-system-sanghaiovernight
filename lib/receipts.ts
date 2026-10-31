export type ReceiptSettings = {
  store_name: string; subtitle: string; address: string; phone: string; wifi_name: string; wifi_password: string;
  bank_name: string; bank_account: string; bank_owner: string;
  footer: string; paper_width: 80 | 58; show_qr: boolean; auto_print: boolean
}
export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = { store_name: 'SangHai Overnight', subtitle: 'Convenience & F&B', address: '', phone: '', wifi_name: '', wifi_password: '', footer: 'Cảm ơn quý khách. Hẹn gặp lại!', paper_width: 80, show_qr: false, auto_print: false, bank_name: '', bank_account: '', bank_owner: '' }
export type ReceiptItem = { id?: string; name: string; quantity: number; price: number | null; note?: string }
export type ReceiptOrder = { id: string; receipt_no: string; created_at: string; payment_method: string; items: ReceiptItem[]; subtotal: number; discount: number; total: number; cash_received: number | null; change_due: number | null; receipt_settings?: ReceiptSettings | null; qr_url?: string | null }
export function receiptSettings(value: unknown): ReceiptSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const result = { ...DEFAULT_RECEIPT_SETTINGS }
  for (const key of ['store_name','subtitle','address','phone','wifi_name','wifi_password','footer','bank_name','bank_account','bank_owner'] as const) if (typeof v[key] === 'string') result[key] = (v[key] as string).slice(0,500)
  result.paper_width = v.paper_width === 58 ? 58 : 80
  result.show_qr = v.show_qr === true; result.auto_print = v.auto_print === true
  return result
}
export function receiptItems(value: unknown, depth = 0): ReceiptItem[] {
  if (depth > 5) return []
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return []
    try { return receiptItems(JSON.parse(text),depth+1) }
    catch { return /^[\[{"]/.test(text) ? [] : [{ name:text,quantity:1,price:null }] }
  }
  if (!Array.isArray(value)) {
    if (value && typeof value==='object' && 'items' in value) return receiptItems(value.items,depth+1)
    if (value && typeof value==='object' && 'name' in value) return receiptItems([value],depth+1)
    return []
  }
  return value.flatMap((row) => {
    if (!row || typeof row.name!=='string') return []
    // Legacy migrations sometimes wrapped an encoded JSON array as a single line name.
    if (/^[\[{"]/.test(row.name.trim())) return receiptItems(row.name,depth+1)
    const quantity=Number(row.quantity)
    if(!Number.isFinite(quantity)||quantity<=0) return []
    return [{id:row.id,name:row.name,quantity,price:row.price!=null&&Number.isFinite(Number(row.price))?Number(row.price):null,note:typeof row.note==='string'?row.note:''}]
  })
}
export function normalizeOrder(row: Record<string, any>): ReceiptOrder {
  return { id: String(row.id), receipt_no: String(row.receipt_no || row.id).slice(0,100), created_at: row.created_at, payment_method: row.payment_method, items: receiptItems(row.items), subtotal: Number(row.subtotal ?? row.total), discount: Number(row.discount ?? 0), total: Number(row.total), cash_received: row.cash_received == null ? null : Number(row.cash_received), change_due: row.change_due == null ? null : Number(row.change_due), receipt_settings: row.receipt_settings ? receiptSettings(row.receipt_settings) : null, qr_url: typeof row.qr_url === 'string' && row.qr_url.startsWith('https://img.vietqr.io/image/') ? row.qr_url : null }
}
export const vietnamDay = (value: string) => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value))
export function filterOrders(orders: ReceiptOrder[], date: string, query: string) {
  const q = query.trim().toLocaleLowerCase('vi-VN')
  return orders.filter((order) => (!date || vietnamDay(order.created_at) === date) && (!q || `${order.receipt_no} ${order.items.map((item)=>item.name).join(' ')}`.toLocaleLowerCase('vi-VN').includes(q)))
}
export function hasBankDetails(settings: ReceiptSettings): boolean {
  return [settings.bank_name,settings.bank_account,settings.bank_owner].every((value)=>!!value?.trim())
}
export function bankQr(total: number, code: string, settings: ReceiptSettings): string | null {
  if (!hasBankDetails(settings)) return null
  return `https://img.vietqr.io/image/${encodeURIComponent(settings.bank_name.trim().toUpperCase())}-${encodeURIComponent(settings.bank_account.trim())}-compact2.png?amount=${total}&addInfo=${encodeURIComponent(code)}&accountName=${encodeURIComponent(settings.bank_owner.trim())}`
}
export function parseVietnamDate(value:string): string | null {
  if(!value.trim()) return ''
  const match=value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if(!match) return null
  const [,day,month,year]=match
  const date=new Date(Date.UTC(Number(year),Number(month)-1,Number(day)))
  return date.getUTCFullYear()===Number(year)&&date.getUTCMonth()===Number(month)-1&&date.getUTCDate()===Number(day)?`${year}-${month}-${day}`:null
}
