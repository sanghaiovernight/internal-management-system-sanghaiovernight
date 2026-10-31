import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'

const barcode = '0012345678901'
const initialProduct = { id: 'test-product', name: 'Sản phẩm thử nghiệm có tên rất dài để kiểm tra bố cục trên điện thoại', category: 'Đồ đóng gói', tag: 'Đồ đóng gói', price: 35000, cost_price: 20000, stock: 8, barcode, product_type: 'retail' }

async function fixture(page: Page, options: { failReceive?: boolean; failCategory?: boolean } = {}) {
  let product = { ...initialProduct }
  const categories = [{ name: 'Đồ đóng gói' }]
  const receipts: Record<string, unknown>[] = []
  const requests: string[] = []
  // All Supabase traffic is intercepted; no store data is read or written.
  await page.route('https://**/*', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.includes('/rest/v1/')) { await route.abort(); return }
    const table = url.pathname.split('/').at(-1)
    const method = route.request().method()
    requests.push(`${method} ${table}`)
    let body: unknown = []
    let status = 200
    if (method === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } }); return }
    if (table === 'pos_products') {
      if (method === 'PATCH') product = { ...product, ...route.request().postDataJSON() }
      body = method === 'GET' ? [product] : product
    } else if (table === 'pos_categories') {
      if (method === 'POST') {
        if (options.failCategory) { status = 403; body = { message: 'permission denied' } }
        else categories.push(route.request().postDataJSON())
      } else body = categories
    } else if (table === 'pos_receive_stock') {
      const input = route.request().postDataJSON()
      receipts.push(input)
      if (options.failReceive) { status = 403; body = { message: 'permission denied' } }
      else { product = { ...product, stock: product.stock + input.p_quantity, cost_price: input.p_total / input.p_quantity }; body = { stock: product.stock, cost_price: product.cost_price, receipt_id: input.p_receipt_id } }
    }
    await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: new RegExp(initialProduct.name) }).first()).toBeVisible()
  return { receipts, requests }
}

async function inventory(page: Page) {
  await page.getByRole('button', { name: 'Kho hàng', exact: true }).click()
  await expect(page.getByTestId('inventory-card')).toHaveCount(1)
}

test('loading the POS does not erase the saved cart', async ({ page }) => {
  const { requests } = await fixture(page)
  await expect(page.getByRole('button', { name: 'Quét mã', exact: true })).toBeVisible()
  expect(requests.filter((request) => request === 'DELETE pos_cart_lines')).toHaveLength(0)
})

test('mobile cards fit 320/375/390/768 widths, show one price, and retain stock controls', async ({ page }) => {
  await fixture(page)
  await inventory(page)
  for (const width of [320, 375, 390, 768]) {
    await page.setViewportSize({ width, height: 850 })
    const card = page.getByTestId('inventory-card')
    await expect(card.getByText('35.000đ', { exact: true })).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(card.getByRole('button', { name: `Tăng tồn ${initialProduct.name}` })).toBeVisible()
  }
})

test('new category appears in inventory, POS, receiving and reports and survives reload', async ({ page }) => {
  await fixture(page)
  await inventory(page)
  await page.getByLabel('Tên nhóm hàng mới').fill('Nhóm mới')
  await page.getByRole('button', { name: 'Tạo nhóm', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Nhóm mới', exact: true })).toBeVisible()
  await page.getByRole('button', { name: `Sửa ${initialProduct.name}`, exact: true }).click()
  await page.getByLabel('Nhóm hàng', { exact: true }).selectOption('Nhóm mới')
  await page.getByRole('button', { name: 'Lưu', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Nhập hàng', exact: true }).click()
  await expect(page.getByLabel('Nhóm hàng nhập', { exact: true }).locator('option', { hasText: 'Nhóm mới' })).toHaveCount(1)
  await page.getByRole('button', { name: 'POS', exact: true }).click()
  await page.getByRole('button', { name: 'Nhóm mới', exact: true }).click()
  await expect(page.getByRole('button', { name: new RegExp(initialProduct.name) }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Báo cáo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Nhóm mới', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Nhóm mới', exact: true })).toBeVisible()
})

test('failed category creation is reported and never added to filters', async ({ page }) => {
  await fixture(page, { failCategory: true })
  await inventory(page)
  await page.getByLabel('Tên nhóm hàng mới').fill('Nhóm bị lỗi')
  await page.getByRole('button', { name: 'Tạo nhóm', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Không lưu được nhóm hàng' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nhóm bị lỗi', exact: true })).toHaveCount(0)
})

test('handheld scanner routes to the active POS, inventory and receiving screen', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 })
  await fixture(page)
  await page.locator('h1').click()
  await page.keyboard.type(barcode, { delay: 5 }); await page.keyboard.press('Enter')
  await expect(page.getByRole('status').filter({ hasText: 'Đã thêm' })).toBeVisible()
  await inventory(page)
  await page.locator('h1').click()
  await page.keyboard.type(barcode, { delay: 5 }); await page.keyboard.press('Tab')
  await expect(page.getByLabel('Tìm hàng trong kho')).toHaveValue(barcode)
  await page.getByRole('button', { name: 'Nhập hàng', exact: true }).click()
  await page.locator('h1').click()
  await page.keyboard.type(barcode, { delay: 5 }); await page.keyboard.press('Enter')
  await expect(page.getByLabel('Mặt hàng nhập', { exact: true })).toHaveValue(initialProduct.id)
  await page.getByLabel('Số lượng nhập', { exact: true }).fill('4')
  await page.getByLabel('Tổng tiền nhập', { exact: true }).fill('100000')
  await expect(page.getByText('25.000đ', { exact: true })).toBeVisible()
})

test('receiving saves one RPC with total / quantity and updates product cost and stock', async ({ page }) => {
  const { receipts, requests } = await fixture(page)
  await inventory(page)
  await page.getByRole('button', { name: 'Nhập hàng', exact: true }).click()
  await page.getByLabel('Tìm mặt hàng nhập').fill(barcode)
  await page.getByLabel('Tìm mặt hàng nhập').press('Enter')
  await page.getByLabel('Số lượng nhập', { exact: true }).fill('4')
  await page.getByLabel('Tổng tiền nhập', { exact: true }).fill('100000')
  await page.getByRole('button', { name: 'Lưu phiếu nhập', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Đã lưu phiếu nhập' })).toBeVisible()
  expect(receipts).toHaveLength(1)
  expect(receipts[0]).toMatchObject({ p_quantity: 4, p_total: 100000, p_auto_expense: true, p_product_id: initialProduct.id })
  expect(requests.filter((request) => request === 'POST pos_expenses')).toHaveLength(0)
  await page.getByRole('button', { name: 'Tồn kho', exact: true }).click()
  await expect(page.getByLabel(`Tồn kho ${initialProduct.name}`, { exact: true })).toHaveText('12')
  await page.getByRole('button', { name: `Sửa ${initialProduct.name}`, exact: true }).click()
  await expect(page.getByLabel('Giá vốn', { exact: true })).toHaveValue('25000')
})

test('failed receiving preserves inputs, shows error and reuses receipt ID for safe retry', async ({ page }) => {
  const { receipts } = await fixture(page, { failReceive: true })
  await inventory(page)
  await page.getByRole('button', { name: 'Nhập hàng', exact: true }).click()
  await page.getByLabel('Mặt hàng nhập', { exact: true }).selectOption(initialProduct.id)
  await page.getByLabel('Số lượng nhập', { exact: true }).fill('4')
  await page.getByLabel('Tổng tiền nhập', { exact: true }).fill('100000')
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Lưu phiếu nhập', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Không lưu được phiếu nhập' })).toBeVisible()
  }
  expect(receipts).toHaveLength(2)
  expect(receipts[0].p_receipt_id).toEqual(receipts[1].p_receipt_id)
  await expect(page.getByLabel('Số lượng nhập', { exact: true })).toHaveValue('4')
  await page.getByRole('button', { name: 'Tồn kho', exact: true }).click()
  await expect(page.getByLabel(`Tồn kho ${initialProduct.name}`, { exact: true })).toHaveText('8')
})

test('TC uses lượt for bar, line and pie charts', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: 'Báo cáo', exact: true }).click()
  await page.getByRole('button', { name: /TC · Tổng lượt khách/ }).click()
  await expect(page.getByText('TC (lượt)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Biểu đồ đường', exact: true }).click()
  await expect(page.getByText('TC (lượt)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Biểu đồ tròn', exact: true }).click()
  await expect(page.getByText('Tổng').locator('b')).toHaveText('0 lượt')
})

test('camera failure is explained and camera dialog closes with Escape', async ({ page }) => {
  await fixture(page)
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError') } })
  await page.reload()
  await page.getByRole('button', { name: 'Quét mã', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Không mở được camera' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('camera decodes a QR video frame and stops all camera tracks', async ({ page }) => {
  await fixture(page)
  await page.addScriptTag({ path: path.resolve('node_modules/@zxing/browser/umd/zxing-browser.min.js') })
  await page.evaluate((code) => {
    const ZXing = (window as any).ZXingBrowser
    const svg = new ZXing.BrowserQRCodeSvgWriter().write(code, 400, 400)
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 600
    const context = canvas.getContext('2d')!
    const image = new Image()
    image.src = 'data:image/svg+xml;base64,' + btoa(new XMLSerializer().serializeToString(svg))
    const ready = new Promise<void>((resolve) => { image.onload = () => { context.fillStyle = 'white'; context.fillRect(0, 0, 600, 600); context.drawImage(image, 100, 100); resolve() } })
    ;(window as any).cameraTracks = []
    navigator.mediaDevices.getUserMedia = async () => {
      await ready
      const stream = canvas.captureStream(10)
      const tick = setInterval(() => { context.fillStyle = 'white'; context.fillRect(0, 0, 600, 600); context.drawImage(image, 100, 100); if (stream.getTracks().every((track) => track.readyState === 'ended')) clearInterval(tick) }, 100)
      ;(window as any).cameraTracks.push(...stream.getTracks())
      return stream
    }
  }, barcode)
  await page.getByRole('button', { name: 'Quét mã', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Đã thêm' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await inventory(page)
  await page.getByRole('button', { name: 'Quét mã', exact: true }).click()
  await expect(page.getByLabel('Tìm hàng trong kho')).toHaveValue(barcode)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Nhập hàng', exact: true }).click()
  await page.getByRole('button', { name: 'Quét mã', exact: true }).click()
  await expect(page.getByLabel('Mặt hàng nhập', { exact: true })).toHaveValue(initialProduct.id)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).cameraTracks.length)).toBe(3)
  expect(await page.evaluate(() => (window as any).cameraTracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true)
})
