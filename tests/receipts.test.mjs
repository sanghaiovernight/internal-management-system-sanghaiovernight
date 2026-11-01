import {test} from 'node:test'
import assert from 'node:assert/strict'
import {receiptSettings,receiptItems,normalizeOrder,filterOrders,vietnamDay,bankQr,parseVietnamDate,receiptQrUrl} from '../lib/receipts.ts'
test('receipt defaults sanitize paper/booleans and preserve user text without interpreting HTML',()=>{
 const s=receiptSettings({paper_width:58,auto_print:true,store_name:'<script>text</script>'})
 assert.equal(s.paper_width,80);assert.equal(s.auto_print,true);assert.equal(s.store_name,'<script>text</script>')
 assert.equal(receiptSettings({paper_width:99,auto_print:'true'}).paper_width,80)
 assert.equal(receiptSettings({auto_print:'true'}).auto_print,false)
})
test('history preserves numeric snapshots and never substitutes current product price',()=>{
 const order=normalizeOrder({id:'1',receipt_no:'HD1',created_at:'2026-10-31T18:00:00Z',payment_method:'Tiền mặt',items:'[{"name":"Mì","quantity":2,"price":12000}]',subtotal:24000,total:20000,discount:4000})
 assert.equal(order.items[0].price,12000);assert.equal(order.total,20000)
 assert.equal(receiptItems('Old bill')[0].price,null)
 assert.equal(vietnamDay(order.created_at),'2026-11-01')
 assert.equal(filterOrders([order],'2026-11-01','mì').length,1)
 assert.equal(filterOrders([order],'2026-10-31','').length,0)
 assert.equal(filterOrders([order],'','hd1').length,1)
})

test('legacy nested JSON is decoded without displaying raw JSON names',()=>{
 const items=[{name:'Cà phê',quantity:2,price:12000}]
 for(const raw of [items,JSON.stringify(items),JSON.stringify(JSON.stringify(items)),[{name:JSON.stringify(items),quantity:1,price:null}]]) {
  const decoded=receiptItems(raw);assert.equal(decoded[0].name,'Cà phê');assert.equal(decoded[0].quantity,2);assert.equal(decoded[0].price,12000)
 }
 assert.deepEqual(receiptItems('[broken JSON'),[])
})
test('Vietnam date parsing validates actual calendar days, including leap years',()=>{
 assert.equal(parseVietnamDate('01/11/2026'),'2026-11-01')
 assert.equal(parseVietnamDate('29/02/2024'),'2024-02-29')
 for(const value of ['29/02/2026','31/04/2026','11/31/2026','2026-11-01'])assert.equal(parseVietnamDate(value),null)
 assert.equal(parseVietnamDate(''),'')
})
test('VietQR requires all three bank fields and uses the actual amount/bill code',()=>{
 const settings=receiptSettings({bank_name:'mb',bank_account:'12345678',bank_owner:'TEST OWNER'})
 const url=new URL(bankQr(78000,'HD&123',settings))
 assert.equal(url.pathname,'/image/MB-12345678-qr_only.png')
 assert.equal(url.searchParams.get('amount'),'78000');assert.equal(url.searchParams.get('addInfo'),'HD&123');assert.equal(url.searchParams.get('accountName'),'TEST OWNER')
 assert.equal(bankQr(0,'X',{...settings,bank_owner:''}),null)
})

test('partial-return preview keeps discount ratio and stable IDs after an earlier line reaches zero',async()=>{
 const {refundPreview}=await import('../lib/receipts.ts')
 const order=normalizeOrder({id:'r',receipt_no:'HD0111001',created_at:'2026-11-01T00:00:00Z',items:[{id:'a',line_id:'1',name:'A',quantity:0,price:10000},{id:'b',line_id:'2',name:'B',quantity:2,price:10000}],subtotal:20000,total:15000,original_subtotal:40000,original_total:30000})
 assert.equal(order.items.length,1);assert.equal(order.items[0].line_id,'2')
 assert.deepEqual(refundPreview(order,[{line_id:'2',quantity:1}]),{subtotal:10000,total:7500,refund:7500})
 assert.deepEqual(refundPreview(order,[{line_id:'2',quantity:0}]),{subtotal:0,total:0,refund:15000})
 assert.throws(()=>refundPreview(order,[{line_id:'2',quantity:3}]))
 assert.throws(()=>refundPreview(order,[{line_id:'2',quantity:-1}]))
})

test('document display never leaks UUID/timestamp IDs and timestamps use fixed Vietnamese format',async()=>{
 const {shortDocumentNumber,formatVietnamTimestamp}=await import('../lib/document-numbers.ts')
 const stamp='2026-10-31T17:05:09Z'
 assert.equal(formatVietnamTimestamp(stamp),'01/11/2026 00:05:09')
 assert.equal(shortDocumentNumber('PN',stamp,'da26a1b0-0000-4000-8000-000000000000'),'PN0111—')
 assert.equal(shortDocumentNumber('PN',stamp,'PN0111001'),'PN0111001')
 assert.equal(shortDocumentNumber('HD',stamp,'HD1793470000000','HD0111012'),'HD0111012')
 assert.equal(shortDocumentNumber('PN',stamp,'PN01111000'),'PN01111000')
})

test('reprints switch legacy VietQR templates without changing saved payment details',()=>{
 for(const template of ['compact2','print','compact','qr_only']) {
  const original=`https://img.vietqr.io/image/MB-00123456-${template}.png?amount=78000&addInfo=HD%26123&accountName=TEST%20OWNER`
  assert.equal(receiptQrUrl(original),'https://img.vietqr.io/image/MB-00123456-qr_only.png?amount=78000&addInfo=HD%26123&accountName=TEST%20OWNER')
 }
 assert.equal(receiptQrUrl('https://example.com/compact2.png'),'https://example.com/compact2.png')
})
