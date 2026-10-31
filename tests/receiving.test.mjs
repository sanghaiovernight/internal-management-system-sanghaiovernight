import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

let db
const productId = 'stock-test'
const receiptId = '00000000-0000-4000-8000-000000000001'
const call = (id = receiptId, qty = 4, total = 100000, expense = true) => db.query('select public.pos_receive_stock($1,$2,$3,$4,$5) as result', [productId, qty, total, expense, id])
before(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create table public.pos_products (id text primary key, name text, category text, stock numeric, price numeric);
    create table public.pos_expenses (id uuid primary key, description text, amount numeric, spent_at timestamptz);
    insert into public.pos_products values ('stock-test', 'Sản phẩm thử', 'Nhóm thử', 8, 35000);
    grant select, update on public.pos_products to anon;
    grant select, insert on public.pos_expenses to anon;
  `)
  const sql = await readFile(new URL('../supabase/migrations/202610310001_catalog_and_receiving.sql', import.meta.url), 'utf8')
  await db.exec(sql)
  await db.exec(sql) // migration can be rerun
  await db.exec('set role anon')
})
after(async () => { await db?.close() })

test('RPC atomically stores receipt, stock, exact unit cost and optional expense', async () => {
  const { rows } = await call()
  assert.equal(rows[0].result.stock, 12)
  assert.equal(rows[0].result.cost_price, 25000)
  assert.equal((await db.query('select count(*)::int as n from public.pos_expenses')).rows[0].n, 1)
  assert.equal((await db.query('select count(*)::int as n from public.pos_stock_receipts')).rows[0].n, 1)
})
test('retrying the same UUID does not increase stock or duplicate expense', async () => {
  const { rows } = await call()
  assert.equal(rows[0].result.stock, 12)
  assert.equal((await db.query('select count(*)::int as n from public.pos_expenses')).rows[0].n, 1)
  await assert.rejects(call(receiptId, 5), /Mã phiếu đã được sử dụng/)
})
test('fractional unit costs are retained and auto expense can be disabled', async () => {
  const { rows } = await call('00000000-0000-4000-8000-000000000002', 3, 100, false)
  assert.equal(rows[0].result.stock, 15)
  assert.ok(Math.abs(rows[0].result.cost_price - 100 / 3) < 1e-10)
  assert.equal((await db.query('select count(*)::int as n from public.pos_expenses')).rows[0].n, 1)
})
test('invalid inputs cannot change stock or create receipts', async () => {
  for (const [qty, total] of [[0, 1], [-1, 1], [1, -1], [1, 'NaN']]) {
    await assert.rejects(call('00000000-0000-4000-8000-000000000003', qty, total), /không hợp lệ/)
  }
  assert.equal(Number((await db.query('select stock from public.pos_products')).rows[0].stock), 15)
})
test('expense permission failures roll back stock, cost and receipt', async () => {
  await db.exec('reset role; revoke insert on public.pos_expenses from anon; set role anon')
  await assert.rejects(call('00000000-0000-4000-8000-000000000004', 5, 100), /permission denied/)
  const product = (await db.query('select stock, cost_price from public.pos_products')).rows[0]
  assert.equal(Number(product.stock), 15)
  assert.ok(Math.abs(Number(product.cost_price) - 100 / 3) < 1e-10)
  assert.equal((await db.query('select count(*)::int as n from public.pos_stock_receipts')).rows[0].n, 2)
})
test('categories persist and reject duplicate names regardless of case', async () => {
  await db.query("insert into public.pos_categories(name) values ('Nhóm mới')")
  assert.equal((await db.query("select name from public.pos_categories where name = 'Nhóm mới'")).rows.length, 1)
  await assert.rejects(db.query("insert into public.pos_categories(name) values ('nhóm mới')"), /duplicate key/)
})
