/**
 * Independent oracle for the F01-AC15 summary (does not import app code).
 * Votes are card strings of a numeric deck; `?` and the coffee card are special.
 */
export interface ExpectedSummary {
  average: string | null;
  median: string | null;
  consensus: boolean;
}

const SPECIAL = new Set(['?', '☕']);

function toHundredths(card: string): number | null {
  if (card === '½') return 50;
  if (!/^\d+(\.\d{1,2})?$/.test(card)) return null;
  return Math.round(Number(card) * 100);
}

/** Round num/den half away from zero (non-negative inputs only). */
function roundDiv(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

export function expectedSummary(cards: string[], numericDeck: boolean): ExpectedSummary {
  const value = cards.filter((c) => !SPECIAL.has(c));
  const consensus = value.length >= 2 && new Set(value).size === 1;
  if (!numericDeck) return { average: null, median: null, consensus };
  const nums = value
    .map(toHundredths)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  if (nums.length === 0) return { average: null, median: null, consensus };
  const sum = nums.reduce((a, b) => a + b, 0);
  const avgTenths = roundDiv(sum, 10 * nums.length);
  const mid = Math.floor(nums.length / 2);
  const medTenths =
    nums.length % 2 === 1 ? roundDiv(nums[mid]!, 10) : roundDiv(nums[mid - 1]! + nums[mid]!, 20);
  const fmt = (t: number, fixed: boolean): string =>
    t % 10 === 0 && !fixed ? String(t / 10) : `${Math.floor(t / 10)}.${t % 10}`;
  return { average: fmt(avgTenths, true), median: fmt(medTenths, false), consensus };
}
