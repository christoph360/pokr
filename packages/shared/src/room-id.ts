import { ROOM_ID_ALPHABET, ROOM_ID_LENGTH } from './constants';

export type RandomSource = (bytes: Uint8Array) => Uint8Array;

/** Default random source: `crypto.getRandomValues` (F01-AC2). Looked up at call time so tests can spy on it. */
const cryptoRandom: RandomSource = (bytes) =>
  (
    globalThis as unknown as { crypto: { getRandomValues(b: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(bytes);

/**
 * 16 chars of lowercase Crockford base32 = 80 bits. Each random byte is masked to 5 bits;
 * 256 is a multiple of 32, so the distribution is uniform.
 */
export function generateRoomId(random: RandomSource = cryptoRandom): string {
  const bytes = random(new Uint8Array(ROOM_ID_LENGTH));
  let id = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++) id += ROOM_ID_ALPHABET[bytes[i]! & 31];
  return id;
}

const ROOM_ID_RE = new RegExp(`^[${ROOM_ID_ALPHABET}]{${ROOM_ID_LENGTH}}$`);

/** Strict check on an already-canonical (lowercase) ID. */
export function isRoomId(value: string): boolean {
  return ROOM_ID_RE.test(value);
}

/** Lookups are case-insensitive: returns the canonical lowercase ID, or null if malformed. */
export function normalizeRoomId(value: string): string | null {
  const id = value.toLowerCase();
  return isRoomId(id) ? id : null;
}
