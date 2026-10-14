import * as v from 'valibot';
import { RAW_TEXT_MAX_UNITS } from './constants';

/** Control characters (incl. tab, CR, LF) and line/paragraph separators are rejected. */
const FORBIDDEN = /[\p{Cc}\p{Zl}\p{Zp}]/u;

let segmenter: Intl.Segmenter | undefined;

export function containsForbiddenChars(input: string): boolean {
  return FORBIDDEN.test(input);
}

/**
 * Unicode NFC first (so "e" + U+0301 equals U+00E9 for length, uniqueness and AC8 suffix matching),
 * then trim and collapse internal whitespace to single spaces. Does not reject anything; callers
 * check `containsForbiddenChars` on the raw input first (control chars are rejected, not collapsed).
 */
export function normalizeText(input: string): string {
  return input.normalize('NFC').replace(/\s+/gu, ' ').trim();
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

/** Like FORBIDDEN but newline (LF, CR) and tab are allowed: multi-line text such as story descriptions. */
const FORBIDDEN_MULTILINE = /[\p{Cc}\p{Zl}\p{Zp}]/u;

export function containsForbiddenMultilineChars(input: string): boolean {
  return FORBIDDEN_MULTILINE.test(input.replace(/[\n\r\t]/gu, ''));
}

/**
 * Multi-line normalization (F02 descriptions): Unicode NFC, CRLF and CR become LF, leading blank
 * lines and trailing whitespace are removed. Internal spaces, tabs, indentation and trailing double
 * spaces (Markdown hard breaks) are kept: Markdown is whitespace-sensitive. Deliberately not
 * `normalizeText`, which would collapse newlines.
 */
export function normalizeMultiline(input: string): string {
  return input
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(/^\s*\n/u, '')
    .replace(/\s+$/u, '');
}

/**
 * Schema for multi-line free text. Length is counted in grapheme clusters of the normalized
 * output, like every other F01/F02 text (a newline is one grapheme). Empty output is allowed.
 */
export function multilineTextSchema({ max, rawMaxUnits }: { max: number; rawMaxUnits: number }) {
  return v.pipe(
    v.string(),
    v.maxLength(rawMaxUnits),
    v.check((s) => !containsForbiddenMultilineChars(s), 'must not contain control characters'),
    v.transform(normalizeMultiline),
    v.check((s) => graphemeLength(s) <= max, `must be at most ${max} characters`),
  );
}
