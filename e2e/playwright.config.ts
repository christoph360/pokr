import { defineConfig, devices } from '@playwright/test';

const WEB_URL = 'http://localhost:4200';
const API_URL = 'http://localhost:8787';
const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI
    ? [['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    // The Angular dev server proxies /api (incl. WebSocket upgrades) to wrangler dev.
    baseURL: WEB_URL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Mobile viewport (Chromium engine, so it needs no extra browser download).
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @pokr/api dev',
      url: `${API_URL}/api/health`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @pokr/web dev',
      url: WEB_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
