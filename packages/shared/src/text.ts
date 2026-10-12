import * as v from 'valibot';
import { RAW_TEXT_MAX_UNITS } from './constants';

/** Control characters (incl. tab, CR, LF) and line/paragraph separators are rejected. */
const FORBIDDEN = /[\p{Cc}\p{Zl}\p{Zp}]/u;

let segmenter: Intl.Segmenter | undefined;

export function containsForbiddenChars(input: string): boolean {
  return FORBIDDEN.test(input);
}

/**
 * Trim and collapse internal whitespace to single spaces. Does not reject anything; callers
 * check `containsForbiddenChars` on the raw input first (control chars are rejected, not collapsed).
 */
export function normalizeText(input: string): string {
  return input.replace(/\s+/gu, ' ').trim();
}

/** Length in Unicode grapheme clusters. */
export function graphemeLength(input: string): number {
  segmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' });
  let n = 0;
  for (const _segment of segmenter.segment(input)) n++; // eslint-disable-line @typescript-eslint/no-unused-vars
  return n;
}

export interface TextLimits {
  min: number;
  max: number;
}

/**
 * Schema for any free text (F01 Definitions: text normalization). Output is the normalized
 * string. `min: 0` means an empty result is allowed (topics, room names).
 */
export function textSchema({ min, max }: TextLimits) {
  return v.pipe(
    v.string(),
    v.maxLength(RAW_TEXT_MAX_UNITS),
    v.check((s) => !containsForbiddenChars(s), 'must not contain control characters or newlines'),
    v.transform(normalizeText),
    v.check((s) => graphemeLength(s) >= min, `must be at least ${min} characters`),
    v.check((s) => graphemeLength(s) <= max, `must be at most ${max} characters`),
  );
}
