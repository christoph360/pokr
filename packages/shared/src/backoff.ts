import { DEFAULT_BACKOFF } from './constants';

export interface BackoffConfig {
  initialMs: number;
  factor: number;
  maxMs: number;
  /** Fraction, 0.2 = +/-20%. */
  jitter: number;
}

/**
 * Reconnect delay for attempt n (0-based) per F01-AC29: initial * factor^n capped at maxMs,
 * then +/-jitter applied to that nominal delay (so the result can exceed maxMs by the jitter).
 */
export function backoffDelayMs(
  attempt: number,
  config: BackoffConfig = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const nominal = Math.min(config.initialMs * config.factor ** attempt, config.maxMs);
  return Math.round(nominal * (1 + (random() * 2 - 1) * config.jitter));
}
