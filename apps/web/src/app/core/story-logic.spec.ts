import {
  acceptChoices,
  bulkServerError,
  checkStoryDescription,
  checkStoryLink,
  checkStoryTitle,
  orderRows,
  previewBulk,
  progressText,
} from './story-logic';
import { story } from '../testing/fixtures';
import type { Deck } from '@pokr/shared';

const votes = (...cards: string[]) => cards.map((card, i) => ({ participantId: `p${i}`, card }));
const fib: Deck = { id: 'fibonacci' };
const tshirt: Deck = { id: 'tshirt' };

describe('story text checks', () => {
  it('F02-AC2 title: required, normalized, 200 graphemes, no control characters', () => {
    expect(checkStoryTitle('  A   story ')).toEqual({ ok: true, value: 'A story' });
    expect(checkStoryTitle('   ')).toMatchObject({ ok: false, message: 'Enter a title.' });
    expect(checkStoryTitle('x'.repeat(200)).ok).toBe(true);
    expect(checkStoryTitle('x'.repeat(201)).ok).toBe(false);
    expect(checkStoryTitle('👩‍👩‍👧‍👦'.repeat(200)).ok).toBe(false); // 800+ bytes? counted in bytes
    expect(checkStoryTitle('a\nb').ok).toBe(false);
  });

  it('F02-AC2 description is optional, multi-line, at most 5,000 characters', () => {
    expect(checkStoryDescription('')).toEqual({ ok: true, value: '' });
    expect(checkStoryDescription('a\r\nb')).toEqual({ ok: true, value: 'a\nb' });
    expect(checkStoryDescription('x'.repeat(5000)).ok).toBe(true);
    expect(checkStoryDescription('x'.repeat(5001)).ok).toBe(false);
  });

  it('F02-AC2 link is optional http(s) only', () => {
    expect(checkStoryLink('')).toEqual({ ok: true, value: null });
    expect(checkStoryLink(' https://a.example/x ')).toEqual({
      ok: true,
      value: 'https://a.example/x',
    });
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://a.example',
      '//a.example',
      'example.com',
      'http://',
      'http://a b',
      'http://user:pw@a.example',
    ]) {
      expect(checkStoryLink(bad).ok, bad).toBe(false);
    }
  });
});

describe('previewBulk', () => {
  it('F02-AC3 counts non-blank lines and reports nothing wrong', () => {
    expect(previewBulk('a\n\n  \nb\r\nc\n', 0)).toMatchObject({ count: 3, ok: true, errors: [] });
  });

  it('F02-AC3 reports the 1-based line of a bad line without echoing it', () => {
    const p = previewBulk(`ok\n${'x'.repeat(201)}\nok`, 0);
    expect(p.ok).toBe(false);
    expect(p.errors[0]).toContain('Line 2');
    expect(p.errors.join()).not.toContain('xxxx');
  });

  it('F02-AC3 nothing to add is not sendable; 101 lines and a full agenda are rejected', () => {
    expect(previewBulk('\n \n', 0).ok).toBe(false);
    expect(previewBulk(Array.from({ length: 101 }, (_, i) => `s${i}`).join('\n'), 0).ok).toBe(
      false,
    );
    expect(previewBulk(Array.from({ length: 100 }, (_, i) => `s${i}`).join('\n'), 0).ok).toBe(true);
    expect(previewBulk('a\nb', 199).ok).toBe(false);
    expect(previewBulk('a', 199).ok).toBe(true);
  });

  it('F02-AC3 list markers are kept as typed', () => {
    expect(previewBulk('- a\n1. b\n[ ] c', 0).count).toBe(3);
  });

  it('F02-AC3 maps server line errors to the line number only', () => {
    expect(bulkServerError('invalid_input', 'text.7')).toContain('Line 7');
    expect(bulkServerError('invalid_input', 'text')).not.toBeNull();
    expect(bulkServerError('not_allowed', undefined)).toBeNull();
  });
});

describe('acceptChoices (quick picks come from the shared function)', () => {
  it('F02-AC10 consensus and median that agree are shown once', () => {
    const c = acceptChoices(fib, votes('5', '5', '5'));
    expect(c.quick).toHaveLength(1);
    expect(c.quick[0]).toMatchObject({ card: '5', kind: 'both' });
  });

  it('F02-AC10 median rounds up to a deck card; consensus only when all agree', () => {
    expect(acceptChoices(fib, votes('3', '5')).quick.map((q) => [q.kind, q.card])).toEqual([
      ['median', '5'],
    ]);
    expect(acceptChoices(fib, votes('3', '8')).quick.map((q) => q.card)).toEqual(['8']);
    expect(acceptChoices(fib, votes('5', '5', '?')).quick[0]).toMatchObject({
      card: '5',
      kind: 'both',
    });
    expect(acceptChoices(fib, votes('5', '☕')).quick.map((q) => q.card)).toEqual(['5']);
  });

  it('F02-AC10 T-shirt decks use the upper median by deck position', () => {
    expect(acceptChoices(tshirt, votes('S', 'M', 'L')).quick.map((q) => q.card)).toEqual(['M']);
    expect(acceptChoices(tshirt, votes('S', 'L')).quick.map((q) => q.card)).toEqual(['L']);
  });

  it('F02-AC10 no value votes: no quick picks, but every value card, never ? or coffee', () => {
    const c = acceptChoices(fib, votes('?', '?'));
    expect(c.quick).toEqual([]);
    expect(acceptChoices(fib, []).quick).toEqual([]);
    expect(c.cards).toContain('13');
    expect(c.cards).not.toContain('?');
    expect(c.cards).not.toContain('☕');
  });
});

describe('progress and order', () => {
  it('F02-AC14 progress text, "No stories yet" for an empty agenda', () => {
    expect(progressText({ estimated: 7, outOf: 10, skipped: 2 }, 12)).toBe(
      '7 of 10 estimated, 2 skipped',
    );
    expect(progressText({ estimated: 1, outOf: 3, skipped: 0 }, 3)).toBe('1 of 3 estimated');
    expect(progressText({ estimated: 0, outOf: 0, skipped: 0 }, 0)).toBe('No stories yet');
    expect(progressText({ estimated: 0, outOf: 0, skipped: 2 }, 2)).not.toContain('0 of 0');
  });

  it('F02-AC4 orderRows applies the local order and tolerates missing ids', () => {
    const rows = [story('a'), story('b'), story('c')];
    expect(orderRows(rows, null)).toBe(rows);
    expect(orderRows(rows, ['c', 'a', 'gone', 'b']).map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(orderRows(rows, ['b']).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });
});
