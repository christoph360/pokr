/** Worker environment. `POKR_TEST_MODE` is deliberately not declared in wrangler.jsonc (passed with `--var`). */
export type AppEnv = Env & { POKR_TEST_MODE?: string };

export const TEST_CLIENT_KEY_HEADER = 'x-pokr-test-client-key';

/** Test mode is on only when the variable is exactly "1". Staging and production never set it. */
export function isTestMode(env: { POKR_TEST_MODE?: string | undefined }): boolean {
  return env.POKR_TEST_MODE === '1';
}

function cookieValue(headers: Headers, name: string): string | null {
  for (const part of (headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      const raw = part.slice(i + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return null;
}

/**
 * Rate-limit key for a request. In test mode only: the `x-pokr-test-client-key` header, else a
 * cookie of the same name (browser WebSocket handshakes carry cookies but not extra headers), so
 * parallel e2e tests do not share one budget. Otherwise the client IP, else "unknown". Never logged.
 */
export function clientKey(env: { POKR_TEST_MODE?: string | undefined }, headers: Headers): string {
  if (isTestMode(env)) {
    const override =
      headers.get(TEST_CLIENT_KEY_HEADER) || cookieValue(headers, TEST_CLIENT_KEY_HEADER);
    if (override) return override.slice(0, 128);
  }
  return headers.get('CF-Connecting-IP') ?? 'unknown';
}
