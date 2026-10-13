import type { Page } from '@playwright/test';
import type { RawClient } from './raw-client';

/**
 * Bounded observation window for NEGATIVE assertions ("nothing happens", e.g. no reconnect loop
 * after removal). It is not a synchronisation sleep: positive conditions always wait on state.
 * Runs inside the page so it is not affected by Node timers.
 */
export async function observeFor(page: Page, ms: number): Promise<void> {
  await page.evaluate((t) => new Promise<void>((resolve) => setTimeout(resolve, t)), ms);
}

/** Same, for tests without a page. */
export async function observeForNode(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Resolves when the server-announced claim window is open for this raw client's view. */
export async function waitForClaimOpen(c: RawClient, timeoutMs = 15_000): Promise<void> {
  await c.waitForState((s) => s.canClaimAt !== null, 'canClaimAt announced', timeoutMs);
  const frame = c.frames.findLast((f) => f.msg?.type === 'state');
  const state = c.state!;
  const skew = (frame?.at ?? Date.now()) - state.serverTime;
  const openAt = state.canClaimAt! + skew;
  const left = openAt - Date.now() + 50;
  if (left > 0) await observeForNode(left);
}

export function repeat(ch: string, n: number): string {
  return ch.repeat(n);
}
