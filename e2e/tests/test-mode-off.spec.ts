import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ROOM_ID_LENGTH } from '@pokr/shared';

const chromiumOnly = { tag: '@chromium-only' };
const PORT = process.env['E2E_NOTESTMODE_PORT'] ?? '8791';
const INSPECTOR_PORT = process.env['E2E_NOTESTMODE_INSPECTOR_PORT'] ?? '9331';

/**
 * Starts a second `wrangler dev` WITHOUT `POKR_TEST_MODE` and checks that every test-only hook
 * answers 404 (plan R-B3 / F01 test-mode rule: test hooks never exist outside local and test).
 * It uses its own ports and persistence directory so it cannot disturb the main test servers.
 */
test.describe('test mode off', () => {
  test(
    'F02-AC16 / F01 test mode: the story seeding hook, the storage dump and the F01 hooks return 404 when test mode is off',
    chromiumOnly,
    async ({ playwright }) => {
      test.setTimeout(180_000);
      const persist = mkdtempSync(join(tmpdir(), 'pokr-notestmode-'));
      const root = join(process.cwd(), '..');
      const child: ChildProcess = spawn(
        'pnpm',
        [
          '--filter',
          '@pokr/api',
          'exec',
          'sh',
          '-c',
          `mkdir -p ../web/dist/web/browser && wrangler dev --port ${PORT} --inspector-port ${INSPECTOR_PORT} --persist-to ${persist}`,
        ],
        { cwd: root, detached: true, stdio: 'ignore' },
      );
      const request = await playwright.request.newContext();
      try {
        await expect
          .poll(
            async () => {
              try {
                return (await request.get(`http://localhost:${PORT}/api/health`)).status();
              } catch {
                return 0;
              }
            },
            { message: 'wrangler dev without test mode becomes healthy', timeout: 120_000 },
          )
          .toBe(200);
        const id = 'a'.repeat(ROOM_ID_LENGTH);
        const base = `http://localhost:${PORT}/api/__test/rooms/${id}`;
        const hooks: [string, 'GET' | 'POST', unknown][] = [
          ['stories', 'POST', { count: 1 }],
          ['storage', 'GET', undefined],
          ['instance', 'GET', undefined],
          ['evict', 'POST', { mode: 'drop_memory' }],
          ['timers', 'POST', { purgeMs: 100 }],
        ];
        for (const [path, method, data] of hooks) {
          const res =
            method === 'GET'
              ? await request.get(`${base}/${path}`)
              : await request.post(`${base}/${path}`, { data });
          expect(res.status(), `${method} /api/__test/rooms/:id/${path}`).toBe(404);
        }
      } finally {
        await request.dispose();
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            /* already gone */
          }
        }
      }
    },
  );
});
