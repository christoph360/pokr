import { defineConfig, devices } from '@playwright/test';

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Defaults are the fixed local ports. E2E_API_PORT / E2E_WEB_PORT exist only to avoid clashing
// with someone else's dev servers; the web proxy is then pointed at the chosen API port.
const API_PORT = process.env['E2E_API_PORT'] ?? '8787';
const WEB_PORT = process.env['E2E_WEB_PORT'] ?? '4200';
const WEB_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${API_PORT}`;
const customPorts = API_PORT !== '8787' || WEB_PORT !== '4200';
let proxyArg = '';
if (customPorts) {
  const dir = join(tmpdir(), 'pokr-e2e');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `proxy-${API_PORT}.json`);
  writeFileSync(
    file,
    JSON.stringify({ '/api': { target: API_URL, secure: false, ws: true, changeOrigin: false } }),
  );
  proxyArg = ` --port ${WEB_PORT} --proxy-config ${file}`;
}
const isCI = !!process.env['CI'];

// Tags (see tests): @cross-browser = also run on firefox/webkit/mobile; @chromium-only = heavy
// multi-context or race tests, run on the chromium project only (documented gap, plan 4.4).
const crossBrowser = /@cross-browser/;

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0, // flaky tests are defects, never retried until green
  workers: isCI ? 2 : 4,
  reporter: isCI
    ? [['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    // The Angular dev server proxies /api (incl. WebSocket upgrades) to wrangler dev.
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      grep: crossBrowser,
      grepInvert: /@chromium-only/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grep: crossBrowser,
      grepInvert: /@chromium-only/,
    },
    // Mobile viewport (Chromium engine, no extra browser download).
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      grep: crossBrowser,
      grepInvert: /@chromium-only|@desktop-only/,
    },
  ],
  webServer: [
    {
      // `dev` creates the web dist dir first (assets binding), then runs wrangler dev.
      // POKR_TEST_MODE enables the /__test hooks and the rate-limit client key header.
      command: customPorts
        ? // The api `dev` script hardcodes --port 8787, so call wrangler directly (same dist dir setup).
          `pnpm --filter @pokr/api exec sh -c "mkdir -p ../web/dist/web/browser && wrangler dev --port ${API_PORT} --var POKR_TEST_MODE:1"`
        : 'pnpm --filter @pokr/api dev --var POKR_TEST_MODE:1',
      url: `${API_URL}/api/health`,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @pokr/web dev${proxyArg}`,
      url: WEB_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
