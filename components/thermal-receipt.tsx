'use client'

import type { ReceiptOrder, ReceiptSettings } from '@/lib/receipts'
const money = (value: number) => value.toLocaleString('vi-VN')
export default function ThermalReceipt({ order, settings }: { order: ReceiptOrder; settings: ReceiptSettings }) {
  return <article className="thermal-receipt" style={{width:`${settings.paper_width}mm`}} aria-label={`Hóa đơn ${order.receipt_no}`}>
    <header className="receipt-center"><h2 className="receipt-store">{settings.store_name}</h2>{settings.subtitle && <p>{settings.subtitle}</p>}{settings.address && <p>{settings.address}</p>}{settings.phone && <p>ĐT: {settings.phone}</p>}</header>
    <div className="receipt-rule receipt-center"><h3>HÓA ĐƠN BÁN HÀNG</h3>{order.status==='voided'&&<p>ĐÃ HỦY</p>}{order.status==='refunded'&&<p>ĐÃ HOÀN TRẢ MỘT PHẦN / TOÀN BỘ</p>}<p>Mã bill: {order.receipt_no}</p><p>{new Date(order.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</p><p>{order.payment_method}</p></div>
    <table className="receipt-lines"><colgroup><col style={{width:'40%'}}/><col style={{width:'10%'}}/><col style={{width:'23%'}}/><col style={{width:'27%'}}/></colgroup><thead><tr><th>Tên món</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>{order.items.map((item,index)=><tr key={`${item.id}-${index}`}><td>{item.name}{item.note && <small className="block">({item.note})</small>}</td><td>{item.quantity}</td><td>{item.price == null ? '—' : money(item.price)}</td><td>{item.price == null ? '—' : money(item.price*item.quantity)}</td></tr>)}</tbody></table>
    <div className="receipt-rule"><p className="receipt-pair"><span>Tạm tính</span><b>{money(order.subtotal)}đ</b></p><p className="receipt-pair"><span>Giảm giá</span><b>{money(order.discount)}đ</b></p><p className="receipt-pair receipt-total"><span>TỔNG CỘNG</span><b>{money(order.total)}đ</b></p>{order.cash_received != null && <><p className="receipt-pair"><span>{order.status==='refunded'||order.status==='voided'?'Khách đưa ban đầu':'Khách đưa'}</span><b>{money(order.cash_received)}đ</b></p><p className="receipt-pair"><span>{order.status==='refunded'||order.status==='voided'?'Tiền thừa ban đầu':'Tiền thừa'}</span><b>{money(order.change_due ?? 0)}đ</b></p></>}</div>
    {settings.show_qr && order.qr_url && <div className="receipt-rule receipt-center"><img className="receipt-qr" src={order.qr_url} alt="QR chuyển khoản" /><p>Quét mã chuyển khoản</p></div>}
    {(order.status==='refunded'||order.status==='voided')&&<p className="receipt-pair receipt-rule"><span>Đã hoàn trả</span><b>{money((order.original_total??order.total)-order.total)}đ</b></p>}
    <footer className="receipt-rule receipt-center">{settings.wifi_name && <p>Wifi: {settings.wifi_name}</p>}{settings.wifi_password && <p>Mật khẩu: {settings.wifi_password}</p>}<p className="receipt-thanks">{settings.footer}</p></footer>
  </article>
}
