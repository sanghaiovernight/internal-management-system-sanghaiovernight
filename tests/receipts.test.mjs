import {test} from 'node:test'
import assert from 'node:assert/strict'
import {receiptSettings,receiptItems,normalizeOrder,filterOrders,vietnamDay,bankQr,parseVietnamDate} from '../lib/receipts.ts'
test('receipt defaults sanitize paper/booleans and preserve user text without interpreting HTML',()=>{
 const s=receiptSettings({paper_width:58,auto_print:true,store_name:'<script>text</script>'})
 assert.equal(s.paper_width,58);assert.equal(s.auto_print,true);assert.equal(s.store_name,'<script>text</script>')
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
 assert.equal(url.pathname,'/image/MB-12345678-compact2.png')
 assert.equal(url.searchParams.get('amount'),'78000');assert.equal(url.searchParams.get('addInfo'),'HD&123');assert.equal(url.searchParams.get('accountName'),'TEST OWNER')
 assert.equal(bankQr(0,'X',{...settings,bank_owner:''}),null)
})
