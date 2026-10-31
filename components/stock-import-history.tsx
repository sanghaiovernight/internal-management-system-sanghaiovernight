'use client'

import { shortDocumentNumber,formatVietnamTimestamp } from '@/lib/document-numbers'
import type { StockImport } from '@/lib/hooks/use-stock-imports'
const money = (value: number) => `${Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}đ`
export default function StockImportHistory({ imports, loading, offline, busy, onDelete }: { imports: StockImport[]; loading: boolean; offline: boolean; busy: boolean; onDelete: (row: StockImport) => void }) {
  return <section className="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 dark:bg-[#1C1714]" aria-labelledby="stock-import-history">
    <h2 id="stock-import-history" className="mb-3 text-lg font-bold">Lịch sử nhập kho</h2>
    {offline && <p role="status" className="mb-3 text-sm text-amber-700">Chưa tải được lịch sử từ máy chủ. Đang hiển thị bản lưu trên thiết bị này (nếu có).</p>}
    <div className="w-full overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr className="border-b text-xs text-stone-500"><th className="p-2">Mã phiếu nhập</th><th className="p-2">Thời gian nhập</th><th className="p-2">Tên mặt hàng</th><th className="p-2">Số lượng nhập</th><th className="p-2">Giá vốn đợt nhập</th><th className="p-2">Tổng tiền phiếu</th><th className="p-2">Thao tác</th></tr></thead>
      <tbody>{imports.map((row) => <tr key={row.id} className="border-b"><td className="p-2 font-semibold text-amber-700">{shortDocumentNumber('PN',row.created_at,row.receipt_no)}</td><td className="p-2">{formatVietnamTimestamp(row.created_at)}</td><td className="p-2">{row.product_name}</td><td className="p-2">{row.quantity}</td><td className="p-2">{money(row.unit_cost)}</td><td className="p-2">{money(row.total_cost)}</td><td className="p-2"><button type="button" disabled={busy || !row.reversible} title={row.reversible ? 'Xóa và hoàn tác tồn kho, giá vốn, khoản chi của phiếu' : 'Phiếu cũ chưa có dữ liệu đối chứng để hoàn tác an toàn'} aria-label={`Xóa phiếu nhập ${shortDocumentNumber('PN',row.created_at,row.receipt_no)}`} onClick={() => onDelete(row)} className="rounded-lg px-2 py-1 text-red-600 disabled:text-stone-400">Xóa phiếu</button></td></tr>)}</tbody>
    </table></div>
    {!imports.length && <p className="py-4 text-sm text-stone-500">{loading ? 'Đang tải lịch sử...' : 'Chưa có phiếu nhập kho.'}</p>}
  </section>
}
