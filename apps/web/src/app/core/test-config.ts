import type { BackoffConfig } from '@pokr/shared';
import { DEFAULT_BACKOFF, HEARTBEAT_INTERVAL_MS, RECONNECT_INDICATOR_DELAY_MS } from '@pokr/shared';

/**
 * Optional overrides that Playwright injects with `addInitScript` as `globalThis.__pokrTestConfig`
 * (R-F4). Harmless in production: nothing sets it, and every field falls back to the shared constants.
 */
export interface PokrTestConfig {
  backoff?: Partial<BackoffConfig>;
  pingIntervalMs?: number;
  reconnectIndicatorDelayMs?: number;
}

export interface ResolvedClientConfig {
  backoff: BackoffConfig;
  pingIntervalMs: number;
  reconnectIndicatorDelayMs: number;
}

function finite(value: unknown, min: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : undefined;
}

export function readClientConfig(
  source: unknown = (globalThis as { __pokrTestConfig?: unknown }).__pokrTestConfig,
): ResolvedClientConfig {
  const cfg = (typeof source === 'object' && source !== null ? source : {}) as PokrTestConfig;
  const b = (
    typeof cfg.backoff === 'object' && cfg.backoff !== null ? cfg.backoff : {}
  ) as Partial<BackoffConfig>;
  return {
    backoff: {
      initialMs: finite(b.initialMs, 0) ?? DEFAULT_BACKOFF.initialMs,
      factor: finite(b.factor, 1) ?? DEFAULT_BACKOFF.factor,
      maxMs: finite(b.maxMs, 0) ?? DEFAULT_BACKOFF.maxMs,
      jitter: finite(b.jitter, 0) ?? DEFAULT_BACKOFF.jitter,
    },
    pingIntervalMs: finite(cfg.pingIntervalMs, 10) ?? HEARTBEAT_INTERVAL_MS,
    reconnectIndicatorDelayMs:
      finite(cfg.reconnectIndicatorDelayMs, 0) ?? RECONNECT_INDICATOR_DELAY_MS,
  };
}
