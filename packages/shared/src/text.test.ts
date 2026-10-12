import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_NAME } from './constants';
import { containsForbiddenChars, graphemeLength, normalizeText, textSchema } from './text';
import { DisplayNameSchema, RoomNameSchema, TopicSchema } from './settings';

const ok = (schema: v.GenericSchema, input: unknown) => v.safeParse(schema, input).success;
const out = (schema: v.GenericSchema, input: unknown) => v.parse(schema, input) as string;

describe('text normalization (F01 Definitions)', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeText('  Alex   Smith   ')).toBe('Alex Smith');
  });

  it('counts grapheme clusters, not code units', () => {
    expect(graphemeLength('abc')).toBe(3);
    expect(graphemeLength('é')).toBe(1); // combining accent
    expect(graphemeLength('👨‍👩‍👧')).toBe(1); // ZWJ family
    expect(graphemeLength('🇩🇪')).toBe(1); // flag
    expect(graphemeLength('☕')).toBe(1);
  });

  it('rejects control characters and newlines rather than collapsing them', () => {
    for (const bad of ['a\nb', 'a\r\nb', 'a\tb', 'a\u0000b', 'a b', 'a\u0007']) {
      expect(containsForbiddenChars(bad)).toBe(true);
      expect(ok(DisplayNameSchema, bad)).toBe(false);
    }
    expect(containsForbiddenChars('plain text 👍')).toBe(false);
  });

  it('F01-AC4: display names are 1-30 graphemes after normalization', () => {
    expect(out(DisplayNameSchema, '  Alex  ')).toBe('Alex');
    expect(ok(DisplayNameSchema, '')).toBe(false);
    expect(ok(DisplayNameSchema, '   ')).toBe(false);
    expect(ok(DisplayNameSchema, 'a'.repeat(30))).toBe(true);
    expect(ok(DisplayNameSchema, 'a'.repeat(31))).toBe(false);
    expect(ok(DisplayNameSchema, '👨‍👩‍👧'.repeat(30))).toBe(true); // 30 graphemes, many code units
    expect(ok(DisplayNameSchema, '👨‍👩‍👧'.repeat(31))).toBe(false);
  });

  it('length is measured after normalization', () => {
    expect(ok(DisplayNameSchema, `  ${'a'.repeat(30)}  `)).toBe(true);
    expect(ok(DisplayNameSchema, `${'a '.repeat(15)}a`)).toBe(false); // 31 graphemes incl. spaces
  });

  it('F01-AC3: room name is 0-80 graphemes and falls back to the default when empty', () => {
    expect(out(RoomNameSchema, '')).toBe(DEFAULT_ROOM_NAME);
    expect(out(RoomNameSchema, '    ')).toBe(DEFAULT_ROOM_NAME);
    expect(out(RoomNameSchema, ' Sprint  42 ')).toBe('Sprint 42');
    expect(ok(RoomNameSchema, 'a'.repeat(80))).toBe(true);
    expect(ok(RoomNameSchema, 'a'.repeat(81))).toBe(false);
  });

  it('F01-AC20: topic is 0-200 graphemes, empty clears, no newlines', () => {
    expect(out(TopicSchema, '   ')).toBe('');
    expect(ok(TopicSchema, 'a'.repeat(200))).toBe(true);
    expect(ok(TopicSchema, 'a'.repeat(201))).toBe(false);
    expect(ok(TopicSchema, 'line1\nline2')).toBe(false);
  });

  it('rejects absurdly long raw input before segmenting', () => {
    expect(ok(textSchema({ min: 0, max: 10_000 }), ' '.repeat(100_000))).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(ok(DisplayNameSchema, 42)).toBe(false);
    expect(ok(DisplayNameSchema, null)).toBe(false);
  });
});
