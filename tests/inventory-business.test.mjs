import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

let db
before(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create table public.pos_products(id text primary key,name text,category text,tag text,product_type text,is_imported boolean,stock numeric,price numeric);
    create table public.pos_expenses(id uuid primary key,description text,amount numeric,spent_at timestamptz);
    create table public.pos_transactions(code text primary key,date_time timestamptz,total numeric,method text,items text);
    grant select,update on public.pos_products to anon;
    grant select,insert,delete on public.pos_expenses to anon;
    grant select,insert on public.pos_transactions to anon;
  `)
  for (const file of ['202610310001_catalog_and_receiving.sql', '202611010001_inventory_business_rules.sql','202611010002_receipts_and_printing.sql','202611010003_checkout_jsonb_and_bank.sql','202611010004_short_receipts_returns_activity.sql','202611010005_short_import_numbers.sql']) {
    const sql = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
    await db.exec(sql)
    await db.exec(sql) // Idempotent setup and existing-table upgrade.
  }
  for(const part of ['01_schema_and_compat.sql','02_inventory_replay.sql','03_short_receipt_checkout.sql','04_returns_and_void.sql']) {
    const sql=await readFile(new URL(`../supabase/manual/202611010004/${part}`,import.meta.url),'utf8'); await db.exec(sql); await db.exec(sql)
  }
  await db.exec('set role anon')
})
after(async () => { await db?.close() })
async function product(stock, cost, retail = true, category = 'Nhóm thử') {
  const id = randomUUID()
  await db.exec('reset role')
  await db.query('insert into public.pos_products(id,name,category,tag,is_imported,product_type,stock,price,cost_price) values($1,$2,$3,$3,$4,$5,$6,10000,$7)', [id, 'Mặt hàng thử', category, retail, retail ? 'retail' : 'fnb', stock, cost])
  await db.exec('set role anon')
  return id
}
async function read(id) { const p = (await db.query('select stock,cost_price,category,is_imported from public.pos_products where id=$1', [id])).rows[0]; return { ...p, stock: Number(p.stock), cost_price: Number(p.cost_price) } }
const receive = async (id, qty, total, receipt = randomUUID(), expense = false) => (await db.query('select public.pos_receive_stock_v2($1,$2,$3,$4,$5) as result', [id,qty,total,expense,receipt])).rows[0].result
const voidImport = async (id) => (await db.query('select public.pos_void_stock_import($1) as result', [id])).rows[0].result
async function checkout(lines, code = randomUUID(), total = 0) { return (await db.query('select public.pos_checkout($1,$2::jsonb,$3,$4,now()) as result', [code,JSON.stringify(lines.map(([id,quantity]) => ({ id,quantity,price:10000 }))),total,'Tiền mặt'])).rows[0].result }

test('weighted average uses existing positive stock and rounds once', async () => {
  const id = await product(10,6000)
  const result = await receive(id,5,45000)
  assert.equal(result.stock,15); assert.equal(result.cost_price,7000)
  assert.equal(result.receipt.unit_cost,9000); assert.equal(result.receipt.total_cost,45000)
  assert.equal(result.receipt.stock_before,10); assert.equal(result.receipt.cost_before,6000)
})
test('zero/negative opening stocks do not dilute the incoming cost; raw stock still increases', async () => {
  for (const [stock, next] of [[0,3],[-2,1]]) {
    const id = await product(stock,9000)
    const result = await receive(id,3,100)
    assert.equal(result.stock,next); assert.equal(result.cost_price,33)
    assert.ok(Math.abs(result.receipt.unit_cost-100/3)<1e-10)
  }
})
test('retry is idempotent; changed contents cannot reuse a receipt UUID', async () => {
  const id = await product(10,6000); const receipt = randomUUID()
  await receive(id,5,45000,receipt)
  await receive(id,5,45000,receipt)
  assert.equal((await read(id)).stock,15)
  await assert.rejects(receive(id,6,45000,receipt),/Mã phiếu/)
})
test('void restores stock/cost and removes matching expense exactly once', async () => {
  const id = await product(10,6000); const receipt = randomUUID()
  await receive(id,5,45000,receipt,true)
  await voidImport(receipt); await voidImport(receipt)
  assert.equal((await read(id)).stock,10); assert.equal((await read(id)).cost_price,6000)
  assert.equal((await db.query('select count(*)::int as n from public.pos_expenses where id=$1',[receipt])).rows[0].n,0)
})
test('voiding an older import replays later sales and imports with moving average rounding', async () => {
  const id = await product(10,6000)
  const first = await receive(id,5,45000)
  await checkout([[id,3]])
  await receive(id,4,40000)
  await voidImport(first.receipt.id)
  const p = await read(id)
  assert.equal(p.stock,11)
  assert.equal(p.cost_price,Math.round((7*6000+40000)/11))
})
test('rounding is reversible even when receipt is not the latest; later void remains correct', async () => {
  const id = await product(1,1)
  const a = await receive(id,2,4)
  const b = await receive(id,3,11)
  await voidImport(a.receipt.id)
  assert.equal((await read(id)).cost_price,3)
  await voidImport(b.receipt.id)
  assert.equal((await read(id)).cost_price,1); assert.equal((await read(id)).stock,1)
})
test('manual counts remain absolute when an older import is voided', async () => {
  const id = await product(10,6000)
  const a = await receive(id,5,45000)
  await db.query('update public.pos_products set stock=20 where id=$1',[id])
  await voidImport(a.receipt.id)
  assert.equal((await read(id)).stock,20); assert.equal((await read(id)).cost_price,6000)
})
test('cannot void an import whose units are required by completed retail sales', async () => {
  const id = await product(0,6000)
  const a = await receive(id,5,45000)
  await checkout([[id,3]])
  await assert.rejects(voidImport(a.receipt.id),/hàng của phiếu đã được bán/)
  assert.equal((await read(id)).stock,2)
  assert.equal((await db.query('select voided_at from public.pos_stock_imports where id=$1',[a.receipt.id])).rows[0].voided_at,null)
})
test('retail stock zero is blocked; prepared stock zero can be sold indefinitely', async () => {
  const retail = await product(0,6000,true); const prep = await product(0,0,false)
  await assert.rejects(checkout([[retail,1]]),/không đủ tồn kho/)
  await checkout([[prep,99]])
  assert.equal((await read(prep)).stock,0)
})
test('prepared positive stock decrements to zero without restricting sale quantity', async () => {
  const id = await product(2,0,false)
  await checkout([[id,5]])
  assert.equal((await read(id)).stock,0)
})
test('checkout aggregates duplicate lines and rolls back the whole mixed cart when retail stock is insufficient', async () => {
  const retail = await product(3,6000,true); const prep = await product(4,0,false)
  await assert.rejects(checkout([[prep,1],[retail,2],[retail,2]]),/không đủ tồn kho/)
  assert.equal((await read(retail)).stock,3); assert.equal((await read(prep)).stock,4)
})
test('checkout is idempotent and a second bill cannot oversell the remaining stock', async () => {
  const id = await product(2,6000); const code = randomUUID()
  await checkout([[id,2]],code); await checkout([[id,2]],code)
  assert.equal((await read(id)).stock,0)
  await assert.rejects(checkout([[id,1]]),/không đủ tồn kho/)
})
test('a failed bill insert rolls stock back; journal cannot be forged by the public role', async () => {
  const id = await product(5,6000)
  await db.exec('reset role; revoke insert on public.pos_transactions from anon; set role anon')
  await assert.rejects(checkout([[id,2]]),/permission denied/)
  assert.equal((await read(id)).stock,5)
  await db.exec('reset role; grant insert on public.pos_transactions to anon; set role anon')
  await assert.rejects(db.exec("delete from public.pos_inventory_events"),/permission denied/)
})
test('delete category atomically moves products to default and removes registry label', async () => {
  const category = 'Nhóm cần xóa'
  const id = await product(3,6000,true,category)
  await db.query('insert into public.pos_categories(name) values($1)',[category])
  await db.query('select public.pos_delete_category($1)',[category])
  assert.equal((await read(id)).category,'Chưa phân loại')
  assert.equal((await db.query('select name from public.pos_categories where name=$1',[category])).rows.length,0)
  await assert.rejects(db.query("select public.pos_delete_category('Chưa phân loại')"),/nhóm mặc định/)
})

test('explicit is_imported overrides a conflicting legacy product_type', async () => {
  const retail = await product(0,6000,true)
  const prep = await product(0,0,false)
  await db.query("update public.pos_products set product_type='fnb' where id=$1",[retail])
  await db.query("update public.pos_products set product_type='retail' where id=$1",[prep])
  await assert.rejects(checkout([[retail,1]]),/không đủ tồn kho/)
  await checkout([[prep,1]])
})
test('v2 receiving rolls back all changes when expense insertion is denied', async () => {
  const id = await product(10,6000); const receipt = randomUUID()
  await db.exec('reset role; revoke insert on public.pos_expenses from anon; set role anon')
  await assert.rejects(receive(id,5,45000,receipt,true),/permission denied/)
  assert.equal((await read(id)).stock,10); assert.equal((await read(id)).cost_price,6000)
  assert.equal((await db.query('select count(*)::int as n from public.pos_stock_imports where id=$1',[receipt])).rows[0].n,0)
  await db.exec('reset role; grant insert on public.pos_expenses to anon; set role anon')
})
test('RLS silently filtering an expense delete cannot leave a half-reversed receipt', async () => {
  const id = await product(10,6000); const receipt = randomUUID()
  await receive(id,5,45000,receipt,true)
  await db.exec(`reset role;
    alter table public.pos_expenses enable row level security;
    create policy test_read_expenses on public.pos_expenses for select to anon using(true);
    set role anon;`)
  await assert.rejects(voidImport(receipt),/Không có quyền hoàn tác khoản chi/)
  assert.equal((await read(id)).stock,15); assert.equal((await read(id)).cost_price,7000)
  assert.equal((await db.query('select voided_at from public.pos_stock_imports where id=$1',[receipt])).rows[0].voided_at,null)
  await db.exec('reset role; alter table public.pos_expenses disable row level security; drop policy test_read_expenses on public.pos_expenses; set role anon')
})
test('category delete rolls back if product RLS prevents reassignment', async () => {
  const category = 'Nhóm bảo vệ'; const id = await product(10,6000,true,category)
  await db.query('insert into public.pos_categories(name) values($1)',[category])
  await db.exec(`reset role;
    alter table public.pos_products enable row level security;
    create policy test_read_products on public.pos_products for select to anon using(true);
    set role anon;`)
  await assert.rejects(db.query('select public.pos_delete_category($1)',[category]),/Không có quyền chuyển nhóm/)
  assert.equal((await read(id)).category,category)
  assert.equal((await db.query('select name from public.pos_categories where name=$1',[category])).rows.length,1)
  await db.exec('reset role; alter table public.pos_products disable row level security; drop policy test_read_products on public.pos_products; set role anon')
})

const payReceipt = async (id,code=randomUUID(),received=10000,settings={store_name:'Quán thử',paper_width:58}) => (await db.query('select public.pos_checkout_receipt($1,$2::jsonb,8000,$3,now(),$4::jsonb) as result',[code,JSON.stringify([{id,name:'Món thử',quantity:1,price:10000}]),'Tiền mặt',JSON.stringify({cash_received:received,settings})])).rows[0].result

test('receipt checkout persists immutable price/template, discount, tender and change atomically',async()=>{
 const id=await product(3,6000);const code=randomUUID()
 const result=await payReceipt(id,code)
 assert.equal(result.order.receipt_no,code);assert.equal(result.order.items[0].price,10000)
 assert.equal(result.order.subtotal,10000);assert.equal(result.order.discount,2000)
 assert.equal(result.order.cash_received,10000);assert.equal(result.order.change_due,2000)
 assert.equal(result.order.receipt_settings.paper_width,58)
 await payReceipt(id,code,20000,{store_name:'Tên mới',paper_width:80})
 assert.equal((await read(id)).stock,2)
 const saved=(await db.query('select * from public.pos_orders where receipt_no=$1',[code])).rows[0]
 assert.equal(saved.receipt_settings.store_name,'Quán thử');assert.equal(Number(saved.cash_received),10000)
})
test('receipt insert failure rolls back bill and stock; insufficient cash never creates a bill',async()=>{
 const id=await product(3,6000);const code=randomUUID()
 await db.exec('reset role; revoke insert on public.pos_orders from anon; set role anon')
 await assert.rejects(payReceipt(id,code),/permission denied/)
 assert.equal((await read(id)).stock,3)
 assert.equal((await db.query('select count(*)::int as n from public.pos_transactions where code=$1',[code])).rows[0].n,0)
 await db.exec('reset role; grant insert on public.pos_orders to anon; set role anon')
 await assert.rejects(payReceipt(id,randomUUID(),7000),/Tiền khách đưa chưa đủ/)
 assert.equal((await read(id)).stock,3)
})
test('receipt settings persist, reject unsupported paper widths and legacy lines do not invent unit prices',async()=>{
 await db.query("update public.pos_receipt_settings set store_name='Tên quán',auto_print=true,paper_width=58 where id='default'")
 const row=(await db.query("select * from public.pos_receipt_settings where id='default'")).rows[0]
 assert.equal(row.store_name,'Tên quán');assert.equal(row.auto_print,true)
 await assert.rejects(db.query("update public.pos_receipt_settings set paper_width=90 where id='default'"),/check constraint/)
 const legacy=(await db.query("select public.pos_receipt_items('Mì x 2') as items")).rows[0].items
 assert.equal(legacy[0].price,null);assert.equal(legacy[0].name,'Mì x 2')
})

test('checkout accepts object arrays when both orders and transaction items columns are JSONB',async()=>{
 await db.exec('reset role; alter table public.pos_transactions alter column items type jsonb using public.pos_receipt_items(items); set role anon')
 const id=await product(2,6000),code=randomUUID()
 const result=await payReceipt(id,code)
 assert.ok(Array.isArray(result.order.items))
 const row=(await db.query('select items from public.pos_transactions where code=$1',[code])).rows[0]
 assert.ok(Array.isArray(row.items));assert.equal(row.items[0].quantity,1)
 assert.equal((await read(id)).stock,1)
 await db.query("update public.pos_receipt_settings set bank_name='MB',bank_account='12345678',bank_owner='TEST ONLY' where id='default'")
 const settings=(await db.query("select bank_name,bank_account,bank_owner from public.pos_receipt_settings where id='default'")).rows[0]
 assert.equal(settings.bank_name,'MB');assert.equal(settings.bank_account,'12345678');assert.equal(settings.bank_owner,'TEST ONLY')
})

async function newOrder(lines,total=0,request=randomUUID()) {
 const items=lines.map(([id,quantity])=>({id,name:'Món thử',quantity,price:10000,note:'',category:'Nhóm thử'}))
 return (await db.query('select public.pos_checkout_order($1,$2::jsonb,$3,$4,$5::jsonb) as result',[request,JSON.stringify(items),total,'Tiền mặt',JSON.stringify({cash_received:100000,settings:{paper_width:80,show_qr:true,bank_name:'MB',bank_account:'123',bank_owner:'TEST OWNER'}})])).rows[0].result
}
const adjustOrder=async(order,action,quantities=[],request=randomUUID(),version=order.version)=>(await db.query('select public.pos_adjust_order($1,$2,$3::jsonb,$4,$5) as result',[order.id,action,JSON.stringify(quantities),request,version])).rows[0].result

test('short receipt number counts all bills since Vietnam midnight and QR uses the assigned number',async()=>{
 const day=(await db.query("select (now() at time zone 'Asia/Ho_Chi_Minh')::date::text as day")).rows[0].day
 const count=(await db.query("select count(*)::int as n from public.pos_orders where created_at>=($1::date::timestamp at time zone 'Asia/Ho_Chi_Minh') and created_at<(($1::date+1)::timestamp at time zone 'Asia/Ho_Chi_Minh')",[day])).rows[0].n
 const id=await product(3,6000),req=randomUUID(),first=await newOrder([[id,1]],8000,req)
 assert.match(first.order.receipt_no,/^HD[0-9]{7}$/)
 assert.equal(Number(first.order.receipt_no.slice(-3)),count+1)
 assert.ok(first.order.qr_url.includes('addInfo='+first.order.receipt_no))
 const retry=await newOrder([[id,1]],8000,req)
 assert.equal(first.order.receipt_no,retry.order.receipt_no);assert.equal((await read(id)).stock,2)
 await assert.rejects(newOrder([[id,2]],8000,req),/giỏ khác/)
 const second=await newOrder([[id,1]],8000)
 assert.notEqual(first.order.receipt_no,second.order.receipt_no)
})
test('receipt numbers can restart on a different year without global receipt number collisions',async()=>{
 await db.exec('reset role')
 await db.query("insert into public.pos_orders(receipt_no,receipt_day,created_at,payment_method,items,subtotal,total,transaction_code) values('HD0101001','2030-01-01','2030-01-01T01:00:00Z','Tiền mặt','[]',0,0,$1),('HD0101001','2031-01-01','2031-01-01T01:00:00Z','Tiền mặt','[]',0,0,$2)",[randomUUID(),randomUUID()])
 await db.exec('set role anon')
 assert.equal((await db.query("select public.pos_next_receipt_no('2031-01-01') as code")).rows[0].code,'HD0101002')
})
test('partial return then void restores retail exactly once and never restores prepared stock',async()=>{
 const retail=await product(10,6000,true),prep=await product(5,0,false)
 const {order}=await newOrder([[retail,2],[prep,2]],30000)
 const request=randomUUID(),quantities=[{line_id:'1',quantity:1},{line_id:'2',quantity:1}]
 const partial=await adjustOrder(order,'refund',quantities,request)
 assert.equal(partial.order.status,'refunded');assert.equal(partial.order.total,15000)
 assert.equal((await read(retail)).stock,9);assert.equal((await read(prep)).stock,3)
 await adjustOrder(order,'refund',quantities,request)
 assert.equal((await read(retail)).stock,9)
 const voided=await adjustOrder(partial.order,'void')
 assert.equal(voided.order.status,'voided');assert.equal(voided.order.total,0)
 assert.equal((await read(retail)).stock,10);assert.equal((await read(prep)).stock,3)
 await adjustOrder(voided.order,'void')
 assert.equal((await read(retail)).stock,10)
 assert.equal(voided.order.activity_events.length,2)
 const transaction=(await db.query('select total,status from public.pos_transactions where code=$1',[voided.order.transaction_code])).rows[0]
 assert.equal(Number(transaction.total),0);assert.equal(transaction.status,'voided')
})
test('duplicate product lines are aggregated when returning and remaining line IDs survive partial returns',async()=>{
 const id=await product(10,6000),{order}=await newOrder([[id,3],[id,2]],40000)
 const first=await adjustOrder(order,'refund',[{line_id:'1',quantity:0},{line_id:'2',quantity:1}])
 assert.equal((await read(id)).stock,9)
 const second=await adjustOrder(first.order,'refund',[{line_id:'2',quantity:0}])
 assert.equal((await read(id)).stock,10);assert.equal(second.order.total,0)
 await adjustOrder(second.order,'void')
 assert.equal((await read(id)).stock,10)
})
test('stale versions and invalid quantities cannot over-restock or change totals',async()=>{
 const id=await product(5,6000),{order}=await newOrder([[id,2]],17000)
 for(const quantities of [[{line_id:'1',quantity:3}],[{line_id:'1',quantity:-1}],[{line_id:'1',quantity:0.5}],[{line_id:'9',quantity:0}],[{line_id:'1',quantity:0},{line_id:'1',quantity:0}]]) await assert.rejects(adjustOrder(order,'refund',quantities))
 const first=await adjustOrder(order,'refund',[{line_id:'1',quantity:1}])
 assert.equal(first.order.total,8500);assert.equal((await read(id)).stock,4)
 await assert.rejects(adjustOrder(order,'refund',[{line_id:'1',quantity:0}]),/máy khác/)
 assert.equal((await read(id)).stock,4)
 assert.equal(first.order.activity_events.length,1)
})
test('permission failure rolls back order state, all inventory changes and activity events',async()=>{
 const id=await product(5,6000),{order}=await newOrder([[id,2]],16000)
 await db.exec('reset role; revoke update on public.pos_transactions from anon; set role anon')
 await assert.rejects(adjustOrder(order,'void'),/permission denied/)
 assert.equal((await read(id)).stock,3)
 const row=(await db.query('select status,activity_events,version from public.pos_orders where id=$1',[order.id])).rows[0]
 assert.equal(row.status,'paid');assert.equal(row.version,0);assert.deepEqual(row.activity_events,[])
 await db.exec('reset role; grant update on public.pos_transactions to anon; set role anon')
})

test('two requests from stale order versions cannot both restore stock',async()=>{
 const id=await product(6,6000),{order}=await newOrder([[id,2]],18000)
 const results=await Promise.allSettled([adjustOrder(order,'refund',[{line_id:'1',quantity:1}]),adjustOrder(order,'refund',[{line_id:'1',quantity:0}])])
 assert.equal(results.filter((row)=>row.status==='fulfilled').length,1)
 assert.equal(results.filter((row)=>row.status==='rejected').length,1)
 assert.equal((await read(id)).stock,5)
})
test('a missing retail product rolls back returns to the other products too',async()=>{
 const first=await product(5,6000),second=await product(5,6000)
 const {order}=await newOrder([[first,1],[second,1]],18000)
 await db.exec('reset role');await db.query('delete from public.pos_products where id=$1',[second]);await db.exec('set role anon')
 await assert.rejects(adjustOrder(order,'void'),/Thiếu mặt hàng/)
 assert.equal((await read(first)).stock,4)
 const saved=(await db.query('select status,version from public.pos_orders where id=$1',[order.id])).rows[0]
 assert.equal(saved.status,'paid');assert.equal(saved.version,0)
})
test('daily count uses the exact Vietnam midnight boundaries',async()=>{
 await db.exec('reset role')
 for(const [index,stamp] of ['2100-10-31T16:59:59Z','2100-10-31T17:00:00Z','2100-11-01T16:59:59Z','2100-11-01T17:00:00Z'].entries())await db.query("insert into public.pos_orders(receipt_no,receipt_day,created_at,payment_method,items,subtotal,total,transaction_code) values($1,($2::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date,$2::timestamptz,'Tiền mặt','[]',0,0,$3)",['BOUNDARY-'+index,stamp,randomUUID()])
 await db.exec('set role anon')
 assert.equal((await db.query("select public.pos_next_receipt_no('2100-11-01') as code")).rows[0].code,'HD0111003')
})
test('padStart keeps at least three digits and never truncates the 1000th receipt',async()=>{
 const id=await product(2,6000)
 await db.exec('begin')
 await db.exec("insert into public.pos_orders(receipt_no,receipt_day,created_at,payment_method,items,subtotal,total,transaction_code) select 'LIMIT-'||i::text,(now() at time zone 'Asia/Ho_Chi_Minh')::date,now(),'Tiền mặt','[]',0,0,'LIMIT-'||i::text from generate_series(1,1000)i")
 const count=(await db.query("select count(*)::int as n from public.pos_orders where created_at>=(((now() at time zone 'Asia/Ho_Chi_Minh')::date)::timestamp at time zone 'Asia/Ho_Chi_Minh') and created_at<((((now() at time zone 'Asia/Ho_Chi_Minh')::date+1)::timestamp) at time zone 'Asia/Ho_Chi_Minh')")).rows[0].n
 const result=await newOrder([[id,1]],9000)
 assert.equal(Number(result.order.receipt_no.slice(6)),count+1)
 await db.exec('rollback')
 assert.equal((await read(id)).stock,2)
})

test('import numbers are short and unique; retries and voids never reuse a number',async()=>{
 const id=await product(10,6000),request=randomUUID()
 const first=await receive(id,2,12000,request)
 assert.match(first.receipt.receipt_no,/^PN[0-9]{7,}$/)
 const retry=await receive(id,2,12000,request)
 assert.equal(retry.receipt.receipt_no,first.receipt.receipt_no)
 await voidImport(first.receipt.id)
 const next=await receive(id,1,6000)
 assert.notEqual(next.receipt.receipt_no,first.receipt.receipt_no)
 assert.equal(Number(next.receipt.receipt_no.slice(6)),Number(first.receipt.receipt_no.slice(6))+1)
})
test('import numbering resets by Vietnam date and scopes uniqueness to the full year',async()=>{
 await db.exec('reset role; begin')
 for(const stamp of ['2099-10-31T17:00:00Z','2100-10-31T17:00:00Z'])await db.query("insert into public.pos_stock_imports(id,product_id,product_name,quantity,unit_cost,total_cost,created_at) values($1,'legacy','Legacy',1,6000,6000,$2::timestamptz)",[randomUUID(),stamp])
 const rows=(await db.query("select receipt_no from public.pos_stock_imports where product_id='legacy' order by created_at")).rows
 assert.equal(rows[0].receipt_no,'PN0111001');assert.equal(rows[1].receipt_no,'PN0111001')
 await db.exec('rollback; set role anon')
})
test('migration backfills legacy display aliases without changing bill numbers, QR or original inventory UUIDs',async()=>{
 await db.exec('reset role')
 const id=randomUUID(),code='HD1793470000000abcd'
 await db.query("insert into public.pos_orders(id,receipt_no,transaction_code,receipt_day,created_at,payment_method,items,subtotal,total,qr_url) values($1,$2,$2,'2080-11-01','2080-11-01T01:00:00Z','Tiền mặt','[]',0,0,'https://img.vietqr.io/image/original')",[id,code])
 const sql=await readFile(new URL('../supabase/migrations/202611010005_short_import_numbers.sql',import.meta.url),'utf8')
 await db.exec(sql);await db.exec(sql)
 const row=(await db.query('select receipt_no,activity_receipt_no,qr_url from public.pos_orders where id=$1',[id])).rows[0]
 assert.equal(row.receipt_no,code);assert.equal(row.activity_receipt_no,'HD0111001');assert.equal(row.qr_url,'https://img.vietqr.io/image/original')
 await db.exec('set role anon')
})
