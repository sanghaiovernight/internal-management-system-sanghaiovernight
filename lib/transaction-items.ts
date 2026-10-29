export type ParsedTransactionItem = { id: string; name: string; quantity: number; price: number; category: string }

type ProductLookup = { id?: string; name: string; price?: number; category?: string }

export function parseTransactionItems(tx: { items?: unknown; soldItems?: unknown }, products: ProductLookup[] = []): ParsedTransactionItem[] {
  const lookup = new Map(products.map((product) => [product.name.trim().toLowerCase(), product]))
  const raw = Array.isArray(tx.soldItems) && tx.soldItems.length > 0 ? tx.soldItems : tx.items
  let values: unknown[] = []
  if (Array.isArray(raw)) values = raw
  else if (typeof raw === 'string') {
    let parsed: unknown = raw
    for (let attempt = 0; attempt < 2 && typeof parsed === 'string'; attempt += 1) { try { parsed = JSON.parse(parsed) } catch { break } }
    if (Array.isArray(parsed)) values = parsed
    else values = raw.split(',').map((part) => { const match = part.trim().match(/^(.*?)\s*[x×]\s*(\d+)\s*$/i); return { name: match?.[1]?.trim() || part.trim(), quantity: Number(match?.[2] || 1) } })
  }
  return values.filter(Boolean).map((value) => { const item = typeof value === 'object' && value !== null ? value as Record<string, unknown> : { name: String(value) }; const name = String(item.name ?? item.title ?? 'Món ăn').trim(); const product = lookup.get(name.toLowerCase()); return { id: String(item.id ?? item.productId ?? product?.id ?? ''), name, quantity: Math.max(1, Number(item.quantity ?? item.qty ?? item.count ?? 1) || 1), price: Number(item.price ?? item.unitPrice ?? product?.price ?? 0) || 0, category: String(item.category ?? product?.category ?? 'Khác') } })
}
