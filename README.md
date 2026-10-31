# Sangha POS

Next.js 16 / React 19 point-of-sale, stock and reports application.

## Development

Use Node.js 24 and the pinned pnpm 12.3.4. In the cloud checkout:

```sh
export COREPACK_HOME=/workspace/.cache/corepack
export NODE_USE_ENV_PROXY=1
corepack pnpm install --frozen-lockfile
node node_modules/next/dist/bin/next dev --webpack
```

Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in environment settings or ignored `.env.local`. Allow the project's hostname in the environment network settings. Apply the [catalog/receiving migration](supabase/README.md) to the intended Supabase project before creating categories or receiving stock. No service-role credential is needed in the browser.

## Checks

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:e2e
NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build --webpack
corepack pnpm check:supabase
```

The connection checker reads process environment variables; when using `.env.local`, load them in your shell or run `NODE_USE_ENV_PROXY=1 node --env-file=.env.local scripts/check-supabase.mjs`. It never writes store data or prints keys. The build config currently skips type checking, so run `typecheck` separately.

Unit/database tests use a private in-memory PostgreSQL instance (PGlite). Browser tests intercept every external request and use fixture products; they do not access the live shop. They cover mobile cards, shared/persisted categories, scanner routing, QR decoding from a synthetic video, camera denial/cleanup, receiving success/failure/retries and TC units. Browser tests use `/usr/bin/chromium`; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to another installed Chromium path if needed.

Camera scanning uses ZXing and requires HTTPS, camera permission and an available camera. It supports QR and common product barcodes without requiring native `BarcodeDetector`. Keyboard-wedge scanners work on the active POS/stock/receiving page with Enter or Tab; in search fields, submit the code with Enter. Unknown or duplicate codes show an error. During numeric or payment entry the global scanner does not intercept typing.
