import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000', headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] } },
  webServer: { env: { NEXT_TELEMETRY_DISABLED: '1',POS_INTERNAL_PIN:'83917264',POS_SESSION_SECRET:'isolated-e2e-session-secret' }, command: 'node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3000', url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI },
})
