import { describe, expect, it } from 'vitest';
import { contextLevel, formatTokens, percent } from './format';

describe('formatTokens', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [1000, '1k'],
    [1234, '1.2k'],
    [12_345, '12.3k'],
    [99_999, '100k'],
    [123_456, '123k'],
    [999_999, '1M'],
    [1_000_000, '1M'],
    [2_500_000, '2.5M'],
    [12_340_000, '12.3M'],
    [3_200_000_000, '3.2B'],
    [-1234, '-1.2k'],
    [12.7, '13'],
  ])('%d → %s', (n, out) => {
    expect(formatTokens(n)).toBe(out);
  });

  it('valori non finiti → "0"', () => {
    expect(formatTokens(Number.NaN)).toBe('0');
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe('0');
  });
});

describe('percent', () => {
  it('calcola e limita 0..100, null se totale non valido', () => {
    expect(percent(1, 4)).toBe(25);
    expect(percent(2, 3)).toBe(67);
    expect(percent(5, 4)).toBe(100);
    expect(percent(-1, 4)).toBe(0);
    expect(percent(1, 0)).toBeNull();
    expect(percent(1, null)).toBeNull();
  });
});

describe('contextLevel', () => {
  it('ok ≤70, warn >70, danger >90', () => {
    expect(contextLevel(70)).toBe('ok');
    expect(contextLevel(71)).toBe('warn');
    expect(contextLevel(90)).toBe('warn');
    expect(contextLevel(91)).toBe('danger');
  });
});
