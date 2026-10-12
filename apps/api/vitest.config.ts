import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    include: ['test/**/*.test.ts'],
    // The Workers pool cannot read Vitest 5's on-disk module cache (readAll ENOENT).
    fsModuleCache: false,
  },
});
