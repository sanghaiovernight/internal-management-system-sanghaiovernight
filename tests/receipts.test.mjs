import {test} from 'node:test'
import assert from 'node:assert/strict'
import {receiptSettings,receiptItems,normalizeOrder,filterOrders,vietnamDay} from '../lib/receipts.ts'
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
