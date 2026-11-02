import { receiptQrUrl } from './receipts'

const pending = new Map<string, Promise<string>>()

// Decode the saved payment payload instead of rebuilding it from today's bank
// settings. VietQR's qr_only template still embeds a logo in the QR matrix.
export function plainReceiptQr(url: string): Promise<string> {
  // Request SVG directly: the PNG endpoint redirects without CORS headers.
  const source = receiptQrUrl(url).replace(/^(https:\/\/img\.vietqr\.io\/image\/[^?#]+)\.png(?=[?#]|$)/, '$1.svg')
  const cached = pending.get(source)
  if (cached) return cached
  const result = (async () => {
    const { BrowserQRCodeReader, BrowserQRCodeSvgWriter } = await import('@zxing/browser')
    const response = await fetch(source, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error('Không tải được QR chuyển khoản.')
    const objectUrl = URL.createObjectURL(await response.blob())
    try {
      const payload = await new BrowserQRCodeReader().decodeFromImageUrl(objectUrl)
      const svg = new BrowserQRCodeSvgWriter().write(payload.getText(), 0, 0)
      svg.setAttribute('viewBox', `0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`)
      svg.setAttribute('shape-rendering', 'crispEdges')
      svg.style.background = 'white'
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  })()
  pending.set(source, result)
  // Do not cache failures: printing again should retry the download.
  void result.catch(() => pending.delete(source))
  return result
}
