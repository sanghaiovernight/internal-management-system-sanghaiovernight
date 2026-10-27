'use client'

import { useMemo, useState } from 'react'
import { Minus, Plus, Search, ShoppingBag, Package, BarChart3, CreditCard, Banknote, Trash2, X, ChevronDown, ReceiptText, AlertTriangle, CircleDollarSign, Users, TrendingUp } from 'lucide-react'

import { Button } from '@/components/ui/button'

type Product = { id: string; name: string; category: 'retail' | 'recipe'; price: number; stock?: number; accent: string; tag: string }
type CartLine = Product & { quantity: number }

const products: Product[] = [
  { id: 'redbull', name: 'Bò húc', category: 'retail', price: 15000, stock: 24, accent: 'bg-[#e8f3ff] text-[#1769aa]', tag: 'Nước tăng lực' },
  { id: 'aquafina', name: 'Aquafina', category: 'retail', price: 10000, stock: 8, accent: 'bg-[#e8f8f0] text-[#147a55]', tag: 'Nước suối' },
  { id: 'coke', name: 'Coca Cola', category: 'retail', price: 12000, stock: 37, accent: 'bg-[#fff0ef] text-[#bd332c]', tag: 'Nước ngọt' },
  { id: 'milo', name: 'Milo hộp', category: 'retail', price: 12000, stock: 15, accent: 'bg-[#fff5e4] text-[#a8650b]', tag: 'Sữa & cacao' },
  { id: 'spicy-noodle', name: 'Mì cay hải sản', category: 'recipe', price: 39000, accent: 'bg-[#fff0e6] text-[#c65424]', tag: 'Món chế biến' },
  { id: 'peach-tea', name: 'Trà đào cam sả', category: 'recipe', price: 29000, accent: 'bg-[#fff0f1] text-[#c23d57]', tag: 'Món chế biến' },
  { id: 'chicken-rice', name: 'Cơm gà xối mỡ', category: 'recipe', price: 45000, accent: 'bg-[#fff6dc] text-[#a87508]', tag: 'Món chế biến' },
  { id: 'coffee', name: 'Cà phê sữa', category: 'recipe', price: 25000, accent: 'bg-[#f3ede8] text-[#79513e]', tag: 'Món chế biến' },
]

const money = (value: number) => `${value.toLocaleString('vi-VN')}đ`

export function PosDashboard() {
  const [activeTab, setActiveTab] = useState<'pos' | 'inventory' | 'reports'>('pos')
  const [cart, setCart] = useState<CartLine[]>([
    { ...products[4], quantity: 1 },
    { ...products[1], quantity: 2 },
  ])
  const [query, setQuery] = useState('')
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'transfer'>('cash')
  const [cashReceived, setCashReceived] = useState('')
  const [revenue, setRevenue] = useState(12845000)
  const [bills, setBills] = useState(342)

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + line.price * line.quantity, 0), [cart])
  const received = Number(cashReceived.replace(/\D/g, '')) || 0
  const change = received - subtotal
  const filteredProducts = products.filter((product) => product.name.toLowerCase().includes(query.toLowerCase()))
  const billCode = `HD${String(bills + 1).padStart(4, '0')}`
  const suggestions = [subtotal, 50000, 100000, 200000].filter((value, index, list) => value > 0 && list.indexOf(value) === index).slice(0, 4)

  function addToCart(product: Product) {
    setCart((current) => {
      const found = current.find((line) => line.id === product.id)
      return found ? current.map((line) => line.id === product.id ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { ...product, quantity: 1 }]
    })
  }

  function updateQuantity(id: string, delta: number) {
    setCart((current) => current.flatMap((line) => line.id !== id ? [line] : line.quantity + delta <= 0 ? [] : [{ ...line, quantity: line.quantity + delta }]))
  }

  function completePayment() {
    setRevenue((value) => value + subtotal)
    setBills((value) => value + 1)
    setCart([])
    setCashReceived('')
    setPaymentOpen(false)
  }

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-[#16202a]">
      <header className="border-b border-[#e8ebee] bg-white">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-[#0d7655] text-white"><ShoppingBag /></div><div><p className="text-lg font-bold tracking-tight">Sangha<span className="text-[#0d7655]">.POS</span></p><p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8b959e]">Convenience & F&B</p></div></div>
          <div className="hidden items-center gap-6 text-sm text-[#7d8790] md:flex"><span className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#21ae70]" /> Hệ thống đang hoạt động</span><span className="h-5 w-px bg-[#e8ebee]" /><span>Ca sáng · NV. Minh Anh</span><div className="grid size-9 place-items-center rounded-full bg-[#f1e5d6] text-sm font-bold text-[#9c6c31]">MA</div></div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-5 py-5 lg:px-8">
        <nav className="mb-6 flex gap-1 rounded-xl border border-[#e9edef] bg-white p-1.5 shadow-sm md:w-fit">
          {([['pos', 'POS', CreditCard], ['inventory', 'Kho hàng', Package], ['reports', 'Báo cáo', BarChart3]] as const).map(([key, label, Icon]) => <button key={key} onClick={() => setActiveTab(key)} className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition ${activeTab === key ? 'bg-[#0d7655] text-white shadow-sm' : 'text-[#7b858e] hover:bg-[#f3f6f5]'}`}><Icon />{label}</button>)}
        </nav>

        {activeTab === 'pos' && <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_370px]">
          <section className="min-w-0"><div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-1 text-sm font-medium text-[#89939b]">Thứ Hai, 27 tháng 10, 2026</p><h1 className="text-2xl font-bold tracking-tight">Bắt đầu bán hàng</h1></div><div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a4adb4]" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm món, sản phẩm..." className="h-11 w-full rounded-xl border border-[#e1e6e9] bg-white pl-10 pr-4 text-sm outline-none transition focus:border-[#0d7655] focus:ring-2 focus:ring-[#0d7655]/10" /></div></div><div className="mb-4 flex items-center justify-between"><h2 className="text-sm font-bold">Tất cả sản phẩm <span className="ml-1 font-normal text-[#9aa3aa]">({filteredProducts.length})</span></h2><button className="flex items-center gap-1 text-xs font-semibold text-[#0d7655]">Bộ lọc <ChevronDown /></button></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{filteredProducts.map((product) => <button key={product.id} onClick={() => addToCart(product)} className="group rounded-2xl border border-[#e8edef] bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#a5cebe] hover:shadow-md"><div className={`mb-3 flex h-28 items-center justify-center rounded-xl ${product.accent}`}><span className="text-center text-3xl font-black tracking-tighter opacity-80">{product.category === 'recipe' ? 'F&B' : product.name.slice(0, 2).toUpperCase()}</span></div><p className="mb-1 truncate text-sm font-bold">{product.name}</p><p className="mb-3 text-[11px] text-[#8d979f]">{product.tag}</p><div className="flex items-center justify-between"><span className="text-sm font-bold text-[#0d7655]">{money(product.price)}</span><span className="grid size-7 place-items-center rounded-lg bg-[#eff7f3] text-[#0d7655] transition group-hover:bg-[#0d7655] group-hover:text-white"><Plus /></span></div></button>)}</div></section>
          <CartPanel cart={cart} subtotal={subtotal} updateQuantity={updateQuantity} onCheckout={() => cart.length > 0 && setPaymentOpen(true)} />
        </div>}

        {activeTab === 'inventory' && <InventoryView />}
        {activeTab === 'reports' && <ReportsView revenue={revenue} bills={bills} />}
      </div>

      {paymentOpen && <PaymentModal subtotal={subtotal} method={paymentMethod} setMethod={setPaymentMethod} received={received} cashReceived={cashReceived} setCashReceived={setCashReceived} change={change} suggestions={suggestions} billCode={billCode} onClose={() => setPaymentOpen(false)} onComplete={completePayment} />}
    </main>
  )
}

function CartPanel({ cart, subtotal, updateQuantity, onCheckout }: { cart: CartLine[]; subtotal: number; updateQuantity: (id: string, delta: number) => void; onCheckout: () => void }) {
  return <aside className="sticky bottom-0 flex h-fit flex-col rounded-2xl border border-[#e1e7e5] bg-white shadow-sm lg:top-5"><div className="flex items-center justify-between border-b border-[#edf0f1] p-5"><div><h2 className="font-bold">Giỏ hàng</h2><p className="mt-1 text-xs text-[#9aa3a9]">{cart.reduce((sum, line) => sum + line.quantity, 0)} sản phẩm</p></div><span className="rounded-full bg-[#edf7f3] px-2.5 py-1 text-xs font-bold text-[#0d7655]">Đang mở</span></div><div className="flex max-h-[370px] flex-col gap-3 overflow-y-auto p-4">{cart.length === 0 ? <div className="grid min-h-48 place-items-center text-center text-sm text-[#99a2a9]"><ShoppingBag className="mb-2 text-[#c7ced2]" /><p>Chưa có sản phẩm</p></div> : cart.map((line) => <div key={line.id} className="flex items-center gap-3 rounded-xl bg-[#fafbfb] p-2.5"><div className={`grid size-11 shrink-0 place-items-center rounded-lg text-xs font-black ${line.accent}`}>{line.category === 'recipe' ? 'F&B' : line.name.slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{line.name}</p><p className="mt-1 text-xs text-[#8b959d]">{money(line.price)}</p></div><div className="flex items-center gap-1 rounded-lg border border-[#e2e7e8] bg-white p-0.5"><button aria-label={`Giảm ${line.name}`} onClick={() => updateQuantity(line.id, -1)} className="grid size-6 place-items-center text-[#78838b]"><Minus /></button><span className="w-5 text-center text-xs font-bold">{line.quantity}</span><button aria-label={`Tăng ${line.name}`} onClick={() => updateQuantity(line.id, 1)} className="grid size-6 place-items-center text-[#0d7655]"><Plus /></button></div><p className="w-20 text-right text-sm font-bold">{money(line.price * line.quantity)}</p></div>)}</div><div className="mt-auto border-t border-[#edf0f1] p-5"><div className="mb-4 flex justify-between text-sm text-[#78838b]"><span>Tạm tính</span><span className="font-semibold text-[#27323a]">{money(subtotal)}</span></div><div className="mb-5 flex items-end justify-between"><span className="font-bold">Tổng cộng</span><span className="text-2xl font-black text-[#0d7655]">{money(subtotal)}</span></div><Button onClick={onCheckout} className="h-12 w-full rounded-xl bg-[#0d7655] text-base font-bold shadow-[0_8px_20px_-8px_rgba(13,118,85,0.7)] hover:bg-[#095d43]"><Banknote data-icon="inline-start" /> Thanh toán</Button></div></aside>
}

function InventoryView() { return <section><div className="mb-6"><p className="mb-1 text-sm text-[#89939b]">Theo dõi số lượng sản phẩm</p><h1 className="text-2xl font-bold tracking-tight">Kho hàng</h1></div><div className="grid gap-4 md:grid-cols-3">{products.filter((product) => product.category === 'retail').map((product) => <div key={product.id} className="rounded-2xl border border-[#e7ebed] bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div className={`grid size-12 place-items-center rounded-xl text-sm font-black ${product.accent}`}>{product.name.slice(0, 2).toUpperCase()}</div>{product.stock! < 10 && <span className="flex items-center gap-1 rounded-full bg-[#fff0ef] px-2 py-1 text-[11px] font-bold text-[#c03b34]"><AlertTriangle /> Sắp hết</span>}</div><p className="mt-4 font-bold">{product.name}</p><p className="mt-1 text-xs text-[#929ba2]">{product.tag}</p><div className="mt-5 flex items-end justify-between"><span className="text-3xl font-black">{product.stock}</span><span className="text-xs text-[#929ba2]">đơn vị tồn kho</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf0f1]"><div className={`h-full rounded-full ${product.stock! < 10 ? 'bg-[#d65b51]' : 'bg-[#45ad7c]'}`} style={{ width: `${Math.min(product.stock! * 2.5, 100)}%` }} /></div></div>)}</div></section> }

function ReportsView({ revenue, bills }: { revenue: number; bills: number }) { const average = bills ? Math.round(revenue / bills) : 0; return <section><div className="mb-6"><p className="mb-1 text-sm text-[#89939b]">Tổng quan hoạt động kinh doanh</p><h1 className="text-2xl font-bold tracking-tight">Báo cáo hôm nay</h1></div><div className="grid gap-4 md:grid-cols-3"><Metric icon={CircleDollarSign} label="Tổng doanh thu" value={money(revenue)} helper="So với hôm qua +12.4%" /><Metric icon={Users} label="TC · Tổng lượt khách" value={bills.toLocaleString('vi-VN')} helper="Số bill đã hoàn tất" /><Metric icon={TrendingUp} label="TA · Trung bình bill" value={money(average)} helper="Doanh thu trung bình / bill" /></div><div className="mt-5 rounded-2xl border border-[#e7ebed] bg-white p-6"><div className="flex items-center justify-between"><div><h2 className="font-bold">Doanh thu theo giờ</h2><p className="mt-1 text-xs text-[#929ba2]">Dữ liệu trong ngày hôm nay</p></div><span className="rounded-lg bg-[#eff7f3] px-3 py-1.5 text-xs font-bold text-[#0d7655]">Hôm nay</span></div><div className="mt-7 flex h-44 items-end gap-2 border-b border-[#edf0f1] px-2">{[35, 48, 42, 66, 58, 72, 53, 85, 62, 76, 48, 69, 92, 74].map((height, index) => <div key={index} className="group flex flex-1 flex-col items-center justify-end gap-2"><div className={`w-full max-w-12 rounded-t-md transition group-hover:bg-[#0d7655] ${index === 12 ? 'bg-[#0d7655]' : 'bg-[#b9dfd0]'}`} style={{ height: `${height}%` }} /></div>)}</div><div className="mt-3 flex justify-between px-2 text-[10px] text-[#a1aab0]"><span>08:00</span><span>12:00</span><span>16:00</span><span>20:00</span></div></div></section> }

function Metric({ icon: Icon, label, value, helper }: { icon: typeof CircleDollarSign; label: string; value: string; helper: string }) { return <div className="rounded-2xl border border-[#e7ebed] bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-[#edf7f3] text-[#0d7655]"><Icon /></div><span className="text-sm font-medium text-[#76828a]">{label}</span></div><p className="mt-5 text-2xl font-black tracking-tight">{value}</p><p className="mt-2 text-xs text-[#45a778]">{helper}</p></div> }

function PaymentModal({ subtotal, method, setMethod, received, cashReceived, setCashReceived, change, suggestions, billCode, onClose, onComplete }: { subtotal: number; method: 'cash' | 'transfer'; setMethod: (method: 'cash' | 'transfer') => void; received: number; cashReceived: string; setCashReceived: (value: string) => void; change: number; suggestions: number[]; billCode: string; onClose: () => void; onComplete: () => void }) { return <div className="fixed inset-0 z-50 grid place-items-center bg-[#16202a]/45 p-4 backdrop-blur-sm"><div role="dialog" aria-modal="true" aria-labelledby="payment-title" className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#edf0f1] p-5"><div><h2 id="payment-title" className="text-lg font-bold">Thanh toán đơn hàng</h2><p className="mt-1 text-xs text-[#929ba2]">Mã bill: {billCode}</p></div><button aria-label="Đóng" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-[#8d979e] hover:bg-[#f3f5f5]"><X /></button></div><div className="p-5"><div className="mb-5 rounded-xl bg-[#f4faf7] p-4 text-center"><p className="text-xs font-medium text-[#7e8e87]">Tổng cần thanh toán</p><p className="mt-1 text-3xl font-black text-[#0d7655]">{money(subtotal)}</p></div><div className="mb-5 grid grid-cols-2 rounded-xl bg-[#f5f7f7] p-1"><button onClick={() => setMethod('cash')} className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold ${method === 'cash' ? 'bg-white text-[#0d7655] shadow-sm' : 'text-[#8b959c]'}`}><Banknote /> Tiền mặt</button><button onClick={() => setMethod('transfer')} className={`flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold ${method === 'transfer' ? 'bg-white text-[#0d7655] shadow-sm' : 'text-[#8b959c]'}`}><CreditCard /> Chuyển khoản</button></div>{method === 'cash' ? <div><label htmlFor="cash" className="mb-2 block text-sm font-semibold">Tiền khách đưa</label><input id="cash" inputMode="numeric" value={cashReceived} onChange={(event) => setCashReceived(event.target.value.replace(/\D/g, ''))} placeholder="Nhập số tiền..." className="h-12 w-full rounded-xl border border-[#dfe5e6] px-4 text-lg font-bold outline-none focus:border-[#0d7655] focus:ring-2 focus:ring-[#0d7655]/10" /><div className="mt-3 grid grid-cols-4 gap-2">{suggestions.map((amount) => <button key={amount} onClick={() => setCashReceived(String(amount))} className="rounded-lg border border-[#dfe5e6] py-2 text-xs font-bold text-[#53616a] hover:border-[#79bda5] hover:text-[#0d7655]">{amount >= 1000 ? `${amount / 1000}k` : amount}</button>)}</div><div className={`mt-5 flex items-center justify-between rounded-xl p-4 ${received > 0 && change < 0 ? 'bg-[#fff0ef] text-[#c23d36]' : 'bg-[#f5f7f7]'}`}><span className="text-sm font-medium">{received > 0 && change < 0 ? 'Còn thiếu' : 'Tiền thừa trả khách'}</span><span className="text-xl font-black">{money(Math.abs(received > 0 && change < 0 ? change : Math.max(change, 0)))}</span></div></div> : <div className="flex flex-col items-center"><img src={`https://img.vietqr.io/image/mbbank-123456-compact2.png?amount=${subtotal}&addInfo=Sanghai${billCode}`} alt="Mã QR thanh toán VietQR" className="size-52 rounded-xl border border-[#e5eaea] object-contain" /><p className="mt-3 text-sm font-semibold">Quét mã để thanh toán</p><p className="mt-1 text-xs text-[#929ba2]">MB Bank · Sangha Convenience</p></div>}<Button disabled={method === 'cash' && (received < subtotal)} onClick={onComplete} className="mt-5 h-12 w-full rounded-xl bg-[#0d7655] text-base font-bold hover:bg-[#095d43]">Hoàn tất thu tiền</Button></div></div></div> }
