import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Test mode is not declared in wrangler.jsonc; the e2e config passes it with `--var`.
      miniflare: { bindings: { POKR_TEST_MODE: '1' } },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    // The Workers pool cannot read Vitest 5's on-disk module cache (readAll ENOENT).
    fsModuleCache: false,
  },
});
