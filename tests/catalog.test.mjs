import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categoryList, matchesProduct, receiptCost, metricLabel } from '../lib/catalog.ts'

test('category registry merges custom, empty and product groups without duplicates', () => {
  assert.deepEqual(categoryList([' Đồ uống ', 'Nhóm mới'], ['đồ uống', '', '  Nhóm   mới  ']), ['đồ uống', 'Nhóm mới'])
})
test('barcode search preserves leading zeros and supports names', () => {
  const product = { name: 'Cà phê', barcode: '0012345678901' }
  assert.equal(matchesProduct(product, '0012345678901'), true)
  assert.equal(matchesProduct(product, 'CÀ PHÊ'), true)
  assert.equal(matchesProduct(product, 'no-match'), false)
})
test('receiving allocates total / quantity, retaining fractional costs and free deliveries', () => {
  assert.deepEqual(receiptCost('4', '100000'), { quantity: 4, total: 100000, costPrice: 25000 })
  assert.equal(receiptCost(3, 100).costPrice, 100 / 3)
  assert.equal(receiptCost(1, 0).costPrice, 0)
})
test('receiving rejects blank, nonfinite, negative and fractional quantities', () => {
  for (const [quantity, total] of [['', '5'], ['2', ''], [0, 20], [-1, 5], [1.5, 3], [1, -10], [1, Infinity], [NaN, 1]]) assert.throws(() => receiptCost(quantity, total))
})
test('TC uses visits; revenue and average remain currency', () => {
  assert.equal(metricLabel(12, 'count'), '12 lượt')
  assert.equal(metricLabel(12, 'revenue'), '12đ')
  assert.equal(metricLabel(12, 'average'), '12đ')
})

test('business type is determined only by explicit is_imported, never category or zero stock', async () => {
  const { isRetail, isLowStock, stockProblem, movingAverageCost } = await import('../lib/catalog.ts')
  assert.equal(isLowStock({ is_imported: false, stock: 0 }), false)
  assert.equal(isLowStock({ is_imported: true, stock: 5 }), true)
  assert.equal(isLowStock({ is_imported: true, stock: 6 }), false)
  assert.equal(isRetail({ stock: 0 }), false)
  assert.equal(movingAverageCost(10,6000,5,45000),7000)
  assert.equal(stockProblem([{ id:'p',quantity:5 }],[{ id:'p',is_imported:false,stock:0 }]),null)
  assert.match(stockProblem([{ id:'p',quantity:2 },{ id:'p',quantity:2 }],[{ id:'p',name:'P',is_imported:true,stock:3 }]),/chỉ còn 3/)
})
