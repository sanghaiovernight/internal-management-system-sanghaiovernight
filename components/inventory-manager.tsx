'use client'

import { useMemo, useRef, useState } from 'react'
import { Check, Minus, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { matchesProduct, receiptCost, movingAverageCost, isLowStock, isRetail, isIngredient } from '@/lib/catalog'
import type { Product } from '@/lib/product'
import { useBarcodeScanner } from '@/lib/hooks/use-barcode-scanner'
import { CameraScanner, ScanButton } from './barcode-scanner'
import { useConfirm } from './confirm-dialog'
import CategoryManager from './category-manager'
import StocktakeEditor from './stocktake-editor'
import { useStockChecks } from '@/lib/hooks/use-stock-checks'
import {MAX_QUANTITY,formatNumber} from '@/lib/stocktake'
import MoneyInput from './money-input'
import ProductImageEditor from './product-image-editor'
import ProductPhoto from './product-photo'
import {productImageSource} from '@/lib/product-images'
import StockImportHistory from './stock-import-history'
import { useStockImports, type StockImport } from '@/lib/hooks/use-stock-imports'

type Props = { products: Product[]; onChange: (products: Product[]) => void; categories: string[]; onCreateCategory: (name: string) => Promise<string>; onReceived: () => void; onDeleteCategory: (name: string) => Promise<void> }
const money = (value: number) => `${value.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}đ`
const inputClass = 'min-w-0 w-full rounded-lg border border-stone-200 bg-transparent px-3 py-2 text-sm'
const panelClass = 'min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:bg-[#1C1714]'
const describeError = (error: unknown) => error instanceof Error ? error.message : (error as { message?: string })?.message ?? 'Không thể lưu dữ liệu. Vui lòng thử lại.'

export default function InventoryManager({ products, onChange, categories, onCreateCategory, onDeleteCategory, onReceived }: Props) {
  const confirm = useConfirm()
  const db = getSupabaseClient()
  const history = useStockImports()
  const checks = useStockChecks()
  const [tab, setTab] = useState<'stock' | 'receiving' | 'audit'>('stock')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)
  const editOriginal = useRef<Product | null>(null)
  const openEdit = (product: Product) => { editOriginal.current = product; setEditing({ ...product }) }
  const [receiptProduct, setReceiptProduct] = useState('')
  const [receiptQty, setReceiptQty] = useState('')
  const [receiptTotal, setReceiptTotal] = useState('')
  const [autoExpense, setAutoExpense] = useState(true)
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const receiptAttempt = useRef<{ fingerprint: string; id: string } | null>(null)
  const [message, setMessage] = useState('')
  const [failure, setFailure] = useState('')
  const [camera, setCamera] = useState(false)
  const filtered = useMemo(() => products.filter((product) => (!category || product.category === category) && matchesProduct(product, query)), [products, category, query])
  const lowStock = products.filter(isLowStock)
  const scan = (code: string) => {
    setCamera(false)
    if (editing) { setEditing({ ...editing, barcode: code }); return }
    const matches = products.filter((product) => product.barcode === code)
    if (matches.length !== 1) { if (tab === 'receiving') setReceiptProduct(''); setFailure(matches.length > 1 ? 'Mã trùng ở nhiều sản phẩm. Hãy kiểm tra lại mã vạch.' : `Không tìm thấy sản phẩm cho mã ${code}.`); return }
    const product = matches[0]
    setFailure('')
    if (tab === 'receiving') { setReceiptProduct(product.id); setMessage(`Đã chọn ${product.name}`) }
    else { setQuery(code); setCategory(''); setMessage(`Đã tìm thấy ${product.name}`) }
  }
  useBarcodeScanner(scan, !camera && !editing && !saving)
  async function action(operation: () => Promise<void>) {
    if (busy.current) return
    busy.current = true; setSaving(true); setFailure(''); setMessage('')
    try { await operation() }
    catch (error) { setFailure(describeError(error)) }
    finally { busy.current = false; setSaving(false) }
  }
  const updateStock = (product: Product, stock: number) => action(async () => {
    if (!Number.isSafeInteger(stock) || stock < 0 || stock > MAX_QUANTITY) throw new Error('Tồn kho phải là số nguyên không âm.')
    let request = db.from('pos_products').update({ stock }).eq('id', product.id)
    request = product.stock ? request.eq('stock', product.stock) : request.or('stock.eq.0,stock.is.null')
    const { data, error } = await request.select('id, stock').single()
    if (error) throw error
    onChange(products.map((item) => item.id === product.id ? { ...item, stock: Number(data.stock) } : item))
  })
  const saveEdit = () => action(async () => {
    if (!editing?.name.trim() || !editing.category) throw new Error('Vui lòng nhập tên và chọn nhóm hàng.')
    if (![editing.price, editing.costPrice ?? 0].every((value) => Number.isFinite(value) && value >= 0)) throw new Error('Giá bán và giá vốn phải là số không âm.')
    if (editing.barcode && products.some((product) => product.id !== editing.id && product.barcode === editing.barcode?.trim())) throw new Error('Mã này đã thuộc về sản phẩm khác.')
    if (editing.imageUrl?.trim() && !productImageSource(editing.imageUrl)) throw new Error('URL ảnh phải là HTTP/HTTPS hoặc ảnh nén hợp lệ.')
    const next = { ...editing, id: editing.id || crypto.randomUUID(), name: editing.name.trim(), barcode: editing.barcode?.trim() ?? '', tag: editing.category }
    const payload = { id: next.id, name: next.name, image_url: next.imageUrl?.trim() || null, price: isIngredient(next) ? 0 : next.price, category: next.category, tag: next.category, product_type: isIngredient(next) ? 'ingredient' : isRetail(next) ? 'retail' : 'processed', is_imported: next.is_imported === true, barcode: next.barcode || null, cost_price: next.costPrice ?? 0, stock: next.stock ?? 0 }
    const { stock: _stock, cost_price: _cost, ...metadata } = payload
    const costChanged = editing.id && editOriginal.current?.costPrice !== next.costPrice
    let request = db.from('pos_products').update(costChanged ? { ...metadata, cost_price: next.costPrice ?? 0 } : metadata).eq('id', next.id)
    if (costChanged) {
      const originalCost = editOriginal.current?.costPrice ?? 0
      request = originalCost ? request.eq('cost_price', originalCost) : request.or('cost_price.eq.0,cost_price.is.null')
    }
    const result = editing.id ? await request.select('id, stock, cost_price').single() : await db.from('pos_products').insert(payload).select('id, stock, cost_price').single()
    if (result.error) throw new Error(`Không lưu được mặt hàng; hãy tải lại nếu tồn kho/giá vốn đã thay đổi. ${result.error.message}`)
    const saved = { ...next, stock: Number(result.data.stock), costPrice: Number(result.data.cost_price), cost: Number(result.data.cost_price) }
    onChange(editing.id ? products.map((item) => item.id === next.id ? saved : item) : [...products, saved])
    setEditing(null); setMessage('Đã lưu mặt hàng.')
  })
  const deleteProduct = async () => {
    if (!editing || !await confirm({ title: 'Xóa mặt hàng?', description: `Mặt hàng “${editing.name}” sẽ bị xóa khỏi danh sách bán hàng và tồn kho. Hóa đơn đã lưu vẫn được giữ lại.`, confirmLabel: 'Xóa mặt hàng' })) return
    void action(async () => {
      const { error } = await db.from('pos_products').delete().eq('id', editing.id).select('id').single()
      if (error) throw error
      onChange(products.filter((item) => item.id !== editing.id)); setEditing(null)
    })
  }
  const receive = () => action(async () => {
    const product = products.find((item) => item.id === receiptProduct)
    if (!product) throw new Error('Hãy chọn mặt hàng cần nhập.')
    const { quantity, total } = receiptCost(receiptQty, receiptTotal)
    const fingerprint = JSON.stringify([product.id, quantity, total, autoExpense])
    if (receiptAttempt.current?.fingerprint !== fingerprint) receiptAttempt.current = { fingerprint, id: crypto.randomUUID() }
    // One database transaction: stock + cost_price + receipt + optional expense.
    // Reusing the receipt ID makes retrying a lost response safe.
    const { data, error } = await db.rpc('pos_receive_stock_v2', { p_product_id: product.id, p_quantity: quantity, p_total: total, p_auto_expense: autoExpense, p_receipt_id: receiptAttempt.current!.id })
    if (error) throw new Error(`Không lưu được phiếu nhập: ${error.message}`)
    const saved = data as { stock: number; cost_price: number; receipt: StockImport }
    onChange(products.map((item) => item.id === product.id ? { ...item, stock: Number(saved.stock), costPrice: Number(saved.cost_price), cost: Number(saved.cost_price) } : item))
    await history.remember(saved.receipt)
    setReceiptQty(''); setReceiptTotal(''); receiptAttempt.current = null
    setMessage('Đã lưu phiếu nhập, cập nhật tồn kho và giá vốn.'); onReceived()
  })
  const voidImport = async (row: StockImport) => {
    if (!await confirm({ title: 'Hoàn tác phiếu nhập?', description: `Xóa phiếu nhập ${row.product_name} × ${row.quantity} sẽ hoàn tác tồn kho, giá vốn và khoản chi. Hệ thống sẽ chặn nếu hàng đã bán không còn đủ để hoàn tác.`, confirmLabel: 'Xóa phiếu' })) return
    void action(async () => {
      const { data, error } = await db.rpc('pos_void_stock_import', { p_id: row.id })
      if (error) throw new Error(`Không xóa được phiếu: ${error.message}`)
      onChange(products.map((item) => item.id === data.product_id ? { ...item, stock: Number(data.stock), costPrice: Number(data.cost_price), cost: Number(data.cost_price) } : item))
      await history.forget(row.id); setMessage('Đã xóa phiếu và hoàn tác tồn kho, giá vốn.'); onReceived()
    })
  }
  return <section className="min-w-0 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">Kho hàng</h1><p className="text-sm text-stone-500">Theo dõi số lượng và nhập hàng</p></div><button type="button" onClick={() => openEdit({ id: '', name: '', category: categories[0] ?? '', price: 0, costPrice: 0, stock: 0, barcode: '', accent: '', tag: '', productType: 'retail', is_imported: true })} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white">Thêm mặt hàng</button></div>
    <div className="grid gap-3 sm:grid-cols-2"><div className={panelClass}><p className="text-xs text-stone-500">Tổng số mặt hàng</p><p className="mt-1 text-2xl font-bold">{products.length} món</p></div><div className={panelClass}><p className="text-xs text-stone-500">Mặt hàng sắp hết</p><p className="mt-1 text-2xl font-bold text-red-600">{lowStock.length}</p></div></div>
    <div className="flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1">{([['stock', 'Tồn kho'], ['receiving', 'Nhập hàng'], ['audit', 'Kiểm kho']] as const).map(([key, label]) => <button key={key} type="button" disabled={saving} onClick={() => { setTab(key); setFailure(''); setMessage('') }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === key ? 'bg-white text-amber-700 shadow-sm' : 'text-stone-500'}`}>{label}</button>)}</div>
    {failure && <p role="alert" className="break-words rounded-lg bg-red-50 p-3 text-sm text-red-700">{failure}</p>}
    {message && <p role="status" className="break-words text-sm text-emerald-700">{message}</p>}
    {tab === 'receiving' ? <><Receiving products={products} categories={categories} selected={receiptProduct} setSelected={setReceiptProduct} qty={receiptQty} setQty={setReceiptQty} total={receiptTotal} setTotal={setReceiptTotal} autoExpense={autoExpense} setAutoExpense={setAutoExpense} onSave={receive} saving={saving} onScan={scan} onCamera={() => setCamera(true)} /><StockImportHistory imports={history.imports} loading={history.isLoading} offline={!!history.error || history.usingCache} busy={saving} onDelete={voidImport} /></> : <>
      <div className={panelClass}><div className="flex min-w-0 flex-wrap gap-2"><div className="relative w-full min-w-0 flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-stone-400" /><input aria-label="Tìm hàng trong kho" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && query.trim()) { event.preventDefault(); scan(query.trim()) } }} placeholder="Tên hàng hoặc mã Barcode / QR" className={`${inputClass} pl-10`} /></div><ScanButton onClick={() => setCamera(true)} /></div>
        {tab === 'stock' && <CategoryManager categories={categories} selected={category} onSelect={setCategory} onCreate={onCreateCategory} onDelete={onDeleteCategory} />}</div>
      {tab === 'stock' ? <div className="min-w-0 space-y-3 md:space-y-0 md:overflow-hidden md:rounded-2xl md:border md:border-stone-200 md:bg-white dark:md:bg-[#1C1714]">
        <div className="hidden grid-cols-[minmax(0,1fr)_90px_90px_150px_40px] gap-4 border-b px-4 py-3 text-xs text-stone-500 md:grid"><span>Hàng hóa</span><span>Giá vốn</span><span>Giá bán</span><span>Tồn kho</span><span>Sửa</span></div>
        {filtered.map((product) => <ProductRow key={product.id} product={product} onStock={updateStock} onEdit={openEdit} disabled={saving} />)}
        {!filtered.length && <p className="p-4 text-sm text-stone-500">Không có mặt hàng phù hợp.</p>}
      </div> : <StocktakeEditor products={products} visibleProducts={filtered} onSaved={(rows,sheet)=>{onChange(products.map((product)=>{const row=rows.find((item)=>item.id===product.id);return row?{...product,stock:Number(row.stock),costPrice:Number(row.cost_price),cost:Number(row.cost_price)}:product}));void checks.remember(sheet)}} />}
    </>}
    {editing && <EditModal product={editing} setProduct={setEditing} categories={categories} onSave={saveEdit} onDelete={deleteProduct} onClose={() => { if (!saving) setEditing(null) }} saving={saving} onCamera={() => setCamera(true)} failure={failure} />}
    {camera && <CameraScanner onScan={scan} onClose={() => setCamera(false)} />}
  </section>
}

function ProductRow({ product, onStock, onEdit, disabled }: { product: Product; onStock: (product: Product, stock: number) => void; onEdit: (product: Product) => void; disabled: boolean }) {
  const prep = !isRetail(product)
  return <article data-testid="inventory-card" className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm md:grid-cols-[minmax(0,1fr)_90px_90px_150px_40px] md:gap-4 md:rounded-none md:border-0 md:border-b md:shadow-none dark:bg-[#1C1714]">
    <div className="col-span-2 min-w-0 md:col-span-1"><div className="flex min-w-0 items-center gap-2">{product.imageUrl&&<ProductPhoto src={product.imageUrl} alt={`Ảnh ${product.name}`} className="size-9 shrink-0 rounded-lg object-cover"/>}<p className="min-w-0 break-words font-semibold text-stone-900 dark:text-stone-100">{product.name}</p></div><div className="mt-1 flex flex-wrap gap-2 text-xs"><span className="max-w-full break-words rounded-full bg-stone-100 px-2 py-0.5 text-stone-500">{product.category || 'Khác'}</span>{isIngredient(product)&&<span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">Nguyên liệu</span>}{prep && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">Pha chế / Nấu mới</span>}</div>{product.barcode && <p className="mt-1 break-all text-xs text-stone-400">{product.barcode}</p>}</div>
    <div className="col-span-2 min-w-0 md:col-span-1"><span className="mr-2 text-xs text-stone-500 md:hidden">Giá vốn</span><span data-testid="inventory-cost">{isRetail(product) || (product.costPrice ?? 0) > 0 ? money(product.costPrice ?? 0) : '—'}</span></div>
    <div className="col-span-2 min-w-0 font-semibold text-amber-700 md:col-span-1"><span className="mr-2 text-xs font-normal text-stone-500 md:hidden">Giá bán</span><span>{money(product.price)}</span></div>
    <div className="flex min-w-0 flex-wrap items-center gap-2"><div className="flex items-center rounded-lg border border-stone-200"><button disabled={disabled || !product.stock} type="button" aria-label={`Giảm tồn ${product.name}`} onClick={() => onStock(product, (product.stock ?? 0) - 1)} className="p-2.5 text-stone-500 disabled:opacity-40"><Minus className="size-3" /></button><span aria-label={`Tồn kho ${product.name}`} className="min-w-10 border-x px-2 text-center text-sm font-semibold">{formatNumber(product.stock ?? 0)}</span><button disabled={disabled} type="button" aria-label={`Tăng tồn ${product.name}`} onClick={() => onStock(product, (product.stock ?? 0) + 1)} className="p-2.5 text-stone-500"><Plus className="size-3" /></button></div><span className={`text-xs ${prep ? 'text-emerald-600' : (product.stock ?? 0) <= 5 ? 'text-red-600' : 'text-stone-500'}`}>{prep ? 'Đang chế biến' : `Còn ${formatNumber(product.stock ?? 0)}`}</span></div>
    <button disabled={disabled} type="button" onClick={() => onEdit(product)} aria-label={`Sửa ${product.name}`} className="justify-self-end rounded-lg p-2 text-stone-500 hover:bg-amber-50"><Pencil className="size-4" /></button>
  </article>
}

type ReceivingProps = { products: Product[]; categories: string[]; selected: string; setSelected: (value: string) => void; qty: string; setQty: (value: string) => void; total: string; setTotal: (value: string) => void; autoExpense: boolean; setAutoExpense: (value: boolean) => void; onSave: () => void; saving: boolean; onScan: (code: string) => void; onCamera: () => void }
function Receiving({ products, categories, selected, setSelected, qty, setQty, total, setTotal, autoExpense, setAutoExpense, onSave, saving, onScan, onCamera }: ReceivingProps) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const product = products.find((item) => item.id === selected)
  const matches = products.filter((item) => (!category || item.category === category) && matchesProduct(item, search)).slice(0, 20)
  let cost: number | null = null
  let average: number | null = null
  try { const receipt = receiptCost(qty, total); cost = receipt.costPrice; if (product) average = movingAverageCost(product.stock ?? 0, product.costPrice ?? 0, receipt.quantity, receipt.total) } catch {}
  return <form className={panelClass} onSubmit={(event) => { event.preventDefault(); onSave() }}>
    <h2 className="text-lg font-bold">Tạo phiếu nhập</h2>
    <fieldset disabled={saving} className="mt-4 min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap gap-2"><input aria-label="Tìm mặt hàng nhập" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onScan(search.trim()); setSearch(''); setCategory('') } }} placeholder="Tên hàng hoặc quét Barcode / QR rồi Enter" className={`${inputClass} flex-1`} /><ScanButton onClick={onCamera} /></div>
      <label className="block text-xs">Lọc nhóm hàng<select aria-label="Nhóm hàng nhập" value={category} onChange={(event) => setCategory(event.target.value)} className={`${inputClass} mt-1`}><option value="">Tất cả</option>{categories.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label className="block text-sm font-semibold">Mặt hàng đã chọn<select aria-label="Mặt hàng nhập" value={selected} onChange={(event) => setSelected(event.target.value)} required className={`${inputClass} mt-1`}><option value="">Chọn mặt hàng</option>{product && !matches.some((item) => item.id === product.id) && <option value={product.id}>{product.name}</option>}{matches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {product && <p className="break-words text-sm text-amber-700">Đang nhập: {product.name}</p>}
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Số lượng<input aria-label="Số lượng nhập" value={qty} onChange={(event) => setQty(event.target.value)} type="number" min="1" max={MAX_QUANTITY} step="1" required className={`${inputClass} mt-1`} /></label><label className="text-sm">Tổng tiền đợt nhập này<input aria-label="Tổng tiền nhập" value={total} onChange={(event) => setTotal(event.target.value.replace(/\D/g, ''))} type="text" inputMode="numeric" pattern="[0-9]*" required className={`${inputClass} mt-1`} /></label></div>
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Giá vốn / đơn vị: <strong>{cost === null ? '—' : money(cost)}</strong><span className="mt-1 block text-xs">Tổng tiền ÷ số lượng. Đơn giá của riêng đợt nhập, dùng để đối chứng phiếu.</span></p>
      <p className="text-sm">Giá vốn bình quân dự kiến sau nhập: <strong>{average === null ? '—' : money(average)}</strong></p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={autoExpense} onChange={(event) => setAutoExpense(event.target.checked)} className="mt-1" />Tự động ghi tổng tiền nhập hàng vào Sổ chi phí</label>
      <button type="submit" disabled={saving || cost === null || !selected} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Đang lưu...' : 'Lưu phiếu nhập'}</button>
    </fieldset>
  </form>
}

function EditModal({ product, setProduct, categories, onSave, onDelete, onClose, saving, onCamera, failure }: { product: Product; setProduct: (product: Product) => void; categories: string[]; onSave: () => void; onDelete: () => void; onClose: () => void; saving: boolean; onCamera: () => void; failure: string }) {
  const [imageBusy,setImageBusy]=useState(false)
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={()=>{if(!imageBusy&&!saving)onClose()}}><form role="dialog" aria-modal="true" aria-labelledby="edit-product-title" onSubmit={(event) => { event.preventDefault(); if(!imageBusy)onSave() }} className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#1C1714]" onClick={(event) => event.stopPropagation()}>
    <div className="mb-4 flex items-center justify-between"><h2 id="edit-product-title" className="text-lg font-bold">{product.id ? 'Sửa mặt hàng' : 'Thêm mặt hàng'}</h2><button type="button" disabled={saving||imageBusy} onClick={onClose} aria-label="Đóng sửa mặt hàng"><X /></button></div>
    <fieldset disabled={saving||imageBusy} className="space-y-3">
      <label className="block text-sm">Tên mặt hàng<input required value={product.name} onChange={(event) => setProduct({ ...product, name: event.target.value })} className={`${inputClass} mt-1`} /></label>
      <label className="block text-sm">Nhóm hàng<select aria-label="Nhóm hàng" value={product.category} required onChange={(event) => setProduct({ ...product, category: event.target.value })} className={`${inputClass} mt-1`}><option value="">Chọn nhóm</option>{categories.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label className="block text-sm">Barcode / QR<div className="mt-1 flex min-w-0 gap-2"><input aria-label="Mã sản phẩm" value={product.barcode ?? ''} onChange={(event) => setProduct({ ...product, barcode: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} className={inputClass} /><ScanButton onClick={onCamera} /></div></label>
      <label className="block text-sm">Giá bán<MoneyInput required disabled={isIngredient(product)} value={isIngredient(product)?0:product.price} onChange={(price) => setProduct({ ...product, price })} className={`${inputClass} mt-1`} /></label>
      <label className="block text-sm">Giá vốn<MoneyInput required value={product.costPrice ?? 0} onChange={(costPrice) => setProduct({ ...product, costPrice })} className={`${inputClass} mt-1`} /></label>
      <label className="block text-sm">Loại mặt hàng<select aria-label="Loại mặt hàng" value={isIngredient(product)?'ingredient':isRetail(product)?'retail':'processed'} onChange={(event) => setProduct({ ...product, productType: event.target.value as Product['productType'], is_imported: event.target.value !== 'processed', price:event.target.value==='ingredient'?0:product.price })} className={`${inputClass} mt-1`}><option value="retail">Hàng bán lẻ</option><option value="processed">Đồ chế biến</option><option value="ingredient">Nguyên liệu</option></select></label>
      <ProductImageEditor value={product.imageUrl??''} onChange={(imageUrl)=>setProduct({...product,imageUrl})} onBusy={setImageBusy}/>
      {failure && <p role="alert" className="break-words text-sm text-red-600">{failure}</p>}
      <div className="flex justify-between gap-2">{product.id && <button type="button" onClick={onDelete} className="flex items-center gap-1 text-sm text-red-600"><Trash2 className="size-4" /> Xóa món</button>}<button type="submit" className="ml-auto flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-sm text-white"><Check className="size-4" />{saving ? 'Đang lưu...' : 'Lưu'}</button></div>
    </fieldset>
  </form></div>
}
