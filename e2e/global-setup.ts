import { API_URL, CLIENT_KEY_HEADER } from './helpers/env';

/**
 * Fails fast when the API on the e2e port was not started with POKR_TEST_MODE=1 (for example a
 * stale `wrangler dev` that Playwright reused): the suite depends on the /__test hooks and on
 * the rate-limit client key header, and would otherwise fail with confusing 429s.
 */
export default async function globalSetup(): Promise<void> {
  const headers = {
    'content-type': 'application/json',
    [CLIENT_KEY_HEADER]: `setup-${Date.now()}`,
  };
  const created = await fetch(`${API_URL}/api/rooms`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ displayName: 'setup' }),
  });
  if (created.status !== 201) {
    throw new Error(`global setup: POST /api/rooms returned ${created.status}`);
  }
  const { roomId } = (await created.json()) as { roomId: string };
  const hook = await fetch(`${API_URL}/api/__test/rooms/${roomId}/timers`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  if (hook.status !== 204) {
    throw new Error(
      `global setup: test hook /timers returned ${hook.status}. The API at ${API_URL} is not running ` +
        'in test mode (wrangler dev --var POKR_TEST_MODE:1). Stop the stale server or set E2E_API_PORT.',
    );
  }
}
