import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'

const barcode = '0012345678901'
const initialProduct = { id: 'test-product', name: 'Sản phẩm thử nghiệm có tên rất dài để kiểm tra bố cục trên điện thoại', category: 'Đồ đóng gói', tag: 'Đồ đóng gói', price: 35000, cost_price: 20000, stock: 8, barcode, product_type: 'retail', is_imported: true }

async function fixture(page: Page, options: { failReceive?: boolean; failCategory?: boolean; stock?: number; retail?: boolean; cartQuantity?: number; failCheckout?: boolean; failVoid?: boolean; historyOffline?: boolean; settingsOffline?: boolean; autoPrint?: boolean } = {}) {
  let product = { ...initialProduct, stock: options.stock ?? 8, is_imported: options.retail ?? true }
  const categories = [{ name: 'Đồ đóng gói' }]
  let template:any = { id:'default',store_name:'SangHai Overnight',paper_width:80,auto_print:options.autoPrint??false,show_qr:false }
  let orders:any[] = []
  let imports: Record<string, any>[] = []
  const receipts: Record<string, unknown>[] = []
  const payments: Record<string, any>[] = []
  const requests: string[] = []
  await page.route('https://**/*', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.includes('/rest/v1/')) { await route.abort(); return }
    const table = url.pathname.split('/').at(-1)
    const method = route.request().method()
    requests.push(`${method} ${table}`)
    let body: unknown = []
    let status = 200
    if (method === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } }); return }
    if (table === 'pos_receipt_settings') { if(options.settingsOffline){status=403;body={message:'offline'}}else{if(method==='POST') template={...template,...route.request().postDataJSON()}; body=template} }
    else if(table==='pos_orders') body=orders
    else if (table === 'pos_products') {
      if (method === 'PATCH') product = { ...product, ...route.request().postDataJSON() }
      body = method === 'GET' ? [product] : product
    } else if (table === 'pos_categories') {
      if (method === 'POST') {
        if (options.failCategory) { status = 403; body = { message: 'permission denied' } }
        else categories.push(route.request().postDataJSON())
      } else body = categories
    } else if (table === 'pos_delete_category') {
      const name = route.request().postDataJSON().p_name
      categories.splice(categories.findIndex((item) => item.name === name), 1)
      if (product.category === name) product = { ...product, category: 'Chưa phân loại', tag: 'Chưa phân loại' }
      body = null
    } else if (table === 'pos_stock_imports') {
      if (options.historyOffline) { status = 503; body = { message: 'offline' } }
      else body = imports
    } else if (table === 'pos_cart_lines' && method === 'GET') {
      body = options.cartQuantity ? [{ product_id: product.id, quantity: options.cartQuantity }] : []
    } else if (table === 'pos_receive_stock_v2') {
      const input = route.request().postDataJSON()
      receipts.push(input)
      if (options.failReceive) { status = 403; body = { message: 'permission denied' } }
      else {
        const receipt = { id: input.p_receipt_id, product_id: product.id, product_name: product.name, quantity: input.p_quantity, unit_cost: input.p_total / input.p_quantity, total_cost: input.p_total, created_at: new Date().toISOString(), cost_before: product.cost_price, stock_before: product.stock, reversible: true }
        product = { ...product, stock: product.stock + input.p_quantity, cost_price: Math.round((Math.max(0,product.stock)*product.cost_price+input.p_total)/(Math.max(0,product.stock)+input.p_quantity)) }
        imports = [receipt, ...imports]; body = { stock: product.stock, cost_price: product.cost_price, receipt }
      }
    } else if (table === 'pos_void_stock_import') {
      const receipt = imports.find((row) => row.id === route.request().postDataJSON().p_id)!
      if (options.failVoid) { status = 400; body = { message: 'hàng của phiếu đã được bán' } }
      else { product = { ...product, stock: receipt.stock_before, cost_price: receipt.cost_before }; imports = imports.filter((row) => row.id !== receipt.id); body = { product_id: product.id, stock: product.stock, cost_price: product.cost_price } }
    } else if (table === 'pos_checkout_receipt') {
      const input = route.request().postDataJSON()
      payments.push(input)
      const quantity = input.p_items.reduce((sum: number, line: any) => sum+line.quantity,0)
      if (options.failCheckout || (product.is_imported && quantity > product.stock)) { status = 400; body = { message: 'Không đủ tồn kho trên máy chủ' } }
      else { product = { ...product, stock: Math.max(0,product.stock-quantity) }; const order={id:input.p_code,receipt_no:input.p_code,created_at:input.p_date_time,payment_method:input.p_method,items:input.p_items,subtotal:input.p_items.reduce((sum:number,item:any)=>sum+item.price*item.quantity,0),discount:0,total:input.p_total,cash_received:input.p_receipt.cash_received,change_due:input.p_receipt.cash_received==null?null:input.p_receipt.cash_received-input.p_total,receipt_settings:input.p_receipt.settings,qr_url:input.p_receipt.qr_url}; orders.push(order); body = { products: [{ id: product.id, stock: product.stock, cost_price: product.cost_price }],order } }
    }
    await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: new RegExp(initialProduct.name) }).first()).toBeVisible()
  return { receipts, payments, requests }
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
  await page.getByRole('button', { name: '+ Thêm nhóm', exact: true }).click()
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
  await page.getByRole('button', { name: '+ Thêm nhóm', exact: true }).click()
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
  await expect(page.getByLabel('Giá vốn', { exact: true })).toHaveValue('21667')
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

test('cost column precedes price on desktop and mobile; money inputs have no spinners', async ({ page }) => {
  await fixture(page)
  await inventory(page)
  const card = page.getByTestId('inventory-card')
  await expect(card.getByTestId('inventory-cost')).toHaveText('20.000đ')
  await page.getByRole('button', { name: `Sửa ${initialProduct.name}`, exact: true }).click()
  for (const label of ['Giá vốn','Giá bán']) {
    const input = page.getByLabel(label, { exact: true })
    await expect(input).toHaveAttribute('type','text')
    await expect(input).toHaveAttribute('inputmode','numeric')
    await input.fill('6000'); await expect(input).toHaveValue('6000')
  }
  await page.getByRole('button', { name:'Đóng sửa mặt hàng' }).click()
  await page.getByRole('button', { name:'Nhập hàng',exact:true }).click()
  await expect(page.getByLabel('Tổng tiền nhập',{exact:true})).toHaveAttribute('type','text')
  await expect(page.getByRole('button',{name:'+ Thêm nhóm',exact:true})).toHaveCount(0)
  await expect(page.getByLabel('Tên nhóm hàng mới')).toHaveCount(0)
})

test('prepared items are excluded from low-stock KPI and reports, and show a dash for zero cost', async ({ page }) => {
  await fixture(page,{ retail:false,stock:0 })
  await inventory(page)
  const kpi = page.getByText('Mặt hàng sắp hết',{exact:true}).locator('..')
  await expect(kpi).toContainText('0')
  await page.getByRole('button',{ name:`Sửa ${initialProduct.name}`,exact:true }).click()
  await page.getByLabel('Giá vốn',{exact:true}).fill('0')
  await page.getByRole('button',{name:'Lưu',exact:true}).click()
  await expect(page.getByTestId('inventory-cost')).toHaveText('—')
  await page.getByRole('button',{name:'Báo cáo',exact:true}).click()
  const alerts = page.getByRole('heading',{name:'Cảnh báo tồn kho'}).locator('..').locator('..').locator('..')
  await expect(alerts.getByText(initialProduct.name,{exact:true})).toHaveCount(0)
})

test('retail zero stock cannot be added; restored carts above stock cannot open payment, including F9', async ({ page }) => {
  const { payments } = await fixture(page,{stock:0,cartQuantity:1})
  await expect(page.getByRole('button',{name:new RegExp(initialProduct.name)}).first()).toBeDisabled()
  await expect(page.getByText('Hết hàng',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Thanh toán (F9)',exact:true})).toBeDisabled()
  await page.keyboard.press('F9')
  await expect(page.getByRole('dialog',{name:'Thanh toán đơn hàng'})).toHaveCount(0)
  expect(payments).toHaveLength(0)
})

test('retail quantity increase is capped at current stock', async ({ page }) => {
  await fixture(page,{stock:1})
  await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
  await page.getByRole('button',{name:`Tăng ${initialProduct.name}`,exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Không đủ tồn kho'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Thanh toán (F9)',exact:true})).toBeEnabled()
})

test('prepared items can sell at zero stock, and positive tracked stock bottoms out at zero', async ({ page }) => {
  for (const stock of [0,1]) {
    const { payments } = await fixture(page,{stock,retail:false})
    await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
    await page.getByRole('button',{name:`Tăng ${initialProduct.name}`,exact:true}).click()
    await page.getByRole('button',{name:'Thanh toán (F9)',exact:true}).click()
    await page.getByLabel('Tiền khách đưa').fill('100000')
    await page.getByRole('button',{name:'Chỉ thanh toán, không in',exact:true}).last().click()
    await expect(page.getByRole('status').filter({hasText:'Thanh toán thành công!'})).toBeVisible()
    expect(payments).toHaveLength(1)
    await inventory(page)
    await expect(page.getByLabel(`Tồn kho ${initialProduct.name}`,{exact:true})).toHaveText('0')
  }
})

test('server stock rejection keeps the bill open and does not report payment success', async ({ page }) => {
  const { payments } = await fixture(page,{stock:1,failCheckout:true})
  await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
  await page.getByRole('button',{name:'Thanh toán (F9)',exact:true}).click()
  await page.getByLabel('Tiền khách đưa').fill('100000')
  await page.getByRole('button',{name:'Chỉ thanh toán, không in',exact:true}).last().click()
  await expect(page.getByRole('status').filter({hasText:'Thanh toán thất bại'})).toBeVisible()
  await expect(page.getByRole('dialog',{name:'Thanh toán đơn hàng'})).toBeVisible()
  expect(payments).toHaveLength(1)
})

test('history shows unit cost vs weighted cost; deleting a receipt restores product and history', async ({ page }) => {
  await fixture(page)
  await inventory(page)
  await page.getByRole('button',{name:'Nhập hàng',exact:true}).click()
  await page.getByLabel('Mặt hàng nhập',{exact:true}).selectOption(initialProduct.id)
  await page.getByLabel('Số lượng nhập',{exact:true}).fill('4')
  await page.getByLabel('Tổng tiền nhập',{exact:true}).fill('100000')
  await expect(page.getByText(/Giá vốn bình quân dự kiến/)).toContainText('21.667đ')
  await page.getByRole('button',{name:'Lưu phiếu nhập',exact:true}).click()
  const history = page.getByRole('region',{name:'Lịch sử nhập kho'})
  await expect(history.getByRole('cell',{name:'25.000đ',exact:true})).toBeVisible()
  await expect(history.getByRole('cell',{name:'100.000đ',exact:true})).toBeVisible()
  await history.getByRole('button',{name:/Xóa phiếu nhập/}).click()
  await page.getByRole('alertdialog').getByRole('button',{name:'Xóa phiếu',exact:true}).click()
  await expect(history.getByRole('button',{name:/Xóa phiếu nhập/})).toHaveCount(0)
  await page.getByRole('button',{name:'Tồn kho',exact:true}).click()
  await expect(page.getByLabel(`Tồn kho ${initialProduct.name}`,{exact:true})).toHaveText('8')
  await expect(page.getByTestId('inventory-cost')).toHaveText('20.000đ')
})

test('deleting a category reassigns products and removes filters without resurrecting defaults', async ({ page }) => {
  await fixture(page)
  await inventory(page)
  await page.getByRole('button',{name:'Xóa nhóm Đồ đóng gói',exact:true}).click()
  await page.getByRole('alertdialog').getByRole('button',{name:'Xóa nhóm',exact:true}).click()
  await expect(page.getByRole('button',{name:'Đồ đóng gói',exact:true})).toHaveCount(0)
  await expect(page.getByTestId('inventory-card')).toContainText('Chưa phân loại')
  await page.getByRole('button',{name:'POS',exact:true}).click()
  await expect(page.getByRole('button',{name:'Đồ đóng gói',exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Báo cáo',exact:true}).click()
  await expect(page.getByRole('button',{name:'Đồ đóng gói',exact:true})).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button',{name:'Đồ đóng gói',exact:true})).toHaveCount(0)
})

test('history network failure shows the saved receipt without pretending it is synchronized', async ({ page }) => {
  await page.addInitScript((project) => {
    localStorage.setItem(`pos-stock-imports:${project}`,JSON.stringify([{id:'cached',product_id:'p',product_name:'Phiếu đã lưu',quantity:2,unit_cost:6000,total_cost:12000,created_at:'2026-11-01T00:00:00Z',reversible:false}]))
  }, process.env.NEXT_PUBLIC_SUPABASE_URL!)
  await fixture(page,{historyOffline:true})
  await inventory(page)
  await page.getByRole('button',{name:'Nhập hàng',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Đang hiển thị bản lưu'})).toBeVisible()
  await expect(page.getByRole('cell',{name:'Phiếu đã lưu',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Xóa phiếu nhập cached',exact:true})).toBeDisabled()
})

test('retail checkout decrements stock and renders sold out; retry reuses the bill identifier', async ({ page }) => {
  const options = { stock:1,failCheckout:true }
  const { payments } = await fixture(page,options)
  await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
  await page.getByRole('button',{name:'Thanh toán (F9)',exact:true}).click()
  await page.getByLabel('Tiền khách đưa').fill('100000')
  await page.getByRole('button',{name:'Chỉ thanh toán, không in',exact:true}).last().click()
  await expect(page.getByRole('status').filter({hasText:'Thanh toán thất bại'})).toBeVisible()
  options.failCheckout = false
  await page.getByRole('button',{name:'Chỉ thanh toán, không in',exact:true}).last().click()
  await expect(page.getByRole('status').filter({hasText:'Thanh toán thành công!'})).toBeVisible()
  expect(payments).toHaveLength(2)
  expect(payments[0].p_code).toEqual(payments[1].p_code)
  await expect(page.getByRole('button',{name:new RegExp(initialProduct.name)}).first()).toBeDisabled()
  await expect(page.getByText('Hết hàng',{exact:true})).toBeVisible()
})

test('failed receipt reversal preserves the history and product state', async ({ page }) => {
  await fixture(page,{failVoid:true})
  await inventory(page)
  await page.getByRole('button',{name:'Nhập hàng',exact:true}).click()
  await page.getByLabel('Mặt hàng nhập',{exact:true}).selectOption(initialProduct.id)
  await page.getByLabel('Số lượng nhập',{exact:true}).fill('4')
  await page.getByLabel('Tổng tiền nhập',{exact:true}).fill('100000')
  await page.getByRole('button',{name:'Lưu phiếu nhập',exact:true}).click()
  const history = page.getByRole('region',{name:'Lịch sử nhập kho'})
  await history.getByRole('button',{name:/Xóa phiếu nhập/}).click()
  await page.getByRole('alertdialog').getByRole('button',{name:'Xóa phiếu',exact:true}).click()
  await expect(page.getByRole('alert').filter({hasText:'hàng của phiếu đã được bán'})).toBeVisible()
  await expect(history.getByRole('button',{name:/Xóa phiếu nhập/})).toHaveCount(1)
  await page.getByRole('button',{name:'Tồn kho',exact:true}).click()
  await expect(page.getByLabel(`Tồn kho ${initialProduct.name}`,{exact:true})).toHaveText('12')
  await expect(page.getByTestId('inventory-cost')).toHaveText('21.667đ')
})

async function printSpy(page:Page) {
  await page.addInitScript(()=>{(window as any).__prints=[];window.print=()=>{(window as any).__prints.push(document.getElementById('receipt-print-area')?.textContent)}})
}
async function designer(page:Page) {
  await page.getByRole('button',{name:'Hóa đơn & Mẫu in',exact:true}).click()
  await page.getByRole('button',{name:'Thiết kế mẫu in',exact:true}).click()
}

test('custom confirmation supports cancel, Escape, backdrop, focus and performs no native popup',async({page})=>{
 await fixture(page);await inventory(page)
 page.on('dialog',()=>{throw new Error('Unexpected native popup')})
 for(const close of ['cancel','escape','backdrop']) {
  await page.getByRole('button',{name:'Xóa nhóm Đồ đóng gói',exact:true}).click()
  const dialog=page.getByRole('alertdialog')
  await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Hủy',exact:true})).toBeFocused()
  if(close==='cancel')await dialog.getByRole('button',{name:'Hủy',exact:true}).click()
  else if(close==='escape')await page.keyboard.press('Escape')
  else await page.getByTestId('confirm-backdrop').click({position:{x:2,y:2}})
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Đồ đóng gói',exact:true})).toBeVisible()
 }
 await page.getByRole('button',{name:`Sửa ${initialProduct.name}`,exact:true}).click()
 await page.getByRole('button',{name:'Xóa món',exact:true}).click()
 await expect(page.getByRole('alertdialog')).toContainText('Hóa đơn đã lưu vẫn được giữ lại')
 await page.getByRole('alertdialog').getByRole('button',{name:'Hủy',exact:true}).click()
 await expect(page.getByRole('dialog',{name:'Sửa mặt hàng'})).toBeVisible()
})

test('designer updates live K58 receipt, saves template, and prints only the receipt area',async({page})=>{
 await printSpy(page);await fixture(page);await designer(page)
 await page.getByLabel('Tên cửa hàng',{exact:true}).fill('Quán in thử')
 await page.getByLabel('Địa chỉ',{exact:true}).fill('123 Đường thử')
 await page.getByLabel('Tên Wifi',{exact:true}).fill('Wifi thử')
 await page.getByLabel('Mật khẩu Wifi',{exact:true}).fill('test-pass')
 await page.getByLabel('Khổ giấy',{exact:true}).selectOption('58')
 const preview=page.getByLabel('Xem trước mẫu hóa đơn')
 await expect(preview).toContainText('Quán in thử');await expect(preview).toContainText('123 Đường thử');await expect(preview).toContainText('test-pass')
 await expect(preview.locator('article')).toHaveAttribute('style',/58mm/)
 await page.getByRole('button',{name:'Lưu mẫu hóa đơn',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Đã lưu mẫu hóa đơn lên máy chủ'})).toBeVisible()
 await page.getByRole('button',{name:'In thử mẫu này',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>(window as any).__prints.length)).toBe(1)
 await page.emulateMedia({media:'print'})
 await expect(page.locator('main')).toBeHidden()
 await expect(page.locator('#receipt-print-area')).toBeVisible()
 await expect(page.locator('#receipt-print-area')).toContainText('Quán in thử')
 expect(await page.locator('#receipt-print-area article').evaluate((el)=>el.scrollWidth<=el.clientWidth)).toBe(true)
 await page.emulateMedia({media:'screen'})
 await expect(page.locator('main')).toBeVisible()
 await expect(page.locator('#receipt-print-area')).toBeHidden()
})

test('offline template save persists locally and survives reload without claiming server sync',async({page})=>{
 await fixture(page,{settingsOffline:true});await designer(page)
 await page.getByLabel('Tên cửa hàng',{exact:true}).fill('Mẫu offline')
 await page.getByRole('button',{name:'Lưu mẫu hóa đơn',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Đã lưu mẫu trên thiết bị'})).toBeVisible()
 await page.reload();await designer(page)
 await expect(page.getByLabel('Tên cửa hàng',{exact:true})).toHaveValue('Mẫu offline')
 await expect(page.getByText(/Mẫu đang lưu trên thiết bị, chưa đồng bộ/)).toBeVisible()
})

test('checkout-and-print persists the bill first; history searches, details and reprint preserve its snapshot',async({page})=>{
 await printSpy(page)
 const {payments}=await fixture(page,{stock:2,autoPrint:true})
 await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
 await page.getByRole('button',{name:'Thanh toán (F9)',exact:true}).click()
 const actions=page.getByRole('dialog',{name:'Thanh toán đơn hàng'})
 await expect(actions.getByRole('button',{name:'Thanh toán & In hóa đơn',exact:true})).toBeVisible()
 await page.getByLabel('Tiền khách đưa').fill('100000')
 await actions.getByRole('button',{name:'Thanh toán & In hóa đơn',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>(window as any).__prints.length)).toBe(1)
 expect(payments).toHaveLength(1)
 await page.getByRole('button',{name:'Hóa đơn & Mẫu in',exact:true}).click()
 await page.getByLabel('Tìm hóa đơn',{exact:true}).fill(initialProduct.name)
 await page.getByRole('button',{name:new RegExp(payments[0].p_code)}).click()
 await expect(page.getByRole('article',{name:`Hóa đơn ${payments[0].p_code}`})).toContainText('35.000')
 await page.getByRole('button',{name:'In lại hóa đơn',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>(window as any).__prints.length)).toBe(2)
 expect(payments).toHaveLength(1)
 await page.getByLabel('Tìm hóa đơn',{exact:true}).fill('Không tồn tại')
 await expect(page.getByText('Không có hóa đơn phù hợp.',{exact:true})).toBeVisible()
})

test('explicit no-print overrides auto-print; failed checkout never opens print',async({page})=>{
 await printSpy(page)
 await fixture(page,{autoPrint:true})
 await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
 await page.getByRole('button',{name:'Thanh toán (F9)',exact:true}).click()
 await page.getByLabel('Tiền khách đưa').fill('100000')
 await page.getByRole('button',{name:'Chỉ thanh toán, không in',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Thanh toán thành công'})).toBeVisible()
 expect(await page.evaluate(()=>(window as any).__prints.length)).toBe(0)
 await fixture(page,{failCheckout:true})
 await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
 await page.getByRole('button',{name:'Thanh toán (F9)',exact:true}).click()
 await page.getByLabel('Tiền khách đưa').fill('100000')
 await page.getByRole('button',{name:'Thanh toán & In hóa đơn',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Thanh toán thất bại'})).toBeVisible()
 expect(await page.evaluate(()=>(window as any).__prints.length)).toBe(0)
})

test('print failure after successful payment never charges again or claims payment failed',async({page})=>{
 const {payments}=await fixture(page)
 await page.evaluate(()=>{window.print=()=>{throw new Error('Printer unavailable')}})
 await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
 await page.getByRole('button',{name:'Thanh toán (F9)',exact:true}).click()
 await page.getByLabel('Tiền khách đưa').fill('100000')
 await page.getByRole('button',{name:'Thanh toán & In hóa đơn',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Đã thanh toán, chưa in được'})).toBeVisible()
 expect(payments).toHaveLength(1)
 await expect(page.getByRole('dialog',{name:'Thanh toán đơn hàng'})).toHaveCount(0)
 await page.getByRole('button',{name:'Hóa đơn & Mẫu in',exact:true}).click()
 await expect(page.getByRole('button',{name:new RegExp(payments[0].p_code)})).toBeVisible()
})

test('QR toggle uses configured bank and bill amount; disabled QR never prints a placeholder account',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('vietqr-config',JSON.stringify({bankId:'MB',accountNo:'12345678',accountName:'TEST ONLY'})))
 await fixture(page);await designer(page)
 const preview=page.getByLabel('Xem trước mẫu hóa đơn')
 await expect(preview.getByRole('img',{name:'QR chuyển khoản'})).toHaveCount(0)
 await page.getByLabel('Hiển thị mã QR chuyển khoản trên bill',{exact:true}).check()
 await expect(preview.getByRole('img',{name:'QR chuyển khoản'})).toHaveAttribute('src',/MB-12345678.*amount=65000.*IN-THU/)
 await page.getByLabel('Hiển thị mã QR chuyển khoản trên bill',{exact:true}).uncheck()
 await expect(preview.getByRole('img',{name:'QR chuyển khoản'})).toHaveCount(0)
})
