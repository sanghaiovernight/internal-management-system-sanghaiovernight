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
  for (const file of ['202610310001_catalog_and_receiving.sql', '202611010001_inventory_business_rules.sql']) {
    const sql = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
    await db.exec(sql)
    await db.exec(sql) // Idempotent setup and existing-table upgrade.
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
