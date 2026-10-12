import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROOM_ID_ALPHABET, ROOM_ID_LENGTH } from './constants';
import { generateRoomId, isRoomId, normalizeRoomId } from './room-id';

const webCrypto = (
  globalThis as unknown as { crypto: { getRandomValues(b: Uint8Array): Uint8Array } }
).crypto;

afterEach(() => vi.restoreAllMocks());

describe('room IDs (F01-AC2)', () => {
  it('F01-AC2: 16 chars of lowercase Crockford base32', () => {
    for (let i = 0; i < 200; i++) {
      const id = generateRoomId();
      expect(id).toHaveLength(ROOM_ID_LENGTH);
      expect(id).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{16}$/);
      expect(isRoomId(id)).toBe(true);
    }
    expect(ROOM_ID_ALPHABET).toHaveLength(32);
    expect(ROOM_ID_LENGTH * Math.log2(ROOM_ID_ALPHABET.length)).toBe(80);
  });

  it('F01-AC2: the random source is crypto.getRandomValues', () => {
    const spy = vi.spyOn(webCrypto, 'getRandomValues');
    generateRoomId();
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0]![0] as Uint8Array;
    expect(arg).toBeInstanceOf(Uint8Array);
    expect(arg.length).toBe(ROOM_ID_LENGTH);
  });

  it('maps each 5-bit value to one alphabet char, ignoring the top bits (uniform)', () => {
    const id = generateRoomId((b) => b.map((_, i) => i + 32 * 3)); // top bits set, low bits 0..15
    expect(id).toBe([...ROOM_ID_ALPHABET].slice(0, 16).join(''));
  });

  it('covers the full alphabet roughly evenly', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 2000; i++)
      for (const c of generateRoomId()) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(32);
    for (const n of counts.values()) expect(n).toBeGreaterThan(700); // expected 1000
  });

  it('IDs do not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateRoomId()));
    expect(ids.size).toBe(1000);
  });

  it('F01-AC2: lookups are case-insensitive', () => {
    expect(normalizeRoomId('ABCDEFGHJKMNPQRS')).toBe('abcdefghjkmnpqrs');
    expect(isRoomId('ABCDEFGHJKMNPQRS')).toBe(false); // strict check is canonical-only
  });

  it('F01-AC6: malformed IDs are rejected', () => {
    for (const bad of [
      '',
      'abc',
      'abcdefghjkmnpqr',
      'abcdefghjkmnpqrst',
      'abcdefghjkmnpqri',
      'abcdefghjkmnpqr!',
      'abcdefghjkmnpqr ',
      '../etc/passwd',
    ]) {
      expect(normalizeRoomId(bad)).toBeNull();
    }
  });
});
