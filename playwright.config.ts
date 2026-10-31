import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000', headless: true, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args: ['--no-sandbox'] } },
  webServer: { command: 'node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3000', url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI },
})
