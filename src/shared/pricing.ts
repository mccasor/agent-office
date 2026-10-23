import type { TokenUsage } from './types.js';

/** Prezzi in dollari per milione di token: input, output, lettura e scrittura (5 minuti) della cache. */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const price = (input: number, output: number, cacheRead = input * 0.1): Price => ({
  input,
  output,
  cacheRead,
  cacheWrite: input * 1.25,
});

/**
 * Listino dell'API Anthropic (prezzi pubblici di prima parte, ottobre 2026), dal prefisso più specifico.
 * È una stima: non distingue la cache da 1 ora (scrittura 2x) né la fascia oltre 100K token di Haiku 5.5.
 */
const PRICES: [prefix: string, price: Price][] = [
  ['claude-fable-5-1', price(10, 50, 0.25)],
  ['claude-mythos-5-1', price(10, 50, 0.25)],
  ['claude-fable-5', price(10, 50, 1)],
  ['claude-mythos-5', price(10, 50, 1)],
  ['claude-opus-5-5', price(4, 20, 0.2)],
  ['claude-opus-5', price(5, 25)],
  ['claude-opus-4-8', price(5, 25)],
  ['claude-opus-4-7', price(5, 25)],
  ['claude-opus-4-6', price(5, 25)],
  ['claude-opus-4-5', price(5, 25)],
  ['claude-opus-4', price(15, 75)],
  ['claude-sonnet-5', price(2, 10, 0.2)],
  ['claude-sonnet-4', price(3, 15)],
  ['claude-haiku-5-5', price(0.1, 0.5)],
  ['claude-haiku-4-5', price(1, 5)],
];

/** Costo stimato in dollari dei token usati con `model`; null se il modello non è nel listino. */
export function estimateCost(model: string | null, tokens: TokenUsage): number | null {
  if (!model) return null;
  // "claude-opus-5-5[1m]", "claude-sonnet-4-5-20250929", "us.anthropic.claude-…" -> prefisso del listino
  const id = model.toLowerCase().replace(/^.*?(claude-)/, '$1');
  const p = PRICES.find(([prefix]) => id.startsWith(prefix))?.[1];
  if (!p) return null;
  return (
    (tokens.input * p.input + tokens.output * p.output + tokens.cacheRead * p.cacheRead + tokens.cacheCreation * p.cacheWrite) /
    1_000_000
  );
}
