import * as v from 'valibot';
import {
  BULK_ADD_MAX,
  MAX_STORIES,
  STORY_TITLE_MAX,
  StoryDescriptionSchema,
  StoryLinkInputSchema,
  StoryTitleSchema,
  STORY_DESCRIPTION_MAX,
  parseBulkLines,
  quickPicks,
} from '@pokr/shared';
import type { AgendaStory, Deck, DisplayStatus, RevealedVote } from '@pokr/shared';
import { STRINGS } from '../i18n/strings';

const t = STRINGS.stories;
const val = STRINGS.validation;

export type FieldResult<T> = { ok: true; value: T } | { ok: false; message: string };

function firstIssue(result: v.SafeParseResult<v.GenericSchema>): string {
  return result.issues?.[0]?.message ?? '';
}

/** Title (F02 Definitions): one line, 1 to 200 graphemes. The shared schema owns the rules. */
export function checkStoryTitle(input: string): FieldResult<string> {
  const result = v.safeParse(StoryTitleSchema, input);
  if (result.success) return { ok: true, value: result.output };
  const m = firstIssue(result);
  if (/control characters/.test(m)) return { ok: false, message: val.forbiddenChars };
  if (/at least/.test(m)) return { ok: false, message: t.titleRequired };
  if (/bytes/.test(m)) return { ok: false, message: val.tooManyBytes };
  return { ok: false, message: val.tooLong(STORY_TITLE_MAX) };
}

/** Description: optional Markdown; '' clears it. */
export function checkStoryDescription(input: string): FieldResult<string> {
  const result = v.safeParse(StoryDescriptionSchema, input);
  if (result.success) return { ok: true, value: result.output };
  const m = firstIssue(result);
  if (/control characters/.test(m)) return { ok: false, message: val.forbiddenChars };
  if (/bytes/.test(m)) return { ok: false, message: val.tooManyBytes };
  return { ok: false, message: val.tooLong(STORY_DESCRIPTION_MAX) };
}

/** Link: optional http(s) URL; '' becomes null (no link / clear). */
export function checkStoryLink(input: string): FieldResult<string | null> {
  const result = v.safeParse(StoryLinkInputSchema, input);
  if (result.success) return { ok: true, value: result.output };
  return { ok: false, message: t.linkInvalid };
}

// ---- bulk add (F02-AC3) ----

export interface BulkPreview {
  /** Titles that would be added. */
  count: number;
  /** One localized message per problem, per-line errors first. Empty when the paste can be sent. */
  errors: string[];
  /** Whether the client may send the text. */
  ok: boolean;
}

/**
 * Preview of a paste. The client sends the raw text; this only mirrors what the server will
 * decide so the user sees the count and the line numbers before sending (`parseBulkLines`).
 */
export function previewBulk(text: string, existingCount: number): BulkPreview {
  const parsed = parseBulkLines(text);
  const errors: string[] = [];
  for (const e of parsed.errors) {
    errors.push(
      e.reason === 'too_long'
        ? t.bulkLineTooLong(e.line, STORY_TITLE_MAX)
        : t.bulkLineForbidden(e.line),
    );
  }
  if (parsed.tooMany) errors.push(t.bulkTooMany(BULK_ADD_MAX));
  const count = parsed.titles.length;
  const room = MAX_STORIES - existingCount;
  if (count > room && !parsed.tooMany && parsed.errors.length === 0) errors.push(t.bulkRoom(room));
  const empty = count === 0 && parsed.errors.length === 0;
  return { count, errors, ok: errors.length === 0 && !empty };
}

/** The server reports `text.N` for line N and `text` for the paste as a whole; never content. */
export function bulkServerError(code: string, field: string | undefined): string | null {
  if (code === 'invalid_input' && field) {
    const line = /^text\.(\d+)$/.exec(field);
    if (line) return t.bulkLineInvalid(Number(line[1]));
    if (field === 'text') return t.bulkNone;
  }
  return null;
}

// ---- display ----

export function statusLabel(status: DisplayStatus): string {
  return t.status[status];
}

export function progressText(
  p: { estimated: number; outOf: number; skipped: number },
  rows: number,
) {
  return rows === 0 ? t.noStoriesYet : t.progress(p.estimated, p.outOf, p.skipped);
}

// ---- final estimate (F02-AC10) ----

export interface AcceptChoices {
  /** Suggested cards, shown once each even when consensus and median agree. */
  quick: { card: string; kind: 'consensus' | 'median' | 'both'; label: string }[];
  /** Every value card of the deck, in deck order. */
  cards: readonly string[];
}

/** Quick picks and the full card list from the shared `quickPicks` (never re-implemented here). */
export function acceptChoices(deck: Deck, votes: readonly RevealedVote[]): AcceptChoices {
  const picks = quickPicks(deck, votes);
  const quick: AcceptChoices['quick'] = [];
  if (picks.consensus !== null && picks.consensus === picks.median) {
    quick.push({
      card: picks.consensus,
      kind: 'both',
      label: t.consensusAndMedianPick(picks.consensus),
    });
  } else {
    if (picks.consensus !== null) {
      quick.push({
        card: picks.consensus,
        kind: 'consensus',
        label: t.consensusPick(picks.consensus),
      });
    }
    if (picks.median !== null) {
      quick.push({ card: picks.median, kind: 'median', label: t.medianPick(picks.median) });
    }
  }
  return { quick, cards: picks.cards };
}

// ---- reorder ----

/**
 * The agenda in the order the user sees it: the optimistic local order (while moves are queued)
 * applied to the rows from the server. Rows missing from the local order keep their server
 * position at the end; ids that no longer exist are dropped.
 */
export function orderRows(
  rows: readonly AgendaStory[],
  localOrder: readonly string[] | null,
): readonly AgendaStory[] {
  if (localOrder === null) return rows;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: AgendaStory[] = [];
  for (const id of localOrder) {
    const row = byId.get(id);
    if (row) {
      out.push(row);
      byId.delete(id);
    }
  }
  return [...out, ...byId.values()];
}
