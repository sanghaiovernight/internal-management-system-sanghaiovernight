import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import {bankQr,receiptSettings} from '../../lib/receipts'

const barcode = '0012345678901'
const initialProduct = { id: 'test-product', name: 'Sản phẩm thử nghiệm có tên rất dài để kiểm tra bố cục trên điện thoại', category: 'Đồ đóng gói', tag: 'Đồ đóng gói', price: 35000, cost_price: 20000, stock: 8, barcode, product_type: 'retail', is_imported: true }

async function fixture(page: Page, options: { failStorage?:boolean; extraCategories?:string[]; failReceive?: boolean; failCategory?: boolean; stock?: number; retail?: boolean; cartQuantity?: number; failCheckout?: boolean; failVoid?: boolean; historyOffline?: boolean; settingsOffline?: boolean; autoPrint?: boolean; rawHistory?: boolean; legacyLog?:boolean; failAdjust?: boolean; failCheck?:boolean; paperWidth?:58|80; legacyQr?:boolean; secondProduct?:boolean } = {}) {
  let product:any = { ...initialProduct, stock: options.stock ?? 8, product_type:options.retail===false?'processed':'retail', is_imported: options.retail ?? true }
  let extra:any=options.secondProduct?{...initialProduct,id:'second-product',name:'Bạc xỉu',stock:0,is_imported:false,product_type:'processed'}:null
  const added:any[]=[]
  const productWrites:any[]=[]
  const uploaded:Buffer[]=[]
  const checks:any[]=[]
  const checkRequests:any[]=[]
  const categories = [{ name: 'Đồ đóng gói' },...(options.extraCategories??[]).map(name=>({name}))]
  let template:any = { id:'default',store_name:'SangHai Overnight',paper_width:options.paperWidth??80,auto_print:options.autoPrint??false,show_qr:false }
  let orders:any[] = []
  let imports: Record<string, any>[] = []
  const receipts: Record<string, unknown>[] = []
  const results:any[]=[]
  const requestOrders=new Map<string,any>()
  const returns=new Map<string,any>()
  const payments: Record<string, any>[] = []
  const requests: string[] = []
  await page.route('https://**/*', async (route) => {
    const url = new URL(route.request().url())
    if(url.hostname==='cdn.example.test'){await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="orange"/></svg>'});return}
    if(url.pathname.includes('/storage/v1/object/')){
      if(route.request().method()==='POST'){
        const raw=route.request().postDataBuffer()!,start=raw.indexOf(Buffer.from('RIFF'))
        if(start>=0)uploaded.push(raw.subarray(start,start+raw.readUInt32LE(start+4)+8))
        await route.fulfill({status:options.failStorage?403:200,contentType:'application/json',body:JSON.stringify(options.failStorage?{message:'Storage denied',error:'Unauthorized'}:{Key:url.pathname.split('/object/')[1],Id:'test-photo'})})
      }else await route.fulfill({contentType:'image/webp',body:uploaded.at(-1)??Buffer.alloc(0)})
      return
    }
    if (!url.pathname.includes('/rest/v1/')) { await route.abort(); return }
    const table = url.pathname.split('/').at(-1)
    const method = route.request().method()
    requests.push(`${method} ${table}`)
    let body: unknown = []
    let status = 200
    if (method === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } }); return }
    if (table === 'pos_receipt_settings') { if(options.settingsOffline){status=403;body={message:'offline'}}else{if(method==='POST') template={...template,...route.request().postDataJSON()}; body=template} }
    else if(table==='pos_orders') body=options.rawHistory?orders.map((row)=>({...row,items:JSON.stringify(JSON.stringify(row.items))})):options.legacyLog?orders.map((row)=>({...row,receipt_no:'HD1793470000000abcdef',activity_receipt_no:row.receipt_no,activity_events:row.activity_events.map((event:any)=>({...event,receipt_no:'HD1793470000000abcdef'}))})):orders
    else if(table==='pos_stock_checks')body=checks
    else if(table==='pos_complete_stock_check') {
      const input=route.request().postDataJSON();checkRequests.push(input)
      if(options.failCheck){status=503;body={message:'Chưa kết nối được máy chủ kiểm kho'}}
      else {
        const saved=checks.find(row=>row.id===input.p_request_id)
        const lines=saved?.lines??input.p_lines.map((line:any)=>{
          const current=line.product_id===product.id?product:extra?.id===line.product_id?extra:added.find(row=>row.id===line.product_id)!
          const delta=line.actual_stock-current.stock
          const cost=current.is_imported&&delta>0?Math.round((Math.max(0,current.stock)*current.cost_price+delta*line.unit_cost)/(Math.max(0,current.stock)+delta)):current.cost_price
          const next={...current,stock:line.actual_stock,cost_price:cost}
          if(current.id===product.id)product=next;else if(extra?.id===current.id)extra=next;else added[added.findIndex(row=>row.id===current.id)]=next
          return {product_id:current.id,name:current.name,stock_before:current.stock,stock_after:next.stock,cost_before:current.cost_price,cost_after:cost,delta,unit_cost:line.unit_cost,is_imported:current.is_imported}
        })
        const sheet=saved??{id:input.p_request_id,check_no:'KK0111001',created_at:new Date().toISOString(),lines,total_increase:lines.reduce((n:number,l:any)=>n+Math.max(0,l.delta),0),total_decrease:lines.reduce((n:number,l:any)=>n+Math.max(0,-l.delta),0)}
        if(!saved)checks.push(sheet)
        body={sheet,products:[product,...(extra?[extra]:[]),...added]}
      }
    }
    else if (table === 'pos_products') {
      let saved=product
      if(method==='POST'){const input=route.request().postDataJSON();productWrites.push(input);saved={...input};added.push(saved)}
      if(method==='PATCH'){
        const input=route.request().postDataJSON(),id=url.searchParams.get('id')?.replace(/^eq\./,'')??product.id
        productWrites.push({id,...input})
        if(id===product.id){product={...product,...input};saved=product}
        else if(extra?.id===id){extra={...extra,...input};saved=extra}
        else {const index=added.findIndex(row=>row.id===id);added[index]={...added[index],...input};saved=added[index]}
      }
      body = method === 'GET' ? [product,...(extra?[extra]:[]),...added] : saved
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
      const target=input.p_product_id===product.id?product:added.find(row=>row.id===input.p_product_id)!
      receipts.push(input)
      if (options.failReceive) { status = 403; body = { message: 'permission denied' } }
      else {
        const beforeProduct=product;product=target
        const receipt = { receipt_no:`PN${new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit'}).format(new Date()).replaceAll('/','')}${String(imports.length+1).padStart(3,'0')}`, id: input.p_receipt_id, product_id: product.id, product_name: product.name, quantity: input.p_quantity, unit_cost: input.p_total / input.p_quantity, total_cost: input.p_total, created_at: new Date().toISOString(), cost_before: product.cost_price, stock_before: product.stock, reversible: true }
        product = { ...product, stock: product.stock + input.p_quantity, cost_price: Math.round((Math.max(0,product.stock)*product.cost_price+input.p_total)/(Math.max(0,product.stock)+input.p_quantity)) }
        imports = [receipt, ...imports]; body = { stock: product.stock, cost_price: product.cost_price, receipt }
        if(target.id!==beforeProduct.id){added[added.findIndex(row=>row.id===target.id)]=product;product=beforeProduct}
      }
    } else if (table === 'pos_void_stock_import') {
      const receipt = imports.find((row) => row.id === route.request().postDataJSON().p_id)!
      if (options.failVoid) { status = 400; body = { message: 'hàng của phiếu đã được bán' } }
      else { product = { ...product, stock: receipt.stock_before, cost_price: receipt.cost_before }; imports = imports.filter((row) => row.id !== receipt.id); body = { product_id: product.id, stock: product.stock, cost_price: product.cost_price } }
    } else if (table === 'pos_checkout_order') {
      const input = route.request().postDataJSON()
      payments.push(input)
      const quantity = input.p_items.reduce((sum: number, line: any) => sum+line.quantity,0)
      if (options.failCheckout || (product.is_imported && quantity > product.stock)) { status = 400; body = { message: 'Không đủ tồn kho trên máy chủ' } }
      else if(requestOrders.has(input.p_request_id)) body={products:[{id:product.id,stock:product.stock,cost_price:product.cost_price}],order:requestOrders.get(input.p_request_id)}
      else {
        product={...product,stock:Math.max(0,product.stock-quantity)}
        const day=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit'}).format(new Date()).replaceAll('/','')
        const code=`HD${day}${String(orders.length+1).padStart(3,'0')}`
        const items=input.p_items.map((item:any,index:number)=>({...item,line_id:String(index+1),is_imported:product.is_imported}))
        const subtotal=items.reduce((sum:number,item:any)=>sum+item.price*item.quantity,0)
        const template=receiptSettings(input.p_receipt.settings)
        const order={id:input.p_request_id,receipt_no:code,transaction_code:`ORDER-${input.p_request_id}`,created_at:new Date().toISOString(),status:'paid',version:0,activity_events:[],original_items:items,original_total:input.p_total,original_subtotal:subtotal,payment_method:input.p_method,items,subtotal,discount:subtotal-input.p_total,total:input.p_total,cash_received:input.p_receipt.cash_received,change_due:input.p_receipt.cash_received==null?null:input.p_receipt.cash_received-input.p_total,receipt_settings:template,qr_url:template.show_qr?bankQr(input.p_total,code,template)?.replace('-qr_only.png',options.legacyQr?'-compact2.png':'-qr_only.png'):null}
        orders.push(order);results.push(order);requestOrders.set(input.p_request_id,order)
        body={products:[{id:product.id,stock:product.stock,cost_price:product.cost_price}],order}
      }

    }
    if(table==='pos_adjust_order') {
      const input=route.request().postDataJSON(),order=orders.find((row)=>row.id===input.p_order_id)
      if(options.failAdjust){status=403;body={message:'Không có quyền hoàn tồn kho'}}
      else if(returns.has(input.p_request_id))body=returns.get(input.p_request_id)
      else if(order.version!==input.p_expected_version){status=400;body={message:'Hóa đơn đã thay đổi trên máy khác'}}
      else {
        const changes:any[]=[]
        const items=order.items.map((item:any)=>{const row=input.p_quantities.find((row:any)=>row.line_id===item.line_id);const quantity=input.p_action==='void'?0:row?.quantity??item.quantity;if(quantity<item.quantity){const delta=item.quantity-quantity;changes.push({id:item.id,name:item.name,quantity:delta});if(item.is_imported)product={...product,stock:product.stock+delta}}return {...item,quantity}})
        const subtotal=items.reduce((sum:number,item:any)=>sum+item.quantity*item.price,0),total=input.p_action==='void'?0:Math.round(subtotal*order.original_total/order.original_subtotal)
        const event={id:input.p_request_id,created_at:new Date().toISOString(),receipt_no:order.receipt_no,action:input.p_action,items:changes,refund_amount:order.total-total}
        const saved={...order,items,subtotal,total,discount:subtotal-total,status:input.p_action==='void'?'voided':'refunded',version:order.version+1,activity_events:[...order.activity_events,event]}
        orders=orders.map((row)=>row.id===saved.id?saved:row)
        body={order:saved,products:[{id:product.id,stock:product.stock,cost_price:product.cost_price}]};returns.set(input.p_request_id,body)
      }
    }
    await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: new RegExp(initialProduct.name) }).first()).toBeVisible()
  return { receipts, payments, requests, results,checkRequests,productWrites,uploaded }
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
  const { payments,results } = await fixture(page,{stock:0,cartQuantity:1})
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
    const { payments,results } = await fixture(page,{stock,retail:false})
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
  const { payments,results } = await fixture(page,{stock:1,failCheckout:true})
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
  await expect(page.getByRole('button',{name:/Xóa phiếu nhập PN/,exact:false})).toBeDisabled()
})

test('retail checkout decrements stock and renders sold out; retry reuses the bill identifier', async ({ page }) => {
  const options = { stock:1,failCheckout:true }
  const { payments,results } = await fixture(page,options)
  await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
  await page.getByRole('button',{name:'Thanh toán (F9)',exact:true}).click()
  await page.getByLabel('Tiền khách đưa').fill('100000')
  await page.getByRole('button',{name:'Chỉ thanh toán, không in',exact:true}).last().click()
  await expect(page.getByRole('status').filter({hasText:'Thanh toán thất bại'})).toBeVisible()
  options.failCheckout = false
  await page.getByRole('button',{name:'Chỉ thanh toán, không in',exact:true}).last().click()
  await expect(page.getByRole('status').filter({hasText:'Thanh toán thành công!'})).toBeVisible()
  expect(payments).toHaveLength(2)
  expect(payments[0].p_request_id).toEqual(payments[1].p_request_id)
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

test('designer updates fixed K80 receipt, saves template, and prints only the receipt area',async({page})=>{
 await printSpy(page);await fixture(page);await designer(page)
 await page.getByLabel('Tên cửa hàng',{exact:true}).fill('Quán in thử')
 await page.getByLabel('Địa chỉ',{exact:true}).fill('123 Đường thử')
 await page.getByLabel('Tên Wifi',{exact:true}).fill('Wifi thử')
 await page.getByLabel('Mật khẩu Wifi',{exact:true}).fill('test-pass')
 await expect(page.getByLabel('Khổ giấy',{exact:true})).toHaveCount(0)
 const preview=page.getByLabel('Xem trước mẫu hóa đơn')
 await expect(preview).toContainText('Quán in thử');await expect(preview).toContainText('123 Đường thử');await expect(preview).toContainText('test-pass')
 await expect(preview.locator('article')).toHaveAttribute('style',/80mm/)
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
 const {payments,results}=await fixture(page,{stock:2,autoPrint:true})
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
 await page.getByRole('button',{name:new RegExp(results[0].receipt_no)}).click()
 await expect(page.getByRole('article',{name:`Hóa đơn ${results[0].receipt_no}`})).toContainText('35.000')
 await page.getByRole('button',{name:'In lại hóa đơn',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>(window as any).__prints.length)).toBe(2)
 expect(payments).toHaveLength(1)
 await page.getByRole('button',{name:'Đóng chi tiết hóa đơn',exact:true}).click()
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
 const {payments,results}=await fixture(page)
 await page.evaluate(()=>{window.print=()=>{throw new Error('Printer unavailable')}})
 await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
 await page.getByRole('button',{name:'Thanh toán (F9)',exact:true}).click()
 await page.getByLabel('Tiền khách đưa').fill('100000')
 await page.getByRole('button',{name:'Thanh toán & In hóa đơn',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Đã thanh toán, chưa in được'})).toBeVisible()
 expect(payments).toHaveLength(1)
 await expect(page.getByRole('dialog',{name:'Thanh toán đơn hàng'})).toHaveCount(0)
 await page.getByRole('button',{name:'Hóa đơn & Mẫu in',exact:true}).click()
 await expect(page.getByRole('button',{name:new RegExp(results[0].receipt_no)})).toBeVisible()
})

test('QR toggle uses configured bank and bill amount; disabled QR never prints a placeholder account',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('vietqr-config',JSON.stringify({bankId:'MB',accountNo:'12345678',accountName:'TEST ONLY'})))
 await fixture(page);await designer(page)
 const preview=page.getByLabel('Xem trước mẫu hóa đơn')
 await expect(preview.getByRole('img',{name:'QR chuyển khoản'})).toHaveCount(0)
 await page.getByLabel('Tên Ngân hàng (Mã viết tắt, VD: MB, VCB)',{exact:true}).fill('MB')
 await page.getByLabel('Số tài khoản',{exact:true}).fill('12345678')
 await page.getByLabel('Tên chủ tài khoản',{exact:true}).fill('TEST ONLY')
 await page.getByLabel('Hiển thị mã QR chuyển khoản trên bill',{exact:true}).check()
 await expect(preview.getByRole('img',{name:'QR chuyển khoản'})).toHaveAttribute('src',/MB-12345678.*amount=65000.*IN-THU/)
 await page.getByLabel('Hiển thị mã QR chuyển khoản trên bill',{exact:true}).uncheck()
 await expect(preview.getByRole('img',{name:'QR chuyển khoản'})).toHaveCount(0)
})

test('invoice history decodes legacy JSON, uses a detail modal and leaves Reports without transaction history',async({page})=>{
 const {payments,results}=await fixture(page,{rawHistory:true})
 await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
 await page.getByRole('button',{name:'Thanh toán (F9)',exact:true}).click()
 await page.getByLabel('Tiền khách đưa').fill('100000')
 await page.getByRole('button',{name:'Chỉ thanh toán, không in',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Thanh toán thành công'})).toBeVisible()
 expect(Array.isArray(payments[0].p_items)).toBe(true)
 await page.reload()
 await page.getByRole('button',{name:'Báo cáo',exact:true}).click()
 await expect(page.getByText('Lịch sử giao dịch',{exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Hóa đơn & Mẫu in',exact:true}).click()
 const bill=page.getByRole('button',{name:new RegExp(results[0].receipt_no)})
 await expect(bill).toContainText(initialProduct.name)
 await expect(bill).not.toContainText('"quantity"')
 await bill.click()
 await expect(page.getByRole('dialog',{name:`Chi tiết hóa đơn ${results[0].receipt_no}`})).toBeVisible()
 await expect(page.getByRole('button',{name:'In lại hóa đơn',exact:true})).toBeVisible()
 await page.keyboard.press('Escape')
 await expect(page.getByRole('dialog')).toHaveCount(0)
 await page.getByLabel('Ngày thanh toán',{exact:true}).fill('31/02/2026')
 await expect(page.getByRole('alert').filter({hasText:'Ngày không hợp lệ'})).toBeVisible()
 await page.getByLabel('Ngày thanh toán',{exact:true}).fill('01/01/2000')
 await expect(page.getByText('Không có hóa đơn phù hợp.',{exact:true})).toBeVisible()
 await expect(page.getByLabel('Ngày thanh toán',{exact:true})).toHaveAttribute('placeholder','dd/MM/yyyy')
})

test('designer bank fields persist and generate the actual paid bill QR without local bank settings',async({page})=>{
 await printSpy(page)
 const {payments,results}=await fixture(page)
 await designer(page)
 await page.getByLabel('Hiển thị mã QR chuyển khoản trên bill',{exact:true}).check()
 await expect(page.getByText(/Vui lòng nhập đủ mã ngân hàng/)).toBeVisible()
 await page.getByLabel('Tên Ngân hàng (Mã viết tắt, VD: MB, VCB)',{exact:true}).fill('VCB')
 await page.getByLabel('Số tài khoản',{exact:true}).fill('987654321')
 await page.getByLabel('Tên chủ tài khoản',{exact:true}).fill('TEST OWNER')
 await expect(page.getByText(/Vui lòng nhập đủ mã ngân hàng/)).toHaveCount(0)
 await page.getByRole('button',{name:'Lưu mẫu hóa đơn',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Đã lưu mẫu hóa đơn lên máy chủ'})).toBeVisible()
 await page.getByRole('button',{name:'POS',exact:true}).click()
 await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
 await page.getByRole('button',{name:'Thanh toán (F9)',exact:true}).click()
 await page.getByLabel('Tiền khách đưa').fill('100000')
 await page.getByRole('button',{name:'Chỉ thanh toán, không in',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Thanh toán thành công'})).toBeVisible()
 const qr=new URL(results[0].qr_url)
 expect(qr.pathname).toBe('/image/VCB-987654321-qr_only.png')
 expect(qr.searchParams.get('amount')).toBe('35000')
 expect(qr.searchParams.get('addInfo')).toBe(results[0].receipt_no)
 expect(qr.searchParams.get('accountName')).toBe('TEST OWNER')
 await page.reload();await designer(page)
 await expect(page.getByLabel('Số tài khoản',{exact:true})).toHaveValue('987654321')
})

async function buyTwo(page:Page,options:Parameters<typeof fixture>[1]={}) {
 const data=await fixture(page,options)
 await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
 await page.getByRole('button',{name:`Tăng ${initialProduct.name}`,exact:true}).click()
 await page.getByRole('button',{name:'Thanh toán (F9)',exact:true}).click()
 await page.getByLabel('Tiền khách đưa').fill('100000')
 await page.getByRole('button',{name:'Chỉ thanh toán, không in',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Thanh toán thành công'})).toBeVisible()
 await page.getByRole('button',{name:'Hóa đơn & Mẫu in',exact:true}).click()
 await page.getByRole('button',{name:new RegExp(data.results[0].receipt_no)}).click()
 return data
}

test('short public codes contain date and three digits, while retry identity stays separate',async({page})=>{
 const {results,payments}=await buyTwo(page)
 expect(results[0].receipt_no).toMatch(/^HD\d{7}$/)
 expect(payments[0].p_request_id).toMatch(/^[0-9a-f-]{36}$/)
 expect(payments[0].p_code).toBeUndefined()
 await expect(page.getByRole('heading',{name:`Chi tiết hóa đơn ${results[0].receipt_no}`})).toBeVisible()
})

test('partial refund followed by void restores only remaining retail units, updates bill and activity timeline',async({page})=>{
 const {results}=await buyTwo(page)
 await page.getByRole('button',{name:'Sửa / Trả hàng',exact:true}).click()
 const refund=page.getByRole('dialog',{name:`Sửa / Trả hàng ${results[0].receipt_no}`})
 await refund.getByRole('spinbutton').fill('1')
 await expect(refund).toContainText('35.000đ')
 await refund.getByRole('button',{name:'Lưu trả hàng',exact:true}).click()
 await expect(page.getByRole('dialog',{name:`Chi tiết hóa đơn ${results[0].receipt_no}`})).toBeVisible()
 await page.getByRole('button',{name:'Hủy hóa đơn',exact:true}).click()
 const confirmation=page.getByRole('alertdialog')
 await expect(confirmation).toContainText('hàng đã trả trước đó không được cộng lần nữa')
 await confirmation.getByRole('button',{name:'Hủy hóa đơn',exact:true}).click()
 await expect(page.getByRole('button',{name:'Hủy hóa đơn',exact:true})).toBeDisabled()
 await page.getByRole('button',{name:'Đóng chi tiết hóa đơn',exact:true}).click()
 await inventory(page)
 await expect(page.getByLabel(`Tồn kho ${initialProduct.name}`,{exact:true})).toHaveText('8')
 await page.getByRole('button',{name:'Nhật ký hoạt động',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Sửa bill',exact:true})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Hủy bill',exact:true})).toBeVisible()
 await expect(page.locator('ol')).toContainText(`${initialProduct.name} trả 1`)
 await expect(page.locator('ol')).toContainText(results[0].receipt_no)
})

test('void confirmation cancel leaves bill and stock unchanged; prepared refund never restores stock',async({page})=>{
 await buyTwo(page,{retail:false,stock:5})
 await page.getByRole('button',{name:'Hủy hóa đơn',exact:true}).click()
 await page.getByRole('alertdialog').getByRole('button',{name:'Hủy',exact:true}).click()
 await expect(page.getByRole('button',{name:'Hủy hóa đơn',exact:true})).toBeEnabled()
 await page.getByRole('button',{name:'Sửa / Trả hàng',exact:true}).click()
 await page.getByRole('dialog').getByRole('spinbutton').fill('0')
 await page.getByRole('button',{name:'Lưu trả hàng',exact:true}).click()
 await page.getByRole('button',{name:'Đóng chi tiết hóa đơn',exact:true}).click()
 await inventory(page)
 await expect(page.getByLabel(`Tồn kho ${initialProduct.name}`,{exact:true})).toHaveText('3')
})

test('failed return keeps the detail and inventory unchanged',async({page})=>{
 await buyTwo(page,{failAdjust:true})
 await page.getByRole('button',{name:'Sửa / Trả hàng',exact:true}).click()
 await page.getByRole('dialog').getByRole('spinbutton').fill('1')
 await page.getByRole('button',{name:'Lưu trả hàng',exact:true}).click()
 await expect(page.getByRole('dialog').getByRole('status')).toContainText('Không có quyền hoàn tồn kho')
 await page.getByRole('dialog').getByRole('button',{name:'Đóng',exact:true}).click()
 await page.getByRole('button',{name:'Đóng chi tiết hóa đơn',exact:true}).click()
 await inventory(page)
 await expect(page.getByLabel(`Tồn kho ${initialProduct.name}`,{exact:true})).toHaveText('6')
})

test('import history and activity share PN numbers and never show the internal UUID',async({page})=>{
 const {receipts}=await fixture(page)
 await inventory(page)
 await page.getByRole('button',{name:'Nhập hàng',exact:true}).click()
 await page.getByLabel('Mặt hàng nhập',{exact:true}).selectOption(initialProduct.id)
 await page.getByLabel('Số lượng nhập',{exact:true}).fill('2')
 await page.getByLabel('Tổng tiền nhập',{exact:true}).fill('12000')
 await page.getByRole('button',{name:'Lưu phiếu nhập',exact:true}).click()
 const history=page.getByRole('region',{name:'Lịch sử nhập kho'})
 const code=await history.getByRole('cell',{name:/^PN\d{7,}$/}).textContent()
 await expect(history).not.toContainText(String(receipts[0].p_receipt_id))
 await expect(history.getByRole('button',{name:`Xóa phiếu nhập ${code}`,exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Nhật ký hoạt động',exact:true}).click()
 await expect(page.locator('ol')).toContainText(code!)
 await expect(page.locator('ol')).not.toContainText(String(receipts[0].p_receipt_id))
 await expect(page.locator('ol').getByText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/)).toBeVisible()
})

test('legacy void/refund events use the short activity alias instead of the old timestamp bill number',async({page})=>{
 const {results}=await buyTwo(page,{legacyLog:true})
 await page.getByRole('button',{name:'Hủy hóa đơn',exact:true}).click()
 await page.getByRole('alertdialog').getByRole('button',{name:'Hủy hóa đơn',exact:true}).click()
 await page.getByRole('button',{name:'Đóng chi tiết hóa đơn',exact:true}).click()
 await page.reload()
 await page.getByRole('button',{name:'Nhật ký hoạt động',exact:true}).click()
 await expect(page.locator('ol')).toContainText(results[0].receipt_no)
 await expect(page.locator('ol')).not.toContainText('HD1793470000000abcdef')
 await expect(page.locator('ol').getByText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/)).toBeVisible()
})

async function stocktake(page:Page){
 await page.getByRole('button',{name:'Kho hàng',exact:true}).click()
 await page.getByRole('button',{name:'Kiểm kho',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Tạo Phiếu Kiểm Kho',exact:true})).toBeVisible()
}
test('stocktake requires surplus cost, saves one sheet, updates MAC and shows grouped activity',async({page})=>{
 const {checkRequests,requests}=await fixture(page,{secondProduct:true})
 await stocktake(page)
 const finish=page.getByRole('button',{name:'Hoàn thành kiểm kho',exact:true})
 await expect(finish).toBeDisabled();await expect(page.getByRole('button',{name:'Cân bằng',exact:true})).toHaveCount(0)
 await page.getByLabel(`Tồn thực tế ${initialProduct.name}`,{exact:true}).fill('12')
 await expect(finish).toBeDisabled();await expect(page.getByTestId('stocktake-footer')).toContainText('Tổng chênh lệch tăng: 4')
 await page.getByLabel(`Giá vốn phần tăng ${initialProduct.name}`,{exact:true}).fill('25000')
 await expect(page.getByLabel(`Giá vốn phần tăng ${initialProduct.name}`,{exact:true})).toHaveValue('25.000')
 await page.getByLabel('Tồn thực tế Bạc xỉu',{exact:true}).fill('50')
 await expect(page.getByLabel('Giá vốn phần tăng Bạc xỉu',{exact:true})).toHaveCount(0)
 await page.getByLabel('Tìm hàng trong kho').fill('Bạc xỉu')
 await expect(page.getByTestId('stocktake-row')).toHaveCount(1)
 await expect(page.getByTestId('stocktake-footer')).toContainText('Tổng chênh lệch tăng: 54')
 await finish.click();await expect(page.getByRole('status').filter({hasText:'Đã hoàn thành phiếu kiểm kho'})).toBeVisible()
 expect(checkRequests).toHaveLength(1);expect(checkRequests[0].p_lines).toHaveLength(2)
 expect(requests.filter(r=>r==='PATCH pos_products')).toHaveLength(0)
 await page.getByLabel('Tìm hàng trong kho').fill('')
 await page.getByRole('button',{name:'Tồn kho',exact:true}).click()
 await expect(page.getByLabel(`Tồn kho ${initialProduct.name}`,{exact:true})).toHaveText('12')
 await expect(page.getByTestId('inventory-cost').first()).toContainText('21.667đ')
 await page.getByRole('button',{name:'Nhật ký hoạt động',exact:true}).click()
 await expect(page.getByRole('heading',{name:'Kiểm kho',exact:true})).toHaveCount(1)
 await expect(page.locator('ol')).toContainText('KK0111001')
 await expect(page.locator('ol')).toContainText(`${initialProduct.name}: 8 → 12`)
 await expect(page.locator('ol')).toContainText('Bạc xỉu: 0 → 50')
})
test('stocktake blank rows stay untouched and zero counts losses without requesting cost',async({page})=>{
 const {checkRequests}=await fixture(page,{secondProduct:true});await stocktake(page)
 await page.getByLabel(`Tồn thực tế ${initialProduct.name}`,{exact:true}).fill('0')
 await expect(page.getByLabel(`Giá vốn phần tăng ${initialProduct.name}`,{exact:true})).toHaveCount(0)
 await expect(page.getByTestId('stocktake-footer')).toContainText('Tổng chênh lệch giảm: 8')
 await page.getByRole('button',{name:'Hoàn thành kiểm kho',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Đã hoàn thành phiếu kiểm kho'})).toBeVisible()
 expect(checkRequests[0].p_lines).toHaveLength(1);expect(checkRequests[0].p_lines[0]).toMatchObject({actual_stock:0,unit_cost:null})
})
test('failed stocktake retains inputs and reuses the request UUID on retry',async({page})=>{
 const {checkRequests}=await fixture(page,{failCheck:true});await stocktake(page)
 await page.getByLabel(`Tồn thực tế ${initialProduct.name}`,{exact:true}).fill('3')
 for(let i=0;i<2;i++){
  await page.getByRole('button',{name:'Hoàn thành kiểm kho',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Chưa kết nối được máy chủ kiểm kho'})).toBeVisible()
 }
 expect(checkRequests).toHaveLength(2);expect(checkRequests[0].p_request_id).toBe(checkRequests[1].p_request_id)
 await expect(page.getByLabel(`Tồn thực tế ${initialProduct.name}`,{exact:true})).toHaveValue('3')
})
test('stocktake formatted bounded inputs and fixed footer fit narrow mobile screens',async({page})=>{
 await fixture(page);await stocktake(page)
 const actual=page.getByLabel(`Tồn thực tế ${initialProduct.name}`,{exact:true})
 await actual.fill('8161616');await expect(actual).toHaveValue('8.161.616')
 const cost=page.getByLabel(`Giá vốn phần tăng ${initialProduct.name}`,{exact:true})
 await cost.fill('999999999999');await expect(cost).toHaveValue('999.999.999.999')
 await actual.fill('1000000000');await expect(actual).toHaveValue('8.161.616')
 await actual.fill('1e9');await expect(actual).toHaveValue('8.161.616')
 await cost.fill('1000000000000');await expect(cost).toHaveValue('999.999.999.999')
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:850})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await expect(page.getByRole('button',{name:'Hoàn thành kiểm kho',exact:true})).toBeInViewport()
  expect(await page.getByTestId('stocktake-footer').evaluate(el=>getComputedStyle(el).position)).toBe('fixed')
 }
})

for(const width of [58,80])test(`thermal receipt always uses K80 with saved K${width} settings and shares Arial fonts, bold totals, solid headers and QR-only images in preview and print`,async({page})=>{
 await printSpy(page)
 const {results}=await fixture(page,{legacyQr:true,paperWidth:width as 58|80})
 const qrRequests:string[]=[]
 await page.route('https://img.vietqr.io/image/**',async route=>{
  qrRequests.push(route.request().url())
  await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="490" height="490"><rect width="490" height="490" fill="white"/><rect x="40" y="40" width="410" height="410" fill="black"/></svg>'})
 })
 await designer(page)
 await expect(page.getByLabel('Khổ giấy',{exact:true})).toHaveCount(0)
 await page.getByLabel('Tên Ngân hàng (Mã viết tắt, VD: MB, VCB)',{exact:true}).fill('MB')
 await page.getByLabel('Số tài khoản',{exact:true}).fill('00123456')
 await page.getByLabel('Tên chủ tài khoản',{exact:true}).fill('TEST OWNER')
 await page.getByLabel('Hiển thị mã QR chuyển khoản trên bill',{exact:true}).check()
 const preview=page.getByLabel('Xem trước mẫu hóa đơn').locator('article')
 async function checkDesign(receipt:ReturnType<Page['locator']>){
  expect(await receipt.locator('*').evaluateAll(elements=>elements.every(el=>getComputedStyle(el).fontFamily==='Arial, "Helvetica Neue", Helvetica, sans-serif'))).toBe(true)
  for(const selector of ['.receipt-store','h3','.receipt-lines th','.receipt-pair']){
   expect(await receipt.locator(selector).evaluateAll(elements=>elements.length>0&&elements.every(el=>Number(getComputedStyle(el).fontWeight)>=700))).toBe(true)
  }
  const summary=await receipt.locator('.receipt-pair').evaluateAll(rows=>rows.map(row=>{
   const label=row.querySelector('span')!,amount=row.querySelector('b')!,box=row.getBoundingClientRect()
   return {size:getComputedStyle(row).fontSize,labelLeft:Math.abs(label.getBoundingClientRect().left-box.left)<1,amountRight:Math.abs(amount.getBoundingClientRect().right-box.right)<1}
  }))
  expect(summary.length).toBe(3)
  await expect(receipt.getByText(/Khách đưa|Tiền thừa/)).toHaveCount(0)
  expect(summary.every(row=>row.size==='11px'&&row.labelLeft&&row.amountRight)).toBe(true)
  const borders=await receipt.locator('thead').evaluate(el=>{const s=getComputedStyle(el);return [s.borderTopStyle,s.borderBottomStyle,s.borderTopWidth,s.borderBottomWidth,s.borderTopColor,s.borderBottomColor]})
  expect(borders).toEqual(['solid','solid','1px','1px','rgb(0, 0, 0)','rgb(0, 0, 0)'])
  const frame=receipt.locator('.receipt-qr-frame')
  await expect(frame).toHaveText('');await expect(frame.locator('img')).toHaveCount(1)
  expect(await frame.evaluate(el=>{const r=el.getBoundingClientRect();return Math.abs(r.width-r.height)<1&&getComputedStyle(el).overflow==='hidden'})).toBe(true)
  await expect(receipt.getByText('Quét mã chuyển khoản',{exact:true})).toHaveCount(0)
  expect(await receipt.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true)
 }
 await checkDesign(preview)
 await expect(preview).toHaveAttribute('style',/80mm/)
 await preview.screenshot({path:test.info().outputPath(`receipt-preview-k${width}.png`)})
 await expect(preview.getByRole('img',{name:'QR chuyển khoản'})).toHaveAttribute('src',/-qr_only.png\?amount=65000/)
 await page.getByRole('button',{name:'Lưu mẫu hóa đơn',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Đã lưu mẫu hóa đơn lên máy chủ'})).toBeVisible()
 await page.getByRole('button',{name:'POS',exact:true}).click()
 await page.getByRole('button',{name:new RegExp(initialProduct.name)}).first().click()
 await page.getByRole('button',{name:'Thanh toán (F9)',exact:true}).click()
 await page.getByLabel('Tiền khách đưa').fill('100000')
 await page.getByRole('button',{name:'Chỉ thanh toán, không in',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Thanh toán thành công'})).toBeVisible()
 expect(results[0].qr_url).toContain('-compact2.png') // Simulate existing server-side snapshots.
 await page.getByRole('button',{name:'Hóa đơn & Mẫu in',exact:true}).click()
 await page.getByRole('button',{name:new RegExp(results[0].receipt_no)}).click()
 await page.getByRole('button',{name:'In lại hóa đơn',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>(window as any).__prints.length)).toBe(1)
 await page.emulateMedia({media:'print'})
 const printed=page.locator('#receipt-print-area article')
 await expect(printed).toBeVisible();await expect(page.locator('main')).toBeHidden()
 await checkDesign(printed)
 const qr=new URL(await printed.getByRole('img',{name:'QR chuyển khoản'}).getAttribute('src') as string)
 expect(qr.pathname).toBe('/image/MB-00123456-qr_only.png')
 expect(qr.searchParams.get('amount')).toBe('35000');expect(qr.searchParams.get('addInfo')).toBe(results[0].receipt_no)
 expect(qrRequests.every(url=>url.includes('-qr_only.png'))).toBe(true)
 expect(await printed.getAttribute('style')).toContain('80mm')
 expect(await page.locator('#receipt-print-area style').textContent()).toContain('size: 80mm auto')
 await page.emulateMedia({media:'screen'})
})

test('search icons stay centered inside their own inputs when category filters wrap on mobile',async({page})=>{
 await fixture(page,{stock:3,extraCategories:['Nhóm hàng có tên rất dài để kiểm tra xuống dòng','Nhóm thử nghiệm thứ hai','Đồ uống đặc biệt']})
 async function checkIcon(label:string){
  const search=page.getByRole('textbox',{name:label,exact:true})
  const geometry=await search.evaluate(input=>{
   const icon=input.parentElement!.querySelector('svg')!,a=input.getBoundingClientRect(),b=icon.getBoundingClientRect()
   return {inside:b.left>=a.left&&b.right<=a.right&&b.top>=a.top&&b.bottom<=a.bottom,centered:Math.abs((b.top+b.bottom-a.top-a.bottom)/2)<1,padding:parseFloat(getComputedStyle(input).paddingLeft),pointer:getComputedStyle(icon).pointerEvents}
  })
  expect(geometry).toEqual({inside:true,centered:true,padding:40,pointer:'none'})
 }
 for(const width of [320,393,768,1280]){
  await page.setViewportSize({width,height:900})
  await page.getByRole('button',{name:'POS',exact:true}).click();await checkIcon('Tìm sản phẩm POS')
  await inventory(page);await checkIcon('Tìm hàng trong kho')
  await page.getByRole('button',{name:'Báo cáo',exact:true}).click();await checkIcon('Tìm nhanh sản phẩm')
  const search=page.getByRole('textbox',{name:'Tìm nhanh sản phẩm',exact:true})
  expect(await search.evaluate(input=>{const filters=input.parentElement!.previousElementSibling!;return filters.getBoundingClientRect().bottom<=input.getBoundingClientRect().top})).toBe(true)
  await search.fill('Không tồn tại')
  const stock=page.locator('section').filter({has:page.getByRole('heading',{name:'Cảnh báo tồn kho',exact:true})})
  await expect(stock.getByText(initialProduct.name,{exact:true})).toHaveCount(0)
  await search.fill('')
  await expect(stock.getByText(initialProduct.name,{exact:true})).toBeVisible()
 }
})
test('invoice date and search filters stack at full width on mobile and form two columns on larger screens',async({page})=>{
 await fixture(page)
 await page.getByRole('button',{name:'Hóa đơn & Mẫu in',exact:true}).click()
 for(const width of [320,393,430,640,768,1280]){
  await page.setViewportSize({width,height:900})
  const date=page.getByRole('textbox',{name:'Ngày thanh toán',exact:true}),search=page.getByRole('textbox',{name:'Tìm hóa đơn',exact:true})
  const first=(await date.boundingBox())!,second=(await search.boundingBox())!
  if(width<640){expect(second.y).toBeGreaterThan(first.y+first.height);expect(Math.abs(second.x-first.x)).toBeLessThan(1);expect(Math.abs(second.width-first.width)).toBeLessThan(1);expect(second.width).toBeGreaterThan(250)}
  else {expect(Math.abs(second.y-first.y)).toBeLessThan(1);expect(second.x).toBeGreaterThan(first.x+first.width)}
  await expect(search).toHaveAttribute('placeholder','Mã đơn hoặc tên món')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 }
 await searchFilter()
 async function searchFilter(){await page.getByRole('textbox',{name:'Tìm hóa đơn',exact:true}).fill('Món thử');await expect(page.getByText('Không có hóa đơn phù hợp.',{exact:true})).toBeVisible()}
})

test('revenue, TA and TC use day-month dates in bar/line axes and pie legends across month boundaries',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-01T05:00:00Z'))
 await page.setViewportSize({width:1280,height:900})
 await fixture(page)
 await page.route('**/rest/v1/pos_transactions*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([
  {code:'HD2610001',date_time:'2026-10-26T05:00:00Z',total:35000,method:'Tiền mặt',items:[{name:initialProduct.name,quantity:1,price:35000}]},
  {code:'HD0111001',date_time:'2026-11-01T05:00:00Z',total:35000,method:'Tiền mặt',items:[{name:initialProduct.name,quantity:1,price:35000}]}
 ])}))
 await page.reload()
 await page.getByRole('button',{name:'Báo cáo',exact:true}).click()
 await page.getByRole('button',{name:'7 ngày qua',exact:true}).click()
 await page.getByLabel('Thu gọn khoảng trống',{exact:true}).uncheck()
 const chart=page.locator('section').filter({has:page.getByRole('heading',{name:'Biểu đồ 7 ngày qua',exact:true})})
 for(const metric of [/Tổng doanh thu/,/TA · Trung bình bill/,/TC · Tổng lượt khách/]){
  await page.getByRole('button',{name:metric}).click()
  for(const kind of ['Biểu đồ cột','Biểu đồ đường','Biểu đồ tròn']){
   await page.getByRole('button',{name:kind,exact:true}).click()
   if(kind==='Biểu đồ tròn'){
    await expect(chart.getByText('26-10',{exact:true})).toBeVisible()
    await expect(chart.getByText('01-11',{exact:true})).toBeVisible()
   }else{
    await expect(chart.getByText('26-10',{exact:true})).toBeVisible()
    await expect(chart.getByText('01-11',{exact:true})).toBeVisible()
   }
   await expect(chart.getByText('10-26',{exact:true})).toHaveCount(0)
   await expect(chart.getByText('11-01',{exact:true})).toHaveCount(0)
  }
 }
 await page.getByRole('button',{name:'Biểu đồ cột',exact:true}).click()
 await page.getByRole('button',{name:'Tháng này',exact:true}).click()
 await expect(page.locator('section').filter({has:page.getByRole('heading',{name:'Biểu đồ trong tháng',exact:true})}).getByText('01-11',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Hôm nay',exact:true}).click()
 await expect(page.locator('section').filter({has:page.getByRole('heading',{name:'Biểu đồ theo giờ (Hôm nay)',exact:true})}).getByText('00h',{exact:true})).toBeVisible()
})


async function samplePhoto(page:Page){
 return Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1200;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#ee8844';ctx.fillRect(0,0,2400,1200);return canvas.toDataURL('image/png').split(',')[1]}),'base64')
}
async function editProduct(page:Page,name=initialProduct.name){await page.getByRole('button',{name:`Sửa ${name}`,exact:true}).click()}
async function saveProduct(page:Page){await page.getByRole('dialog').getByRole('button',{name:'Lưu',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0)}

test('create ingredient, import with MAC, stocktake surplus/loss and low-stock report without exposing it to POS',async({page})=>{
 const {productWrites,receipts,checkRequests}=await fixture(page)
 await inventory(page)
 await page.getByRole('button',{name:'Thêm mặt hàng',exact:true}).click()
 await page.getByLabel('Tên mặt hàng',{exact:true}).fill('Nguyên liệu sữa')
 await page.getByLabel('Loại mặt hàng',{exact:true}).selectOption('ingredient')
 await expect(page.getByLabel('Loại mặt hàng').locator('option')).toHaveText(['Hàng bán lẻ','Đồ chế biến','Nguyên liệu'])
 await expect(page.getByLabel('Giá bán',{exact:true})).toBeDisabled()
 await page.getByLabel('Giá vốn',{exact:true}).fill('6000')
 await page.getByLabel('Mã sản phẩm',{exact:true}).fill('ING00001')
 await saveProduct(page)
 expect(productWrites.at(-1)).toMatchObject({product_type:'ingredient',is_imported:true,price:0,cost_price:6000})
 const card=page.getByTestId('inventory-card').filter({hasText:'Nguyên liệu sữa'})
 await expect(card.getByText('Nguyên liệu',{exact:true})).toBeVisible()
 await expect(page.getByText('Mặt hàng sắp hết',{exact:true}).locator('..')).toContainText('1')
 await page.getByRole('button',{name:'Nhập hàng',exact:true}).click()
 await page.getByLabel('Tìm mặt hàng nhập').fill('ING00001');await page.getByLabel('Tìm mặt hàng nhập').press('Enter')
 await page.getByLabel('Số lượng nhập',{exact:true}).fill('10');await page.getByLabel('Tổng tiền nhập',{exact:true}).fill('60000')
 await page.getByRole('button',{name:'Lưu phiếu nhập',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Đã lưu phiếu nhập'})).toBeVisible()
 expect(receipts[0]).toMatchObject({p_quantity:10,p_total:60000,p_product_id:productWrites[0].id})
 await page.getByRole('button',{name:'Kiểm kho',exact:true}).click()
 await page.getByLabel('Tồn thực tế Nguyên liệu sữa',{exact:true}).fill('15')
 await expect(page.getByRole('button',{name:'Hoàn thành kiểm kho',exact:true})).toBeDisabled()
 await page.getByLabel('Giá vốn phần tăng Nguyên liệu sữa',{exact:true}).fill('9000')
 await page.getByRole('button',{name:'Hoàn thành kiểm kho',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'Đã hoàn thành phiếu kiểm kho'})).toBeVisible()
 expect(checkRequests[0].p_lines[0]).toMatchObject({expected_is_imported:true,unit_cost:9000,actual_stock:15})
 await page.getByLabel('Tồn thực tế Nguyên liệu sữa',{exact:true}).fill('3')
 await page.getByRole('button',{name:'Hoàn thành kiểm kho',exact:true}).click()
 await expect(page.getByLabel('Tồn thực tế Nguyên liệu sữa',{exact:true})).toHaveValue('')
 await page.getByRole('button',{name:'Tồn kho',exact:true}).click()
 await expect(card.getByTestId('inventory-cost')).toHaveText('7.000đ')
 await page.getByRole('button',{name:'Báo cáo',exact:true}).click()
 await expect(page.locator('section').filter({has:page.getByRole('heading',{name:'Cảnh báo tồn kho',exact:true})}).getByText('Nguyên liệu sữa',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'POS',exact:true}).click()
 await expect(page.getByRole('button',{name:/Nguyên liệu sữa/})).toHaveCount(0)
 const search=page.getByLabel('Tìm sản phẩm POS')
 await search.fill('Nguyên liệu sữa');await expect(page.getByRole('button',{name:/Nguyên liệu sữa/})).toHaveCount(0)
 await search.fill('ING00001');await search.press('Enter')
 await expect(page.getByRole('status').filter({hasText:'Không tìm thấy sản phẩm'})).toBeVisible()
 await search.fill('');await page.locator('h1').click();await page.keyboard.type('ING00001',{delay:5});await page.keyboard.press('Enter')
 await expect(page.getByRole('button',{name:/Nguyên liệu sữa/})).toHaveCount(0)
 await page.reload();await page.getByRole('button',{name:'Kho hàng',exact:true}).click()
 await editProduct(page,'Nguyên liệu sữa');await expect(page.getByLabel('Loại mặt hàng')).toHaveValue('ingredient')
})

test('existing item URL image saves immediately to inventory thumbnail and POS and can be removed',async({page})=>{
 const {productWrites}=await fixture(page);await inventory(page);await editProduct(page)
 await page.getByLabel('URL ảnh sản phẩm').fill('https://cdn.example.test/product.webp')
 await expect(page.getByRole('img',{name:'Xem trước ảnh sản phẩm'})).toBeVisible()
 await saveProduct(page)
 await expect(page.getByRole('img',{name:`Ảnh ${initialProduct.name}`})).toBeVisible()
 expect(productWrites.at(-1)).toMatchObject({image_url:'https://cdn.example.test/product.webp'})
 await page.getByRole('button',{name:'POS',exact:true}).click()
 await expect(page.getByRole('img',{name:initialProduct.name,exact:true})).toBeVisible()
 await page.reload();await expect(page.getByRole('img',{name:initialProduct.name,exact:true})).toBeVisible()
 await inventory(page);await editProduct(page)
 await page.getByRole('button',{name:'Xóa ảnh',exact:true}).click();await saveProduct(page)
 expect(productWrites.at(-1).image_url).toBeNull()
 await page.getByRole('button',{name:'POS',exact:true}).click()
 await expect(page.getByRole('img',{name:initialProduct.name,exact:true})).toHaveCount(0)
 await expect(page.getByRole('button',{name:new RegExp(initialProduct.name)}).first()).toBeVisible()
})

test('new item photo is resized to 600px, uploaded and shown on POS without reloading',async({page})=>{
 const {productWrites,uploaded}=await fixture(page)
 const photo=await samplePhoto(page)
 await inventory(page);await page.getByRole('button',{name:'Thêm mặt hàng',exact:true}).click()
 await page.getByLabel('Tên mặt hàng',{exact:true}).fill('Món có ảnh')
 await page.getByLabel('Loại mặt hàng').selectOption('processed')
 await page.getByLabel('Giá bán',{exact:true}).fill('25000')
 await page.getByLabel('Chọn ảnh sản phẩm').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:photo})
 await expect(page.getByRole('status').filter({hasText:'Đã tải ảnh.'})).toBeVisible()
 expect(uploaded).toHaveLength(1)
 const dimensions=await page.evaluate(async encoded=>{const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/webp'}));return [bitmap.width,bitmap.height]},uploaded[0].toString('base64'))
 expect(dimensions).toEqual([600,300]);expect(uploaded[0].length).toBeLessThan(photo.length)
 await saveProduct(page)
 expect(productWrites.at(-1)).toMatchObject({product_type:'processed',is_imported:false})
 expect(productWrites.at(-1).image_url).toContain('/storage/v1/object/public/product-images/products/')
 await page.getByRole('button',{name:'POS',exact:true}).click()
 const image=page.getByRole('img',{name:'Món có ảnh',exact:true})
 await expect(image).toBeVisible()
 expect(await image.evaluate(el=>{const r=el.parentElement!.getBoundingClientRect();return Math.abs(r.width/r.height-4/3)<0.02})).toBe(true)
 for(const width of [320,393,768]){await page.setViewportSize({width,height:850});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)}
})

test('Storage failure falls back to compressed data URL that survives save and reload',async({page})=>{
 const {productWrites}=await fixture(page,{failStorage:true});const photo=await samplePhoto(page)
 await inventory(page);await editProduct(page)
 await page.getByLabel('Chọn ảnh sản phẩm').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:photo})
 await expect(page.getByRole('status').filter({hasText:'Ảnh nén sẽ được lưu cùng mặt hàng'})).toBeVisible()
 await saveProduct(page)
 expect(productWrites.at(-1).image_url).toMatch(/^data:image\/webp;base64,/)
 await page.getByRole('button',{name:'POS',exact:true}).click()
 await expect(page.getByRole('img',{name:initialProduct.name,exact:true})).toBeVisible()
 await page.reload();await expect(page.getByRole('img',{name:initialProduct.name,exact:true})).toBeVisible()
})

test('invalid images and unsafe URLs never upload or save a product mutation',async({page})=>{
 const {uploaded,productWrites}=await fixture(page);await inventory(page);await editProduct(page)
 await page.getByLabel('Chọn ảnh sản phẩm').setInputFiles({name:'unsafe.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')})
 await expect(page.getByRole('status').filter({hasText:'Chọn ảnh JPG'})).toBeVisible()
 expect(uploaded).toHaveLength(0)
 await page.getByLabel('Chọn ảnh sản phẩm').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('invalid PNG')})
 await expect(page.getByRole('status').filter({hasText:'Không đọc được ảnh.'})).toBeVisible()
 expect(uploaded).toHaveLength(0)
 await page.getByLabel('URL ảnh sản phẩm').fill('javascript:alert(1)')
 await page.getByRole('dialog').getByRole('button',{name:'Lưu',exact:true}).click()
 await expect(page.getByRole('dialog').getByRole('alert').filter({hasText:'URL ảnh phải là HTTP/HTTPS'})).toBeVisible()
 expect(productWrites).toHaveLength(0)
})

test('turning a cart item into ingredient blocks checkout and hides it after reload',async({page})=>{
 const {payments,productWrites}=await fixture(page,{cartQuantity:1})
 await inventory(page);await editProduct(page)
 await page.getByLabel('Loại mặt hàng').selectOption('ingredient');await saveProduct(page)
 expect(productWrites.at(-1)).toMatchObject({product_type:'ingredient',is_imported:true,price:0})
 await page.getByRole('button',{name:'POS',exact:true}).click()
 await expect(page.getByRole('button',{name:'Thanh toán (F9)',exact:true})).toBeDisabled()
 await page.keyboard.press('F9');expect(payments).toHaveLength(0)
 await expect(page.getByRole('button',{name:new RegExp(initialProduct.name)}).filter({has:page.locator('img')})).toHaveCount(0)
 await page.reload();await expect(page.getByRole('button',{name:'Thanh toán (F9)',exact:true})).toBeDisabled()
 expect(payments).toHaveLength(0)
})


test('all three product kinds persist their canonical type and inventory flag after editing',async({page})=>{
 const {productWrites}=await fixture(page);await inventory(page)
 for(const [kind,imported]of [['processed',false],['ingredient',true],['retail',true]] as const){
  await editProduct(page)
  await page.getByLabel('Loại mặt hàng').selectOption(kind);await saveProduct(page)
  expect(productWrites.at(-1)).toMatchObject({product_type:kind,is_imported:imported})
  await page.reload();await page.getByRole('button',{name:'Kho hàng',exact:true}).click();await editProduct(page)
  await expect(page.getByLabel('Loại mặt hàng')).toHaveValue(kind)
  await page.getByRole('button',{name:'Đóng sửa mặt hàng',exact:true}).click()
 }
})
