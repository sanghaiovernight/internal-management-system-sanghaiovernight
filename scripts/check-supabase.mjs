// Read-only connection/schema check. Never prints credentials or row contents.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Missing Supabase URL or public key in environment settings.')
  process.exit(1)
}
const headers = { apikey: key, Authorization: `Bearer ${key}` }
let failed = false
for (const table of ['pos_products', 'pos_categories', 'pos_expenses', 'pos_cart_lines', 'pos_transactions']) {
  try {
    const response = await fetch(new URL(`/rest/v1/${table}?select=*&limit=1`, url), { headers, signal: AbortSignal.timeout(10000) })
    console.log(`${table}: HTTP ${response.status}`)
    if (!response.ok) failed = true
    else {
      const rows = await response.json()
      console.log(`  Read succeeded; returned ${rows.length} row(s).`)
    }
  } catch {
    console.error(`${table}: connection failed; check project hostname access and proxy configuration.`)
    failed = true
    break
  }
}
if (!failed) {
  const response = await fetch(new URL('/rest/v1/', url), { headers: { ...headers, Accept: 'application/openapi+json' }, signal: AbortSignal.timeout(10000) }).catch(() => null)
  const schema = response?.ok ? await response.json() : null
  const available = !!schema?.paths?.['/rpc/pos_receive_stock']
  console.log(`pos_receive_stock RPC: ${available ? 'available' : 'unavailable or schema not readable'}`)
  if (!available) failed = true
}
process.exitCode = failed ? 1 : 0
