import { describe, expect, it } from 'vitest';
import { estimateCost } from './pricing.js';

const t = (input: number, output: number, cacheRead = 0, cacheCreation = 0) => ({
  input,
  output,
  cacheRead,
  cacheCreation,
  total: input + output + cacheRead + cacheCreation,
});

describe('estimateCost', () => {
  it('input, output, lettura e scrittura della cache ai prezzi del modello', () => {
    expect(estimateCost('claude-opus-5-5', t(1_000_000, 1_000_000))).toBeCloseTo(24);
    expect(estimateCost('claude-opus-5-5', t(0, 0, 1_000_000, 1_000_000))).toBeCloseTo(0.2 + 5);
    expect(estimateCost('claude-sonnet-5-5', t(0, 0, 1_000_000))).toBeCloseTo(0.2);
    expect(estimateCost('claude-fable-5-1', t(0, 0, 1_000_000))).toBeCloseTo(0.25);
    expect(estimateCost('claude-haiku-4-5', t(1_000_000, 0))).toBeCloseTo(1);
  });

  it('riconosce suffissi e prefissi del model id; null se sconosciuto', () => {
    expect(estimateCost('claude-opus-5-5[1m]', t(1_000_000, 0))).toBeCloseTo(4);
    expect(estimateCost('claude-sonnet-4-5-20250929', t(1_000_000, 0))).toBeCloseTo(3);
    expect(estimateCost('us.anthropic.claude-opus-4-1-20250805-v1:0', t(1_000_000, 0))).toBeCloseTo(15);
    expect(estimateCost('claude-opus-5', t(1_000_000, 0))).toBeCloseTo(5);
    expect(estimateCost('gpt-qualcosa', t(1, 1))).toBeNull();
    expect(estimateCost(null, t(1, 1))).toBeNull();
  });
});
