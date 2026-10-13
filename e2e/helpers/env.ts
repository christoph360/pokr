const API_PORT = process.env['E2E_API_PORT'] ?? '8787';
const WEB_PORT = process.env['E2E_WEB_PORT'] ?? '4200';
export const API_URL = `http://localhost:${API_PORT}`;
export const WS_URL = `ws://localhost:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

/** Header that replaces the client IP as the rate-limit key in test mode. */
export const CLIENT_KEY_HEADER = 'x-pokr-test-client-key';

/** localStorage key of the participant token (apps/web core/token-store.ts). Value is the raw token. */
export const tokenStorageKey = (roomId: string): string => `pokr:token:${roomId}`;

let counter = 0;
/** Unique per test run and per call; used as rate-limit key and for unique names. */
export function uniqueKey(prefix = 'k'): string {
  counter += 1;
  return `${prefix}-${process.pid}-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}
