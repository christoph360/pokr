import { expect } from '@playwright/test';
import type { ErrorCode, StoryDetail } from '@pokr/shared';
import type { AgendaStory } from '@pokr/shared';
import type { CommandResult, RawClient } from './raw-client';

/**
 * Raw-protocol helpers for F02 (story commands). Command names and fields follow
 * packages/shared/README.md "Stories (F02, spec rev 2)".
 */

export function rowsOf(c: RawClient): readonly AgendaStory[] {
  return c.held?.rows ?? [];
}
export function titlesOf(c: RawClient): string[] {
  return rowsOf(c).map((r) => r.title);
}
export function rowByTitle(c: RawClient, title: string): AgendaStory {
  const row = rowsOf(c).find((r) => r.title === title);
  if (!row) throw new Error(`no story titled "${title}" in ${JSON.stringify(titlesOf(c))}`);
  return row;
}
export function idOf(c: RawClient, title: string): string {
  return rowByTitle(c, title).id;
}
export function roundOf(c: RawClient): number {
  if (!c.state) throw new Error('no state yet');
  return c.state.round.number;
}
export function activeOf(c: RawClient): string | null {
  return c.state?.stories.activeId ?? null;
}

export function expectOk(
  res: CommandResult,
  what = 'command',
): asserts res is CommandResult & {
  ok: true;
} {
  expect(res.ok, `${what} should succeed, got ${JSON.stringify(res)}`).toBe(true);
}

export function expectError(res: CommandResult, code: ErrorCode, field?: string): void {
  expect(res.ok, `expected error ${code}, got success`).toBe(false);
  if (res.ok) return;
  expect(res.code).toBe(code);
  if (field !== undefined) expect(res.field).toBe(field);
}

/** Add a story, assert success, return its id. */
export async function addStory(
  c: RawClient,
  title: string,
  extra: { description?: string; link?: string } = {},
): Promise<string> {
  const res = await c.command('add_story', { title, ...extra });
  expectOk(res, `add_story "${title}"`);
  const id = res.storyIds?.[0];
  if (!id) throw new Error('add_story ack carried no storyIds');
  return id;
}

/** Add stories one per call (small agendas), returns ids in order. */
export async function addStories(c: RawClient, titles: readonly string[]): Promise<string[]> {
  const res = await c.command('add_stories', { text: titles.join('\n') });
  expectOk(res, 'add_stories');
  return res.storyIds ?? [];
}

export async function setSource(
  c: RawClient,
  storySource: 'topic' | 'stories',
  confirmReset = false,
): Promise<CommandResult> {
  return c.command('update_settings', { settings: { storySource }, confirmReset });
}

export async function selectStory(
  c: RawClient,
  storyId: string,
  confirmReset = false,
): Promise<CommandResult> {
  return c.command('select_story', { storyId, confirmReset });
}

export async function nextStory(c: RawClient, confirmReset = false): Promise<CommandResult> {
  return c.command('next_story', { round: roundOf(c), confirmReset });
}

export async function acceptEstimate(
  c: RawClient,
  storyId: string,
  estimate: string,
  round = roundOf(c),
): Promise<CommandResult> {
  return c.command('accept_estimate', { storyId, round, estimate });
}

export async function skipStory(
  c: RawClient,
  storyId: string,
  opts: { advance?: boolean; confirmReset?: boolean; round?: number } = {},
): Promise<CommandResult> {
  return c.command('skip_story', {
    storyId,
    round: opts.round ?? roundOf(c),
    advance: opts.advance ?? false,
    confirmReset: opts.confirmReset ?? false,
  });
}

export async function getStory(c: RawClient, storyId: string): Promise<StoryDetail> {
  const res = await c.command('get_story', { storyId });
  expectOk(res, 'get_story');
  const story = c.storyReplies.get(c.lastCommandId);
  if (!story) throw new Error('no story reply for get_story');
  return story;
}

/** Reveal with the facilitator and wait until it shows. */
export async function reveal(c: RawClient): Promise<void> {
  expectOk(await c.command('reveal'), 'reveal');
  await c.waitForState((s) => s.round.phase === 'revealed', 'revealed');
}

/** select (discarding any round), reveal and accept: the quickest way to get an estimate. */
export async function estimate(c: RawClient, storyId: string, card: string): Promise<void> {
  expectOk(await selectStory(c, storyId, true), 'select');
  await reveal(c);
  expectOk(await acceptEstimate(c, storyId, card), `accept ${card}`);
}

/** Facilitator in story-list mode: select story and vote/reveal with the given raw voters. */
export async function playRound(
  fac: RawClient,
  storyId: string,
  votes: { client: RawClient; card: string }[],
): Promise<void> {
  expectOk(await selectStory(fac, storyId, true), 'select');
  for (const v of votes) expectOk(await v.client.vote(v.card), `vote ${v.card}`);
  expectOk(await fac.command('reveal'), 'reveal');
  await fac.waitForState((s) => s.round.phase === 'revealed', 'revealed');
}

/** Bytes of a received frame as the browser/WS counts them (UTF-8). */
export function frameBytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

// ---- independent oracles (do not import app code) ----

const SPECIAL = new Set(['?', '☕']);

function hundredths(card: string): number | null {
  if (card === '½') return 50;
  if (!/^\d+(\.\d{1,2})?$/.test(card)) return null;
  return Math.round(Number(card) * 100);
}

export interface QuickPickOracle {
  consensus: string | null;
  median: string | null;
}

/**
 * F02-AC10 quick picks. `deck` lists the cards in deck order (specials included).
 * Numeric decks: lowest value card >= the median (deck ordered by value). Other decks: upper
 * median by deck position.
 */
export function expectedQuickPicks(
  deck: readonly string[],
  votes: readonly string[],
): QuickPickOracle {
  const valueCards = deck.filter((c) => !SPECIAL.has(c));
  const value = votes.filter((v) => !SPECIAL.has(v));
  if (value.length === 0) return { consensus: null, median: null };
  const consensus = value.length >= 2 && new Set(value).size === 1 ? value[0]! : null;
  const numeric = valueCards.every((c) => hundredths(c) !== null);
  if (numeric) {
    const nums = value.map((v) => hundredths(v)!).sort((a, b) => a - b);
    const mid = Math.floor(nums.length / 2);
    const twice = nums.length % 2 === 1 ? 2 * nums[mid]! : nums[mid - 1]! + nums[mid]!;
    let best: { card: string; h: number } | null = null;
    for (const card of valueCards) {
      const h = hundredths(card)!;
      if (2 * h >= twice && (best === null || h < best.h)) best = { card, h };
    }
    return { consensus, median: best?.card ?? null };
  }
  const sorted = [...value].sort((a, b) => deck.indexOf(a) - deck.indexOf(b));
  return { consensus, median: sorted[Math.floor(sorted.length / 2)] ?? null };
}

/** F02-AC15 sum with exact decimals. Returns null when the deck is not numeric or nothing counts. */
export function expectedSum(
  numericDeck: boolean,
  estimates: readonly string[],
): { value: string | null; excluded: number } {
  if (!numericDeck) return { value: null, excluded: 0 };
  let total = 0;
  let counted = 0;
  let excluded = 0;
  for (const e of estimates) {
    const h = hundredths(e);
    if (h === null) excluded += 1;
    else {
      total += h;
      counted += 1;
    }
  }
  if (counted === 0) return { value: null, excluded };
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const int = Math.floor(abs / 100);
  const frac = String(Math.round(abs % 100))
    .padStart(2, '0')
    .replace(/0$/, '');
  return {
    value: frac === '' || frac === '0' ? `${sign}${int}` : `${sign}${int}.${frac}`,
    excluded,
  };
}

/** F02-AC14 progress text: "7 of 10 estimated, 2 skipped" (skipped part only when > 0). */
export function expectedProgress(statuses: readonly ('pending' | 'estimated' | 'skipped')[]): {
  estimated: number;
  outOf: number;
  skipped: number;
} {
  const skipped = statuses.filter((s) => s === 'skipped').length;
  return {
    estimated: statuses.filter((s) => s === 'estimated').length,
    outOf: statuses.length - skipped,
    skipped,
  };
}

/**
 * F01-AC11 for raw clients: received frames (from index `from`) that contain any forbidden token,
 * after removing the deck definition and the client's own `myVote`.
 */
export function rawFramesLeaking(
  c: RawClient,
  forbidden: readonly string[],
  from = 0,
): { text: string; token: string }[] {
  const hits: { text: string; token: string }[] = [];
  for (const f of c.frames.slice(from)) {
    if (f.dir !== 'in') continue;
    let haystack = f.text;
    try {
      const json = JSON.parse(f.text) as { type?: string; state?: Record<string, unknown> };
      if (json.type === 'state' && json.state) {
        const settings = json.state['settings'] as Record<string, unknown> | undefined;
        if (settings) delete settings['deck'];
        delete json.state['myVote'];
      }
      haystack = JSON.stringify(json);
    } catch {
      // not JSON
    }
    for (const token of forbidden) if (haystack.includes(token)) hits.push({ text: f.text, token });
  }
  return hits;
}
